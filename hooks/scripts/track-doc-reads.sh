#!/bin/bash
# SPDX-License-Identifier: MIT
# PostToolUse hook (Read): Track when living docs are read
#
# Doc read tracking is now handled by the board MCP server
# via per-stream state files at .root/board/<issue>.json.
# This hook is retained for the frontmatter check only.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only track .md files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

exit 0
