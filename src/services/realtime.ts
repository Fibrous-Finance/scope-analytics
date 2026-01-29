import type Database from "better-sqlite3";
import { createPublicClient, webSocket, decodeEventLog, type Address, type Log } from "viem";
import { getChainDefinition, type NetworkConfig } from "../config/networks";
import { ENV } from "../config/env";

export interface SwapEventData {
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
}

export interface ProcessedSwapEvent extends SwapEventData {
	tx_hash: string;
	block_number: number;
	log_index: number;
	timestamp: number;
}

type SwapCallback = (swap: ProcessedSwapEvent) => void | Promise<void>;

export class RealtimeIndexer {
	private wsClient: ReturnType<typeof createPublicClient> | null = null;
	private swapCallbacks: SwapCallback[] = [];
	private isConnected = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectDelay = 5000; // 5 seconds

	constructor(
		private db: Database.Database,
		private config: NetworkConfig
	) {}

	/**
	 * Initialize WebSocket connection
	 */
	async connect(): Promise<void> {
		const wsRpcUrl = this.getWebSocketUrl();

		if (!wsRpcUrl) {
			console.warn(
				`⚠️  No WebSocket URL configured for ${this.config.name}. Falling back to HTTP polling.`
			);
			return;
		}

		try {
			this.wsClient = createPublicClient({
				chain: getChainDefinition(this.config),
				transport: webSocket(wsRpcUrl, {
					reconnect: {
						attempts: this.maxReconnectAttempts,
						delay: this.reconnectDelay,
					},
					timeout: 30000,
				}),
			});

			this.isConnected = true;
			this.reconnectAttempts = 0;
			console.log(`✅ WebSocket connected: ${this.config.name}`);
		} catch (error) {
			console.error(`❌ WebSocket connection failed:`, error);
			this.handleReconnect();
		}
	}

	/**
	 * Get WebSocket URL from environment
	 */
	private getWebSocketUrl(): string | null {
		// Try to convert HTTP RPC to WebSocket
		const httpUrl = this.config.rpcUrl;

		// Check if there's a specific WebSocket URL in env
		if (this.config.id === "citrea" && process.env.CITREA_WS_RPC_URL) {
			return process.env.CITREA_WS_RPC_URL;
		}
		if (this.config.id === "monad" && process.env.MONAD_WS_RPC_URL) {
			return process.env.MONAD_WS_RPC_URL;
		}

		// Auto-convert HTTP to WebSocket (common patterns)
		if (httpUrl.startsWith("https://")) {
			return httpUrl.replace("https://", "wss://");
		}
		if (httpUrl.startsWith("http://")) {
			return httpUrl.replace("http://", "ws://");
		}

		return null;
	}

	/**
	 * Handle reconnection logic
	 */
	private handleReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(`❌ Max reconnection attempts reached. Switching to HTTP polling.`);
			return;
		}

		this.reconnectAttempts++;
		console.log(`🔄 Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

		setTimeout(() => {
			this.connect();
		}, this.reconnectDelay * this.reconnectAttempts);
	}

	/**
	 * Watch for Swap events in real-time
	 */
	async watchSwapEvents(): Promise<(() => void) | null> {
		if (!this.wsClient) {
			console.warn("⚠️  WebSocket not connected. Call connect() first.");
			return null;
		}

		console.log(`👀 Watching Swap events on ${this.config.name}...`);

		const unwatch = this.wsClient.watchContractEvent({
			address: this.config.contractAddress,
			abi: this.config.abi,
			eventName: "Swap",
			onLogs: async (logs) => {
				for (const log of logs) {
					await this.processLog(log);
				}
			},
			onError: (error) => {
				console.error("❌ WebSocket event error:", error);
				this.isConnected = false;
				this.handleReconnect();
			},
		});

		return unwatch;
	}

	/**
	 * Process a single log event
	 */
	private async processLog(log: Log): Promise<void> {
		try {
			// Decode event
			const decoded = decodeEventLog({
				abi: this.config.abi,
				data: log.data,
				topics: log.topics,
			});

			if (decoded.eventName !== "Swap") return;

			const args = decoded.args as unknown as SwapEventData;

			// Get transaction details
			const [receipt, block] = await Promise.all([
				this.wsClient!.getTransactionReceipt({ hash: log.transactionHash! }),
				this.wsClient!.getBlock({ blockNumber: log.blockNumber! }),
			]);

			// Calculate fee
			const feeWei = receipt.gasUsed * (receipt as any).effectiveGasPrice || BigInt(0);

			// Store in database
			const insertLog = this.db.prepare(`
				INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
				VALUES (?, ?, ?, ?, ?)
			`);

			const insertFee = this.db.prepare(`
				INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
				VALUES (?, ?)
			`);

			const insertSwap = this.db.prepare(`
				INSERT OR IGNORE INTO swap_events 
				(tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			// Execute transaction
			this.db.transaction(() => {
				insertLog.run(
					log.transactionHash!,
					Number(log.blockNumber!),
					receipt.from.toLowerCase(),
					receipt.gasUsed.toString(),
					Number(block.timestamp)
				);

				insertFee.run(log.transactionHash!, feeWei.toString());

				insertSwap.run(
					log.transactionHash!,
					typeof log.logIndex !== "undefined" ? Number(log.logIndex) : 0,
					Number(log.blockNumber!),
					args.sender.toLowerCase(),
					args.amount_in.toString(),
					args.amount_out.toString(),
					args.token_in.toLowerCase(),
					args.token_out.toLowerCase(),
					args.destination.toLowerCase(),
					Number(block.timestamp)
				);
			})();

			// Create processed event
			const processedEvent: ProcessedSwapEvent = {
				tx_hash: log.transactionHash!,
				block_number: Number(log.blockNumber!),
				log_index: typeof log.logIndex !== "undefined" ? Number(log.logIndex) : 0,
				timestamp: Number(block.timestamp),
				sender: args.sender.toLowerCase(),
				amount_in: args.amount_in.toString(),
				amount_out: args.amount_out.toString(),
				token_in: args.token_in.toLowerCase(),
				token_out: args.token_out.toLowerCase(),
				destination: args.destination.toLowerCase(),
			};

			// Notify callbacks
			for (const callback of this.swapCallbacks) {
				try {
					await callback(processedEvent);
				} catch (error) {
					console.error("Error in swap callback:", error);
				}
			}

			console.log(
				`🔴 Live Swap: ${processedEvent.tx_hash.slice(0, 10)}... | Block ${processedEvent.block_number}`
			);
		} catch (error) {
			console.error("Error processing log:", error);
		}
	}

	/**
	 * Subscribe to swap events
	 */
	onSwap(callback: SwapCallback): () => void {
		this.swapCallbacks.push(callback);

		// Return unsubscribe function
		return () => {
			const index = this.swapCallbacks.indexOf(callback);
			if (index > -1) {
				this.swapCallbacks.splice(index, 1);
			}
		};
	}

	/**
	 * Hybrid mode: Initial batch scan + real-time watching
	 */
	async startHybridMode(): Promise<() => void> {
		console.log("\n🔄 Starting hybrid mode...");

		// 1. Initial batch scan
		console.log("📊 Step 1: Initial batch scan...");
		const { scanLogs, backfillFees, backfillSwapEvents, backfillTokenMetadata } =
			await import("./indexer");

		await scanLogs(this.db, this.config, true);
		await backfillFees(this.db, this.config);
		await backfillSwapEvents(this.db, this.config);
		await backfillTokenMetadata(this.db, this.config);

		console.log("✅ Initial scan complete");

		// 2. Start real-time watching
		console.log("📊 Step 2: Starting real-time watch...");
		await this.connect();

		const unwatch = await this.watchSwapEvents();

		console.log("✅ Hybrid mode active\n");

		// Return cleanup function
		return () => {
			if (unwatch) unwatch();
			this.disconnect();
		};
	}

	/**
	 * Disconnect WebSocket
	 */
	disconnect(): void {
		if (this.wsClient) {
			this.isConnected = false;
			console.log(`👋 WebSocket disconnected: ${this.config.name}`);
		}
	}

	/**
	 * Check if WebSocket is connected
	 */
	isWebSocketConnected(): boolean {
		return this.isConnected;
	}
}
