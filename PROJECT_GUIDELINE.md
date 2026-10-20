# Anago Harness: Project Guideline (fork of deepseek-harness)

- Upstream: `deepseek-ai/deepseek-harness`, design baseline HEAD `687f282` (committed 2026-10-17 16:22 JST). File paths and line numbers below refer to that commit.
- Fork repository: `sotola122/anago-harness` (proposed).
- Revision: 2026-10-20 14:00 JST. Distribution is the desktop installers plus the CLI `ash` built from source. Desktop auto-update is parked in the appendix. Japanese support means replacing fonts.
- The sketches and prototypes referenced here (`fork-sketches/`, `guard/`, `ci/`, `upstream-hooks/`) are in the design bundle that comes with this guideline.

## 1. Scope

Distribution: **desktop installers** (Windows NSIS, macOS dmg, published on GitHub Releases) and the **CLI `ash` built from source** (CLI plus local Web UI: clone `sotola122/anago-harness`, build it with the fork's install script, and place the command in a user bin directory).

1. **Stop traffic the harness starts on its own**: account and login, telemetry, session-log upload, plugin-inventory upload, product analytics, the npmmirror fallback and ping, DeepSeek update checks and the mandatory-update policy, the DeepSeek search API, the Feishu contact form, and the built-in DeepSeek default model.
2. **Rename**: Anago Harness. CLI command `ash`. Home directory `~/.anago-harness`.
3. **Japanese fonts**: use fonts suited to Japanese in the Web UI, the desktop windows and dialogs, and the installer.
4. **Make Exa the default web search, and let a settings card store its API key.**
5. **Distribution**: pushing a tag publishes the installers to GitHub Releases. The CLI is built from source and installed with the install scripts (`scripts/fork/install-ash.sh` and `.ps1`).
6. **Keep upstream conflicts minimal**: implement everything with fork-only files and a small, fixed set of hook points.

## 2. Mechanism (three layers)

1. **Remove features (primary means)**: in the Cordis lock layer, set the target packages to `disabled: true` **by package name** (so they stay off whatever row id includes them). In addition, `pnpm-workspace.yaml` overrides replace them with empty stubs, so their real code never reaches the artifacts.
2. **Runtime guard (safety net)**: in the Host Node process (the CLI and the Web UI server), the Electron main process, and every renderer, refuse DNS resolution, TCP/TLS connections, and proxy CONNECT requests to the hosts in §3.
3. **CI**: on every upstream sync, compare the URL hosts hardcoded in shipped sources against a baseline. Fail on new ones so they get reviewed (`ci/scan-egress.mjs`).

```
[Electron main]  apps/desktop/src/fork/ (imported by one line at the top of main.ts)
   ├─ Node-level guard
   ├─ Chromium --host-resolver-rules (§3 hosts -> ~NOTFOUND)
   ├─ webRequest.onBeforeRequest on every session (including sessions added later via session-created)
   ├─ Rename (About panel, product name inside desktop strings)
   └─ Inject Japanese fonts into the desktop dialogs
[Host Node]  packages/boot/app-boot/src/profile-context.ts (+3 lines), shared by the CLI, the Web UI and the desktop backend
   ├─ import '@anago-harness/fork-policy' -> installs the guard before the first plugin mounts
   ├─ forkDefaultPatches(bundle) … right after the bundle layers
   └─ forkLockPatches(composed)   … final layer (cannot be overridden afterwards)
[Build]  overrides swap in empty stubs / builder wrapper (name, update disabling, fonts) / the install script builds the CLI and places the `ash` shim
[CI]     static scan + runtime e2e (under a recording DNS and proxy, assert zero connections reach §3 hosts) + upstream sync
```

Cordis patch behavior (verified in `vendor/include/src/index.ts:104-123`): a non-insert patch **assigns each given field wholesale** to the row whose `id` matches (`config` is replaced, not merged). The default layer is generated only for rows that actually exist in the bundle.

## 3. Guard denylist (`guard/denylist.json`)

| Category | Entry | Hardcoded in (upstream) |
|---|---|---|
| Account platform | `platform.deepseek.com` (this host only) | `credentials/deepseek-account-platform/src/index.ts` |
| DeepSeek update delivery | `download.deepseek.com`, `download-test.deepseek.com` (these hosts only) | `apps/desktop/scripts/desktop-auto-update-environment.mjs:29`, `installed-update-cos.ts` |
| Telemetry | `deepseeksvc.com` (including subdomains) | `dsh-otel-collector.deepseeksvc.com` (`bundle/base/cordis.patch.yml:225`, `host/product-telemetry-otel/src/index.ts`) |
| DeepSeek npm registry | `harnessment.com` | `registry.npm.harnessment.com` (`scripts/publish-npm-baseline.ts`) |
| npmmirror | `npmmirror.com` | `plugin-manager/src/registry.ts:17`, `ui-plugin-manager/src/index.ts:62` |
| HF mirror | `hf-mirror.com` | `experimental/speech-to-text-sensevoice/src/config.ts:64` |
| Feishu contact | `trtgsjkv6r.feishu.cn` (this host only) | `ui-settings-account/src/contact-config.ts:17` |

- `cdn.deepseek.com` appears only in images in upstream's README.zh.md and is not used by the harness itself, so it is not listed.
- **The guard does not block `api.deepseek.com`.** Its built-in uses (`llm-deepseek*`, `deepseek-account-platform`, `web-search-deepseek`, `web-deepseek-api`) disappear with the feature removal in §6.1 (lock + stubs). CI detects any newly added built-in reference (§7 (a)).
- Tencent COS used for update delivery: the client only talks to `download.deepseek.com`. Bucket names are not hardcoded; upstream's CI upload scripts take them from environment variables (`*_COS_BUCKET` in `desktop-auto-update-environment.mjs`). The fork does not use those scripts.
- Matching normalizes host names to ASCII first. `hosts` match exactly; `suffixes` match the domain and its subdomains. There is no environment variable that disables the guard.
- Prototype verification: all 20 checks in `guard/test-guard.mjs` pass.
  - Refused: `platform.`, `download.`, `download-test.deepseek.com`, otel, npmmirror, harnessment, hf-mirror, Feishu.
  - Allowed: `api.deepseek.com` (the verdict was checked, and a real connection returned HTTP 401), and other API hosts.
  - `test-proxy.mjs`: through a proxy, `platform.deepseek.com` is still refused and `api.deepseek.com` passes CONNECT.
- Static gate baseline (at 687f282): 107 (file, host) pairs in shipped sources, 15 of them matching the denylist.

## 4. New files (fork-only)

| Path | Content | Size |
|---|---|---|
| `packages/fork/fork-policy/` (`@anago-harness/fork-policy`) | Guard, denylist, default/lock layers, `REMOVED_PACKAGES` | ~300 lines + tests |
| `packages/fork/fork-default-model/` | Picks a usable model automatically, in place of the DeepSeek default model | ~60 lines |
| `packages/fork/removed-stub/<name>/` ×15 | Empty stubs for the removed packages | ~10 lines each |
| `packages/fork/client-ui-brand/` | Sidebar and hero logo and name | ~80 lines + SVG |
| `packages/fork/client-fonts-ja/` | Japanese fonts and CSS (for the Web UI) | ~40 lines + fonts |
| `packages/fork/web-search-exa-credential/` | Exa search provider (key read from `ctx.credentials`) | ~70 lines + tests |
| `packages/fork/client-ui-settings-web-search-exa/` | Exa settings card (Plugins page) | ~300 lines + tests |
| `apps/desktop/src/fork/` (`egress-guard-main.ts`, `branding.ts`, `fonts.ts`) | Electron-side guard, rename, dialog fonts | ~150 lines |
| `apps/desktop/scripts/fork/` (`branding.mjs`, `installer-fork.nsh`, `strings-fork.nsh`), `apps/desktop/fork-brand/` | Builder wrapper, installer product name and font, icons | ~150 lines + images |
| `apps/desktop/cli/fork/ash`, `ash.cmd` | CLI launcher bundled with the desktop app | ~15 lines each |
| `apps/cli/fork/ash.mjs` | Entry point of `ash` (default `DSH_HOME`, guard import, `runCli()` call) | ~15 lines |
| `scripts/fork/install-ash.sh`, `install-ash.ps1` | Build from source and place the `ash` shim in a user bin directory | ~50 + ~40 lines |
| `ci/fork/*`, `.github/workflows/fork-sync.yml`, `fork-install.yml`, `anago-release.yml` | Static gate, artifact checks, e2e, sync, install verification, release | ~450 lines |

## 5. Upstream files to change

| # | File | Change | Size |
|---|---|---|---|
| 1 | `packages/boot/app-boot/src/profile-context.ts` | Guard import, default layer, lock layer | +3 |
| 2 | `packages/boot/app-boot/package.json` | Dependency on `@anago-harness/fork-policy` | +1 |
| 3 | `apps/desktop/src/main.ts` | Fork module import at the top; do not start `accountBackend.watch` (around line 463); URL scheme (1235, 1238); hide the "Check for Updates" menu item (962) | +1 / ~4 |
| 4 | `apps/desktop/src/welcome-backend.ts:117` | `loggedIn: false` when there is no account service | ~1 |
| 5 | `apps/desktop/src/welcome-api.ts:74` | Do not show the welcome screen for DeepSeek login / API key | ~1 |
| 6 | `apps/desktop/electron-builder.config.mjs` | `applyForkBranding(createElectronBuilderConfig(forkBuildEnvironment()))` | +1 / ~1 |
| 7 | `overrides:` in `pnpm-workspace.yaml` | Point the 15 removed packages at empty stubs | +15 |
| 8 | `apps/desktop/scripts/package-target.ts:404,518`, `package-macos.ts:81,113`, `smoke-packaged-runtime.ts:16,18` | Use constants for the `.app` name and artifact names | ~6 |
| 9 | `apps/desktop/scripts/prepare-cli.ts:12`, `src/command-manager-entry.ts:18`, `src/command-management.ts:58`, `scripts/command-path.ps1:61,99` | Command name `dsh` -> `ash` | ~5 |
| 10 | `apps/cli/src/args.ts:153` | Program name shown in help -> `ash` | ~1 |
| 11 | `apps/desktop/installer/theme.nsh:17` | `!define INSTALLER_FONT` -> `!define /ifndef` (so the fork can set a Japanese font) | ~1 |
| 12 | `packages/client/ui-sidebar-terminal/src/client/terminal.tsx:169` | `TERMINAL_FONT_STACK` reads the CSS variable `--dsh-font-family-terminal-default` first | ~1 |
| Optional | `web-search-exa/src/provider.ts:31`, `web-search-perplexity/src/provider.ts:34` | Change the fixed User-Agent | ~2 |

**12 required changes, about 42 lines.** Each is a single line or a few lines, so conflicts are easy to resolve. Upstream defaults and tests stay unchanged. Fork behavior is verified by fork-only tests; upstream tests that assume the removed packages are excluded through an exclusion list in the fork's vitest config.

## 6. Design per item

### 6.1 Stop traffic the harness starts on its own

| Feature | Target (row / package) | Method |
|---|---|---|
| Account and login | `deepseek-account-platform` (base:121), `llm-deepseek-account` (base:529), `ui-settings-account` (web-app:145), `api-account-controller` (web-app:148) | Lock + stub. The desktop welcome screen is suppressed by #4 and #5. `accountBackend.watch` is not started (#3). The renderer's `DeepSeekOnboardingDialog` closes itself when its rows are absent (`ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx:69-83`). The desktop main `platform-view.ts` never runs because its caller UI (`preload-app.ts:90`) is gone, and the guard refuses its destination |
| Telemetry and product analytics | `session-telemetry-otel` (base:219), `host-product-telemetry-otel` (web-app:46), `client-product-analytics` (web-app:58) | Lock + stub. The desktop main sends nothing because of `analyticsEnabled().catch(() => false)` (main.ts:459) |
| Session-log upload | `session-log-deepseek` (base:44) | Lock + stub |
| Plugin-inventory upload | `plugin-package-inventory-deepseek` (base:86) | Lock + stub |
| DeepSeek default model and extensions | `llm-deepseek-api-key` (base:526), `deepseek-llm-api-extensions` (base:38), `ui-deepseek-model-label-1017` (web-app:416), default `deepseek-official/deepseek-flash` (base:90-94), ACP defaults (acp-app:19-20) | Lock + stub. The default layer sets `agent-default-model` to a placeholder, and the `fork-default-model` plugin picks a usable model (the first in `llm.listProviders()` order, re-evaluated on the `llm/adapters-updated` event). ACP gets `config: {}` so it follows the default model (provider/model are optional, `acp/src/index.ts:74-90`) |
| DeepSeek search API | `web-search-deepseek` (base:473), `web-deepseek-api` (base:478), `ui-settings-web-search` (web-app:447) | Lock + stub (nothing imports them by value). The replacement default is **Exa**: insert the fork's `@anago-harness/web-search-exa-credential` as the `web-search-exa` row and set `searchProvider: exa`. The key is stored from the settings card (§6.5). Perplexity ships as a disabled row |
| npmmirror | `fallbackRegistries` default `[NPMMIRROR_REGISTRY]` (`plugin-manager/src/index.ts:217`), ping (`ui-plugin-manager/src/index.ts:62`) | Default layer sets `[]`; lock layer sets `registryProbeEnabled: false` (key at `ui-plugin-manager/src/index.ts:17`) |
| Feishu contact | `contactFormUrl` in `ui-settings-account` (`contact-config.ts:17`) | Removed together with the account feature |
| Brand | `ui-brand-official` (web-app:337) | Lock + stub. Replaced by the fork's brand plugin |
| DeepSeek auto-update and mandatory-update policy | Update feed (`download.deepseek.com`), policy API | Not configured (§6.6). The host is also on the guard denylist |
| HF mirror | Default source of `speech-to-text-sensevoice` | Not part of any bundle. On the guard denylist as a precaution |
| Self-description | "powered by DeepSeek Harness" in `system-prompt` (`core/system-prompt/src/index.ts:453`) | Default layer sets `includeHarnessIdentity: false` and an Anago Harness `personaPrefix` |
| fetch User-Agent | `web-fetch-http` default (`index.ts:23`) | Default layer sets `anago-harness/<ver>` |

### 6.2 Update checks in the CLI and Web UI (findings)
- The upstream CLI (`apps/cli/src/*`) has no network access: no self-update, no version check, nothing like `update-notifier`.
- The `simple-update-notifier` dependency (`pnpm-lock.yaml`) belongs to electron-builder (build time only) and does not ship.
- Three update-related behaviors exist, and none of them talks to a DeepSeek update server:
  - The `ui-plugin-manager` registry ping (`ui-plugin-manager/src/index.ts:62`; registry.npmjs.org and registry.npmmirror.com): the lock layer sets `registryProbeEnabled: false` (§6.1).
  - The "update available" tag in the plugin manager (`PluginManagerPage.tsx:526-531`): compares against the bundled versions, no network.
  - `pnpm view` (`plugin-manager/src/operations.ts:626`): runs only when the user inspects a plugin spec.
- The Web UI's "the service version changed" notice (`ui-settings-general/src/client/locales.ts:88`) detects a change of the local host version, with no network.
- **The CLI is updated with `git pull` and a rerun of the install script** (§6.7).

### 6.3 Rename: Anago Harness
BRAND_GUIDELINES.md requirements: do not use "DeepSeek Harness" in the name. Do not use official brand material in a way that suggests endorsement. State the relationship factually, e.g. "built on DeepSeek Harness" (the short form DSH is encouraged). -> The README says "an unofficial fork based on DeepSeek Harness (MIT)" and keeps the copyright notice in LICENSE.

| Item | Method | Upstream edit |
|---|---|---|
| productName (.app/.exe name, Electron `app.name`, userData) | Builder wrapper sets `Anago Harness` | #6 |
| appId | Build-time environment variable `DSH_DESKTOP_APP_ID` (`io.github.sotola122.anago-harness`) | None |
| Artifact name | `anago-harness-${version}-${os}-${arch}` | #8 |
| URL scheme | `anago` | #3 |
| Installer product name | The fork include defines `INSTALLER_STRINGS_FILE` before `installer.nsh:12` (`!define /ifndef INSTALLER_STRINGS_FILE`) and points it at a strings file whose product name is Anago Harness | None |
| Window title (desktop and Web UI) | Build without a profile and pass `DSH_CLIENT_TITLE='Anago Harness'` (`scripts/client-build-environment.ts:188`, `ui-layout/src/client/AppFrame.tsx:233`) | None |
| Product name in menus, dialogs, tray | At startup the fork's `branding.ts` replaces "DeepSeek Harness" in the `en` and `zh` strings exported by `apps/desktop/src/locale.ts` (`:3`, `:174`). The About panel goes through a wrapped `setAboutPanelOptions` | None |
| Logo (Web UI) | Register the fork's brand plugin in the `sidebar.brand.mark`, `sidebar.brand.name` and `conversation.hero.brand.mark` slots | None |
| Icons, installer images, favicon | Reference the fork's assets. Files that are overwritten (`installer/assets/*`, `apps/web/public/*`) get `merge=ours` in `.git/info/attributes` via the sync job | None |
| Brand font Montserrat (OFL) | Keep as is | None |
| Home directory | Default `DSH_HOME` to `~/.anago-harness` (set by `apps/cli/fork/ash.mjs` for the CLI and by a fork hook for the desktop; `util/home-paths/src/index.ts:12` stays unchanged) | None |
| Desktop userData | Becomes `…/Anago Harness` from productName | None |
| Docs | Fork-only `README.anago.md` (ja/en). All command examples use `ash` | None |

**CLI command `ash`**:
- Install from source: a fork-only shim and `apps/cli/fork/ash.mjs` provide the `ash` command (§6.7). The `bin` entry (`dsh`) in `apps/cli/package.json` stays unchanged; nothing is published, so the package.json bin name is unused. Internal binName values that affect config file compatibility (such as `loadLayeredEnv('dsh')`) stay `dsh`. Only the name shown in help becomes `ash` (#10).
- CLI bundled with the desktop app:
  - macOS: `/usr/local/bin/ash` -> `Contents/Resources/runtime/cli/bin/ash`.
  - Windows: add `runtime\cli\bin` to the user PATH and place `ash.cmd` there.
  - The launcher itself is a fork-only file (upstream's `apps/desktop/cli/dsh` and `dsh.cmd` hardcode the executable path `DeepSeek Harness`, so the fork provides launchers that point at `Anago Harness`). Name references are #9.
- Shell completion: upstream has none. Not added.
- **Name collision**: BusyBox-based systems such as Alpine Linux have `/bin/ash` (the BusyBox shell). Installers and docs follow these rules:
  - Never write to `/bin` or `/usr/bin`. The install script defaults to `~/.local/bin` (Windows: `%LOCALAPPDATA%\Programs\anago-harness\bin`) and refuses `/bin`, `/usr/bin`, `/sbin` and `/usr/sbin` even when given explicitly. It warns when another `ash` comes earlier on PATH. The macOS desktop app uses `/usr/local/bin/ash`.
  - The install script stops without overwriting when the target already holds an `ash` that is not the fork's shim. In the desktop app, an existing `ash` at the target is handled by upstream's command installer (it asks for confirmation, moves the existing file to `.dsh-command-backup-*`, and restores it on uninstall; `command-installation.ts:95-142`), and the confirmation text states that the existing command will be replaced.
  - Scripts that use an absolute path such as `#!/bin/ash` keep using `/bin/ash` directly and are unaffected.
- **Environment variable prefix**: **keep `DSH_`**. Reason: upstream non-test code uses 137 distinct `DSH_*` variables across 159 files, and the scrubbing done before handing the environment to child processes assumes `DSH_` (`subprocess/src/index.ts:66-70`). Introducing `ASH_` would need a change at every read site or an alias mechanism, and would double the names. The brand guidelines also encourage DSH.

### 6.4 Japanese fonts

| Role | Value |
|---|---|
| UI text `--dsh-font-family-text-default` | `'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', Meiryo, 'Helvetica Neue', Arial, sans-serif` |
| Code `--dsh-font-family-code-default` | `'IntoneMono Nerd Font', 'UDEV Gothic', 'Noto Sans Mono CJK JP', ui-monospace, Menlo, Consolas, monospace` |
| Terminal `--dsh-font-family-terminal-default` | Same as code (xterm reads this variable after #12) |

- **Web UI (shared by the CLI and the desktop app)**: insert the fork's client plugin `@anago-harness/client-fonts-ja` into the web-app bundle. It ships the font files, and its CSS uses `:root:root` to replace upstream's Chinese-first defaults in `base.css:7-13`. Fonts chosen by the user still take precedence (`base.css:26-31`).
  - The desktop main window shows this Web UI. The Windows title-bar menu also inherits the Web UI's `--dsw-font-family` (`preload-menu.ts:18`).
- **Desktop dialogs**: About and confirmation dialogs are rendered by the HTML page `update-dialog.html` (`main.ts:375-391`), whose CSS names `"Microsoft YaHei"` (`renderer/update-dialog.css:3`).
  - The fork's `fonts.ts` calls `insertCSS` with a Japanese font stylesheet on the desktop's HTML pages, from `web-contents-created` -> `dom-ready`. No upstream edit.
  - The builder wrapper ships Noto Sans JP next to the renderer pages (`renderer/fonts/`) so it loads within the CSP (`default-src 'self'`, `update-dialog.html:6`). If it does not load, the OS Japanese fonts (Hiragino Sans, Yu Gothic UI) are used. Confirm in the PoC.
  - Native menus, the tray and OS standard dialogs are drawn with the OS system font.
- **Installer (NSIS)**: the fork's `installer-fork.nsh` defines `!define INSTALLER_FONT "Yu Gothic UI"` and then includes upstream's `installer.nsh` (#11). It uses the standard Windows Japanese UI font (Noto Sans JP is not installed on Windows by default). The dmg has no text or font settings.
- **Glyph selection**: Noto Sans JP and UDEV Gothic are Japanese-only fonts (not Pan-CJK), so Han characters render with Japanese glyph shapes whatever `<html lang>` is. `lang` is therefore left unchanged.
- UDEV Gothic is limited by `unicode-range` to kana, kanji and full-width forms, so Latin characters render in Intel One Mono. xterm treats full-width characters as two cells. Confirm in the PoC that xterm re-measures its cell size after the fonts finish loading.
- All fonts are SIL OFL 1.1; ship each OFL.txt. Noto Sans JP ships as the variable woff2 split by `unicode-range` so only the needed ranges load. Measure sizes during implementation.
- Sketches: `fork-sketches/fonts-ja.sketch.ts`, `fork-sketches/fonts.sketch.css`, `fork-sketches/desktop-fonts.sketch.ts`

### 6.5 Exa settings card
- **Key storage**: use the same credentials mechanism as upstream's provider API keys.
  - Settings hold only the reference name (`EXA_API_KEY`). `ctx.credentials` stores the value in `$DSH_HOME/.credentials.yaml` (mode 600, `credentials-local/src/index.ts:703`).
  - Precedence: stored value > process environment > `.env`.
  - The browser uses `remote.credentials.describe/set/unset` (`api/settings-controller/src/credentials.ts:100-117`). The value is never read back.
- **Host side `@anago-harness/web-search-exa-credential`**: upstream's `web-search-exa` reads only `config.apiKey` or the launch environment (`web-search-exa/src/index.ts:58-63`). Stored credentials are not exported into the environment (`credentials-local/src/index.ts:29-35`), so a key saved from a card would never reach upstream's Exa plugin.
  - The fork therefore ships a plugin that registers under the same provider id `exa`. On every search it gets the key with `ctx.credentials.resolve('EXA_API_KEY')` and delegates to the `ExaSearchProvider` that upstream exports (the same approach as `web-deepseek-api/src/transport.ts:85-91`).
  - A changed key applies from the next search. The `EXA_API_KEY` environment variable keeps working.
- **Client side `@anago-harness/client-ui-settings-web-search-exa`**: same structure as upstream's web search card (`ui-settings-web-search/src/client/index.ts:44-67`).
  - Uses: the `plugins.item` slot, `configForms.whileServed(['web-search-exa'])`, `SettingsForm` / `SettingsSecretField` / `SettingsValueField` / `Switch`, and the `credentials/reference-updated` event.
  - Fields:
    - "Use Exa for web search" (`web.searchProvider = 'exa'`)
    - API key (shows whether it is set, allows removal, points to dashboard.exa.ai to get one)
    - Search type (auto/keyword/neural)
    - Result count (optional)
  - Dictionaries: en and zh, like upstream's card.
- **Upstream edits: none.** The rows are inserted by the fork-policy default layer.
- Sketches: `fork-sketches/web-search-exa-credential.sketch.ts`, `fork-sketches/ui-settings-web-search-exa.sketch.tsx`

### 6.6 Desktop build and release
- Fork builds always use upstream's `package:desktop:<target>:unsigned`. Windows builds are unsigned; macOS builds are ad-hoc signed (`electron-builder-config.mjs:165`).
  - The release notes describe the first launch (Windows SmartScreen: "More info" -> "Run anyway"; macOS 15 and later: System Settings > Privacy & Security > "Open Anyway").
- **Keep DeepSeek update checks and the mandatory-update policy from running** (no extra upstream edit):
  - For unsigned builds upstream sets no update feed (`:98` -> `publish: null` at `:264`). No `app-update.yml` is produced, so the updater stays disabled (`update-coordinator.ts:55` disables it without `app-update.yml`). The builder wrapper also sets `publish = null` explicitly.
  - Upstream still puts the mandatory-update policy into the manifest for unsigned Windows builds (`:68`, `:112`) and requires an HTTPS origin at build time (`desktop-policy-environment.mjs:4-11`). So `forkBuildEnvironment()` (#6) passes the unresolvable placeholder `https://policy.invalid`, and the builder wrapper deletes `extraMetadata.dshMandatoryUpdatePolicy`. Without a policy in the manifest the app never fetches one (`main.ts:1293-1297`, `mandatory-update-policy.ts:57`).
  - The "Check for Updates" menu item is hidden (#3).
  - CI (`ci/fork/check-no-update.mjs`) confirms that the packaged app has no `app-update.yml` and that the manifest has no `dshMandatoryUpdatePolicy`. `download.deepseek.com` is also on the guard denylist.
- **Release workflow `anago-release.yml`** (triggered by `v*.*.*` tags; upstream's workflows target DeepSeek's self-hosted runners and are disabled in the GitHub settings):
  - `win-x64` (windows-2025) and `mac` (arm64: macos-15, x64: an Intel runner) build the installers and confirm that updates are disabled.
  - `github-release`: checks the artifacts (§7 (b)), then publishes the exe and dmg files to GitHub Releases.
- Linux: upstream's packaging scripts have no Linux desktop target (`package-target.ts:62-83`). On Linux, use the CLI built from source.
- Sketches: `fork-sketches/anago-release.workflow.sketch.yml`, `fork-sketches/electron-builder.fork.sketch.mjs`

### 6.7 Installing the CLI `ash` from source
- **Upstream support**:
  - Upstream README "Run from source" (`README.md:29-40`): `pnpm install` -> `pnpm run build` -> `pnpm dsh web`. `pnpm dsh` runs `node --import tsx/esm apps/cli/src/bin.ts` (`package.json:207`).
  - The built CLI is `apps/cli/lib/bin.js` (tsdown builds `apps/cli`, `tsdown.config.ts:26`).
  - Node `^22.19.0 || >=24.0.0` (`package.json:8-10`); pnpm via `packageManager: pnpm@11.28.5` (`package.json:7`).
  - The fork's script uses the built `lib/bin.js` (what `docs/testing.md:41` calls the real entry path).
- **Steps** (documented in README.anago.md):

```sh
git clone https://github.com/sotola122/anago-harness.git
cd anago-harness
./scripts/fork/install-ash.sh            # Windows: pwsh -File scripts\fork\install-ash.ps1
ash web                                  # starts the Web UI at http://127.0.0.1:3080

# Upgrade
git pull --ff-only && ./scripts/fork/install-ash.sh
```

- **What `install-ash.sh` / `install-ash.ps1` do**:
  1. Check the Node version. pnpm comes through corepack at the `packageManager` version.
  2. `pnpm install --frozen-lockfile` -> `DSH_CLIENT_TITLE='Anago Harness' pnpm run build` (`--fast` uses `build:artifacts`). Confirm that `apps/cli/lib/bin.js` exists.
  3. Place a shim in the user bin directory.
     - POSIX: `~/.local/bin/ash` (change with `--bin-dir`). Content: `exec node <repo>/apps/cli/fork/ash.mjs "$@"`.
     - Windows: `%LOCALAPPDATA%\Programs\anago-harness\bin\ash.cmd`, with that directory added to the user PATH.
     - The shim carries a marker comment; an existing `ash` without the marker is never overwritten.
  4. Run `ash --version` to confirm.
- **`apps/cli/fork/ash.mjs`**:
  - Sets `DSH_HOME` to `~/.anago-harness` when it is not set (upstream default `~/.dsh`, `util/home-paths/src/index.ts:12,18`).
  - Imports fork-policy so the guard is active before any other module loads.
  - Calls `runCli()` from `apps/cli/lib/bin.js`. `bin.js` starts itself only under `import.meta.main` (`apps/cli/src/bin.ts:76-78`), so an importer must call it explicitly.
- **How the guard becomes active**: shim -> `ash.mjs` (imports fork-policy) -> `lib/bin.js` -> `@deepseek-ai/dsh-app-boot`. The app-boot index re-exports `profile-context.ts` (`app-boot/src/index.ts:20`), so fork-policy is loaded in every CLI mode (profile, plugin, dump-config). Profile boot goes through `readProfilePatches` (`apps/cli/src/profile-boot.ts:323`), which applies the default and lock layers.
- **The `ash` bin name needs no upstream edit.** The shim and `ash.mjs` are fork-only files. Only the help display name is #10 (one line).
- **Package names**: keep upstream package names (`@deepseek-ai/*`) unchanged. Fork-only packages are named `@anago-harness/*`.
  - Reason: nothing is published, so there is no need to change namespaces. Renaming upstream packages would make every import and the lockfile a conflict source. Fork-only packages live in new directories, so their names never conflict. `@anago-harness/*` also stays clear of names upstream may add later and follows the brand guidelines.
  - `packages/fork/<name>` falls under the existing workspace glob `packages/*/*` (`pnpm-workspace.yaml:3`, `workspaces` in `package.json`) and the tsdown targets (`tsdown.config.ts:24`), so no upstream edit is needed to register them. The empty stubs (`packages/fork/removed-stub/<name>`) are referenced by `link:` overrides and can sit outside the glob.
- **CI**: `fork-install.yml` runs the install script on ubuntu, macOS and Windows, then checks the `ash --help` display name and an e2e run (start `ash web`, zero connections to §3 hosts).
- Sketches: `fork-sketches/install-ash.sketch.sh`, `fork-sketches/install-ash.sketch.ps1`, `fork-sketches/ash.sketch.mjs`, `fork-sketches/fork-install-ci.sketch.yml`

## 7. Upstream sync workflow
1. Add an `upstream` remote. Weekly, `fork-sync.yml` merges `upstream/main` into a `sync/<date>` branch.
2. On conflicts, list them in the PR. Only the lines in §5 can conflict. Binary assets resolve automatically through `merge=ours`.
3. Gates:
   - (a) `ci/scan-egress.mjs`: newly added hardcoded hosts fail for review. A reference to `*.deepseek.com` outside the removed packages and two reviewed files always fails, even if it is in the baseline (`BUILTIN-DEEPSEEK`). The two reviewed files are the pi-ai provider catalog `llm-pi-ai/src/provider-data.generated.ts` and the Base URL input placeholder in the provider editor, `ui-settings-models/src/client/locales.ts:57` (used at `ProviderEditor.tsx:476-477`). Neither makes a connection.
   - (b) Packages in `REMOVED_PACKAGES` do not appear in the artifacts (asar, dist) in any form other than the stubs.
   - (c) Runtime e2e: drive the CLI and Web UI (`ash` started through the shim, chat, search, fetch, plugin manager) and the desktop app (launch, menus, dialogs), and assert zero connections reach §3 hosts.
   - (d) Desktop artifacts contain no `app-update.yml` and no `dshMandatoryUpdatePolicy`.
   - (e) Fork tests, plus upstream tests with the exclusion list applied.
   - (f) Install from source (`fork-install.yml`).
4. Disable upstream's `.github/workflows/*` in the GitHub settings; do not edit those files.

## 8. Effort estimate (one engineer experienced with TS/Electron)
| Work | Days |
|---|---|
| fork-policy (guard, denylist, default/lock, tests) | 1.5 |
| Electron-side guard + checking the welcome/account changes | 1 |
| Feature removal (stubs, overrides, test exclusion list, artifact checks) | 2 |
| fork-default-model and ACP defaults | 1 |
| Exa as default search + settings card | 1.5 |
| Rename (builder wrapper, brand plugin, assets, desktop strings, CLI `ash`, launchers, DSH_HOME) | 3 |
| Japanese fonts (Web UI plugin, font subsetting, xterm, desktop dialogs, NSIS, OFL) | 1.5 |
| Disabling and verifying desktop update checks | 0.5 |
| Desktop release workflow (GitHub Releases) | 1 |
| Install from source (install-ash.sh/.ps1, `ash.mjs`, CI on three OSes) | 1 |
| CI (static scan, artifact checks, runtime e2e, sync job) | 2 |
| **Total** | **about 16 person-days** |
| Ongoing sync cost | 0.5–2 hours per sync |

## 9. Open decisions
1. GitHub repository: `sotola122/anago-harness` is proposed (as of 2026-10-20 the GitHub user `sotola122` exists and the repository `anago-harness` does not). This fixes the appId, the clone URL and the README links.

---

## Appendix TBD: Desktop auto-update

Auto-update, the mandatory-update policy, update notifications and the code signing they depend on are undecided. Material already studied (sketches in `fork-sketches/tbd-desktop-auto-update/`):

- **Free code signing (as of 2026-10-20)**
  - macOS: not possible. Developer ID requires the Apple Developer Program (USD 99/year); fee waivers are only for nonprofit, educational and government legal entities. Squirrel.Mac cannot update an ad-hoc signed app, so silent updates are not possible.
  - Windows: possibly through SignPath Foundation's free signing for OSS (application-based; for a fork, all changes including upstream's must be reviewed). Even unsigned, electron-updater can update with `verifyUpdateCodeSignature: false`. Azure Artifact Signing (from USD 9.99/month; individuals only in the US and Canada) and OV certificates (USD 150–300/year) are paid.
- **Feed option**: GitHub Releases `releases/latest/download/` through the generic provider. The builder wrapper sets `publish` and the `latest` channel, so no upstream edit is needed.
- **macOS notification option**: periodically check `anago-release.json` and open the dmg download page from a dialog. No silent install.
- **Mandatory-update policy option**: a fork request function evaluates a static JSON on GitHub Pages (`minimumVersion`) on the client side and converts the result into upstream's response format (one line at `main.ts:1318`).
- Sources:
  - Apple: https://developer.apple.com/programs/enroll/ , https://developer.apple.com/support/fee-waiver
  - Electron: https://github.com/electron/electron/blob/main/docs/api/auto-updater.md , https://electronjs.org/docs/latest/tutorial/code-signing
  - electron-builder: https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md , https://github.com/electron-userland/electron-builder/issues/2786
  - SignPath: https://signpath.org/terms.html
  - Microsoft: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options , https://learn.microsoft.com/en-us/azure/artifact-signing/faq
