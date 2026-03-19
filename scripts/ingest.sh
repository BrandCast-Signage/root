#!/bin/bash
# root ingest — bulk-ingest project docs into the RAG database
#
# Usage: root ingest [project-dir]
#
# Reads root.config.json → ingest.include/exclude/extensions
# and ingests matching files using the mcp-local-rag CLI.

set -euo pipefail

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }
CONFIG="$TARGET/root.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: root.config.json not found in $TARGET"
  echo "Run /root:init first."
  exit 1
fi

# Detect agent context
if [[ -n "${GEMINI_CLI:-}" ]] || [[ "${0}" == *".gemini"* ]] || [[ "${0}" == *"gemini-extensions"* ]]; then
  AGENT_DIR=".gemini"
  RAG_BIN="${HOME}/.gemini/extensions/root/node_modules/.bin/mcp-local-rag"
  CLI_NAME="Gemini CLI"
else
  AGENT_DIR=".claude"
  RAG_BIN="${HOME}/.claude/plugins/data/root/node_modules/.bin/mcp-local-rag"
  CLI_NAME="Claude Code"
fi

DB_PATH="$TARGET/$AGENT_DIR/rag-db"
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"

if [[ ! -f "$RAG_BIN" ]]; then
  echo "ERROR: mcp-local-rag not installed. Restart $CLI_NAME to trigger auto-install."
  exit 1
fi

# Parse include directories from config
INCLUDE_DIRS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for d in config.get('ingest', {}).get('include', ['docs/']):
    print(d.rstrip('/'))
" 2>/dev/null)

echo "=== Root RAG Ingestion ==="
echo "Project: $TARGET"
echo ""

TOTAL=0
while IFS= read -r dir; do
  full_path="$TARGET/$dir"
  if [[ ! -d "$full_path" ]]; then
    echo "SKIP: $dir (not found)"
    continue
  fi

  echo "Ingesting $dir..."
  "$RAG_BIN" ingest --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" "$full_path" 2>&1
  echo ""
done <<< "$INCLUDE_DIRS"

echo "✓ Ingestion complete"
