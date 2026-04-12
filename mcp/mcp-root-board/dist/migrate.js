"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrate = migrate;
const types_js_1 = require("./types.js");
/**
 * Migrate a possibly-old schema object to the current {@link StreamState} shape.
 *
 * This is a pure function — no I/O, no side effects. New schema versions should
 * add a `case` to the switch so older states are upgraded incrementally.
 *
 * @param state - Raw object loaded from disk (may be any schema version).
 * @returns A fully-typed {@link StreamState} at the current schema version.
 */
function migrate(state) {
    const raw = state;
    const version = typeof raw["schemaVersion"] === "number" ? raw["schemaVersion"] : 0;
    switch (version) {
        case 0: {
            // v0 → v1: fill in fields introduced in schema version 1
            return {
                schemaVersion: types_js_1.SCHEMA_VERSION,
                issue: raw["issue"] ?? {
                    number: 0,
                    title: "",
                    labels: [],
                    state: "open",
                },
                tier: raw["tier"] ?? "tier2",
                status: raw["status"] ?? "queued",
                branch: raw["branch"] ?? "",
                worktreePath: raw["worktreePath"] ?? null,
                planPath: raw["planPath"] ?? null,
                prdPath: raw["prdPath"] ?? null,
                autoApprove: raw["autoApprove"] ?? false,
                parentIssue: raw["parentIssue"] ?? null,
                childIssues: raw["childIssues"] ?? [],
                groups: raw["groups"] ?? {},
                created: raw["created"] ?? new Date().toISOString(),
                updated: raw["updated"] ?? new Date().toISOString(),
            };
        }
        case types_js_1.SCHEMA_VERSION: {
            // Already at current version — backfill any fields added without a version bump.
            const current = raw;
            if (current.autoApprove === undefined) {
                current.autoApprove = false;
            }
            if (current.parentIssue === undefined) {
                current.parentIssue = null;
            }
            if (current.childIssues === undefined) {
                current.childIssues = [];
            }
            return current;
        }
        default:
            // Unknown future version — return as-is and let the caller decide.
            return raw;
    }
}
