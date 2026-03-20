# /root:docs — Documentation Management

Manage and analyze documentation across the full indexed corpus (everything in `root.config.json` → `ingest.include`).

Parse the first word of the argument to determine the action. Default to `health` if no argument.

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
```

Keep it scannable. Only list individual files in the "Needs Attention" section if there are fewer than 5 problems. Otherwise, summarize counts and point to the detailed commands.

## `search <topic>`

Semantic search across the RAG database.

1. Use `mcp__plugin_root_local_rag__query_documents` with a query formulated from the topic
   - Include topic keywords plus contextual terms
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

## `gaps`

Find undocumented systems.

1. Read `root.config.json` → `project.docsDir` for where docs live
2. Scan source directories in `ingest.include` for structural patterns:
   - Look for directories under `src/services/`, `src/routes/`, `apps/*/src/`, `packages/*/src/`
   - For each, check if a corresponding doc exists in `docsDir`
3. Group by severity:
   - **HIGH**: services/routes with API endpoints but no doc
   - **MEDIUM**: internal services without docs
   - **LOW**: utilities, helpers
4. Suggest doc titles and paths for each gap

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
