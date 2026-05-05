/**
 * Check whether the `gh` CLI is authenticated with GitHub.
 *
 * @returns `{ authenticated: true }` when `gh auth status` exits 0, or
 *   `{ authenticated: false, error: <stderr> }` on a non-zero exit.
 */
export declare function checkGhAuth(): {
    authenticated: boolean;
    error?: string;
};
/**
 * Fetch details of a GitHub issue via the `gh` CLI.
 *
 * @param issue - GitHub issue number.
 * @returns Parsed issue object with `number`, `title`, `body`, `labels`, and `state`.
 * @throws {Error} If the `gh` command fails.
 */
export declare function getIssue(issue: number): {
    number: number;
    title: string;
    body: string;
    labels: string[];
    state: string;
};
/**
 * Fetch only the labels for a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @returns Array of label name strings.
 * @throws {Error} If the `gh` command fails.
 */
export declare function getIssueLabels(issue: number): string[];
/**
 * Add a label to a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to add.
 * @throws {Error} If the `gh` command fails.
 */
export declare function setLabel(issue: number, label: string): void;
/**
 * Remove a label from a GitHub issue. Swallows the error if the label is not present.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to remove.
 */
export declare function removeLabel(issue: number, label: string): void;
/**
 * Post a comment on a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @param body - Markdown body of the comment.
 * @throws {Error} If the `gh` command fails.
 */
export declare function addComment(issue: number, body: string): void;
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
export declare function getSubIssues(issue: number): number[];
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
export declare function createPR(head: string, base: string, title: string, body: string): string;
