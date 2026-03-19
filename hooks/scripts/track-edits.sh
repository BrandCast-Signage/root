#!/bin/bash
# PostToolUse hook: Track edited files and nudge test-sync
# Runs after Edit/Write completes successfully

# Read JSON input from stdin
INPUT=$(cat)

# Extract file path and tool name
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Track doc edits in CDD session state (before TS filter)
SESSION_FILE="/tmp/root-session.json"
if [[ "$FILE_PATH" == *docs/dev/app/*.md && -f "$SESSION_FILE" ]]; then
  REL_PATH=$(echo "$FILE_PATH" | sed 's|.*/docs/dev/app/|docs/dev/app/|')
  jq --arg p "$REL_PATH" '.docs_edited += [$p] | .docs_edited |= unique' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"
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

# Also update CDD session state
SESSION_FILE="/tmp/root-session.json"
if [[ -f "$SESSION_FILE" ]]; then
  jq --arg p "$FILE_PATH" '.files_edited += [$p] | .files_edited |= unique' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"
fi

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
