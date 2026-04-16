# Changelog

All notable changes to the Root development workflow framework are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] — 2026-04-16

### Added

- **Tier provenance is now persisted on every stream record.** `StreamState` gains two fields: `tierSource` (`"classifier" | "override"`) and `tierReason` (the classifier's reason text, or the caller-supplied justification when overriding). Surfaced by `board_status` and `board_start`'s response. Closes the gap where the only way to learn *why* a stream was Tier N was to re-read `classify.ts` and guess.
- **`board_start` now requires a `tierJustification` whenever `tier` is supplied.** Bare overrides (passing `tier: "tier1"` with no reason) are rejected with a clear error. The MCP no longer accepts unmotivated tier overrides — agents have to type out *why* they are overriding the classifier, which is the moment unmotivated overrides become visible.
- `mcp/mcp-root-board/src/types.ts`: `SCHEMA_VERSION` bumped to 2.
- `mcp/mcp-root-board/src/migrate.ts`: v1 → v2 migration backfills `tierSource: "classifier"` and `tierReason: "unknown (pre-v2 record)"` on existing stream records. Records keep their original `tier` value — migration does not re-classify.

### Why

A stream record at `/Users/jduncan/Code/brandcast/.root/board/1567.json` was created with `tier: "tier1"` despite labels (`type:bug`, `area:infrastructure`, `type:chore`) that should have classified it as Tier 2. The agent that called `board_start` passed `tier: "tier1"` with no justification, then narrated to the user that the tier was "auto-inferred from body length" — a fabrication, since `classifyTier` has no length-based signals at all. v2.2.0 makes that class of mistake structurally impossible: the override path requires a justification at the API boundary, and the persisted `tierSource`/`tierReason` fields make every tier decision auditable after the fact.

### Migration

No action required. Existing v1 stream records are migrated transparently on next read; the backfilled `tierReason` is `"unknown (pre-v2 record)"`, which is honest about what we know.

## [2.1.10] — 2026-04-15

### Added

- **Database migration safety enforcement.** Any plan whose Change Manifest touches migration paths (`prisma/schema.prisma`, `prisma/migrations/**`, `**/migrations/**/*.sql`, `alembic/versions/**`, `db/migrate/**`, `**/migrations/*.py`) now requires a "Database Migration Safety" section covering breaking-change enumeration, generated-SQL verification, rollout order, and reversibility. Plans without it fail the rubric.
- `commands/root/impl.md` Step 1 builds a migration group set from Change Manifest file paths (deterministic, no keyword matching). Step 6 inlines a verbatim "Migration Hard Rules" block into every `team-implementer` prompt for groups in that set.
- Autonomous Mode Contract now carves out migration deviations as a mandatory halt — autoApprove does not delegate judgment on migration-safety divergence. Implementer stops and blocks instead of auto-resolving.
- `agents/team-implementer.md` rule #5: Migration Hard Rules in the prompt override every other operating rule, including autoApprove.
- Tier 2 plans that touch migration paths are rejected at Step 1 with an instruction to re-plan as Tier 1.

## [2.1.9] — 2026-04-14

### Fixed

- **Tier classification no longer silently defaults to Tier 1.** `board_start` hardcoded `"tier1"` when creating a stream, with a comment that the `/root` skill would classify later — but no tool existed to persist that classification, so every stream ran Tier 1 gate policy regardless of what was said in the kickoff summary.
- Added `classifyTier` (`mcp/mcp-root-board/src/classify.ts`) which classifies from `type:*` labels (authoritative) and title/body keywords. Ambiguous issues classify as Tier 2 with an explicit reason inviting the caller to override.
- `board_start` now accepts an optional `tier` override for explicit user intent (e.g. `/root #42 --tier 1`) and reports the classification reason in its response.
- `skills/root/SKILL.md` Step 3 updated: tier classification is owned by the MCP; the skill only extracts a user override if present.

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
