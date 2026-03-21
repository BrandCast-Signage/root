#!/bin/bash
# SPDX-License-Identifier: MIT
# root ingest — bulk-ingest project content into the RAG database
#
# Usage: root ingest [project-dir]
#
# Reads root.config.json → ingest.docs (full directories) and
# ingest.sources (specific file patterns) and ingests them.

set -euo pipefail

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

echo "=== Root RAG Ingestion ==="
echo "Project: $TARGET"
echo ""

# Ingest doc directories (everything in each directory)
DOC_DIRS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for d in config.get('ingest', {}).get('docs', []):
    print(d.rstrip('/'))
" 2>/dev/null)

DOC_COUNT=0
while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  full_path="$TARGET/$dir"
  if [[ ! -d "$full_path" ]]; then
    echo "SKIP: $dir (not found)"
    continue
  fi

  echo "Ingesting docs: $dir/"
  $RAG_CMD --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest "$full_path" 2>&1
  DOC_COUNT=$((DOC_COUNT + 1))
  echo ""
done <<< "$DOC_DIRS"

# Ingest source file patterns (specific files only)
SOURCE_PATTERNS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for p in config.get('ingest', {}).get('sources', []):
    print(p)
" 2>/dev/null)

SRC_COUNT=0
while IFS= read -r pattern; do
  [[ -z "$pattern" ]] && continue
  # Expand glob pattern relative to project root
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if [[ -f "$file" ]]; then
      echo "Ingesting source: ${file#$TARGET/}"
      $RAG_CMD --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest "$file" 2>&1
      SRC_COUNT=$((SRC_COUNT + 1))
    fi
  done < <(cd "$TARGET" && find . -path "./$pattern" -type f 2>/dev/null | sed "s|^\\.|$TARGET|")
done <<< "$SOURCE_PATTERNS"

echo ""
echo "✓ Ingestion complete: $DOC_COUNT doc directories + $SRC_COUNT source files"
