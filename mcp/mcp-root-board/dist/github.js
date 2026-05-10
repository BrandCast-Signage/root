"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkGhAuth = checkGhAuth;
exports.getIssue = getIssue;
exports.getIssueLabels = getIssueLabels;
exports.setLabel = setLabel;
exports.removeLabel = removeLabel;
exports.addComment = addComment;
exports.getSubIssues = getSubIssues;
exports.getTerminalGitHubState = getTerminalGitHubState;
exports.createPR = createPR;
const node_child_process_1 = require("node:child_process");
/**
 * Check whether the `gh` CLI is authenticated with GitHub.
 *
 * @returns `{ authenticated: true }` when `gh auth status` exits 0, or
 *   `{ authenticated: false, error: <stderr> }` on a non-zero exit.
 */
function checkGhAuth() {
    try {
        (0, node_child_process_1.execSync)("gh auth status", { encoding: "utf-8" });
        return { authenticated: true };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { authenticated: false, error };
    }
}
/**
 * Fetch details of a GitHub issue via the `gh` CLI.
 *
 * @param issue - GitHub issue number.
 * @returns Parsed issue object with `number`, `title`, `body`, `labels`, and `state`.
 * @throws {Error} If the `gh` command fails.
 */
function getIssue(issue) {
    const stdout = (0, node_child_process_1.execSync)(`gh issue view ${issue} --json number,title,body,labels,state`, { encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    return {
        number: parsed.number,
        title: parsed.title,
        body: parsed.body,
        labels: parsed.labels.map((l) => l.name),
        state: parsed.state,
    };
}
/**
 * Fetch only the labels for a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @returns Array of label name strings.
 * @throws {Error} If the `gh` command fails.
 */
function getIssueLabels(issue) {
    const stdout = (0, node_child_process_1.execSync)(`gh issue view ${issue} --json labels`, { encoding: "utf-8" });
    const parsed = JSON.parse(stdout);
    return parsed.labels.map((l) => l.name);
}
/**
 * Add a label to a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to add.
 * @throws {Error} If the `gh` command fails.
 */
function setLabel(issue, label) {
    (0, node_child_process_1.execFileSync)("gh", ["issue", "edit", String(issue), "--add-label", label], {
        encoding: "utf-8",
    });
}
/**
 * Remove a label from a GitHub issue. Swallows the error if the label is not present.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to remove.
 */
function removeLabel(issue, label) {
    try {
        (0, node_child_process_1.execFileSync)("gh", ["issue", "edit", String(issue), "--remove-label", label], {
            encoding: "utf-8",
        });
    }
    catch (err) {
        const stderr = err instanceof Error ? err.message : String(err);
        // Swallow "label not found" style errors — nothing to remove is fine.
        if (stderr.includes("not found") ||
            stderr.includes("does not exist") ||
            stderr.includes("Label")) {
            return;
        }
        throw err;
    }
}
/**
 * Post a comment on a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @param body - Markdown body of the comment.
 * @throws {Error} If the `gh` command fails.
 */
function addComment(issue, body) {
    (0, node_child_process_1.execFileSync)("gh", ["issue", "comment", String(issue), "--body", body], {
        encoding: "utf-8",
    });
}
/**
 * Fetch the sub-issues of a GitHub issue, in declared order.
 *
 * Uses the `subIssues` connection on `Issue` (introduced with GitHub's
 * native sub-issues feature). The query is repo-aware via the same
 * owner/repo `gh` resolves locally.
 *
 * @param issue - Parent issue number.
 * @returns Child issue numbers in the order GitHub returns them, which
 *   matches the order they were linked under the parent.
 * @throws {Error} If the `gh api graphql` call fails. Unlike Project sync,
 *   this is non-recoverable for epic mode — the orchestrator needs the
 *   list of children before it can dispatch anything.
 */
function getSubIssues(issue) {
    const repoJson = (0, node_child_process_1.execSync)("gh repo view --json owner,name", { encoding: "utf-8" });
    const { owner, name } = JSON.parse(repoJson);
    const query = `query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){subIssues(first:100){nodes{number}}}}}`;
    const out = (0, node_child_process_1.execFileSync)("gh", [
        "api", "graphql",
        "-f", `query=${query}`,
        "-f", `owner=${owner.login}`,
        "-f", `repo=${name}`,
        "-F", `num=${issue}`,
    ], { encoding: "utf-8" });
    const parsed = JSON.parse(out);
    return parsed.data.repository.issue.subIssues.nodes.map((n) => n.number);
}
/**
 * Check the terminal GitHub state for a stream's issue and branch.
 *
 * Returns whether the issue is closed and whether the linked branch's PR is
 * merged. Both checks together indicate that a stream has completed out-of-band
 * (e.g. the user merged manually) and the board record can be auto-deleted.
 *
 * @param issue - GitHub issue number.
 * @param branch - Branch name to search for a merged PR.
 * @returns Object with `issueClosed` and `prMerged` flags.
 */
function getTerminalGitHubState(issue, branch) {
    let issueClosed = false;
    let prMerged = false;
    try {
        const issueOut = (0, node_child_process_1.execSync)(`gh issue view ${issue} --json state,closed`, { encoding: "utf-8" });
        const issueData = JSON.parse(issueOut);
        issueClosed = issueData.closed === true || issueData.state === "CLOSED";
    }
    catch {
        // gh unavailable or issue not found — treat as not closed.
    }
    if (branch !== null) {
        try {
            const prOut = (0, node_child_process_1.execSync)(`gh pr list --head "${branch}" --state merged --json number,mergedAt`, { encoding: "utf-8" });
            const prs = JSON.parse(prOut);
            prMerged = prs.length > 0;
        }
        catch {
            // gh unavailable or no PR found — treat as not merged.
        }
    }
    return { issueClosed, prMerged };
}
/**
 * Create a pull request via the `gh` CLI.
 *
 * @param head - Head branch name.
 * @param base - Base branch name.
 * @param title - PR title.
 * @param body - PR body (markdown).
 * @returns The PR URL printed by `gh pr create`.
 * @throws {Error} If the `gh` command fails.
 */
function createPR(head, base, title, body) {
    const stdout = (0, node_child_process_1.execFileSync)("gh", ["pr", "create", "--head", head, "--base", base, "--title", title, "--body", body], { encoding: "utf-8" });
    return stdout.trim();
}
