import { Tier } from "./types.js";

/**
 * Labels that signal Tier 1 (full process).
 *
 * `type:feature` is intentionally NOT here. The triage tooling labels far too
 * many issues as features (most of them small), so the label alone is not a
 * reliable Tier 1 signal. Feature issues fall through to keyword analysis and
 * land Tier 1 only if their title/body says so (e.g. "schema change",
 * "migration", "architecture").
 */
const TIER1_LABELS = new Set<string>([
  "type:refactor",
  "type:epic",
  "type:security",
]);

/** Labels that signal Tier 2 (light process). */
const TIER2_LABELS = new Set<string>([
  "type:bug",
  "type:chore",
  "type:docs",
  "type:dependencies",
]);

/** Title/body keywords that lean Tier 1. */
const TIER1_KEYWORDS = [
  "refactor",
  "redesign",
  "migration",
  "rewrite",
  "integrate",
  "integration",
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
export function classifyTier(issue: {
  title: string;
  body?: string;
  labels: string[];
}): TierClassification {
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
    reason:
      "no type:* label and no tier-distinguishing keywords — ambiguous issues classify as Tier 2; pass tier override to board_start if this is Tier 1 work",
  };
}
