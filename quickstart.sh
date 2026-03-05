#!/bin/bash
set -e

# Scope Analytics - Interactive Initialization Script

echo "[System] Initializing Scope Analytics setup sequence..."

# 1. Dependency Resolution
if [ ! -d "node_modules" ]; then
    echo "[Setup] Resolving and installing Node.js dependencies via pnpm..."
    pnpm install
else
    echo "[Setup] Dependencies verified. Skipping installation."
fi

# 2. Environment Configuration
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "[Config] Provisioning .env from .env.example template..."
        cp .env.example .env
    else
        echo "[Warning] Template .env.example missing. Provisioning default minimal configuration."
        cat > .env << EOF
CITREA_RPC_URL=https://rpc.mainnet.citrea.xyz
CITREA_CHAIN_ID=4114
CITREA_CONTRACT_ADDRESS=0x274602a953847d807231d2370072F5f4E4594B44
CITREA_DATABASE_FILE=citrea_cache.db
MONAD_DATABASE_FILE=monad_cache.db
BATCH_SIZE=1000
MAX_RETRIES=3
API_PORT=3000
API_HOST=localhost
EOF
    fi
else
    echo "[Config] Existing .env file detected. Skipping provisioning."
fi

# 3. Application Execution
echo "[System] Initialization sequence complete."
echo "Starting application..."
pnpm start
