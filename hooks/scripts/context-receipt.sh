#!/bin/bash
# SPDX-License-Identifier: MIT
# Stop hook: Output a context receipt summarizing active board streams
#
# Reads board state from .root/board/*.json and outputs a summary.
# Advisory only (exit 0).

BOARD_DIR="$PWD/.root/board"

# Skip if no board directory
if [[ ! -d "$BOARD_DIR" ]]; then
  exit 0
fi

# Check if any board files exist
shopt -s nullglob
BOARD_FILES=("$BOARD_DIR"/*.json)
shopt -u nullglob

if [[ ${#BOARD_FILES[@]} -eq 0 ]]; then
  exit 0
fi

# --- Output receipt ---
echo ""
echo "┌─ Context Receipt ──────────────────────────────────────────┐"
echo "│ Board:"

for board_file in "${BOARD_FILES[@]}"; do
  BNUM=$(jq -r '.issue.number // empty' "$board_file" 2>/dev/null)
  BTITLE=$(jq -r '.issue.title // empty' "$board_file" 2>/dev/null)
  BSTATUS=$(jq -r '.status // empty' "$board_file" 2>/dev/null)
  BTIER=$(jq -r '.tier // empty' "$board_file" 2>/dev/null)

  if [[ -n "$BNUM" && -n "$BSTATUS" ]]; then
    TIER_LABEL=""
    case "$BTIER" in
      tier1) TIER_LABEL="T1" ;;
      tier2) TIER_LABEL="T2" ;;
    esac
    TITLE_TRUNC="${BTITLE:0:30}"
    printf "│   #%-4s %-30s %-4s %s\n" "$BNUM" "$TITLE_TRUNC" "$TIER_LABEL" "$BSTATUS"
  fi
done

echo "└────────────────────────────────────────────────────────────┘"

exit 0
