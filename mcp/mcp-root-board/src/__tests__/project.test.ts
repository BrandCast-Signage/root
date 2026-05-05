import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

jest.mock("node:child_process");

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

import { loadGithubProjectConfig, setProjectStatusInProgress } from "../project.js";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// loadGithubProjectConfig
// ---------------------------------------------------------------------------

describe("loadGithubProjectConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when config file is missing", () => {
    expect(loadGithubProjectConfig(tmpDir)).toBeNull();
  });

  it("returns null when board.githubProject is absent", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({ board: { gates: {} } }),
      "utf8"
    );
    expect(loadGithubProjectConfig(tmpDir)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({
        board: { githubProject: { projectId: "PVT_x", statusFieldId: "PVTSSF_x" } },
      }),
      "utf8"
    );
    expect(loadGithubProjectConfig(tmpDir)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "root.config.json"), "not-json", "utf8");
    expect(loadGithubProjectConfig(tmpDir)).toBeNull();
  });

  it("returns parsed config when all required fields are present", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({
        board: {
          githubProject: {
            projectId: "PVT_kw",
            statusFieldId: "PVTSSF_kw",
            statusOptions: { inProgress: "abc123" },
            mirrorLabel: "status:in-progress",
          },
        },
      }),
      "utf8"
    );
    expect(loadGithubProjectConfig(tmpDir)).toEqual({
      projectId: "PVT_kw",
      statusFieldId: "PVTSSF_kw",
      statusOptions: { inProgress: "abc123" },
      mirrorLabel: "status:in-progress",
    });
  });

  it("treats mirrorLabel as optional", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({
        board: {
          githubProject: {
            projectId: "PVT_kw",
            statusFieldId: "PVTSSF_kw",
            statusOptions: { inProgress: "abc123" },
          },
        },
      }),
      "utf8"
    );
    const cfg = loadGithubProjectConfig(tmpDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.mirrorLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setProjectStatusInProgress
// ---------------------------------------------------------------------------

describe("setProjectStatusInProgress", () => {
  const cfg = {
    projectId: "PVT_kw",
    statusFieldId: "PVTSSF_kw",
    statusOptions: { inProgress: "opt-inprogress" },
  };

  it("looks up issue node ID, adds project item, then updates the status field", () => {
    mockExecSync.mockReturnValue(JSON.stringify({ id: "I_node_42" }) as any);
    mockExecFileSync
      .mockReturnValueOnce(
        JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "PVTI_42" } } } }) as any
      )
      .mockReturnValueOnce(
        JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_42" } } } }) as any
      );

    setProjectStatusInProgress(42, cfg);

    expect(mockExecSync).toHaveBeenCalledWith(
      "gh issue view 42 --json id",
      { encoding: "utf-8" }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      "gh",
      expect.arrayContaining([
        "api", "graphql",
        "-f", expect.stringContaining("addProjectV2ItemById"),
        "-f", "projectId=PVT_kw",
        "-f", "contentId=I_node_42",
      ]),
      { encoding: "utf-8" }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      "gh",
      expect.arrayContaining([
        "-f", expect.stringContaining("updateProjectV2ItemFieldValue"),
        "-f", "itemId=PVTI_42",
        "-f", "fieldId=PVTSSF_kw",
        "-f", "optionId=opt-inprogress",
      ]),
      { encoding: "utf-8" }
    );
  });

  it("propagates errors from the gh CLI so callers can swallow them", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("gh: not authenticated");
    });
    expect(() => setProjectStatusInProgress(42, cfg)).toThrow("not authenticated");
  });
});
