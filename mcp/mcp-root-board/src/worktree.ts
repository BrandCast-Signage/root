import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Create a git worktree for the given issue and branch.
 *
 * The worktree is placed as a sibling of `projectDir`, named
 * `<projectDirBasename>-<issue>`.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @param issue - GitHub issue number used to derive the worktree directory name.
 * @param branch - New branch name to create in the worktree.
 * @returns Absolute path to the newly created worktree directory.
 * @throws {Error} If the `git worktree add` command fails.
 */
export function createWorktree(projectDir: string, issue: number, branch: string): string {
  const worktreePath = path.resolve(projectDir, "..", path.basename(projectDir) + "-" + issue);

  try {
    execSync(`git worktree add ${worktreePath} -b ${branch}`, {
      cwd: projectDir,
      encoding: "utf-8",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create worktree at ${worktreePath}: ${msg}`);
  }

  return worktreePath;
}

/**
 * Remove a git worktree, forcefully. No-op if the path is not a registered worktree.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @param worktreePath - Absolute path to the worktree directory to remove.
 */
export function removeWorktree(projectDir: string, worktreePath: string): void {
  try {
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd: projectDir,
      encoding: "utf-8",
    });
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    // If the path is not a registered worktree, treat it as a no-op.
    if (stderr.includes("is not a working tree")) {
      return;
    }
    throw err;
  }
}

/**
 * List all worktrees registered in the repository.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @returns Array of worktree info objects, each with `path`, `branch`, and `head`.
 */
export function listWorktrees(
  projectDir: string
): Array<{ path: string; branch: string; head: string }> {
  const output = execSync("git worktree list --porcelain", {
    cwd: projectDir,
    encoding: "utf-8",
  });

  const results: Array<{ path: string; branch: string; head: string }> = [];

  // Porcelain output: blocks separated by blank lines.
  // Each block has lines like:
  //   worktree /abs/path
  //   HEAD <sha>
  //   branch refs/heads/<name>
  const blocks = output.trim().split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;

    let wtPath = "";
    let head = "";
    let branch = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.replace(/^refs\/heads\//, "");
      }
    }

    if (wtPath) {
      results.push({ path: wtPath, branch, head });
    }
  }

  return results;
}

/**
 * Merge a worktree branch into a target branch inside `projectDir`.
 *
 * Checks out `targetBranch`, then performs a `--no-ff` merge of `worktreeBranch`.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @param worktreeBranch - Name of the branch to merge from.
 * @param targetBranch - Name of the branch to merge into.
 * @returns `{ success: true }` on clean merge, or `{ success: false, conflicts: <stderr> }` on failure.
 */
export function mergeWorktreeInto(
  projectDir: string,
  worktreeBranch: string,
  targetBranch: string
): { success: boolean; conflicts?: string } {
  try {
    execSync(`git checkout ${targetBranch}`, { cwd: projectDir, encoding: "utf-8" });
    execSync(`git merge ${worktreeBranch} --no-ff`, { cwd: projectDir, encoding: "utf-8" });
    return { success: true };
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    return { success: false, conflicts: stderr };
  }
}
