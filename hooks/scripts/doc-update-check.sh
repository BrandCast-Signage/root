#!/bin/bash
# SPDX-License-Identifier: MIT
# Stop hook: Warn if Tier 1 work didn't update living docs
#
# Reads session state. If tier=tier1 and source files were edited
# but no living docs were updated, outputs a reminder.
# Advisory only (exit 0).

SESSION_FILE="/tmp/root-session.json"

if [[ ! -f "$SESSION_FILE" ]]; then
  exit 0
fi

# Check session age (skip if > 4 hours old)
STARTED=$(jq -r '.started // empty' "$SESSION_FILE")
if [[ -n "$STARTED" ]]; then
  START_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE=$(( NOW_EPOCH - START_EPOCH ))
  if [[ "$AGE" -gt 14400 ]]; then
    exit 0
  fi
fi

TIER=$(jq -r '.tier // "unknown"' "$SESSION_FILE")

# Only check Tier 1 work
if [[ "$TIER" != "tier1" ]]; then
  exit 0
fi

# Check if meaningful source files were edited
FILES_EDITED=$(jq -r '.files_edited // [] | length' "$SESSION_FILE")
if [[ "$FILES_EDITED" -eq 0 ]]; then
  exit 0
fi

# Check if any source files are in significant locations
HAS_SIGNIFICANT=$(jq -r '
  .files_edited // [] |
  map(select(
    test("apps/backend/src/services/") or
    test("apps/backend/src/routes/") or
    test("packages/.*/src/") or
    test("apps/backend/src/middleware/")
  )) | length
' "$SESSION_FILE")

if [[ "$HAS_SIGNIFICANT" -eq 0 ]]; then
  exit 0
fi

# Check if any docs were updated
DOCS_EDITED=$(jq -r '.docs_edited // [] | length' "$SESSION_FILE")
if [[ "$DOCS_EDITED" -gt 0 ]]; then
  exit 0
fi

# Cross-reference: suggest docs that were read this session
DOCS_READ=$(jq -r '.docs_read // [] | map(gsub("docs/dev/app/"; "") | gsub("\\.md$"; "")) | join(", ")' "$SESSION_FILE")

echo ""
echo "┌─ Doc Update Reminder ──────────────────────────────────────┐"
echo "│ Tier 1 work modified backend services but no living docs   │"
echo "│ were updated.                                              │"
if [[ -n "$DOCS_READ" && "$DOCS_READ" != "" ]]; then
echo "│ You read: $DOCS_READ"
echo "│ Consider updating if behavior changed.                     │"
fi
echo "│                                                            │"
echo "│ Skip if changes don't affect documented behavior.          │"
echo "└────────────────────────────────────────────────────────────┘"

exit 0
