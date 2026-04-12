import { GateConfig, GateResult, StreamStatus, Tier } from "./types.js";
/**
 * Default gate configuration used when no consumer-project config is found
 * or when the config does not specify a gate entry.
 */
export declare const DEFAULT_GATE_CONFIG: GateConfig;
/**
 * Load the gate configuration from `root.config.json` in `rootDir`, merged
 * with DEFAULT_GATE_CONFIG (user values override defaults).
 *
 * @param rootDir - Absolute path to the consumer project root.
 * @returns Merged {@link GateConfig}. Falls back to defaults on any error.
 */
export declare function loadGateConfig(rootDir: string): GateConfig;
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
export declare function evaluateGate(gateName: string, tier: Tier, config: GateConfig): GateResult;
/**
 * Return the next transition for the given stream status.
 *
 * @param currentStatus - The current {@link StreamStatus}.
 * @returns The transition descriptor, or `null` if `currentStatus` is a terminal state.
 */
export declare function getNextTransition(currentStatus: StreamStatus): {
    next: StreamStatus;
    gate: string | null;
} | null;
