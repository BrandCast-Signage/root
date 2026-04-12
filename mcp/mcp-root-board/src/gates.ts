import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GateAction, GateConfig, GateResult, StreamStatus, Tier, TierGateConfig } from "./types.js";

/**
 * State-machine transition table.
 * Maps each StreamStatus to the next status and the gate (if any) that must be
 * evaluated before the transition can proceed automatically.
 */
const TRANSITIONS: Partial<Record<StreamStatus, { next: StreamStatus; gate: string | null }>> = {
  queued: { next: "planning", gate: null },
  planning: { next: "plan-ready", gate: null },
  "plan-ready": { next: "approved", gate: "plan_approval" },
  approved: { next: "implementing", gate: null },
  implementing: { next: "validating", gate: null },
  validating: { next: "pr-ready", gate: "validation" },
  "pr-ready": { next: "merged", gate: null },
};

/**
 * Default gate configuration used when no consumer-project config is found
 * or when the config does not specify a gate entry.
 */
export const DEFAULT_GATE_CONFIG: GateConfig = {
  plan_approval: { tier1: "human", tier2: "auto" },
  reviewer_pass: "auto",
  validation: "auto",
  pr_creation: "auto",
};

/**
 * Load the gate configuration from `root.config.json` in `rootDir`, merged
 * with DEFAULT_GATE_CONFIG (user values override defaults).
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Merged {@link GateConfig}. Falls back to defaults on any error.
 */
export function loadGateConfig(rootDir: string): GateConfig {
  try {
    const raw = readFileSync(join(rootDir, "root.config.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      board?: { gates?: Partial<GateConfig> };
    };

    const userGates = parsed?.board?.gates ?? {};
    return { ...DEFAULT_GATE_CONFIG, ...userGates };
  } catch {
    return { ...DEFAULT_GATE_CONFIG };
  }
}

/**
 * Evaluate a named gate against the resolved gate configuration.
 *
 * If the gate value is a {@link TierGateConfig} (has `tier1`/`tier2` keys),
 * the result is looked up by `tier`. Otherwise the value is used directly.
 * Unknown gates default to `"auto"`.
 *
 * @param gateName - Key in the gate config (e.g. `"plan_approval"`).
 * @param tier     - Work-stream tier, used for per-tier gate configs.
 * @param config   - Resolved {@link GateConfig} to evaluate against.
 * @returns {@link GateResult} with the resolved action and a human-readable reason.
 */
export function evaluateGate(gateName: string, tier: Tier, config: GateConfig): GateResult {
  const gateValue = (config as unknown as Record<string, GateAction | TierGateConfig | undefined>)[
    gateName
  ];

  if (gateValue === undefined) {
    return {
      action: "auto",
      reason: `Gate "${gateName}" not found in config — defaulting to auto`,
    };
  }

  // TierGateConfig has both tier1 and tier2 keys.
  if (
    typeof gateValue === "object" &&
    gateValue !== null &&
    "tier1" in gateValue &&
    "tier2" in gateValue
  ) {
    const tierConfig = gateValue as TierGateConfig;
    const action = tierConfig[tier];
    return {
      action,
      reason: `${gateName} requires ${action === "human" ? "human" : "automatic"} approval for ${tier}`,
    };
  }

  const action = gateValue as GateAction;
  return {
    action,
    reason: `${gateName} is configured as ${action}`,
  };
}

/**
 * Return the next transition for the given stream status.
 *
 * @param currentStatus - The current {@link StreamStatus}.
 * @returns The transition descriptor, or `null` if `currentStatus` is a terminal state.
 */
export function getNextTransition(
  currentStatus: StreamStatus
): { next: StreamStatus; gate: string | null } | null {
  return TRANSITIONS[currentStatus] ?? null;
}
