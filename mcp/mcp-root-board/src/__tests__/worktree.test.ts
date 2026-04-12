import { execSync } from "node:child_process";
import * as path from "node:path";

jest.mock("node:child_process");

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

import {
  createWorktree,
  listWorktrees,
  mergeWorktreeInto,
  removeWorktree,
} from "../worktree.js";

beforeEach(() => {
  jest.clearAllMocks();
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
