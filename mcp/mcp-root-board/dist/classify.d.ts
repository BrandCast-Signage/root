import { Tier } from "./types.js";
export interface TierClassification {
    tier: Tier;
    /** Human-readable reason for the classification. Reported back to the caller. */
    reason: string;
}
/**
 * Deterministically classify an issue into Tier 1 or Tier 2 based on labels and text signals.
 *
 * Precedence:
 *   1. A matching `type:*` label (labels are authoritative).
 *   2. Keyword match in title + body (stronger count wins).
 *   3. Ambiguous → Tier 2, with a reason that invites the caller to override.
 */
export declare function classifyTier(issue: {
    title: string;
    body?: string;
    labels: string[];
}): TierClassification;
