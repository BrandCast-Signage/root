import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendSharedContext,
  getSharedContext,
  SHARED_CONTEXT_MAX_BYTES,
} from "../sharedContext.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-context-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getSharedContext
// ---------------------------------------------------------------------------

describe("getSharedContext", () => {
  it("returns empty string when the file does not exist", () => {
    expect(getSharedContext(tmpDir, 42)).toBe("");
  });

  it("returns the full file content when present", () => {
    const filePath = path.join(tmpDir, ".root", "streams", "42", "shared-context.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# hello\n", "utf8");

    expect(getSharedContext(tmpDir, 42)).toBe("# hello\n");
  });
});

// ---------------------------------------------------------------------------
// appendSharedContext
// ---------------------------------------------------------------------------

describe("appendSharedContext", () => {
  it("creates the file and parent directory when missing", () => {
    const result = appendSharedContext(tmpDir, 42, "first note");

    expect(result.overflow).toBe(false);
    expect(getSharedContext(tmpDir, 42)).toContain("first note");
    expect(
      fs.existsSync(path.join(tmpDir, ".root", "streams", "42", "shared-context.md"))
    ).toBe(true);
  });

  it("preserves prior content across appends (append-only)", () => {
    appendSharedContext(tmpDir, 42, "first");
    appendSharedContext(tmpDir, 42, "second");

    const content = getSharedContext(tmpDir, 42);
    expect(content).toContain("first");
    expect(content).toContain("second");
    expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
  });

  it("writes a timestamped section header for each append", () => {
    appendSharedContext(tmpDir, 42, "note");
    const content = getSharedContext(tmpDir, 42);
    expect(content).toMatch(/^## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns overflow=true once content exceeds SHARED_CONTEXT_MAX_BYTES", () => {
    const big = "x".repeat(SHARED_CONTEXT_MAX_BYTES + 100);
    const result = appendSharedContext(tmpDir, 42, big);

    expect(result.overflow).toBe(true);
    expect(result.bytes).toBeGreaterThan(SHARED_CONTEXT_MAX_BYTES);
    // The note IS still appended — overflow is signal, not silent truncation.
    expect(getSharedContext(tmpDir, 42)).toContain("xxxx");
  });

  it("ensures appended note ends with a newline even if caller omits it", () => {
    appendSharedContext(tmpDir, 42, "no trailing newline");
    expect(getSharedContext(tmpDir, 42).endsWith("\n")).toBe(true);
  });

  it("isolates shared-context across different epic numbers", () => {
    appendSharedContext(tmpDir, 42, "for-42");
    appendSharedContext(tmpDir, 43, "for-43");

    expect(getSharedContext(tmpDir, 42)).toContain("for-42");
    expect(getSharedContext(tmpDir, 42)).not.toContain("for-43");
    expect(getSharedContext(tmpDir, 43)).toContain("for-43");
    expect(getSharedContext(tmpDir, 43)).not.toContain("for-42");
  });
});
