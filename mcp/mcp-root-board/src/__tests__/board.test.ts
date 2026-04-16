import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createStream,
  deleteStream,
  getBoardDir,
  listStreams,
  readStream,
  updateStream,
  writeStream,
} from "../board.js";
import { migrate } from "../migrate.js";
import { IssueContext, SCHEMA_VERSION, StreamState } from "../types.js";

const TEST_ISSUE: IssueContext = {
  number: 42,
  title: "Test issue",
  labels: ["enhancement"],
  state: "open",
};

const TEST_ISSUE_2: IssueContext = {
  number: 7,
  title: "Earlier issue",
  labels: [],
  state: "open",
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createStream
// ---------------------------------------------------------------------------

describe("createStream", () => {
  it("creates file at correct path with correct structure", () => {
    const state = createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);

    const boardDir = path.join(tmpDir, ".root", "board");
    const filePath = path.join(boardDir, "42.json");

    expect(fs.existsSync(filePath)).toBe(true);
    expect(state.issue.number).toBe(42);
    expect(state.tier).toBe("tier2");
    expect(state.status).toBe("queued");
    expect(state.groups).toEqual({});
    expect(state.worktreePath).toBeNull();
    expect(state.planPath).toBeNull();
    expect(state.prdPath).toBeNull();
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof state.created).toBe("string");
    expect(typeof state.updated).toBe("string");
  });

  it("includes parentIssue and childIssues defaults", () => {
    const state = createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);
    expect(state.parentIssue).toBeNull();
    expect(state.childIssues).toEqual([]);
  });

  it("persists tierSource and tierReason as supplied by the caller", () => {
    const state = createStream(
      TEST_ISSUE,
      "tier1",
      "override",
      "user passed --tier 1 because legal flagged this as Tier 1 work",
      tmpDir
    );
    expect(state.tierSource).toBe("override");
    expect(state.tierReason).toBe("user passed --tier 1 because legal flagged this as Tier 1 work");

    const reread = readStream(tmpDir, 42)!;
    expect(reread.tierSource).toBe("override");
    expect(reread.tierReason).toBe("user passed --tier 1 because legal flagged this as Tier 1 work");
  });
});

// ---------------------------------------------------------------------------
// readStream
// ---------------------------------------------------------------------------

describe("readStream", () => {
  it("returns null for nonexistent issue", () => {
    const result = readStream(tmpDir, 999);
    expect(result).toBeNull();
  });

  it("returns typed state for existing stream", () => {
    createStream(TEST_ISSUE, "tier1", "classifier", "test fixture", tmpDir);
    const result = readStream(tmpDir, 42);

    expect(result).not.toBeNull();
    expect(result!.issue.number).toBe(42);
    expect(result!.tier).toBe("tier1");
    expect(result!.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// writeStream
// ---------------------------------------------------------------------------

describe("writeStream", () => {
  it("does atomic write — no .tmp files remain after write", () => {
    const state = createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);
    writeStream(tmpDir, 42, state);

    const boardDir = getBoardDir(tmpDir);
    const entries = fs.readdirSync(boardDir);
    const tmpFiles = entries.filter((f) => f.endsWith(".tmp"));

    expect(tmpFiles).toHaveLength(0);
    expect(entries).toContain("42.json");
  });
});

// ---------------------------------------------------------------------------
// listStreams
// ---------------------------------------------------------------------------

describe("listStreams", () => {
  it("returns all streams sorted by issue number", () => {
    createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);   // issue 42
    createStream(TEST_ISSUE_2, "tier1", "classifier", "test fixture", tmpDir); // issue 7

    const streams = listStreams(tmpDir);
    expect(streams).toHaveLength(2);
    expect(streams[0].issue.number).toBe(7);
    expect(streams[1].issue.number).toBe(42);
  });

  it("returns empty array when board dir is empty", () => {
    const streams = listStreams(tmpDir);
    expect(streams).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateStream
// ---------------------------------------------------------------------------

describe("updateStream", () => {
  it("merges partial updates and bumps updated timestamp", async () => {
    createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);
    const before = readStream(tmpDir, 42)!;

    // Ensure at least 1ms passes so updated timestamp changes
    await new Promise((r) => setTimeout(r, 5));

    const updated = updateStream(tmpDir, 42, { status: "planning", branch: "custom-branch" });

    expect(updated.status).toBe("planning");
    expect(updated.branch).toBe("custom-branch");
    expect(updated.tier).toBe("tier2"); // untouched field preserved
    expect(updated.updated).not.toBe(before.updated);
  });

  it("throws for nonexistent stream", () => {
    expect(() => updateStream(tmpDir, 999, { status: "planning" })).toThrow(
      "Stream for issue #999 does not exist."
    );
  });

  it("can set parentIssue and childIssues", () => {
    createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);
    const updated = updateStream(tmpDir, 42, { parentIssue: 100, childIssues: [201, 202] });
    expect(updated.parentIssue).toBe(100);
    expect(updated.childIssues).toEqual([201, 202]);
  });
});

// ---------------------------------------------------------------------------
// deleteStream
// ---------------------------------------------------------------------------

describe("deleteStream", () => {
  it("removes the file", () => {
    createStream(TEST_ISSUE, "tier2", "classifier", "test fixture", tmpDir);
    const boardDir = getBoardDir(tmpDir);
    expect(fs.existsSync(path.join(boardDir, "42.json"))).toBe(true);

    deleteStream(tmpDir, 42);
    expect(fs.existsSync(path.join(boardDir, "42.json"))).toBe(false);
  });

  it("is a no-op for nonexistent file", () => {
    expect(() => deleteStream(tmpDir, 999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// migrate integration
// ---------------------------------------------------------------------------

describe("migrate integration via readStream", () => {
  it("reads a stream missing schemaVersion and returns it with current schema", () => {
    // Manually write a v0-style file (no schemaVersion field)
    getBoardDir(tmpDir); // ensure dir exists
    const boardDir = path.join(tmpDir, ".root", "board");
    const legacyState = {
      issue: { number: 100, title: "Legacy", labels: [], state: "open" },
      tier: "tier2",
      status: "queued",
      branch: "issue-100",
    };
    fs.writeFileSync(
      path.join(boardDir, "100.json"),
      JSON.stringify(legacyState, null, 2),
      "utf8"
    );

    const result = readStream(tmpDir, 100);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result!.groups).toEqual({});
    expect(result!.planPath).toBeNull();
    expect(result!.prdPath).toBeNull();
    expect(result!.worktreePath).toBeNull();
    expect(result!.issue.number).toBe(100);
  });

  it("migrate() directly handles v0 state", () => {
    const v0 = { issue: { number: 1, title: "x", labels: [], state: "open" }, tier: "tier1" };
    const result = migrate(v0);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.status).toBe("queued");
    expect(result.groups).toEqual({});
    expect(result.tierSource).toBe("classifier");
    expect(result.tierReason).toBe("unknown (pre-v2 record)");
  });

  it("migrate v1 → v2 backfills tierSource and tierReason without overwriting other fields", () => {
    const v1 = {
      schemaVersion: 1,
      issue: { number: 1567, title: "v1 record", labels: ["type:bug"], state: "open" },
      tier: "tier1", // intentionally inconsistent with labels — exactly the bug v2 surfaces
      status: "planning",
      branch: "feat/1567-x",
      worktreePath: "/tmp/wt",
      planPath: null,
      prdPath: null,
      autoApprove: true,
      parentIssue: null,
      childIssues: [],
      groups: {},
      created: "2026-04-15T00:00:00.000Z",
      updated: "2026-04-16T00:00:00.000Z",
    };
    const result = migrate(v1);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.tier).toBe("tier1"); // not rewritten by migrate
    expect(result.tierSource).toBe("classifier");
    expect(result.tierReason).toBe("unknown (pre-v2 record)");
    expect(result.status).toBe("planning");
    expect(result.autoApprove).toBe(true);
  });

  it("migrate backfills new fields when a current-version record is missing them", () => {
    getBoardDir(tmpDir); // ensure dir exists
    const boardDir = path.join(tmpDir, ".root", "board");
    // Write a current-version stream that is missing the v2 fields (e.g. hand-edited)
    const stateWithoutNewFields = {
      schemaVersion: SCHEMA_VERSION,
      issue: { number: 200, title: "Old stream", labels: [], state: "open" },
      tier: "tier2",
      status: "queued",
      branch: "issue-200",
      worktreePath: null,
      planPath: null,
      prdPath: null,
      autoApprove: false,
      groups: {},
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(boardDir, "200.json"),
      JSON.stringify(stateWithoutNewFields, null, 2),
      "utf8"
    );

    const result = readStream(tmpDir, 200);
    expect(result).not.toBeNull();
    expect(result!.parentIssue).toBeNull();
    expect(result!.childIssues).toEqual([]);
    expect(result!.tierSource).toBe("classifier");
    expect(result!.tierReason).toBe("unknown (pre-v2 record)");
  });

  it("migrate() passes through current-version state unchanged", () => {
    const current: StreamState = {
      schemaVersion: SCHEMA_VERSION,
      issue: { number: 5, title: "y", labels: [], state: "open" },
      tier: "tier2",
      tierSource: "classifier",
      tierReason: "label \"type:bug\" matches Tier 2 policy",
      status: "implementing",
      branch: "issue-5",
      worktreePath: "/tmp/wt",
      planPath: "plans/5.md",
      prdPath: null,
      autoApprove: false,
      parentIssue: null,
      childIssues: [],
      groups: { A: { harness: "claude", status: "in-progress", worktreePath: null } },
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-02T00:00:00.000Z",
    };
    const result = migrate(current);
    expect(result).toBe(current); // same reference
    expect(result.status).toBe("implementing");
    expect(result.tierSource).toBe("classifier");
  });
});
