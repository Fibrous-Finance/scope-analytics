# Database Schema

The project uses SQLite with WAL mode. A separate database file is created for each network (e.g., `citrea_cache.db`).

## Core Tables

### `logs`

Raw transaction logs.

- `tx_hash` (PK): Transaction hash.
- `block_number`: Block where the event occurred.
- `timestamp`: Block timestamp.
- `from_address`: Sender address.

### `swap_events`

Parsed Swap events. Supports multiple swaps per transaction.

- `id`: Auto-incrementing ID.
- `tx_hash` (FK): Links to `logs`.
- `sender`: User initiating the swap.
- `token_in` / `token_out`: Token contract addresses.
- `amount_in` / `amount_out`: Raw amounts (wei).
- `amount_out_min`: User's minimum received limit (from calldata).
- `execution_quality`: Safety margin percentage (Slippage Analysis).

### `fees`

Transaction fee data.

- `tx_hash` (PK): Transaction hash.
- `fee_wei`: Total fee paid (Gas Used \* Gas Price).

## Useful SQL Queries

**Top 5 Token Pairs by Volume**

```sql
SELECT token_in, token_out, COUNT(*) as count
FROM swap_events
GROUP BY token_in, token_out
ORDER BY count DESC
LIMIT 5;
```

**Daily Transaction Count**

```sql
SELECT date(timestamp, 'unixepoch') as day, COUNT(*)
FROM logs
GROUP BY day
ORDER BY day DESC;
```

**Database Maintenance**

```bash
# Check database size and stats
pnpm db:check

# Delete all data for all networks
pnpm db:reset
```
