#!/bin/bash
# SPDX-License-Identifier: MIT
# Ensure RAG database is populated on SessionStart.
# - First run: installs mcp-local-rag into a unified framework directory
# - If DB is empty and root.config.json exists: auto-ingests

# Capture script directory before any cd operations
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Unified installation directory
INSTALL_DIR="${HOME}/.root-framework/mcp"
RAG_BIN="$INSTALL_DIR/node_modules/mcp-local-rag/dist/index.js"

# --- Install RAG if needed ---
if [[ ! -f "$RAG_BIN" ]]; then
  echo "Root: Installing RAG MCP server (this may take a few minutes for native bindings)..."
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR" || exit 1
  npm init -y --silent 2>/dev/null
  npm install mcp-local-rag --silent 2>&1
  
  if [[ ! -f "$RAG_BIN" ]]; then
    echo "Root: Failed to install mcp-local-rag. Try running manually: cd $INSTALL_DIR && npm install mcp-local-rag"
    exit 0
  fi
  echo "Root: RAG MCP server installed successfully."
fi

# If config exists, check if we need to auto-ingest
if [[ -f "$SCRIPT_DIR/root.config.json" ]]; then
  DB_REL_PATH=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
  DB_PATH="$SCRIPT_DIR/$DB_REL_PATH"

  # Check if DB has documents (lancedb creates a directory)
  if [[ ! -d "$DB_PATH" ]] || [[ -z "$(ls -A "$DB_PATH" 2>/dev/null)" ]]; then
    echo "Root: RAG database empty. Auto-ingesting from root.config.json..."
    "$SCRIPT_DIR/scripts/ingest.sh" "$SCRIPT_DIR" 2>&1
  fi
fi
