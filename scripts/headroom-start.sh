#!/bin/bash
# Start Headroom proxy for this project
# Usage: ./scripts/headroom-start.sh

HEADROOM_BIN="/tmp/headroom-env/bin/headroom"
PORT=8787

if ! command -v curl &> /dev/null; then
    echo "Error: curl is required to check proxy status"
    exit 1
fi

# Check if already running
if curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "Headroom proxy already running at http://127.0.0.1:$PORT"
    exit 0
fi

echo "Starting Headroom proxy on port $PORT..."
echo "Press Ctrl+C to stop."

# Ensure log directory exists
mkdir -p ~/.headroom

# Run proxy in background with nohup
nohup $HEADROOM_BIN proxy --port $PORT > ~/.headroom/proxy.log 2>&1 &

# Wait for proxy to be ready
for i in {1..10}; do
    if curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
        echo "Headroom proxy started successfully at http://127.0.0.1:$PORT"
        echo "Stats: curl http://127.0.0.1:$PORT/stats"
        exit 0
    fi
    sleep 1
done

echo "Failed to start proxy. Check logs at ~/.headroom/proxy.log"
exit 1