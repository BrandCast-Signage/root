export const meta = {
  name: 'root-tier1-execution',
  description:
    'Execute a Root Tier 1 Implementation Plan: dependency-ordered batches of parallel team-implementer agents (each in its own board worktree), each batch gated by a team-reviewer loop-until-PASS. Returns a structured result the /root:impl main thread uses to drive board state.',
  phases: [
    { title: 'Implement', detail: 'one team-implementer per group, in parallel, per batch' },
    { title: 'Review', detail: 'team-reviewer per batch, re-spawn implementers until PASS' },
  ],
}

// ---------------------------------------------------------------------------
// args contract (built by the /root:impl main thread from the parsed plan):
//   {
//     issue:            number,
//     planPath:         string,
//     autoApprove:      boolean,
//     codingStandards:  string[],
//     validation:       { lintCommand: string, testCommand: string },
//     migrationGroups:  string[],   // group letters that touch migration paths
//     migrationSafety:  string|null,// verbatim "Database Migration Safety" section
//     migrationRules:   string|null,// verbatim "Migration Hard Rules" block
//     batches: [                    // dependency-ordered; index N runs after N-1
//       { groups: [
//           { letter, name, sequence, testTask,
//             changes: [ { num, file, action, section, description, reqs } ] }
//       ] }
//     ]
//   }
// ---------------------------------------------------------------------------
const plan = args
const MAX_REVIEW_ROUNDS = 6

const IMPLEMENTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: { type: 'string', description: 'Execution Group letter, e.g. "A"' },
    status: { enum: ['complete', 'blocked'] },
    commits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sha: { type: 'string', description: 'first 7 chars of the commit hash' },
          message: { type: 'string' },
        },
        required: ['sha', 'message'],
      },
    },
    changedFiles: { type: 'array', items: { type: 'string' } },
    worktreePath: { type: ['string', 'null'], description: 'board worktree the work landed in' },
    migrationHalt: {
      type: 'boolean',
      description: 'true ONLY when blocked because of a migration deviation that the Hard Rules require halting on',
    },
    blockedReason: { type: ['string', 'null'] },
  },
  required: ['group', 'status', 'commits', 'changedFiles', 'migrationHalt'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { enum: ['PASS', 'ISSUES'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          group: { type: 'string', description: 'which Execution Group letter the issue belongs to' },
          file: { type: ['string', 'null'] },
          severity: { type: ['string', 'null'] },
          description: { type: 'string' },
        },
        required: ['group', 'description'],
      },
    },
  },
  required: ['verdict', 'issues'],
}

function changeLines(group) {
  return group.changes
    .map(
      (c) =>
        `  - #${c.num} [${c.action}] ${c.file} — ${c.section ?? '(whole file)'}: ${c.description} (reqs: ${
          (c.reqs ?? []).join(', ') || 'none'
        })`,
    )
    .join('\n')
}

function migrationBlock(group) {
  if (!plan.migrationGroups?.includes(group.letter)) return ''
  return `

## DATABASE MIGRATION GROUP — HARD RULES APPLY
This group touches migration paths. The following rules are non-negotiable. A migration
deviation is the ONE case where you must STOP rather than decide-and-proceed: set
status="blocked", migrationHalt=true, and explain in blockedReason.

### Migration Safety section (from the plan)
${plan.migrationSafety ?? '(none supplied — treat absence as a reason to halt)'}

### Migration Hard Rules
${plan.migrationRules ?? '(none supplied — treat absence as a reason to halt)'}
`
}

function implementerPrompt(group, fixIssues) {
  const fixSection = fixIssues
    ? `

## THIS IS A FIX PASS
A reviewer flagged the following issues in your Group ${group.letter} work. Address every one,
commit the fixes (conventional format, e.g. \`fix(${group.name}): address review findings\`),
and report the new commit(s). Do NOT re-do already-correct work.
${fixIssues.map((i, n) => `  ${n + 1}. [${i.severity ?? 'n/a'}] ${i.file ?? ''} — ${i.description}`).join('\n')}
`
    : ''

  return `You are implementing Execution Group ${group.letter} ("${group.name}") of a Root Tier 1 plan.

Plan file: ${plan.planPath}
Issue: #${plan.issue}

## FIRST: get your isolated worktree (REQUIRED — do not skip)
Call the board MCP tool \`board_start({ issue: ${plan.issue}, groupId: "${group.letter}" })\`.
This creates/returns a uniquely-named board worktree \`<project>-${plan.issue}-${group.letter}\`
so parallel groups never collide. \`cd\` into the returned Worktree path and do ALL work and
ALL commits there. Report that path back as worktreePath. Do NOT create your own worktree and
do NOT work in the main checkout.

## Change Manifest entries for this group
${changeLines(group)}

## Sequence
${group.sequence ?? '(follow the change order above)'}

## Test task (required deliverable)
${group.testTask ?? '(write tests covering happy path, edge cases, and error conditions for the changed code)'}

## How to work each change
- For modify/delete: Read the target first. Search the codebase (Glob/Grep) for existing
  patterns and follow them.
- Mark each Change Manifest entry \`[~]\` in ${plan.planPath} when you start it and
  \`[x] (<sha>)\` when its commit lands.
- Commit in conventional format, one commit per logical unit. Stage ONLY this group's files.
- Write and run the tests. Then run lint/type-check and the scoped tests:
    lint:  ${plan.validation.lintCommand}
    test:  ${plan.validation.testCommand}
  Fix failures before reporting complete.

## Coding standards
${(plan.codingStandards ?? []).map((s) => `  - ${s}`).join('\n') || '  (none specified)'}
${migrationBlock(group)}${fixSection}

## Reporting (StructuredOutput)
Return: group="${group.letter}", status="complete" only if every change is committed and
validation passes; otherwise status="blocked" with a blockedReason. List every commit (7-char
sha + message), the changed files, and the worktreePath. Set migrationHalt=true ONLY for a
migration deviation that the Hard Rules require halting on.`
}

function reviewerPrompt(batch, implResults) {
  const groupSummaries = batch.groups
    .map((g) => {
      const r = implResults.find((x) => x && x.group === g.letter)
      const commits = r ? r.commits.map((c) => `${c.sha} ${c.message}`).join('; ') : '(no result)'
      return `  - Group ${g.letter} ("${g.name}"): commits ${commits}`
    })
    .join('\n')

  return `You are reviewing a completed batch of a Root Tier 1 plan before it advances.

Plan file: ${plan.planPath}
Issue: #${plan.issue}
Groups in this batch:
${groupSummaries}

Validate the batch's changes against the plan's Change Manifest for these groups. Run:
  lint:  ${plan.validation.lintCommand}
  test:  ${plan.validation.testCommand}
Check the coding standards:
${(plan.codingStandards ?? []).map((s) => `  - ${s}`).join('\n') || '  (none specified)'}

Return verdict="PASS" if every change matches its manifest entry, lint/type-check pass, and
tests pass. Otherwise verdict="ISSUES" with a concrete issue list. For each issue you MUST set
\`group\` to the Execution Group letter it belongs to (one of: ${batch.groups
    .map((g) => g.letter)
    .join(', ')}) so the right implementer can be re-spawned. Do not write code — review only.`
}

function blocked(batchIndex, letters, reason, migrationHalt, completedBatches) {
  return { status: 'blocked', batchIndex, groups: letters, reason, migrationHalt: migrationHalt === true, completedBatches }
}

// ---------------------------------------------------------------------------
// Execution: batches are a genuine barrier chain — batch N hard-depends on the
// PASS of batch N-1, so this is a sequential loop with a parallel fan-out and a
// review gate inside each iteration.
// ---------------------------------------------------------------------------
const completedBatches = []

for (let bi = 0; bi < plan.batches.length; bi++) {
  const batch = plan.batches[bi]
  const letters = batch.groups.map((g) => g.letter).join(', ')
  log(`Batch ${bi + 1}/${plan.batches.length}: implementing groups ${letters}`)

  // --- Implement (parallel, one agent per group) ---
  let implResults = await parallel(
    batch.groups.map((g) => () =>
      agent(implementerPrompt(g, null), {
        label: `impl:${g.letter}`,
        phase: 'Implement',
        agentType: 'team-implementer',
        schema: IMPLEMENTER_SCHEMA,
      }),
    ),
  )

  const firstBad = implResults.find((r) => !r || r.status === 'blocked')
  if (firstBad) {
    return blocked(
      bi,
      letters,
      firstBad ? firstBad.blockedReason || 'implementer returned blocked' : 'implementer returned null (crashed/skipped)',
      firstBad && firstBad.migrationHalt,
      completedBatches,
    )
  }

  // --- Review loop-until-PASS ---
  let round = 0
  while (true) {
    round++
    if (round > MAX_REVIEW_ROUNDS) {
      return blocked(bi, letters, `reviewer did not reach PASS after ${MAX_REVIEW_ROUNDS} rounds`, false, completedBatches)
    }

    const review = await agent(reviewerPrompt(batch, implResults), {
      label: `review:${letters} r${round}`,
      phase: 'Review',
      agentType: 'team-reviewer',
      schema: REVIEW_SCHEMA,
    })

    if (!review || review.verdict === 'PASS') break

    const affected = new Set(review.issues.map((i) => i.group))
    const fixGroups = batch.groups.filter((g) => affected.has(g.letter))
    if (fixGroups.length === 0) {
      // Reviewer flagged issues but mapped none to a group — cannot route a fix.
      return blocked(bi, letters, 'reviewer reported ISSUES with no group mapping; cannot route a fix', false, completedBatches)
    }

    log(`Batch ${bi + 1} review round ${round}: re-spawning groups ${fixGroups.map((g) => g.letter).join(', ')}`)

    const fixResults = await parallel(
      fixGroups.map((g) => () =>
        agent(implementerPrompt(g, review.issues.filter((i) => i.group === g.letter)), {
          label: `fix:${g.letter} r${round}`,
          phase: 'Implement',
          agentType: 'team-implementer',
          schema: IMPLEMENTER_SCHEMA,
        }),
      ),
    )

    const fixBad = fixResults.find((r) => !r || r.status === 'blocked')
    if (fixBad) {
      return blocked(
        bi,
        letters,
        fixBad ? fixBad.blockedReason || 'fix pass returned blocked' : 'fix pass returned null (crashed/skipped)',
        fixBad && fixBad.migrationHalt,
        completedBatches,
      )
    }

    // Fold fix commits into the batch's running result for the next review + reporting.
    for (const fr of fixResults) {
      const idx = implResults.findIndex((r) => r.group === fr.group)
      if (idx >= 0) {
        implResults[idx] = {
          ...implResults[idx],
          commits: [...implResults[idx].commits, ...fr.commits],
          changedFiles: [...new Set([...implResults[idx].changedFiles, ...fr.changedFiles])],
        }
      }
    }
  }

  completedBatches.push({
    batchIndex: bi,
    groups: batch.groups.map((g) => g.letter),
    commits: implResults.flatMap((r) => r.commits),
    changedFiles: [...new Set(implResults.flatMap((r) => r.changedFiles))],
    worktrees: implResults.map((r) => ({ group: r.group, worktreePath: r.worktreePath ?? null })),
  })
  log(`Batch ${bi + 1} complete — reviewer PASS`)
}

return { status: 'complete', completedBatches }
