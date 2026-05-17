import { Tier } from "./types.js";
export interface TierClassification {
    tier: Tier;
    /** Human-readable reason for the classification. Reported back to the caller. */
    reason: string;
}
/**
 * Signal shape returned by `scopeSignal`.
 */
export interface ScopeSignal {
    /** True when ≤3 distinct file paths are referenced in the issue body. */
    small: boolean;
    /** True when the body has an Acceptance/Done-when heading with ≥2 bullets. */
    locked: boolean;
    /** True when the title/first-paragraph contains a mechanical keyword, or a Fix path section names a specific function. */
    mechanical: boolean;
    /** True only when all three signals hold (strict AND). */
    downgrade: boolean;
    /** Human-readable per-signal labels for the reason string. */
    reasons: string[];
}
/**
 * Determine whether a classifier-resolved Tier 1 result should be downgraded
 * to Tier 2 based on scope signals:
 *
 *   - `small`:      ≤3 distinct file paths referenced in the body
 *   - `locked`:     body has an Acceptance/Done-when heading with ≥2 bullets
 *   - `mechanical`: title or first paragraph contains a mechanical keyword,
 *                   OR a "Fix:"/"Fix path:" section names a specific function
 *
 * `downgrade` is true only when ALL THREE hold (strict AND).
 * Safe failure mode: when body is absent, all signals return false.
 */
export declare function scopeSignal(issue: {
    title: string;
    body?: string;
}): ScopeSignal;
/**
 * Deterministically classify an issue into Tier 1 or Tier 2 based on labels and text signals.
 *
 * Precedence:
 *   1. A matching `type:*` label (labels are authoritative).
 *   2. Keyword match in title + body (stronger count wins).
 *   3. Ambiguous → Tier 2, with a reason that invites the caller to override.
 *
 * Post-classification: when the classifier resolves Tier 1 (via label or
 * keyword), `scopeSignal` is consulted. If all three scope signals hold
 * (small + locked + mechanical), the result is downgraded to Tier 2.
 * This never fires on user overrides because overrides short-circuit in
 * `board_start` before `classifyTier` is ever called.
 */
export declare function classifyTier(issue: {
    title: string;
    body?: string;
    labels: string[];
}): TierClassification;
