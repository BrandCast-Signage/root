---
name: dual-harness
description: "CRITICAL: Load this skill before ANY code change in the Root framework. Root is a dual-harness project — every file must work for both Claude Code (plugin) and Gemini CLI (extension). This skill contains the rules for shared vs harness-specific files, command naming, config schemas, environment variables, and CLI usage. Load when: editing any file in this repo, adding commands/skills/agents/hooks, modifying plugin.json or gemini-extension.json, changing scripts or configs, working with mcp-local-rag."
user-invocable: false
---

# Root Dual-Harness Development Rules

Root ships as BOTH a Claude Code plugin AND a Gemini CLI extension. Every change must work for both. These rules are non-negotiable.

## Architecture: What Is Shared, What Is Not

### Shared (both harnesses use these)
- `commands/root/*.toml` + `commands/root/*.md` — slash commands
- `skills/*/SKILL.md` — model-invoked skills
- `agents/*.md` — agent templates
- `scripts/*.sh` — shell scripts
- `hooks/scripts/*.sh` — hook scripts
- `.mcp.json` — MCP server config (Claude reads this directly; Gemini inlines its own copy)
- `root.config.json` — per-project config in consumer repos
- `.root/rag-db` — shared RAG database location

### Claude-specific
- `.claude-plugin/plugin.json` — Claude plugin manifest
- `.claude-plugin/marketplace.json` — marketplace entry
- `.claude-plugin/hooks.json` — Claude hook wiring

### Gemini-specific
- `gemini-extension.json` — Gemini extension manifest
- `hooks/gemini-hooks.json` — Gemini hook wiring

## Environment Variables

**In shared files (commands, scripts, skills):**
- Use ONLY universal variables: `$HOME`, `$PWD`, `$PATH`
- NEVER use `${CLAUDE_PLUGIN_ROOT}` — Gemini doesn't set it
- NEVER use `${extensionPath}` — Claude doesn't set it
- NEVER use `${CLAUDE_SKILL_DIR}` — Gemini doesn't set it

**In harness-specific files:**
- Claude hooks/configs CAN use `${CLAUDE_PLUGIN_ROOT}`
- Gemini hooks/configs CAN use `${extensionPath}`

## Command Naming

The two harnesses derive command names differently:

**Gemini CLI**: Derives from directory structure. `commands/root/rag.toml` → `/root:rag`
**Claude Code**: Plugin name auto-prefixes. `plugin.json` → `"commands": "./commands/root"` → `/root:rag`

This is why:
- Commands MUST live in `commands/root/` (Gemini needs the subdirectory for namespacing)
- `plugin.json` MUST point `"commands"` at `"./commands/root"` (not `"./commands"`, which causes `root:root:rag`)
- TOML `name` field (e.g. `name = "root:rag"`) is ignored by Gemini — it uses the file path
- TOML `prompt` field must be relative to repo root: `prompt = "commands/root/rag.md"`

**Never move commands out of `commands/root/`.** Never change the `plugin.json` commands path.

## Command Prompt Files (.md)

Command prompts are shared between both harnesses. The model reads them and executes bash.

Rules for inline bash in prompts:
- Use `$HOME`-based paths to reference shared binaries
- The RAG binary is always at: `${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js`
- Never reference plugin/extension install directories

## TOML Command Files

Gemini uses: `description`, `prompt`
Gemini ignores: `name`, `type`

Claude ignores TOML files entirely — it reads the `.md` files directly.

Keep TOML files minimal. The `prompt` path must be correct relative to repo root for Gemini.

## Version Sync

Three files must have the same version on every bump:
1. `.claude-plugin/plugin.json` → `"version"`
2. `.claude-plugin/marketplace.json` → `plugins[0].version`
3. `gemini-extension.json` → `"version"`

Claude caches plugins by version. If you change code without bumping version, users won't get updates.

## RAG Database

One shared location: `.root/rag-db` (relative to consumer project root).

Both harnesses' MCP configs point here. Never use `.claude/rag-db` or `.gemini/rag-db`.

The `root.config.json` default for `ingest.dbPath` is `.root/rag-db`.

## mcp-local-rag CLI

**Verified behavior (from `--help` output):**

Global options go BEFORE the subcommand:
```
node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <directory>
```

NOT:
```
node "$RAG_BIN" ingest --db-path "$DB_PATH" ...
```

**Known limitation:** The CLI has NO `--exclude` or `--extensions` flags. It ingests everything in a directory recursively. Filtering is done post-ingestion by querying the DB and deleting files that match exclude patterns. See `scripts/cleanup-rag.sh`.

**Supported CLI commands:** `ingest`, `query`, `list`, `status`, `delete`, `skills install`

**Do not guess at CLI behavior. Run `--help` first.**

## Plugin Manifest (`plugin.json`)

**Verified fields (from Claude Code docs):**
- `commands`: string or array — paths to command files/directories
- `agents`: string or array — paths to individual `.md` files (NOT directories)
- `skills`: string or array — paths to skill directories
- `hooks`: string, array, or object — hook config paths or inline config
- `mcpServers`: string, array, or object — MCP config paths or inline config

`agents` must list individual files: `"./agents/team-architect.md"`, NOT `"./agents"`

## The Golden Rule

**Do not guess. Verify.**

Before changing any config, CLI invocation, or manifest field:
1. Check `--help` output for CLIs
2. Check official documentation for schemas
3. Test against a real database/installation
4. Confirm the change works for BOTH harnesses
