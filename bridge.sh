#!/bin/bash
# Start the local Sitegeist bridge, or smoke-test an already-running one.
#
#   ./bridge.sh            build the CLI if needed, then run the bridge (foreground)
#   ./bridge.sh --check    ask the running bridge for the browser tab list; proves
#                          bridge + side panel are connected end to end
#
# The bridge listens on ws://127.0.0.1:17373 (localhost only). The side panel
# reconnects to it every 2 seconds, so start order does not matter.
set -e
cd "$(dirname "$0")/cli"

if [ ! -f dist/cli.js ] || [ cli.ts -nt dist/cli.js ] || [ bridge.ts -nt dist/cli.js ]; then
	echo "[bridge.sh] building CLI..."
	npm run build >/dev/null
fi

if [ "$1" = "--check" ]; then
	echo "[bridge.sh] querying tabs through the bridge..."
	exec node dist/cli.js tabs
fi

exec node dist/cli.js bridge "$@"
