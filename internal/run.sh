#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "Creating .env from .env.example — edit it with your Reddit API credentials."
    cp .env.example .env
fi

if [ ! -d .venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

echo "Installing dependencies..."
.venv/bin/pip install -q -r backend/requirements.txt

echo ""
echo "Starting VBOG Reddit Monitor on http://localhost:8000"
echo "Dashboard: http://localhost:8000"
echo ""

cd backend
../.venv/bin/python main.py
