#!/bin/bash
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

SERVER=slayer.marioslab.io
SERVER_DIR=/home/badlogic/sitegeist.ai
COMMAND="$1"
shift || true

BRAND=sitegeist
while [[ $# -gt 0 ]]; do
    case "$1" in
    --brand)
        if [[ -z "$2" || "$2" == -* ]]; then
            echo "Missing brand name after --brand"
            exit 1
        fi
        BRAND="$2"
        shift 2
        ;;
    *)
        echo "Unknown option: $1"
        exit 1
        ;;
    esac
done

case "$COMMAND" in
dev)
    echo "Starting dev server at http://localhost:8080 for brand $BRAND"
    SITE_BRAND="$BRAND" npx vite --config infra/vite.config.ts
    ;;

build)
    echo "Building static site for brand $BRAND..."
    SITE_BRAND="$BRAND" npx vite build --config infra/vite.config.ts
    echo "Done. Output in dist/"
    ;;

deploy)
    npm install
    SITE_BRAND="$BRAND" npx vite build --config infra/vite.config.ts

    echo "Uploading to $SERVER..."
    ssh $SERVER "mkdir -p $SERVER_DIR/uploads"
    rsync -avz --delete dist/ $SERVER:$SERVER_DIR/dist/
    echo "Deployed."
    ;;

*)
    echo "Usage: $0 {dev|build|deploy} [--brand name]"
    exit 1
    ;;
esac
