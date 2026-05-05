import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Maximum allowed size of a shared-context file before append refuses to
 * silently truncate. Caller receives `{ overflow: true }` and is expected
 * to surface a blocker — losing context mid-epic is a nightmare debugging
 * scenario; visible failure is much better.
 */
export const SHARED_CONTEXT_MAX_BYTES = 32 * 1024;

/**
 * Filesystem path for an epic / batch's shared-context file.
 * Lives at `.root/streams/<epic>/shared-context.md` — deliberately separate
 * from `.root/board/<n>.json` so the two namespaces don't collide as the
 * board format evolves.
 */
function sharedContextPath(rootDir: string, epicIssue: number): string {
  return join(rootDir, ".root", "streams", String(epicIssue), "shared-context.md");
}

/**
 * Return the full content of an epic's shared-context file. Empty string
 * if the file does not yet exist (epic just started, no notes appended).
 *
 * @param rootDir   - Absolute path to the consumer project root.
 * @param epicIssue - GitHub issue number of the epic / batch parent.
 */
export function getSharedContext(rootDir: string, epicIssue: number): string {
  const filePath = sharedContextPath(rootDir, epicIssue);
  if (!existsSync(filePath)) {
    return "";
  }
  return readFileSync(filePath, "utf8");
}

/**
 * Result of {@link appendSharedContext}.
 *
 * - `{ overflow: false, bytes }` — note appended successfully; `bytes` is
 *   the new file size.
 * - `{ overflow: true, bytes }` — note WAS appended, but the resulting
 *   file exceeds {@link SHARED_CONTEXT_MAX_BYTES}. Caller should fire a
 *   blocker notification and stop dispatching further children.
 */
export type AppendResult =
  | { overflow: false; bytes: number }
  | { overflow: true; bytes: number };

/**
 * Append a timestamped note to an epic's shared-context file. Creates the
 * file (and its parent directory) if missing.
 *
 * The `note` argument is appended verbatim under a `## YYYY-MM-DDTHH:MM:SSZ`
 * header so each entry is greppable and chronologically ordered. The function
 * does NOT format or rewrite prior content; it is strictly append-only.
 *
 * @param rootDir   - Absolute path to the consumer project root.
 * @param epicIssue - GitHub issue number of the epic / batch parent.
 * @param note      - Markdown note content. Caller's job to format readably.
 * @returns {@link AppendResult} describing the post-append state.
 */
export function appendSharedContext(
  rootDir: string,
  epicIssue: number,
  note: string
): AppendResult {
  const filePath = sharedContextPath(rootDir, epicIssue);
  mkdirSync(dirname(filePath), { recursive: true });

  const timestamp = new Date().toISOString();
  const header = existsSync(filePath) ? `\n\n## ${timestamp}\n\n` : `## ${timestamp}\n\n`;
  const chunk = header + note + (note.endsWith("\n") ? "" : "\n");

  const prior = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  writeFileSync(filePath, prior + chunk, "utf8");

  const bytes = statSync(filePath).size;
  if (bytes > SHARED_CONTEXT_MAX_BYTES) {
    return { overflow: true, bytes };
  }
  return { overflow: false, bytes };
}
