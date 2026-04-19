import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

jest.mock("node:child_process");
jest.mock("node:fs");

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

import {
  createWorktree,
  detectPackageManager,
  installDependencies,
  listWorktrees,
  mergeWorktreeInto,
  removeWorktree,
} from "../worktree.js";

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no package.json — install is a no-op unless a test opts in.
  mockExistsSync.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// createWorktree
// ---------------------------------------------------------------------------

describe("createWorktree", () => {
  it("derives worktree path as sibling with issue suffix and calls git", () => {
    mockExecSync.mockReturnValue("" as any);

    const projectDir = "/home/user/myproject";
    const result = createWorktree(projectDir, 42, "issue-42");

    const expectedPath = path.resolve(projectDir, "..", "myproject-42");
    expect(result).toBe(expectedPath);

    expect(mockExecSync).toHaveBeenCalledWith(
      `git worktree add ${expectedPath} -b issue-42`,
      { cwd: projectDir, encoding: "utf-8" }
    );
  });

  it("throws a meaningful error when git command fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: branch already exists");
    });

    expect(() => createWorktree("/home/user/proj", 7, "issue-7")).toThrow(
      /Failed to create worktree/
    );
  });

  it("runs npm install in the new worktree when package.json is present", () => {
    const projectDir = "/home/user/brandcast";
    const expectedPath = path.resolve(projectDir, "..", "brandcast-42");

    // package.json exists, no other lockfiles → npm.
    mockExistsSync.mockImplementation((p) => {
      return String(p) === path.join(expectedPath, "package.json");
    });
    mockExecSync.mockReturnValue("" as any);

    createWorktree(projectDir, 42, "issue-42");

    expect(mockExecSync).toHaveBeenCalledWith("npm install", {
      cwd: expectedPath,
      stdio: "inherit",
    });
  });

  it("skips dependency install when there is no package.json", () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue("" as any);

    createWorktree("/home/user/proj", 1, "issue-1");

    // Only the git worktree add call, no install.
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringMatching(/^git worktree add/),
      expect.anything()
    );
  });

  it("surfaces a loud error when dependency install fails", () => {
    const projectDir = "/home/user/brandcast";
    const expectedPath = path.resolve(projectDir, "..", "brandcast-99");

    mockExistsSync.mockImplementation((p) => {
      return String(p) === path.join(expectedPath, "package.json");
    });
    mockExecSync.mockImplementation((cmd: any) => {
      if (String(cmd).startsWith("git worktree add")) return "" as any;
      throw new Error("npm ERR! peer dep conflict");
    });

    expect(() => createWorktree(projectDir, 99, "issue-99")).toThrow(
      /Dependency install failed/
    );
  });
});

// ---------------------------------------------------------------------------
// detectPackageManager / installDependencies
// ---------------------------------------------------------------------------

describe("detectPackageManager", () => {
  const dir = "/home/user/proj";

  it("returns null when there is no package.json", () => {
    mockExistsSync.mockReturnValue(false);
    expect(detectPackageManager(dir)).toBeNull();
  });

  it("returns npm when only package.json is present", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("package.json"));
    expect(detectPackageManager(dir)).toBe("npm");
  });

  it("prefers pnpm lockfile", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("pnpm-lock.yaml");
    });
    expect(detectPackageManager(dir)).toBe("pnpm");
  });

  it("detects yarn lockfile", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("yarn.lock");
    });
    expect(detectPackageManager(dir)).toBe("yarn");
  });

  it("detects bun lockfile", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("bun.lockb");
    });
    expect(detectPackageManager(dir)).toBe("bun");
  });
});

describe("installDependencies", () => {
  it("is a no-op when no package.json", () => {
    mockExistsSync.mockReturnValue(false);
    installDependencies("/tmp/empty");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("uses pnpm install when pnpm-lock.yaml is present", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("package.json") || s.endsWith("pnpm-lock.yaml");
    });
    mockExecSync.mockReturnValue("" as any);

    installDependencies("/tmp/proj");

    expect(mockExecSync).toHaveBeenCalledWith("pnpm install", {
      cwd: "/tmp/proj",
      stdio: "inherit",
    });
  });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  it("calls git worktree remove with --force", () => {
    mockExecSync.mockReturnValue("" as any);

    removeWorktree("/home/user/proj", "/home/user/proj-5");

    expect(mockExecSync).toHaveBeenCalledWith(
      "git worktree remove /home/user/proj-5 --force",
      { cwd: "/home/user/proj", encoding: "utf-8" }
    );
  });

  it("is a no-op when the worktree does not exist", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("/home/user/proj-5 is not a working tree");
      throw err;
    });

    // Should not throw
    expect(() => removeWorktree("/home/user/proj", "/home/user/proj-5")).not.toThrow();
  });

  it("re-throws errors not related to missing worktree", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(() => removeWorktree("/home/user/proj", "/home/user/proj-5")).toThrow(
      "permission denied"
    );
  });
});

// ---------------------------------------------------------------------------
// listWorktrees
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  const PORCELAIN_OUTPUT = [
    "worktree /home/user/myproject",
    "HEAD abc1234def5678901234567890abcdef12345678",
    "branch refs/heads/main",
    "",
    "worktree /home/user/myproject-42",
    "HEAD def5678901234567890abcdef12345678abc123",
    "branch refs/heads/issue-42",
    "",
  ].join("\n");

  it("parses porcelain output into structured worktree info", () => {
    mockExecSync.mockReturnValue(PORCELAIN_OUTPUT as any);

    const result = listWorktrees("/home/user/myproject");

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      path: "/home/user/myproject",
      head: "abc1234def5678901234567890abcdef12345678",
      branch: "main",
    });

    expect(result[1]).toEqual({
      path: "/home/user/myproject-42",
      head: "def5678901234567890abcdef12345678abc123",
      branch: "issue-42",
    });
  });

  it("calls git worktree list --porcelain with cwd", () => {
    mockExecSync.mockReturnValue(PORCELAIN_OUTPUT as any);

    listWorktrees("/home/user/myproject");

    expect(mockExecSync).toHaveBeenCalledWith("git worktree list --porcelain", {
      cwd: "/home/user/myproject",
      encoding: "utf-8",
    });
  });

  it("returns empty array for empty output", () => {
    mockExecSync.mockReturnValue("" as any);
    const result = listWorktrees("/home/user/myproject");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeWorktreeInto
// ---------------------------------------------------------------------------

describe("mergeWorktreeInto", () => {
  it("returns success: true on clean merge", () => {
    mockExecSync.mockReturnValue("" as any);

    const result = mergeWorktreeInto("/home/user/proj", "issue-42", "main");

    expect(result).toEqual({ success: true });
    expect(mockExecSync).toHaveBeenCalledWith("git checkout main", {
      cwd: "/home/user/proj",
      encoding: "utf-8",
    });
    expect(mockExecSync).toHaveBeenCalledWith("git merge issue-42 --no-ff", {
      cwd: "/home/user/proj",
      encoding: "utf-8",
    });
  });

  it("returns success: false with conflicts on failed merge", () => {
    mockExecSync
      .mockReturnValueOnce("" as any) // git checkout succeeds
      .mockImplementationOnce(() => {
        throw new Error("CONFLICT (content): Merge conflict in src/foo.ts");
      });

    const result = mergeWorktreeInto("/home/user/proj", "issue-42", "main");

    expect(result.success).toBe(false);
    expect(result.conflicts).toContain("CONFLICT");
  });

  it("returns success: false when checkout fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("error: pathspec 'main' did not match any file");
    });

    const result = mergeWorktreeInto("/home/user/proj", "issue-42", "main");

    expect(result.success).toBe(false);
    expect(result.conflicts).toBeDefined();
  });
});
