#!/bin/bash
# root ingest — bulk-ingest project docs into the RAG MCP server
#
# Usage: root ingest [project-dir]
#
# Reads root.config.json → ingest.include/exclude/extensions
# and ingests matching files into the RAG database.

set -euo pipefail

TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }
CONFIG="$TARGET/root.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: root.config.json not found in $TARGET"
  echo "Run 'root init' first."
  exit 1
fi

echo "=== Root RAG Ingestion ==="
echo "Project: $TARGET"
echo ""

# Parse config with python3 (available on macOS and most Linux)
INCLUDE_DIRS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for d in config.get('ingest', {}).get('include', ['docs/']):
    print(d.rstrip('/'))
" 2>/dev/null)

EXCLUDE_PATTERNS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for p in config.get('ingest', {}).get('exclude', ['**/node_modules/**']):
    print(p)
" 2>/dev/null)

EXTENSIONS=$(python3 -c "
import json
config = json.load(open('$CONFIG'))
for e in config.get('ingest', {}).get('extensions', ['.md']):
    print(e)
" 2>/dev/null)

# Build find exclude args
EXCLUDE_ARGS=""
while IFS= read -r pattern; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS -not -path '$pattern'"
done <<< "$EXCLUDE_PATTERNS"

# Build extension args
EXT_ARGS=""
FIRST=true
while IFS= read -r ext; do
  if [[ "$FIRST" == "true" ]]; then
    EXT_ARGS="-name '*$ext'"
    FIRST=false
  else
    EXT_ARGS="$EXT_ARGS -o -name '*$ext'"
  fi
done <<< "$EXTENSIONS"

TOTAL=0
FILE_LIST=""

while IFS= read -r dir; do
  full_path="$TARGET/$dir"
  if [[ ! -d "$full_path" ]]; then
    echo "SKIP: $dir (not found)"
    continue
  fi

  files=$(eval "find '$full_path' \\( $EXT_ARGS \\) $EXCLUDE_ARGS" 2>/dev/null | sort)
  count=$(echo "$files" | grep -c . 2>/dev/null || echo 0)
  echo "  $dir: $count files"
  TOTAL=$((TOTAL + count))
  FILE_LIST="$FILE_LIST
$files"
done <<< "$INCLUDE_DIRS"

# Top-level files
top_files=$(eval "find '$TARGET' -maxdepth 1 \\( $EXT_ARGS \\)" 2>/dev/null | sort)
top_count=$(echo "$top_files" | grep -c . 2>/dev/null || echo 0)
if [[ "$top_count" -gt 0 ]]; then
  echo "  (root): $top_count files"
  TOTAL=$((TOTAL + top_count))
  FILE_LIST="$FILE_LIST
$top_files"
fi

echo ""
echo "Total: $TOTAL files to ingest"
echo ""

if [[ "$TOTAL" -eq 0 ]]; then
  echo "No files found. Check root.config.json → ingest settings."
  exit 0
fi

echo "Files to ingest:"
echo "$FILE_LIST" | grep -v '^$' | while read -r f; do
  echo "  $f"
done

echo ""
echo "To ingest, ask Claude Code:"
echo '  "ingest all the files listed above into the RAG server"'
echo ""
echo "Or use the CLI:"
echo "  npx mcp-local-rag ingest <path>"
