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
# Start hybrid indexing AND the API server
pnpm hybrid --serve
```

**2. Realtime Only**
Skip backfill and listen for new events immediately.

```bash
pnpm realtime
```

**3. Database Health Check**
View statistics and record counts.

```bash
pnpm db:check
```

**4. Development (Reset)**
Clear database and start fresh.

```bash
pnpm db:reset && pnpm start
```

## API Usage

Fetch metrics via HTTP:

```bash
curl http://localhost:3000/metrics
```
