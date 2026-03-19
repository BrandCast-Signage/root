#!/bin/bash
# root init — scaffold Root framework config in a project
#
# Usage: root init [project-dir] [--force]
#
# Installs:
# - root.config.json (project config)
# - .claude/context/workflow.md (tier workflow reference)
# - <plansDir>/TEMPLATE.md (implementation plan template)
# - .claude/agents/ (team + specialist agent templates)
# - RAG MCP server (if not already installed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-.}"
FORCE=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
  esac
done

# Resolve target to absolute path
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "ERROR: Directory '$1' not found"; exit 1; }

echo "=== Root Framework Init ==="
echo "Project: $TARGET"
echo ""

# --- 1. Config file ---
CONFIG="$TARGET/root.config.json"
if [[ -f "$CONFIG" && "$FORCE" != "true" ]]; then
  echo "✓ root.config.json already exists (use --force to overwrite)"
else
  cp "$PLUGIN_ROOT/root.config.example.json" "$CONFIG"
  echo "✓ Created root.config.json — edit this to customize mappings"
fi

# --- 2. Workflow reference ---
mkdir -p "$TARGET/.claude/context"
if [[ -f "$TARGET/.claude/context/workflow.md" && "$FORCE" != "true" ]]; then
  echo "✓ .claude/context/workflow.md already exists"
else
  cp "$PLUGIN_ROOT/templates/context/workflow.md" "$TARGET/.claude/context/workflow.md"
  echo "✓ Installed workflow.md"
fi

# --- 3. Implementation Plan template ---
# Read plansDir from config if it exists, default to docs/plans
PLANS_DIR="docs/plans"
if [[ -f "$CONFIG" ]]; then
  PLANS_DIR=$(python3 -c "import json; print(json.load(open('$CONFIG'))['project'].get('plansDir', 'docs/plans'))" 2>/dev/null || echo "docs/plans")
fi
mkdir -p "$TARGET/$PLANS_DIR"
if [[ -f "$TARGET/$PLANS_DIR/TEMPLATE.md" && "$FORCE" != "true" ]]; then
  echo "✓ $PLANS_DIR/TEMPLATE.md already exists"
else
  cp "$PLUGIN_ROOT/templates/plans/TEMPLATE.md" "$TARGET/$PLANS_DIR/TEMPLATE.md"
  echo "✓ Installed Implementation Plan template at $PLANS_DIR/TEMPLATE.md"
fi

# --- 4. Agent templates ---
mkdir -p "$TARGET/.claude/agents"
INSTALLED=0
SKIPPED=0
for agent in "$PLUGIN_ROOT/agents/"*.md; do
  name="$(basename "$agent")"
  if [[ -f "$TARGET/.claude/agents/$name" && "$FORCE" != "true" ]]; then
    SKIPPED=$((SKIPPED + 1))
  else
    cp "$agent" "$TARGET/.claude/agents/$name"
    INSTALLED=$((INSTALLED + 1))
  fi
done
echo "✓ Agents: $INSTALLED installed, $SKIPPED skipped (already exist)"

# --- 5. RAG MCP server ---
RAG_DIR="${HOME}/.local/lib/root-rag"
if [[ -d "$RAG_DIR/node_modules/mcp-local-rag" ]]; then
  echo "✓ RAG MCP server already installed at $RAG_DIR"
else
  echo "Installing RAG MCP server (mcp-local-rag)..."
  mkdir -p "$RAG_DIR"
  cd "$RAG_DIR"
  npm init -y --silent 2>/dev/null
  npm install mcp-local-rag --silent 2>/dev/null
  if [[ $? -eq 0 ]]; then
    echo "✓ RAG MCP server installed at $RAG_DIR"
  else
    echo "⚠ RAG install failed — native deps may need manual setup"
    echo "  Try: cd $RAG_DIR && npm install mcp-local-rag"
  fi
  cd "$TARGET"
fi

# --- 6. Create RAG database directory ---
mkdir -p "$TARGET/.claude/rag-db"
echo "✓ RAG database directory at .claude/rag-db/"

# --- 7. Generate doc index ---
if [[ -x "$PLUGIN_ROOT/hooks/scripts/build-doc-index.sh" ]]; then
  echo "Generating doc index..."
  "$PLUGIN_ROOT/hooks/scripts/build-doc-index.sh" 2>/dev/null && echo "✓ Doc index generated" || echo "⚠ Doc index generation skipped"
fi

echo ""
echo "=== Root Init Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit root.config.json to match your project structure"
echo "  2. Customize .claude/agents/specialist-*.md for your stack"
echo "  3. Restart Claude Code to load the RAG MCP server"
echo "  4. Run: /root <task> to start your first session"
