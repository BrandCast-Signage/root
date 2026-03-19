---
name: doc-health
description: "Analyze documentation health: freshness, gaps, frontmatter validity. Use to audit docs or find stale content. Examples: /doc-health overview, /doc-health stale, /doc-health gaps"
user-invocable: true
argument: mode - optional mode (default: overview). Options: overview, stale, gaps, validate
---

# /doc-health — Documentation Health Analyzer

## Modes

### `/doc-health` or `/doc-health overview`

Full health dashboard:

1. **Count by category**: Glob `docs/dev/<dir>/**/*.md` for each directory (architecture, app, guides, prds, plans, specs, research, strategy, operational). Report counts.

2. **Count by status**: Grep all docs for `status:` frontmatter. Aggregate counts for: active, draft, completed, superseded, archived.

3. **Count by type**: Grep all docs for `type:` frontmatter. Aggregate.

4. **Staleness summary**: For `docs/dev/app/**/*.md` (living docs only), parse `updated:` dates. Report:
   - Current (< 3 months): count
   - Aging (3-6 months): count + list
   - Stale (> 6 months): count + list

5. **Frontmatter completeness**: Count docs missing required fields (title, type, status, created, updated).

6. **Known gaps**: Read the Known Documentation Gaps table from `docs/dev/README.md` and list them.

Output as a formatted markdown table/report.

### `/doc-health stale`

Deep staleness analysis for living docs:

1. Glob `docs/dev/app/**/*.md`
2. For each file with `status: active`:
   - Parse `updated:` from frontmatter
   - Run `git log -1 --format='%as' -- <file>` to get actual last commit date
   - Compare: if git date is newer than frontmatter date, note "frontmatter stale"
   - Flag any doc not modified in 6+ months
3. Sort by staleness (oldest first)
4. Output: table with columns: File, Frontmatter Updated, Git Last Modified, Days Since Update, Status

### `/doc-health gaps`

Documentation gap analysis:

1. Read Known Documentation Gaps from `docs/dev/README.md`
2. For each gap, verify the code location still exists:
   - Glob/Grep for the service/route mentioned
   - If code was deleted, mark gap as "resolved (code removed)"
   - If code exists, confirm gap is still valid
3. **Discover NEW gaps**:
   - List all directories in `apps/backend/src/services/`
   - For each service directory, search `docs/dev/app/` for a matching doc
   - Report services without corresponding documentation
4. Repeat for `apps/backend/src/routes/` — check for undocumented API route modules
5. Output: updated gap list with severity (production-critical services without docs = HIGH)

### `/doc-health validate`

Frontmatter schema validation:

1. Glob all `docs/dev/**/*.md` (excluding README.md files)
2. For each file, read first 15 lines and parse YAML frontmatter
3. Validate:
   - Has opening and closing `---` delimiters
   - Has `title:` (non-empty string)
   - Has `type:` with valid value: adr, prd, plan, spec, research, guide, app-doc, report, strategy
   - Has `status:` with valid value: draft, active, completed, superseded, archived
   - Has `created:` in YYYY-MM-DD format
   - Has `updated:` in YYYY-MM-DD format
   - `updated` >= `created` (not updated before creation)
   - No future dates (created/updated not after today)
4. Output: list of validation failures grouped by error type, with file paths
