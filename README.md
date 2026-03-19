# Root

Development workflow framework for Claude Code (and soon Gemini CLI).

Root provides **tier-based planning**, **doc-aware context gathering**, **RAG-powered search**, **session tracking**, and **implementation plan generation** — all driven by a single `/root <task>` command.

## Install

### As a Claude Code Plugin

```bash
# Clone the repo
git clone https://github.com/BrandCast-Signage/root.git ~/Code/root

# Register as a plugin (Claude Code will discover it from the marketplace config)
# Or symlink into your plugin cache
```

### Initialize a Project

```bash
# From your project directory
~/Code/root/scripts/init.sh .

# Or specify a target
~/Code/root/scripts/init.sh /path/to/my-project
```

This will:
1. Create `root.config.json` (edit to customize mappings)
2. Install workflow reference (`.claude/context/workflow.md`)
3. Install Implementation Plan template
4. Install agent templates (`.claude/agents/`)
5. Install RAG MCP server (`~/.local/lib/root-rag/`)
6. Generate initial doc index

### Configure

Edit `root.config.json` to match your project:

```json
{
  "project": {
    "name": "my-project",
    "docsDir": "docs",
    "plansDir": "docs/plans",
    "prdsDir": "docs/prds"
  },
  "ingest": {
    "include": ["docs/", "src/"],
    "exclude": ["**/node_modules/**"]
  },
  "docMappings": [
    { "pattern": "AUTH|OAUTH", "agents": ["specialist-backend"] }
  ],
  "codingStandards": [
    "All exports have JSDoc",
    "No `any` types"
  ],
  "validation": {
    "lintCommand": "npm run lint",
    "testCommand": "npm test"
  }
}
```

Customize `.claude/agents/specialist-*.md` for your stack — replace `[CUSTOMIZE]` sections.

## Usage

```
/root fix issue 1132      # Start a session from a GitHub issue
/root new auth system      # Start a session from a description
/root #1234                # Shorthand for issue number
/root reset                # Clear the current session
```

### What Root Does

1. **Parses** your task (extracts issue number, description)
2. **Fetches** GitHub issue context (title, labels, body)
3. **Classifies** as Tier 1 (full process) or Tier 2 (light process)
4. **Loads** relevant docs via RAG semantic search
5. **Recommends** specialist agents based on config mappings
6. **Tracks** your session (files edited, docs read)
7. **Drives planning**:
   - **Tier 1**: Produces a full Implementation Plan with Change Manifest, Dependency Graph, Execution Groups, and Verification Plan
   - **Tier 2**: Uses Claude's built-in plan mode for lightweight planning
8. **Generates tasks** from the plan's Execution Groups

### Two-Tier Workflow

| | Tier 1 (Full Process) | Tier 2 (Light Process) |
|---|---|---|
| **When** | New features, large refactors, multi-package changes | Bug fixes, small changes, config updates |
| **Planning** | PRD → Implementation Plan → Human review | Built-in plan mode (ephemeral) |
| **Artifacts** | Persistent plan in `<plansDir>/` | Commit message + PR |
| **Traceability** | Change Manifest → PRD requirements | GitHub issue/PR linkage |

### Implementation Plan Template

Tier 1 plans include:
- **Requirements Traceability** — maps PRD requirements to files
- **Change Manifest** — numbered table of every file change
- **Dependency Graph** — Mermaid DAG showing execution order
- **Execution Groups** — parallel work streams with agent assignments
- **Coding Standards Compliance** — checklist from config
- **Risk Register** — implementation-specific risks
- **Verification Plan** — specific test commands and scenarios

## Components

| Component | Purpose |
|-----------|---------|
| `/root` skill | Entry point — context gathering + planning |
| `/doc-context` skill | Find relevant docs by topic |
| `/doc-health` skill | Analyze doc freshness and gaps |
| RAG MCP server | Semantic + keyword search over project docs |
| Session hooks | Track edits, doc reads, context receipts |
| Agent templates | Team (architect/implementer/reviewer/tester) + specialist (backend/frontend/database/devops) |
| Workflow reference | Tier 1/2 process definitions |
| Plan template | Standardized Implementation Plan format |

## RAG Setup

Root uses [mcp-local-rag](https://www.npmjs.com/package/mcp-local-rag) for semantic doc search. The init script installs it to `~/.local/lib/root-rag/` to handle native binary dependencies (lancedb, mupdf).

To ingest docs:
```bash
~/Code/root/scripts/ingest.sh .
```

Or ask Claude Code: "ingest all docs into the RAG server"

## Family

Root is part of the BrandCast agent family:
- **Chip** — AI chat assistant
- **Twig** — AI styling assistant
- **Bark** — Infrastructure & environment management plugin
- **Root** — Development workflow framework
