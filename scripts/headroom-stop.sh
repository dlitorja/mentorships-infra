#!/bin/bash
# Stop Headroom proxy
# Usage: ./scripts/headroom-stop.sh

PORT=8787

pkill -f "headroom proxy --port $PORT" 2>/dev/null && echo "Headroom proxy stopped" || echo "No proxy running on port $PORT"