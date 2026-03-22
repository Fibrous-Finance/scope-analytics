import type Database from "better-sqlite3";
import { formatAmount } from "../utils/format";
import { getDecimalsAndSymbols, getPrices } from "./helpers";

export interface WalletProfile {
	address: string;
	totalTransactions: number;
	totalSwaps: number;
	firstSeen: string;
	lastSeen: string;
	totalFeesPaid: string;
	totalVolumeUsd: string;

	topPairs: Array<{
		tokenIn: string;
		tokenOut: string;
		symbolIn: string;
		symbolOut: string;
		swapCount: number;
		totalVolumeUsd: string;
	}>;

	tokensTraded: Array<{
		address: string;
		symbol: string;
		totalIn: string;
		totalOut: string;
		netFlow: string;
		swapCount: number;
	}>;

	dailyActivity: Array<{
		date: string;
		swapCount: number;
		volumeUsd: string;
	}>;

	averageSlippage: string;
	highSlippageCount: number;
}

export function getWalletProfile(
	db: Database.Database,
	address: string,
	config: { currency: { decimals: number; symbol: string } }
): WalletProfile | null {
	const addr = address.toLowerCase();
	const { decimalsMap, symbolMap } = getDecimalsAndSymbols(db);
	const priceMap = getPrices(db);

	// 1. Basic stats from logs
	const basicStats = db
		.prepare(
			`SELECT COUNT(DISTINCT tx_hash) as txCount,
			        MIN(timestamp) as firstSeen,
			        MAX(timestamp) as lastSeen
			 FROM logs WHERE from_address = ?`
		)
		.get(addr) as
		| { txCount: number; firstSeen: number | null; lastSeen: number | null }
		| undefined;

	if (!basicStats || basicStats.txCount === 0) {
		return null;
	}

	// 2. Total fees
	const feeRow = db
		.prepare(
			`SELECT SUM(CAST(f.fee_wei AS REAL)) as totalFees
			 FROM logs l JOIN fees f ON l.tx_hash = f.tx_hash
			 WHERE l.from_address = ?`
		)
		.get(addr) as { totalFees: number | null } | undefined;

	const totalFeesRaw = BigInt(Math.floor(feeRow?.totalFees ?? 0));
	const totalFeesPaid = `${formatAmount(totalFeesRaw, config.currency.decimals, 6)} ${config.currency.symbol}`;

	// 3. Total swaps
	const swapCountRow = db
		.prepare(`SELECT COUNT(*) as cnt FROM swap_events WHERE sender = ?`)
		.get(addr) as { cnt: number };

	// 4. Volume by token_in (for total volume USD)
	const volumeRows = db
		.prepare(
			`SELECT token_in, SUM(CAST(amount_in AS REAL)) as totalIn, COUNT(*) as cnt
			 FROM swap_events WHERE sender = ? GROUP BY token_in`
		)
		.all(addr) as Array<{ token_in: string; totalIn: number; cnt: number }>;

	let totalVolumeUsd = 0;
	let hasPrice = false;
	for (const r of volumeRows) {
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			totalVolumeUsd += (r.totalIn / 10 ** dec) * price;
			hasPrice = true;
		}
	}

	// 5. Top pairs
	const pairRows = db
		.prepare(
			`SELECT token_in, token_out, COUNT(*) as cnt,
			        SUM(CAST(amount_in AS REAL)) as volIn
			 FROM swap_events WHERE sender = ?
			 GROUP BY token_in, token_out ORDER BY cnt DESC LIMIT 5`
		)
		.all(addr) as Array<{ token_in: string; token_out: string; cnt: number; volIn: number }>;

	const topPairs = pairRows.map((r) => {
		const addrIn = r.token_in.toLowerCase();
		const dec = decimalsMap.get(addrIn) ?? 18;
		const price = priceMap.get(addrIn);
		return {
			tokenIn: r.token_in,
			tokenOut: r.token_out,
			symbolIn: symbolMap.get(addrIn) ?? "UNKNOWN",
			symbolOut: symbolMap.get(r.token_out.toLowerCase()) ?? "UNKNOWN",
			swapCount: r.cnt,
			totalVolumeUsd:
				price !== undefined ? `$${((r.volIn / 10 ** dec) * price).toFixed(2)}` : "N/A",
		};
	});

	// 6. Token net flow
	const inflowRows = db
		.prepare(
			`SELECT token_in AS token, SUM(CAST(amount_in AS REAL)) AS total, COUNT(*) AS cnt
			 FROM swap_events WHERE sender = ? GROUP BY token_in`
		)
		.all(addr) as Array<{ token: string; total: number; cnt: number }>;

	const outflowRows = db
		.prepare(
			`SELECT token_out AS token, SUM(CAST(amount_out AS REAL)) AS total, COUNT(*) AS cnt
			 FROM swap_events WHERE sender = ? GROUP BY token_out`
		)
		.all(addr) as Array<{ token: string; total: number; cnt: number }>;

	const inflowMap = new Map<string, { total: number; cnt: number }>();
	for (const r of inflowRows) {
		inflowMap.set(r.token.toLowerCase(), { total: r.total, cnt: r.cnt });
	}
	const outflowMap = new Map<string, { total: number; cnt: number }>();
	for (const r of outflowRows) {
		outflowMap.set(r.token.toLowerCase(), { total: r.total, cnt: r.cnt });
	}

	const allTokens = new Set([...inflowMap.keys(), ...outflowMap.keys()]);
	const tokensTraded = Array.from(allTokens).map((token) => {
		const dec = decimalsMap.get(token) ?? 18;
		const sym = symbolMap.get(token) ?? "UNKNOWN";
		const inData = inflowMap.get(token);
		const outData = outflowMap.get(token);
		const rawIn = BigInt(Math.floor(inData?.total ?? 0));
		const rawOut = BigInt(Math.floor(outData?.total ?? 0));

		// Net flow: positive = net received (bought), negative = net sent (sold)
		const netRaw = rawOut > rawIn ? rawOut - rawIn : -(rawIn - rawOut);
		const netPrefix = netRaw >= 0n ? "+" : "-";
		const netAbs = netRaw >= 0n ? netRaw : -netRaw;

		return {
			address: token,
			symbol: sym,
			totalIn: `${formatAmount(rawIn, dec, 2)} ${sym}`,
			totalOut: `${formatAmount(rawOut, dec, 2)} ${sym}`,
			netFlow: `${netPrefix}${formatAmount(netAbs, dec, 2)} ${sym}`,
			swapCount: (inData?.cnt ?? 0) + (outData?.cnt ?? 0),
		};
	});

	// Sort by swap count descending
	tokensTraded.sort((a, b) => b.swapCount - a.swapCount);

	// 7. Daily activity — use a clean count query, then enrich with volume
	const dailyCountRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day,
			        COUNT(*) as cnt
			 FROM swap_events WHERE sender = ?
			 GROUP BY day ORDER BY day DESC`
		)
		.all(addr) as Array<{ day: string; cnt: number }>;

	// Volume USD per day (grouped by token for accurate conversion)
	const dailyVolumeRows = db
		.prepare(
			`SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') as day,
			        SUM(CAST(amount_in AS REAL)) as totalIn,
			        token_in
			 FROM swap_events WHERE sender = ?
			 GROUP BY day, token_in`
		)
		.all(addr) as Array<{ day: string; totalIn: number; token_in: string }>;

	const dailyVolumeMap = new Map<string, number>();
	for (const r of dailyVolumeRows) {
		const dec = decimalsMap.get(r.token_in.toLowerCase()) ?? 18;
		const price = priceMap.get(r.token_in.toLowerCase());
		if (price !== undefined) {
			const usd = (r.totalIn / 10 ** dec) * price;
			dailyVolumeMap.set(r.day, (dailyVolumeMap.get(r.day) ?? 0) + usd);
		}
	}

	const dailyActivity = dailyCountRows.map((r) => ({
		date: r.day,
		swapCount: r.cnt,
		volumeUsd:
			(dailyVolumeMap.get(r.day) ?? 0) > 0
				? `$${(dailyVolumeMap.get(r.day) ?? 0).toFixed(2)}`
				: "N/A",
	}));

	// 8. Slippage stats
	const slippageRow = db
		.prepare(
			`SELECT AVG(execution_quality) as avgQuality,
			        SUM(CASE WHEN execution_quality < 0.5 THEN 1 ELSE 0 END) as riskyCount
			 FROM swap_events WHERE sender = ? AND execution_quality IS NOT NULL`
		)
		.get(addr) as { avgQuality: number | null; riskyCount: number } | undefined;

	return {
		address: addr,
		totalTransactions: basicStats.txCount,
		totalSwaps: swapCountRow.cnt,
		firstSeen: basicStats.firstSeen
			? new Date(basicStats.firstSeen * 1000).toISOString()
			: "N/A",
		lastSeen: basicStats.lastSeen ? new Date(basicStats.lastSeen * 1000).toISOString() : "N/A",
		totalFeesPaid,
		totalVolumeUsd: hasPrice ? `$${totalVolumeUsd.toFixed(2)}` : "N/A",
		topPairs,
		tokensTraded,
		dailyActivity,
		averageSlippage:
			slippageRow?.avgQuality != null
				? `${Number(slippageRow.avgQuality).toFixed(2)}%`
				: "N/A",
		highSlippageCount: Number(slippageRow?.riskyCount ?? 0),
	};
}
