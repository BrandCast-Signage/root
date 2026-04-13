# Scion Integration — Setup & Patch Notes

**Audience:** Root framework developers working on the Root 3.0 Scion-execution substrate.

**Scope:** Captures every manual step, patch, and workaround applied to get [Scion](https://github.com/GoogleCloudPlatform/scion) running locally with Claude Max / Gemini Code Assist OAuth subscriptions instead of the default Vertex AI routing. Reproduce from scratch on a fresh macOS (Apple Silicon) + Docker Desktop machine by following this doc in order.

**Status:** Spike-quality. All patches are local to this machine / grove. None have been pushed upstream or committed to a consumer repo's git tree. Each patch in here has a corresponding "Upstream Feedback" note at the bottom.

---

## Prereqs

- Docker Desktop running
- Go toolchain (for `scion` CLI installation)
- Scion CLI installed: `go install github.com/GoogleCloudPlatform/scion/cmd/scion@latest`
- macOS `security` CLI (built in) — used for Keychain extraction
- `jq`, Python 3.x (standard on macOS)
- Active **Claude Max** subscription signed into Claude Code on the host (`~/Library/Keychains/login.keychain-db` entry `Claude Code-credentials`)
- Active **Gemini Code Assist** subscription signed in via Gemini CLI on the host (`~/.gemini/oauth_creds.json`)

---

## Step 1: Build Scion images locally (patched build script)

Scion's default build script creates a `docker-container` buildx builder for multi-platform support. For a local, single-arch workflow that doesn't require a registry, the `docker-container` driver fights us: intermediate image layers loaded with `--load` can't be resolved by a subsequent `FROM` in the same build chain unless they're pushed to a registry. Using the default docker-driver builder sidesteps this entirely.

```bash
git clone https://github.com/GoogleCloudPlatform/scion.git ~/Code/scion
cd ~/Code/scion
git checkout -b root/local-docker-driver
```

Patch `image-build/scripts/build-images.sh`:

```diff
-# Ensure buildx builder exists
-ensure_builder() {
-  if ! docker buildx inspect scion-builder &>/dev/null; then
-    echo "Creating buildx builder 'scion-builder'..."
-    docker buildx create --name scion-builder --use
-  else
-    docker buildx use scion-builder
-  fi
-  docker buildx inspect --bootstrap >/dev/null
-}
+# Patched for local-only single-arch builds: use the active docker-driver
+# builder instead of creating a docker-container builder. This lets subsequent
+# stages reference locally-loaded images via FROM without needing a registry.
+ensure_builder() {
+  docker buildx use desktop-linux 2>/dev/null || docker buildx use default
+}
```

Commit to the local branch (we don't push upstream; this is a per-machine convenience):

```bash
git commit -am "build: use active docker-driver buildx builder for local builds"
```

Build all six images (core-base, scion-base, four harnesses):

```bash
bash image-build/scripts/build-images.sh --registry scion-local --target all
```

Expected outcome: `docker images | grep scion-local` shows `core-base`, `scion-base`, `scion-claude`, `scion-codex`, `scion-gemini`, `scion-opencode`, each tagged `latest` and sized 3.7–4.4 GB.

---

## Step 2: Initialize the global Scion grove

```bash
scion init --global
```

Edit `~/.scion/settings.yaml`:

1. Point every harness image at `scion-local/` instead of the GCP public registry:

   ```bash
   sed -i.bak 's|us-central1-docker.pkg.dev/ptone-misc/public-docker/|scion-local/|g' ~/.scion/settings.yaml
   ```

2. Switch the local profile runtime from `container` (Apple's macOS-native container CLI) to `docker` (Docker Desktop, which is what we actually have):

   ```bash
   sed -i.bak2 's|runtime: container  # Auto-adjusted by OS|runtime: docker|' ~/.scion/settings.yaml
   ```

---

## Step 3: Seed host OAuth credentials into the global template

Scion's claude harness only natively resolves two auth methods: `ANTHROPIC_API_KEY` (direct) or Vertex AI via gcloud ADC. The Claude Max OAuth token isn't a supported path. Workaround: seed the OAuth token into the template's `~/.claude/.credentials.json` so that Claude Code inside the container picks it up at startup.

On macOS, the Claude OAuth token lives in Keychain (`Claude Code-credentials`), not in a file. We extract and merge it into a `.credentials.json` that also carries MCP OAuth state from `~/.claude/.credentials.json`.

```bash
umask 077
security find-generic-password -s "Claude Code-credentials" -w | \
  jq -s '.[0] + .[1]' ~/.claude/.credentials.json - > \
  ~/.scion/templates/claude/home/.claude/.credentials.json
chmod 600 ~/.scion/templates/claude/home/.claude/.credentials.json
```

Verify the merge:

```bash
python3 -c "import json; print(sorted(json.load(open('/Users/jduncan/.scion/templates/claude/home/.claude/.credentials.json')).keys()))"
# Expected: ['claudeAiOauth', 'mcpOAuth']
```

For Gemini: see the Gemini section below. The flow is simpler because Scion's gemini harness *does* support OAuth natively — we just have to undo an opinionated template default.

---

## Step 4: Strip the Vertex routing block from the template

The stock Scion claude template seeds `~/.claude/settings.json` inside each agent with a hardcoded `env` block that forces Vertex AI routing through the Scion team's internal `duet01` GCP project. This silently defeats our `.credentials.json` OAuth token even when it's present — Claude Code reads settings.json, sets `CLAUDE_CODE_USE_VERTEX=1` internally, and chooses the third-party provider path.

Remove the `env` block from the global template:

```bash
python3 -c "
import json
path = '/Users/jduncan/.scion/templates/claude/home/.claude/settings.json'
with open(path) as f: d = json.load(f)
d.pop('env', None)
with open(path, 'w') as f: json.dump(d, f, indent=2)
"
```

Keep everything else (hooks, permissions, autoUpdater, telemetry). The removed keys were: `CLAUDE_CODE_USE_VERTEX`, `CLOUD_ML_REGION`, `ANTHROPIC_VERTEX_PROJECT_ID`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`.

---

## Step 4b: Gemini harness (Gemini Code Assist / CLI OAuth)

The Gemini harness has better auth bones than Claude's: `pkg/harness/gemini_cli.go:393-431` has a first-class OAuth path that auto-detects `~/.gemini/oauth_creds.json` on the host and bind-mounts it into the container (at `~/.gemini/oauth_creds.json` again). Scion even sets the right env var (`GEMINI_DEFAULT_AUTH_TYPE=oauth-personal`) automatically.

**The only problem:** the stock gemini template ships with an explicit `security.auth.selectedType: "gemini-api-key"` in `~/.gemini/settings.json`. When the container starts, Gemini CLI reads that settings file first and commits to the API-key path before any OAuth creds are consulted. Without a `GEMINI_API_KEY` env var set, it would silently ask for one or fail.

**Fix:** flip the selectedType to `oauth-personal` in the template:

```bash
python3 -c "
import json
p = '/Users/jduncan/.scion/templates/gemini/home/.gemini/settings.json'
with open(p) as f: d = json.load(f)
d.setdefault('security', {}).setdefault('auth', {})['selectedType'] = 'oauth-personal'
with open(p, 'w') as f: json.dump(d, f, indent=2)
"
```

Also seed the OAuth creds file into the template (redundant with Scion's own bind-mount during auth propagation, but makes `--no-auth` work too and is robust against template-path drift):

```bash
cp -p ~/.gemini/oauth_creds.json ~/.scion/templates/gemini/home/.gemini/oauth_creds.json
```

After this, gemini agents work both with Scion's native auth propagation AND with `--no-auth`:

```bash
scion start <agent> "<prompt>" -t gemini -y           # uses Scion's propagation
scion start <agent> "<prompt>" -t gemini --no-auth -y # uses the template's seeded creds
```

Expected first-launch UX: a "Do you trust the files in this folder?" prompt (send `1` + Enter to choose "Trust folder (workspace)"). That's a per-grove Gemini CLI one-time security check, not an auth issue.

---

## Step 5: Per-grove setup (e.g., brandcast)

When you run `scion init` inside a repo, it copies the **global** template into the grove at `.scion/templates/<harness>/`. That grove-local copy takes precedence over the global template. If you seeded credentials into the global template *before* running `scion init` in the repo, you're fine — they copy through. If you seeded afterward, you need to repeat the fixes at the grove level:

```bash
cd ~/Code/<project>
scion init

# Mirror the credential merge into the grove template
cp -p ~/.scion/templates/claude/home/.claude/.credentials.json \
      .scion/templates/claude/home/.claude/.credentials.json

# Mirror the settings.json env strip
python3 -c "
import json
path = '.scion/templates/claude/home/.claude/settings.json'
with open(path) as f: d = json.load(f)
d.pop('env', None)
with open(path, 'w') as f: json.dump(d, f, indent=2)
"

# Grove settings.yaml needs the same image-prefix and runtime swaps
sed -i.bak 's|us-central1-docker.pkg.dev/ptone-misc/public-docker/|scion-local/|g; s|runtime: container|runtime: docker|' .scion/settings.yaml

# Per Scion's README: gitignore the agent worktrees
printf '\n# Scion — agent worktrees are nested, must not be tracked\n.scion/agents/\n' >> .gitignore

# Gemini: mirror the Step 4b fixes into the grove template
python3 -c "
import json
p = '.scion/templates/gemini/home/.gemini/settings.json'
with open(p) as f: d = json.load(f)
d.setdefault('security', {}).setdefault('auth', {})['selectedType'] = 'oauth-personal'
with open(p, 'w') as f: json.dump(d, f, indent=2)
"
cp -p ~/.gemini/oauth_creds.json .scion/templates/gemini/home/.gemini/oauth_creds.json
```

---

## Step 6: Start agents with `--no-auth`

Scion's default auth propagation will **still** detect gcloud ADC on the host and add `CLAUDE_CODE_USE_VERTEX=1` at container start — independent of the template settings.json — if `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_REGION`, and an ADC file are all present (see `pkg/harness/auth.go:55-104` and `pkg/harness/claude_code.go:355-374`). To force OAuth, skip the propagation:

```bash
cd ~/Code/<project>
scion start <agent-name> "<prompt>" -t claude --no-auth -y
```

Verify it worked:

```bash
docker exec -u scion <agent-name> claude auth status
# Expected:
# {
#   "loggedIn": true,
#   "authMethod": "claude.ai",
#   "apiProvider": "firstParty",
#   "email": "...",
#   "subscriptionType": "max"
# }
```

If you see `"authMethod": "third_party"` / `"apiProvider": "vertex"`, one of Steps 3–5 was incomplete, or `--no-auth` was omitted.

---

## Upstream Feedback (open when ready)

Three issues worth filing against GoogleCloudPlatform/scion:

1. **Add OAuth auth path for claude harness.** `pkg/harness/claude_code.go` only resolves `ANTHROPIC_API_KEY` or Vertex. Add a third path that propagates macOS Keychain `Claude Code-credentials` (or Linux equivalents) into the container's `~/.claude/.credentials.json`. Gate behind an explicit auth method so GCP users still get Vertex by default.

2. **Move team-internal config out of the default templates.**
   - claude template's `settings.json` env block (`CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID=duet01`, model strings with `@` version suffixes) is clearly "ships for the Scion team's internal GCP setup." For external users this silently breaks with opaque `invalid_rapt` errors.
   - gemini template's `settings.json` hardcodes `security.auth.selectedType: "gemini-api-key"`, which prevents auto-detection from picking the OAuth path that's already first-class in `pkg/harness/gemini_cli.go`.
   - Suggest moving both into a `team/google` template overlay or similar, leaving default templates empty so auto-detection works for external users.

3. **Expose the `docker` buildx driver as a `build-images.sh` flag.** Rather than requiring a local patch, add `--driver docker` (mutually exclusive with `--platform`) for single-arch local builds. Would have saved the diagnostic detour.

---

## Known Consumer-Side Issue: brandcast `.claude/` hook paths

brandcast's `.claude/settings.json` references hooks by host-absolute paths (e.g., `/Users/jduncan/Code/brandcast/.claude/hooks/check-test-coverage.sh`). Those paths don't resolve inside the Scion container, where the worktree is mounted at `/repo-root/.scion/agents/<name>/workspace`. The hook failures are non-blocking (they just clutter output), but it's real portability debt for any containerized Claude run — Scion or otherwise. Fix is to use `$CLAUDE_PROJECT_DIR`-relative paths in brandcast's hook config. Tracked as a brandcast issue, not a Scion one.

---

## Quick Re-seed Script

**Run this at the start of every Scion session.** OAuth tokens rotate within hours (not days as initially assumed) — confirmed during the first real-issue test, where a token seeded ~2 hours earlier returned `401 Invalid authentication credentials`. Scion templates and live agents don't hot-reload credentials; you must re-seed and restart any running agents.

```bash
umask 077
security find-generic-password -s "Claude Code-credentials" -w | \
  jq -s '.[0] + .[1]' ~/.claude/.credentials.json - > \
  ~/.scion/templates/claude/home/.claude/.credentials.json
chmod 600 ~/.scion/templates/claude/home/.claude/.credentials.json

# And for each grove using claude:
for grove in ~/Code/brandcast; do  # extend as groves appear
  cp -p ~/.scion/templates/claude/home/.claude/.credentials.json \
        $grove/.scion/templates/claude/home/.claude/.credentials.json
done
```

Then restart any running claude agents to pick up the refreshed token.

For Gemini, the equivalent re-seed is:

```bash
cp -p ~/.gemini/oauth_creds.json ~/.scion/templates/gemini/home/.gemini/oauth_creds.json
for grove in ~/Code/brandcast; do
  cp -p ~/.gemini/oauth_creds.json $grove/.scion/templates/gemini/home/.gemini/oauth_creds.json
done
```
