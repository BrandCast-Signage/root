---
name: root
description: "Start or continue a Root development session for a GitHub issue. On first invocation classifies tier, loads docs via RAG, and plans. On re-invocation drives the stream through implementation, review, and merge. Also handles orchestration verbs (list, status, approve, run, sync, delete, clean, reset)."
argument-hint: "#<issue> [description] [--auto] | list | status #<issue> | approve #<issue> | run | sync | delete #<issue> | clean | reset"
user-invocable: true
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

### Step 0: Dispatch

`/root` is both the task entry point AND the orchestration driver. Re-running `/root #<issue>` is the universal "continue" gesture — every invocation inspects stream state and advances to the next actionable phase.

Parse the first token of the argument.

**Flag extraction.** Before matching verbs or issue numbers, scan the argument for these flags and remove them from the token stream:
- `--auto` — set the `autoApprove` flag. Effect depends on entry path (see below).
- `--groups A,B` — limit execution to specific groups (passed through to `/root:impl`).

**Reserved orchestration verbs** — if the first token matches one of these, dispatch and stop (no session init):

| Verb | Action |
|------|--------|
| `reset` | Call `board_clean`. Output "Root streams cleared." Stop. Ignore any issue number in the argument. |
| `list` | Call `board_list`. Output result. Stop. |
| `status [#issue]` | If issue given, call `board_status`; else `board_list`. Stop. |
| `sync` | Call `board_sync`. Output result. Stop. Ignore any issue number. |
| `delete <#issue>` | Requires an issue. Call `board_delete` with issue. Output result. Stop. If no issue is present, reject: "delete requires an issue number." |
| `clean` | Call `board_clean`. Output result. Stop. Ignore any issue number. |
| `approve <#issue>` | Requires an issue. Call `board_approve` with issue. Then fall through to phase-aware dispatch below for that issue (approval means "go"). If no issue is present, reject: "approve requires an issue number." |
| `run [#issue] [--groups A,B]` | If no issue and exactly one active stream exists, use it. If multiple, call `board_list` and ask which. Call `board_sync` first. Then fall through to phase-aware dispatch below. |

**Verb + issue normalization.** When a verb is matched AND an issue number also appears anywhere in the argument, use the issue as the verb's target — regardless of position. This handles natural-language variants like `/root list #1234` (treat as `status #1234` — the user clearly meant that one stream, not the whole list), `/root approve 1234`, `/root delete #42`. If the verb is one that ignores issues (`reset`, `sync`, `clean`), discard the issue with no error.

**Otherwise** — extract an issue number from the argument (formats: `#1234`, `1234`, `issue 1234`, `GH-1234`, `github.com/.../issues/1234`).

If no issue number is found, reject:

> "Root work is issue-anchored. Either pass an issue number (`/root #1234 <description>`) or file one first with `gh issue create`."

Stop.

**Phase-aware dispatch** (we now have an issue number):

1. Call `board_status` with the issue number.
2. Route based on the stream's status:

| Stream status | Action |
|---------------|--------|
| no stream | Proceed to Step 1 (fresh session init). |
| `queued` / `planning` | Proceed to Step 1 (resume planning). |
| `plan-ready` | Read `planPath` from the stream record. Output: "Plan at `<planPath>` awaiting approval. Re-run `/root #<issue>` after approving, or `/root approve #<issue>` to green-light now." Stop. |
| `approved` / `implementing` / `validating` / `pr-ready` | Dispatch `/root:impl #<issue>` (no subcommand — `/root:impl` phase-detects from `board_status` and starts at the correct step: Step 1 for `approved`/`implementing`, Step 8 for `validating`, Step 10c for `pr-ready`). Pass `--groups` if specified. After it returns, call `board_run` to advance state. If the new state is actionable (not `plan-ready` or terminal), re-evaluate this step. |
| terminal (`merged`, etc.) | Output: "Stream #<issue> is complete (`<status>`)." Stop. |

Only the "no stream" and "planning" branches fall through to Steps 1-8 below. All other actionable branches dispatch to `/root:impl` and loop on re-evaluation until the stream reaches a human gate (`plan-ready`) or terminal state (`merged`).

**`pr-ready` is not terminal.** A stream reaches `pr-ready` when the PR exists but CI may still be pending, review comments may be unresolved, and the merge hasn't happened. Re-invoking `/root #<issue>` drives the stream through Step 10c (CI poll), Step 10d (review resolution), and Step 10e (merge) until it reaches `merged`.

**`--auto` flag behavior** (when extracted above):

| Entry path | Effect |
|------------|--------|
| No stream exists (fresh creation) | Pass `autoApprove: true` to `board_start` in Step 6. All gates (including Tier 1 `plan_approval`) auto-advance for this stream. |
| Stream exists, status `plan-ready` | Treat as equivalent to `approve` — call `board_approve` with the issue, then fall through to phase-aware dispatch. |
| Stream exists, any other status | `--auto` is a no-op and a warning: "Stream #<issue> already exists with `autoApprove: <value>`. `--auto` only takes effect at stream creation. To green-light a specific gate, use `/root approve #<issue>`." Continue with phase-aware dispatch regardless. |

The MCP enforces this honestly: `board_run` at `mcp/mcp-root-board/src/index.ts:337` skips gate evaluation entirely when `stream.autoApprove === true`, including Tier 1 `plan_approval`. There is no "`--auto` does not override plan_approval" rule — if you see a message claiming that, the stream's `autoApprove` is `false`.

### Step 1: Parse the argument

The issue number was already extracted in Step 0 (this branch is only reached when an issue number is present). Now extract:
- **Task description** — the remaining argument text after removing the issue number and any leading reserved verb. This is in-the-moment context/color that augments the issue body.

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

Call `board_start` MCP tool with the issue number. If `--auto` was extracted in Step 0 AND this is a fresh stream (no prior stream existed), pass `autoApprove: true` as well — this sets the stream to fully autonomous so all gates (including Tier 1 `plan_approval`) auto-advance.

> **Warning:** `board_start` is destructive on existing streams — it calls `createStream` which overwrites. Step 0's phase-aware dispatch ensures we only reach Step 6 when no stream exists (the "no stream" branch), so this is safe in practice.

Then call `board_run` to advance the status from `queued` to `planning`.

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
- **Autonomous**: Re-run `/root #1132` — it will pick up from the current phase and drive through to PR-ready.
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
- **Autonomous**: Re-run `/root #<issue>` after plan approval — it will auto-progress through all remaining phases.
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
> - **Autonomous**: Re-run `/root #<issue>` — it will dispatch `/root:impl` and drive the stream to PR-ready.
> - **Manual**: Run `/root:impl` to execute step by step, or `/root:impl status` to review the plan."

The plan file is the source of truth — `/root:impl` reads the Change Manifest and Execution Groups directly. No intermediate task list is needed.
