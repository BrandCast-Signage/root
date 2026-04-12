---
title: Root Board Orchestration Layer
status: draft
type: prd
created: 2026-04-12
updated: 2026-04-12
---

# Root Board Orchestration Layer — Product Requirements Document

**Status:** Draft
**Author:** Jamie Duncan
**Date:** 2026-04-12

---

## 1. Problem Statement

Root currently handles single-feature, single-session workflows well — `/root` classifies a task, plans it, and `/root:impl` executes it. But real development involves multiple features in flight simultaneously, and Root has no way to manage that.

Three specific gaps:

1. **No multi-feature orchestration.** Root tracks one session in `/tmp/root-session.json`. You can't have 3 features in flight with visibility into each one's status.

2. **No GitHub issue lifecycle.** Root *reads* issues for context but never writes back. The issue doesn't reflect that work has started, a plan exists, or a PR is ready. There's no way to filter issues by Root workflow status.

3. **No auto-progression.** Every phase transition (plan → implement → validate → PR) requires the human to manually invoke the next command. For Tier 2 work (bug fixes, small changes), this overhead is disproportionate. For Tier 1 work, the human should only need to approve the plan — everything after that should be autonomous.

4. **No cross-harness coordination.** Claude Code and Gemini CLI can both run Root, but they can't work on the same project simultaneously without stepping on each other. There's no shared state, no assignment tracking, no conflict prevention.

These gaps compound: a developer with 5 open issues can't start them all, can't see their progress, and can't let them auto-complete. They must drive each one manually, sequentially, in a single terminal session.

## 2. Proposed Solution

Add an orchestration layer to Root via a new MCP server (`mcp-root-board`) and a new command (`root:board`), plus modifications to existing skills (`/root`, `/root:impl`).

The board MCP server is a lightweight Node/TypeScript process that:
- Maintains per-stream state files (`.root/board/<issue>.json`) for zero-contention multi-session access
- Manages git worktree lifecycle (create, track, clean up)
- Integrates with GitHub via `gh` CLI for issue labels, comments, and PR creation
- Evaluates gates (configurable checkpoints) to determine whether to auto-advance or pause for human approval

The MCP server is spawned per-session by the harness (same as `mcp-local-rag`). There is no daemon. State is persisted to disk per-stream, so multiple sessions share state through the filesystem without coordination. Two sessions working different issues have zero contention (separate files). The server performs lazy schema migration on read — no batch migration tooling needed.

The board is **not** a project management tool. It's the local execution state that tracks "what's in flight, where is it, and who's working on it." GitHub Issues remain the source of truth for *what* needs doing. The board tracks *how* it's being done.

## 3. Goals & Non-Goals

### Goals
- Enable multiple features to progress in parallel, each in its own worktree
- Make Tier 2 work fully autonomous: issue → PR with zero human touchpoints
- Make Tier 1 work autonomous after plan approval: one pause, then hands-off to PR
- Reflect Root workflow status on GitHub issues via labels and comments
- Allow Claude Code and Gemini CLI to work on the same project simultaneously with execution-group-level assignment
- Provide a model/harness selection rubric so the right tool is used for the right phase

### Non-Goals
- Not a SaaS or web UI — local files + `gh` CLI only
- Not a replacement for GitHub Projects — the board is per-developer local state
- Not auto-merging PRs — the PR is the handoff point, human reviews and merges
- Not a background daemon — the run loop executes within a harness session
- Not using the GitHub MCP server — too heavy (40+ tools, context bloat); `gh` CLI is lighter, already authenticated, and debuggable
- Not adding CI/CD integration — gates run locally; CI gates happen at the PR review phase

## 4. Functional Requirements

### Must Have (P0)

- [ ] REQ-001: `mcp-root-board` MCP server — Node/TypeScript process exposing board tools over MCP protocol. Installed at `~/.root-framework/mcp/mcp-root-board/`. Single process per project, all writes serialized.
- [ ] REQ-002: Board state management — Per-stream state files at `.root/board/<issue>.json`. Each stream tracks: issue number, tier, status, worktree path, plan path, execution group assignments (harness per group), branch name, schemaVersion. Per-stream files eliminate contention between concurrent MCP server instances (one per harness session). `board_list` globs `.root/board/*.json`.
- [ ] REQ-003: Stream lifecycle tools — `board_list`, `board_start`, `board_status`, `board_approve`, `board_sync`, `board_clean`. Each is an MCP tool exposed by the server.
- [ ] REQ-004: Worktree lifecycle — `board_start` creates a git worktree for the stream. `board_clean` removes worktrees for merged/closed streams. Worktree paths follow `../<project>-<issue>` convention.
- [ ] REQ-005: GitHub label integration — State transitions update issue labels via `gh issue edit`. Label set: `root:planning`, `root:plan-ready`, `root:approved`, `root:implementing`, `root:pr-ready`. `board_sync` reads labels to detect external approvals.
- [ ] REQ-006: GitHub comment integration — Key transitions post structured markdown comments on the issue via `gh issue comment`. Plan-ready posts the plan summary. PR-ready posts the PR link.
- [ ] REQ-007: Gate-based auto-progression — `board_run` tool advances a stream through phases automatically, stopping only at gates configured to require human approval. Default gates: Tier 1 plan approval requires human; all other gates auto-advance.
- [ ] REQ-008: Gate configuration — `root.config.json` gains a `board.gates` section where project owners configure which gates require human approval: `{ "plan_approval": { "tier1": "human", "tier2": "auto" }, "reviewer_pass": "auto", "validation": "auto", "pr_creation": "auto" }`.
- [ ] REQ-009: Execution-group-level harness assignment — When a plan has multiple execution groups, each group can be assigned to a different harness (claude/gemini). The board tracks this per-group, not per-stream. Different worktrees can have different harnesses.
- [ ] REQ-010: `root:board` command — New slash command with subcommands: (default: list), `start <issue>`, `status [issue]`, `approve <issue>`, `run [issue]`, `sync`, `clean`.
- [ ] REQ-011: `/root` skill modification — On session start, create or resume a board stream instead of writing `/tmp/root-session.json`. All session state moves to the board.
- [ ] REQ-012: `/root:impl` skill modification — Read stream state from the board. Update board status as execution progresses. Report gate results back to the board for auto-progression decisions.
- [ ] REQ-013: PR creation integration — `board_run` creates the PR via `gh pr create` when all gates pass, linking the issue with `Closes #N` in the PR body. Updates the stream status to `pr-ready`.

### Should Have (P1)

- [ ] REQ-014: Model/harness selection rubric — Documentation in `skills/root/` defining when to use Opus vs Sonnet, Claude vs Gemini, per workflow phase. Referenced by `/root` during session init and by the board when suggesting group assignments.
- [ ] REQ-015: `board_sync` detects GitHub label changes — If a human adds `root:approved` directly in GitHub's UI, `board_sync` detects it and updates the local board state. Approval works from anywhere (phone, browser, CLI).
- [ ] REQ-016: `ensure-mcp.sh` hook update — Session-start hook installs `mcp-root-board` alongside `mcp-local-rag`. Checks `gh auth status` and warns if not authenticated.
- [ ] REQ-017: Structured plan summary in GitHub comments — When a Tier 1 plan is ready, the issue comment includes: change manifest summary table, execution group count, estimated scope, and instructions for approval (both CLI and label methods).

### Nice to Have (P2)

- [ ] REQ-018: `board_run` batch mode — `board_run` with no issue argument runs all streams that have a pending auto-advanceable gate. Advances everything it can in one pass.
- [ ] REQ-019: `maxParallel` config — `root.config.json` → `board.maxParallel` limits how many streams can be in `implementing` status simultaneously. Prevents resource exhaustion.
- [ ] REQ-020: Board status in context receipt — The `context-receipt.sh` Stop hook includes board state (active streams, their statuses) in the terminal receipt output.

## 5. Technical Considerations

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Claude / Gemini                 │
│          (runs /root skills + root:board)        │
└──────┬──────────────────────────────┬───────────┘
       │                              │
       ▼                              ▼
┌────────────────┐            ┌────────────┐
│ mcp-root-board │            │ mcp-local  │
│                │            │ -rag       │
│ • board state  │            │            │
│ • gates        │            │ • docs     │
│ • worktrees    │            │ • search   │
│ • gh CLI calls │            │            │
└────────────────┘            └────────────┘
     local                       local
```

### State Machine

Each stream progresses through:

```
queued → planning → plan-ready → approved → implementing → validating → pr-ready → merged
```

Gates can be inserted at any transition. The default configuration pauses only at `plan-ready → approved` for Tier 1 work.

### GitHub Integration — Why `gh` CLI, Not the GitHub MCP Server

The official `github/github-mcp-server` exposes 40+ tools. Each tool's schema is injected into the agent's context window. Root needs ~6 GitHub operations (label, comment, PR create, issue list). Using the full GitHub MCP server would:

1. Bloat context by thousands of tokens per request
2. Add a Go binary or Docker dependency to a Node-based stack
3. Require separate PAT/OAuth configuration when `gh auth` is already solved
4. Make debugging harder — `gh issue edit` is a command you can test in your terminal

`mcp-root-board` shells out to `gh` directly for the operations it needs. This is documented as a deliberate design choice.

### Concurrency Model

MCP servers are spawned per-session by the harness. Two concurrent sessions (Claude + Gemini) each run their own `mcp-root-board` process. There is no shared daemon.

State is per-stream: `.root/board/42.json`, `.root/board/61.json`, etc. Two sessions working different issues touch different files — zero contention, no locking needed. Two sessions working on the *same* issue's different execution groups is the rare case; atomic writes (write to temp file, rename over target) handle this safely since they update different fields.

Execution groups are the assignment unit, not streams. Group A can be assigned to Claude and Group B to Gemini. Each operates in its own worktree. The board tracks which harness owns which group.

```
.root/board/
├── 42.json      ← Claude session owns groups A, C
├── 58.json      ← Gemini session owns this (Tier 2, single group)
└── 61.json      ← unassigned, queued
```

### File Layout

```
~/.root-framework/mcp/
├── mcp-local-rag/          (existing)
└── mcp-root-board/         (new)
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts        ← MCP server entry point
        ├── board.ts        ← state machine + per-stream file I/O
        ├── gates.ts        ← gate evaluation logic
        ├── worktree.ts     ← git worktree lifecycle
        ├── github.ts       ← gh CLI wrapper functions
        └── migrate.ts      ← lazy schema migration (read-and-upgrade)
```

Per-project state:
```
<project>/.root/board/
├── 42.json                 ← stream state for issue #42
├── 58.json                 ← stream state for issue #58
└── 61.json                 ← stream state for issue #61
```

### Worktree Merge Strategy

All execution groups merge into a single feature branch. One branch, one PR per stream.

```
main
 └── feat/42-payments          ← stream branch (PR source)
      ├── worktree A: backend   ← merges into feat/42-payments
      ├── worktree B: frontend  ← merges into feat/42-payments
      └── worktree C: database  ← merges into feat/42-payments
```

`board_run` merges groups into the feature branch in dependency graph order after all groups complete, minimizing conflicts. The PR is created from the feature branch against main.

### Schema Migration

Each stream file carries a `schemaVersion` field. On read, if the version is missing or older than current, the server migrates the file in-place before returning data. Migrations are a simple version switch in `migrate.ts`. Since each stream is its own file, migration is per-file and lazy — only triggered when a stream is accessed. No batch migration tool needed. Same pattern as `root.config.json` → `configVersion`.

### Integration Points

- **`.mcp.json`**: Adds `root-board` server entry alongside `local-rag`
- **`root.config.json`**: New `board` section for gate config, maxParallel
- **`/root` skill**: Session init creates/resumes board stream instead of `/tmp/root-session.json`
- **`/root:impl`**: Reads stream from board, updates status during execution
- **`ensure-mcp.sh`**: Installs `mcp-root-board`, checks `gh auth status`
- **`context-receipt.sh`**: Optionally includes board status in receipt

## 6. User Experience

### Key User Flows

**Flow 1: Autonomous Tier 2 (zero touchpoints)**
```
User: /root:board start #58
      /root:board run #58
→ Root classifies as Tier 2
→ Plans ephemerally (auto-approved)
→ Implements in worktree
→ Validates (lint, types, tests)
→ Creates PR (gh pr create)
→ Labels issue root:pr-ready
→ "PR #72 ready for review: github.com/org/repo/pull/72"
```

**Flow 2: Tier 1 with plan approval**
```
User: /root:board start #42
      /root:board run #42
→ Root classifies as Tier 1
→ PRD authored (interview or from issue body)
→ Architect writes implementation plan
→ Plan summary posted to issue #42
→ Issue labeled root:plan-ready
→ Stream pauses: "Plan ready. Approve with board_approve or add root:approved label."

[Later — from phone, browser, or CLI]
User adds root:approved label on GitHub

[Next session]
User: /root:board run
→ board_sync detects approval
→ Implements per execution groups (parallel worktrees)
→ Reviewer gates each batch
→ Validates
→ Creates PR
→ "PR #73 ready for review"
```

**Flow 3: Multi-feature parallel**
```
User: /root:board start #42
      /root:board start #58
      /root:board start #61
      /root:board run

→ #58 (Tier 2): auto-completes to PR
→ #42 (Tier 1): pauses at plan-ready
→ #61 (Tier 1): pauses at plan-ready

User: /root:board
  #42  feat: payments      plan-ready     ../proj-42
  #58  fix: auth refresh   pr-ready       ../proj-58
  #61  feat: calendar      plan-ready     ../proj-61

User: /root:board approve #42
      /root:board run #42
→ #42 implements autonomously to PR
```

**Flow 4: Cross-harness execution groups**
```
Plan for #42 has 3 execution groups: A (backend), B (frontend), C (database)

User (Claude session): /root:board run #42 --groups A,C
User (Gemini session): /root:board run #42 --groups B

→ Claude implements A and C in their worktrees
→ Gemini implements B in its worktree
→ Board tracks progress per group
→ PR created after all groups complete
```

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `gh` CLI not authenticated in user environment | Medium | High — all GitHub integration fails | `ensure-mcp.sh` checks `gh auth status` on session start, warns clearly with setup instructions |
| Board state corruption from unclean shutdown | Low | Medium — stream stuck in wrong state | `board_sync` reconciles local state with GitHub labels. `board_clean` can reset stuck streams. State file is human-readable JSON. |
| Worktree accumulation (forgotten branches) | Medium | Low — disk space, git clutter | `board_clean` tears down merged/closed worktrees. `board_list` shows all active worktrees for visibility. |
| Two harnesses claim the same execution group | Low | High — conflicting edits | Board tracks group assignments. MCP server rejects `board_run --groups X` if group X is already assigned to another session. |
| Auto-progression creates broken PRs | Medium | Medium — noisy PRs, review burden | All existing gates (reviewer pass, lint, types, tests) must pass before PR creation. Auto-progression doesn't skip quality checks — it automates the phase transitions between them. |
| `gh` CLI version incompatibility | Low | Medium — commands fail silently | Document minimum `gh` version. Test against `gh` 2.x API surface. |

## 8. Success Metrics

- **Parallel features**: Can start 3+ issues simultaneously, each progresses independently to PR-ready with board tracking status across all of them
- **Autonomous Tier 2**: A Tier 2 bug fix goes from `board_start` + `board_run` to a merged-ready PR with zero additional human commands
- **Tier 1 single-pause**: A Tier 1 feature requires exactly one human touchpoint (plan approval) between `board_start` and PR creation
- **Cross-harness**: Two different harness sessions can work on different execution groups of the same feature without conflict
- **GitHub visibility**: Every active Root stream is visible on the GitHub issue via labels, filterable with `label:root:*`

## 9. Open Questions

_All resolved._

### Resolved

1. **Session-to-MCP binding** — Resolved: MCP servers are spawned per-session by the harness (same as `mcp-local-rag`). No daemon. State is persisted to per-stream files on disk (`.root/board/<issue>.json`). Multiple sessions share state through the filesystem. Zero contention for different issues; atomic writes for same-issue concurrent access.

2. **Worktree merge strategy** — Resolved: Single branch, single PR. All execution groups merge into the stream's feature branch in dependency graph order. `board_run` handles the merge sequence after all groups complete.

3. **Board state migration** — Resolved: `schemaVersion` field in each stream file. Lazy migration on read — if version is old, migrate in-place before returning data. Same pattern as `root.config.json` → `configVersion`. No batch migration tooling.
