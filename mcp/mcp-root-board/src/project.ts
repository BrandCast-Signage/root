import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  statusOptions: { inProgress: string };
  mirrorLabel?: string;
}

/**
 * Load `board.githubProject` from `root.config.json`. Returns `null` if the
 * file is missing, malformed, or the section / required fields are absent —
 * which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
export function loadGithubProjectConfig(rootDir: string): GithubProjectConfig | null {
  try {
    const raw = readFileSync(join(rootDir, "root.config.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      board?: { githubProject?: Partial<GithubProjectConfig> };
    };
    const cfg = parsed?.board?.githubProject;
    if (
      cfg === undefined ||
      typeof cfg.projectId !== "string" ||
      typeof cfg.statusFieldId !== "string" ||
      typeof cfg.statusOptions?.inProgress !== "string"
    ) {
      return null;
    }
    return {
      projectId: cfg.projectId,
      statusFieldId: cfg.statusFieldId,
      statusOptions: { inProgress: cfg.statusOptions.inProgress },
      mirrorLabel: typeof cfg.mirrorLabel === "string" ? cfg.mirrorLabel : undefined,
    };
  } catch {
    return null;
  }
}

const ADD_ITEM_MUTATION = `mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}`;

const UPDATE_FIELD_MUTATION = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}`;

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
export function setProjectStatusInProgress(issue: number, cfg: GithubProjectConfig): void {
  const issueIdRaw = execSync(`gh issue view ${issue} --json id`, { encoding: "utf-8" });
  const { id: issueNodeId } = JSON.parse(issueIdRaw) as { id: string };

  const addRaw = execFileSync(
    "gh",
    [
      "api", "graphql",
      "-f", `query=${ADD_ITEM_MUTATION}`,
      "-f", `projectId=${cfg.projectId}`,
      "-f", `contentId=${issueNodeId}`,
    ],
    { encoding: "utf-8" }
  );
  const addParsed = JSON.parse(addRaw) as {
    data: { addProjectV2ItemById: { item: { id: string } } };
  };
  const itemId = addParsed.data.addProjectV2ItemById.item.id;

  execFileSync(
    "gh",
    [
      "api", "graphql",
      "-f", `query=${UPDATE_FIELD_MUTATION}`,
      "-f", `projectId=${cfg.projectId}`,
      "-f", `itemId=${itemId}`,
      "-f", `fieldId=${cfg.statusFieldId}`,
      "-f", `optionId=${cfg.statusOptions.inProgress}`,
    ],
    { encoding: "utf-8" }
  );
}
