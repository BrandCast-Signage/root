#!/bin/bash
# root init — scaffold Root framework config and install dependencies
#
# Usage: root init [project-dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

# Plugin data directory — persistent across plugin updates
PLUGIN_DATA="${HOME}/.claude/plugins/data/root"

echo "=== Root Framework Init ==="
echo ""

# --- Install RAG MCP server ---
echo "Installing RAG MCP server..."
mkdir -p "$PLUGIN_DATA"
cd "$PLUGIN_DATA"
npm init -y --silent 2>/dev/null
npm install mcp-local-rag
echo "✓ RAG MCP server installed"
echo ""

# --- Project config ---
cd "$TARGET"

cp -n "$PLUGIN_ROOT/root.config.example.json" "$TARGET/root.config.json" 2>/dev/null && echo "✓ Created root.config.json" || echo "✓ root.config.json already exists"

mkdir -p "$TARGET/.claude/context"
cp -n "$PLUGIN_ROOT/templates/context/workflow.md" "$TARGET/.claude/context/workflow.md" 2>/dev/null && echo "✓ Installed workflow.md" || echo "✓ workflow.md already exists"

# Read plansDir from config
PLANS_DIR=$(python3 -c "import json; print(json.load(open('$TARGET/root.config.json'))['project'].get('plansDir', 'docs/plans'))" 2>/dev/null || echo "docs/plans")
mkdir -p "$TARGET/$PLANS_DIR"
cp -n "$PLUGIN_ROOT/templates/plans/TEMPLATE.md" "$TARGET/$PLANS_DIR/TEMPLATE.md" 2>/dev/null && echo "✓ Installed plan template" || echo "✓ Plan template already exists"

mkdir -p "$TARGET/.claude/agents"
for agent in "$PLUGIN_ROOT/agents/"*.md; do
  cp -n "$agent" "$TARGET/.claude/agents/$(basename "$agent")" 2>/dev/null
done
echo "✓ Agent templates installed"

mkdir -p "$TARGET/.claude/rag-db"

echo ""
echo "=== Done ==="
echo ""
echo "Next:"
echo "  1. Edit root.config.json for your project"
echo "  2. Customize .claude/agents/specialist-*.md for your stack"
echo "  3. Restart Claude Code to load the RAG MCP server"
echo "  4. Run /root:root <task> to start"
