import type Database from "better-sqlite3";

export function createTables(db: Database.Database) {
	db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      gas_used TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_block_number ON logs(block_number);
    CREATE INDEX IF NOT EXISTS idx_from_address ON logs(from_address);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);

    CREATE TABLE IF NOT EXISTS fees (
      tx_hash TEXT PRIMARY KEY,
      fee_wei TEXT NOT NULL,
      FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_fee_tx_hash ON fees(tx_hash);

    CREATE TABLE IF NOT EXISTS token_metadata (
      address TEXT PRIMARY KEY,
      decimals INTEGER NOT NULL,
      symbol TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_token_metadata_address ON token_metadata(address);
    
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

	// Migration logic for swap_events
	try {
		const cols = db.prepare("PRAGMA table_info(swap_events)").all() as Array<{ name: string }>;
		const tableExists = cols.length > 0;
		const hasLogIndex = cols.some((c) => c.name.toLowerCase() === "log_index");
		const hasId = cols.some((c) => c.name.toLowerCase() === "id");
		if (!tableExists) {
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
		} else if (!hasLogIndex || !hasId) {
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
			try {
				db.exec(`
                  INSERT INTO swap_events_v2 (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
                  SELECT tx_hash, 0 as log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp
                  FROM swap_events;
                `);
			} catch {}
			db.exec(`
              DROP TABLE IF EXISTS swap_events;
              ALTER TABLE swap_events_v2 RENAME TO swap_events;
            `);
		}
		db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_tx_log ON swap_events(tx_hash, log_index);
          CREATE INDEX IF NOT EXISTS idx_token_pair ON swap_events(token_in, token_out);
          CREATE INDEX IF NOT EXISTS idx_sender ON swap_events(sender);
        `);
	} catch {}
}
