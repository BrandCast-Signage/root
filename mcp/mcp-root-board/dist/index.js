"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const board_js_1 = require("./board.js");
const gates_js_1 = require("./gates.js");
const github_js_1 = require("./github.js");
const worktree_js_1 = require("./worktree.js");
// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const rootDir = process.env["ROOT_DIR"] ?? process.cwd();
// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new mcp_js_1.McpServer({
    name: "root-board",
    version: "0.1.0",
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Slugify a string for use in a branch name segment.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims leading/trailing hyphens.
 */
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * Format a streams table as plain text.
 */
function formatStreamsTable(streams) {
    if (streams.length === 0) {
        return "No active streams.";
    }
    const header = ["Issue", "Title", "Status", "Worktree", "Groups"].join("\t");
    const rows = streams.map((s) => {
        const issue = `#${s.issue.number}`;
        const title = s.issue.title.length > 40 ? s.issue.title.slice(0, 37) + "..." : s.issue.title;
        const status = s.status;
        const worktree = s.worktreePath ?? "(none)";
        const groups = Object.keys(s.groups).length > 0 ? Object.keys(s.groups).join(", ") : "(none)";
        return [issue, title, status, worktree, groups].join("\t");
    });
    return [header, ...rows].join("\n");
}
// ---------------------------------------------------------------------------
// Tool: board_list
// ---------------------------------------------------------------------------
server.tool("board_list", "List all active work streams on the board.", {}, async () => {
    const streams = (0, board_js_1.listStreams)(rootDir);
    return {
        content: [{ type: "text", text: formatStreamsTable(streams) }],
    };
});
// ---------------------------------------------------------------------------
// Tool: board_start
// ---------------------------------------------------------------------------
server.tool("board_start", "Start a new work stream for a GitHub issue. Fetches issue context, creates a stream record, and sets up a git worktree.", { issue: zod_1.z.number().int().positive().describe("GitHub issue number") }, async ({ issue }) => {
    // Fetch issue context from GitHub.
    const issueData = (0, github_js_1.getIssue)(issue);
    const issueContext = {
        number: issueData.number,
        title: issueData.title,
        labels: issueData.labels,
        state: issueData.state,
    };
    // Create the stream (default tier1 — tier is classified later by /root skill).
    const stream = (0, board_js_1.createStream)(issueContext, "tier1", rootDir);
    // Build branch name: feat/<issue>-<slugified-title>
    const branchName = `feat/${issue}-${slugify(issueData.title)}`;
    // Create the worktree.
    const worktreePath = (0, worktree_js_1.createWorktree)(rootDir, issue, branchName);
    // Update stream with worktree path and branch.
    const updated = (0, board_js_1.updateStream)(rootDir, issue, {
        worktreePath,
        branch: branchName,
    });
    // Label the issue — non-fatal if gh is not authenticated.
    try {
        (0, github_js_1.setLabel)(issue, "root:planning");
    }
    catch {
        // gh not authenticated or label doesn't exist — ignore.
    }
    const lines = [
        `Stream #${issue} started.`,
        `Title:     ${updated.issue.title}`,
        `Branch:    ${updated.branch}`,
        `Worktree:  ${updated.worktreePath}`,
        `Status:    ${updated.status}`,
        `Tier:      ${updated.tier}`,
    ];
    return {
        content: [{ type: "text", text: lines.join("\n") }],
    };
});
// ---------------------------------------------------------------------------
// Tool: board_status
// ---------------------------------------------------------------------------
server.tool("board_status", "Show detailed status for a work stream identified by its GitHub issue number.", { issue: zod_1.z.number().int().positive().describe("GitHub issue number") }, async ({ issue }) => {
    const stream = (0, board_js_1.readStream)(rootDir, issue);
    if (stream === null) {
        return {
            content: [{ type: "text", text: `No stream found for #${issue}` }],
        };
    }
    const groupLines = Object.keys(stream.groups).length > 0
        ? Object.entries(stream.groups).map(([id, g]) => `  ${id}: harness=${g.harness ?? "unassigned"} status=${g.status} worktree=${g.worktreePath ?? "(none)"}`)
        : ["  (none)"];
    const lines = [
        `Stream #${stream.issue.number}: ${stream.issue.title}`,
        `Tier:       ${stream.tier}`,
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
});
// ---------------------------------------------------------------------------
// Tool: board_approve
// ---------------------------------------------------------------------------
server.tool("board_approve", "Approve a stream that is in plan-ready status, advancing it to approved.", { issue: zod_1.z.number().int().positive().describe("GitHub issue number") }, async ({ issue }) => {
    const stream = (0, board_js_1.readStream)(rootDir, issue);
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
    (0, board_js_1.updateStream)(rootDir, issue, { status: "approved" });
    try {
        (0, github_js_1.removeLabel)(issue, "root:plan-ready");
    }
    catch {
        // Non-fatal.
    }
    try {
        (0, github_js_1.setLabel)(issue, "root:approved");
    }
    catch {
        // Non-fatal.
    }
    return {
        content: [
            { type: "text", text: `Stream #${issue} approved. Ready for implementation.` },
        ],
    };
});
// ---------------------------------------------------------------------------
// Tool: board_run
// ---------------------------------------------------------------------------
server.tool("board_run", "Evaluate gates and determine the next action for a work stream. Does not execute implementation — returns what the calling skill should do next.", {
    issue: zod_1.z.number().int().positive().describe("GitHub issue number"),
    groups: zod_1.z.string().optional().describe("Optional comma-separated list of group IDs"),
}, async ({ issue }) => {
    const stream = (0, board_js_1.readStream)(rootDir, issue);
    if (stream === null) {
        return {
            content: [{ type: "text", text: `No stream found for #${issue}` }],
        };
    }
    const transition = (0, gates_js_1.getNextTransition)(stream.status);
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
    // If there is a gate, evaluate it.
    if (transition.gate !== null) {
        const gateConfig = (0, gates_js_1.loadGateConfig)(rootDir);
        const gateResult = (0, gates_js_1.evaluateGate)(transition.gate, stream.tier, gateConfig);
        if (gateResult.action === "human") {
            const payload = JSON.stringify({
                status: "blocked",
                gate: transition.gate,
                reason: gateResult.reason,
                action: "Requires human approval. Use board_approve or add root:approved label in GitHub.",
            }, null, 2);
            return { content: [{ type: "text", text: payload }] };
        }
    }
    // Auto-progress: determine action description for the calling skill.
    const actionDescriptions = {
        planning: "Run /root to classify tier, fetch context, and begin planning",
        "plan-ready": "Planning complete. Transition to plan-ready.",
        implementing: "Run /root:impl to execute the implementation plan",
        validating: "All groups complete. Run final validation.",
        "pr-ready": "Validation passed. Create PR with gh pr create.",
    };
    const actionText = actionDescriptions[transition.next] ??
        `Advance stream to ${transition.next}.`;
    // Persist the new status.
    (0, board_js_1.updateStream)(rootDir, issue, { status: transition.next });
    // Update GitHub labels — non-fatal.
    const labelMap = {
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
            (0, github_js_1.removeLabel)(issue, labelOp.remove);
        }
        catch {
            // Non-fatal.
        }
        try {
            (0, github_js_1.setLabel)(issue, labelOp.add);
        }
        catch {
            // Non-fatal.
        }
    }
    const payload = JSON.stringify({
        status: "ready",
        nextPhase: transition.next,
        action: actionText,
    }, null, 2);
    return { content: [{ type: "text", text: payload }] };
});
// ---------------------------------------------------------------------------
// Tool: board_sync
// ---------------------------------------------------------------------------
server.tool("board_sync", "Sync all stream statuses with GitHub — detects label changes and closed/merged issues.", {}, async () => {
    const streams = (0, board_js_1.listStreams)(rootDir);
    const changes = [];
    for (const stream of streams) {
        const issueNum = stream.issue.number;
        try {
            const labels = (0, github_js_1.getIssueLabels)(issueNum);
            const issueData = (0, github_js_1.getIssue)(issueNum);
            // Issue closed or merged → mark stream merged.
            if ((issueData.state === "CLOSED" || issueData.state === "MERGED") &&
                stream.status !== "merged") {
                (0, board_js_1.updateStream)(rootDir, issueNum, { status: "merged" });
                changes.push(`#${issueNum}: marked merged (issue ${issueData.state})`);
                continue;
            }
            // Label root:approved detected while stream is still plan-ready.
            if (labels.includes("root:approved") && stream.status === "plan-ready") {
                (0, board_js_1.updateStream)(rootDir, issueNum, { status: "approved" });
                changes.push(`#${issueNum}: advanced to approved via GitHub label`);
            }
        }
        catch {
            // gh not available or issue not found — skip this stream.
        }
    }
    const summary = changes.length > 0 ? changes.join("\n") : "No changes detected.";
    return { content: [{ type: "text", text: summary }] };
});
// ---------------------------------------------------------------------------
// Tool: board_clean
// ---------------------------------------------------------------------------
server.tool("board_clean", "Remove worktrees and board records for streams in merged or pr-ready status.", {}, async () => {
    const streams = (0, board_js_1.listStreams)(rootDir);
    const cleanable = streams.filter((s) => s.status === "merged" || s.status === "pr-ready");
    if (cleanable.length === 0) {
        return { content: [{ type: "text", text: "No streams to clean" }] };
    }
    let cleaned = 0;
    for (const stream of cleanable) {
        if (stream.worktreePath !== null) {
            try {
                (0, worktree_js_1.removeWorktree)(rootDir, stream.worktreePath);
            }
            catch {
                // Already gone or not a registered worktree — continue.
            }
        }
        (0, board_js_1.deleteStream)(rootDir, stream.issue.number);
        cleaned++;
    }
    return {
        content: [{ type: "text", text: `${cleaned} stream${cleaned === 1 ? "" : "s"} cleaned up` }],
    };
});
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal error starting root-board MCP server: ${message}\n`);
    process.exit(1);
});
