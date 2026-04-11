# Changelog

All notable changes to the Root development workflow framework are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] — 2026-04-11

Tier 1 work now runs through the agent team by default. Main-thread implementation is no longer the normal path — the main session coordinates, agents execute.

### Changed

- **Team agent descriptions** (`agents/team-*.md`) rewritten from capability-style to trigger-condition style. All four now lead with "Use proactively when…" and list explicit trigger vocabulary. This is the primary lever Claude uses to decide when to delegate, so the new descriptions should raise auto-delegation rates without the user having to force agent usage.
- **Specialist agent descriptions** (`agents/specialist-*.md`) rewritten the same way. Customization guidance is preserved in the body, but the frontmatter description now carries trigger words (`area:backend`, `api`, `middleware`, etc.) that survive project-level customization.
- **`/root` skill (`skills/root/SKILL.md`)**: Step 8 Tier 1 path now delegates the Implementation Plan to `team-architect` via the Agent tool. The main thread no longer traces code paths or writes the plan itself. Step 7 kickoff summary's "Next Step" is now a directive, not a nudge.
- **`workflow.md`**: Tier 1 flow updated to show per-phase agent delegation. Phase 2 (Implementation Plan) is owned by `team-architect`. Phase 4 (Implementation) spawns one `team-implementer` per Execution Group in parallel worktrees, with `team-tester` alongside. Phase 5 (Validation) mandates `team-reviewer` before commit.
- **`/root:impl` command (`commands/root/impl.md`)**:
  - Step 6 (Execute Groups) is now imperative: "You MUST spawn one `team-implementer` per group. Do NOT edit files in the main thread." Spawn prompt structure is spelled out.
  - Step 7 (Checkpoint) now spawns `team-reviewer` before presenting the checkpoint to the user. Reviewer must return PASS before proceeding. If issues, re-spawn `team-implementer` to fix — no main-thread patching.
  - Step 10 PR menu replaces "Review with team-reviewer first" (optional) with "Full-plan reviewer sweep first" (explicit cross-group review step) since per-batch review is now mandatory upstream.
- **Agent Teams section of `workflow.md`**: Removed the ">2 independent work streams" gate. Teams are now the default execution mode for Tier 1, even for single-group plans. Tier 2 stays in the main thread with single-agent delegation.

### Why

Prior versions treated team usage as recommended-but-optional. The observed failure mode: Claude would read the workflow, see team agents listed, decide the task was "simple enough", and implement in the main thread anyway. This produced inconsistent results across sessions and made the team infrastructure decorative. Making delegation imperative — and making the trigger vocabulary explicit in agent descriptions — removes the decision point.

### Migration

No action required for existing Root-managed projects. The changes are:
- Agent description changes apply on next session start (Claude re-reads them).
- Skill/workflow/command changes apply on next `/root` and `/root:impl` invocation.
- Existing plan files and session state remain compatible.

Projects that have customized their specialist agent descriptions should consider adding "Use proactively when…" trigger vocabulary if they want similar auto-delegation behavior.
