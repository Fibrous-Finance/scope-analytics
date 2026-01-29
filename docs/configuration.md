# Configuration

Environment variable reference for `.env`.

## Network Settings

| Variable                  | Description                                            |
| :------------------------ | :----------------------------------------------------- |
| `CITREA_RPC_URL`          | Polling RPC endpoint for Citrea.                       |
| `CITREA_WS_RPC_URL`       | WebSocket endpoint for Citrea (Required for Realtime). |
| `CITREA_CHAIN_ID`         | Chain ID for Citrea (Default: `4114`).                 |
| `MONAD_RPC_URL`           | Polling RPC endpoint for Monad.                        |
| `MONAD_WS_RPC_URL`        | WebSocket endpoint for Monad (Required for Realtime).  |
| `MONAD_CHAIN_ID`          | Chain ID for Monad (Default: `143`).                   |
| `CITREA_CONTRACT_ADDRESS` | Contract address to index on Citrea.                   |
| `MONAD_CONTRACT_ADDRESS`  | Contract address to index on Monad.                    |

## Application Settings

| Variable               | Description                                       | Default           |
| :--------------------- | :------------------------------------------------ | :---------------- |
| `BATCH_SIZE`           | Blocks per batch scan. Lower if RPC errors occur. | `1000`            |
| `MAX_RETRIES`          | Retry attempts for failed RPC calls.              | `3`               |
| `CITREA_DATABASE_FILE` | Database file for Citrea.                         | `citrea_cache.db` |
| `MONAD_DATABASE_FILE`  | Database file for Monad.                          | `monad_cache.db`  |
| `API_PORT`             | Port for the metrics API server.                  | `3000`            |
| `API_HOST`             | Host binding for API server.                      | `localhost`       |

## CLI Overrides

CLI flags override environment variables:

```bash
# Override contract address
pnpm start -- --address 0x123...

# Force specific network
pnpm start -- --network citrea

# Enable Realtime Mode
pnpm realtime
```
