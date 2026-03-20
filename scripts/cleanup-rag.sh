#!/bin/bash
# root cleanup-rag — remove excluded files from the RAG database
#
# Usage: cleanup-rag [project-dir]
#
# Reads root.config.json → ingest.exclude and ingest.extensions,
# queries the DB for all ingested file paths, and deletes any that
# match exclude patterns or don't match allowed extensions.
#
# This exists because mcp-local-rag has no native filtering support
# during ingestion (no --exclude or --extensions flags).

set -euo pipefail

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }
CONFIG="$TARGET/root.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: root.config.json not found in $TARGET"
  exit 1
fi

DB_REL_PATH=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
DB_PATH="$TARGET/$DB_REL_PATH"
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"

RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
RAG_CMD="node $RAG_BIN"
LANCEDB_MOD="${HOME}/.root-framework/mcp/node_modules/@lancedb/lancedb"

if [[ ! -f "$RAG_BIN" ]]; then
  echo "ERROR: mcp-local-rag not installed."
  exit 1
fi

# Step 1: Get all unique file paths from the DB
INGESTED_FILES=$(node -e "
const lancedb = require('$LANCEDB_MOD');
(async () => {
  const db = await lancedb.connect('$DB_PATH');
  const tables = await db.tableNames();
  if (!tables.includes('chunks')) { process.exit(0); }
  const table = await db.openTable('chunks');
  const rows = await table.query().select(['filePath']).toArray();
  const unique = [...new Set(rows.map(r => r.filePath))];
  unique.forEach(f => console.log(f));
})();
" 2>/dev/null)

if [[ -z "$INGESTED_FILES" ]]; then
  echo "No files in RAG database."
  exit 0
fi

TOTAL_INGESTED=$(echo "$INGESTED_FILES" | wc -l | tr -d ' ')

# Step 2: Determine which files should be removed
TO_DELETE=$(python3 -c "
import json, fnmatch, os, sys

config = json.load(open('$CONFIG'))
exclude = config.get('ingest', {}).get('exclude', [])
extensions = config.get('ingest', {}).get('extensions', [])
target = '$TARGET'

for line in sys.stdin:
    fpath = line.strip()
    if not fpath:
        continue
    rel = os.path.relpath(fpath, target)

    # Check exclude patterns
    should_delete = False
    for pat in exclude:
        # Direct match on relative path
        if fnmatch.fnmatch(rel, pat):
            should_delete = True
            break
        # Component match: check if any path segment matches
        # e.g. **/node_modules/** should match any path containing node_modules
        bare = pat.replace('**/', '').replace('/**', '')
        if '/' not in bare and bare in rel.split('/'):
            should_delete = True
            break

    # Check extensions whitelist
    if not should_delete and extensions:
        _, ext = os.path.splitext(fpath)
        if ext not in extensions:
            should_delete = True

    if should_delete:
        print(fpath)
" <<< "$INGESTED_FILES")

if [[ -z "$TO_DELETE" ]]; then
  echo "All $TOTAL_INGESTED files pass exclude/extension filters. Nothing to clean up."
  exit 0
fi

DELETE_COUNT=$(echo "$TO_DELETE" | wc -l | tr -d ' ')
echo "Found $DELETE_COUNT / $TOTAL_INGESTED files to remove..."

REMOVED=0
while IFS= read -r filepath; do
  $RAG_CMD --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" delete "$filepath" 2>/dev/null && REMOVED=$((REMOVED + 1))
done <<< "$TO_DELETE"

echo "✓ Removed $REMOVED files from RAG database"
