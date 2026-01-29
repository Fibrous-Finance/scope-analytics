# Usage Guide

## Interactive Mode (Recommended)

Simply run the start command and follow the prompts.

```bash
pnpm start
```

## Advanced CLI Flags

| Flag               | Description                                        |
| :----------------- | :------------------------------------------------- |
| `--network [name]` | Force network (`citrea` or `monad`).               |
| `--incremental`    | Only scan blocks since the last run.               |
| `--realtime`       | Listen for live events (WebSocket). No backfill.   |
| `--hybrid`         | Backfill missing history, then switch to Realtime. |
| `--serve`          | Start the API server on port 3000.                 |

## Common Workflows

**1. Reliable Node (Hybrid + Server)**
Perfect for production. Fills gaps on restart, then stays live.

```bash
pnpm start -- --network citrea --hybrid --serve
```

**2. Quick Analysis (Export)**
Dump current metrics to a file without starting a server.

```bash
pnpm export -- --network monad
```

**3. Development (Reset)**
Clear database and start fresh.

```bash
pnpm db:reset && pnpm start
```

## API Usage

Fetch metrics via HTTP:

```bash
curl http://localhost:3000/metrics
```
