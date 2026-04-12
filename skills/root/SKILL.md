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

Before anything else:

**If the argument is `reset`:**
- Call `board_clean` MCP tool to remove completed streams.
- Output: "Root session cleared."
- Stop.

**If an issue number is present in the argument:**
1. Call the `board_status` MCP tool with that issue number.
   - If a stream exists AND has a `planPath` value, output: "Existing Root session found for #<issue number> (<tier>). Re-planning from cached context." then skip directly to Step 8 using the board stream's data.
   - If no stream exists, proceed to Step 1.

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

Call `board_start` MCP tool with the issue number. This creates the board stream (or is a no-op if already started by a prior `root:board start`). Then call `board_run` to advance the status from `queued` to `planning`.

The board stream at `.root/board/<issue>.json` is the sole source of truth for session state. Do NOT write `/tmp/root-session.json`.

### Step 7: Output kickoff summary

Print a structured summary. Example for Tier 2:

```
## Root Session Initialized

**Tier**: 2 (Light Process) — [brief reason]
**Issue**: #1132 — Fix auth token refresh loop
**Stream**: #1132 (planning)
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

### Next Step
- **Autonomous**: Run `/root:board run #1132` for autonomous execution.
- **Manual**: Make the change, validate, and commit.
```

Example for Tier 1:

```
## Root Session Initialized

**Tier**: 1 (Full Process) — [brief reason]
**Issue**: #1200 — New weather integration
**Stream**: #1200 (planning)
**Labels**: area:backend, type:feature

### Docs Loaded
- `docs/INTEGRATIONS.md` — Integration Architecture

### Recommended Agents
- **Agent**: `specialist-backend` — area:backend, integration-related docs

### Workflow (Tier 1)
1. PRD → Write in <prdsDir>
2. Implementation Plan → Delegated to `team-architect` (writes plan, traces code)
3. Review → Plan mode for human approval
4. Implement → Delegated to `team-implementer` per Execution Group (parallel worktrees)
5. Test → Delegated to `team-tester` (per group)
6. Review → Delegated to `team-reviewer` before commit
7. Validate → Full quality gate
8. Document → Update relevant docs
9. Commit → Zero errors, conventional format

### Next Step — MANDATORY
Tier 1 work MUST run through the agent team. Your next action is:
- **Autonomous**: Run `/root:board run #<issue>` to auto-progress through all phases.
- **Manual**: Run `/root:prd new` then spawn `team-architect`, then `/root:impl`.
```


After outputting the summary, proceed to Step 8.

### Step 8: Drive planning phase

Planning is tier-dependent. Execute the appropriate path below.

Read `root.config.json` to get `project.plansDir` and `project.prdsDir`.

#### Tier 1 path: Implementation Plan

**Delegation is mandatory.** The main thread does not write the Implementation Plan or trace code paths — it coordinates the team. Follow this sequence exactly.

1. **Check for PRD**: Look for a PRD in `<prdsDir>` that matches the issue or task slug.
   - If no PRD exists, tell the user:
     > "Tier 1 requires a PRD before the implementation plan. Starting guided PRD authoring."
   - Run `/root:prd new <task description or issue number>` to guide the user through PRD creation.
   - After the PRD is written, continue to step 2 below. Do not stop or ask the user to re-run `/root`.

2. **Spawn `team-architect`**: Use the Agent tool with `subagent_type: "team-architect"` and a prompt that:
   - Points the architect at the PRD file path
   - Points at `<plansDir>/TEMPLATE.md` as the required format
   - Points at `root.config.json` for coding standards and validation commands
   - Lists the agent recommendations from Step 5 as suggested Execution Group owners
   - Instructs the architect to: trace code paths (it may spawn its own Explore sub-agents), populate the full Implementation Plan (Requirements Traceability, Change Manifest, Dependency Graph, Execution Groups, Coding Standards Compliance, Risk Register, Verification Plan), write it to `<plansDir>/<slug>.md`, and call `ExitPlanMode` when ready for approval

   **Do NOT trace code paths or draft the plan in the main thread.** The architect owns this work end-to-end. Wait for it to return before proceeding.

3. **Update session state**: After the architect returns with the plan file path, call `board_run` with the issue number to evaluate the plan gate:
   - If `board_run` returns `{ "status": "ready" }` (auto gate), the stream advances automatically toward `approved`.
   - If `board_run` returns `{ "status": "blocked" }` (human gate), the stream pauses at `plan-ready` awaiting human approval via `board_approve` or the `root:approved` GitHub label.

4. **Ingest the plan into RAG**:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <plan-path>
   ```

5. **Relay plan mode to user**: The architect already called `ExitPlanMode`. Surface the plan to the user for review:
   > "Implementation plan written to `<plansDir>/<slug>.md` by `team-architect`. Review and approve to proceed to `/root:impl`."

#### Tier 2 path: Ephemeral plan via built-in plan mode

1. **Enter plan mode**: Use `EnterPlanMode` to create an ephemeral plan in `.claude/plans/` (or `.gemini/plans/` if using Gemini CLI).

2. **Write a lightweight plan** covering:
   - Files to change and what changes in each (code-section level)
   - Verification commands from `root.config.json` → `validation`
   - No persistent artifact needed — the commit message and PR description serve as source of record

3. **Update session state**: Call `board_run` with the issue number. For Tier 2 the `plan_approval` gate defaults to `auto`, so the stream will advance automatically.

The plan is ready when the user approves it via plan mode. GitHub issue/PR linkage provides traceability.

### Step 9: Hand off to implementation (after plan approval)

After the user approves the plan (exits plan mode), hand off to `/root:impl`:

> "Implementation Plan approved.
> - **Autonomous**: Run `/root:board run #<issue>` to auto-progress to PR.
> - **Manual**: Run `/root:impl` to execute step by step, or `/root:impl status` to review the plan."

The plan file is the source of truth — `/root:impl` reads the Change Manifest and Execution Groups directly. No intermediate task list is needed.
