#!/bin/bash
# PostToolUse hook (Read): Track when living docs are read
#
# Records doc reads in the CDD session state file.
# Silent (no stdout output). Advisory only (exit 0).

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only track docs/dev/app/ reads
if [[ "$FILE_PATH" != *docs/dev/app/* ]]; then
  exit 0
fi

# Only track .md files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

SESSION_FILE="/tmp/root-session.json"

if [[ ! -f "$SESSION_FILE" ]]; then
  exit 0
fi

# Extract relative path (strip repo root prefix)
REL_PATH=$(echo "$FILE_PATH" | sed 's|.*/docs/dev/app/|docs/dev/app/|')

# Append to docs_read in session state
jq --arg p "$REL_PATH" '.docs_read += [$p] | .docs_read |= unique' "$SESSION_FILE" > "${SESSION_FILE}.tmp" && mv "${SESSION_FILE}.tmp" "$SESSION_FILE"

exit 0
