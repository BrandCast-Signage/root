"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GATE_CONFIG = void 0;
exports.loadGateConfig = loadGateConfig;
exports.evaluateGate = evaluateGate;
exports.getNextTransition = getNextTransition;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * State-machine transition table.
 * Maps each StreamStatus to the next status and the gate (if any) that must be
 * evaluated before the transition can proceed automatically.
 */
const TRANSITIONS = {
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
exports.DEFAULT_GATE_CONFIG = {
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
function loadGateConfig(rootDir) {
    try {
        const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(rootDir, "root.config.json"), "utf8");
        const parsed = JSON.parse(raw);
        const userGates = parsed?.board?.gates ?? {};
        return { ...exports.DEFAULT_GATE_CONFIG, ...userGates };
    }
    catch {
        return { ...exports.DEFAULT_GATE_CONFIG };
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
function evaluateGate(gateName, tier, config) {
    const gateValue = config[gateName];
    if (gateValue === undefined) {
        return {
            action: "auto",
            reason: `Gate "${gateName}" not found in config — defaulting to auto`,
        };
    }
    // TierGateConfig has both tier1 and tier2 keys.
    if (typeof gateValue === "object" &&
        gateValue !== null &&
        "tier1" in gateValue &&
        "tier2" in gateValue) {
        const tierConfig = gateValue;
        const action = tierConfig[tier];
        return {
            action,
            reason: `${gateName} requires ${action === "human" ? "human" : "automatic"} approval for ${tier}`,
        };
    }
    const action = gateValue;
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
function getNextTransition(currentStatus) {
    return TRANSITIONS[currentStatus] ?? null;
}
