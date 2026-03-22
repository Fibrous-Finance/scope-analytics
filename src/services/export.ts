import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { EnhancedMetrics } from "./server";

export type ExportFormat = "json" | "csv" | "md";

export function exportMetrics(
	metrics: EnhancedMetrics,
	filePath: string,
	format: ExportFormat
): void {
	switch (format) {
		case "json":
			exportToJson(metrics, filePath);
			break;
		case "csv":
			exportToCsv(metrics, filePath);
			break;
		case "md":
			exportToMarkdown(metrics, filePath);
			break;
	}
}

// Infer export format from file extension or explicit flag
export function inferFormat(filePath: string, explicitFormat?: string): ExportFormat {
	if (explicitFormat && ["json", "csv", "md"].includes(explicitFormat)) {
		return explicitFormat as ExportFormat;
	}
	const ext = extname(filePath).toLowerCase();
	if (ext === ".csv") return "csv";
	if (ext === ".md") return "md";
	return "json";
}

function exportToJson(metrics: EnhancedMetrics, filePath: string): void {
	ensureDir(dirname(filePath));
	writeFileSync(filePath, JSON.stringify(metrics, null, 2));
	console.log(`[Export] Exported JSON to ${filePath}`);
}

function exportToCsv(metrics: EnhancedMetrics, dirPath: string): void {
	// Remove extension if user passed a file — create a directory instead
	const dir = dirPath.replace(/\.[^/.]+$/, "");
	ensureDir(dir);

	// 1. Summary
	const summaryHeaders = [
		"uniqueActiveAddresses",
		"totalTransactions",
		"totalSwapEvents",
		"cumulativeNetworkFees",
		"averageTransactionFee",
		"cumulativeVolumeUsd",
	];
	const summaryRow = [
		metrics.uniqueActiveAddresses,
		metrics.totalTransactions,
		metrics.totalSwapEvents,
		metrics.cumulativeNetworkFees,
		metrics.averageTransactionFee,
		metrics.cumulativeVolumeUsd,
	];
	writeCsv(join(dir, "summary.csv"), summaryHeaders, [summaryRow]);

	// 2. Daily Metrics
	const dailyHeaders = [
		"date",
		"txCount",
		"uniqueActiveAddresses",
		"transactionsWithSwaps",
		"swapEventCount",
		"fees",
		"averageFeePerTx",
		"volumeUsd",
	];
	const dailyRows = metrics.historicalDailyMetrics.map((d) => [
		d.date,
		d.txCount,
		d.uniqueActiveAddresses,
		d.transactionsWithSwaps,
		d.swapEventCount,
		d.fees,
		d.averageFeePerTx,
		d.volumeUsd,
	]);
	writeCsv(join(dir, "daily_metrics.csv"), dailyHeaders, dailyRows);

	// 3. Token Volumes (combined in/out)
	const tokenHeaders = [
		"direction",
		"contractAddress",
		"rawAmount",
		"formattedAmount",
		"volumeUsd",
		"swapCount",
	];
	const tokenRows = [
		...metrics.tokenMetrics.liquidityIn.map((t) => [
			"in",
			t.contractAddress,
			t.rawAmount,
			t.formattedAmount,
			t.volumeUsd,
			t.swapCount,
		]),
		...metrics.tokenMetrics.liquidityOut.map((t) => [
			"out",
			t.contractAddress,
			t.rawAmount,
			t.formattedAmount,
			t.volumeUsd,
			t.swapCount,
		]),
	];
	writeCsv(join(dir, "token_volumes.csv"), tokenHeaders, tokenRows);

	// 4. Top Trading Pairs
	const pairHeaders = [
		"tokenInAddress",
		"tokenOutAddress",
		"swapCount",
		"volumeIn",
		"volumeOut",
		"totalVolumeUsd",
	];
	const pairRows = metrics.topTradingPairs.map((p) => [
		p.tokenInAddress,
		p.tokenOutAddress,
		p.swapCount,
		p.volumeIn,
		p.volumeOut,
		p.totalVolumeUsd,
	]);
	writeCsv(join(dir, "top_pairs.csv"), pairHeaders, pairRows);

	// 5. Top Addresses
	const addrHeaders = ["address", "txCount"];
	const addrRows = metrics.topInteractingAddresses.map((a) => [a.address, a.txCount]);
	writeCsv(join(dir, "top_addresses.csv"), addrHeaders, addrRows);

	console.log(`[Export] Exported CSV files to ${dir}/`);
}

function exportToMarkdown(metrics: EnhancedMetrics, filePath: string): void {
	ensureDir(dirname(filePath));

	const lines: string[] = [];
	const now = new Date().toISOString();

	lines.push(`# Scope Analytics Report`);
	lines.push(`> Generated: ${now}`);
	lines.push("");

	// Summary
	lines.push("## Summary");
	lines.push("");
	lines.push("| Metric | Value |");
	lines.push("|---|---|");
	lines.push(`| Unique Active Addresses | ${metrics.uniqueActiveAddresses.toLocaleString()} |`);
	lines.push(`| Total Transactions | ${metrics.totalTransactions.toLocaleString()} |`);
	lines.push(`| Total Swap Events | ${metrics.totalSwapEvents.toLocaleString()} |`);
	lines.push(`| Cumulative Fees | ${metrics.cumulativeNetworkFees} |`);
	lines.push(`| Average Fee/Tx | ${metrics.averageTransactionFee} |`);
	lines.push(`| Cumulative Volume | ${metrics.cumulativeVolumeUsd} |`);
	lines.push("");

	// Execution Quality
	lines.push("## Execution Quality");
	lines.push("");
	lines.push("| Metric | Value |");
	lines.push("|---|---|");
	lines.push(`| Average Slippage Margin | ${metrics.executionQuality.averageSlippageMargin} |`);
	lines.push(
		`| High Slippage Swaps | ${metrics.executionQuality.highSlippageSwaps.toLocaleString()} |`
	);
	lines.push(
		`| Standard Slippage Swaps | ${metrics.executionQuality.standardSlippageSwaps.toLocaleString()} |`
	);
	lines.push("");

	// Top Trading Pairs
	lines.push("## Top Trading Pairs");
	lines.push("");
	lines.push("| Token In | Token Out | Swaps | Volume In | Volume Out | Volume USD |");
	lines.push("|---|---|---|---|---|---|");
	for (const p of metrics.topTradingPairs.slice(0, 10)) {
		const inAddr = `${p.tokenInAddress.slice(0, 6)}...${p.tokenInAddress.slice(-4)}`;
		const outAddr = `${p.tokenOutAddress.slice(0, 6)}...${p.tokenOutAddress.slice(-4)}`;
		lines.push(
			`| ${inAddr} | ${outAddr} | ${p.swapCount.toLocaleString()} | ${p.volumeIn} | ${p.volumeOut} | ${p.totalVolumeUsd} |`
		);
	}
	lines.push("");

	// Top Liquidity In
	lines.push("## Top Liquidity Inflow");
	lines.push("");
	lines.push("| Token | Amount | Volume USD | Swaps |");
	lines.push("|---|---|---|---|");
	for (const t of metrics.tokenMetrics.liquidityIn.slice(0, 5)) {
		const addr = `${t.contractAddress.slice(0, 6)}...${t.contractAddress.slice(-4)}`;
		lines.push(
			`| ${addr} | ${t.formattedAmount} | ${t.volumeUsd} | ${t.swapCount.toLocaleString()} |`
		);
	}
	lines.push("");

	// Top Addresses
	lines.push("## Most Active Addresses");
	lines.push("");
	lines.push("| Address | Transactions |");
	lines.push("|---|---|");
	for (const a of metrics.topInteractingAddresses.slice(0, 10)) {
		lines.push(`| ${a.address} | ${a.txCount.toLocaleString()} |`);
	}
	lines.push("");

	// Daily Metrics (last 7 days)
	lines.push("## Daily Metrics (Last 7 Days)");
	lines.push("");
	lines.push("| Date | Transactions | Active Addresses | Swap Events | Volume USD |");
	lines.push("|---|---|---|---|---|");
	for (const d of metrics.historicalDailyMetrics.slice(0, 7)) {
		lines.push(
			`| ${d.date} | ${d.txCount.toLocaleString()} | ${d.uniqueActiveAddresses.toLocaleString()} | ${d.swapEventCount.toLocaleString()} | ${d.volumeUsd} |`
		);
	}
	lines.push("");

	// Block Range
	lines.push("## Data Range");
	lines.push("");
	lines.push(`- **Start Block:** ${metrics.range.startBlock?.toLocaleString() ?? "N/A"}`);
	lines.push(`- **End Block:** ${metrics.range.endBlock?.toLocaleString() ?? "N/A"}`);
	lines.push(`- **Last Updated:** ${metrics.range.lastUpdatedAt ?? "N/A"}`);
	lines.push("");

	writeFileSync(filePath, lines.join("\n"));
	console.log(`[Export] Exported Markdown report to ${filePath}`);
}

function ensureDir(dir: string): void {
	if (dir && !existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function escapeCsv(value: unknown): string {
	const str = String(value ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function writeCsv(filePath: string, headers: string[], rows: unknown[][]): void {
	const lines = [headers.join(",")];
	for (const row of rows) {
		lines.push(row.map(escapeCsv).join(","));
	}
	writeFileSync(filePath, lines.join("\n"));
}
