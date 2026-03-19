# /root:ingest — RAG Embedding Management

Manage the RAG database that powers doc-aware context in Root.

Parse the argument to determine the action. Default to `ingest` if no argument.

## `ingest` (default)

Ingest docs into the RAG database based on `root.config.json`.

1. Read `root.config.json` → `ingest.include`, `ingest.exclude`, `ingest.extensions`
2. If no config exists, tell the user to run `/root:init` first and stop
3. Use Bash to call the mcp-local-rag CLI for each include directory:
   ```bash
   RAG_BIN="${HOME}/.claude/plugins/data/root/node_modules/.bin/mcp-local-rag"
   $RAG_BIN ingest --db-path .claude/rag-db --cache-dir "${HOME}/.cache/mcp-local-rag/models" <directory>
   ```
4. Report results:
   > Ingested **234 files** into RAG.

## `status`

Show the current state of the RAG database.

1. Call `mcp__plugin_root_local-rag__status` to get document count, chunk count, memory usage
2. Call `mcp__plugin_root_local-rag__list_files` to show what's indexed
3. Output a summary:
   ```
   RAG Status:
     Documents: 486
     Chunks: 19,041
     Search mode: hybrid (vector + keyword)
     DB path: .claude/rag-db/
   ```

## `refresh`

Clear all embeddings and re-ingest everything. Use after major documentation changes.

1. Call `mcp__plugin_root_local-rag__list_files` to get all indexed files
2. Call `mcp__plugin_root_local-rag__delete_file` for each file
3. Run the `ingest` action to re-ingest from config
4. Report:
   > Cleared **486 documents**. Re-ingested **490 files**.

## `clear`

Delete all embeddings. Wipe the database.

1. Call `mcp__plugin_root_local-rag__list_files` to get all indexed files
2. Call `mcp__plugin_root_local-rag__delete_file` for each file
3. Report:
   > Cleared **486 documents** from RAG. Database is empty.
   > Run `/root:ingest` to re-populate.
