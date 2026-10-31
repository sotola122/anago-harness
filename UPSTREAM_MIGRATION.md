# Upstream sync

This procedure merges `upstream` (`https://github.com/deepseek-ai/deepseek-harness`, default branch `master`) into this fork, and is done when `origin/master` contains that merge commit, `git diff --check` exits 0, versions match [Version](#version), and [verification](#verification) shows only the known reds (failures this tree already has). Fork code lives under `packages/fork/*`; an upstream file carries only a listed hook — keep the fork's row and take upstream around it.

## Steps

1. Weekly, fetch `upstream`. This tree has no `.github/workflows/fork-sync.yml`; merge `upstream/master`, not `upstream/main`. Add the remote when `git remote` does not list it. The previous sync is PR #7, branch `sync/upstream-2026-10-29`.

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream --tags
git merge-base --is-ancestor upstream/master master
```

Done when `git fetch upstream --tags` exits 0, and either `git merge-base --is-ancestor upstream/master master` exits 0 (stop; that week is already merged) or it exits 1 (continue).

2. Fast-forward `master` from `origin`, then cut `sync/YYYY-MM-DD` (the work date) from that `master`.

```sh
git switch master
git pull --ff-only origin master
git switch -c sync/YYYY-MM-DD
```

Done when `git branch --show-current` prints `sync/YYYY-MM-DD` and `git rev-parse HEAD` equals `git rev-parse master`.

3. Merge. Do not rebase: `master` is published on `origin` and `sotola` (both `sotola122/anago-harness`), and a rebase would force-push that history. A merge makes this `upstream/master` the next sync's merge base.

```sh
git merge upstream/master
```

`git merge --abort` returns this branch to step 2; `master` has not moved. Discard a broken `sync/` branch before it merges to `master`. When one merge is too large, pick an intermediate commit from `git log --oneline master..upstream/master`, merge that commit, land it, and continue in another `sync/` branch.

Done when either `git rev-parse -q --verify MERGE_HEAD` fails and `git log -1 --format=%P` prints two parents, or `MERGE_HEAD` exists and `git diff --name-only --diff-filter=U` is the list for step 4.

4. Resolve each conflicted path from [Reference](#reference). A test, README, `.i18n.yaml`, baseline, or subsystem type paste is resolved with its source. A binary uses the same rule as text ([Pitfalls](#pitfalls)).

Done when `git diff --check` exits 0, `git diff --name-only --diff-filter=U` is empty, every conflicted hook still has its Keep cell, every conflicted re-apply has the fork behavior on the new upstream version, every generated conflict was deleted and regenerated (list those paths), and every resurrected file in [Workflows kept deleted](#workflows-kept-deleted) is gone.

5. Align versions as in [Version](#version). `packages/preset/orchestrator-policy` is outside `packages/fork/`; include it.

Done when every `packages/fork/*/package.json` and `packages/preset/orchestrator-policy/package.json` `version` equals the root `package.json` `version`, and after `pnpm install` the lockfile importers `packages/fork/<name>:` and `packages/preset/orchestrator-policy:` still resolve with `link:`.

6. Regenerate as in [Generated](#generated). Run the command for a file that conflicted or went stale, not every generator every time. After `pnpm run gen-tsconfig-paths`, the hand-written `@anago-harness/*` aliases above `BEGIN generated package aliases` are still present.

Done when each regenerated path is listed, the command that wrote it is the one in its header or in [Generated](#generated), and `git diff --check` still exits 0.

7. When the pi-ai pin moved, rebuild the patch and move these together: the `minimumReleaseAgeExclude` entries `@earendil-works/pi-ai@<version>` and `@earendil-works/pi-telemetry@<version>`, the `patchedDependencies` key, `patches/@earendil-works__pi-ai@<version>.patch`, and `"@earendil-works/pi-ai"` in `packages/llm/llm-pi-ai/package.json`. An old patch does not apply to a new dist. Confirm `pnpm install` applies the new patch, then confirm the patch body still stops a mid-stream `block.arguments` assignment and keeps the Gemini thought signature. Then `pnpm run gen-provider-data`. When the pin is unchanged, leave the `1.4.0` patch in place.

Done when the pin, the exclude entries, the patch filename, and the package dependency name the same version, `pnpm install` exits 0, and the patch body still has both edits.

8. Run [Verification](#verification). A failure that is not a known red is a sync failure. Smoke with a throwaway `DSH_HOME` and `--port 0`. Never verify on port 3080: `anago-web.service` listens on `100.110.252.31:3080`, and a `web` launch without `--port` binds 3080 (`packages/bundle/web-app/cordis.patch.yml`, `port: !!js ctx.webStartup.port ?? 3080`). Do not launch `web-anago` ([Pitfalls](#pitfalls)).

Done when every verification command matches its expected column, the smoke URL is not `:3080`, and the smoke expectations below hold.

9. Land `sync/YYYY-MM-DD` on `master` with a merge commit, history `Merge pull request #N from sotola122/sync/...`. A squash or a rebase is not this landing. The PR target is `sotola122/anago-harness` `master`. Push to `origin`. Do not push to `fork` (`https://github.com/tpy-iori-takiguchi/anago-harness.git`).

```sh
git push -u origin sync/YYYY-MM-DD
```

When the ssh alias `git@github.com.priv:sotola122/anago-harness.git` fails, push over HTTPS without printing the token:

```sh
git push "https://x-access-token:$(gh auth token --user sotola122)@github.com/sotola122/anago-harness.git" sync/YYYY-MM-DD
```

After the merge is on `master`, do not reset `master`. Fix forward, or revert the merge commit. Leave the untracked notes in [Pitfalls](#pitfalls) uncommitted.

Done when `origin` has the `sync/` branch, `master` contains a merge commit of it (`git log -1 --format=%P` on that commit prints two parents), and the push exited 0.

## Reference

A step that hits a conflict or a known red continues here. Use the table that names the path.

### Hooks

A hook is a fork edit in an upstream file. Keep the Keep cell; take upstream around it.

| Path | Keep |
|---|---|
| `packages/boot/app-boot/src/profile-context.ts` | the `fork-policy` import (it installs the egress guard) and both calls: `forkDefaultPatches` immediately after the bundle layer, `forkLockPatches` last |
| `packages/boot/app-boot/src/profile.ts` | both `appendSharedTemplateBundles` calls: `web` gets `@anago-harness/anago-core` and `@anago-harness/anago-web`; `headless` gets `@anago-harness/anago-core` |
| `packages/boot/app-boot/tests/profile.spec.ts` | the headless bundle list includes `@anago-harness/anago-core` |
| `packages/boot/app-boot/package.json`, `packages/boot/app-boot/tsconfig.json` | the `@anago-harness/fork-policy` dependency and project reference |
| `apps/cli/package.json` | `@anago-harness/anago-core` and `@anago-harness/anago-web`. `scripts/verify-default-product-isolation.ts` requires a default bundle to be a dependency of `apps/cli` |
| `tsconfig.base.json` | the hand-written `@anago-harness/*` aliases above `BEGIN generated package aliases`. The region itself is generated |
| `tsconfig.host.json` | every `packages/fork/` project reference and `packages/preset/orchestrator-policy`. The three client packages are not here |
| `tsconfig.client.json` | `client-ui-settings-web-search`, `client-ui-fonts-anago`, `client-ui-session-share` |
| `scripts/product-package-policy.ts`, `scripts/verify-package-readme-model-experience.ts`, `scripts/check-workspace-constraints.ts`, `scripts/gen-tool-catalog.ts`, `scripts/doc-standard.spec.ts`, `scripts/verify-subsystem-pages.ts`, `scripts/verify-default-product-isolation.ts`, `scripts/verify-repository-references.ts`, `scripts/gen-cordis-catalog.ts`, `scripts/project-doc-site.spec.ts` | the fork entry in each: optional `copilot-oauth`, `xai-oauth`, `ui-message-feedback`, `ui-settings-account`, `ui-settings-web-search`, `ui-deepseek-model-label-1017`; `packages/fork/` model-experience exemptions; the regex excluding `fork/` from release; explicit `memory` and `llm-wiki` registrations (`packages/*/tool-*` does not see them); doc-standard exemptions for `fork-policy`, `knowledge-common`, `web-search-credentials`; the `fork` subsystem exemption; the check that a default bundle is a runtime dependency of `apps/cli`; `PROJECT_GUIDELINE.md` in `excludedFiles`; links for `PurposeGuidance`, `PurposeRouteTable`, `SessionOwnership`, `Disposable`; the `# Anago Harness` heading expectation |
| `vitest.config.ts` | `packages/fork/fork-policy/tests/egress-guard.spec.ts` in `processBoundTests` |
| `vitest.expected.config.ts` | the `DSH_EXPECTED_MAX_WORKERS` read |
| `README.md`, `README.zh.md`, `README.i18n.yaml`, `docs/user/index.md` and its pair, `website/docs.ts`, `website/.vitepress/config.ts`, `packages/README.md` and its pair | Anago Harness name, clone URL `https://github.com/sotola122/anago-harness.git`, headings, site `label`, `title`, `description`, and the `fork/` group row. Take upstream for the rest of a README body. Align a Chinese pair and `pnpm run verify-translation-pairing --write` only that reviewed pair |
| `pnpm-workspace.yaml`, `packages/llm/llm-pi-ai/package.json`, `patches/@earendil-works__pi-ai@1.4.0.patch` | the pin, the exclude entries, and the patch. Step 7 when the version changes |
| `packages/llm/llm-pi-ai/src/adapter.ts`, `packages/llm/llm-pi-ai/src/provider.ts` | a stored grant narrows Copilot models; an unsigned route still advertises its catalog |
| `packages/client/tsdown.client.ts` | the `__DSH_FONT_*` condition (the font plugin replaces it with a data URL; it is not a package asset) |
| `packages/fs/tool-fs-search/src/glob.ts` | `stabilizeGlobMtimeTies` |
| `.github/workflows/` except `fork-egress.yml`, and `.github/AGENTS.md` | GitHub-hosted `runs-on` and the timeout this tree set for that runner. Take upstream steps. Do not restore `dsh-*`, Blacksmith, self-hosted, or a failover expression. Delete a job that only calls a workflow in [Workflows kept deleted](#workflows-kept-deleted) (`ssh-helper` in `ci-master.yml` calls `build-exe-for-ssh-helper.yml`). Keep the hosted-runner paragraph in `.github/AGENTS.md` |
| `.gitignore` | the `.tmp/` and `.research/` lines |
| `snapshots/AGENTS.md` | the paragraph on `anago` / `anago-*` compositions and `session/upstream-compat.cordis.yml` |
| `docs/persistence-changes/2026-10-22-action-card-status.md` and its `.zh.md` | `previous: "2026-10-21-anago-message-sources"` |
| `python/sdk-runtime/package.json`, `packages/preset/README.md`, `packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md` | the `@deepseek-ai/dsh-orchestrator-policy` dependency, the `orchestrator-policy` row, and the `orchestrator` preset id |

### Re-apply

Re-apply means fork behavior that lives inside an upstream package, not a short hook. Put that behavior back on the new upstream version. Take neither side whole.

| Range | Behavior |
|---|---|
| `packages/api/session-controller/src/`, `packages/api/remotes/src/remote-events.ts` | a Session another process holds is read-only: `session/ownership`, idle release, `api-session/detached` |
| `packages/session/session-persistence/src/index.ts`, `packages/session/session-persistence-jsonl/src/` | the write lease and `ownership()` |
| `packages/session-query/session-query/src/cold-read.ts`, `observation.ts` | a read observation from a stored position |
| `packages/core/session/src/index.ts`, `types.ts` | Session types for sharing. `known-event-types.ts` is generated |
| `packages/core/agent/src/index.ts` | `hold()` / `holds()`. Idle release does not drop an Agent that is held |
| `packages/goal/goal-round-driver/src/index.ts` | `hold()` for the duration of a drive |
| `packages/client/ui-conversation/src/client/contract/composer-blocks.ts`, `slots.ts`, `skeleton/InputBar.tsx`, `locales.ts` | composer lock while another process holds the Session |
| `packages/experimental/liveshare/src/endpoint-classification.ts` | `session/ownership` is owner-only |
| `packages/subagent/tool-subagent/src/` | `providerOwnedRoute`, purpose routing, category skills |
| `packages/subagent/tool-subagent-control/src/list-agents.ts` | a listed child's recorded provider, model, and reasoning effort |
| `packages/client/ui-settings-subagent/src/client/` | the purpose-route settings card |
| `packages/client/ui-tool/src/client/tool/models/` | child provider, model, and effort in the detail |
| `packages/core/system-prompt/src/index.ts` | `ORCHESTRATOR_POLICY` at order 550 |
| `packages/bundle/web-app/package.json`, `packages/bundle/web-app/presets/orchestrator.patch.yml` | the orchestrator preset mounted on the bundle |
| `snapshots/**` expected files and session JSONL that differ | the fork behavior in that recording (route fields, injected sections). `pnpm run test:snapshot` must exit 0 |

### Fork-owned

A path this tree added and upstream does not have stays. If upstream adds the same path, stop and rename; do not delete the fork path to take upstream. Also keep any added path not listed here.

- `packages/fork/**` (README pair and `.i18n.yaml` included) and `packages/preset/orchestrator-policy/**` (outside `packages/fork/`; version alignment and conflicts include it)
- `ci/fork/**`, `scripts/fork/**`, `.github/workflows/fork-egress.yml`, `docs/fork.md` and its pair and `.i18n.yaml`
- `ANAGO_TODO.md`, `ANAGO_PLUGINS_DESIGN.md`, `PROJECT_GUIDELINE.md`, `UPSTREAM_MIGRATION.md`, `.anago/`
- `snapshots/session/anago-memory/`, `anago-wiki/`, `anago-search/`, `snapshots/session/upstream-compat.cordis.yml`
- `docs/persistence-changes/2026-10-21-anago-message-sources*`, `2026-10-22-memory-review-request*`, `2026-10-26-subagent-purpose-route*`, `2026-10-29-anago-message-sources-after-sync*`
- `docs/upgrade-guide/v0.2.1-rc.2/anago-bundles/`, `web-tui-session-sharing/`, `cursor-pi-subagent-tools/`, `pi-ai-catalog-refresh/`

### Workflows kept deleted

These files were in the last synced upstream and are absent here. If the merge brings one back, delete it. Workflow names are under `.github/workflows/`: `build-exe-for-ssh-helper.yml`, `build-preview-cloudflare.yml`, `desktop-publish.yml`, `docs-pages.yml`, `e2e.yml`, `issue-lifecycle.yml`, `issue-policy.yml`, `node-addon-system-release.yml`, `pi-ai-provider-e2e.yml`, `publish-ssh-helper.yml`, `python-release.yml`, `release-publish.yml`, `release-vendor-publish.yml`, `release-vendor.yml`, `release.yml`, `weighted-approval-review-event.yml`, `weighted-approval.yml`. Also `scripts/desktop-publish-workflow.spec.ts`, `scripts/preview-workflow.spec.ts`, and `scripts/tests/ci-release-selfhosted.spec.ts`, which read those workflows.

### Generated

A file is generated when its header says `Generated by scripts/` or `GENERATED`, or when it is named here. Delete it and run the command in the header, or the command below. Do not resolve conflict markers in it.

`tsconfig.base.json` is the exception: do not delete the file. Regenerate only the region between `BEGIN generated package aliases` and `END generated package aliases` with `pnpm run gen-tsconfig-paths`, and keep the hand-written `@anago-harness/*` aliases above that region.

| Command | Headerless output, or when to run |
|---|---|
| `pnpm install` | `pnpm-lock.yaml` |
| `pnpm run gen-persistence-catalog` | `docs/persistence-schema.json` |
| `pnpm run verify-persistence-formats --write` | the `persistence-format-index` region in `docs/persistence-changes/historical-formats/README.md` and its `.zh.md` |
| `pnpm run gen-provider-data` | when the pi-ai pin changes (the file header names the command) |
| `pnpm run gen-third-party-notices` | when the lockfile or a patch changes (the file header names the command) |

A generator that does not write Chinese says so in the `.zh.md` header. After regenerating English, bring that pair along and record only a pair you reviewed: `pnpm run verify-translation-pairing --write <pair>`. `--write` records a confirmed pair; it does not correct an unreviewed translation. `pnpm run verify-translation-pairing --write --all` records every complete pair, and only when every pair was reviewed.

### Version

Checked 2026-10-31. The root `package.json` `version` is authoritative: `0.2.2-alpha.2`. Every `packages/fork/*/package.json` and `packages/preset/orchestrator-policy/package.json` is `0.2.1-rc.2` (16 files on that date; the set follows the tree). `scripts/verify-package-meta.ts` does not read `version`, and no gate checks version equality. After the merge, set every one of those `version` fields to the root version. Do not align `vendor/`, fixtures, `native/`, `website/`, `benchmarks/`, or `python/sdk-runtime`.

`pnpm-lock.yaml` importers do not store the package.json version string. `packages/fork/*` resolves through `workspace:*` and `link:`. After `pnpm install`, the importers `packages/fork/<name>:` and `packages/preset/orchestrator-policy:` remain, and their dependencies stay `link:`.

### Verification

| Command | Expected |
|---|---|
| `pnpm run build:artifacts` | exits 0 and writes `apps/cli/lib/bin.js` |
| `pnpm run build:check` | exits 0, after that `build:artifacts` |
| `pnpm run test` | exits 0. A touched package is enough when the scope is clear |
| `pnpm run test:snapshot` | exits 0 and writes nothing. `pnpm run test:snapshot:record` and `test:snapshot:refresh` add a generation and do not rewrite a committed one ([snapshots/AGENTS.md](snapshots/AGENTS.md)); do not use them to erase a sync diff |
| `pnpm run test:docs` | exits 0 except the known red |
| `pnpm run test:expected` | chase a failure that is not one of the 13 known headless reds. The rest of the suite was not measured |
| `pnpm run lint` | exits 0 |
| `node ci/fork/scan-egress.mjs` | exits 0 when there is no new host. Currently a known red. `--write-baseline` only for a reviewed host, not as part of this sync |
| `pnpm exec vitest run packages/fork/fork-policy/tests/egress-guard.spec.ts` | exits 0. Local side of `.github/workflows/fork-egress.yml` |

Smoke uses a throwaway `DSH_HOME`. Shipped templates do not select oauth bundles (`profile.ts` adds only `anago-core` and `anago-web`). An oauth command registers only when its bundle is selected: `@anago-harness/xai-oauth` gives `/xai-status`, `@anago-harness/copilot-oauth` gives `/copilot-status`, and `@anago-harness/openai-codex-oauth` gives `/codex-status`.

```sh
export DSH_HOME="$(mktemp -d)"
node apps/cli/lib/bin.js --profile web --dump-default-config
```

Expect `@anago-harness/anago-core` and `@anago-harness/anago-web` in the bundle list, and rows for `memory` and `llm-wiki`. To see oauth, add the oauth bundles you are checking to `$DSH_HOME/profiles/web/package.json` `dsh.profile.bundles`, then `--dump-config`, and their rows appear.

```sh
node apps/cli/lib/bin.js --profile web --port 0 --no-open
```

`--port 0` lets the OS pick a free port (`packages/bundle/web-app/src/startup.ts`). The printed URL is not `:3080`. With the oauth bundles added, the slash list shows their commands. Tools are `memory`, `wiki_search`, `wiki_lint`, and `wiki_write`.

### Known red

Checked 2026-10-31. A failure outside this list is a sync failure. Do not rewrite expected files to clear these.

`pnpm run test:docs` fails only in `verify-package-readme-model-experience`, at `packages/subagent/tool-subagent/README.md` line 214: content after the `#### What the model sees` paragraph must be a titled H5 plus a `markdown` fence owned by that field. The file matches HEAD; it is not a dirty worktree.

`pnpm run test:expected` was not run in full. Headless expected, through `vitest.expected.config.ts`, had 13 failures: `headless.expected.e2e.ts` 8, `semantic-checkpoint` 1, `subagent-diagnostic` 1, `subagent-inheritance` 1, `workspace-context-resume` 2. `mcp-pagination` and `session-format-guard` were green. The cause is not only response-language. Many expected files lack `response-language:runtime` (`Reply to the user in Japanese (日本語)...`) and the `llm-wiki` skill catalog. In addition, the DeepSeek defaults test has 0 requests (expected 2), `subagent-diagnostic` is child-session JSON rather than catalog lines, and `subagent-inheritance` has a child-session structure that differs from the expected file.

`node ci/fork/scan-egress.mjs` exits 1 with 6 NEW findings. Do not update the baseline in this procedure. `WATCH` `api.deepseek.com` fails even when it is in the baseline (`BUILTIN-DEEPSEEK`); the scanner also prints that line for the same pair, and it is not a seventh NEW. A `NEW` beyond these six is a sync diff.

```
NEW  DENIED	packages/util/plugin-detail/src/files.ts	registry.npmmirror.com
NEW  WATCH	scripts/test-official-listing-guard.ts	api.deepseek.com
NEW  other	packages/boot/plugin-market/src/detail-files.ts	raw.githubusercontent.com
NEW  other	packages/experimental/liveshare/src/host/viewer-dispatch.ts	liveshare.internal
NEW  other	packages/util/plugin-detail/src/files.ts	cdn.jsdelivr.net
NEW  other	packages/util/plugin-detail/src/files.ts	unpkg.com
```

### Pitfalls

- Leave `.dsh/memory/` untracked; `MEMORY.md` is workspace notes.
- `.gitattributes` has no `merge=ours`. Resolve a binary by the same rule as text.
- `~/.dsh/profiles/web-anago/package.json` `link:`s `@anago-harness/xai-oauth` and `@anago-harness/copilot-oauth` into this checkout's `packages/fork/`. Moving those paths breaks that profile. Do not launch it.
