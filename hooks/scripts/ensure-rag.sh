#!/bin/bash
# SPDX-License-Identifier: MIT
# Ensure RAG database is populated on SessionStart.
# - First run: installs mcp-local-rag into a unified framework directory
# - Migrates root.config.json if schema is outdated
# - If DB is empty and root.config.json exists: auto-ingests

# Consumer project root is $PWD (where the user launched the CLI)
PROJECT_DIR="$PWD"
CONFIG="$PROJECT_DIR/root.config.json"

# Plugin/extension root (for scripts)
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Unified installation directory
INSTALL_DIR="${HOME}/.root-framework/mcp"
RAG_BIN="$INSTALL_DIR/node_modules/mcp-local-rag/dist/index.js"

# Current config schema version
CURRENT_CONFIG_VERSION=2

# --- Install RAG if needed ---
if [[ ! -f "$RAG_BIN" ]]; then
  echo "Root: Installing RAG MCP server (this may take a few minutes for native bindings)..."
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR" || exit 1
  npm init -y --silent 2>/dev/null
  npm install mcp-local-rag --silent 2>&1

  if [[ ! -f "$RAG_BIN" ]]; then
    echo "Root: Failed to install mcp-local-rag. Try running manually: cd $INSTALL_DIR && npm install mcp-local-rag"
    exit 0
  fi
  echo "Root: RAG MCP server installed successfully."
fi

# --- Migrate config if needed ---
if [[ -f "$CONFIG" ]]; then
  CONFIG_VERSION=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('configVersion', 0))" 2>/dev/null || echo "0")

  if [[ "$CONFIG_VERSION" -lt "$CURRENT_CONFIG_VERSION" ]]; then
    echo "Root: Migrating root.config.json (v${CONFIG_VERSION} → v${CURRENT_CONFIG_VERSION})..."

    python3 -c "
import json

config_path = '$CONFIG'
with open(config_path) as f:
    config = json.load(f)

version = config.get('configVersion', 0)

# Migration v0/v1 → v2: use project.docsDir as the sole ingest target
if version < 2:
    ingest = config.get('ingest', {})
    docs_dir = config.get('project', {}).get('docsDir', 'docs')

    # Set docs to just the project's docs directory
    ingest['docs'] = [docs_dir + '/'] if not docs_dir.endswith('/') else [docs_dir]

    # Remove old fields
    ingest.pop('include', None)
    ingest.pop('exclude', None)
    ingest.pop('extensions', None)
    ingest.pop('sources', None)

    config['ingest'] = ingest

# Set version
config['configVersion'] = $CURRENT_CONFIG_VERSION

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

print('Root: Config migrated. Ingest target: ' + config['ingest']['docs'][0])
" 2>&1
  fi
fi

# --- Auto-ingest if DB is empty ---
if [[ -f "$CONFIG" ]]; then
  DB_REL_PATH=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
  DB_PATH="$PROJECT_DIR/$DB_REL_PATH"

  # Check if DB has documents (lancedb creates a directory)
  if [[ ! -d "$DB_PATH" ]] || [[ -z "$(ls -A "$DB_PATH" 2>/dev/null)" ]]; then
    echo "Root: RAG database empty. Auto-ingesting from root.config.json..."
    "$PLUGIN_DIR/scripts/ingest.sh" "$PROJECT_DIR" 2>&1
  fi
fi
