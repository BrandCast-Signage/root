import { StreamState } from "./types.js";
/**
 * Migrate a possibly-old schema object to the current {@link StreamState} shape.
 *
 * This is a pure function — no I/O, no side effects. New schema versions should
 * add a `case` to the switch so older states are upgraded incrementally.
 *
 * @param state - Raw object loaded from disk (may be any schema version).
 * @returns A fully-typed {@link StreamState} at the current schema version.
 */
export declare function migrate(state: unknown): StreamState;
