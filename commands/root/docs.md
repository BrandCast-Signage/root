# /root:docs — Documentation Management

Manage and analyze documentation across the full indexed corpus (everything in `root.config.json` → `ingest.include`).

Parse the first word of the argument to determine the action. Default to `health` if no argument.

## Shared Setup

Subcommands that query the RAG database use these variables. Set them first:

```bash
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
```

## `health` (default)

Summary dashboard across the full corpus. Lead with headlines, not lists.

1. Read `root.config.json` → `ingest.include` to identify all doc directories
2. Use Glob to find all `.md` files across those directories (respecting exclude patterns)
3. For each file, check:
   - Has frontmatter (opens with `---`)
   - Has required fields: title, type, status, created, updated
   - Parse `updated:` date for freshness
4. Compute and output a summary:

```
## Docs Health — <project name>

<total> docs across <n> directories
Frontmatter: <complete>/<total> complete (<pct>%)
Freshness: <current> current, <aging> aging (3-6mo), <stale> stale (6mo+)
Missing frontmatter: <count> files

### By Directory
| Directory | Docs | Frontmatter | Current | Aging | Stale |
|-----------|------|-------------|---------|-------|-------|
| docs/dev  | 319  | 100%        | 308     | 11    | 0     |
| apps/     | 142  | 69%         | 140     | 2     | 0     |
| ...       |      |             |         |       |       |

### Needs Attention
- <n> aging docs (run `/root:docs stale`)
- <n> docs without frontmatter (run `/root:docs fix`)
- <n> frontmatter validation errors (run `/root:docs validate`)
- <n> undocumented components (run `/root:docs scan`)
```

Keep it scannable. Only list individual files in the "Needs Attention" section if there are fewer than 5 problems. Otherwise, summarize counts and point to the detailed commands.

## `search <topic>`

Semantic search across the RAG database.

1. Run the shared setup, then query:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<topic keywords plus contextual terms>"
   ```
   - Use `limit: 10`
2. Filter by score: use < 0.3 directly, consider 0.3-0.5, skip > 0.5
3. Read the top 1-3 most relevant unique documents
4. For each doc, report:
   - **Path**: relative to repo root
   - **Title**: from frontmatter or first heading
   - **Relevance**: score and match reason
   - **Freshness**: warn if > 3 months old
5. If no results score below 0.5, report it as a documentation gap

## `stale`

Find outdated documentation, grouped by severity.

1. Find all `.md` files across `ingest.include` directories
2. For each file with an `updated:` date in frontmatter:
   - Calculate days since update
   - Also check `git log -1 --format='%as' -- <file>` for actual last modification
   - If git date is newer than frontmatter date, flag as "frontmatter out of date"
3. Group by band:
   - **Stale (6+ months)**: list all with paths and dates
   - **Aging (3-6 months)**: list all with paths and dates
   - **Frontmatter out of date**: list files where git is newer than frontmatter `updated:`
4. Output as grouped sections, sorted oldest first within each group

## `scan`

Discover undocumented code components, triage interactively, and generate docs. This is the primary onboarding command for projects with incomplete documentation.

### Phase 1: Discovery

Identify code components that should have documentation but don't.

1. Read `root.config.json` → `project.docsDir` for where docs live
2. **If `docTargets` exists in config**, use it for discovery:
   ```json
   "docTargets": [
     { "glob": "packages/*/src/index.ts", "type": "package", "docsDir": "docs/packages" },
     { "glob": "apps/*/src/services/*.ts", "type": "service", "docsDir": "docs/services" }
   ]
   ```
   For each target, Glob for matching files, then check if a corresponding doc exists in the target's `docsDir`.

3. **If no `docTargets`**, use heuristics across `ingest.include` source directories:
   - Directories containing `package.json` → type: `package`
   - Files exporting route handlers (`router.`, `app.get/post/put/delete`, `express.Router()`) → type: `api`
   - Files with class definitions or 5+ named exports → type: `service`
   - Directories matching common patterns:
     - `services/`, `middleware/` → type: `service`
     - `routes/`, `api/` → type: `api`
     - `lib/`, `utils/`, `helpers/` → type: `module`
   - For each discovered component, check if a doc with a matching name exists anywhere under `docsDir`

4. Filter out components that already have corresponding docs

### Phase 2: Triage

Present discovered gaps interactively.

1. Group by priority:
   - **HIGH**: Has public API surface (route handlers, exported interfaces, package entry points) but no doc
   - **MEDIUM**: Internal service/module without doc
   - **LOW**: Utility/helper without doc
2. Output a summary:
   ```
   ## Documentation Scan — <project name>

   Found <n> undocumented components:
     HIGH:   <n> (public APIs, packages)
     MEDIUM: <n> (internal services)
     LOW:    <n> (utilities, helpers)
   ```
3. Present via AskUserQuestion with multiSelect — show each component with its type, source path, and suggested doc path. Pre-select HIGH priority items.
4. For each selected item, confirm the doc path (under `project.docsDir`) and type

### Phase 3: Create

Generate docs for each selected component.

1. Read the source code for the component (entry file + key exports)
2. Generate frontmatter:
   ```yaml
   ---
   title: <component name, human-readable>
   type: <from discovery phase>
   status: draft
   created: <today YYYY-MM-DD>
   updated: <today YYYY-MM-DD>
   ---
   ```
3. Write first-draft content based on what the code actually does:
   - **For packages**: purpose, main exports, dependencies, usage examples
   - **For APIs/routes**: endpoints, request/response shapes, auth requirements
   - **For services**: responsibility, public methods, dependencies, side effects
   - **For modules/utils**: exported functions, parameters, return types
4. Write each file using the Edit tool
5. Report summary:
   ```
   Created <n> docs:
     docs/services/auth-service.md (service, draft)
     docs/packages/shared-types.md (package, draft)
     ...

   Run `/root:docs health` to see updated coverage.
   ```

## `create <path-or-topic>`

Create a single doc outside the scan flow.

1. Determine what to document:
   - If argument is a **source file path** (e.g., `src/services/auth.ts`) → read the file, generate doc for it
   - If argument is a **doc path** (e.g., `docs/auth-service.md`) → scaffold at that location, search for related source via Glob
   - If argument is a **topic string** (e.g., `authentication`) → Glob for related source files, read the most relevant ones
2. Determine doc type from the target path (same rules as `fix`):
   - `plans/` → `plan`, `prds/` → `prd`, `architecture/` or `ADR-` → `adr`
   - `guides/` → `guide`, `specs/` → `spec`, `research/` → `research`
   - default → `doc`
3. If type is `plan` or `prd`, check for a template in `<plansDir>/TEMPLATE.md` or `<prdsDir>/TEMPLATE.md` and use its structure
4. Generate frontmatter:
   ```yaml
   ---
   title: <inferred from source or topic>
   type: <from step 2>
   status: draft
   created: <today YYYY-MM-DD>
   updated: <today YYYY-MM-DD>
   ---
   ```
5. Read source code and write first-draft content with real descriptions of what the code does
6. Write the file, report the path

## `validate`

Frontmatter schema validation.

1. Find all `.md` files across `ingest.include` (excluding README.md)
2. For each, read first 20 lines and check:
   - Has `---` delimiters
   - Has `title:` (non-empty)
   - Has `status:` with valid value: draft, active, completed, superseded, archived
   - Has `created:` in YYYY-MM-DD format
   - Has `updated:` in YYYY-MM-DD format
   - `updated` >= `created`
   - No future dates
3. Group failures by error type:
   ```
   Frontmatter Validation:

   Missing frontmatter entirely: 58 files
     Top directories: apps/ (32), packages/ (18), docs/dev/plans/ (8)

   Missing required fields:
     title: 3 files
     status: 5 files
     updated: 2 files

   Invalid values:
     Future dates: 1 file (docs/dev/app/FOO.md: updated: 2026-12-01)
     updated < created: 0 files
   ```

## `fix [path]`

Auto-fix or add frontmatter to docs that lack it.

If `path` is provided, fix only that file or directory. Otherwise, scan all `ingest.include` directories.

1. Find all `.md` files missing frontmatter (no `---` opener) or with incomplete frontmatter
2. For each file:
   - **title**: extract from first `# Heading` in the file
   - **type**: infer from path:
     - `plans/` → `plan`
     - `prds/` → `prd`
     - `architecture/` or `ADR-` → `adr`
     - `guides/` → `guide`
     - `specs/` → `spec`
     - `research/` → `research`
     - default → `doc`
   - **status**: if content contains `TODO`, `WIP`, `DRAFT` → `draft`, otherwise `active`
   - **created**: `git log --follow --diff-filter=A --format='%as' -- <file> | tail -1`
   - **updated**: `git log -1 --format='%as' -- <file>`
3. Show a summary of proposed changes:
   ```
   Frontmatter Fix Preview:

   58 files to update:
     32 in apps/ (adding full frontmatter)
     18 in packages/ (adding full frontmatter)
     8 in docs/dev/plans/ (adding missing updated: field)

   Example (apps/backend/README.md):
     + title: Backend API
     + type: doc
     + status: active
     + created: 2025-08-15
     + updated: 2026-03-10
   ```
4. Use AskUserQuestion to confirm: "Apply these changes?" with options for All, Preview more, or Cancel
5. On confirmation, write the frontmatter to each file using the Edit tool
