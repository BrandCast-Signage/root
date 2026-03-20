#!/bin/bash
# root init — install templates and run ingestion
#
# This is the shell fallback. The primary setup path is /root:init
# which provides interactive project detection and config generation.
#
# Usage: root init [project-dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

echo "=== Root Framework Init ==="
echo ""

# Detect agent context
if [[ -n "${GEMINI_CLI:-}" ]] || [[ "${0}" == *".gemini"* ]] || [[ "${0}" == *"gemini-extensions"* ]]; then
  AGENT_DIR=".gemini"
else
  AGENT_DIR=".claude"
fi

# --- Install templates ---
mkdir -p "$TARGET/$AGENT_DIR/context"
cp -n "$PLUGIN_ROOT/templates/context/workflow.md" "$TARGET/$AGENT_DIR/context/workflow.md" 2>/dev/null && echo "✓ Installed workflow.md" || echo "✓ workflow.md already exists"

# Read plansDir and prdsDir from config if it exists
if [[ -f "$TARGET/root.config.json" ]]; then
  PLANS_DIR=$(python3 -c "import json; print(json.load(open('$TARGET/root.config.json'))['project'].get('plansDir', 'docs/plans'))" 2>/dev/null || echo "docs/plans")
  PRDS_DIR=$(python3 -c "import json; print(json.load(open('$TARGET/root.config.json'))['project'].get('prdsDir', 'docs/prds'))" 2>/dev/null || echo "docs/prds")
else
  PLANS_DIR="docs/plans"
  PRDS_DIR="docs/prds"
fi
mkdir -p "$TARGET/$PLANS_DIR"
cp -n "$PLUGIN_ROOT/templates/plans/TEMPLATE.md" "$TARGET/$PLANS_DIR/TEMPLATE.md" 2>/dev/null && echo "✓ Installed plan template" || echo "✓ Plan template already exists"

mkdir -p "$TARGET/$PRDS_DIR"
cp -n "$PLUGIN_ROOT/templates/prds/TEMPLATE.md" "$TARGET/$PRDS_DIR/TEMPLATE.md" 2>/dev/null && echo "✓ Installed PRD template" || echo "✓ PRD template already exists"

mkdir -p "$TARGET/$AGENT_DIR/agents"
for agent in "$PLUGIN_ROOT/agents/"*.md; do
  cp -n "$agent" "$TARGET/$AGENT_DIR/agents/$(basename "$agent")" 2>/dev/null
done
echo "✓ Agent templates installed"

mkdir -p "$TARGET/$AGENT_DIR/rag-db"

# --- Update .gitignore ---
if [[ -f "$TARGET/.gitignore" ]] && ! grep -q "^\.root/" "$TARGET/.gitignore"; then
  echo "" >> "$TARGET/.gitignore"
  echo "# Root framework local data" >> "$TARGET/.gitignore"
  echo ".root/" >> "$TARGET/.gitignore"
  echo "✓ Added .root/ to .gitignore"
fi

# --- Run ingestion if config exists ---
if [[ -f "$TARGET/root.config.json" ]]; then
  echo ""
  "$SCRIPT_DIR/ingest.sh" "$TARGET"
fi

echo ""
echo "=== Done ==="
