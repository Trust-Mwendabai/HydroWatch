#!/usr/bin/env bash
# Start HydroWatch Global and open it in the browser.
# Uses port 8000, or the next free port if 8000 is taken.
cd "$(dirname "$0")"
exec python3 server.py --port "${1:-8000}" --open
