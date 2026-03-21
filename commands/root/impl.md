# /root:impl — Implementation Plan Executor

Execute an approved Implementation Plan by walking through Execution Groups, validating at checkpoints, generating tests and docs, and producing commits.

Parse the first word of the argument to determine the action. Default to `run` if no argument.

## Shared Setup

1. **Session state**: Read `/tmp/root-session.json`. Extract `tier`, `plan_path`, `issue`.
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

### Step 3: Implement or Create Issues?

Use AskUserQuestion to ask the user:
- **"Implement now"** — proceed to Step 4
- **"Create GitHub issues"** — create issues and stop (see Issue Creation below)
- **"Implement some, issue the rest"** — ask which groups to implement vs issue

#### Issue Creation Path

For each Execution Group that should become an issue:

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
4. After all issues are created, output:
   ```
   Created <n> issues:
     #201 — Group A: Backend Pipeline
     #202 — Group B: Frontend Components (depends on #201)
     #203 — Group C: Integration Tests (depends on #201, #202)
   ```

Stop after issue creation. The user runs `/root:impl` again when ready to implement.

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

#### Parallel Execution (Claude Code)

Spawn one agent per group using the Agent tool with `isolation: "worktree"`:
- Each agent receives: the Execution Group spec, its Change Manifest entries, coding standards, and test requirements
- Agents work independently in isolated git worktrees
- When all agents in the batch complete, their worktree changes are available for review

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

### Step 7: Checkpoint

After each batch of groups completes, pause for human verification:

```
### Checkpoint: Group(s) <letters> Complete

Files changed: <list>
Tests added: <list of test files>
Commits:
  <sha> — <message>
  <sha> — <message>
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
2. For each new system, generate a doc:
   - Read the source code
   - Generate frontmatter (title from component name, type from path inference, status=draft, created/updated=today)
   - Write first-draft content based on what the code does
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

### Step 10: Summary and PR

1. Output the implementation summary:
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

2. Write PR metadata to `/tmp/root-pr-context.txt`:
   - ISSUE: issue number
   - SUMMARY: from plan's Context & Motivation
   - CHANGES: organized by Execution Group
   - TESTS: test results
   - DOCS: any docs created/updated

3. Use AskUserQuestion:
   - **"Create PR"** — use `gh pr create` with generated title and body
   - **"Squash commits and create PR"** — squash all group commits into one, then create PR
   - **"Just commit (no PR)"** — done
   - **"Review with team-reviewer first"** — suggest spawning team-reviewer agent, then come back to create PR

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
7. Output summary and offer PR creation
8. One checkpoint at the end before commit — no per-step checkpoints

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
