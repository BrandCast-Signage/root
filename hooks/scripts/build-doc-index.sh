#!/bin/bash
# Build the doc keyword index for doc discovery
#
# Scans project docs directory, extracts frontmatter (title, tags),
# auto-generates keywords from headings, and merges with a curated
# alias map. Outputs .claude/hooks/data/doc-index.json.
#
# Reads docsDir from root.config.json if available.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Read docsDir from root.config.json, default to "docs"
if [[ -f "$REPO_ROOT/root.config.json" ]]; then
  DOCS_DIR="$REPO_ROOT/$(python3 -c "import json; print(json.load(open('$REPO_ROOT/root.config.json'))['project'].get('docsDir', 'docs'))" 2>/dev/null || echo "docs")"
else
  DOCS_DIR="$REPO_ROOT/docs"
fi

OUTPUT="$REPO_ROOT/.claude/hooks/data/doc-index.json"
ALIASES_FILE="$REPO_ROOT/.claude/hooks/data/aliases.json"

mkdir -p "$(dirname "$OUTPUT")"

if [[ ! -f "$ALIASES_FILE" ]]; then
  echo "ERROR: aliases.json not found at $ALIASES_FILE" >&2
  exit 1
fi

STOP_WORDS="the|a|an|and|for|in|of|to|with|is|it"

# --- Build index ---
DOCS_JSON="[]"

while IFS= read -r -d '' file; do
  rel_path="${file#$REPO_ROOT/}"
  basename_noext=$(basename "$file" .md)

  # Check if file has frontmatter (starts with ---)
  first_line=$(head -1 "$file")
  if [[ "$first_line" != "---" ]]; then
    # No frontmatter — extract title from first H1 heading
    title=$(grep -E '^# ' "$file" | head -1 | sed 's/^# //')
    if [[ -z "$title" ]]; then
      title="$basename_noext"
    fi
    tags_json="[]"
  else
    # Parse frontmatter (between first two --- lines)
    frontmatter=$(awk 'NR==1 && /^---$/{found=1; next} found && /^---$/{exit} found{print}' "$file")

    # Extract title
    title=$(echo "$frontmatter" | grep -E '^title:' | sed 's/^title:[[:space:]]*//' | sed 's/^"//;s/"$//' | head -1)
    if [[ -z "$title" ]]; then
      title="$basename_noext"
    fi

    # Extract tags array from frontmatter YAML
    tags_json=$(echo "$frontmatter" | awk '
      /^tags:/ { intags=1; next }
      intags && /^[[:space:]]+-[[:space:]]/ { gsub(/^[[:space:]]+-[[:space:]]+/, ""); print; next }
      intags && /^[^[:space:]]/ { intags=0 }
    ' | jq -R -s 'split("\n") | map(select(length > 0) | gsub("^\\s+|\\s+$"; ""))')

    if [[ -z "$tags_json" || "$tags_json" == "[]" ]]; then
      tags_json="[]"
    fi
  fi

  # Extract keywords from title
  keywords_from_title=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '\n' | grep -vE "^($STOP_WORDS)$" | grep -E '^.{3,}$' | sort -u || true)

  # Extract keywords from first 3 H2 headings
  keywords_from_headings=$(grep -E '^## ' "$file" | head -3 | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '\n' | grep -vE "^($STOP_WORDS)$" | grep -E '^.{3,}$' | sort -u || true)

  # Merge and deduplicate
  all_keywords=$(printf "%s\n%s" "$keywords_from_title" "$keywords_from_headings" | sort -u | grep -v '^$' || true)
  if [[ -z "$all_keywords" ]]; then
    keywords_json="[]"
  else
    keywords_json=$(echo "$all_keywords" | jq -R -s 'split("\n") | map(select(length > 0))')
  fi

  # Get aliases from JSON file
  aliases_json=$(jq --arg key "$basename_noext" '.[$key] // []' "$ALIASES_FILE")

  # Build doc entry
  doc_entry=$(jq -n \
    --arg path "$rel_path" \
    --arg title "$title" \
    --argjson tags "$tags_json" \
    --argjson keywords "$keywords_json" \
    --argjson aliases "$aliases_json" \
    '{path: $path, title: $title, tags: $tags, keywords: $keywords, aliases: $aliases}')

  DOCS_JSON=$(echo "$DOCS_JSON" | jq --argjson entry "$doc_entry" '. + [$entry]')
done < <(find "$DOCS_DIR" -name '*.md' -print0 | sort -z)

# Write final index
jq -n \
  --argjson docs "$DOCS_JSON" \
  --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{version: 1, generated: $generated, docs: $docs}' > "$OUTPUT"

COUNT=$(echo "$DOCS_JSON" | jq 'length')
echo "Built doc index: $COUNT docs -> $OUTPUT"
