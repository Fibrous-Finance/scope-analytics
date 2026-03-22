import type Database from "better-sqlite3";

export function getDecimalsAndSymbols(db: Database.Database) {
	const rows = db.prepare("SELECT address, decimals, symbol FROM token_metadata").all() as Array<{
		address: string;
		decimals: number;
		symbol: string;
	}>;
	const decimalsMap = new Map<string, number>();
	const symbolMap = new Map<string, string>();
	for (const r of rows) {
		const addr = r.address.toLowerCase();
		decimalsMap.set(addr, r.decimals);
		symbolMap.set(addr, r.symbol);
	}
	return { decimalsMap, symbolMap };
}

export function getPrices(db: Database.Database) {
	const rows = db.prepare("SELECT address, price_usd FROM token_prices").all() as Array<{
		address: string;
		price_usd: number;
	}>;
	const priceMap = new Map<string, number>();
	for (const r of rows) {
		priceMap.set(r.address.toLowerCase(), r.price_usd);
	}
	return priceMap;
}
