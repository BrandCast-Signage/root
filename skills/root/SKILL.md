---
name: root
description: "Root development workflow framework. Classifies work tier, fetches issue context, loads relevant docs via RAG, drives planning, and initializes session tracking. Run at the start of every task. Examples: /root fix issue 1132, /root new calendar integration, /root #1234"
user-invocable: true
argument: task - description of the work (e.g., "fix issue 1132", "#1234", "new weather integration", "reset")
---

# /root — Development Workflow Session Init

Entry point for the Root development workflow framework. Provides tier-based planning, doc-aware context gathering, and session tracking.

## Configuration

Root reads project-specific settings from `root.config.json` in the project root. If the config file doesn't exist, use sensible defaults:
- `docsDir`: `"docs"`
- `plansDir`: `"docs/plans"`
- `prdsDir`: `"docs/prds"`
- Mappings: empty (skip Step 5 recommendations)

## Protocol

Execute all steps in order. Steps 1-7 run autonomously. Step 8 drives planning (tier-dependent). Step 9 generates tasks after plan approval.

### Step 0: Check for existing session

Before anything else, check if `/tmp/root-session.json` exists.

**If the argument is `reset`:**
- Delete `/tmp/root-session.json` if it exists
- Output: "Root session cleared."
- Stop.

**If session file exists AND contains a `plan_path` field:**
- Read the session file
- Output: "Existing Root session found for #<issue number> (<tier>). Re-planning from cached context."
- Skip directly to Step 8. All context (issue, docs, tier, recommendations) is preserved in the session file.

**Otherwise:** proceed to Step 1.

### Step 1: Parse the argument

Extract from the argument text:
- **Issue number** — from any format: `#1234`, `issue 1234`, `GH-1234`, bare number, or `github.com/.../issues/1234` URL
- **Task description** — the remaining text after extracting the issue number

If no argument was provided, ask the user what they're working on and stop.

### Step 2: Fetch issue context (if issue number found)

Run:
```bash
gh issue view <number> --json number,title,body,labels,state,assignees
```

Store the result. The issue title, body, and labels inform tier classification and doc matching.

### Step 3: Classify tier

Using the task description AND issue context (if available), classify as:

| Tier | Criteria |
|------|----------|
| **Tier 1** (Full Process) | New features, large refactors, multi-package changes, schema changes, new integrations, architectural work. Hours-to-days scope. |
| **Tier 2** (Light Process) | Bug fixes, single-file changes, config updates, dependency bumps, small improvements. Minutes-to-an-hour scope. |

Rules:
- If the user explicitly says "tier 1", "full process", "tier 2", or "quick fix" in the argument, honor that override
- Use issue labels as a strong signal: `type:feature` leans Tier 1, `type:bug` leans Tier 2
- When genuinely ambiguous, default to Tier 2 — the user can override

### Step 4: Load relevant docs

1. Query the RAG database for relevant documentation:
   ```bash
   RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
   DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
   CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<query from task description + issue title/body>"
   ```
   - Use `limit: 10` to get a broad set of results
   - Filter results: use chunks with score < 0.3 directly, consider 0.3-0.5 if relevant, skip > 0.5
2. From the query results, identify the top 1-3 most relevant **unique documents** (by filePath)
3. Read those docs using the Read tool for full context
4. If no results score below 0.5, that's fine — not every task needs background docs
5. **Fallback**: If the RAG server is unavailable, fall back to matching by keyword

### Step 5: Recommend skills and agents

Read `root.config.json` and match against all three mapping types:

#### Doc path matching
For each doc loaded in Step 4, check its path against `docMappings[].pattern` (regex match). Collect matching `agents` and `skills`.

#### Issue label matching
For each label on the issue, check against `labelMappings[].label`. Collect matching `agents`.

#### Task keyword matching
For each entry in `keywordMappings`, check if any `keywords` appear in the task description or issue title/body. Collect matching `agents`.

#### Rules
- Deduplicate: if multiple signals point to the same agent/skill, list it once
- Limit to 1-3 skills and 1-3 agents — only the most relevant
- If no signals match (or no config), omit the section

### Step 6: Initialize session state

Write `/tmp/root-session.json` (overwrite if exists):

```json
{
  "tier": "tier1|tier2",
  "issue": {
    "number": 1132,
    "title": "...",
    "labels": ["area:frontend", "type:feature"],
    "state": "OPEN"
  },
  "docs_read": ["docs/AUTH_SYSTEM.md"],
  "docs_suggested": [],
  "skills_recommended": [],
  "agents_recommended": ["specialist-backend"],
  "plan_path": null,
  "files_edited": [],
  "docs_edited": [],
  "started": "2026-03-19T12:00:00Z"
}
```

- `issue` is `null` if no issue was referenced
- `docs_read` contains paths of docs actually read in Step 4
- `skills_recommended` and `agents_recommended` come from Step 5 (empty arrays if no matches)
- `plan_path` is `null` initially — set by Step 8 when a plan is written
- Other arrays start empty — populated by PostToolUse and Stop hooks during the session

### Step 7: Output kickoff summary

Print a structured summary. Example for Tier 2:

```
## Root Session Initialized

**Tier**: 2 (Light Process) — [brief reason]
**Issue**: #1132 — Fix auth token refresh loop
**Labels**: area:backend, type:bug
**State**: OPEN

### Docs Loaded
- `docs/AUTH_SYSTEM.md` — Authentication System

### Recommended Agents
- **Agent**: `specialist-backend` — area:backend label, auth-related docs

### Workflow (Tier 2)
1. Understand → Read the relevant code, trace the issue
2. Fix → Make the change
3. Validate → lint + type-check + relevant tests
4. Commit → Conventional commit format
```

Example for Tier 1:

```
## Root Session Initialized

**Tier**: 1 (Full Process) — [brief reason]
**Issue**: #1200 — New weather integration
**Labels**: area:backend, type:feature

### Docs Loaded
- `docs/INTEGRATIONS.md` — Integration Architecture

### Recommended Agents
- **Agent**: `specialist-backend` — area:backend, integration-related docs

### Workflow (Tier 1)
1. PRD → Write in <prdsDir>
2. Implementation Plan → Write in <plansDir> using TEMPLATE.md
3. Review → Plan mode for human approval
4. Implement → Task tracking with TodoWrite
5. Validate → Full quality gate
6. Document → Update relevant docs
7. Commit → Zero errors, conventional format

### Next Step
Write the PRD. Use `team-architect` agent for design.
```

After outputting the summary, proceed to Step 8.

### Step 8: Drive planning phase

Planning is tier-dependent. Execute the appropriate path below.

Read `root.config.json` to get `project.plansDir` and `project.prdsDir`.

#### Tier 1 path: Implementation Plan

1. **Check for PRD**: Look for a PRD in `<prdsDir>` that matches the issue or task slug.
   - If no PRD exists, tell the user:
     > "Tier 1 requires a PRD before the implementation plan. Starting guided PRD authoring."
   - Run `/root:prd new <task description or issue number>` to guide the user through PRD creation.
   - After the PRD is written, continue to step 2 below. Do not stop or ask the user to re-run `/root`.

2. **Read the PRD**: Extract the functional requirements (REQ IDs), proposed solution, and technical scope. These drive the Change Manifest.

3. **Trace code paths**: Spawn up to 3 Explore agents in parallel. Each agent should:
   - Trace imports/exports for modules identified in the PRD
   - Identify all consumers of types/functions that will change
   - Check cross-package impact
   - Report: files affected, dependency order, existing patterns to follow

4. **Write the Implementation Plan**: Create `<plansDir>/<slug>.md` using the Implementation Plan template (check `<plansDir>/TEMPLATE.md`). Populate:
   - **Requirements Traceability** from PRD functional requirements
   - **Change Manifest** from the traced code paths — every file numbered, with action, section/function, description, linked reqs, and execution group
   - **Dependency Graph** as a Mermaid DAG using Change Manifest numbers (solid = hard dep, dashed = soft)
   - **Execution Groups** based on package boundaries and agent recommendations from Step 5
   - **Coding Standards Compliance** checklist — read `codingStandards` from `root.config.json`, plus proactive cleanup items found during tracing
   - **Risk Register** from cross-package impact analysis
   - **Verification Plan** with specific test/lint commands from `root.config.json` → `validation`

5. **Update session state**: Set `plan_path` in `/tmp/root-session.json` to the plan file path.

6. **Enter plan mode**: Use `EnterPlanMode` so the user can review and approve the Implementation Plan. Output:
   > "Implementation plan written to `<plansDir>/<slug>.md`. Entering plan mode for review."

#### Tier 2 path: Ephemeral plan via built-in plan mode

1. **Enter plan mode**: Use `EnterPlanMode` to create an ephemeral plan in `.claude/plans/` (or `.gemini/plans/` if using Gemini CLI).

2. **Write a lightweight plan** covering:
   - Files to change and what changes in each (code-section level)
   - Verification commands from `root.config.json` → `validation`
   - No persistent artifact needed — the commit message and PR description serve as source of record

3. **Update session state**: Set `plan_path` to the `.claude/plans/` (or `.gemini/plans/`) file path.

The plan is ready when the user approves it via plan mode. GitHub issue/PR linkage provides traceability.

### Step 9: Generate task list (after plan approval)

After the user approves the plan (exits plan mode), generate a task list.

#### Tier 1: Tasks from Change Manifest

Parse the Implementation Plan's Change Manifest and Execution Groups:
- Create one task per Execution Group (e.g., "Group A: Backend Pipeline — changes #1, #2, #3, #5")
- Add a verification task: "Run lint/type-check + specific tests from Verification Plan"
- Add a negative test task if the Verification Plan includes negative tests
- Add a documentation task if new systems are introduced
- Add a final task: "Create commit and PR"

#### Tier 2: Standard task template

Create the standard Tier 2 task list:
1. Understand the issue (read code, trace path)
2. Fix the issue
3. Run validation (from `root.config.json` → `validation.lintCommand`)
4. Run relevant tests
5. Create commit
