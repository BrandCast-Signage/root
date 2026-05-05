import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createEpicStream, createStream, deleteStream, listStreams, readStream, updateStream } from "./board.js";
import { classifyTier } from "./classify.js";
import { evaluateGate, getNextTransition, loadGateConfig } from "./gates.js";
import { analyzeGraph, extractMermaidBlock } from "./graph.js";
import { addComment, getIssue, getIssueLabels, getSubIssues, removeLabel, setLabel } from "./github.js";
import { loadNotificationConfig, sendDiscord } from "./notify.js";
import { loadGithubProjectConfig, setProjectStatusInProgress } from "./project.js";
import { appendSharedContext, getSharedContext } from "./sharedContext.js";
import { IssueContext } from "./types.js";
import { createWorktree, removeWorktree } from "./worktree.js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const rootDir = process.env["ROOT_DIR"] ?? process.cwd();

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "root-board",
  version: "0.4.0",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `fn` and swallow any thrown error, logging it to stderr with `label`
 * for context. Used wherever we call out to gh / GraphQL / a webhook and
 * do not want a transient external failure to break a real workflow.
 */
function nonFatal(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${label}] non-fatal failure: ${msg}`);
  }
}

/**
 * Slugify a string for use in a branch name segment.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims leading/trailing hyphens.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Format a streams table as plain text.
 */
function formatStreamsTable(streams: ReturnType<typeof listStreams>): string {
  if (streams.length === 0) {
    return "No active streams.";
  }

  // Separate parents/standalone from children.
  const childIssueNums = new Set<number>();
  for (const s of streams) {
    if (s.parentIssue !== null) {
      childIssueNums.add(s.issue.number);
    }
  }

  const lines: string[] = [];
  lines.push(["Issue", "Title", "Status", "Worktree"].join("\t"));

  for (const s of streams) {
    // Skip children — they're rendered under their parent.
    if (childIssueNums.has(s.issue.number)) continue;

    const title = s.issue.title.length > 35 ? s.issue.title.slice(0, 32) + "..." : s.issue.title;
    const worktree = s.worktreePath ?? "—";
    lines.push(`#${s.issue.number}\t${title}\t${s.status}\t${worktree}`);

    // Render children indented under this parent.
    if (s.childIssues.length > 0) {
      for (const childNum of s.childIssues) {
        const child = streams.find((c) => c.issue.number === childNum);
        if (child) {
          const childTitle = child.issue.title.length > 33 ? child.issue.title.slice(0, 30) + "..." : child.issue.title;
          const childWorktree = child.worktreePath ?? "—";
          lines.push(`  #${child.issue.number}\t${childTitle}\t${child.status}\t${childWorktree}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool: board_list
// ---------------------------------------------------------------------------

server.tool("board_list", "List all active work streams on the board.", {}, async () => {
  const streams = listStreams(rootDir);
  return {
    content: [{ type: "text", text: formatStreamsTable(streams) }],
  };
});

// ---------------------------------------------------------------------------
// Tool: board_start
// ---------------------------------------------------------------------------

server.tool(
  "board_start",
  "Start a new work stream for a GitHub issue. Fetches issue context, creates a stream record, and sets up a git worktree.",
  {
    issue: z.number().int().positive().describe("GitHub issue number"),
    autoApprove: z.boolean().optional().describe("When true, all gates auto-advance — fully autonomous even for Tier 1"),
    parentIssue: z.number().int().positive().optional().describe("Parent issue number if this stream is a decomposed sub-issue"),
    tier: z.enum(["tier1", "tier2"]).optional().describe("Explicit tier override (e.g. from a user-supplied --tier flag). When omitted, the tier is classified from issue labels and title/body."),
    tierJustification: z.string().optional().describe("Required when `tier` is supplied. Explain why the caller is overriding the classifier (e.g. \"user passed --tier 1\", \"touches prisma/schema.prisma per database-migrations-tier1 rule\"). Rejected if blank or whitespace."),
  },
  async ({ issue, autoApprove, parentIssue, tier: tierOverride, tierJustification }) => {
    // Reject unmotivated overrides up front. Recording *why* a tier was forced
    // is the whole point of v2's tierReason/tierSource — accepting a bare
    // override would defeat it.
    if (tierOverride !== undefined) {
      const trimmed = tierJustification?.trim() ?? "";
      if (trimmed.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `board_start: \`tier\` was supplied but \`tierJustification\` is missing or blank. Either omit \`tier\` (and let the classifier decide) or pass a non-empty \`tierJustification\` explaining the override.`,
            },
          ],
          isError: true,
        };
      }
    }

    // Fetch issue context from GitHub.
    const issueData = getIssue(issue);
    const issueContext: IssueContext = {
      number: issueData.number,
      title: issueData.title,
      labels: issueData.labels,
      state: issueData.state,
    };

    // Resolve tier: user override wins, otherwise classify from the issue itself.
    const classification: { tier: "tier1" | "tier2"; reason: string; source: "classifier" | "override" } = tierOverride
      ? { tier: tierOverride, reason: tierJustification!.trim(), source: "override" }
      : { ...classifyTier(issueData), source: "classifier" };

    const stream = createStream(
      issueContext,
      classification.tier,
      classification.source,
      classification.reason,
      rootDir
    );

    // Set auto-approve and parent linkage if provided.
    const updates: Record<string, unknown> = {};
    if (autoApprove) {
      updates.autoApprove = true;
    }
    if (parentIssue !== undefined) {
      updates.parentIssue = parentIssue;
      // Add this child to the parent's childIssues array.
      const parent = readStream(rootDir, parentIssue);
      if (parent !== null) {
        const children = parent.childIssues.includes(issue)
          ? parent.childIssues
          : [...parent.childIssues, issue];
        updateStream(rootDir, parentIssue, { childIssues: children });
      }
    }
    if (Object.keys(updates).length > 0) {
      updateStream(rootDir, issue, updates);
    }

    // Build branch name: feat/<issue>-<slugified-title>
    const branchName = `feat/${issue}-${slugify(issueData.title)}`;

    // Create the worktree.
    const worktreePath = createWorktree(rootDir, issue, branchName);

    // Update stream with worktree path and branch.
    const updated = updateStream(rootDir, issue, {
      worktreePath,
      branch: branchName,
    });

    nonFatal("setLabel:root:planning", () => setLabel(issue, "root:planning"));

    // Sync the linked GitHub Project v2 item to "In Progress" — feature is
    // gated on `board.githubProject` being present in `root.config.json`.
    const projectCfg = loadGithubProjectConfig(rootDir);
    if (projectCfg !== null) {
      nonFatal("project:setStatus", () => {
        setProjectStatusInProgress(issue, projectCfg);
        if (projectCfg.mirrorLabel !== undefined) {
          nonFatal("setLabel:mirror", () => setLabel(issue, projectCfg.mirrorLabel!));
        }
      });
    }

    // Notify when an autonomous run is going to park on a human gate.
    // We can detect this today by tier-1 + autoApprove=false: the plan_approval
    // gate will pause the run pending human review. Single-issue runs without
    // autoApprove also notify, but the human is presumably at the keyboard;
    // this is mainly to make multi-issue / overnight epic runs visible.
    const notifyCfg = loadNotificationConfig(rootDir);
    if (notifyCfg !== null && classification.tier === "tier1" && autoApprove !== true) {
      void sendDiscord(
        "human_gate",
        {
          title: `Tier 1 plan approval needed: #${issue}`,
          url: `https://github.com/${process.env["GITHUB_REPOSITORY"] ?? ""}/issues/${issue}`,
          description: `Stream #${issue} started at tier 1 — plan_approval gate will pause for human review.`,
          fields: [
            { name: "Title", value: updated.issue.title },
            { name: "Tier reason", value: classification.reason },
            { name: "Branch", value: updated.branch ?? "(unset)" },
          ],
        },
        notifyCfg
      );
    }

    const lines = [
      `Stream #${issue} started.`,
      `Title:     ${updated.issue.title}`,
      `Branch:    ${updated.branch}`,
      `Worktree:  ${updated.worktreePath}`,
      `Status:    ${updated.status}`,
      `Tier:      ${updated.tier} (${classification.source}: ${classification.reason})`,
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_epic_start
// ---------------------------------------------------------------------------

server.tool(
  "board_epic_start",
  "Start a parent stream for an autonomous multi-issue run. For mode='epic', children are fetched from the parent's GitHub sub-issues. For mode='batch', children must be supplied explicitly. Does NOT execute children — that's the orchestrator's job.",
  {
    epicIssue: z.number().int().positive().describe("GitHub issue number of the epic / batch parent"),
    mode: z.enum(["epic", "batch"]).describe("'epic' resolves children via the GitHub sub-issues connection; 'batch' uses the explicit `children` array"),
    children: z.array(z.number().int().positive()).optional().describe("Required for mode='batch'; ignored for mode='epic'"),
  },
  async ({ epicIssue, mode, children }) => {
    if (mode === "batch" && (children === undefined || children.length === 0)) {
      return {
        content: [
          { type: "text", text: "board_epic_start: mode='batch' requires a non-empty `children` array." },
        ],
        isError: true,
      };
    }

    const issueData = getIssue(epicIssue);
    const issueContext: IssueContext = {
      number: issueData.number,
      title: issueData.title,
      labels: issueData.labels,
      state: issueData.state,
    };

    let resolvedChildren: number[];
    if (mode === "epic") {
      resolvedChildren = getSubIssues(epicIssue);
      if (resolvedChildren.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `board_epic_start: #${epicIssue} has no linked sub-issues. Either link children first, or use mode='batch' with an explicit list.`,
            },
          ],
          isError: true,
        };
      }
    } else {
      resolvedChildren = children!;
    }

    const stream = createEpicStream(issueContext, mode, resolvedChildren, rootDir);

    nonFatal("setLabel:root:planning", () => setLabel(epicIssue, "root:planning"));

    const lines = [
      `${mode === "epic" ? "Epic" : "Batch"} stream #${epicIssue} started.`,
      `Title:    ${stream.issue.title}`,
      `Branch:   ${stream.epicBranch}`,
      `Children: ${resolvedChildren.map((n) => `#${n}`).join(", ")}`,
      `Status:   ${stream.status}`,
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tools: board_shared_get / board_shared_append
// ---------------------------------------------------------------------------

server.tool(
  "board_shared_get",
  "Read the shared-context markdown for an epic / batch stream. Returns empty string if no notes yet.",
  {
    epicIssue: z.number().int().positive().describe("Issue number of the epic / batch parent stream"),
  },
  async ({ epicIssue }) => {
    const text = getSharedContext(rootDir, epicIssue);
    return {
      content: [{ type: "text", text: text.length > 0 ? text : "(no shared context yet)" }],
    };
  }
);

server.tool(
  "board_shared_append",
  "Append a timestamped note to an epic / batch stream's shared-context. On overflow (>32KB) fires a blocker notification and returns isError so the caller stops dispatching further children.",
  {
    epicIssue: z.number().int().positive().describe("Issue number of the epic / batch parent stream"),
    note: z.string().min(1).describe("Markdown note. Format readably; this content gets read by every subsequent subagent."),
  },
  async ({ epicIssue, note }) => {
    const result = appendSharedContext(rootDir, epicIssue, note);
    if (result.overflow) {
      const notifyCfg = loadNotificationConfig(rootDir);
      if (notifyCfg !== null) {
        void sendDiscord(
          "blocker",
          {
            title: `Shared-context overflow on #${epicIssue}`,
            description: `Shared-context file exceeded the 32KB limit (now ${result.bytes} bytes). Run is paused — review and trim before continuing.`,
            fields: [{ name: "Epic", value: `#${epicIssue}` }],
          },
          notifyCfg
        );
      }
      return {
        content: [
          {
            type: "text",
            text: `Shared-context overflow on #${epicIssue}: ${result.bytes} bytes (limit ${32 * 1024}). Stop dispatching further children and trim manually.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: `Appended to shared-context for #${epicIssue} (${result.bytes} bytes).` },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_status
// ---------------------------------------------------------------------------

server.tool(
  "board_status",
  "Show detailed status for a work stream identified by its GitHub issue number.",
  { issue: z.number().int().positive().describe("GitHub issue number") },
  async ({ issue }) => {
    const stream = readStream(rootDir, issue);

    if (stream === null) {
      return {
        content: [{ type: "text", text: `No stream found for #${issue}` }],
      };
    }

    const groupLines =
      Object.keys(stream.groups).length > 0
        ? Object.entries(stream.groups).map(
            ([id, g]) =>
              `  ${id}: harness=${g.harness ?? "unassigned"} status=${g.status} worktree=${g.worktreePath ?? "(none)"}`
          )
        : ["  (none)"];

    const lines = [
      `Stream #${stream.issue.number}: ${stream.issue.title}`,
      `Tier:       ${stream.tier} (${stream.tierSource}: ${stream.tierReason})`,
      `Status:     ${stream.status}`,
      `Branch:     ${stream.branch}`,
      `Worktree:   ${stream.worktreePath ?? "(none)"}`,
      `Plan:       ${stream.planPath ?? "(none)"}`,
      `PRD:        ${stream.prdPath ?? "(none)"}`,
      `Created:    ${stream.created}`,
      `Updated:    ${stream.updated}`,
      `Groups:`,
      ...groupLines,
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_approve
// ---------------------------------------------------------------------------

server.tool(
  "board_approve",
  "Approve a stream that is in plan-ready status, advancing it to approved.",
  { issue: z.number().int().positive().describe("GitHub issue number") },
  async ({ issue }) => {
    const stream = readStream(rootDir, issue);

    if (stream === null) {
      return {
        content: [{ type: "text", text: `No stream found for #${issue}` }],
      };
    }

    if (stream.status !== "plan-ready") {
      return {
        content: [
          {
            type: "text",
            text: `Cannot approve #${issue} — current status is ${stream.status}, expected plan-ready`,
          },
        ],
      };
    }

    updateStream(rootDir, issue, { status: "approved" });

    try {
      removeLabel(issue, "root:plan-ready");
    } catch {
      // Non-fatal.
    }
    try {
      setLabel(issue, "root:approved");
    } catch {
      // Non-fatal.
    }

    return {
      content: [
        { type: "text", text: `Stream #${issue} approved. Ready for implementation.` },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_run
// ---------------------------------------------------------------------------

server.tool(
  "board_run",
  "Evaluate gates and determine the next action for a work stream. Does not execute implementation — returns what the calling skill should do next.",
  {
    issue: z.number().int().positive().describe("GitHub issue number"),
    groups: z.string().optional().describe("Optional comma-separated list of group IDs"),
  },
  async ({ issue }) => {
    const stream = readStream(rootDir, issue);

    if (stream === null) {
      return {
        content: [{ type: "text", text: `No stream found for #${issue}` }],
      };
    }

    // Handle decomposed parents: check child status instead of own state machine.
    if (stream.status === "decomposed") {
      const childStatuses: string[] = [];
      let allDone = true;
      for (const childNum of stream.childIssues) {
        const child = readStream(rootDir, childNum);
        if (child) {
          childStatuses.push(`#${childNum}: ${child.status}`);
          if (child.status !== "pr-ready" && child.status !== "merged") {
            allDone = false;
          }
        }
      }
      if (allDone && stream.childIssues.length > 0) {
        const allMerged = stream.childIssues.every((cn) => {
          const c = readStream(rootDir, cn);
          return c?.status === "merged";
        });
        const newStatus = allMerged ? "merged" : "pr-ready";
        updateStream(rootDir, issue, { status: newStatus });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ status: "ready", nextPhase: newStatus, action: `All child issues complete. Parent advanced to ${newStatus}.` }, null, 2),
          }],
        };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "decomposed", children: childStatuses, action: "Parent is decomposed. Child issues are still in progress." }, null, 2),
        }],
      };
    }

    const transition = getNextTransition(stream.status);

    if (transition === null) {
      return {
        content: [
          {
            type: "text",
            text: `Stream #${issue} is in terminal state: ${stream.status}`,
          },
        ],
      };
    }

    // If there is a gate, evaluate it (unless stream has autoApprove).
    if (transition.gate !== null && !stream.autoApprove) {
      const gateConfig = loadGateConfig(rootDir);
      const gateResult = evaluateGate(transition.gate, stream.tier, gateConfig);

      if (gateResult.action === "human") {
        const payload = JSON.stringify(
          {
            status: "blocked",
            gate: transition.gate,
            reason: gateResult.reason,
            action:
              "Requires human approval. Use board_approve or add root:approved label in GitHub.",
          },
          null,
          2
        );
        return { content: [{ type: "text", text: payload }] };
      }
    }

    // Auto-progress: determine action description for the calling skill.
    const actionDescriptions: Partial<Record<string, string>> = {
      planning: "Run /root to classify tier, fetch context, and begin planning",
      "plan-ready": "Planning complete. Transition to plan-ready.",
      implementing: "Run /root:impl to execute the implementation plan",
      validating: "All groups complete. Run final validation.",
      "pr-ready": "Validation passed. Create PR with gh pr create.",
    };

    const actionText =
      actionDescriptions[transition.next] ??
      `Advance stream to ${transition.next}.`;

    // Persist the new status.
    updateStream(rootDir, issue, { status: transition.next });

    // Update GitHub labels — non-fatal.
    const labelMap: Partial<Record<string, { remove: string; add: string }>> = {
      planning: { remove: "root:queued", add: "root:planning" },
      "plan-ready": { remove: "root:planning", add: "root:plan-ready" },
      approved: { remove: "root:plan-ready", add: "root:approved" },
      implementing: { remove: "root:approved", add: "root:implementing" },
      validating: { remove: "root:implementing", add: "root:validating" },
      "pr-ready": { remove: "root:validating", add: "root:pr-ready" },
      merged: { remove: "root:pr-ready", add: "root:merged" },
    };

    const labelOp = labelMap[transition.next];
    if (labelOp !== undefined) {
      try {
        removeLabel(issue, labelOp.remove);
      } catch {
        // Non-fatal.
      }
      try {
        setLabel(issue, labelOp.add);
      } catch {
        // Non-fatal.
      }
    }

    const payload = JSON.stringify(
      {
        status: "ready",
        nextPhase: transition.next,
        action: actionText,
      },
      null,
      2
    );

    return { content: [{ type: "text", text: payload }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_sync
// ---------------------------------------------------------------------------

server.tool(
  "board_sync",
  "Sync all stream statuses with GitHub — detects label changes and closed/merged issues.",
  {},
  async () => {
    const streams = listStreams(rootDir);
    const changes: string[] = [];

    for (const stream of streams) {
      const issueNum = stream.issue.number;

      try {
        const labels = getIssueLabels(issueNum);
        const issueData = getIssue(issueNum);

        // Issue closed or merged → mark stream merged.
        if (
          (issueData.state === "CLOSED" || issueData.state === "MERGED") &&
          stream.status !== "merged"
        ) {
          updateStream(rootDir, issueNum, { status: "merged" });
          changes.push(`#${issueNum}: marked merged (issue ${issueData.state})`);
          continue;
        }

        // Label root:approved detected while stream is still plan-ready.
        if (labels.includes("root:approved") && stream.status === "plan-ready") {
          updateStream(rootDir, issueNum, { status: "approved" });
          changes.push(`#${issueNum}: advanced to approved via GitHub label`);
        }
      } catch {
        // gh not available or issue not found — skip this stream.
      }

      // Parent completion tracking: if decomposed, check all children.
      if (stream.status === "decomposed" && stream.childIssues.length > 0) {
        const allDone = stream.childIssues.every((cn) => {
          const child = readStream(rootDir, cn);
          return child?.status === "pr-ready" || child?.status === "merged";
        });
        if (allDone) {
          const allMerged = stream.childIssues.every((cn) => {
            const child = readStream(rootDir, cn);
            return child?.status === "merged";
          });
          const newStatus = allMerged ? "merged" : "pr-ready";
          updateStream(rootDir, issueNum, { status: newStatus });
          changes.push(`#${issueNum}: parent advanced to ${newStatus} (all children complete)`);
        }
      }
    }

    const summary =
      changes.length > 0 ? changes.join("\n") : "No changes detected.";

    return { content: [{ type: "text", text: summary }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_delete
// ---------------------------------------------------------------------------

server.tool(
  "board_delete",
  "Delete a work stream and its worktree. Use when abandoning work on an issue.",
  { issue: z.number().int().positive().describe("GitHub issue number") },
  async ({ issue }) => {
    const stream = readStream(rootDir, issue);

    if (stream === null) {
      return {
        content: [{ type: "text", text: `No stream found for #${issue}` }],
      };
    }

    // Remove worktree if it exists.
    if (stream.worktreePath !== null) {
      try {
        removeWorktree(rootDir, stream.worktreePath);
      } catch {
        // Already gone — continue.
      }
    }

    // Remove root: labels from the issue.
    const rootLabels = ["root:planning", "root:plan-ready", "root:approved", "root:implementing", "root:validating", "root:pr-ready"];
    for (const label of rootLabels) {
      try {
        removeLabel(issue, label);
      } catch {
        // Non-fatal.
      }
    }

    // Cascade: delete child streams if this is a parent.
    let childrenDeleted = 0;
    if (stream.childIssues.length > 0) {
      for (const childNum of stream.childIssues) {
        const child = readStream(rootDir, childNum);
        if (child) {
          if (child.worktreePath !== null) {
            try { removeWorktree(rootDir, child.worktreePath); } catch { /* ignore */ }
          }
          for (const label of rootLabels) {
            try { removeLabel(childNum, label); } catch { /* ignore */ }
          }
          deleteStream(rootDir, childNum);
          childrenDeleted++;
        }
      }
    }

    // If this is a child, remove it from the parent's childIssues.
    if (stream.parentIssue !== null) {
      const parent = readStream(rootDir, stream.parentIssue);
      if (parent !== null) {
        updateStream(rootDir, stream.parentIssue, {
          childIssues: parent.childIssues.filter((n) => n !== issue),
        });
      }
    }

    // Delete the stream file.
    deleteStream(rootDir, issue);

    const msg = childrenDeleted > 0
      ? `Stream #${issue} deleted (+ ${childrenDeleted} child stream${childrenDeleted === 1 ? "" : "s"}). Worktrees and labels cleaned up.`
      : `Stream #${issue} deleted. Worktree and labels cleaned up.`;

    return {
      content: [{ type: "text", text: msg }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_analyze_plan
// ---------------------------------------------------------------------------

server.tool(
  "board_analyze_plan",
  "Analyze an Implementation Plan's dependency graph for independent concerns. Returns subgraph analysis indicating whether decomposition is recommended.",
  {
    planPath: z.string().describe("Path to the Implementation Plan markdown file"),
  },
  async ({ planPath }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const resolved = path.resolve(rootDir, planPath);
    if (!fs.existsSync(resolved)) {
      return {
        content: [{ type: "text", text: `Plan file not found: ${planPath}` }],
      };
    }

    const markdown = fs.readFileSync(resolved, "utf8");
    const mermaidBlock = extractMermaidBlock(markdown);

    if (mermaidBlock === null) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            shouldDecompose: false,
            reason: "No Mermaid dependency graph found in the plan. Cannot analyze for decomposition.",
            subgraphs: [],
          }, null, 2),
        }],
      };
    }

    const analysis = analyzeGraph(mermaidBlock);

    const subgraphSummaries = analysis.subgraphs.map((sg) => ({
      groups: sg.groups,
      nodes: sg.nodes.map((n) => n.label),
      nodeCount: sg.nodes.length,
    }));

    const result = {
      shouldDecompose: analysis.shouldDecompose,
      reason: analysis.shouldDecompose
        ? `Plan contains ${analysis.subgraphs.length} independent concerns (disconnected subgraphs in the dependency graph). Decomposition recommended.`
        : "Plan is a single coherent concern (fully connected dependency graph). No decomposition needed.",
      subgraphs: subgraphSummaries,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: board_clean
// ---------------------------------------------------------------------------

server.tool(
  "board_clean",
  "Remove worktrees and board records for streams in merged or pr-ready status.",
  {},
  async () => {
    const streams = listStreams(rootDir);
    const cleanable = streams.filter(
      (s) => s.status === "merged" || s.status === "pr-ready"
    );

    if (cleanable.length === 0) {
      return { content: [{ type: "text", text: "No streams to clean" }] };
    }

    let cleaned = 0;

    for (const stream of cleanable) {
      if (stream.worktreePath !== null) {
        try {
          removeWorktree(rootDir, stream.worktreePath);
        } catch {
          // Already gone or not a registered worktree — continue.
        }
      }

      deleteStream(rootDir, stream.issue.number);
      cleaned++;
    }

    return {
      content: [{ type: "text", text: `${cleaned} stream${cleaned === 1 ? "" : "s"} cleaned up` }],
    };
  }
);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error starting root-board MCP server: ${message}\n`);
  process.exit(1);
});
