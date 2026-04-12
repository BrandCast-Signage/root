/** Current schema version for StreamState. Increment when adding breaking changes. */
export const SCHEMA_VERSION = 1;

/** Lifecycle status of a work stream. */
export type StreamStatus =
  | "queued"
  | "planning"
  | "plan-ready"
  | "approved"
  | "implementing"
  | "validating"
  | "pr-ready"
  | "merged"
  | "blocked";

/** Work complexity tier. Tier 1 requires human delegation; Tier 2 can be fully automated. */
export type Tier = "tier1" | "tier2";

/** AI harness handling a work group. */
export type Harness = "claude" | "gemini";

/** Progress status of an implementation group. */
export type GroupStatus = "pending" | "in-progress" | "complete";

/**
 * Assignment and progress for a single implementation group within a stream.
 */
export interface GroupAssignment {
  /** Harness assigned to this group, or null if unassigned. */
  harness: Harness | null;
  /** Current progress of this group. */
  status: GroupStatus;
  /** Absolute path to the worktree for this group, or null if not yet created. */
  worktreePath: string | null;
}

/**
 * Snapshot of a GitHub issue associated with a stream.
 */
export interface IssueContext {
  /** GitHub issue number. */
  number: number;
  /** Issue title. */
  title: string;
  /** Labels applied to the issue. */
  labels: string[];
  /** Issue state ("open" | "closed"). */
  state: string;
}

/**
 * Full persisted state for a single work stream.
 */
export interface StreamState {
  /** Schema version for lazy migration. */
  schemaVersion: number;
  /** GitHub issue driving this stream. */
  issue: IssueContext;
  /** Complexity tier. */
  tier: Tier;
  /** Current lifecycle status. */
  status: StreamStatus;
  /** Git branch name for this stream. */
  branch: string;
  /** Absolute path to the primary worktree, or null if not yet created. */
  worktreePath: string | null;
  /** Relative path to the implementation plan file, or null if not yet created. */
  planPath: string | null;
  /** Relative path to the PRD file, or null if not yet created. */
  prdPath: string | null;
  /** When true, all gates auto-advance regardless of tier or config. */
  autoApprove: boolean;
  /** Map of group ID → assignment details. */
  groups: Record<string, GroupAssignment>;
  /** ISO 8601 timestamp of stream creation. */
  created: string;
  /** ISO 8601 timestamp of last update. */
  updated: string;
}

/** Whether a gate transition is automatic or requires human approval. */
export type GateAction = "auto" | "human";

/**
 * Result of evaluating a gate.
 */
export interface GateResult {
  /** Resolved action for this gate. */
  action: GateAction;
  /** Human-readable explanation for the action. */
  reason: string;
}

/**
 * Per-tier gate configuration for a single gate type.
 */
export interface TierGateConfig {
  tier1: GateAction;
  tier2: GateAction;
}

/**
 * Gate configuration for each transition point in the workflow.
 */
export interface GateConfig {
  /** Gate guarding plan approval before implementation begins. */
  plan_approval: TierGateConfig;
  /** Gate guarding reviewer sign-off. */
  reviewer_pass: GateAction;
  /** Gate guarding validation step. */
  validation: GateAction;
  /** Gate guarding PR creation. */
  pr_creation: GateAction;
}

/**
 * Top-level board configuration.
 */
export interface BoardConfig {
  /** Gate configurations for each workflow transition. */
  gates: GateConfig;
  /** Maximum number of streams that may run concurrently. */
  maxParallel: number;
}
