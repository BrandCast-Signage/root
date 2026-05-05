import { SCHEMA_VERSION, StreamState, TierSource } from "./types.js";

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
      // v0 → current: fill in fields introduced after v0.
      return {
        schemaVersion: SCHEMA_VERSION,
        issue: (raw["issue"] as StreamState["issue"]) ?? {
          number: 0,
          title: "",
          labels: [],
          state: "open",
        },
        tier: (raw["tier"] as StreamState["tier"]) ?? "tier2",
        tierSource: "classifier",
        tierReason: "unknown (pre-v2 record)",
        status: (raw["status"] as StreamState["status"]) ?? "queued",
        branch: (raw["branch"] as string) ?? "",
        worktreePath: (raw["worktreePath"] as string | null) ?? null,
        planPath: (raw["planPath"] as string | null) ?? null,
        prdPath: (raw["prdPath"] as string | null) ?? null,
        autoApprove: (raw["autoApprove"] as boolean) ?? false,
        parentIssue: (raw["parentIssue"] as number | null) ?? null,
        childIssues: (raw["childIssues"] as number[]) ?? [],
        groups: (raw["groups"] as StreamState["groups"]) ?? {},
        kind: "issue",
        epicChildren: [],
        epicBranch: null,
        created: (raw["created"] as string) ?? new Date().toISOString(),
        updated: (raw["updated"] as string) ?? new Date().toISOString(),
      };
    }

    case 1: {
      // v1 → v2: backfill tier provenance fields. Pre-v2 records have no record
      // of why a tier was chosen, so we mark them as classifier-derived with an
      // explicit "unknown" reason rather than fabricating one.
      const upgraded = { ...(raw as unknown as StreamState) };
      upgraded.schemaVersion = SCHEMA_VERSION;
      upgraded.tierSource = "classifier";
      upgraded.tierReason = "unknown (pre-v2 record)";
      // Preserve v1's other backfills.
      if (upgraded.autoApprove === undefined) upgraded.autoApprove = false;
      if (upgraded.parentIssue === undefined) upgraded.parentIssue = null;
      if (upgraded.childIssues === undefined) upgraded.childIssues = [];
      // 2.4 fields.
      if (upgraded.kind === undefined) upgraded.kind = "issue";
      if (upgraded.epicChildren === undefined) upgraded.epicChildren = [];
      if (upgraded.epicBranch === undefined) upgraded.epicBranch = null;
      return upgraded;
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
      if (current.tierSource === undefined) {
        current.tierSource = "classifier" as TierSource;
      }
      if (current.tierReason === undefined) {
        current.tierReason = "unknown (pre-v2 record)";
      }
      // 2.4 fields — added without a schema bump since they're additive optionals.
      if (current.kind === undefined) {
        current.kind = "issue";
      }
      if (current.epicChildren === undefined) {
        current.epicChildren = [];
      }
      if (current.epicBranch === undefined) {
        current.epicBranch = null;
      }
      return current;
    }

    default:
      // Unknown future version — return as-is and let the caller decide.
      return raw as unknown as StreamState;
  }
}
