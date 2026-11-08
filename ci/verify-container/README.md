# Containerized verification host

English | [中文](README.zh.md)

Builds this checkout into an image and serves the Web host on
`http://100.110.252.31:8083` without touching the host's Node build,
`~/.dsh`, or the live `anago-web.service` on port 3080.

The image installs and builds its own copy: `pnpm install --frozen-lockfile`
and `pnpm run build:artifacts` run inside the image, and the container's DSH
home is `/home/dsh/.dsh`.

## Prerequisites

- rootless `podman` 5.7
- an initialized `plugins` submodule (`git submodule update --init`), because the
  image copies this checkout
- host `python3` with PyYAML (only to read credential names; values are piped,
  never printed)
- `/home/hwd/.dsh/.credentials.yaml` with `OPENCODE_GO_API_KEY` and
  `COMMANDCODE_API_KEY` entries
- `/home/hwd/.claude/.credentials.json` (Claude Code's file-based login)

## Build

```sh
/data_1/git_workspace/anago-harness/ci/verify-container/run.sh
```

`run.sh` builds the image, refreshes the podman secrets, stops the old
`anago-verify-8083` unit if present, runs the container, and prints the launch
URL. Run it again after a code change: the build cache keeps `pnpm install`
and unchanged build steps warm.

Build only:

```sh
cd /data_1/git_workspace/anago-harness
podman build \
  --file ci/verify-container/Containerfile \
  --ignorefile ci/verify-container/containerignore \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD)" \
  --tag anago-verify:8083 .
```

## Run / logs / stop

```sh
ci/verify-container/run.sh           # build, run, print URL
podman logs -f anago-verify-8083     # follow the host log
ci/verify-container/run.sh stop      # remove the container
```

Run the build from an interactive shell, or from a transient systemd unit that
keeps its cgroup (`systemd-run --user --property=KillMode=none --unit=...`).
With the default `KillMode=control-group`, the unit tears down every process it
started once `run.sh` exits, and the container it started exits with status 0 a
few seconds later.

## Secrets

`run.sh` fails before starting anything when a source is missing. Values are
piped from the host credentials document into podman secrets and never printed;
no key enters the image, the build history, `Config.Env`, or this file.

| podman secret | source | delivery |
|---|---|---|
| `anago-opencode-go` | `refs.OPENCODE_GO_API_KEY` | `type=env,target=OPENCODE_GO_API_KEY` |
| `anago-commandcode` | `refs.COMMANDCODE_API_KEY` | `type=env,target=COMMANDCODE_API_KEY` |
| `anago-claude-credentials` | `/home/hwd/.claude/.credentials.json` | `type=mount,target=/home/dsh/.claude/.credentials.json` (0444) |
| `anago-dsh-credentials` | `/home/hwd/.dsh/.credentials.yaml` | `type=mount,target=/run/anago-secrets/credentials.yaml`; the entrypoint seeds a writable 0600 `/home/dsh/.dsh/.credentials.yaml` from it once |

Claude Code authenticates from that file (OAuth, `claudeAiOauth`), not from an
environment variable. Podman materializes the secret as a 0444 file at
`/home/dsh/.claude/.credentials.json`; the host file itself is copied into
podman's secret store and is never mounted or modified by the container. A
valid access token works as is; once it expires the CLI cannot refresh in
place, so refresh it on the host first (run `claude` once — a refresh rotates
the token and rewrites the host file) and then re-run `run.sh`. Do not let two
writable copies refresh the same login: that rotates the token and leaves the
other copy stale.

A sign-in inside the container (`/xai-login`, `/copilot-login`, …) writes to the
container's own credential store. That store starts as a copy of the host
document so the mounted grants are readable at boot, but the container never
writes back to the host: refresh a host grant and re-run `./run.sh` to carry it
into a fresh container. The copy includes the host's OAuth grants, so when the
container refreshes one and the issuer rotates its refresh token, the host's copy
of that login goes stale, the same hazard as the Claude login above.

## Profile

`profile/` is the profile definition, copied into the image at
`$DSH_HOME/profiles/verify` and installed there at build time:

- `package.json` — the live profile's ten-bundle list
  (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`,
  `@anago-harness/anago-core`, `@anago-harness/anago-web`,
  `@anago-harness/xai-oauth`, `@anago-harness/copilot-oauth`,
  `@anago-harness/openai-codex-oauth`, `@mars-sea/dsh-commandcode-provider`,
  `dsh-mobile-maxxing`, `@deepseek-ai/dsh-experimental-tool-worktree`).
  The workspace bundles resolve from the image's own build through the
  installation anchor, exactly as they do on the live host; the three npm
  packages are installed into the profile's `node_modules`
  (`@mars-sea/dsh-commandcode-provider@0.17.1`,
  `@deepseek-ai/dsh-experimental-tool-worktree@0.2.2-rc.1`, and
  `dsh-mobile-maxxing` 0.6.1 pinned to the commit the live host runs,
  `9703b24e7196175683c4db96263d78cbf160d880`, so a moving GitHub branch cannot
  change the verification host).
- `cordis.patch.yml` — the live `~/.dsh/profiles/web-anago/cordis.patch.yml`
  verbatim, with three container changes: `skill-filesystem.agentsHome` points
  at `/home/dsh/.agents` (created by the entrypoint), the client locale is
  pinned to `preference: en` (the image has no stored user settings), and the
  rebuilt `subagent-claude-code` / `subagent_claude_code` rows are appended with
  `permissionMode: auto` and
  `allowedPermissionModes: [dontAsk, acceptEdits, auto, plan]`.
  Model routes, purpose routes, presets, `session-log-deepseek`, and the
  `selectedDefault: orchestrator` registry setting are unchanged.
- The chat route is `commandcode` / `deepseek/deepseek-v4.1-flash` with
  `reasoningEffort: max`; the default purpose route is
  `opencode-go` / `deepseek-v4.1-flash`.
- The client locale stays `en`: the profile pins
  `@deepseek-ai/dsh-client-locale` to `preference: en` because the image carries
  no stored user settings and the live host renders English. The `anago-fonts`
  row mounts `@anago-harness/client-ui-fonts-anago`.
- The Web host binds the container interface; podman publishes it on
  `100.110.252.31:8083` (the Web host rejects a `0.0.0.0` bind).

Rebuild the image after editing anything here; the profile is image content,
not runtime state.

## Egress isolation

The fork must not reach DeepSeek or China-domain endpoints, so `run.sh` adds
`--add-host <name>:127.0.0.1` for `api.deepseek.com`, `chat.deepseek.com`,
`platform.deepseek.com`, `download.deepseek.com`, `www.deepseek.com`,
`dsh-otel-collector.deepseeksvc.com`, and `registry.npmmirror.com`. A request
to any of them fails immediately and appears in the container log instead of
silently succeeding. Drop an entry from `BLACKHOLED` in `run.sh` only when the
fork starts using that host on purpose.

## How to test

1. Open the printed URL (`http://100.110.252.31:8083/?token=...`). The bare
   URL answers `401`; the token URL answers `303` and sets the browser session.
   The interface is English; that is the live configuration.
2. Send a message in English, for example `Reply with the single word: ready`.
   The reply must be Japanese (the `response-language` system-prompt section).
3. Japanese text must render in UDEV Gothic (kanji/kana), Latin in Noto Sans
   JP, and code in Intel One Mono — the `anago-fonts` stylesheet. Inspect any
   element with the browser devtools: `font-family` resolves to
   `"UDEV Gothic", "Noto Sans JP", ...` for text and
   `"Intel One Mono", "UDEV Gothic", ...` for code.
4. No DeepSeek login: there is no account entry in Settings and no sign-in
   prompt. The DeepSeek account/telemetry/feedback rows are disabled in the
   composition.
5. Orchestrator mode: the preset picker lists `orchestrator` and starting a
   chat with it must not error. The composition selects it by default.
6. Delegate to Claude Code in a message:

   ```text
   Use subagent_claude_code with permission_mode "plan" and prompt
   "Reply with the single word: ready". Then report what it returned.
   ```

   The model calls `subagent_claude_code` with
   `{"prompt": "...", "permission_mode": "plan"}`. Allowed modes are
   `dontAsk`, `acceptEdits`, `auto`, and `plan`; the provider default is
   `auto`. Approve the tool call in the Web UI if an approval card appears.
7. Confirm the container log has no skipped bundle, no preset warning, and no
   network failure against a blackholed host:

   ```sh
   podman logs anago-verify-8083 2>&1 | grep -Ei 'skipping profile bundle|agent preset|deepseek|npmmirror|error' || echo clean
   ```
