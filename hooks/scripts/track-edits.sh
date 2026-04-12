#!/bin/bash
# SPDX-License-Identifier: MIT
# PostToolUse hook: Track edited files and nudge test-sync
# Runs after Edit/Write completes successfully

# Read JSON input from stdin
INPUT=$(cat)

# Extract file path and tool name
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Doc edit tracking is handled by the board MCP server via per-stream state files.

# Frontmatter check for .md files in doc directories
if [[ "$FILE_PATH" == *.md && -f "root.config.json" ]]; then
  # Check if this file is in an ingest.docs directory
  IN_DOC_DIR=false
  while IFS= read -r inc_dir; do
    if [[ "$FILE_PATH" == *"$inc_dir"* ]]; then
      IN_DOC_DIR=true
      break
    fi
  done < <(python3 -c "import json; [print(d) for d in json.load(open('root.config.json')).get('ingest', {}).get('docs', [])]" 2>/dev/null)

  if [[ "$IN_DOC_DIR" == "true" && -f "$FILE_PATH" ]]; then
    FIRST_LINE=$(head -1 "$FILE_PATH")
    if [[ "$FIRST_LINE" != "---" ]]; then
      REL=$(echo "$FILE_PATH" | sed "s|$(pwd)/||")
      echo ""
      echo "⚠️  Missing frontmatter in $REL — run /root:docs fix $REL"
    else
      HAS_TITLE=$(head -10 "$FILE_PATH" | grep -c '^title:')
      HAS_STATUS=$(head -10 "$FILE_PATH" | grep -c '^status:')
      if [[ "$HAS_TITLE" -eq 0 || "$HAS_STATUS" -eq 0 ]]; then
        REL=$(echo "$FILE_PATH" | sed "s|$(pwd)/||")
        echo ""
        echo "⚠️  Incomplete frontmatter in $REL (missing title or status) — run /root:docs fix $REL"
      fi
    fi
  fi
fi

# Only track TypeScript source files (not tests, not config)
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Skip test files
if [[ "$FILE_PATH" =~ \.(test|spec)\.(ts|tsx)$ ]]; then
  exit 0
fi

# Skip config/type files
if [[ "$FILE_PATH" =~ (\.d\.ts|config\.ts|types\.ts)$ ]]; then
  exit 0
fi

# Track the edited file (legacy format for check-test-coverage.sh)
TRACK_FILE="/tmp/claude-session-edits.txt"
echo "$FILE_PATH" >> "$TRACK_FILE"

# File edit tracking is handled by the board MCP server via per-stream state files.

# Determine expected test file
dir=$(dirname "$FILE_PATH")
base=$(basename "$FILE_PATH" | sed 's/\.\(ts\|tsx\)$//')
rel_path=$(echo "$FILE_PATH" | sed "s|$(pwd)/||")

# Check if test file exists
TEST_EXISTS=false
for pattern in "${dir}/${base}.test.ts" "${dir}/${base}.test.tsx" "${dir}/__tests__/${base}.test.ts"; do
  if [[ -f "$pattern" ]]; then
    TEST_EXISTS=true
    break
  fi
done

# Output nudge
if [[ "$TEST_EXISTS" == "false" ]]; then
  echo ""
  echo "📝 Edited: $rel_path"
  echo "⚠️  No test file found. Run test-sync agent before commit."
else
  echo ""
  echo "📝 Edited: $rel_path"
  echo "🔄 Test file exists. Verify it covers your changes."
fi

exit 0
