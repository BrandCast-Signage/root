# Root Framework — GEMINI.md

Root is a development workflow framework for **Claude Code** (plugin) and **Gemini CLI** (extension). It provides tier-based planning, doc-aware context gathering, RAG-powered search, multi-feature orchestration, and autonomous issue-to-PR workflows.

## Project Overview

- **Purpose**: Automates development tasks using AI agents, including planning, implementation, testing, and documentation.
- **Architecture**: Dual-harness system. Shared components (skills, commands, agents, scripts) work for both Claude and Gemini.
- **Main Components**:
    - **Orchestration**: `mcp/mcp-root-board` (MCP server) manages work streams, state transitions, and worktrees.
    - **Workflow Entry Point**: `skills/root/SKILL.md` (the `/root` command).
    - **RAG System**: `skills/mcp-local-rag` uses LanceDB for semantic documentation search.
    - **Agent Roles**: Team-based (architect, implementer, reviewer, tester) and specialist (backend, frontend, database, devops).
    - **Commands**: Subcommands for specialized tasks (`init`, `prd`, `impl`, `explore`, `rag`, `docs`).
    - **Hooks**: Scripts for session lifecycle management, edit tracking, and documentation validation.

## Building and Running

### Development

- **MCP Server**:
  ```bash
  cd mcp/mcp-root-board
  npm install
  npm run build
  npm test
  ```
- **RAG System**: The `mcp-local-rag` binary is typically installed at `${HOME}/.root-framework/mcp/`.

### Installation

- **Gemini CLI**: `gemini extension install https://github.com/BrandCast-Signage/root`
- **Claude Code**: Add the marketplace and install the plugin.

## Development Conventions

### Dual-Harness Compliance (CRITICAL)

Root must work for both Claude and Gemini. Follow these rules from `dev/dual-harness/SKILL.md`:

1.  **Shared Files**: Commands, skills, agents, and scripts are shared. Harness-specific files (e.g., `plugin.json`, `gemini-extension.json`) are isolated.
2.  **Environment Variables**: Use only universal variables (`$HOME`, `$PWD`, `$PATH`). Never harness-specific ones in shared code.
3.  **Command Sync**: Commands have two files that MUST stay in sync:
    - `commands/root/<name>.md`: Content used by Claude.
    - `commands/root/<name>.toml`: Metadata and *inline prompt content* used by Gemini.
4.  **Version Sync**: Keep the version string identical in:
    - `.claude-plugin/plugin.json`
    - `.claude-plugin/marketplace.json`
    - `gemini-extension.json`
5.  **Documentation Formatting**: All `.md` files in documentation directories (`docs/`, `docs/plans/`, `docs/prds/`) require valid YAML frontmatter (`title`, `type`, `status`, `created`, `updated`).
6.  **Command Structure**: All slash commands must live in `commands/root/`.

### Coding Standards

- **TypeScript**: No `any` types. Use generics or narrowed unions.
- **Documentation**: All new exports require JSDoc with `@param`, `@returns`, and `@throws`.
- **Logging**: No `console.log` in production code; use a structured logger.

## Key Files

- `skills/root/SKILL.md`: Core logic for the `/root` command.
- `mcp/mcp-root-board/src/index.ts`: Main entry for the board orchestration server.
- `dev/dual-harness/SKILL.md`: Detailed rules for Root framework development.
- `root.config.example.json`: Reference for per-project configuration.
- `CLAUDE.md`: General development architecture and rules.

## Usage in Consumer Projects

1.  Initialize Root: `/root:init`
2.  Start a session: `/root #<issue_number>`
3.  Execute sub-tasks: `/root:impl`, `/root:prd`, `/root:docs`, etc.
4.  Manage orchestration: `/root list`, `/root status`, `/root approve`, `/root sync`.
