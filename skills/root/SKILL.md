---
name: root
description: "Start or continue a Root development session for a GitHub issue. On first invocation classifies tier, loads docs via RAG, and plans. On re-invocation drives the stream through implementation, review, and merge. Also handles orchestration verbs (list, status, approve, run, sync, delete, clean, reset)."
argument-hint: "#<issue> [description] [--auto] | #<epic> --auto | #<x> #<y> #<z> --auto --batch | list | status #<issue> | approve #<issue> | run | sync | delete #<issue> | clean | reset"
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
- `--batch` — explicit batch-mode signal. Required when the argument contains 2+ issue numbers; rejected with one issue. Forces `--auto` (batch without auto is meaningless).
- `--groups A,B` — limit execution to specific groups (passed through to `/root:impl`).

**Multi-issue invocation.** Count issue numbers in the argument. If 2+:
- Without `--batch`: reject — "Multiple issue numbers require `--batch`. Did you mean `/root #x #y #z --auto --batch`?"
- With `--batch` but without `--auto`: implicitly add `--auto`, surface a one-line note ("`--batch` implies `--auto`").
- With both: proceed to **Autonomous Multi-Issue Mode** (below) instead of phase-aware dispatch.

**Single-issue + `--auto`.** Single issue with `--auto` runs the readiness gate (below) before falling through to phase-aware dispatch. This is the existing single-issue autonomous path with the new gate in front.

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

### Step 2.5: Triage-status confirmation gate

Only runs on **fresh stream creation** (Step 0 routed via the "no stream" branch). Skip if the stream already exists.

If the issue's labels include `status:roadmap` or `status:backlog`, stop and confirm before continuing:

- `status:roadmap` — on the immediate roadmap but not necessarily the next thing to pull.
- `status:backlog` — has merit but is not prioritized for work.

Both are signals that picking this up now may not be intentional. Use `AskUserQuestion` to confirm:

> "Issue #<number> is labeled `<status:roadmap|status:backlog>`. Do you want to start work on it now?"

- If the user declines, stop. Do not call `board_start`.
- If the user confirms, continue to Step 3.
- If `--auto` was extracted in Step 0, skip this gate — passing `--auto` on a roadmap/backlog issue is explicit pre-approval.

### Step 3: Extract tier override (if any)

Tier classification is owned by the MCP. `board_start` inspects the issue's labels, title, and body via `classifyTier` (`mcp/mcp-root-board/src/classify.ts`) and writes a definite tier to the stream record. You do **not** classify tier yourself here.

| Tier | Criteria (used by `classifyTier`) |
|------|----------|
| **Tier 1** (Full Process) | `type:refactor`/`type:epic`/`type:security` labels, or Tier 1 keywords (refactor, migration, rewrite, schema change, architecture) in title/body. (`type:feature` is **not** a Tier 1 signal — triage over-applies it; feature issues classify by keywords.) |
| **Tier 2** (Light Process) | `type:bug`/`type:chore`/`type:docs`/`type:dependencies` labels, or Tier 2 keywords (fix, typo, bump, patch, hotfix, update dep). Also the policy for ambiguous cases. |

Your job in this step: extract an explicit user override from the argument, if one was given.

- If the user said "tier 1" / "full process" / "--tier 1" → pass `tier: "tier1"` AND `tierJustification: "<exact phrase the user used>"` to `board_start` in Step 6.
- If the user said "tier 2" / "quick fix" / "--tier 2" → pass `tier: "tier2"` AND `tierJustification: "<exact phrase the user used>"`.
- Otherwise pass no `tier` argument and let `classifyTier` decide. Do **not** invent a justification just to override the classifier — `board_start` will reject blank/whitespace `tierJustification` values, and the failure mode (a Tier 1 stream you mentally treat as Tier 2) is worse than letting the classifier decide.

`board_start`'s response line (`Tier: tierX (reason)`) reports the classification and why. Surface the reason to the user in the Step 7 summary.

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

Call `board_start` MCP tool with the issue number. If `--auto` was extracted in Step 0 AND this is a fresh stream (no prior stream existed), pass `autoApprove: true` as well — this sets the stream to fully autonomous so all gates (including Tier 1 `plan_approval`) auto-advance. If a tier override was extracted in Step 3, pass `tier: "tier1"` or `tier: "tier2"` accordingly **and** pass `tierJustification` quoting the user's actual words; otherwise omit both and the MCP will classify from issue data. `board_start` rejects an override with a blank `tierJustification`.

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

## Autonomous Multi-Issue Mode

Triggered by `/root #<epic> --auto` (epic mode) or `/root #x #y #z --auto --batch` (batch mode). Both share the same orchestration spine; they differ only in how children are resolved.

### Orchestration spine

The orchestrator runs in this main harness conversation. Each child issue is dispatched as a `Agent` tool subagent with `isolation: worktree` so per-child execution does NOT consume the orchestrator's context. The orchestrator's only jobs are: readiness gating, sequencing, shared-context curation, PR assembly, and notification.

**Critical context-window discipline.** Everything load-bearing for resuming the run after auto-compaction must be on disk in the shared-context file, not in the conversation. This includes: which children have completed, which is currently running, the running child's worktree path, the partial PR URL once opened, and any architectural decisions a future child needs. Treat the conversation as scratch space; treat shared-context as the durable state.

### Step A0: Readiness gate (mandatory in autonomous mode)

Before creating any stream:

1. For epic mode: collect the epic issue number plus its children (via `gh api graphql` sub-issues query, same shape as `getSubIssues`).
   For batch mode: the explicit list from the argument.
2. For each issue (epic + every child, or every batch member), spawn the `issue-readiness-grader` agent. Pass the issue number; the agent reads the body via `gh issue view` and returns strict JSON.
3. Collect verdicts. If any return `needs-clarification`, **enter the interview loop** (next step). Do NOT skip, do NOT offer a `--force` flag, do NOT bypass.
4. Only when every issue grades `ready` does the orchestrator proceed to Step A1.

### Step A1: Interview loop (entered on any `needs-clarification`)

Round budget: **3 grading rounds total**. Round 4 is a hard stop.

Per round:

1. Aggregate concerns and questions across all issues that failed. Print a concise per-issue panel:
   ```
   #<n>: <title>
     Concerns: <list of short concern identifiers>
     Questions:
       1. <question>
       2. <question>
   ```
2. Ask the user. Use `AskUserQuestion` for the answers — one block per issue, with a free-form text input. Allow the user to type `abort` at any prompt to cancel the run; allow `skip <n>` to drop a specific child from the run (epic mode only — batch members are explicit, dropping one is the user's call to re-invoke).
3. For each issue with answers, append a `## Clarifications (added by /root readiness gate, <ISO-timestamp>)` section to the issue body via `gh issue edit <n> --body "<full new body>"`. Quote each question and the user's answer underneath.
4. Re-grade every issue that just received clarifications.
5. If all issues now grade `ready`, exit the loop and proceed to Step A2.
6. If the round counter is at 3 and any issue still grades `needs-clarification`, hard-stop with: "After 3 rounds the readiness gate is still failing. Either the rubric is wrong or the issue needs hand-revision before Root can take it. Concerns remaining: <list>." Do not create any stream.

### Step A2: Create parent stream

Call `board_epic_start({ epicIssue, mode, children })`:
- `mode: "epic"` — `children` argument omitted; the MCP resolves via sub-issues.
- `mode: "batch"` — `children` array is the explicit list from the argument.

The parent stream's branch is `feat/epic-<n>-<slug>` or `chore/batch-<n>-<slug>`. Create the worktree at this branch (use the same `createWorktree` machinery `board_start` uses; reuse via the parent's recorded `branch`).

Append a kickoff note to shared-context:
```
board_shared_append({
  epicIssue: <n>,
  note: "Run started. Mode: <epic|batch>. Children in order: <list>. Branch: <epicBranch>."
})
```

### Step A3: Per-child dispatch loop

For each child in declared order:

1. **Tier check.** Call `board_status` on the child if a stream already exists; otherwise pre-classify via `gh issue view` + the same heuristics `classifyTier` uses. In **batch mode**, any tier-1 child triggers a hard stop (`sendDiscord('blocker', ...)`) — batch is for tier-2 sweeps only. In **epic mode**, tier-1 children are allowed but their `plan_approval` gate will pause the run; the parent's `autoApprove` does NOT cascade to children automatically (per-child `autoApprove` is set in the next step).

2. **Read shared-context.** Call `board_shared_get({ epicIssue: <parent> })`. Pass the contents into the subagent prompt so the child has the same orientation as everyone before it.

3. **Spawn subagent.** Use the `Agent` tool with `isolation: worktree`, `subagent_type: team-implementer` (or a more specific specialist if `root.config.json` mappings suggest one), and a prompt that:
   - Tells the child what issue it owns (`#<n>`)
   - Includes the full shared-context
   - Tells the child to commit DIRECTLY onto the parent's `epicBranch` (not a per-child branch) and to stop after committing — no PR creation per child
   - Tells the child to emit a structured "Result" block at the end: commits made, files touched, deviations from the issue body, target metrics
   - Sets `autoApprove: true` for the child stream so its own gates don't pause the run

4. **Collect result.** Wait for subagent return. Parse the Result block.

5. **Append summary to shared-context.** One concise entry per child: issue number, commit SHAs, files touched, deviations, target metrics. This is what protects against auto-compact — the orchestrator may forget what the child did, but the file remembers.

6. **Update / open PR.** On first completed child: open the PR as draft (`gh pr create --draft --base main --head <epicBranch>`). On every subsequent child: `gh pr edit` to refresh the body, adding the new `Closes #<n>` line and the new check entry. PR title:
   - Epic: `<epic-title> (epic #<epic-num>)`
   - Batch: `chore: batch fixes (#x, #y, #z)`
   PR body sketch:
   ```
   Autonomous <epic|batch> run.

   - [x] #101 — <title> (sha: abc123)
   - [x] #102 — <title> (sha: def456)
   - [ ] #103 — pending

   Closes #101
   Closes #102
   ```

7. **Project sync per child.** `board_start` already sets the child's Project Status to `In Progress` (issue #8). The native PR-linked workflow will move each `Closes #<n>` issue to `Review` once the PR is opened.

8. **On child failure or hard-stop.** Stop dispatching further children. Fire `sendDiscord('blocker', ...)` with the failed issue number and reason. Update the PR body with a `⚠ Partial completion` callout above the checklist. PR stays draft. Update parent stream status to `epic-blocked` or `epic-partial`. Append a concluding note to shared-context.

### Step A4: Run completion

When all children complete successfully:

1. Append final note to shared-context summarizing the run.
2. Update parent stream status to `epic-complete`.
3. Fire `sendDiscord('epic_complete', ...)` with the PR URL.
4. PR stays draft until the user explicitly flips it to ready (deliberate — gives the user a final chance to scan the assembled diff before review starts). Print: "Epic #<n> complete. PR #<pr-num> is ready for review (currently draft). Flip to ready with `gh pr ready <pr-num>` when satisfied."

### Auto-compact resilience

Re-invoking `/root #<epic> --auto` on a partially-completed epic should pick up where it left off:

1. `board_status` on the epic returns `kind: 'epic'`, `status: 'epic-running' | 'epic-blocked' | 'epic-partial'`.
2. The orchestrator loads shared-context, identifies the last completed child by scanning the file's checklist entries, and dispatches the next pending child in the declared order.
3. The PR exists; the orchestrator updates it rather than creating a new one.

This means: **never destroy shared-context mid-run.** The 32KB overflow trigger is intentional — silent truncation would defeat resumability.
