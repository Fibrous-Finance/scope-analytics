import type Database from "better-sqlite3";
import { createPublicClient, http, type Address, type Log, decodeEventLog } from "viem";
import { getMeta, setMeta } from "../database";
import { ENV } from "../config/env";
import { getChainDefinition, type NetworkConfig } from "../config/networks";
import { erc20Abi } from "../config/abi";
import { sanitizeDecimals } from "../utils/format";

export interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

function createClient(config: NetworkConfig) {
	return createPublicClient({
		chain: getChainDefinition(config),
		transport: http(config.rpcUrl, {
			retryCount: ENV.MAX_RETRIES,
			retryDelay: ENV.RETRY_DELAY_MS,
		}),
	});
}

async function fetchLogsWithRetry(
	client: ReturnType<typeof createClient>,
	address: Address,
	fromBlock: bigint,
	toBlock: bigint,
	retries = ENV.MAX_RETRIES
): Promise<Log[]> {
	try {
		return await client.getLogs({ address, fromBlock, toBlock });
	} catch (error) {
		if (retries > 0) {
			console.warn(
				`⚠ RPC error, retrying... (${ENV.MAX_RETRIES - retries + 1}/${ENV.MAX_RETRIES})`
			);
			await new Promise((resolve) =>
				setTimeout(resolve, ENV.RETRY_DELAY_MS * (ENV.MAX_RETRIES - retries + 1))
			);
			return fetchLogsWithRetry(client, address, fromBlock, toBlock, retries - 1);
		}
		throw error;
	}
}

export async function scanLogs(
	db: Database.Database,
	config: NetworkConfig,
	incremental: boolean
): Promise<void> {
	const client = createClient(config);
	const address = config.contractAddress;
	const latestBlock = await client.getBlockNumber();
	let startBlock = 0n;

	if (incremental) {
		const lastScanned = getMeta(db, "lastScannedBlock");
		if (lastScanned) {
			startBlock = BigInt(lastScanned) + 1n;
			console.log(`📊 Resuming from block ${startBlock.toLocaleString()}`);
		}
	} else {
		console.log("🔄 Full scan mode - scanning from genesis");
	}

	if (startBlock > latestBlock) {
		console.log("✓ Already up to date!");
		return;
	}

	console.log(
		`🔍 Scanning blocks ${startBlock.toLocaleString()} → ${latestBlock.toLocaleString()}`
	);

	const insertLog = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

	const insertSwap = db.prepare(`
    INSERT OR IGNORE INTO swap_events 
    (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	const insertFee = db.prepare(`
    INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
    VALUES (?, ?)
  `);

	const checkTxExists = db.prepare(`
    SELECT 
      CASE WHEN EXISTS(SELECT 1 FROM logs WHERE tx_hash = ?) THEN 1 ELSE 0 END as log_exists,
      CASE WHEN EXISTS(SELECT 1 FROM fees WHERE tx_hash = ?) THEN 1 ELSE 0 END as fee_exists,
      CASE WHEN EXISTS(SELECT 1 FROM swap_events WHERE tx_hash = ?) THEN 1 ELSE 0 END as swap_exists
  `);

	let currentBlock = startBlock;
	let processedLogs = 0;
	let processedSwaps = 0;
	let filledMissingFees = 0;
	let filledMissingSwaps = 0;

	while (currentBlock <= latestBlock) {
		const endBlock =
			currentBlock + ENV.BATCH_SIZE > latestBlock
				? latestBlock
				: currentBlock + ENV.BATCH_SIZE - 1n;

		try {
			const logs = await fetchLogsWithRetry(client, address, currentBlock, endBlock);

			if (logs.length > 0) {
				const logData = await Promise.all(
					logs.map(async (log) => {
						try {
							const [receipt, block] = await Promise.all([
								client.getTransactionReceipt({ hash: log.transactionHash! }),
								client.getBlock({ blockNumber: log.blockNumber! }),
							]);

							const feeWei =
								receipt.gasUsed *
								(receipt as unknown as { effectiveGasPrice: bigint })
									.effectiveGasPrice;
							const feeData = {
								tx_hash: log.transactionHash!,
								fee_wei: feeWei.toString(),
							};

							const decodedSwaps = [];
							if (log.address.toLowerCase() === address.toLowerCase()) {
								try {
									const decoded = decodeEventLog({
										abi: config.abi,
										data: log.data,
										topics: log.topics,
									});
									if (decoded.eventName === "Swap") {
										const args = decoded.args as unknown as SwapEventData;
										decodedSwaps.push({
											tx_hash: log.transactionHash!,
											log_index:
												typeof log.logIndex !== "undefined"
													? Number(log.logIndex)
													: 0,
											block_number: Number(log.blockNumber!),
											sender: args.sender.toLowerCase(),
											amount_in: args.amount_in.toString(),
											amount_out: args.amount_out.toString(),
											token_in: args.token_in.toLowerCase(),
											token_out: args.token_out.toLowerCase(),
											destination: args.destination.toLowerCase(),
											timestamp: Number(block.timestamp),
										});
									}
								} catch {
									/* Not a swap event or decoding failed */
								}
							}

							if (!incremental) {
								const txHash = log.transactionHash!;
								const txStatus = checkTxExists.get(txHash, txHash, txHash) as
									| {
											log_exists: number;
											fee_exists: number;
											swap_exists: number;
									  }
									| undefined;

								if (txStatus?.log_exists && !txStatus.fee_exists) {
									filledMissingFees++;
								}

								if (txStatus?.log_exists && !txStatus.swap_exists && receipt.logs) {
									let foundSwapsInReceipt = 0;
									for (const recLog of receipt.logs) {
										if (
											recLog.address.toLowerCase() === address.toLowerCase()
										) {
											try {
												const decoded = decodeEventLog({
													abi: config.abi,
													data: recLog.data,
													topics: recLog.topics,
												});
												if (decoded.eventName === "Swap") {
													const args =
														decoded.args as unknown as SwapEventData;
													decodedSwaps.push({
														tx_hash: txHash,
														log_index:
															typeof recLog.logIndex !== "undefined"
																? Number(recLog.logIndex)
																: 0,
														block_number: Number(log.blockNumber!),
														sender: args.sender.toLowerCase(),
														amount_in: args.amount_in.toString(),
														amount_out: args.amount_out.toString(),
														token_in: args.token_in.toLowerCase(),
														token_out: args.token_out.toLowerCase(),
														destination: args.destination.toLowerCase(),
														timestamp: Number(block.timestamp),
													});
													foundSwapsInReceipt++;
												}
											} catch {
												/* Not a swap event or decoding failed */
											}
										}
									}
									if (foundSwapsInReceipt > 0) {
										filledMissingSwaps++;
									}
								}
							}

							return {
								log: {
									tx_hash: log.transactionHash!,
									block_number: Number(log.blockNumber!),
									from_address: receipt.from.toLowerCase(),
									gas_used: receipt.gasUsed.toString(),
									timestamp: Number(block.timestamp),
								},
								fee: feeData,
								swaps: decodedSwaps,
							};
						} catch (e) {
							console.warn(
								`⚠ Could not process log for ${log.transactionHash!}:`,
								(e as Error).message
							);
							return null;
						}
					})
				);

				const validData = logData.filter((d) => d !== null);

				if (validData.length > 0) {
					const insertMany = db.transaction((data) => {
						for (const item of data) {
							if (item) {
								insertLog.run(
									item.log.tx_hash,
									item.log.block_number,
									item.log.from_address,
									item.log.gas_used,
									item.log.timestamp
								);
								if (item.fee) {
									insertFee.run(item.fee.tx_hash, item.fee.fee_wei);
								}
								for (const swap of item.swaps) {
									insertSwap.run(
										swap.tx_hash,
										swap.log_index,
										swap.block_number,
										swap.sender,
										swap.amount_in,
										swap.amount_out,
										swap.token_in,
										swap.token_out,
										swap.destination,
										swap.timestamp
									);
									processedSwaps++;
								}
							}
						}
					});

					insertMany(validData);
					processedLogs += validData.length;
				}
			}

			const denom = latestBlock - startBlock;
			const progress = denom === 0n ? 100 : Number(((endBlock - startBlock) * 100n) / denom);
			console.log(
				`  Block ${endBlock.toLocaleString()} | ${logs.length} logs | ${processedSwaps} swaps | ${progress.toFixed(1)}% complete`
			);

			currentBlock = endBlock + 1n;
		} catch (error) {
			console.error(`❌ Error scanning blocks ${currentBlock}-${endBlock}:`, error);
			throw error;
		}
	}

	setMeta(db, "lastScannedBlock", latestBlock.toString());

	const actualTxCount = db.prepare("SELECT COUNT(*) as count FROM logs").get() as {
		count: number;
	};
	const actualSwapCount = db.prepare("SELECT COUNT(*) as count FROM swap_events").get() as {
		count: number;
	};

	let summary = `\n✓ Scan complete! Processed ${processedLogs.toLocaleString()} transactions, ${processedSwaps.toLocaleString()} swap events`;
	summary += `\n  📊 Database now contains: ${actualTxCount.count.toLocaleString()} transactions, ${actualSwapCount.count.toLocaleString()} swap events`;
	if (filledMissingFees > 0 || filledMissingSwaps > 0) {
		summary += `\n  🔧 Filled missing data: ${filledMissingFees} fees, ${filledMissingSwaps} swap events`;
	}
	console.log(summary);
}

export async function backfillFees(
	db: Database.Database,
	config: NetworkConfig,
	batch = 500,
	concurrency = 10
): Promise<{ processed: number; inserted: number }> {
	const client = createClient(config);
	const countMissingStmt = db.prepare(
		`SELECT COUNT(*) AS cnt
         FROM logs l
         LEFT JOIN fees f ON l.tx_hash = f.tx_hash
         WHERE f.tx_hash IS NULL`
	);
	const totalMissingRow = countMissingStmt.get() as { cnt: number } | undefined;
	const totalMissing = totalMissingRow?.cnt ?? 0;
	if (totalMissing === 0) return { processed: 0, inserted: 0 };

	const selectMissing = db.prepare(
		`SELECT l.tx_hash AS tx_hash
         FROM logs l
         LEFT JOIN fees f ON l.tx_hash = f.tx_hash
         WHERE f.tx_hash IS NULL
         ORDER BY l.block_number ASC
         LIMIT ?`
	);
	const insertFeeLocal = db.prepare(`
        INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
        VALUES (?, ?)
    `);

	let processed = 0;
	let inserted = 0;

	while (true) {
		const rows = selectMissing.all(batch) as Array<{ tx_hash: string }>;
		if (rows.length === 0) break;

		for (let i = 0; i < rows.length; i += concurrency) {
			const chunk = rows.slice(i, i + concurrency);
			await Promise.all(
				chunk.map(async ({ tx_hash }) => {
					try {
						const receipt = await client.getTransactionReceipt({
							hash: tx_hash as `0x${string}`,
						});
						const eff = (receipt as unknown as { effectiveGasPrice: bigint })
							.effectiveGasPrice;
						const feeWei = receipt.gasUsed * eff;
						insertFeeLocal.run(tx_hash, feeWei.toString());
						inserted++;
					} catch {
					} finally {
						processed++;
					}
				})
			);
		}

		const percent = Math.min(100, (processed / totalMissing) * 100).toFixed(1);
		console.log(
			`  Backfill ${processed}/${totalMissing} | ${inserted} inserted | ${percent}% complete`
		);
		if (rows.length < batch) break;
	}

	return { processed, inserted };
}

export async function backfillSwapEvents(
	db: Database.Database,
	config: NetworkConfig,
	batch = 500,
	concurrency = 10
): Promise<{ processed: number; inserted: number; txWithSwap: number }> {
	const client = createClient(config);
	const countMissingStmt = db.prepare(
		`SELECT COUNT(*) AS cnt
         FROM logs l
         LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
         WHERE s.tx_hash IS NULL`
	);
	const totalMissingRow = countMissingStmt.get() as { cnt: number } | undefined;
	const totalMissing = totalMissingRow?.cnt ?? 0;
	if (totalMissing === 0) return { processed: 0, inserted: 0, txWithSwap: 0 };

	const selectMissing = db.prepare(
		`SELECT l.tx_hash AS tx_hash
         FROM logs l
         LEFT JOIN swap_events s ON l.tx_hash = s.tx_hash
         WHERE s.tx_hash IS NULL
         ORDER BY l.block_number ASC
         LIMIT ?`
	);
	const insertSwapLocal = db.prepare(`
        INSERT OR IGNORE INTO swap_events 
        (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

	let processed = 0;
	let inserted = 0;
	let txWithSwap = 0;

	while (true) {
		const rows = selectMissing.all(batch) as Array<{ tx_hash: string }>;
		if (rows.length === 0) break;

		for (let i = 0; i < rows.length; i += concurrency) {
			const chunk = rows.slice(i, i + concurrency);
			await Promise.all(
				chunk.map(async ({ tx_hash }) => {
					try {
						const receipt = await client.getTransactionReceipt({
							hash: tx_hash as `0x${string}`,
						});
						let foundSwapForTx = false;
						for (const recLog of receipt.logs ?? []) {
							try {
								const decoded = decodeEventLog({
									abi: config.abi,
									data: recLog.data,
									topics: recLog.topics,
								});
								if (decoded.eventName === "Swap") {
									const args = decoded.args as unknown as {
										sender: string;
										amount_in: bigint;
										amount_out: bigint;
										token_in: string;
										token_out: string;
										destination: string;
									};
									const block = await client.getBlock({
										blockNumber: receipt.blockNumber!,
									});
									insertSwapLocal.run(
										tx_hash,
										typeof recLog.logIndex !== "undefined"
											? Number(recLog.logIndex)
											: 0,
										Number(receipt.blockNumber!),
										args.sender.toLowerCase(),
										args.amount_in.toString(),
										args.amount_out.toString(),
										args.token_in.toLowerCase(),
										args.token_out.toLowerCase(),
										args.destination.toLowerCase(),
										Number(block.timestamp)
									);
									inserted++;
									foundSwapForTx = true;
								}
							} catch {}
						}
						if (foundSwapForTx) txWithSwap++;
					} catch {
					} finally {
						processed++;
					}
				})
			);
		}

		const percent = Math.min(100, (processed / totalMissing) * 100).toFixed(1);
		console.log(
			`  Backfill(events) ${processed}/${totalMissing} | swaps inserted: ${inserted} | tx with swaps: ${txWithSwap} | ${percent}% complete`
		);

		if (rows.length < batch) break;
	}

	return { processed, inserted, txWithSwap };
}

export async function backfillTokenMetadata(
	db: Database.Database,
	config: NetworkConfig,
	batch = 200,
	concurrency = 10
): Promise<{ processed: number; inserted: number }> {
	const client = createClient(config);
	const selectMissingTokens = db.prepare(
		`WITH tokens AS (
            SELECT DISTINCT token_in AS address FROM swap_events
            UNION
            SELECT DISTINCT token_out AS address FROM swap_events
        )
        SELECT t.address AS address
        FROM tokens t
        LEFT JOIN token_metadata m ON t.address = m.address
        WHERE m.address IS NULL
        LIMIT ?`
	);
	const insertMeta = db.prepare(
		`INSERT OR IGNORE INTO token_metadata (address, decimals, symbol) VALUES (?, ?, ?)`
	);

	let processed = 0;
	let inserted = 0;

	while (true) {
		const rows = selectMissingTokens.all(batch) as Array<{ address: string }>;
		if (rows.length === 0) break;

		const tokens = rows.map((r) => r.address as Address);

		try {
			const decCalls = tokens.map((address) => ({
				address,
				abi: erc20Abi,
				functionName: "decimals" as const,
			}));
			const symCalls = tokens.map((address) => ({
				address,
				abi: erc20Abi,
				functionName: "symbol" as const,
			}));

			const [decResults, symResults] = await Promise.all([
				client.multicall({ contracts: decCalls, allowFailure: true }),
				client.multicall({ contracts: symCalls, allowFailure: true }),
			]);

			for (let i = 0; i < tokens.length; i++) {
				const address = tokens[i];
				if (!address) {
					processed++;
					continue;
				}
				const decRes = decResults[i] as {
					status: "success" | "failure";
					result?: number | bigint;
				};
				const symRes = symResults[i] as { status: "success" | "failure"; result?: string };

				let decimals: number | bigint = 18;
				let symbol: string = "UNKNOWN";

				if (decRes && decRes.status === "success" && decRes.result !== undefined) {
					decimals = decRes.result as number | bigint;
				}
				if (symRes && symRes.status === "success" && symRes.result !== undefined) {
					symbol = symRes.result as string;
				}

				const symUpper = symbol.toUpperCase();
				let decSan = sanitizeDecimals(decimals);
				if (symUpper === "USDC") decSan = 6;
				else if (symUpper === "USDT") decSan = 6;
				else if (symUpper === "WBTC") decSan = 8;
				else if (symUpper === "WETH") decSan = 18;

				insertMeta.run(address.toLowerCase(), decSan, symbol);
				inserted++;
				processed++;
			}
		} catch {
			for (const addr of tokens) {
				if (!addr) {
					processed++;
					continue;
				}
				try {
					let decimals = await client.readContract({
						address: addr as Address,
						abi: erc20Abi,
						functionName: "decimals",
					});
					let symbol = "";
					try {
						symbol = await client.readContract({
							address: addr as Address,
							abi: erc20Abi,
							functionName: "symbol",
						});
					} catch {}
					insertMeta.run(
						addr.toLowerCase(),
						sanitizeDecimals(decimals),
						symbol || "UNKNOWN"
					);
					inserted++;
				} catch {
					// skip
				} finally {
					processed++;
				}
			}
		}
	}

	return { processed, inserted };
}
