/**
 * Configuration for the GitHub Project v2 integration in `board_start`.
 *
 * All IDs are GitHub node IDs (the opaque `PVT_…` / `PVTSSF_…` strings, not
 * the visible project number). Look them up once per project via
 * `gh api graphql` and paste them into `root.config.json`.
 */
export interface GithubProjectConfig {
    projectId: string;
    statusFieldId: string;
    statusOptions: {
        inProgress: string;
    };
    mirrorLabel?: string;
}
/**
 * Load `board.githubProject` from `root.config.json`. Returns `null` if the
 * file is missing, malformed, or the section / required fields are absent —
 * which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
export declare function loadGithubProjectConfig(rootDir: string): GithubProjectConfig | null;
/**
 * Set the linked Project v2 item's Status field to "In Progress" for an issue.
 *
 * Idempotent on two axes:
 *   1. `addProjectV2ItemById` returns the existing item if the issue is
 *      already in the project, so re-running on a project member is a no-op.
 *   2. `updateProjectV2ItemFieldValue` rewrites the same value with no effect
 *      when the status is already "In Progress".
 *
 * @throws {Error} If any `gh` call fails. Callers should treat this as
 *   non-fatal and continue — Project sync is a nice-to-have, not a gate.
 */
export declare function setProjectStatusInProgress(issue: number, cfg: GithubProjectConfig): void;
