# Workflow Reference

This file provides detailed execution guidance for Root-managed tasks.

---

## Two-Tier Development Framework

Every task enters one of two tiers based on scope. The `/root` skill classifies the tier automatically (Step 3), but the user can override explicitly.

### Tier Selection Criteria

| Signal | Tier 1 (Full Process) | Tier 2 (Light Process) |
|--------|----------------------|----------------------|
| **Scope** | Multiple packages, new systems, architectural changes | Single file or package, localized changes |
| **Artifact** | New feature, integration, data model change | Bug fix, typo, config update, dependency bump |
| **Risk** | Breaking changes, migration needed, API contract changes | No breaking changes, no migration |
| **Keywords** | "new feature", "refactor", "design", "architect", PRD reference | "fix", "bug", "patch", "typo", "update" |
| **Duration** | Hours to days | Minutes to an hour |

**Override rules**: The user's explicit statement always wins. "This is a quick fix" forces Tier 2. "Full process please" forces Tier 1.

---

### Tier 1 — Full Process

**When**: New features, large refactors, multi-package changes, new integrations, schema changes.

**Required artifacts**:
- PRD in `<prdsDir>/<slug>.md` (required before implementation)
- Implementation Plan in `<plansDir>/<slug>.md`

**Flow** (delegation is mandatory — the main thread orchestrates, agents execute):

```
1. PRD           → Write PRD (guided by /root:prd)
2. Plan          → team-architect writes Implementation Plan using TEMPLATE.md
3. Human Review  → Plan mode for approval
4. Implement     → team-implementer per Execution Group (parallel worktrees)
5. Test          → team-tester per Execution Group
6. Review        → team-reviewer validates against Change Manifest before commit
7. Validate      → Full quality gate (lint, type-check, tests)
8. Document      → Update relevant docs
9. Commit        → Zero errors, conventional commit format
```

**Main-thread rule**: You (the team lead) do not edit files, trace code paths, or write production code during Tier 1 work. You coordinate team members, validate their output, and commit approved changes.

**Phase 1: PRD**
1. Understand the requirement (read existing docs, related code, similar features)
2. Write a PRD following existing naming convention (kebab-case slug)
3. PRD must include: problem statement, proposed solution, scope, success criteria, out of scope
4. Present PRD for human review before proceeding

**Phase 2: Implementation Plan**
1. `/root` Step 8 spawns `team-architect` via the Agent tool to write the plan
2. `team-architect` traces code paths (may spawn its own Explore sub-agents), follows `<plansDir>/TEMPLATE.md`, and populates every section
3. Plan includes: Change Manifest (file-level with requirement traceability), Dependency Graph (Mermaid DAG), Execution Groups (parallel work streams with agent assignments), Coding Standards Compliance, Risk Register, Verification Plan
4. `team-architect` calls `ExitPlanMode` for human approval
5. After approval, `/root:impl` reads the plan's Execution Groups and spawns one `team-implementer` per group

**Phase 3: Human Review Gate**
- Present the PRD + implementation plan summary
- Wait for explicit approval before proceeding
- If changes requested, iterate on plan

**Phase 4: Implementation**
- `/root:impl` spawns one `team-implementer` per Execution Group via the Agent tool with `isolation: "worktree"`
- Each implementer works in its own isolated worktree, in parallel with other groups where the Dependency Graph allows
- `team-tester` is spawned alongside each group to author the required tests
- The main thread does NOT edit files — it monitors task state and validates output
- Mark tasks in_progress before starting, completed after verification
- Commit after each logical unit

**Phase 5: Validation**
- Spawn `team-reviewer` to validate every group's changes against the Change Manifest — this is mandatory for Tier 1, not optional
- `team-reviewer` runs lint/type-check (`root.config.json` → `validation.lintCommand`) and tests (`validation.testCommand`)
- `team-reviewer` reports PASS or an issue list. Issues block commit until resolved.
- The main thread commits only after the reviewer reports PASS

**Phase 6: Documentation**
- Update or create docs for new/changed systems
- JSDoc on all exported functions

**Phase 7: Commit & PR**
- Zero lint errors, zero type errors, zero test failures
- Conventional commit format: `type(scope): description`
- `Closes #XXXX` if working from an issue

---

### Tier 2 — Light Process

**When**: Bug fixes, single-file changes, typos, config updates, dependency bumps, obvious improvements.

**Required artifacts**: None persistent. Ephemeral plan in `<agent-dir>/plans/` (auto-cleaned after merge).

**Flow**:

```
1. Understand  → Read the relevant code, trace the issue
2. Plan        → Ephemeral plan via built-in plan mode (if >3 steps)
3. Fix         → Make the change
4. Validate    → Lint + type-check + relevant tests
5. Commit      → Conventional commit (message serves as documentation)
```

**Phase 1: Understand**
1. Read the file(s) involved
2. Trace the code path to understand the bug/issue
3. Identify the minimal change needed

**Phase 2: Plan (optional)**
- `/root` Step 8 produces an ephemeral plan via built-in plan mode (`<agent-dir>/plans/`)
- Plans are NOT persisted after merge — GitHub issue/PR linkage provides traceability
- For trivial fixes (typo, single-line change), `/root` may skip the plan

**Phase 3: Fix**
- Make the change directly
- Follow existing patterns (search for similar code first)

**Phase 4: Validate**
- Run validation commands from `root.config.json`
- Run tests for affected packages
- For trivial fixes, validation is still mandatory

**Phase 5: Commit**
- Conventional commit format
- The commit message + PR description serve as documentation
- If the fix reveals a systemic issue, create a GitHub Issue for follow-up

---

## Agent Teams

**Agent Teams are the default execution mode for Tier 1 work.** There is no work-stream count gate — every Tier 1 task runs through the team, even single-group plans. The main thread is the team lead; it coordinates but does not implement.

Tier 2 work stays in the main thread (with single-agent delegation via the routing table in your project's CLAUDE.md) — teams add too much overhead for <50 LOC fixes.

### Team Roles

| Role | Agent | Capabilities | When spawned |
|------|-------|-------------|--------------|
| **Architect** | `team-architect` | Read-only, plan mode | `/root` Step 8 — before any code changes |
| **Implementer** | `team-implementer` | Full read/write, isolated worktree | `/root:impl` — one per Execution Group, parallel where possible |
| **Tester** | `team-tester` | Full read/write | Alongside each implementer in a group |
| **Reviewer** | `team-reviewer` | Read + run checks | After implementation, before commit |

### Workflow
1. `/root` Step 8 spawns `team-architect` → plan mode
2. User approves plan → `/root:impl` parses Execution Groups
3. `/root:impl` spawns `team-implementer` + `team-tester` per group, in parallel worktrees where dependencies allow
4. After each batch, main thread spawns `team-reviewer` to validate against the Change Manifest
5. Main thread commits only after reviewer reports PASS

### Rules
- Architect designs before implementers code — no parallel shortcut
- Main thread never edits production files during Tier 1 work
- One Execution Group per teammate at a time
- TaskList is source of truth for progress
- Never commit until `team-reviewer` reports PASS
- If a teammate gets stuck, the main thread asks the user — it does not silently take over the work
