#!/bin/bash
# SPDX-License-Identifier: MIT
# root ingest — bulk-ingest project docs into the RAG database
#
# Usage: root ingest [project-dir]
#
# Reads root.config.json → ingest.docs and ingests each directory.

set -euo pipefail

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }
CONFIG="$TARGET/root.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: root.config.json not found in $TARGET"
  echo "Run /root:init first."
  exit 1
fi

DB_REL_PATH=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
DB_PATH="$TARGET/$DB_REL_PATH"
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"

RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
RAG_CMD="node $RAG_BIN"

if [[ ! -f "$RAG_BIN" ]]; then
  echo "ERROR: mcp-local-rag not installed. Run ensure-rag.sh or restart your CLI."
  exit 1
fi

DOC_DIRS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for d in config.get('ingest', {}).get('docs', ['docs/']):
    print(d.rstrip('/'))
" 2>/dev/null)

echo "=== Root RAG Ingestion ==="
echo "Project: $TARGET"
echo ""

DOC_COUNT=0
while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  full_path="$TARGET/$dir"
  if [[ ! -d "$full_path" ]]; then
    echo "SKIP: $dir (not found)"
    continue
  fi

  echo "Ingesting: $dir/"
  $RAG_CMD --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest "$full_path" 2>&1
  DOC_COUNT=$((DOC_COUNT + 1))
  echo ""
done <<< "$DOC_DIRS"

echo "✓ Ingestion complete: $DOC_COUNT directories"
