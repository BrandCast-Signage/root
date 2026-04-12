import { execFileSync, execSync } from "node:child_process";

jest.mock("node:child_process");

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

import {
  addComment,
  checkGhAuth,
  createPR,
  getIssue,
  getIssueLabels,
  removeLabel,
  setLabel,
} from "../github.js";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// checkGhAuth
// ---------------------------------------------------------------------------

describe("checkGhAuth", () => {
  it("returns authenticated: true when gh auth status exits 0", () => {
    mockExecSync.mockReturnValue("" as any);

    const result = checkGhAuth();

    expect(result).toEqual({ authenticated: true });
    expect(mockExecSync).toHaveBeenCalledWith("gh auth status", { encoding: "utf-8" });
  });

  it("returns authenticated: false with error on non-zero exit", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("You are not logged into any GitHub hosts.");
    });

    const result = checkGhAuth();

    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("not logged in");
  });
});

// ---------------------------------------------------------------------------
// getIssue
// ---------------------------------------------------------------------------

describe("getIssue", () => {
  const RAW_ISSUE = {
    number: 42,
    title: "Fix the bug",
    body: "Description of the bug",
    labels: [{ name: "bug" }, { name: "priority-high" }],
    state: "open",
  };

  it("parses JSON response and maps labels to string array", () => {
    mockExecSync.mockReturnValue(JSON.stringify(RAW_ISSUE) as any);

    const result = getIssue(42);

    expect(result).toEqual({
      number: 42,
      title: "Fix the bug",
      body: "Description of the bug",
      labels: ["bug", "priority-high"],
      state: "open",
    });
  });

  it("calls gh with correct json fields", () => {
    mockExecSync.mockReturnValue(JSON.stringify(RAW_ISSUE) as any);

    getIssue(42);

    expect(mockExecSync).toHaveBeenCalledWith(
      "gh issue view 42 --json number,title,body,labels,state",
      { encoding: "utf-8" }
    );
  });

  it("handles issue with no labels", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({ ...RAW_ISSUE, labels: [] }) as any
    );

    const result = getIssue(42);
    expect(result.labels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getIssueLabels
// ---------------------------------------------------------------------------

describe("getIssueLabels", () => {
  it("returns array of label name strings", () => {
    mockExecSync.mockReturnValue(
      JSON.stringify({ labels: [{ name: "enhancement" }, { name: "help wanted" }] }) as any
    );

    const result = getIssueLabels(7);

    expect(result).toEqual(["enhancement", "help wanted"]);
    expect(mockExecSync).toHaveBeenCalledWith(
      "gh issue view 7 --json labels",
      { encoding: "utf-8" }
    );
  });

  it("returns empty array when no labels", () => {
    mockExecSync.mockReturnValue(JSON.stringify({ labels: [] }) as any);

    const result = getIssueLabels(7);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setLabel
// ---------------------------------------------------------------------------

describe("setLabel", () => {
  it("calls execFileSync with correct gh args", () => {
    mockExecFileSync.mockReturnValue("" as any);

    setLabel(42, "in-progress");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "42", "--add-label", "in-progress"],
      { encoding: "utf-8" }
    );
  });

  it("throws when gh command fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh: command failed");
    });

    expect(() => setLabel(42, "bad-label")).toThrow("gh: command failed");
  });
});

// ---------------------------------------------------------------------------
// removeLabel
// ---------------------------------------------------------------------------

describe("removeLabel", () => {
  it("calls execFileSync with correct gh args", () => {
    mockExecFileSync.mockReturnValue("" as any);

    removeLabel(42, "in-progress");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "42", "--remove-label", "in-progress"],
      { encoding: "utf-8" }
    );
  });

  it("swallows error when label is not found on the issue", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('Label "missing-label" not found on issue');
    });

    expect(() => removeLabel(42, "missing-label")).not.toThrow();
  });

  it("re-throws errors unrelated to missing label", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network timeout");
    });

    expect(() => removeLabel(42, "in-progress")).toThrow("network timeout");
  });
});

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------

describe("addComment", () => {
  it("calls execFileSync with correct gh args", () => {
    mockExecFileSync.mockReturnValue("" as any);

    addComment(42, "This is a **markdown** comment.\n\nWith multiple lines.");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "comment",
        "42",
        "--body",
        "This is a **markdown** comment.\n\nWith multiple lines.",
      ],
      { encoding: "utf-8" }
    );
  });

  it("throws when gh command fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("authentication required");
    });

    expect(() => addComment(42, "hello")).toThrow("authentication required");
  });
});

// ---------------------------------------------------------------------------
// createPR
// ---------------------------------------------------------------------------

describe("createPR", () => {
  it("returns the PR URL from stdout", () => {
    mockExecFileSync.mockReturnValue(
      "https://github.com/owner/repo/pull/99\n" as any
    );

    const url = createPR("issue-42", "main", "Fix the bug", "Closes #42");

    expect(url).toBe("https://github.com/owner/repo/pull/99");
  });

  it("calls execFileSync with correct gh args", () => {
    mockExecFileSync.mockReturnValue("https://github.com/owner/repo/pull/99\n" as any);

    createPR("issue-42", "main", "Fix the bug", "Closes #42");

    expect(mockExecFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "create",
        "--head",
        "issue-42",
        "--base",
        "main",
        "--title",
        "Fix the bug",
        "--body",
        "Closes #42",
      ],
      { encoding: "utf-8" }
    );
  });

  it("throws when gh command fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("pull request already exists");
    });

    expect(() => createPR("issue-42", "main", "Fix", "body")).toThrow(
      "pull request already exists"
    );
  });
});
