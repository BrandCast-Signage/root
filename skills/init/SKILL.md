---
name: init
description: "Initialize Root framework for your project. Interactive setup: detects project structure, configures docs/source directories, installs agent templates, and ingests docs into RAG. Run once per project."
user-invocable: true
argument: "[project-dir] — defaults to current directory"
---

# /root:init — Project Setup

Interactive setup for the Root development workflow framework. Detects your project structure, asks a few questions, generates config, and ingests your docs into RAG.

## Protocol

### Step 1: Detect project basics

Scan the project root for:
- **Project name**: from `package.json` → `name`, `Cargo.toml` → `[package] name`, `pyproject.toml` → `[project] name`, `go.mod` → module name, or fall back to directory name
- **Language/framework**: check for `tsconfig.json` (TypeScript), `package.json` (Node.js), `Cargo.toml` (Rust), `go.mod` (Go), `pyproject.toml`/`requirements.txt` (Python), `pom.xml`/`build.gradle` (Java)

Output what you found:
> Detected: **my-project** (TypeScript/Node.js)

### Step 2: Find documentation directories

Use Glob to scan for directories that likely contain docs:
- `docs/`, `doc/`, `documentation/`, `wiki/`
- Also check one level deeper: `docs/dev/`, `docs/api/`, etc.

Use AskUserQuestion to confirm or override:
- If found: offer the detected directories as options, let user pick
- If multiple: ask which is the primary "living docs" directory
- If none: ask the user to specify

This becomes `project.docsDir` in the config.

### Step 3: Plans and PRDs directories

Use AskUserQuestion to ask where implementation plans and PRDs should go. Offer sensible defaults based on the docs directory found in Step 2:
- Plans default: `<docsDir>/plans` or `docs/plans`
- PRDs default: `<docsDir>/prds` or `docs/prds`

### Step 4: Select directories to index for RAG

List all top-level directories using `ls`, excluding obvious noise:
- Skip: `node_modules`, `.git`, `dist`, `build`, `.next`, `.claude`, `coverage`, `__pycache__`, `.venv`, `target`, `vendor`

Use AskUserQuestion to let the user select which directories to include in RAG indexing. Pre-select directories that look like docs or source code.

### Step 5: Generate root.config.json

Write `root.config.json` to the project root using the Write tool. Populate all fields from the user's answers:

```json
{
  "project": {
    "name": "<detected or specified>",
    "docsDir": "<from step 2>",
    "plansDir": "<from step 3>",
    "prdsDir": "<from step 3>"
  },
  "ingest": {
    "include": ["<from step 4>"],
    "exclude": ["**/node_modules/**", "**/dist/**", "**/build/**", "**/_archive/**"],
    "extensions": [".md"]
  },
  "docMappings": [],
  "labelMappings": [],
  "keywordMappings": [],
  "codingStandards": [],
  "validation": {
    "lintCommand": "",
    "testCommand": ""
  }
}
```

Leave mappings and standards empty — the user fills these in as they use Root. Don't generate boilerplate they'll have to delete.

### Step 6: Install templates

Run the plugin's `init.sh` script via Bash to install:
- `.claude/context/workflow.md`
- `<plansDir>/TEMPLATE.md`
- `.claude/agents/*.md` (agent templates)

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/init.sh .
```

Note: `init.sh` will skip config generation since `root.config.json` already exists from Step 5.

### Step 7: Ingest docs into RAG

Use the `mcp__plugin_root_local-rag__ingest_file` tool to ingest each markdown file in the selected directories. Use Glob to find all `.md` files in the include directories (respecting exclude patterns), then call `ingest_file` for each.

For large projects (>100 files), use Bash to call the mcp-local-rag CLI instead:
```bash
RAG_BIN="${HOME}/.claude/plugins/data/root/node_modules/.bin/mcp-local-rag"
$RAG_BIN ingest --db-path .claude/rag-db --cache-dir "${HOME}/.cache/mcp-local-rag/models" <directory>
```

Report the count when done:
> Ingested **486 files** into RAG.

### Step 8: Output summary

```
=== Root Init Complete ===

Project: my-project (TypeScript/Node.js)
Config: root.config.json
Docs: docs/dev/app/
Plans: docs/dev/plans/
RAG: 486 files ingested

Next:
- Customize .claude/agents/specialist-*.md for your stack
- Fill in docMappings/labelMappings in root.config.json as you work
- Run /root:root <task> to start your first session
```
