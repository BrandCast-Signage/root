"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHARED_CONTEXT_MAX_BYTES = void 0;
exports.getSharedContext = getSharedContext;
exports.appendSharedContext = appendSharedContext;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Maximum allowed size of a shared-context file before append refuses to
 * silently truncate. Caller receives `{ overflow: true }` and is expected
 * to surface a blocker — losing context mid-epic is a nightmare debugging
 * scenario; visible failure is much better.
 */
exports.SHARED_CONTEXT_MAX_BYTES = 32 * 1024;
/**
 * Filesystem path for an epic / batch's shared-context file.
 * Lives at `.root/streams/<epic>/shared-context.md` — deliberately separate
 * from `.root/board/<n>.json` so the two namespaces don't collide as the
 * board format evolves.
 */
function sharedContextPath(rootDir, epicIssue) {
    return (0, node_path_1.join)(rootDir, ".root", "streams", String(epicIssue), "shared-context.md");
}
/**
 * Return the full content of an epic's shared-context file. Empty string
 * if the file does not yet exist (epic just started, no notes appended).
 *
 * @param rootDir   - Absolute path to the consumer project root.
 * @param epicIssue - GitHub issue number of the epic / batch parent.
 */
function getSharedContext(rootDir, epicIssue) {
    const filePath = sharedContextPath(rootDir, epicIssue);
    if (!(0, node_fs_1.existsSync)(filePath)) {
        return "";
    }
    return (0, node_fs_1.readFileSync)(filePath, "utf8");
}
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
function appendSharedContext(rootDir, epicIssue, note) {
    const filePath = sharedContextPath(rootDir, epicIssue);
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(filePath), { recursive: true });
    const timestamp = new Date().toISOString();
    const header = (0, node_fs_1.existsSync)(filePath) ? `\n\n## ${timestamp}\n\n` : `## ${timestamp}\n\n`;
    const chunk = header + note + (note.endsWith("\n") ? "" : "\n");
    const prior = (0, node_fs_1.existsSync)(filePath) ? (0, node_fs_1.readFileSync)(filePath, "utf8") : "";
    (0, node_fs_1.writeFileSync)(filePath, prior + chunk, "utf8");
    const bytes = (0, node_fs_1.statSync)(filePath).size;
    if (bytes > exports.SHARED_CONTEXT_MAX_BYTES) {
        return { overflow: true, bytes };
    }
    return { overflow: false, bytes };
}
