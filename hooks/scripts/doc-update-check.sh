#!/bin/bash
# SPDX-License-Identifier: MIT
# Stop hook: Warn if Tier 1 work didn't update living docs
#
# Reads board stream state from .root/board/<issue>.json.
# If tier=tier1 and the stream has been through implementation,
# outputs a reminder to check docs. Advisory only (exit 0).

BOARD_DIR="$PWD/.root/board"

if [[ ! -d "$BOARD_DIR" ]]; then
  exit 0
fi

# Check each active stream
for board_file in "$BOARD_DIR"/*.json; do
  [[ -f "$board_file" ]] || continue

  TIER=$(jq -r '.tier // "unknown"' "$board_file")
  STATUS=$(jq -r '.status // "unknown"' "$board_file")
  ISSUE_NUM=$(jq -r '.issue.number // empty' "$board_file")

  # Only check Tier 1 work that's been through implementation
  if [[ "$TIER" != "tier1" ]]; then
    continue
  fi

  # Only warn for streams that are in validating or pr-ready
  if [[ "$STATUS" != "validating" && "$STATUS" != "pr-ready" ]]; then
    continue
  fi

  echo ""
  echo "┌─ Doc Update Reminder ──────────────────────────────────────┐"
  echo "│ Tier 1 stream #${ISSUE_NUM} is in ${STATUS} state.        "
  echo "│ Verify that living docs were updated if behavior changed.  │"
  echo "│                                                            │"
  echo "│ Skip if changes don't affect documented behavior.          │"
  echo "└────────────────────────────────────────────────────────────┘"
done

exit 0
