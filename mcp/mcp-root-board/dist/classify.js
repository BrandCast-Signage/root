"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyTier = classifyTier;
/** Labels that signal Tier 1 (full process). */
const TIER1_LABELS = new Set([
    "type:feature",
    "type:enhancement",
    "type:refactor",
    "type:epic",
    "type:breaking",
    "type:architecture",
    "type:integration",
]);
/** Labels that signal Tier 2 (light process). */
const TIER2_LABELS = new Set([
    "type:bug",
    "type:fix",
    "type:chore",
    "type:docs",
    "type:dependencies",
    "type:deps",
    "type:typo",
    "type:hotfix",
]);
/** Title/body keywords that lean Tier 1. */
const TIER1_KEYWORDS = [
    "refactor",
    "redesign",
    "migration",
    "rewrite",
    "integrate",
    "integration",
    "new feature",
    "schema change",
    "architecture",
    "multi-package",
    "epic",
];
/** Title/body keywords that lean Tier 2. */
const TIER2_KEYWORDS = [
    "fix ",
    "fixes ",
    "hotfix",
    "typo",
    "bump ",
    "patch",
    "update dep",
    "dependency bump",
];
/**
 * Deterministically classify an issue into Tier 1 or Tier 2 based on labels and text signals.
 *
 * Precedence:
 *   1. A matching `type:*` label (labels are authoritative).
 *   2. Keyword match in title + body (stronger count wins).
 *   3. Ambiguous → Tier 2, with a reason that invites the caller to override.
 */
function classifyTier(issue) {
    const lowerLabels = issue.labels.map((l) => l.toLowerCase());
    for (const l of lowerLabels) {
        if (TIER1_LABELS.has(l)) {
            return { tier: "tier1", reason: `label "${l}" matches Tier 1 policy` };
        }
        if (TIER2_LABELS.has(l)) {
            return { tier: "tier2", reason: `label "${l}" matches Tier 2 policy` };
        }
    }
    const text = `${issue.title} ${issue.body ?? ""}`.toLowerCase();
    const tier1Hits = TIER1_KEYWORDS.filter((k) => text.includes(k));
    const tier2Hits = TIER2_KEYWORDS.filter((k) => text.includes(k));
    if (tier1Hits.length > tier2Hits.length) {
        return {
            tier: "tier1",
            reason: `title/body matched Tier 1 keywords: ${tier1Hits.join(", ")}`,
        };
    }
    if (tier2Hits.length > tier1Hits.length) {
        return {
            tier: "tier2",
            reason: `title/body matched Tier 2 keywords: ${tier2Hits.map((k) => k.trim()).join(", ")}`,
        };
    }
    return {
        tier: "tier2",
        reason: "no type:* label and no tier-distinguishing keywords — ambiguous issues classify as Tier 2; pass tier override to board_start if this is Tier 1 work",
    };
}
