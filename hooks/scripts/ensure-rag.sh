#!/bin/bash
# Ensure mcp-local-rag is installed and RAG database is populated.
# Runs on SessionStart.
# - First run: installs mcp-local-rag into plugin data dir
# - If DB is empty and root.config.json exists: auto-ingests

# Detect agent context
if [[ -n "${GEMINI_CLI:-}" ]] || [[ "${0}" == *".gemini"* ]] || [[ "${0}" == *"gemini-extensions"* ]]; then
  PLUGIN_DATA="${HOME}/.gemini/extensions/root"
  AGENT_DIR=".gemini"
  CLI_NAME="Gemini CLI"
else
  PLUGIN_DATA="${HOME}/.claude/plugins/data/root"
  AGENT_DIR=".claude"
  CLI_NAME="Claude Code"
fi

RAG_BIN="$PLUGIN_DATA/node_modules/.bin/mcp-local-rag"

# --- Install RAG if needed ---
if [[ ! -f "$PLUGIN_DATA/node_modules/mcp-local-rag/dist/index.js" ]]; then
  mkdir -p "$PLUGIN_DATA"
  cd "$PLUGIN_DATA"
  npm init -y --silent 2>/dev/null
  npm install mcp-local-rag --silent 2>&1

  if [[ -f "$PLUGIN_DATA/node_modules/mcp-local-rag/dist/index.js" ]]; then
    echo "Root: RAG MCP server installed. Restart $CLI_NAME to activate."
  else
    echo "Root: Failed to install mcp-local-rag. Run: cd $PLUGIN_DATA && npm install mcp-local-rag"
  fi
  exit 0
fi

# --- Auto-ingest if DB empty and config exists ---
if [[ -f "root.config.json" && -x "$RAG_BIN" ]]; then
  DB_PATH="$AGENT_DIR/rag-db"

  # Check if DB has documents (lancedb creates a directory)
  if [[ ! -d "$DB_PATH" ]] || [[ -z "$(ls -A "$DB_PATH" 2>/dev/null)" ]]; then
    echo "Root: RAG database empty. Auto-ingesting from root.config.json..."
    SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
    "$SCRIPT_DIR/scripts/ingest.sh" . 2>&1
  fi
fi
