# Root

Development workflow framework for Claude Code and Gemini CLI.

Root provides **tier-based planning**, **doc-aware context gathering**, **RAG-powered search**, **multi-feature orchestration**, and **autonomous issue-to-PR workflows**.

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
| `/root <task>` | Start a development session — context gathering + planning |
| `/root:board [action]` | Board orchestration: `list`, `start`, `status`, `approve`, `run`, `sync`, `clean` |
| `/root:init` | Interactive project setup |
| `/root:prd [action]` | PRD authoring: `new`, `edit`, `review`, `list` |
| `/root:impl [action]` | Execute a plan: `run`, `resume`, `status`, `finalize` |
| `/root:explore [action]` | RAG-powered codebase exploration: `topic`, `flow`, `map` |
| `/root:rag [action]` | Manage RAG database: `status`, `ingest`, `refresh`, `clear`, `config`, `scan` |
| `/root:docs [action]` | Documentation management: `health`, `search`, `stale`, `scan`, `validate`, `fix`, `create` |

## Usage

### Board Orchestration (v2.0)

Run multiple features in parallel with autonomous issue-to-PR progression:

```
/root:board start #42             # Create a work stream for an issue
/root:board start #58             # Start another — each gets its own worktree
/root:board run                   # Auto-progress all streams through gates
/root:board                       # View all active streams and their status
/root:board approve #42           # Green-light a Tier 1 plan
/root:board sync                  # Sync local state with GitHub labels
/root:board clean                 # Tear down merged worktrees
```

**How it works:** Each stream progresses through a state machine (`queued → planning → plan-ready → approved → implementing → validating → pr-ready → merged`). Gates at each transition determine whether to auto-advance or pause for human approval. Tier 2 work (bug fixes) runs fully autonomously to PR. Tier 1 work pauses once for plan approval, then runs autonomously.

Streams are tracked locally in `.root/board/` and reflected on GitHub issues via labels (`root:planning`, `root:plan-ready`, `root:approved`, `root:implementing`, `root:pr-ready`). Approve from anywhere — CLI, GitHub UI, or your phone.

### Core Workflow

```
/root fix issue 1132      # Start session from a GitHub issue
/root new auth system      # Start session from a description
/root #1234                # Shorthand for issue number
/root reset                # Clear current session

/root:prd new #1234              # Guided PRD creation from an issue
/root:prd review auth-refresh    # Quality review of a PRD
/root:prd list                   # List all PRDs in the project

/root:impl                       # Execute the approved plan
/root:impl status                # Check implementation progress
/root:impl resume                # Pick up where you left off

/root:explore topic auth         # Explore a topic across the codebase
/root:explore flow login         # Trace a flow end-to-end
/root:explore map                # Map the codebase architecture

/root:rag status                # Check RAG database state
/root:rag refresh               # Re-ingest all docs after major changes
/root:rag scan                  # Discover new directories to index

/root:docs health               # Dashboard of doc coverage and freshness
/root:docs search oauth         # Find docs about a topic
/root:docs stale                # Find outdated documentation
/root:docs scan                 # Find undocumented code, triage, generate docs
/root:docs create src/services/auth.ts  # Generate a doc from source code
/root:docs validate             # Check frontmatter across all docs
/root:docs fix                  # Auto-add missing frontmatter
```

### What Root Does

1. **Parses** your task (extracts issue number, description)
2. **Fetches** GitHub issue context (title, labels, body)
3. **Classifies** as Tier 1 (full process) or Tier 2 (light process)
4. **Loads** relevant docs via RAG semantic search
5. **Recommends** specialist agents based on config mappings
6. **Tracks** your session (files edited, docs read, board stream state)
7. **Drives planning**:
   - **Tier 1**: Guided PRD → Implementation Plan with Change Manifest, Dependency Graph, Execution Groups, and Verification Plan
   - **Tier 2**: Uses built-in plan mode for lightweight planning
8. **Executes** via `/root:impl` — parallel agents across Execution Groups, validation checkpoints, test generation, doc creation, and commit/PR
9. **Or orchestrates** via `/root:board run` — autonomous progression through gates, GitHub label lifecycle, and PR creation with zero human intervention (Tier 2) or one approval (Tier 1)

### Two-Tier Workflow

| | Tier 1 (Full Process) | Tier 2 (Light Process) |
|---|---|---|
| **When** | New features, large refactors, multi-package changes | Bug fixes, small changes, config updates |
| **Planning** | Guided PRD → Implementation Plan → Human review | Built-in plan mode (ephemeral) |
| **Artifacts** | Persistent plan in `<plansDir>/` | Commit message + PR |
| **Traceability** | Change Manifest → PRD requirements | GitHub issue/PR linkage |

### Documentation Onboarding

For projects with incomplete or missing documentation:

```
/root:docs health     # See the current state
/root:docs fix        # Repair/add frontmatter on existing docs
/root:docs scan       # Discover undocumented code → triage → generate docs
/root:docs health     # See the improvement
```

The `scan` command runs as a single interactive pipeline: it discovers undocumented code components using heuristics (or `docTargets` config), presents them grouped by priority for triage, and generates first-draft docs with proper frontmatter for selected items.

### Frontmatter

Root workflows depend on frontmatter in `.md` files for health tracking, freshness detection, and validation. Required fields:

```yaml
---
title: Authentication Service
type: service
status: active
created: 2025-08-15
updated: 2026-03-10
---
```

| Field | Values |
|-------|--------|
| `title` | Non-empty string |
| `type` | `doc`, `plan`, `prd`, `adr`, `guide`, `spec`, `research`, `service`, `api`, `package`, `module` |
| `status` | `draft`, `active`, `completed`, `deferred`, `cancelled`, `superseded`, `archived` |
| `created` | `YYYY-MM-DD` |
| `updated` | `YYYY-MM-DD` (must be >= `created`, no future dates) |

A write-time hook warns when `.md` files in doc directories are saved without valid frontmatter.

## Templates

Root installs two templates during `/root:init`:

**Implementation Plan** (`<plansDir>/TEMPLATE.md`) — Used by Tier 1 planning. Includes Context, Scope, Requirements Traceability, Change Manifest (numbered files with req linkage), Dependency Graph (Mermaid), Execution Groups, Coding Standards Compliance, Risk Register, and Verification Plan.

**PRD** (`<prdsDir>/TEMPLATE.md`) — Product Requirements Document. Required before Tier 1 implementation. Includes Problem Statement, Goals/Non-Goals, Functional Requirements (P0/P1/P2 with REQ IDs), Technical Considerations, Risks, and Success Metrics.

## Agents

Root includes 8 agent templates organized into team roles and specialist roles.

### Team Roles

| Agent | Model | Mode | Purpose |
|-------|-------|------|---------|
| `team-architect` | Opus | Read-only, plan mode | Designs implementation plans with change manifests and dependency graphs |
| `team-implementer` | Sonnet | Full read/write | Executes plan tasks, follows patterns, validates before completing |
| `team-reviewer` | Sonnet | Read + checks | Reviews code against plan and coding standards |
| `team-tester` | Sonnet | Test creation | Writes and validates tests, ensures coverage |

### Specialist Roles

| Agent | Focus Areas |
|-------|-------------|
| `specialist-backend` | API routing, auth, middleware, database queries, integrations |
| `specialist-frontend` | Components, state management, design system, forms, client routing |
| `specialist-database` | Schema design, ORM, migrations, indexes, data integrity |
| `specialist-devops` | CI/CD, containers, environments, secrets, monitoring, deployments |

Specialist agents are templates — customize their expertise areas and key references per project.

## Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `ensure-mcp.sh` | Session start | Auto-installs RAG + board MCP servers, checks `gh` auth, auto-ingests if DB is empty |
| `track-edits.sh` | After file write/edit | Tracks edited files in session state, warns on missing frontmatter |
| `track-doc-reads.sh` | After file read | Tracks doc reads in session state |
| `context-receipt.sh` | Session end | Outputs session summary (tier, issue, files, docs) |
| `doc-update-check.sh` | Session end | Reminds to update docs when Tier 1 source was edited |

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
    "dbPath": ".root/rag-db",
    "docs": ["docs/"]
  },
  "docMappings": [
    { "pattern": "AUTH|OAUTH", "agents": ["specialist-backend"], "skills": [] }
  ],
  "labelMappings": [
    { "label": "area:frontend", "agents": ["specialist-frontend"] }
  ],
  "keywordMappings": [
    { "keywords": ["schema", "migration", "database"], "agents": ["specialist-database"] }
  ],
  "docTargets": [
    { "glob": "packages/*/src/index.ts", "type": "package", "docsDir": "docs/packages" },
    { "glob": "apps/*/src/services/*.ts", "type": "service", "docsDir": "docs/services" }
  ],
  "codingStandards": [
    "All exports have JSDoc",
    "No `any` types"
  ],
  "validation": {
    "lintCommand": "npm run lint && npm run type-check",
    "testCommand": "npm test -- <pattern>"
  },
  "board": {
    "gates": {
      "plan_approval": { "tier1": "human", "tier2": "auto" },
      "reviewer_pass": "auto",
      "validation": "auto",
      "pr_creation": "auto"
    },
    "maxParallel": 3
  }
}
```

### Mapping Types

Root uses three mapping types to recommend agents for a task:

- **docMappings**: Regex against loaded doc paths → agents/skills
- **labelMappings**: GitHub issue labels → agents
- **keywordMappings**: Keywords in task description → agents

### docTargets (optional)

Override default heuristics for `/root:docs scan`. Each entry maps a glob pattern to a doc type and output directory. When present, `scan` uses these instead of built-in heuristics.

### Board Gates

The `board.gates` section controls which transitions require human approval:

| Gate | Default | Purpose |
|------|---------|---------|
| `plan_approval` | `tier1: human, tier2: auto` | Whether plans need human review before implementation |
| `reviewer_pass` | `auto` | Whether code review gates auto-advance |
| `validation` | `auto` | Whether lint/type/test validation auto-advances |
| `pr_creation` | `auto` | Whether PR creation is automatic |

Set any gate to `"human"` to always pause, `"auto"` to always advance, or use `{ "tier1": "human", "tier2": "auto" }` for tier-specific behavior.

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| `root` | Skill | Workflow entry point — context + planning |
| `mcp-local-rag` | Skill | RAG query/ingest guidance |
| `mcp-root-board` | MCP Server | Board orchestration — state machine, worktree lifecycle, GitHub integration, gates |
| `root:board` | Command | Board management (7 subcommands) |
| `root:init` | Command | Interactive project setup |
| `root:prd` | Command | Guided PRD authoring (4 subcommands) |
| `root:impl` | Command | Plan execution with parallel agents (4 subcommands) |
| `root:explore` | Command | RAG-powered codebase exploration (3 subcommands) |
| `root:rag` | Command | RAG database management (6 subcommands) |
| `root:docs` | Command | Documentation management (7 subcommands) |
| Session hooks | Hooks | Track edits, doc reads, frontmatter enforcement, context receipts |
| Agent templates | Agents | Team (architect/implementer/reviewer/tester) + specialist (backend/frontend/database/devops) |
| Model rubric | Reference | When to use Opus vs Sonnet, Claude vs Gemini per workflow phase |
| Plan template | Template | Tier 1 implementation plan structure |
| PRD template | Template | Product requirements document structure |

## Updating

### Claude Code

```
/plugin marketplace update root-plugins
/plugin update root@root-plugins --scope local
/reload-plugins
```

### Gemini CLI

```bash
gemini extension update root
```

## Cross-Harness Support

Root works with both Claude Code and Gemini CLI. The board orchestration layer enables them to work on the same project simultaneously:

- Each execution group within a feature can be assigned to a different harness
- Claude handles Group A in one worktree, Gemini handles Group B in another
- Both read/write the same board state (`.root/board/`) — no conflicts on different streams
- The model rubric (`skills/root/MODEL_RUBRIC.md`) guides when to use which model and harness

### Prerequisites

- **`gh` CLI**: Required for board GitHub features (labels, comments, PRs). Install: https://cli.github.com
- Run `gh auth login` before using board commands
- If `gh` is not authenticated, board still works locally — GitHub features are skipped gracefully

## Known Limitations

**Board MCP required**: The `mcp-root-board` MCP server must be available for session tracking. It is auto-installed by the `ensure-mcp.sh` session-start hook. Session state is stored per-issue at `.root/board/<issue>.json`.

## License

[MIT](LICENSE)

## Family

Root is part of the BrandCast agent family:
- **Chip** — AI chat assistant
- **Twig** — AI styling assistant
- **Bark** — Infrastructure & environment management plugin
- **Root** — Development workflow framework
