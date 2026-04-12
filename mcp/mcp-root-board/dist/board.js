"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBoardDir = getBoardDir;
exports.readStream = readStream;
exports.writeStream = writeStream;
exports.listStreams = listStreams;
exports.createStream = createStream;
exports.updateStream = updateStream;
exports.deleteStream = deleteStream;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const types_js_1 = require("./types.js");
const migrate_js_1 = require("./migrate.js");
/**
 * Return the board directory path and ensure it exists.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Absolute path to `.root/board/` inside `rootDir`.
 */
function getBoardDir(rootDir) {
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
function readStream(rootDir, issue) {
    const filePath = path.join(getBoardDir(rootDir), `${issue}.json`);
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return (0, migrate_js_1.migrate)(JSON.parse(raw));
    }
    catch (err) {
        if (err.code === "ENOENT") {
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
function writeStream(rootDir, issue, state) {
    const boardDir = getBoardDir(rootDir);
    const filePath = path.join(boardDir, `${issue}.json`);
    const tmpPath = `${filePath}.tmp`;
    const toWrite = {
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
function listStreams(rootDir) {
    const boardDir = getBoardDir(rootDir);
    const entries = fs.readdirSync(boardDir).filter((f) => f.endsWith(".json"));
    const states = [];
    for (const entry of entries) {
        const issueNum = parseInt(path.basename(entry, ".json"), 10);
        if (isNaN(issueNum))
            continue;
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
 * @param rootDir - Absolute path to the consumer project root.
 * @returns The newly created and persisted {@link StreamState}.
 */
function createStream(issue, tier, rootDir) {
    const now = new Date().toISOString();
    const state = {
        schemaVersion: types_js_1.SCHEMA_VERSION,
        issue,
        tier,
        status: "queued",
        branch: `issue-${issue.number}`,
        worktreePath: null,
        planPath: null,
        prdPath: null,
        autoApprove: false,
        parentIssue: null,
        childIssues: [],
        groups: {},
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
function updateStream(rootDir, issue, partial) {
    const existing = readStream(rootDir, issue);
    if (existing === null) {
        throw new Error(`Stream for issue #${issue} does not exist.`);
    }
    const merged = { ...existing, ...partial };
    writeStream(rootDir, issue, merged);
    // Read back to get the timestamp set by writeStream.
    return readStream(rootDir, issue);
}
/**
 * Delete the state file for a stream. No-op if the file does not exist.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 */
function deleteStream(rootDir, issue) {
    const filePath = path.join(getBoardDir(rootDir), `${issue}.json`);
    try {
        fs.unlinkSync(filePath);
    }
    catch (err) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
}
