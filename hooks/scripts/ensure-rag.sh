#!/bin/bash
# Ensure mcp-local-rag is installed in the plugin data directory.
# Runs on SessionStart — installs on first run, no-op after that.

PLUGIN_DATA="${HOME}/.claude/plugins/data/root"

if [[ -f "$PLUGIN_DATA/node_modules/mcp-local-rag/dist/index.js" ]]; then
  exit 0
fi

mkdir -p "$PLUGIN_DATA"
cd "$PLUGIN_DATA"
npm init -y --silent 2>/dev/null
npm install mcp-local-rag --silent 2>&1

if [[ -f "$PLUGIN_DATA/node_modules/mcp-local-rag/dist/index.js" ]]; then
  echo "Root: RAG MCP server installed. Restart Claude Code to activate."
else
  echo "Root: Failed to install mcp-local-rag. Run: cd $PLUGIN_DATA && npm install mcp-local-rag"
fi
