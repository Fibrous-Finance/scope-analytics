export function formatWeiToCbtc(wei: bigint, fractionDigits = 6): string {
	const base = 10n ** 18n;
	const integer = wei / base;
	const fraction = wei % base;
	const fracStr = fraction.toString().padStart(18, "0").slice(0, fractionDigits);
	return `${integer.toString()}.${fracStr}`;
}

export function sanitizeDecimals(dec: number | bigint): number {
	const n = Number(dec);
	if (!Number.isFinite(n) || n <= 0 || n > 36) return 18;
	return n;
}

export function formatAmount(amount: bigint, decimals: number, fractionDigits = 6): string {
	const base = 10n ** BigInt(decimals);
	const integer = amount / base;
	const fraction = amount % base;
	const fracStr = fraction.toString().padStart(decimals, "0").slice(0, fractionDigits);
	return `${integer.toString()}.${fracStr}`;
}
