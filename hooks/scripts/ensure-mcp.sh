#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Ensure MCP servers are installed and configured on SessionStart.
# - mcp-local-rag: third-party package; installed into ~/.root-framework/mcp/
#   (separate install dir because of its 5MB+ native bindings) and upgraded to
#   @latest if behind.
# - mcp-root-board: bundled inside this plugin at ${CLAUDE_PLUGIN_ROOT}/mcp/...;
#   only its npm dependencies are installed at runtime, into ${CLAUDE_PLUGIN_DATA}.
#   The bundled approach gives us lockstep versioning between plugin and MCP code
#   automatically — no upgrade logic needed for board.
# - Migrates root.config.json if schema is outdated.
# - If RAG DB is empty and root.config.json exists: auto-ingests.
# - Checks gh CLI authentication for board GitHub features.

# Consumer project root is $PWD (where the user launched the CLI)
PROJECT_DIR="$PWD"
CONFIG="$PROJECT_DIR/root.config.json"

# Plugin/extension root (for scripts)
PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# RAG installation directory (third-party package, lives outside plugin tree)
INSTALL_DIR="${HOME}/.root-framework/mcp"
RAG_BIN="$INSTALL_DIR/node_modules/mcp-local-rag/dist/index.js"

# Board MCP — bundled in plugin tree; deps installed to per-plugin data dir.
# CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA are exported by Claude Code.
# When this hook runs under Gemini, those vars are unset and the board deps
# block is skipped (Gemini's gemini-extension.json still uses the install-dir
# model for now).
BOARD_PKG_SOURCE="${CLAUDE_PLUGIN_ROOT:-}/mcp/mcp-root-board/package.json"
BOARD_DATA_DIR="${CLAUDE_PLUGIN_DATA:-}/mcp-root-board"
BOARD_PKG_DATA="${BOARD_DATA_DIR}/package.json"

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

# --- Upgrade RAG to @latest if behind ---
# Fails soft on offline / registry errors so a missing network never blocks
# session start.
upgrade_rag_if_stale() {
  local pkg_json="$INSTALL_DIR/node_modules/mcp-local-rag/package.json"
  [[ -f "$pkg_json" ]] || return 0

  local installed
  installed=$(node -p "require('$pkg_json').version" 2>/dev/null)
  [[ -n "$installed" ]] || return 0

  local latest
  latest=$(npm view "mcp-local-rag" version 2>/dev/null)
  [[ -n "$latest" ]] || return 0

  if [[ "$installed" != "$latest" ]]; then
    echo "Root: Upgrading RAG MCP server ($installed → $latest)..."
    cd "$INSTALL_DIR" || return 0
    npm install "mcp-local-rag@latest" --silent 2>&1
  fi
}

upgrade_rag_if_stale

# --- Install board MCP deps into plugin data dir if package.json changed ---
# The board MCP itself ships inside the plugin tarball at
# ${CLAUDE_PLUGIN_ROOT}/mcp/mcp-root-board/dist/. Only its npm dependencies
# need to be materialized at runtime, into the persistent per-plugin data
# directory. We diff the bundled package.json against the cached copy to
# detect when the plugin update introduced new/changed deps.
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -n "${CLAUDE_PLUGIN_DATA:-}" && -f "$BOARD_PKG_SOURCE" ]]; then
  if ! diff -q "$BOARD_PKG_SOURCE" "$BOARD_PKG_DATA" >/dev/null 2>&1; then
    echo "Root: Installing board MCP dependencies..."
    mkdir -p "$BOARD_DATA_DIR"
    cp "$BOARD_PKG_SOURCE" "$BOARD_PKG_DATA"
    if ! (cd "$BOARD_DATA_DIR" && npm install --omit=dev --silent 2>&1); then
      # Roll back the cached package.json so the next session retries.
      rm -f "$BOARD_PKG_DATA"
      echo "Root: Failed to install board MCP dependencies. The next session will retry."
    fi
  fi
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

# Migration v0/v1 → v2: convert old include to docs, preserve user additions
if version < 2:
    ingest = config.get('ingest', {})
    docs_dir = config.get('project', {}).get('docsDir', 'docs')
    docs_entry = docs_dir + '/' if not docs_dir.endswith('/') else docs_dir

    # Only set docs if it doesn't already exist (preserve user edits)
    if 'docs' not in ingest:
        ingest['docs'] = [docs_entry]

    # Remove old fields only
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

# Check gh CLI authentication (advisory — don't fail the hook)
if command -v gh &>/dev/null; then
  if ! gh auth status &>/dev/null 2>&1; then
    echo "⚠️  gh CLI not authenticated. Board GitHub features (labels, comments, PRs) will be unavailable."
    echo "   Run: gh auth login"
  fi
else
  echo "⚠️  gh CLI not found. Board GitHub features will be unavailable."
  echo "   Install: https://cli.github.com"
fi
