import { SCHEMA_VERSION, StreamState } from "./types.js";

/**
 * Migrate a possibly-old schema object to the current {@link StreamState} shape.
 *
 * This is a pure function — no I/O, no side effects. New schema versions should
 * add a `case` to the switch so older states are upgraded incrementally.
 *
 * @param state - Raw object loaded from disk (may be any schema version).
 * @returns A fully-typed {@link StreamState} at the current schema version.
 */
export function migrate(state: unknown): StreamState {
  const raw = state as Record<string, unknown>;
  const version = typeof raw["schemaVersion"] === "number" ? raw["schemaVersion"] : 0;

  switch (version) {
    case 0: {
      // v0 → v1: fill in fields introduced in schema version 1
      return {
        schemaVersion: SCHEMA_VERSION,
        issue: (raw["issue"] as StreamState["issue"]) ?? {
          number: 0,
          title: "",
          labels: [],
          state: "open",
        },
        tier: (raw["tier"] as StreamState["tier"]) ?? "tier2",
        status: (raw["status"] as StreamState["status"]) ?? "queued",
        branch: (raw["branch"] as string) ?? "",
        worktreePath: (raw["worktreePath"] as string | null) ?? null,
        planPath: (raw["planPath"] as string | null) ?? null,
        prdPath: (raw["prdPath"] as string | null) ?? null,
        autoApprove: (raw["autoApprove"] as boolean) ?? false,
        parentIssue: (raw["parentIssue"] as number | null) ?? null,
        childIssues: (raw["childIssues"] as number[]) ?? [],
        groups: (raw["groups"] as StreamState["groups"]) ?? {},
        created: (raw["created"] as string) ?? new Date().toISOString(),
        updated: (raw["updated"] as string) ?? new Date().toISOString(),
      };
    }

    case SCHEMA_VERSION: {
      // Already at current version — backfill any fields added without a version bump.
      const current = raw as unknown as StreamState;
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
      return raw as unknown as StreamState;
  }
}
