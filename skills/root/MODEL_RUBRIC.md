# Model & Harness Selection Rubric

Reference guide for selecting the right model and harness per workflow phase. Used by `/root` during session init and by `root:board` when suggesting execution group assignments.

---

## Model Selection

### Planning & Architecture
**Model**: Opus
**Why**: Requires deep reasoning over large context (PRDs, existing codebase, constraints). Opus handles ambiguity well and produces implementation plans with the specificity the `/root:impl` rubric requires.

### Implementation — Standard
**Model**: Sonnet
**Why**: Tasks are bounded and well-defined by the implementation plan. Sonnet is faster and cost-efficient for checklist-style execution where the design decisions are already made.

### Implementation — Complex or Novel
**Model**: Opus
**Why**: Novel algorithms, significant refactors, or tasks with high ambiguity benefit from Opus's stronger reasoning. Use when the implementation plan flags a group as high-risk or exploratory.

### Code Review
**Model**: Sonnet
**Why**: Review follows a defined checklist (correctness, style, test coverage). Bounded validation is a Sonnet strength. Escalate to Opus only if the diff introduces architectural concerns.

### Test Writing
**Model**: Sonnet
**Why**: Tests map directly from implementation behavior. Well-defined input/output pairs, standard patterns. Sonnet handles this faster with comparable quality.

### Exploration & Search
**Model**: Sonnet (or either)
**Why**: RAG queries, codebase mapping, and `root:explore` tasks are pattern-matching and retrieval work. Sonnet is sufficient; Opus adds cost without benefit unless interpreting a complex or poorly-documented codebase.

---

## Harness Selection

### When to Use Claude Code
- **Planning phase**: Plan-mode support is Claude Code-native. Opus + plan-mode is the standard pairing for `root:impl run`.
- **Agent spawning**: `team-implementer`, `team-reviewer`, and `team-tester` are invoked via the Agent tool, which is Claude Code-specific.
- **Worktree isolation**: Parallel implementation groups using separate git worktrees rely on Claude Code's Agent tool.
- **MCP tool access**: Any group that needs to read or write board state via `mcp-root-board` works most reliably from Claude Code.
- **Complex implementation groups**: When Opus escalation is needed mid-execution, Claude Code handles the model switch natively.

### When to Use Gemini CLI
- **Sequential bounded tasks**: Gemini CLI is fast for single-threaded, well-scoped implementation groups.
- **Domain-specific strengths**: Some codebases or problem domains may suit Gemini's model characteristics. Use when the team has a stated preference or observed quality difference.
- **Parallel execution**: When Claude Code is busy with a high-priority group, Gemini CLI can claim a separate group without blocking.
- **Tier 2 bug fixes**: Straightforward bug fixes with clear reproduction steps are a good fit for Gemini CLI.

### Either Harness
- RAG queries (`root:rag`, `root:explore`)
- Codebase exploration and documentation health checks
- Tier 2 bug fixes (non-architectural)
- Any task where the group's harness was pre-assigned by the board

### Cross-Harness Splitting

- **Split at the execution group level**, not the feature level. A feature's groups can be distributed across harnesses; a single group must have exactly one harness owner.
- **The board enforces ownership.** Both harnesses talk to the same `mcp-root-board` MCP server. The board blocks a second harness from claiming an already-claimed group.
- **Planning stays on Claude Code.** The planning phase requires plan-mode, which is Claude Code-only. Do not split planning across harnesses.
- **Implementation groups can be split freely** based on load, availability, or domain preference — as long as each group is claimed before work begins.
- **Handoff at group boundaries only.** Never hand off mid-group. Complete the group, mark it done on the board, then the next harness picks up its assigned group.

---

## Decision Matrix

| Phase | Recommended Model | Recommended Harness | Notes |
|---|---|---|---|
| Planning / Architecture | Opus | Claude Code | Plan-mode required |
| Implementation — standard | Sonnet | Either | Assign via board |
| Implementation — complex/novel | Opus | Claude Code | Agent spawning preferred |
| Code Review | Sonnet | Either | Escalate to Opus if architectural |
| Test Writing | Sonnet | Either | |
| Exploration / Search | Sonnet | Either | |
| Tier 1 Bug Fix | Opus | Claude Code | See team delegation rules |
| Tier 2 Bug Fix | Sonnet | Either | |

---

## Default Agent Assignments

These match the model hardcoded in each agent's frontmatter. Override per-group on the board when warranted.

| Agent Role | Default Model | Rationale |
|---|---|---|
| `team-architect` | Opus | Design and planning require deep reasoning |
| `team-implementer` | Sonnet | Bounded execution from a defined plan |
| `team-reviewer` | Sonnet | Checklist-style validation |
| `team-tester` | Sonnet | Standard test patterns from known behavior |
