import type Database from "better-sqlite3";

/**
 * Shared storage service to handle database insertions
 * This ensures consistency between polling (indexer) and websocket (realtime) services
 */

export interface LogData {
	tx_hash: string;
	block_number: number;
	from_address: string;
	gas_used: string;
	timestamp: number;
}

export interface FeeData {
	tx_hash: string;
	fee_wei: string;
}

export interface SwapData {
	tx_hash: string;
	log_index: number;
	block_number: number;
	sender: string;
	amount_in: string;
	amount_out: string;
	token_in: string;
	token_out: string;
	destination: string;
	timestamp: number;
}

export function insertLog(db: Database.Database, data: LogData) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
	stmt.run(data.tx_hash, data.block_number, data.from_address, data.gas_used, data.timestamp);
}

export function insertFee(db: Database.Database, data: FeeData) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
    VALUES (?, ?)
  `);
	stmt.run(data.tx_hash, data.fee_wei);
}

export function insertSwap(db: Database.Database, data: SwapData) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO swap_events 
    (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
	stmt.run(
		data.tx_hash,
		data.log_index,
		data.block_number,
		data.sender,
		data.amount_in,
		data.amount_out,
		data.token_in,
		data.token_out,
		data.destination,
		data.timestamp
	);
}

export function batchInsertLogs(db: Database.Database, logs: LogData[]) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO logs (tx_hash, block_number, from_address, gas_used, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

	const insertMany = db.transaction((items: LogData[]) => {
		for (const item of items) {
			stmt.run(
				item.tx_hash,
				item.block_number,
				item.from_address,
				item.gas_used,
				item.timestamp
			);
		}
	});

	insertMany(logs);
}

export function batchInsertFees(db: Database.Database, fees: FeeData[]) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO fees (tx_hash, fee_wei)
    VALUES (?, ?)
  `);

	const insertMany = db.transaction((items: FeeData[]) => {
		for (const item of items) {
			stmt.run(item.tx_hash, item.fee_wei);
		}
	});

	insertMany(fees);
}

export function batchInsertSwaps(db: Database.Database, swaps: SwapData[]) {
	const stmt = db.prepare(`
    INSERT OR IGNORE INTO swap_events 
    (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

	const insertMany = db.transaction((items: SwapData[]) => {
		for (const item of items) {
			stmt.run(
				item.tx_hash,
				item.log_index,
				item.block_number,
				item.sender,
				item.amount_in,
				item.amount_out,
				item.token_in,
				item.token_out,
				item.destination,
				item.timestamp
			);
		}
	});

	insertMany(swaps);
}
