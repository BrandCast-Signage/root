import { IssueContext, StreamState, Tier } from "./types.js";
/**
 * Return the board directory path and ensure it exists.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Absolute path to `.root/board/` inside `rootDir`.
 */
export declare function getBoardDir(rootDir: string): string;
/**
 * Read and migrate a stream state file from disk.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 * @returns The migrated {@link StreamState}, or `null` if no file exists.
 */
export declare function readStream(rootDir: string, issue: number): StreamState | null;
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
export declare function writeStream(rootDir: string, issue: number, state: StreamState): void;
/**
 * List all streams persisted in the board directory, sorted by issue number.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Array of migrated {@link StreamState} objects sorted ascending by issue number.
 */
export declare function listStreams(rootDir: string): StreamState[];
/**
 * Create a new stream for the given issue and persist it.
 *
 * @param issue - GitHub issue context for the new stream.
 * @param tier - Complexity tier for the stream.
 * @param rootDir - Absolute path to the consumer project root.
 * @returns The newly created and persisted {@link StreamState}.
 */
export declare function createStream(issue: IssueContext, tier: Tier, rootDir: string): StreamState;
/**
 * Merge a partial update into an existing stream and persist the result.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 * @param partial - Partial {@link StreamState} fields to merge.
 * @returns The updated and persisted {@link StreamState}.
 * @throws {Error} If no stream exists for the given issue number.
 */
export declare function updateStream(rootDir: string, issue: number, partial: Partial<StreamState>): StreamState;
/**
 * Delete the state file for a stream. No-op if the file does not exist.
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @param issue - GitHub issue number identifying the stream.
 */
export declare function deleteStream(rootDir: string, issue: number): void;
