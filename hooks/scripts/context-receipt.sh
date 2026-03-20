#!/bin/bash
# SPDX-License-Identifier: MIT
# Stop hook: Output a context receipt summarizing the session
#
# Reads the CDD session state and outputs a summary of what
# context was consumed and produced. Advisory only (exit 0).

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

# Count various categories
DOCS_READ_COUNT=$(jq '.docs_read // [] | length' "$SESSION_FILE")
DOCS_SUGGESTED_COUNT=$(jq '.docs_suggested // [] | length' "$SESSION_FILE")
FILES_EDITED_COUNT=$(jq '.files_edited // [] | length' "$SESSION_FILE")
DOCS_EDITED_COUNT=$(jq '.docs_edited // [] | length' "$SESSION_FILE")

# Skip receipt if nothing happened
TOTAL=$(( DOCS_READ_COUNT + FILES_EDITED_COUNT + DOCS_EDITED_COUNT ))
if [[ "$TOTAL" -eq 0 ]]; then
  exit 0
fi

# Format tier label
case "$TIER" in
  tier1) TIER_LABEL="1 (Full Process)" ;;
  tier2) TIER_LABEL="2 (Light Process)" ;;
  *)     TIER_LABEL="unclassified" ;;
esac

# Format doc names (strip path prefix and .md)
DOCS_READ_NAMES=$(jq -r '.docs_read // [] | map(gsub("docs/dev/app/"; "") | gsub("\\.md$"; "")) | join(", ")' "$SESSION_FILE")
DOCS_EDITED_NAMES=$(jq -r '.docs_edited // [] | map(gsub(".*/"; "") | gsub("\\.md$"; "")) | join(", ")' "$SESSION_FILE")

# Count source vs test files
SOURCE_COUNT=$(jq '[.files_edited // [] | .[] | select(test("\\.(test|spec)\\.(ts|tsx)$") | not)] | length' "$SESSION_FILE")
TEST_COUNT=$(jq '[.files_edited // [] | .[] | select(test("\\.(test|spec)\\.(ts|tsx)$"))] | length' "$SESSION_FILE")

# Issue context
ISSUE_NUM=$(jq -r '.issue.number // empty' "$SESSION_FILE")
ISSUE_TITLE=$(jq -r '.issue.title // empty' "$SESSION_FILE")

# Build context delta
DELTA=""
if [[ "$DOCS_EDITED_COUNT" -gt 0 ]]; then
  DELTA="+${DOCS_EDITED_COUNT} doc(s) updated"
else
  DELTA="no docs updated"
fi

# --- Output receipt ---
echo ""
echo "┌─ Context Receipt ──────────────────────────────────────────┐"
echo "│ Tier: $TIER_LABEL"
if [[ -n "$ISSUE_NUM" ]]; then
echo "│ Issue: #${ISSUE_NUM} — ${ISSUE_TITLE}"
fi
if [[ -n "$DOCS_READ_NAMES" ]]; then
echo "│ Docs loaded:  $DOCS_READ_NAMES"
fi
if [[ "$FILES_EDITED_COUNT" -gt 0 ]]; then
echo "│ Files edited: ${SOURCE_COUNT} source, ${TEST_COUNT} test"
fi
if [[ -n "$DOCS_EDITED_NAMES" ]]; then
echo "│ Docs updated: $DOCS_EDITED_NAMES"
fi
echo "│ Context delta: $DELTA"
echo "└────────────────────────────────────────────────────────────┘"

# --- Write machine-readable PR context ---
PR_CONTEXT="/tmp/root-pr-context.txt"
{
  if [[ -n "$ISSUE_NUM" ]]; then
    echo "ISSUE: #${ISSUE_NUM}"
  else
    echo "ISSUE: none"
  fi
  echo "DOCS: ${DOCS_READ_NAMES:-none}"
  echo "FILES: ${SOURCE_COUNT} source, ${TEST_COUNT} test"
  echo "DOCS_UPDATED: ${DOCS_EDITED_NAMES:-none}"
} > "$PR_CONTEXT"

exit 0
