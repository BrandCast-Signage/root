#!/bin/bash
# root ingest — bulk-ingest project docs into the RAG database
#
# Usage: root ingest [project-dir]
#
# Reads root.config.json → ingest.include and ingests each directory.
# Then runs cleanup-rag.sh to remove files matching exclude patterns
# or not matching allowed extensions (mcp-local-rag has no native
# filtering support).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }
CONFIG="$TARGET/root.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: root.config.json not found in $TARGET"
  echo "Run /root:init first."
  exit 1
fi

# Use shared database directory
DB_REL_PATH=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
DB_PATH="$TARGET/$DB_REL_PATH"
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"

# Execute using node and the local framework installation
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
RAG_CMD="node $RAG_BIN"

if [[ ! -f "$RAG_BIN" ]]; then
  echo "ERROR: mcp-local-rag not installed. Run ensure-rag.sh or restart your CLI."
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

while IFS= read -r dir; do
  full_path="$TARGET/$dir"
  if [[ ! -d "$full_path" ]]; then
    echo "SKIP: $dir (not found)"
    continue
  fi

  echo "Ingesting $dir..."
  $RAG_CMD --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest "$full_path" 2>&1
  echo ""
done <<< "$INCLUDE_DIRS"

echo "✓ Ingestion complete"
echo ""

# Post-ingestion cleanup: remove files matching exclude patterns
"$SCRIPT_DIR/cleanup-rag.sh" "$TARGET"
