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
