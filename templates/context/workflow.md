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

**Flow**:

```
1. PRD           → Write PRD (use team-architect agent)
2. Plan          → /root Step 8 generates Implementation Plan using TEMPLATE.md
3. Human Review  → Plan mode for approval
4. Implement     → Task tracking from plan's Execution Groups
5. Validate      → Full quality gate (lint, type-check, tests)
6. Document      → Update relevant docs
7. Commit        → Zero errors, conventional commit format
```

**Phase 1: PRD**
1. Understand the requirement (read existing docs, related code, similar features)
2. Write a PRD following existing naming convention (kebab-case slug)
3. PRD must include: problem statement, proposed solution, scope, success criteria, out of scope
4. Present PRD for human review before proceeding

**Phase 2: Implementation Plan**
1. `/root` Step 8 spawns Explore agents to trace code paths from the PRD
2. Implementation Plan written using `<plansDir>/TEMPLATE.md`
3. Plan includes: Change Manifest (file-level with requirement traceability), Dependency Graph (Mermaid DAG), Execution Groups (parallel work streams with agent assignments), Coding Standards Compliance, Risk Register, Verification Plan
4. Enter plan mode for human approval
5. After approval, `/root` Step 9 generates tasks from the plan's Execution Groups
6. For deep architectural analysis, optionally spawn `team-architect` agent

**Phase 3: Human Review Gate**
- Present the PRD + implementation plan summary
- Wait for explicit approval before proceeding
- If changes requested, iterate on plan

**Phase 4: Implementation**
- Tasks generated from the plan's Execution Groups (one task per group, not per file)
- Execution Groups define parallel agent assignments — each group can run as a separate agent
- Mark tasks in_progress before starting, completed after verification
- Commit after each logical unit

**Phase 5: Validation**
- Run lint/type-check (from `root.config.json` → `validation.lintCommand`)
- Run tests (from `root.config.json` → `validation.testCommand`)
- Spawn team-reviewer agent for cross-package review
- All checks must pass

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

**Required artifacts**: None persistent. Ephemeral plan in `.claude/plans/` (auto-cleaned after merge).

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
- `/root` Step 8 produces an ephemeral plan via built-in plan mode (`.claude/plans/`)
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

For complex tasks with >2 independent work streams, use Agent Teams. (Tier 1 only.)

### Team Roles

| Role | Agent | Capabilities |
|------|-------|-------------|
| **Architect** | `team-architect` | Read-only, plan mode |
| **Implementer** | `team-implementer` | Full read/write |
| **Reviewer** | `team-reviewer` | Read + run checks |
| **Tester** | `team-tester` | Full read/write |

### Workflow
1. Create team → Create tasks → Spawn architect first (plan mode)
2. Review architect's plan → Spawn implementers
3. Monitor via TaskList → Spawn reviewer after implementation
4. Only team lead commits after review

### Rules
- Architect designs before implementers code
- One task per teammate at a time
- TaskList is source of truth
- Never commit until review passes
