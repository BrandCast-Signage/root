"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPackageManager = detectPackageManager;
exports.installDependencies = installDependencies;
exports.createWorktree = createWorktree;
exports.removeWorktree = removeWorktree;
exports.listWorktrees = listWorktrees;
exports.mergeWorktreeInto = mergeWorktreeInto;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
/**
 * Detect the JS package manager for a directory based on its lockfile.
 * Returns `null` if there is no `package.json` (nothing to install).
 * Falls back to `npm` when `package.json` exists but no lockfile is present.
 */
function detectPackageManager(dir) {
    if (!(0, node_fs_1.existsSync)(path.join(dir, "package.json")))
        return null;
    if ((0, node_fs_1.existsSync)(path.join(dir, "pnpm-lock.yaml")))
        return "pnpm";
    if ((0, node_fs_1.existsSync)(path.join(dir, "yarn.lock")))
        return "yarn";
    if ((0, node_fs_1.existsSync)(path.join(dir, "bun.lockb")))
        return "bun";
    return "npm";
}
const INSTALL_COMMAND = {
    npm: "npm install",
    pnpm: "pnpm install",
    yarn: "yarn install",
    bun: "bun install",
};
/**
 * Install JS dependencies in `worktreePath` if it contains a `package.json`.
 *
 * Fresh `git worktree add` does not copy `node_modules`, which means any
 * pre-commit hooks that depend on installed binaries (husky, lint-staged,
 * jest) will fail on the first commit. We run the install eagerly and
 * stream output so failures are loud.
 *
 * No-op when there is no `package.json`.
 *
 * @throws {Error} If the install command fails.
 */
function installDependencies(worktreePath) {
    const pm = detectPackageManager(worktreePath);
    if (!pm)
        return;
    const cmd = INSTALL_COMMAND[pm];
    try {
        (0, node_child_process_1.execSync)(cmd, { cwd: worktreePath, stdio: "inherit" });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Dependency install failed in ${worktreePath} (${cmd}): ${msg}`);
    }
}
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
function createWorktree(projectDir, issue, branch) {
    const worktreePath = path.resolve(projectDir, "..", path.basename(projectDir) + "-" + issue);
    try {
        (0, node_child_process_1.execSync)(`git worktree add ${worktreePath} -b ${branch}`, {
            cwd: projectDir,
            encoding: "utf-8",
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to create worktree at ${worktreePath}: ${msg}`);
    }
    installDependencies(worktreePath);
    return worktreePath;
}
/**
 * Remove a git worktree, forcefully. No-op if the path is not a registered worktree.
 *
 * @param projectDir - Absolute path to the project (main worktree) directory.
 * @param worktreePath - Absolute path to the worktree directory to remove.
 */
function removeWorktree(projectDir, worktreePath) {
    try {
        (0, node_child_process_1.execSync)(`git worktree remove ${worktreePath} --force`, {
            cwd: projectDir,
            encoding: "utf-8",
        });
    }
    catch (err) {
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
function listWorktrees(projectDir) {
    const output = (0, node_child_process_1.execSync)("git worktree list --porcelain", {
        cwd: projectDir,
        encoding: "utf-8",
    });
    const results = [];
    // Porcelain output: blocks separated by blank lines.
    // Each block has lines like:
    //   worktree /abs/path
    //   HEAD <sha>
    //   branch refs/heads/<name>
    const blocks = output.trim().split(/\n\n+/);
    for (const block of blocks) {
        if (!block.trim())
            continue;
        let wtPath = "";
        let head = "";
        let branch = "";
        for (const line of block.split("\n")) {
            if (line.startsWith("worktree ")) {
                wtPath = line.slice("worktree ".length).trim();
            }
            else if (line.startsWith("HEAD ")) {
                head = line.slice("HEAD ".length).trim();
            }
            else if (line.startsWith("branch ")) {
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
function mergeWorktreeInto(projectDir, worktreeBranch, targetBranch) {
    try {
        (0, node_child_process_1.execSync)(`git checkout ${targetBranch}`, { cwd: projectDir, encoding: "utf-8" });
        (0, node_child_process_1.execSync)(`git merge ${worktreeBranch} --no-ff`, { cwd: projectDir, encoding: "utf-8" });
        return { success: true };
    }
    catch (err) {
        const stderr = err instanceof Error ? err.message : String(err);
        return { success: false, conflicts: stderr };
    }
}
