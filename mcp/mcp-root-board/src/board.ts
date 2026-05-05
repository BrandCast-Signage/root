import * as fs from "node:fs";
import * as path from "node:path";
import { IssueContext, SCHEMA_VERSION, StreamKind, StreamState, Tier, TierSource } from "./types.js";
import { migrate } from "./migrate.js";

/**
 * Return the board directory path and ensure it exists.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Absolute path to `.root/board/` inside `rootDir`.
 */
export function getBoardDir(rootDir: string): string {
  const boardDir = path.join(rootDir, ".root", "board");
  fs.mkdirSync(boardDir, { recursive: true });
  return boardDir;
}

/**
 * Read and migrate a stream state file from disk.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 * @returns The migrated {@link StreamState}, or `null` if no file exists.
 */
export function readStream(rootDir: string, issue: number): StreamState | null {
  const filePath = path.join(getBoardDir(rootDir), `${issue}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return migrate(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Atomically write a stream state to disk.
 *
 * The `updated` timestamp is set to the current time before writing.
 * Writes to a `.tmp` file first, then renames over the target to ensure
 * the write is atomic on POSIX systems.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 * @param state - The stream state to persist.
 */
export function writeStream(rootDir: string, issue: number, state: StreamState): void {
  const boardDir = getBoardDir(rootDir);
  const filePath = path.join(boardDir, `${issue}.json`);
  const tmpPath = `${filePath}.tmp`;

  const toWrite: StreamState = {
    ...state,
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * List all streams persisted in the board directory, sorted by issue number.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Array of migrated {@link StreamState} objects sorted ascending by issue number.
 */
export function listStreams(rootDir: string): StreamState[] {
  const boardDir = getBoardDir(rootDir);
  const entries = fs.readdirSync(boardDir).filter((f) => f.endsWith(".json"));

  const states: StreamState[] = [];
  for (const entry of entries) {
    const issueNum = parseInt(path.basename(entry, ".json"), 10);
    if (isNaN(issueNum)) continue;
    const state = readStream(rootDir, issueNum);
    if (state !== null) {
      states.push(state);
    }
  }

  return states.sort((a, b) => a.issue.number - b.issue.number);
}

/**
 * Create a new stream for the given issue and persist it.
 *
 * @param issue - GitHub issue context for the new stream.
 * @param tier - Complexity tier for the stream.
 * @param tierSource - Whether the tier came from the classifier or a caller-supplied override.
 * @param tierReason - Human-readable justification for the tier (classifier reason or override justification).
 * @param rootDir - Absolute path to the consumer project root.
 * @returns The newly created and persisted {@link StreamState}.
 */
export function createStream(
  issue: IssueContext,
  tier: Tier,
  tierSource: TierSource,
  tierReason: string,
  rootDir: string
): StreamState {
  const now = new Date().toISOString();
  const state: StreamState = {
    schemaVersion: SCHEMA_VERSION,
    issue,
    tier,
    tierSource,
    tierReason,
    status: "queued",
    branch: `issue-${issue.number}`,
    worktreePath: null,
    planPath: null,
    prdPath: null,
    autoApprove: false,
    parentIssue: null,
    childIssues: [],
    groups: {},
    kind: "issue",
    epicChildren: [],
    epicBranch: null,
    created: now,
    updated: now,
  };

  writeStream(rootDir, issue.number, state);
  return state;
}

/**
 * Create a parent stream for an autonomous multi-issue run.
 *
 * Unlike {@link createStream}, an epic / batch stream:
 *   - has `kind` of `"epic"` or `"batch"`
 *   - tracks the child issue numbers in `epicChildren`
 *   - declares a single shared `epicBranch` that all child subagents
 *     commit onto (no per-child branches)
 *   - starts at status `"epic-running"` directly (no `queued` transition)
 *
 * Tier is always `"tier2"` for the parent record itself — the parent does
 * no code work; tier-1 gating happens per child during dispatch.
 *
 * @param issue    - GitHub issue context for the epic / batch parent.
 * @param kind     - `"epic"` (sub-issues from GitHub) or `"batch"` (explicit list).
 * @param children - Issue numbers of the child streams to be run under this parent.
 * @param rootDir  - Absolute path to the consumer project root.
 * @returns The newly created and persisted parent {@link StreamState}.
 */
export function createEpicStream(
  issue: IssueContext,
  kind: Exclude<StreamKind, "issue">,
  children: number[],
  rootDir: string
): StreamState {
  const now = new Date().toISOString();
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const branchPrefix = kind === "epic" ? `feat/epic-${issue.number}` : `chore/batch-${issue.number}`;
  const epicBranch = slug.length > 0 ? `${branchPrefix}-${slug}` : branchPrefix;

  const state: StreamState = {
    schemaVersion: SCHEMA_VERSION,
    issue,
    tier: "tier2",
    tierSource: "classifier",
    tierReason: `Parent ${kind} stream — tier-1 gating happens per child`,
    status: "epic-running",
    branch: epicBranch,
    worktreePath: null,
    planPath: null,
    prdPath: null,
    autoApprove: true,
    parentIssue: null,
    childIssues: children,
    groups: {},
    kind,
    epicChildren: children,
    epicBranch,
    created: now,
    updated: now,
  };

  writeStream(rootDir, issue.number, state);
  return state;
}

/**
 * Merge a partial update into an existing stream and persist the result.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 * @param partial - Partial {@link StreamState} fields to merge.
 * @returns The updated and persisted {@link StreamState}.
 * @throws {Error} If no stream exists for the given issue number.
 */
export function updateStream(
  rootDir: string,
  issue: number,
  partial: Partial<StreamState>
): StreamState {
  const existing = readStream(rootDir, issue);
  if (existing === null) {
    throw new Error(`Stream for issue #${issue} does not exist.`);
  }

  const merged: StreamState = { ...existing, ...partial };
  writeStream(rootDir, issue, merged);
  // Read back to get the timestamp set by writeStream.
  return readStream(rootDir, issue) as StreamState;
}

/**
 * Delete the state file for a stream. No-op if the file does not exist.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 */
export function deleteStream(rootDir: string, issue: number): void {
  const filePath = path.join(getBoardDir(rootDir), `${issue}.json`);
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
