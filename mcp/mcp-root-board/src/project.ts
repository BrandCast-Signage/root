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
  /**
   * Optional Project v2 Date field ID. When set, `board_start` writes today's
   * date to this field on the linked item the first time the stream starts.
   * Enables velocity charts (start_date → close_date). First-write-wins so
   * re-running `board_start` on the same issue doesn't reset the timestamp.
   */
  startDateFieldId?: string;
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
      startDateFieldId:
        typeof cfg.startDateFieldId === "string" ? cfg.startDateFieldId : undefined,
    };
  } catch {
    return null;
  }
}

const ADD_ITEM_MUTATION = `mutation($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}`;

const UPDATE_FIELD_MUTATION = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){projectV2Item{id}}}`;

const READ_FIELD_VALUES_QUERY = `query($itemId:ID!){node(id:$itemId){...on ProjectV2Item{fieldValues(first:50){nodes{__typename ...on ProjectV2ItemFieldDateValue{date field{...on ProjectV2FieldCommon{id}}}}}}}}`;

const UPDATE_DATE_MUTATION = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$date:Date!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{date:$date}}){projectV2Item{id}}}`;

/**
 * Set the Start date field on a Project v2 item to today (UTC) — but only if
 * the field is currently empty. First-write-wins so a re-run of `board_start`
 * doesn't clobber the original start timestamp, which would corrupt velocity
 * charts (start_date → close_date).
 *
 * @throws {Error} If any `gh` call fails. Caller is responsible for swallowing
 *   — Project sync is non-fatal.
 */
export function setProjectStartDateIfUnset(
  itemId: string,
  fieldId: string,
  projectId: string
): void {
  const readRaw = execFileSync(
    "gh",
    [
      "api", "graphql",
      "-f", `query=${READ_FIELD_VALUES_QUERY}`,
      "-f", `itemId=${itemId}`,
    ],
    { encoding: "utf-8" }
  );
  const readParsed = JSON.parse(readRaw) as {
    data: {
      node: {
        fieldValues: {
          nodes: Array<{ __typename?: string; date?: string | null; field?: { id?: string } }>;
        };
      } | null;
    };
  };
  const existing = readParsed.data.node?.fieldValues.nodes.find(
    (n) => n.field?.id === fieldId
  );
  if (existing?.date) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  execFileSync(
    "gh",
    [
      "api", "graphql",
      "-f", `query=${UPDATE_DATE_MUTATION}`,
      "-f", `projectId=${projectId}`,
      "-f", `itemId=${itemId}`,
      "-f", `fieldId=${fieldId}`,
      "-f", `date=${today}`,
    ],
    { encoding: "utf-8" }
  );
}

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

  if (cfg.startDateFieldId !== undefined) {
    setProjectStartDateIfUnset(itemId, cfg.startDateFieldId, cfg.projectId);
  }
}
