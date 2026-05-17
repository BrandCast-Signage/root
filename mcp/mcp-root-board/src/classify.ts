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

/**
 * Keywords that indicate mechanical / well-scoped work.
 *
 * Note: "typo" and "bump" intentionally overlap with TIER2_KEYWORDS above.
 * TIER2_KEYWORDS fires on keyword hits across the full text for primary
 * classification; MECHANICAL_KEYWORDS is a separate targeted check for the
 * scope-signal heuristic, applied only to the title + first paragraph.
 * The overlap is not a conflict — the two checks serve different purposes.
 */
const MECHANICAL_KEYWORDS = [
  "rename",
  "signature",
  "single-file",
  "one-line",
  "typo",
  "bump",
  "extract",
  "inline",
  "move",
  "split",
  "merge",
];

/** Regex matching file-shaped strings (path/to/file.ext). */
const FILE_REGEX = /[\w/.-]+\.(ts|tsx|js|md|json|sh|py)/g;

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
export function scopeSignal(issue: {
  title: string;
  body?: string;
}): ScopeSignal {
  const body = issue.body ?? "";

  // ── small ────────────────────────────────────────────────────────────────
  // If "## Files affected" section exists, count files there; otherwise count
  // across the whole body. Both use the same FILE_REGEX on distinct matches.
  let smallReason = "";
  let small = false;

  if (body.length > 0) {
    const lines = body.split("\n");
    const filesHeadingIdx = lines.findIndex((l) =>
      /^##\s+files affected/i.test(l)
    );

    let searchText: string;
    if (filesHeadingIdx !== -1) {
      // Collect lines in this section until the next ## heading.
      const sectionLines: string[] = [];
      for (let i = filesHeadingIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]!)) break;
        sectionLines.push(lines[i]!);
      }
      searchText = sectionLines.join("\n");
    } else {
      searchText = body;
    }

    const fileMatches = [...searchText.matchAll(FILE_REGEX)].map((m) => m[0]);
    const distinctFiles = new Set(fileMatches);
    const fileCount = distinctFiles.size;
    small = fileCount <= 3;
    smallReason = `small (${fileCount} file${fileCount === 1 ? "" : "s"})`;
  }

  // ── locked ───────────────────────────────────────────────────────────────
  // Find ## Acceptance / ## Acceptance criteria / ## Done when heading, then
  // count bullet lines in that section.
  let locked = false;
  const lockedHeadingRe = /^##\s+(Acceptance|Acceptance criteria|Done when)/i;
  const bulletRe = /^\s*[-*]\s+\S/;

  if (body.length > 0) {
    const lines = body.split("\n");
    const headingIdx = lines.findIndex((l) => lockedHeadingRe.test(l));
    if (headingIdx !== -1) {
      let bulletCount = 0;
      for (let i = headingIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]!)) break;
        if (bulletRe.test(lines[i]!)) bulletCount++;
      }
      locked = bulletCount >= 2;
    }
  }

  // ── mechanical ───────────────────────────────────────────────────────────
  // Check the title + first paragraph (text before the first ## heading) for
  // mechanical keywords. Also check for a ## Fix / ## Fix path section that
  // names a specific function or code location.
  let mechanical = false;
  let mechanicalReason = "";

  // Extract first paragraph (title + body before first ## heading).
  const firstParaLines: string[] = [];
  if (body.length > 0) {
    for (const line of body.split("\n")) {
      if (/^##\s+/.test(line)) break;
      firstParaLines.push(line);
    }
  }
  const titleAndFirstPara =
    `${issue.title} ${firstParaLines.join(" ")}`.toLowerCase();

  const hitKeyword = MECHANICAL_KEYWORDS.find((kw) =>
    titleAndFirstPara.includes(kw)
  );
  if (hitKeyword !== undefined) {
    mechanical = true;
    mechanicalReason = `mechanical (keyword: ${hitKeyword})`;
  }

  // Check for a ## Fix / ## Fix path section that names a specific function.
  if (!mechanical && body.length > 0) {
    const lines = body.split("\n");
    const fixHeadingIdx = lines.findIndex((l) =>
      /^##\s+Fix(?: path)?:?\s*$/i.test(l)
    );
    if (fixHeadingIdx !== -1) {
      // Collect non-empty lines in the Fix section until the next ## heading.
      const fixLines: string[] = [];
      for (let i = fixHeadingIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]!)) break;
        const trimmed = lines[i]!.trim();
        if (trimmed.length > 0) fixLines.push(trimmed);
      }
      // A non-empty Fix section (at least one word) counts as a named function.
      if (fixLines.some((l) => /\S/.test(l))) {
        mechanical = true;
        mechanicalReason = "mechanical (named fix path)";
      }
    }
  }

  // ── combination ──────────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (small) reasons.push(smallReason);
  if (locked) reasons.push("locked (AC/done-when)");
  if (mechanical) reasons.push(mechanicalReason);

  const downgrade = small && locked && mechanical;

  return { small, locked, mechanical, downgrade, reasons };
}

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
export function classifyTier(issue: {
  title: string;
  body?: string;
  labels: string[];
}): TierClassification {
  const lowerLabels = issue.labels.map((l) => l.toLowerCase());

  for (const l of lowerLabels) {
    if (TIER1_LABELS.has(l)) {
      const base = { tier: "tier1" as Tier, reason: `label "${l}" matches Tier 1 policy` };
      return applyDowngrade(issue, base);
    }
    if (TIER2_LABELS.has(l)) {
      return { tier: "tier2", reason: `label "${l}" matches Tier 2 policy` };
    }
  }

  const text = `${issue.title} ${issue.body ?? ""}`.toLowerCase();
  const tier1Hits = TIER1_KEYWORDS.filter((k) => text.includes(k));
  const tier2Hits = TIER2_KEYWORDS.filter((k) => text.includes(k));

  if (tier1Hits.length > tier2Hits.length) {
    const base = {
      tier: "tier1" as Tier,
      reason: `title/body matched Tier 1 keywords: ${tier1Hits.join(", ")}`,
    };
    return applyDowngrade(issue, base);
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

/**
 * If the classifier resolved tier1, check the scope signal. When all three
 * signals hold, downgrade to tier2 and embed the reason in the returned
 * classification.
 */
function applyDowngrade(
  issue: { title: string; body?: string },
  base: TierClassification
): TierClassification {
  if (base.tier !== "tier1") return base;
  const signal = scopeSignal(issue);
  if (signal.downgrade) {
    return {
      tier: "tier2",
      reason: `Tier downgraded by scope signal (${signal.reasons.join(" + ")}); original label/keyword classification was tier1`,
    };
  }
  return base;
}
