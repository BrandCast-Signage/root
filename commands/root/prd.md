# /root:prd — Guided PRD Authoring

Create, edit, or review Product Requirements Documents through a code-informed interview process.

Parse the first word of the argument to determine the action. Default to `new` if no argument.

## Shared Setup

```bash
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
```

## `new [topic-or-issue]` (default)

Guided PRD creation through code-informed requirements elicitation.

### Phase 1: Context Gathering

Before asking the user anything, understand the codebase context.

1. Read `root.config.json` → `project.prdsDir` for where PRDs live. Default to `docs/prds`.
2. If an **issue number** is provided (e.g., `#1234`, `issue 1234`):
   ```bash
   gh issue view <number> --json number,title,body,labels,state,assignees
   ```
   Extract the problem description, requirements hints, and scope signals from the issue body.
3. **Query the RAG database** for relevant existing documentation:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<topic or issue title>"
   ```
   Read the top 1-3 relevant docs for technical context.
4. **Scan the codebase** for relevant source code:
   - Use Glob to find files related to the topic (by name, directory, or keyword)
   - Read key files to understand: existing architecture, current implementation (if any), integration points, data models, API surfaces
5. **Check for existing PRDs** in `<prdsDir>` that relate to this topic. If found, ask:
   > "Found existing PRD: `<path>`. Do you want to build on this, or start fresh?"

### Phase 2: Interview

Walk the user through each PRD section with targeted questions. Use the codebase context from Phase 1 to ask informed questions and pre-fill where possible.

**Important**: Ask questions in batches of 2-3 using AskUserQuestion, not one at a time. Each batch covers a logical group of sections. Offer concrete suggestions based on what you learned from the code.

#### Batch 1: Problem & Solution

Ask:
1. **Problem Statement** — "What problem are you solving? Who's affected?"
   - If you found relevant code or an issue, pre-fill a suggested problem statement and ask the user to confirm or revise
2. **Proposed Solution** — "At a high level, how should this work?"
   - If existing patterns in the codebase suggest an approach, mention them: "The codebase currently handles X with Y pattern. Should this follow the same approach?"

#### Batch 2: Scope

Ask:
1. **Goals** — "What are the concrete outcomes? What does success look like?"
2. **Non-Goals** — "What is explicitly out of scope?"
   - Suggest non-goals based on adjacent systems you found in the code: "Should we exclude changes to X? It's related but would expand scope."

#### Batch 3: Requirements

This is the most important section. Requirements drive the entire downstream process.

Ask:
1. **Must Have (P0)** — "What absolutely must ship? These block the release."
   - If an issue has a checklist or acceptance criteria, extract them as P0 candidates
   - Each requirement gets a REQ ID: REQ-001, REQ-002, etc.
2. **Should Have (P1)** — "What's important but could ship in a fast-follow?"
3. **Nice to Have (P2)** — "What would be ideal but isn't essential?"

Present requirements back to the user for confirmation. Each must be:
- Specific and testable (not vague)
- Scoped to a single concern
- Traceable (will map to files in the Implementation Plan)

#### Batch 4: Technical & Risk

Ask:
1. **Technical Considerations** — "Any architecture constraints, performance needs, or security requirements?"
   - Pre-fill with what you found: "This touches the auth middleware and the session store. The current auth flow uses X. Any constraints on changing that?"
   - Flag integration points discovered during code scanning
2. **Risks** — "What could go wrong? Breaking changes? Data migration?"
   - Suggest risks based on code analysis: "This modifies a shared type used by N consumers — that's a breaking change risk."

#### Batch 5: UX & Metrics

Ask:
1. **User Experience** — "What are the key user flows? Any UI changes?"
   - Skip or simplify for backend-only changes
2. **Success Metrics** — "How will you measure success?"
   - Suggest concrete metrics where possible: "Reduced error rate on X endpoint? Faster response time?"

### Phase 3: Write

1. Generate the PRD using the template at `<prdsDir>/TEMPLATE.md`:
   - Fill in all sections from the interview answers
   - Add frontmatter: title, status=draft, type=prd, created=today, updated=today
   - Use REQ IDs consistently (REQ-001, REQ-002, etc.)
   - Include technical context discovered during Phase 1 in the Technical Considerations section
2. Write to `<prdsDir>/<slug>.md` where slug is derived from the topic/issue title
3. Ingest into RAG:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <prd-path>
   ```
4. Output:
   ```
   PRD written to <prdsDir>/<slug>.md (draft)
   Added to RAG database.

   Requirements: <n> P0, <n> P1, <n> P2
   Open questions: <n>

   Next: Review with `/root:prd review <slug>`, then run `/root <task>` to generate the Implementation Plan.
   ```

### Phase 4: Open Questions

If any open questions were identified during the interview (user said "not sure", "TBD", or you identified gaps):
1. List them in Section 9 of the PRD
2. Output them prominently:
   ```
   ⚠️  <n> open questions must be resolved before implementation:
   1. [Question]
   2. [Question]
   ```
   Open questions block implementation. The root skill will refuse to generate an Implementation Plan if the PRD has unresolved open questions.

## `edit <path-or-slug>`

Re-open an existing PRD for revision.

1. Find the PRD:
   - If a full path, read it directly
   - If a slug, look in `<prdsDir>/<slug>.md`
2. Read the current PRD content
3. Ask the user what they want to change using AskUserQuestion:
   - Options: "Update requirements", "Refine scope", "Add technical context", "Resolve open questions", "Full re-interview"
4. For the selected sections, re-run the relevant interview batch from `new`, pre-filled with current PRD content
5. Update the PRD file using the Edit tool
6. Update `updated:` date in frontmatter
7. Re-ingest into RAG:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <prd-path>
   ```

## `review <path-or-slug>`

Quality review of a PRD against best practices.

1. Find and read the PRD
2. Check against industry best practices:
   - **Completeness**: All 9 sections present and non-empty?
   - **Requirement quality**: Each P0 requirement is specific, testable, and single-concern?
   - **Scope clarity**: Goals and non-goals are explicit? No ambiguous boundaries?
   - **Risk coverage**: Identified risks for breaking changes, data migration, security, performance?
   - **Traceability**: REQ IDs are sequential and consistent?
   - **Open questions**: Any unresolved? Any that should be added?
3. Score the PRD:
   ```
   PRD Review — <title>

   Completeness:   ██████████ 100% (all sections)
   Requirement quality: ████████░░ 80% (REQ-003 is vague)
   Scope clarity:  ██████████ 100%
   Risk coverage:  ██████░░░░ 60% (no security risks identified)
   Open questions: ⚠️  2 unresolved

   Issues:
   - REQ-003 "Handle edge cases" — too vague, needs specific scenarios
   - No security considerations for the new API endpoint
   - Open question #1 blocks P0 requirements

   Ready for implementation: NO (resolve issues first)
   ```
4. If issues found, offer to fix them: "Want to address these now?" → runs `edit` flow for affected sections

## `list`

List all PRDs in the project.

1. Read `root.config.json` → `project.prdsDir`
2. Glob for all `.md` files in that directory (excluding TEMPLATE.md)
3. For each, read frontmatter and extract title, status, created, updated
4. Output as a table:
   ```
   PRDs in <prdsDir>/:

   | File | Title | Status | Requirements | Updated |
   |------|-------|--------|-------------|---------|
   | auth-refresh.md | Auth Token Refresh | active | 5 P0, 3 P1 | 2026-03-15 |
   | weather-api.md | Weather Integration | draft | 3 P0, 2 P1 | 2026-03-20 |
   ```
