#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/backend"
pip install -r requirements.txt
python3 main.py &

cd "$SCRIPT_DIR/frontend"
npm install
node server.js &
