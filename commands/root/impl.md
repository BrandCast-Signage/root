# /root:impl — Implementation Plan Executor

Execute an approved Implementation Plan by walking through Execution Groups, validating at checkpoints, generating tests and docs, and producing commits.

Parse the first word of the argument to determine the action. Default to `run` if no argument.

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

For Tier 2: parse as a numbered step list. Skip to the Tier 2 section below.

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

### Step 6: Execute Groups

For each batch of parallel-ready groups:

#### Parallel Execution (Claude Code) — MANDATORY for Tier 1

You MUST spawn one `team-implementer` agent per group using the Agent tool. Do NOT edit files in the main thread. Do NOT execute a group yourself "because it's small". Delegation is the rule, not an optimization.

For each group in the batch, make an Agent tool call with:
- `subagent_type: "team-implementer"`
- `isolation: "worktree"` (gives each agent its own git worktree)
- A self-contained prompt containing:
  - Path to the plan file and the group letter (so the implementer can re-read it)
  - The group's Change Manifest entries in full (file paths, actions, sections, descriptions, linked REQ IDs)
  - The group's test task (file and scenarios)
  - Coding standards from `root.config.json` → `codingStandards`
  - Validation commands from `root.config.json` → `validation`
  - Explicit instruction to mark each Change Manifest entry `[~]` on start and `[x] (<sha>)` on completion
  - Explicit instruction to commit in conventional format, one commit per logical unit within the group

Where a group has an associated test task, you may spawn `team-tester` in parallel with the implementer (same worktree) OR instruct the implementer to write tests itself — prefer the former for Tier 1 groups with non-trivial test surface.

All agents in a batch run in parallel. Wait for the whole batch before proceeding to the next. When the batch completes, their worktree changes are ready for review in Step 7.

#### Sequential Execution (Gemini CLI)

Gemini CLI does not have native agent team support. Execute groups sequentially in dependency order. If multiple groups in a batch have no dependency relationship, suggest:
```
These groups are independent and can run in parallel.
To parallelize, open additional Gemini CLI sessions in separate worktrees:
  git worktree add ../<project>-group-b group-b
  cd ../<project>-group-b && gemini
```

#### Per-Group Execution

Whether parallel or sequential, each group follows this process:

##### 6a. Announce

```
---
## Executing Group <letter>: <name>
Changes: #1, #2, #3
Sequence: types (#1) → service (#2) → route (#3)
Tests: <test file and scenarios>
---
```

##### 6b. Implement Changes

For each change in the group's sequence:
1. **Read** the target file (if `modify` or `delete`)
2. **Search** for existing patterns in the codebase (Glob/Grep). Follow the patterns you find.
3. **Make the change**:
   - `create`: Write the new file. Include all exports, types, and function signatures specified in the Change Manifest.
   - `modify`: Edit the specified section/function. The Change Manifest describes what the current behavior is and what it becomes — follow that exactly.
   - `delete`: Remove the file.
4. **Follow coding standards** from `root.config.json` → `codingStandards`
5. **Update the Change Manifest** in the plan file: change `[ ]` to `[~]` for this entry

##### 6c. Generate Tests

Tests are a required deliverable for every group:
1. Read the group's test task (from the Execution Group section) for which test file and scenarios
2. Search for existing test patterns in the project (test framework, file naming, import style)
3. Write tests covering:
   - **Happy path**: normal inputs produce expected outputs
   - **Edge cases**: boundary values, empty inputs, nulls
   - **Error conditions**: invalid inputs, missing dependencies, failure modes
4. Run the tests to confirm they pass:
   ```bash
   # Use validation.testCommand scoped to the test file
   ```
5. If tests fail, fix the implementation or tests until they pass

##### 6d. Validate

1. Run lint/type-check:
   ```bash
   # Execute validation.lintCommand from root.config.json
   ```
   If it fails, fix the errors before proceeding.
2. Run tests scoped to changed files:
   ```bash
   # Execute validation.testCommand with patterns matching changed files
   ```
3. Check coding standards: review each item in the Coding Standards checklist against this group's changes

##### 6e. Commit the Group

Create one commit for this group:
- Conventional format: `feat(<scope>): <description>` or `fix(<scope>): <description>`
- Include issue reference if available: `(#1132)`
- Stage only this group's files: source changes + test files
- Do NOT stage other groups' files

##### 6f. Mark Complete

Update the Change Manifest in the plan file:
- Change `[~]` to `[x] (<sha>)` for each entry in this group
- `<sha>` is the first 7 characters of the commit hash

### Step 7: Checkpoint + Mandatory Review

After each batch of groups completes, **spawn `team-reviewer` before presenting the checkpoint to the user**. This is not optional.

Spawn `team-reviewer` with:
- `subagent_type: "team-reviewer"`
- A prompt containing: path to the plan file, group letters in this batch, list of commits from the batch, coding standards, validation commands
- Instruction to validate the batch's changes against the Change Manifest, run lint/type-check/tests, and report PASS or a specific issue list

If the reviewer returns issues, re-spawn the relevant `team-implementer` with the issue list and a directive to fix. Loop until reviewer returns PASS. Do NOT attempt fixes in the main thread.

Once the reviewer returns PASS:

- **Board update (if stream exists)**: If a board stream exists and ALL implementation groups are now complete, call `board_run` with the issue number to transition the stream to `validating`. Individual group completion is tracked in the plan file Change Manifest; the board stream status advances only when the full set of groups is done.

Present the checkpoint to the user:

```
### Checkpoint: Group(s) <letters> Complete

Files changed: <list>
Tests added: <list of test files>
Commits:
  <sha> — <message>
  <sha> — <message>
Review: PASS (team-reviewer)
Lint: PASS/FAIL
Tests: <n> passed, <n> failed

Progress: <completed>/<total> groups
Next batch: Group(s) <letters> (<n> changes)
```

Use AskUserQuestion:
- **"Continue to next batch"** — proceed to Step 5 for next batch
- **"Review changes first"** — show `git log --oneline -<n>` and `git diff HEAD~<n>` for this batch's commits, then ask again
- **"Stop here"** — stop. User can resume later with `/root:impl resume`

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

#### 10c. Wait for CI checks and review

After the PR is created, wait for CI checks to complete. These typically include the automated PR review and any security scans.

```bash
# Poll for check completion (timeout after 5 minutes)
gh pr checks <pr-number> --watch --fail-fast
```

If `gh pr checks --watch` is not available, poll manually:
```bash
# Loop until all checks complete or timeout
for i in $(seq 1 30); do
  STATUS=$(gh pr checks <pr-number> --json state --jq '.[].state' 2>/dev/null)
  if echo "$STATUS" | grep -qv "PENDING\|QUEUED\|IN_PROGRESS"; then
    break
  fi
  sleep 10
done
```

Once checks complete, read the PR review comments:
```bash
gh pr view <pr-number> --json comments --jq '.comments[].body'
```

If no review comments were posted (no review workflow configured), skip to 10d.

#### 10d. Resolve review findings (3rd set of eyes)

The PR review (2nd eyes) ran without full context — it reviewed the raw diff. It finds real issues AND false positives. This step resolves each finding using the full context available locally: the Implementation Plan, PRD, coding standards, and the complete codebase.

For each finding in the review comment:

1. **Read the finding** — extract the severity (🔴/🟠/🟡/🟢), file, line, and description
2. **Evaluate against the plan** — read the relevant Change Manifest entry and the PRD requirement it traces to. Ask:
   - Is this a real defect that the plan didn't account for?
   - Is this a false positive because the reviewer lacked context (e.g., "null not handled" when null is handled upstream per REQ-003)?
   - Is this valid but out of scope for this PR?
3. **Decide the resolution**:
   - **Fix**: Real defect. Implement the fix.
   - **Dismiss**: False positive. Document why with reference to the plan/requirement.
   - **Defer**: Valid concern but out of scope. Note it for future work.

After evaluating all findings, if any fixes are needed:
1. Implement all fixes in a **single commit** (conventional format: `fix(<scope>): address PR review findings`)
2. Push the commit. The PR review workflow should NOT re-trigger for this commit (the workflow should use concurrency groups to avoid review loops, or the commit message can include `[skip review]` if the workflow supports it).

Post a resolution comment on the PR:

```markdown
## Review Resolution

| # | Finding | Severity | Resolution | Reason |
|---|---------|----------|------------|--------|
| 1 | Null check missing on `processPayment()` | 🟠 High | ✅ Fixed | Real defect — input validation was missing |
| 2 | `fetchUser()` doesn't handle 404 | 🟡 Medium | ⏭ Dismissed | Handled by middleware error boundary (REQ-003) |
| 3 | No rate limiting on new endpoint | 🟡 Medium | 📋 Deferred | Valid — tracked as follow-up issue |

Fixes pushed in commit <sha>.
```

If no findings need fixes (all dismissed or no review comments), post:
```markdown
## Review Resolution

PR review findings evaluated against the Implementation Plan.
No actionable issues found. Ready to merge.
```

#### 10e. Merge

**If `autoApprove`:** Squash merge automatically after review resolution:
```bash
gh pr merge <pr-number> --squash --delete-branch
```
Update the board stream to `merged` via `board_run`. Post a completion comment on the linked issue.

**If manual:** Use AskUserQuestion:
- **"Squash merge"** — `gh pr merge --squash --delete-branch`, update board
- **"Merge (no squash)"** — `gh pr merge --delete-branch`, update board
- **"Wait"** — leave the PR open for human review. The resolution comment is already posted.

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
