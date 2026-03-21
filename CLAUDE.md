# Root Framework

Dual-harness development workflow framework for **Claude Code** (plugin) and **Gemini CLI** (extension).

## Architecture

- `.claude-plugin/` — Claude Code plugin config (`plugin.json`, `hooks.json`, `marketplace.json`)
- `gemini-extension.json` — Gemini CLI extension config
- `.mcp.json` — MCP server config (Claude); Gemini inlines its MCP config
- `commands/root/` — Slash commands as TOML (metadata) + MD (prompt) pairs
- `skills/*/SKILL.md` — Model-invoked skill prompts
- `agents/*.md` — Claude-only agent templates (team + specialist roles)
- `hooks/scripts/` — Shared hook scripts used by both harnesses
- `hooks/gemini-hooks.json` — Gemini-specific hook wiring
- `templates/` — Plan, PRD, and workflow templates
- `root.config.example.json` — Example per-project configuration

## Version Sync

Three files must stay in sync on version bumps:
1. `.claude-plugin/plugin.json` → `version`
2. `.claude-plugin/marketplace.json` → `plugins[0].version`
3. `gemini-extension.json` → `version`

## RAG Database

Both harnesses share a per-project RAG database at `.root/rag-db` (relative to consumer project root). The MCP server binary is installed at `${HOME}/.root-framework/mcp/` by the `ensure-rag.sh` session-start hook.

## Hook Event Mapping

| Claude Event | Gemini Event | Scripts |
|-------------|-------------|---------|
| `SessionStart` | `SessionStart` | `ensure-rag.sh` |
| `PostToolUse` (Edit/Write) | `AfterTool` (replace/write_file) | `track-edits.sh` |
| `PostToolUse` (Read/Grep) | `AfterTool` (read_file/grep_search) | `track-doc-reads.sh` |
| `Stop` | `SessionEnd` | `context-receipt.sh`, `doc-update-check.sh` |

## Commands

| Command | Subcommands |
|---------|-------------|
| `root:init` | (interactive setup) |
| `root:prd` | `new`, `edit`, `review`, `list` |
| `root:rag` | `status`, `ingest`, `refresh`, `clear`, `config`, `scan` |
| `root:docs` | `health`, `search`, `stale`, `scan`, `validate`, `fix`, `create` |

The `root` skill (in `skills/root/SKILL.md`) is the main workflow entry point, invoked as `/root <task>`.

## Dual-Harness Rules

**BEFORE making any code change, load the `dual-harness` skill** (`skills/dual-harness/SKILL.md`). It contains verified rules for shared vs harness-specific files, environment variables, command naming, CLI usage, and config schemas. Every mistake in this project has come from not checking those rules first.
