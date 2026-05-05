"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadGithubProjectConfig = loadGithubProjectConfig;
exports.setProjectStatusInProgress = setProjectStatusInProgress;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * Load `board.githubProject` from `root.config.json`. Returns `null` if the
 * file is missing, malformed, or the section / required fields are absent —
 * which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
function loadGithubProjectConfig(rootDir) {
    try {
        const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(rootDir, "root.config.json"), "utf8");
        const parsed = JSON.parse(raw);
        const cfg = parsed?.board?.githubProject;
        if (cfg === undefined ||
            typeof cfg.projectId !== "string" ||
            typeof cfg.statusFieldId !== "string" ||
            typeof cfg.statusOptions?.inProgress !== "string") {
            return null;
        }
        return {
            projectId: cfg.projectId,
            statusFieldId: cfg.statusFieldId,
            statusOptions: { inProgress: cfg.statusOptions.inProgress },
            mirrorLabel: typeof cfg.mirrorLabel === "string" ? cfg.mirrorLabel : undefined,
        };
    }
    catch {
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
function setProjectStatusInProgress(issue, cfg) {
    const issueIdRaw = (0, node_child_process_1.execSync)(`gh issue view ${issue} --json id`, { encoding: "utf-8" });
    const { id: issueNodeId } = JSON.parse(issueIdRaw);
    const addRaw = (0, node_child_process_1.execFileSync)("gh", [
        "api", "graphql",
        "-f", `query=${ADD_ITEM_MUTATION}`,
        "-f", `projectId=${cfg.projectId}`,
        "-f", `contentId=${issueNodeId}`,
    ], { encoding: "utf-8" });
    const addParsed = JSON.parse(addRaw);
    const itemId = addParsed.data.addProjectV2ItemById.item.id;
    (0, node_child_process_1.execFileSync)("gh", [
        "api", "graphql",
        "-f", `query=${UPDATE_FIELD_MUTATION}`,
        "-f", `projectId=${cfg.projectId}`,
        "-f", `itemId=${itemId}`,
        "-f", `fieldId=${cfg.statusFieldId}`,
        "-f", `optionId=${cfg.statusOptions.inProgress}`,
    ], { encoding: "utf-8" });
}
