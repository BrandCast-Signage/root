---
title: Upstream Scion Issue Drafts
status: draft
audience: root framework maintainers (eventual filing targets Scion maintainers)
---

# Upstream Scion Issue Drafts

Drafts of issues to be filed against [GoogleCloudPlatform/scion](https://github.com/GoogleCloudPlatform/scion). Held here until we're ready to file upstream. Each draft has GitHub-issue-shaped sections (title, context, proposal, acceptance) and cross-references the gap in `dev/scion/gaps.md` it closes.

Filing order per `gaps.md` "Recommended filing sequence."

---

## Draft #1 — Local host-path projection on the file-secrets pipeline

**Closes:** gap 10 (subsumes gap 9). **Status:** draft, not filed.

### Title

`feat(config): allow local host-path projection into file secrets without a Hub`

### Context

Scion's file-secrets pipeline already handles host-file → container-path projection end-to-end: `writeFileSecrets` at `pkg/runtime/common.go:607-682` stages files on the host, creates parent directories, and emits `host:container:ro` mount specs consumed by all three runtimes (`pkg/runtime/docker.go:53`, `podman.go:131`, `apple_container.go:53`). The `scion hub secret set --type file --target <container-path> <KEY> @<host-path>` command at `cmd/hub_secret.go:105` exercises this path today.

The only limitation: `api.RequiredSecret` (`pkg/api/types.go:472-482`) declares `{Key, Type, Target}` but not a local-host origin. Resolution of a `Key` into a `ResolvedSecret` goes through a Hub. Users running Scion locally (no Hub) have no way to ask "inject `~/.ssh/id_ed25519` at `/home/scion/.ssh/id_ed25519`" through a config-driven path — they fall back to either:

- Raw `volumes:` mounts (works but sits at a different abstraction level than other secrets)
- Hand-placing files in template `home/` directories (leaks into the grove template tree and potentially into git)
- Standing up a Hub (overkill for single-user local development)

This matters for any Scion consumer whose agents need SSH keys, gh CLI tokens, kubeconfig, cloud credentials, or database URLs to do real work.

### Proposal

Add a `HostPath` field to a local `SecretMount` type (or extend `RequiredSecret`) and resolve it to a `ResolvedSecret` on the host side before the existing Hub-resolution step runs. All downstream machinery — `writeFileSecrets`, runtime mount injection — reused unchanged.

**Shape in `settings.yaml`:**

```yaml
harness_configs:
  claude:
    secrets:
      - key: ssh_key
        type: file
        host_path: ~/.ssh/id_ed25519
        target: /home/scion/.ssh/id_ed25519
      - key: gh_hosts
        type: file
        host_path: ~/.config/gh/hosts.yml
        target: /home/scion/.config/gh/hosts.yml
      - key: kubeconfig
        type: file
        host_path: ~/.kube/config
        target: /home/scion/.kube/config
```

**Implementation sketch:**

1. Extend the struct in `pkg/config/settings_v1.go` with an optional `HostPath string` on the secrets-declaration type (either `RequiredSecret` directly or a new local-only `SecretMount` sibling to keep the Hub-facing surface clean).
2. In `pkg/agent/run.go` around line 815 (before the `m.Runtime.Run` call), walk the config's declared secrets and for each one with `HostPath` set:
   - Tilde-expand the path; resolve against the user's home
   - Read the file; base64-encode
   - Construct `api.ResolvedSecret{Type: file, Target, Value: base64(contents)}`
   - Prepend/append to `runCfg.ResolvedSecrets`
3. If both `HostPath` and Hub resolution apply to the same key, precedence is explicit-loud failure (config error) rather than silent last-wins.
4. Read-only by default (already true in `writeFileSecrets`).

**Behavior for missing host file:** fail loudly at agent start with a clear error message (`secret "ssh_key": host_path ~/.ssh/id_ed25519 not found`), not silent skip. Consistent with how auth propagation fails today when a required credential file is absent.

### Why this shape

- **Additive, not disruptive.** No existing `settings.yaml` files break; `host_path` is optional.
- **Reuses end-to-end plumbing.** `writeFileSecrets`, mount-spec generation, runtime layer — all untouched.
- **Single mechanism for all file secrets.** Covers ssh, gh, kubeconfig, aws, stripe, db URLs, the lot. No ssh-specific flags, no per-credential-type shims.
- **No Hub required.** Local-dev ergonomics improved without weakening Hub-based deployments.
- **Precedent in the codebase.** `OverlayFileSecrets` at `pkg/harness/auth.go:113-136` already does host-file-to-ResolvedSecret conversion for auth-specific paths; this generalizes that pattern.

### Acceptance

- `HostPath` field exists on the secrets-declaration type in `settings_v1.go`, documented in the schema comment
- Local host files resolve to `ResolvedSecret` entries before runtime Run, verified by a unit test in `pkg/agent/run_test.go` (or equivalent) that exercises the resolution with a tempdir-based host file
- Integration test confirms `scion start` with a `host_path`-declared secret lands the file at the target path inside a live container, readable by the container user
- Clear error on missing host file; exit code non-zero, message identifies the offending key
- Existing Hub-based secret resolution unaffected — test matrix includes both paths
- `settings.yaml` schema doc + at least one example in `docs-repo/` showing the SSH-key use case

### Out of scope

- Hot-reload of secrets into running agents (fits with gap 5's pre-start-hook primitive, not this change)
- Templated container targets (e.g., `target: /home/{{ user }}/.ssh/id_rsa`) — ship with literal paths first
- Write-mode secrets (stays read-only like `writeFileSecrets` already enforces)
- Replacement for Hub-based flows — both coexist

### Dependencies / relation to other work

- **Closes:** gap 10 in `dev/scion/gaps.md` (and supersedes gap 9's separate ssh/gh ask)
- **Related:** gap 5 (pre-start hooks for credential refresh) — orthogonal; that's about *when* credentials get freshened, this is about *how* they land in the container in the first place
- **Unrelated:** PR #66 (auth-path resolution). This change is general file projection, not auth-specific

### Open design questions (for upstream discussion)

1. New `SecretMount` type vs. `HostPath` field on existing `RequiredSecret`? Leaning toward the former — keeps the Hub-required declaration surface clean and makes the local-origin intent explicit in the config.
2. Glob support (`host_path: ~/.ssh/id_*`)? Probably not for v1 — explicit > implicit, and expansion semantics would need their own spec.
3. Environment-variable expansion in `host_path`? Tilde-only is minimal and safe for v1.

---

## Drafts pending (placeholders)

Not yet written. Filing order per `gaps.md`:

- **Draft #2** — companion to PR #66: template split (gap 3)
- **Draft #3** — `scion start --prompt-file <path>` (gap 4)
- **Draft #4** — pre-start hook primitive for credential refresh (gap 5)
- **Draft #5** — telemetry span schema documentation (gap 12)
- **Draft #6** — `build-images.sh --driver` flag (gap 7) — patch already exists on local `root/local-docker-driver` branch
- **Draft #7** — grove template refresh mechanism (gap 8)
- **Draft #8** — per-template resources config (gap 13)
