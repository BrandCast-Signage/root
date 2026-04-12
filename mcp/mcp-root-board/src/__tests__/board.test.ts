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
    const state = createStream(TEST_ISSUE, "tier2", tmpDir);

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
    createStream(TEST_ISSUE, "tier1", tmpDir);
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
    const state = createStream(TEST_ISSUE, "tier2", tmpDir);
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
    createStream(TEST_ISSUE, "tier2", tmpDir);   // issue 42
    createStream(TEST_ISSUE_2, "tier1", tmpDir); // issue 7

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
    createStream(TEST_ISSUE, "tier2", tmpDir);
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
});

// ---------------------------------------------------------------------------
// deleteStream
// ---------------------------------------------------------------------------

describe("deleteStream", () => {
  it("removes the file", () => {
    createStream(TEST_ISSUE, "tier2", tmpDir);
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
  });

  it("migrate() passes through current-version state unchanged", () => {
    const current: StreamState = {
      schemaVersion: SCHEMA_VERSION,
      issue: { number: 5, title: "y", labels: [], state: "open" },
      tier: "tier2",
      status: "implementing",
      branch: "issue-5",
      worktreePath: "/tmp/wt",
      planPath: "plans/5.md",
      prdPath: null,
      groups: { A: { harness: "claude", status: "in-progress", worktreePath: null } },
      created: "2024-01-01T00:00:00.000Z",
      updated: "2024-01-02T00:00:00.000Z",
    };
    const result = migrate(current);
    expect(result).toBe(current); // same reference
    expect(result.status).toBe("implementing");
  });
});
