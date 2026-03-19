# Root

Development workflow framework for Claude Code and Gemini CLI.

Root provides **tier-based planning**, **doc-aware context gathering**, **RAG-powered search**, **session tracking**, and **implementation plan generation**.

## Install

### For Claude Code

**1. Add the Marketplace**

```
/plugin marketplace add BrandCast-Signage/root
```

**2. Install the Plugin**

```
/plugin install root@root-plugins --scope local
/reload-plugins
```

### For Gemini CLI

**1. Install the Extension**

```bash
gemini extension install https://github.com/BrandCast-Signage/root
```

---

The extension auto-installs its RAG MCP server on first session start.

### Initialize Your Project

```
/root:init
```

This interactively detects your project structure, asks which directories contain docs and source code, generates `root.config.json`, installs templates, and ingests your docs into RAG.

## Commands

| Command | Description |
|---------|-------------|
| `/root:root <task>` | Start a development session — context gathering + planning |
| `/root:init` | Interactive project setup |
| `/root:ingest [action]` | Manage RAG embeddings: `ingest`, `refresh`, `status`, `clear` |
| `/root:doc-context <topic>` | Find relevant docs by topic |
| `/root:doc-health [mode]` | Audit doc freshness and gaps: `overview`, `stale`, `gaps`, `validate` |

## Usage

```
/root:root fix issue 1132      # Start session from a GitHub issue
/root:root new auth system      # Start session from a description
/root:root #1234                # Shorthand for issue number
/root:root reset                # Clear current session

/root:ingest status             # Check RAG database state
/root:ingest refresh            # Re-ingest all docs after major changes
/root:doc-context oauth         # Find docs about a topic
/root:doc-health stale          # Find outdated documentation
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

## Configuration

`root.config.json` in your project root:

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

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| `root` | Skill (model-invoked) | Workflow entry point — context + planning |
| `mcp-local-rag` | Skill (model-invoked) | RAG query/ingest guidance |
| `init` | Command | Interactive project setup |
| `ingest` | Command | RAG embedding management |
| `doc-context` | Command | Doc discovery by topic |
| `doc-health` | Command | Doc health auditing |
| Session hooks | Hooks | Track edits, doc reads, context receipts |
| Agent templates | Agents | Team (architect/implementer/reviewer/tester) + specialist (backend/frontend/database/devops) |

## Updating

```
/plugin marketplace update root-plugins
/plugin update root@root-plugins --scope local
/reload-plugins
```

## Family

Root is part of the BrandCast agent family:
- **Chip** — AI chat assistant
- **Twig** — AI styling assistant
- **Bark** — Infrastructure & environment management plugin
- **Root** — Development workflow framework
