---
description: Execute an Implementation Plan with validation and test generation
argument-hint: [#issue] | run | resume | status | finalize
---

# /root:impl — Implementation Plan Executor

Execute an approved Implementation Plan by walking through Execution Groups, validating at checkpoints, generating tests, resolving review, and merging.

Parse the first word of the argument to determine the action:
- A named subcommand (`run`, `resume`, `status`, `finalize`) — execute that subcommand explicitly.
- An issue number or no argument — **phase-detect** from `board_status` and start at the correct step (see "Phase-Aware Dispatch" below). This is the default and preferred entry point.

## Shared Setup

1. **Session state**: Call `board_status` MCP tool with the issue number. Extract `tier`, `planPath` (as `plan_path`), and `issue` from the board stream. The board stream is the sole source of truth. Do NOT read `/tmp/root-session.json`.
   - If no plan path is available from the board, it will be resolved in step 3 below.
2. **Project config**: Read `root.config.json`. Extract:
   - `validation.lintCommand` (e.g., `npm run lint && npm run type-check`)
   - `validation.testCommand` (e.g., `npm test -- <pattern>`)
   - `codingStandards` array
   - `project.docsDir` for doc generation
3. **Plan resolution** (priority order):
   a. Explicit argument path (e.g., `/root:impl run docs/plans/my-feature.md`)
   b. Session state `plan_path`
   c. If neither exists: "No plan found. Run `/root <task>` first." and stop.
4. **Read the plan file** and determine tier:
   - Has Change Manifest table + Execution Groups → Tier 1
   - Numbered step list without Change Manifest → Tier 2

## Autonomous Mode Contract

This contract applies across **every** step of `/root:impl`. Read the stream's `autoApprove` flag (from `board_status`) and honor it:

### When `autoApprove: true`

**Never prompt the user.** Do not call `AskUserQuestion`. Do not halt and ask "which option?" Do not wait for a reply. The flag exists to delegate judgment to you — exercise it.

**When you encounter a judgment call** (plan deviation, target metric miss, approach ambiguity, unexpected scope), follow this protocol:

1. **Decide** using your best analysis. State the decision in one line to the user log (so the session trace shows what happened).
2. **Document** the decision in a "Deviations from Plan" section you append to the PR body at Step 10b. Each entry: what deviated, why, what you chose, what impact.
3. **Proceed.** Do not stop for ratification.

**Target metric misses are not deviations.** If the plan has a "Target Metrics" section (LOC deltas, bundle size, test counts, etc.), missing a target is expected to be possible — those are directional, not contractual. Report actual vs target in the PR body's "Target Metrics" summary and proceed without surfacing it as a deviation.

**Database migration deviations are a mandatory halt in auto mode.** If a group touches a migration path (see Step 1) and the generated SQL diverges from the plan's Migration Safety section, OR any enumerated breaking-change risk is unaddressed by the generated SQL, OR the ORM workflow cannot be followed as documented — STOP and block. Do not auto-resolve. This is the one carve-out to the "decide and proceed" rule above. Migration shortcuts have repeatedly broken builds; the cost of halting is lower than the cost of a bad migration shipping under autoApprove.

**The only legitimate halt in auto mode:** an unrecoverable failure you cannot fix after best-effort attempts (tests fail deterministically after multiple fix attempts; build is broken and no rollback succeeds; MCP/gh/network outage persists), OR a migration deviation per the rule above. In that case:

1. Call `board_run` with a `blocked` signal (or update stream status to `blocked` via `updateStream` — the MCP tool handles this).
2. Post a PR comment (if a PR exists) or a GitHub issue comment (if not) describing the failure, what you tried, and what needs human judgment.
3. Stop.

### When `autoApprove: false` (manual)

Prompt as documented at each step. `AskUserQuestion` is available. Checkpoints require human confirmation. This is the default.

### Why this contract exists

Before this contract was explicit, `/root:impl` in auto mode still surfaced "which option?" prompts at points the protocol hadn't anticipated — notably plan-vs-actual deviations like LOC targets. That defeated the point of `--auto`. This section is the general rule; individual steps may further constrain behavior, but none may loosen it.

## Phase-Aware Dispatch (default)

When `/root:impl` is invoked with an issue number or no argument (i.e., no named subcommand), run Shared Setup and then route based on the stream's status:

| Stream status | Starting step | Rationale |
|---|---|---|
| `approved` / `implementing` | Step 1 (Parse Plan) | Full run through implementation → validation → PR → merge |
| `validating` | Step 8 (Generate Documentation) | Implementation complete; finalize docs + validation + PR |
| `pr-ready` | Step 10c (CI poll) | PR exists; drive CI polling, review resolution, and merge |
| `queued` / `planning` | Stop with: "Plan not ready. Run `/root #<issue>` to plan first." | Nothing to execute yet |
| `plan-ready` | Stop with: "Plan awaits approval. Run `/root approve #<issue>`." | Gated — requires human green-light |
| `merged` / terminal | Stop with: "Stream #<issue> is complete." | Nothing left to do |

This makes `/root:impl` idempotent — re-invoking picks up exactly where the stream left off. The named subcommands (`run`, `resume`, `status`, `finalize`) remain as explicit overrides for unusual cases; phase-aware dispatch is the normal path and is what `/root`'s orchestration loop calls.

### Entering Step 10c standalone (pr-ready)

When dispatching starts at Step 10c, the PR already exists. Look it up first:

1. Read the PR number from the stream record (`board_status` returns `prNumber` and/or `prUrl` after Step 10b stored it).
2. If the stream doesn't have a PR number (older streams), resolve it: `gh pr list --head <branch> --json number --jq '.[0].number'` using the stream's `worktreeBranch`.
3. Then execute 10c → 10d → 10e in order, using `autoApprove` from the stream record to decide auto vs manual merge.

## RAG Setup

Subcommands that generate docs use these variables:

```bash
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
```

## Plan Quality Rubric

Before executing any plan, validate it against this rubric. If the plan fails, stop and report what needs more detail. Do NOT proceed with a plan that fails the rubric.

**Every Change Manifest entry MUST have:**
- Exact file path (not "relevant files" or "files in src/")
- Specific function, method, or component name (not "relevant functions" or "as needed")
- Concrete description of what changes:
  - For `create`: expected exports, function signatures with parameter types and return types
  - For `modify`: what the current behavior is AND what it becomes
  - NOT acceptable: "investigate and fix", "update as needed", "handle edge cases", "refactor appropriately"
- At least one linked REQ ID

**Every Execution Group MUST have:**
- At least one test task specifying: which test file to create/update, and what scenarios to cover
- Clear sequence within the group (what order to change files)

**Verification Plan MUST have:**
- At least one automated check (lint, type-check, or test command with specific pattern)
- At least one concrete manual verification step (not "verify it works" — must describe what to do and what to expect)

**If any Change Manifest path matches a migration pattern, the plan MUST have a "Database Migration Safety" section.** Migration patterns: `prisma/schema.prisma`, `prisma/migrations/**`, `**/migrations/**/*.sql`, `alembic/versions/**`, `db/migrate/**` (Rails), `**/migrations/*.py` (Django). The Migration Safety section MUST contain:
- **Breaking-change enumeration**: explicit call-out for each of — nullability changes, column/table renames, column/table drops, type changes, index rebuilds that take write locks, data loss risk. For each, state "not applicable" or describe mitigation. "None" as a blanket answer fails the rubric.
- **Generated-SQL verification step**: the exact SQL the migration is expected to produce, or the command the implementer will run to inspect generated SQL before applying it (e.g., `prisma migrate dev --create-only` then read the file). Plans that say "Prisma will handle it" fail the rubric.
- **Rollout order**: which deploys in what order (schema → code, or code → schema → backfill, etc.). If the project has a documented migration workflow, reference it by path.
- **Reversibility**: whether the migration is reversible, and if not, what the recovery plan is.

If the plan touches migration paths but lacks this section, the rubric FAILS. Do not proceed.

**Requirements and Verification items MUST be behavioral/capability-based, not metric-based.** Pass/fail contracts describe *what the system does* ("FamilyCast path removed," "byte-parity with v1 fixtures," "regression test added for renderDeep"). Quantitative targets (LOC delta, bundle size, test count, duplication percentage, performance numbers) belong in the plan's **Target Metrics** section — where missing the number is reported, not blocked.

Reject any Requirement or Verification item matching patterns like:
- "≥ N lines removed / LOC reduction of N / net delta of −N"
- "Bundle size under N KB" (unless framed as a constraint: "does not exceed current bundle size" is behavioral — "reduces bundle by 10%" is a metric)
- "At least N tests added" (count — metric)
- "Coverage ≥ N%" (metric)

If the plan is missing a Target Metrics section but has metric-shaped items in Requirements or Verification, the rubric fails with instruction to move them.

**If the rubric fails**, output:
```
## Plan Quality Check — FAILED

<n> issues found:

1. Change #3 (src/services/foo.ts): Description "update as needed" is not specific enough.
   Required: describe what the current behavior is and what it becomes.

2. Group B: No test task specified.
   Required: at least one test task with file path and scenarios.

Fix these issues in the plan before running /root:impl.
```

## `run [plan-path]` (default)

Execute the Implementation Plan.

### Step 1: Parse the Plan

Read the plan file. For Tier 1, extract:
- **Change Manifest**: Parse the markdown table. Each row: #, File, Action, Section/Function, Description, Reqs, Group, Status
- **Execution Groups**: Each group has: name, agent recommendation, change numbers, sequence, dependencies, test tasks
- **Dependency Graph**: Parse the mermaid graph. Solid arrows (`-->`) = hard dependencies. Dashed arrows (`.->`) = soft dependencies.
- **Verification Plan**: Checklist items
- **Coding Standards**: Checklist items
- **Migration Safety** (if present): the section required by the rubric when any Change Manifest path matches a migration pattern

While parsing, build a **migration group set**: the set of Execution Group letters that contain at least one Change Manifest entry whose path matches a migration pattern (`prisma/schema.prisma`, `prisma/migrations/**`, `**/migrations/**/*.sql`, `alembic/versions/**`, `db/migrate/**`, `**/migrations/*.py`). This set drives prompt injection in Step 6.

For Tier 2: parse as a numbered step list. Skip to the Tier 2 section below. Tier 2 plans that touch migration paths must be re-tiered — stop and report: "This plan modifies migration files. Re-plan as Tier 1 with a Migration Safety section."

### Step 2: Validate Against Rubric

Run the Plan Quality Rubric. If any entry fails, output the failures and stop.

### Step 3: Analyze for Decomposition, then Implement or Create Issues

#### 3a. Analyze the Dependency Graph

Call `board_analyze_plan` MCP tool with the plan path. This parses the Mermaid dependency graph and identifies disconnected subgraphs — independent concerns that share no hard dependencies.

If `shouldDecompose` is `true`, the plan contains multiple independent concerns. Present the analysis:

```
## Decomposition Analysis

This plan contains <N> independent concerns:

Concern 1 (Groups A, B): <node labels>
  - 8 file changes, REQ-001 through REQ-003
  
Concern 2 (Group C): <node labels>
  - 4 file changes, REQ-004, REQ-005

These concerns share no hard dependencies and can be worked independently.
```

#### 3b. Decision

**If the stream has `autoApprove: true`:**
- If `shouldDecompose` is true: auto-decompose (see Decomposition Path below). Do NOT ask the user.
- If `shouldDecompose` is false: auto-implement. Skip to Step 4.

**If the stream does NOT have `autoApprove`:**

Use AskUserQuestion:
- **"Decompose into separate issues" (shown only if shouldDecompose is true, and marked Recommended)** — each independent concern becomes its own issue and board stream
- **"Implement now"** — proceed to Step 4 as a single stream
- **"Create GitHub issues per group"** — create one issue per Execution Group (legacy behavior)

#### Decomposition Path

For each disconnected subgraph identified by the analysis:

1. Build a sub-issue title: `<parent-issue-title>: <primary-group-name>`
2. Build the sub-issue body:
   - Change Manifest entries for this subgraph's groups (as a markdown table)
   - Linked requirements (REQ IDs from those entries)
   - Reference to the parent issue: "Part of #<parent-number>"
   - Reference to the full Implementation Plan file
   - Execution Group details for this subgraph's groups
3. Create the sub-issue:
   ```bash
   gh issue create --title "<title>" --body "<body>"
   ```
4. Start a board stream for the sub-issue:
   - Call `board_start` MCP tool with the new issue number, `parentIssue: <parent-number>`, and `autoApprove` inherited from the parent
5. Write a sub-plan for the sub-issue:
   - Extract from the parent plan: only this subgraph's Change Manifest entries, Execution Groups, Dependency Graph subset, Requirements Traceability subset, and Verification Plan items
   - Copy Coding Standards in full
   - Write to `<plansDir>/<parent-slug>-<group-slug>.md`
   - Ingest into RAG
   - Update the sub-stream's `planPath`

After all sub-issues are created:
1. Update the parent stream: `status: "decomposed"`, `childIssues: [<sub-issue-numbers>]`
2. Post a decomposition comment on the parent GitHub issue listing all sub-issues
3. Output:
   ```
   Decomposed into <N> issues:
     #201 — <parent-title>: Backend (Groups A, B)
     #202 — <parent-title>: Notifications (Group C)
   
   Parent #<parent> is now decomposed. Sub-issues will progress independently.
   ```
4. If `autoApprove`: immediately begin `board_run` on each sub-issue

#### Legacy Issue Creation Path

For each Execution Group that should become an issue (when user chooses "Create GitHub issues per group"):

1. Build the issue body:
   - Change Manifest entries for this group (as a markdown table)
   - Linked requirements (REQ IDs)
   - Dependencies on other groups (reference their issue numbers if already created)
   - Test requirements from the group's test task
   - Link to the Implementation Plan file in the repo
2. Create via:
   ```bash
   gh issue create --title "Group <letter>: <name>" --body "<body>"
   ```
3. If the original task had an issue number, add a reference in the body: "Part of #<number>"
4. Call `board_start` MCP tool with the new issue number and `parentIssue: <parent-number>`. Inherit `autoApprove` from the parent.
5. After all issues are created, update the parent stream: `status: "decomposed"`, `childIssues: [<sub-issue-numbers>]`
6. Output:
   ```
   Created <n> issues:
     #201 — Group A: Backend Pipeline
     #202 — Group B: Frontend Components (depends on #201)
     #203 — Group C: Integration Tests (depends on #201, #202)
   ```

### Step 4: Check for Prior Progress

Scan the Change Manifest Status column for completed markers:
- `[x]` or `[x] (<sha>)` = complete
- `[~]` = in progress (treat as incomplete)
- `[ ]` = pending

If completed groups exist: "Resuming from Group <X> — <N> of <M> groups complete."

### Step 5: Identify Parallel Groups

From the Dependency Graph, determine which groups can run simultaneously:
- A group is "ready" when all its hard dependencies (`-->`) are complete
- Multiple ready groups form a "batch" that executes in parallel
- Groups with soft dependencies (`.->`) can start but need integration after the dependency completes

Example batch ordering:
```
Batch 1: Groups A, B (no dependencies)
Batch 2: Group C (depends on A), Group D (depends on B)
Batch 3: Group E (depends on C and D)
```

### Step 6: Execute Groups via the Tier 1 Workflow

Tier 1 execution is owned by a deterministic **Workflow script**, not by hand-rolled prose orchestration. You do NOT spawn implementer/reviewer agents one-by-one from the main thread, and you do NOT edit files in the main thread. You build a structured argument object from the parsed plan, invoke the `Workflow` tool once (auto mode) or once per batch (manual mode), and act on the structured result. Invoking the `Workflow` tool here is explicitly authorized — these instructions require it.

The script lives inside the plugin at `workflows/tier1-execution.mjs`. Resolve its absolute path first:

```bash
echo "$CLAUDE_PLUGIN_ROOT/workflows/tier1-execution.mjs"
```

#### 6a. Build the workflow args

From the data parsed in Steps 1 and 5, construct this object (pass it as the `Workflow` tool's `args`):

```
{
  issue:           <board issue number>,
  planPath:        <plan file path>,
  autoApprove:     <stream.autoApprove>,
  codingStandards: <root.config.json → codingStandards array>,
  validation:      { lintCommand: <…>, testCommand: <…> },
  migrationGroups: <array of group letters in the migration group set from Step 1>,
  migrationSafety: <verbatim "Database Migration Safety" section text, or null>,
  migrationRules:  <the verbatim "Migration Hard Rules" block below, or null if no migration groups>,
  batches:         <the ordered batches from Step 5; each batch = { groups: [ … ] },
                    each group = { letter, name, sequence, testTask,
                                   changes: [ { num, file, action, section, description, reqs } ] }>
}
```

The workflow runs one `team-implementer` agent per group **in parallel** within a batch; each agent calls `board_start({ issue, groupId })` to get its own board worktree (`<project>-<issue>-<letter>`) on its own branch (`<streamBranch>-<letter>`, forked from the stream branch) — durable, board-tracked, NOT an ephemeral harness worktree. Parallel groups never collide on path OR branch, and group calls never recreate or reset the stream. Each batch is then gated by a `team-reviewer` agent in a loop-until-PASS; the workflow re-spawns the affected implementers on `ISSUES` and only advances to the next batch on `PASS`.

**Migration Hard Rules** (passed verbatim as `migrationRules`; the workflow injects it into implementer prompts for migration groups):

```
## Database Migration Hard Rules — READ BEFORE TOUCHING ANY MIGRATION FILE

You are modifying database migration files. These rules are non-negotiable. Violating them has previously broken builds and cost hours.

1. DO NOT guess ORM behavior. If this is Prisma, assume every rename is actually a DROP + ADD unless you have verified the generated SQL says otherwise. Same for type changes. Read the generated SQL before applying it.

2. Use the project's migration workflow exactly as documented. For Prisma:
   - `prisma migrate dev --create-only --name <name>` to generate migration SQL WITHOUT applying it
   - Read the generated `.sql` file. Confirm it matches the intent described in the Change Manifest entry.
   - Only then `prisma migrate dev` to apply, or commit the file and let the deploy pipeline apply it — whichever the project's docs specify.
   - DO NOT use `prisma db push` for schema changes that will reach production.

3. Before writing or applying the migration, work through the plan's Migration Safety section line by line:
   - For each enumerated breaking-change risk (nullability, renames, drops, type changes, index locks, data loss): state in your commit body whether the generated SQL triggers that risk and how it is mitigated. If you cannot confirm, STOP and report.
   - Confirm the generated SQL matches the "generated-SQL verification" expectation in the plan. If it diverges, STOP and report — do not "fix" by hand-editing the SQL unless the plan's Migration Safety section authorizes a specific edit with a stated reason.
   - Follow the rollout order in the plan. Do not reorder.

4. If you hand-edit generated migration SQL, add a comment in the SQL file explaining the exact reason and what Prisma/the ORM would have done instead. No silent edits.

5. You are NOT authorized to deviate from the Migration Safety section under autoApprove. Migration deviations are the one category where autoApprove does not delegate judgment — STOP and surface a blocked signal on the board per the Autonomous Mode Contract.

6. Triple-check before committing: (a) generated SQL read and matches intent, (b) every breaking-change risk explicitly addressed, (c) rollout order preserved. State each of these in the commit body.
```

The workflow writes tests as part of each implementer's deliverable and runs the reviewer gate per batch. You do not spawn `team-tester`, `team-implementer`, or `team-reviewer` yourself — the script does, with the correct parallelism, board worktrees, and review loop baked in.

#### 6b. Invoke the workflow

**Auto mode (`autoApprove: true`):** call the `Workflow` tool **once** with the resolved `scriptPath` and the full `args` (all batches). The workflow executes every batch end-to-end — implement → review-until-PASS → next batch — without returning between batches.

**Manual mode (`autoApprove: false`):** call the `Workflow` tool **once per batch**, passing `args` with `batches` sliced to that single batch. After each call returns, present the checkpoint (6c) and use `AskUserQuestion` (Continue to next batch / Review changes first / Stop here) before invoking the workflow for the next batch. This preserves per-batch human checkpoints, which a single all-batches run cannot.

#### 6c. Handle the result

The workflow returns one of two shapes.

**`{ status: "complete", completedBatches: [...] }`** — every batch implemented and reviewed PASS. For each entry in `completedBatches`, present a checkpoint:

```
### Checkpoint: Group(s) <groups> Complete

Files changed: <changedFiles>
Commits:
  <sha> — <message>
Review: PASS (team-reviewer)

Progress: <completed>/<total> groups
```

When ALL implementation groups are complete, **first integrate the parallel group branches**: call `board_integrate_groups({ issue })`. Each group committed on its own branch in its own worktree; this merges every group branch back into the stream branch (inside the stream worktree), then prunes the group worktrees and branches. Because a well-formed plan partitions groups by disjoint files, the merges are conflict-free.

- On success it reports the integrated groups and the stream worktree path — **run all subsequent steps (full validation, PR) from that stream worktree**, which now holds the consolidated work.
- If it returns `isError` (a merge conflict), the Execution Groups were not actually independent. Do NOT advance: treat it like a `blocked` result — call `board_run` with a `blocked` signal, surface the conflict detail, and stop. The conflicting merge is left in git's conflicted state in the stream worktree for manual resolution.

Then call `board_run` with the issue number to transition the stream to `validating`. (Per-group completion is recorded in the plan file's Change Manifest by the implementers; the board status advances only when the full set is integrated.)

> Skip `board_integrate_groups` only if the run was never fanned out into parallel groups (single-group plan with no group branches) — the tool is a no-op in that case and reports so.

**`{ status: "blocked", batchIndex, groups, reason, migrationHalt, completedBatches }`** — a group failed, the reviewer never reached PASS within its round budget, or a migration deviation forced a halt. Do NOT advance:

1. Call `board_run` with a `blocked` signal to mark the stream `blocked`.
2. Fire `sendDiscord('blocker', ...)` with the failed `groups`, the issue, and `reason` — mirroring the epic-mode blocker signal in Step A3 bullet 8 of the `/root` skill.
3. Surface a user-visible error:
   > "Execution Group(s) `<groups>` (batch `<batchIndex>`) blocked: `<reason>`. Halting. Inspect the workflow output and re-run `/root:impl` after resolving."
   If `migrationHalt` is true, prepend: "**Migration deviation — manual review required.**"
4. Stop.

### Step 8: Generate Documentation

After all code groups are complete, before final validation:

1. Identify new systems introduced: scan the Change Manifest for `create` actions on source files (not test files)
2. For each new system, generate a doc that meets the `/root:docs` **Doc Quality Rubric**:
   - Read the source code thoroughly — every export, endpoint, type, dependency
   - Generate frontmatter (title from component name, type from path inference, status=draft, created/updated=today)
   - Write content with: purpose (why it exists), full public API surface with signatures, dependencies, usage example, and type-specific requirements (see rubric)
   - NOT acceptable: "Handles various operations", empty sections, omitted error conditions
   - Write to `project.docsDir`
   - Ingest into RAG:
     ```bash
     node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <doc-path>
     ```
3. Check if changes affect existing documented systems:
   - Query RAG for docs related to modified files
   - If found, flag them: "These docs may need updating: <list>"

### Step 9: Final Validation

1. **Full lint/type-check**: Run `validation.lintCommand` across the entire project (not scoped to changed files)
2. **Full test suite**: Run `validation.testCommand` without file pattern restrictions
3. **Verification Plan**: Go through each item:
   - Automated items: run and report PASS/FAIL
   - Manual items: present to the user with specific instructions for what to do and what to expect
   - Negative test items: present to the user or run if automatable
4. **Coding Standards**: Verify every item in the checklist is satisfied

### Step 10: Summary, PR, Review Resolution, and Merge

This step has four phases: summary, PR creation, CI/review resolution, and merge. In `autoApprove` mode, all phases run without human intervention.

#### 10a. Output the implementation summary

```
## Implementation Complete

Plan: <title>
Issue: #<number> — <title>
Groups completed: <N>/<N>
Commits: <list of SHAs and messages>

### Changes
<list all files from Change Manifest with actions>

### Tests Added
<list all test files created>

### Docs Created
<list any docs generated in Step 8>

### Verification
Lint: PASS | Type-check: PASS
Tests: <n> passed, <n> failed
Manual verification: <status>
Coding standards: <n>/<n> checked
```

#### 10b. Create the PR

**If `autoApprove`:** Create the PR automatically — no user prompt. Use squash-ready commit format.

**If manual:** Use AskUserQuestion:
- **"Create PR"** — proceed
- **"Squash commits first"** — squash all group commits into one, then create PR
- **"Just commit (no PR)"** — skip to end
- **"Full-plan reviewer sweep first"** — spawn `team-reviewer` one more time with the entire plan in scope (cross-group consistency, integration concerns) before creating the PR

Create the PR:
```bash
gh pr create --title "<title>" --body "<body with Closes #<issue>>"
```

After creation, call `board_run` to transition the stream to `pr-ready`.

#### 10c-10e: CI, Review Resolution, and Merge

The post-PR flow depends on mode (`autoApprove` vs manual) and whether CI checks exist.

---

**Auto mode (`autoApprove: true`):**

**10c (auto). Wait for CI checks**

```bash
# Check if any CI checks exist for this PR
CHECKS=$(gh pr checks <pr-number> --json name,state 2>/dev/null || echo "")
```

If no checks exist: skip to 10e (merge). No CI configured — nothing to wait for.

If checks exist, wait for completion:
```bash
gh pr checks <pr-number> --watch --fail-fast
```
If `--watch` is unavailable, poll: run `gh pr checks <pr-number> --json state` every 10 seconds, up to 30 iterations (5 min timeout).

**10d (auto). Resolve review findings (3rd set of eyes)**

Read PR comments looking for a review:
```bash
gh pr view <pr-number> --json comments --jq '.comments[].body'
```

If no review comments found: skip to 10e. The 1st eyes (team-reviewer during implementation) are sufficient.

If review comments found, resolve each finding using full local context (Implementation Plan, PRD, codebase):

1. **Read the finding** — extract severity (🔴/🟠/🟡/🟢), file, line, description
2. **Evaluate against the plan** — read the relevant Change Manifest entry and PRD requirement:
   - Real defect the plan didn't account for? → **Fix**
   - False positive due to missing context? → **Dismiss** with plan/requirement reference
   - Valid but out of scope? → **Defer**
3. If fixes needed: implement in a **single commit** (`fix(<scope>): address PR review findings`), push
4. Post a resolution comment:

```markdown
## Review Resolution

| # | Finding | Severity | Resolution | Reason |
|---|---------|----------|------------|--------|
| 1 | Null check missing on `processPayment()` | 🟠 High | ✅ Fixed | Real defect — input validation was missing |
| 2 | `fetchUser()` doesn't handle 404 | 🟡 Medium | ⏭ Dismissed | Handled by middleware error boundary (REQ-003) |
| 3 | No rate limiting on new endpoint | 🟡 Medium | 📋 Deferred | Valid — tracked as follow-up issue |
```

**10e (auto). Merge**

Execute the following as a single chained operation. Do not return to the user between steps:

```bash
gh pr checks <pr-number> --watch \
  && gh pr merge <pr-number> --squash --delete-branch \
  && git worktree remove <worktree-path> --force
```

Then call `board_delete({ issue: <issue> })` to remove the stream record. `board_delete` cascades to worktree cleanup, so any board-tracked worktree paths are also removed. Post a completion comment on the linked issue.

This is one operation. Do not return to the user between the create and merge phases under `--auto`.

---

**Manual mode (no `autoApprove`):**

**10c (manual). Check for CI and hand off to human**

```bash
CHECKS=$(gh pr checks <pr-number> --json name,state 2>/dev/null || echo "")
```

**If CI checks exist:** Wait for them to complete (same polling as auto mode). Then read review comments. If review comments found, resolve findings (same as 10d auto) — push fixes, post the resolution comment. Then present merge options (10e manual below).

**If NO CI checks exist:**

This block may be entered once (first PR creation) or repeatedly (each time `/root #<issue>` is re-invoked on a `pr-ready` stream). Behavior is driven by PR state, not entry mode — the same logic handles both cases.

1. **Read full PR state**:
   ```bash
   gh pr view <pr-number> --json reviews,comments,author
   ```

2. **Find the last Root-posted marker**. Scan issue-level comments for the most recent one starting with `## Review Resolution` or `## Ready for Review`. Record its timestamp as `LAST_ROOT_TS` (null if no such comment exists — this is first entry).

3. **Identify new reviewer activity since `LAST_ROOT_TS`**:
   - Formal PR reviews with `submittedAt > LAST_ROOT_TS` (or all reviews if null)
   - Issue-level comments with `createdAt > LAST_ROOT_TS`, excluding any whose body starts with `## Ready for Review` or `## Review Resolution`

4. **Dispatch**:

   | New activity | Action |
   |---|---|
   | Any review with `state: CHANGES_REQUESTED`, OR substantive reviewer comments | Fall through to Step 10d's resolution logic: read findings, evaluate against the plan, push fixes in a single `fix(<scope>): address PR review findings` commit, post a `## Review Resolution` comment. Then present merge options (10e manual). |
   | `APPROVED` review with no unresolved review comments | Present merge options (10e manual) directly. |
   | No new activity AND `LAST_ROOT_TS` is null (first entry) | Post the `## Ready for Review` comment (template below). Output: "PR #&lt;number&gt; created and awaiting review. Re-run `/root #&lt;issue&gt;` when review arrives." Stop. |
   | No new activity AND `LAST_ROOT_TS` is not null (re-entry, nothing new) | Output: "Stream #&lt;issue&gt; still awaiting review — no new activity since &lt;LAST_ROOT_TS&gt;. Re-run `/root #&lt;issue&gt;` when review arrives." Stop. Do NOT re-post the awaiting-review comment. |

**Ready for Review comment template** (posted once, on first entry):

```bash
gh pr comment <pr-number> --body "## Ready for Review

This PR was created by Root. Implementation was validated by the team:
- team-reviewer: PASS (per-group validation)
- Lint/type-check: PASS
- Tests: PASS

**Plan**: <plan-path>
**Issue**: #<issue-number>

### Next Steps
- Review the changes
- Comment \`@root LGTM\` to squash merge
- Comment \`@root fix <feedback>\` to request changes
- Or merge manually"
```

**Stop** when no new reviewer activity. The PR stays `pr-ready` on the board; re-invoking `/root #<issue>` will re-check for new activity.

**10e (manual, after CI/review resolution). Merge options**

If CI ran and review was resolved, present options:

Use AskUserQuestion:
- **"Squash merge"** — `gh pr merge --squash --delete-branch`, update board
- **"Merge (no squash)"** — `gh pr merge --delete-branch`, update board
- **"Wait"** — leave the PR open for further human review

After merge, call `board_run` to transition the stream. The next `board_clean` will remove the local worktree.

### Tier 2 Execution (simplified)

For Tier 2 plans (no Change Manifest, no Execution Groups):

1. Parse the plan as a numbered step list
2. Execute each step sequentially:
   - Read relevant code before changing it
   - Search for existing patterns
   - Make the change
3. After all code changes, generate tests:
   - Identify what was changed
   - Search for existing test patterns
   - Write tests for the changes
4. Run `validation.lintCommand` and `validation.testCommand`
5. Fix any failures
6. Create a single commit with conventional format
7. Create PR via `gh pr create`
8. Wait for CI checks and resolve review findings (same as Step 10c-10d above)
9. If `autoApprove`: squash merge automatically. If manual: present merge options.

## `resume`

Pick up from the last incomplete Execution Group.

1. Run Shared Setup to load session state and plan
2. Parse the Change Manifest for completion status
3. Find the first group with any incomplete (`[ ]` or `[~]`) changes
4. Output: "Resuming from Group <X>: <name>. Groups <completed list> already complete."
5. Continue the `run` flow from Step 5 (identify parallel groups) for remaining work

If all groups are complete: "All groups complete. Run `/root:impl finalize` to run final validation and create PR."

## `status`

Show current implementation progress.

1. Run Shared Setup to load session state and plan
2. Parse the Change Manifest for completion markers
3. Output:

```
## Implementation Status

Plan: <title>
Tier: <tier>
Issue: #<number> — <title>

### Execution Groups
| Group | Name | Changes | Tests | Complete | Commit |
|-------|------|---------|-------|----------|--------|
| A | Backend | #1, #2, #3 | 3 scenarios | 3/3 | a1b2c3d |
| B | Frontend | #4 | 2 scenarios | 0/1 | — |

Progress: 1/2 groups (3/4 changes)
Next: Group B: Frontend

Resume: /root:impl resume
```

For Tier 2: show the numbered step list with checkmarks.

## `finalize`

Run final validation and produce commit/PR without re-executing changes. Use when:
- Changes were completed manually
- Session was interrupted after all groups finished but before PR
- You want to re-run the final validation step

1. Run Shared Setup
2. Run Step 8 (Generate Documentation)
3. Run Step 9 (Final Validation)
4. Run Step 10 (Summary and PR)
