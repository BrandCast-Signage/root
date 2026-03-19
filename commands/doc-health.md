# /root:doc-health — Documentation Health Analyzer

Read `root.config.json` → `project.docsDir` to determine the docs directory. All paths below are relative to that.

## Modes

### `/root:doc-health` or `/root:doc-health overview`

Full health dashboard:

1. **Count by category**: Glob `<docsDir>/<dir>/**/*.md` for each subdirectory. Report counts.

2. **Count by status**: Grep all docs for `status:` frontmatter. Aggregate counts for: active, draft, completed, superseded, archived.

3. **Staleness summary**: For living docs, parse `updated:` dates. Report:
   - Current (< 3 months): count
   - Aging (3-6 months): count + list
   - Stale (> 6 months): count + list

4. **Frontmatter completeness**: Count docs missing required fields (title, type, status, created, updated).

Output as a formatted markdown table/report.

### `/root:doc-health stale`

Deep staleness analysis:

1. Glob `<docsDir>/**/*.md`
2. For each file with `status: active`:
   - Parse `updated:` from frontmatter
   - Run `git log -1 --format='%as' -- <file>` to get actual last commit date
   - Compare: if git date is newer than frontmatter date, note "frontmatter stale"
   - Flag any doc not modified in 6+ months
3. Sort by staleness (oldest first)
4. Output: table with columns: File, Frontmatter Updated, Git Last Modified, Days Since Update, Status

### `/root:doc-health gaps`

Documentation gap analysis:

1. Scan the project for undocumented systems — look for source directories (services, routes, packages) that lack corresponding docs in `<docsDir>`
2. Report undocumented areas with severity (production-critical = HIGH)
3. Suggest doc titles and locations

### `/root:doc-health validate`

Frontmatter schema validation:

1. Glob all `<docsDir>/**/*.md` (excluding README.md files)
2. For each file, read first 15 lines and parse YAML frontmatter
3. Validate:
   - Has opening and closing `---` delimiters
   - Has `title:` (non-empty string)
   - Has `status:` with valid value: draft, active, completed, superseded, archived
   - Has `created:` in YYYY-MM-DD format
   - Has `updated:` in YYYY-MM-DD format
   - `updated` >= `created`
   - No future dates
4. Output: list of validation failures grouped by error type, with file paths
