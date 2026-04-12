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
export declare function createWorktree(projectDir: string, issue: number, branch: string): string;
/**
 * Remove a git worktree, forcefully. No-op if the path is not a registered worktree.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @param worktreePath - Absolute path to the worktree directory to remove.
 */
export declare function removeWorktree(projectDir: string, worktreePath: string): void;
/**
 * List all worktrees registered in the repository.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @returns Array of worktree info objects, each with `path`, `branch`, and `head`.
 */
export declare function listWorktrees(projectDir: string): Array<{
    path: string;
    branch: string;
    head: string;
}>;
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
export declare function mergeWorktreeInto(projectDir: string, worktreeBranch: string, targetBranch: string): {
    success: boolean;
    conflicts?: string;
};
