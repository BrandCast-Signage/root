import { execFileSync, execSync } from "node:child_process";

/**
 * Check whether the `gh` CLI is authenticated with GitHub.
 *
 * @returns `{ authenticated: true }` when `gh auth status` exits 0, or
 *   `{ authenticated: false, error: <stderr> }` on a non-zero exit.
 */
export function checkGhAuth(): { authenticated: boolean; error?: string } {
  try {
    execSync("gh auth status", { encoding: "utf-8" });
    return { authenticated: true };
  } catch (err) {
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
export function getIssue(
  issue: number
): { number: number; title: string; body: string; labels: string[]; state: string } {
  const stdout = execSync(
    `gh issue view ${issue} --json number,title,body,labels,state`,
    { encoding: "utf-8" }
  );

  const parsed = JSON.parse(stdout) as {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    state: string;
  };

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
export function getIssueLabels(issue: number): string[] {
  const stdout = execSync(`gh issue view ${issue} --json labels`, { encoding: "utf-8" });
  const parsed = JSON.parse(stdout) as { labels: Array<{ name: string }> };
  return parsed.labels.map((l) => l.name);
}

/**
 * Add a label to a GitHub issue.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to add.
 * @throws {Error} If the `gh` command fails.
 */
export function setLabel(issue: number, label: string): void {
  execFileSync("gh", ["issue", "edit", String(issue), "--add-label", label], {
    encoding: "utf-8",
  });
}

/**
 * Remove a label from a GitHub issue. Swallows the error if the label is not present.
 *
 * @param issue - GitHub issue number.
 * @param label - Label name to remove.
 */
export function removeLabel(issue: number, label: string): void {
  try {
    execFileSync("gh", ["issue", "edit", String(issue), "--remove-label", label], {
      encoding: "utf-8",
    });
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    // Swallow "label not found" style errors — nothing to remove is fine.
    if (
      stderr.includes("not found") ||
      stderr.includes("does not exist") ||
      stderr.includes("Label")
    ) {
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
export function addComment(issue: number, body: string): void {
  execFileSync("gh", ["issue", "comment", String(issue), "--body", body], {
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
export function getSubIssues(issue: number): number[] {
  const repoJson = execSync("gh repo view --json owner,name", { encoding: "utf-8" });
  const { owner, name } = JSON.parse(repoJson) as { owner: { login: string }; name: string };

  const query = `query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){issue(number:$num){subIssues(first:100){nodes{number}}}}}`;
  const out = execFileSync(
    "gh",
    [
      "api", "graphql",
      "-f", `query=${query}`,
      "-f", `owner=${owner.login}`,
      "-f", `repo=${name}`,
      "-F", `num=${issue}`,
    ],
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(out) as {
    data: { repository: { issue: { subIssues: { nodes: Array<{ number: number }> } } } };
  };
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
export function getTerminalGitHubState(
  issue: number,
  branch: string | null
): { issueClosed: boolean; prMerged: boolean } {
  let issueClosed = false;
  let prMerged = false;

  try {
    const issueOut = execSync(
      `gh issue view ${issue} --json state,closed`,
      { encoding: "utf-8" }
    );
    const issueData = JSON.parse(issueOut) as { state: string; closed: boolean };
    issueClosed = issueData.closed === true || issueData.state === "CLOSED";
  } catch {
    // gh unavailable or issue not found — treat as not closed.
  }

  if (branch !== null) {
    try {
      const prOut = execSync(
        `gh pr list --head "${branch}" --state merged --json number,mergedAt`,
        { encoding: "utf-8" }
      );
      const prs = JSON.parse(prOut) as Array<{ number: number; mergedAt: string }>;
      prMerged = prs.length > 0;
    } catch {
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
export function createPR(head: string, base: string, title: string, body: string): string {
  const stdout = execFileSync(
    "gh",
    ["pr", "create", "--head", head, "--base", base, "--title", title, "--body", body],
    { encoding: "utf-8" }
  );
  return stdout.trim();
}
