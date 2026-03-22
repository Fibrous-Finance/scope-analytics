# Scope Analytics

Scope Analytics (Modular Edition) is an enterprise-grade, high-performance blockchain indexer and analytics engine constructed for precision, scalability, and seamless integration with EVM-compatible networks like Citrea and Monad.

## Features

### Core Architecture

- **Multi-Network Compatibility**: Native out-of-the-box configuration for Citrea and Monad, designed for rapid abstraction and extension to other EVM chains.
- **Hybrid Indexing Engine**: Fuses robust historical data backfilling with ultra-low latency real-time WebSocket event ingestion.
- **High-Concurrency Storage**: Utilizes SQLite in Write-Ahead Logging (WAL) mode tightly coupled with transaction-based storage strategies for maximum IO throughput.

### Data & Analytics

- **Dynamic Pricing Oracle**: Token metadata and fiat mappings via CoinGecko are managed dynamically within the database layer, abstracting away hardcoded constraints.
- **Comprehensive Volume Analysis**: Multi-token inbound and outbound liquidity tracking normalized to USD values.
- **Execution Quality Engine**: Advanced slippage analysis comparing user-intended limits against actual execution pricing metrics.
- **On-Chain User Profiling**: Precise tracking of unique active addresses, top interacting entities, and transaction frequency matrices.

## Quick Start

### Automated Setup (Recommended)

Run the automated setup script to install dependencies, configure environment, and launch:

```bash
./quickstart.sh
```

### Manual Setup

1. **Install Dependencies**

    ```bash
    pnpm install
    ```

2. **Configure Environment**

    ```bash
    cp .env.example .env
    # Add your RPC URLs for Citrea and Monad
    ```

3. **Launch**
    ```bash
    pnpm start
    ```
    _Follow the prompts to select your network and operation mode._

## API & Analytics

The integrated server provides advanced analytics via a RESTful API.

### Endpoints

| Endpoint                               | Description                                                |
| :------------------------------------- | :--------------------------------------------------------- |
| `GET /metrics`                         | Full aggregated metrics (volume, fees, pairs, daily stats) |
| `GET /metrics/daily?from=&to=`         | Daily time-series with optional date range filter          |
| `GET /metrics/token/:address`          | Token-specific volume, pairs, and daily chart              |
| `GET /metrics/pair/:tokenIn/:tokenOut` | Pair analytics, top traders, and daily stats               |
| `GET /metrics/wallet/:address`         | Wallet profile: volume, pairs, token flow, activity        |
| `GET /health`                          | System health, sync status, and uptime                     |

All endpoints return JSON with CORS headers (`Access-Control-Allow-Origin: *`).

### Response Example (`/metrics`)

```json
{
	"uniqueActiveAddresses": 948,
	"totalTransactions": 7738,
	"cumulativeNetworkFees": "0.003539 cBTC",
	"averageTransactionFee": "0.00000045 cBTC",
	"totalSwapEvents": 7730,
	"cumulativeVolumeUsd": "$2296902.45",
	"executionQuality": {
		"averageSlippageMargin": "1.75%",
		"highSlippageSwaps": 2717,
		"standardSlippageSwaps": 4769
	}
}
```

## Documentation

- [Configuration](docs/configuration.md) - Environment variables and platform settings.
- [Database](docs/database.md) - Schema design and Direct ID mapping.
- [Usage](docs/usage.md) - Advanced CLI commands and hybrid workflows.

## Command Reference

| Command           | Description                                  |
| :---------------- | :------------------------------------------- |
| `pnpm start`      | Interactive setup and launch.                |
| `pnpm hybrid`     | Full sync: Backfill + Realtime + API Server. |
| `pnpm realtime`   | WebSocket only (no historical scan).         |
| `pnpm serve`      | API server with polling (incremental mode).  |
| `pnpm export`     | Export metrics as JSON.                      |
| `pnpm export:csv` | Export metrics as CSV (directory of files).  |
| `pnpm export:md`  | Export metrics as a Markdown report.         |
| `pnpm db:check`   | Integrity check and storage statistics.      |
