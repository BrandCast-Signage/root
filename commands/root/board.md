# /root:board — Board Orchestration

Manage multi-feature work streams with gate-based auto-progression. Each stream is backed by a GitHub issue, tracked locally, and isolated in its own git worktree.

Parse the first word of the argument to determine the action. Default to `list` if no argument.

## Subcommands

### `list` (default)

Show all active streams.

1. Call `board_list` MCP tool
2. Output the result as-is (it returns a formatted table)
3. If no streams, suggest: "No active streams. Start one with `/root:board start #<issue>`"

### `start <issue> [--auto]`

Create a new work stream for a GitHub issue.

1. Parse the issue number from the argument (supports `#42`, `42`, `issue 42`)
2. Check for `--auto` flag. If present, pass `autoApprove: true` to the MCP tool — this makes the stream fully autonomous, skipping all human-approval gates including Tier 1 plan approval.
3. Call `board_start` MCP tool with the issue number (and `autoApprove` if flagged)
4. Output the stream summary
5. If `--auto`: "Stream created in auto-approve mode. All gates will auto-advance."
6. Suggest next step: "Run `/root:board run #<issue>` to begin autonomous execution, or `/root #<issue>` for manual control."

### `status [issue]`

Show detailed status for a specific stream, or all streams if no issue specified.

1. If issue number provided: call `board_status` MCP tool with the issue number
2. If no issue: call `board_list` MCP tool
3. Output the result

### `approve <issue>`

Green-light a Tier 1 plan for implementation.

1. Parse the issue number
2. Call `board_approve` MCP tool with the issue number
3. Output the result
4. If successful, suggest: "Approved. Run `/root:board run #<issue>` to begin autonomous implementation."

### `run [issue] [--groups A,B]`

Auto-progress a stream through gates. This is the orchestration driver — it evaluates what needs to happen next and dispatches to the appropriate skill.

1. If no issue specified and only one active stream exists, use that. If multiple, call `board_list` and ask the user which stream to run.
2. If `--groups` flag is provided, parse the comma-separated group letters. This limits execution to those groups only (for cross-harness splitting).
3. Call `board_sync` first to pick up any external state changes (e.g., GitHub label approvals)
4. Enter the progression loop:

```
loop:
  Call board_run MCP tool with the issue number
  Parse the response (JSON with status, nextPhase, action fields)

  If status is "blocked":
    Output: "⏸ Stream #<issue> paused at <gate>: <reason>"
    Output: "<action>" (instructions for how to unblock)
    Break the loop.

  If status is "ready":
    Based on nextPhase, dispatch:

    "planning":
      Run /root <issue number> to classify tier, gather context, and plan.
      After /root completes, the stream status will be updated by the skill.
      Continue loop.

    "plan-ready":
      The plan has been written. Stream transitions to plan-ready.
      Continue loop (next iteration will evaluate the plan_approval gate).

    "approved":
      Plan was auto-approved (Tier 2) or human-approved.
      Continue loop.

    "implementing":
      Run /root:impl run with the plan path from stream state.
      If --groups was specified, pass the groups constraint.
      After impl completes, continue loop.

    "validating":
      Run /root:impl finalize to run final validation.
      Continue loop.

    "pr-ready":
      Output: "✓ Stream #<issue> complete. PR ready for review."
      Break the loop.

  If status is terminal (merged, etc.):
    Output: "Stream #<issue> is complete (<status>)."
    Break the loop.
```

5. After the loop exits, call `board_status` to show final state.

### `sync`

Synchronize local board state with GitHub.

1. Call `board_sync` MCP tool
2. Output the result (which streams were updated and how)

### `delete <issue>`

Abandon a work stream. Removes the stream record, its worktree, and any `root:*` labels from the GitHub issue.

1. Parse the issue number
2. Call `board_delete` MCP tool with the issue number
3. Output the result

### `clean`

Clean up completed streams (status `merged` or `pr-ready`) and their worktrees.

1. Call `board_clean` MCP tool
2. Output the result (how many streams cleaned, which worktrees removed)
