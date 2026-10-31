# 上流取り込み手順

このファイルが、上流 `https://github.com/deepseek-ai/deepseek-harness` をこのフォークへ merge する手順の正本。確認日は 2026-10-31。コマンド、パス、識別子はそのまま書く。

完了は「戻し方と周期」の完了条件をすべて満たしたとき。設計メモ [PROJECT_GUIDELINE.md](PROJECT_GUIDELINE.md) §7 の `fork-sync.yml` と `upstream/main` はこのツリーに無い。上流の既定ブランチは `master`。

## 目的と不変条件

フォークの作業は `master` に merge commit で積む。上流へ rebase しない。`master` は `origin` と `sotola`（どちらも `sotola122/anago-harness`）に公開済みで、前回の取り込みも merge commit（PR #7、ブランチ `sync/upstream-2026-10-29`）。rebase は公開済みの履歴を書き換え、force push になる。merge にすると次の取り込みの共通祖先が今回の `upstream/master` になる。

衝突を小さく保つ規則: フォーク専用の実装は `packages/fork/*` に置く。上流ファイルに残す差分は、下のフックと、すでに上流パスへ入っているフォークの振る舞いだけ。新しい振る舞いを上流ファイルへ足さない。

## フック箇所

衝突したら、フォークの行を残し、それ以外は上流を採る。ファイル全体をどちらか一方で置き換えない。テスト、README、`.i18n.yaml` は対応するソースと一緒に解く。

### 配線

| パス | 理由 | 残すもの |
|---|---|---|
| `packages/boot/app-boot/src/profile-context.ts` | `fork-policy` の import が egress guard を入れ、`forkDefaultPatches` を bundle 層の直後、`forkLockPatches` を最後に足す | その import と 2 つの呼び出し |
| `packages/boot/app-boot/src/profile.ts` | 出荷テンプレートへフォークの bundle を足す。`web` は `@anago-harness/anago-core` と `@anago-harness/anago-web`、`headless` は `@anago-harness/anago-core` | `appendSharedTemplateBundles` の 2 呼び出し |
| `packages/boot/app-boot/tests/profile.spec.ts` | 正規化した headless の bundle 列に `@anago-harness/anago-core` があることを見る | その期待 |
| `packages/boot/app-boot/package.json` | `@anago-harness/fork-policy` を依存に持つ | その依存 |
| `packages/boot/app-boot/tsconfig.json` | `fork-policy` への project reference | その reference |
| `apps/cli/package.json` | `@anago-harness/anago-core` と `@anago-harness/anago-web` を依存に持つ。`scripts/verify-default-product-isolation.ts` は既定 bundle が CLI の依存であることを要求する | その 2 依存 |
| `tsconfig.base.json` | `@anago-harness/*` の別名は手書き。生成範囲の外（`BEGIN generated package aliases` より上） | 手書きの別名。生成範囲は再生成 |
| `tsconfig.host.json` | Host の fork パッケージへの project reference | `packages/fork/` の Host 参照。client 3 パッケージはここには無い |
| `tsconfig.client.json` | `client-ui-settings-web-search`、`client-ui-fonts-anago`、`client-ui-session-share` への project reference | その 3 参照 |
| `scripts/product-package-policy.ts` | oauth bundle を optional にし、anago が止める上流 UI パッケージも optional にする | fork と anago のエントリ |
| `scripts/verify-package-readme-model-experience.ts` | fork パッケージの Model Experience 免除 | `packages/fork/` のエントリ |
| `scripts/check-workspace-constraints.ts` | `packages/fork/` をリリース対象から外す | `fork/` を除外する正規表現 |
| `scripts/gen-tool-catalog.ts` | `packages/*/tool-*` では見えない `memory` と `llm-wiki` を明示登録する | その 2 エントリ |
| `scripts/doc-standard.spec.ts` | プラグインでない fork ライブラリの免除 | `fork-policy`、`knowledge-common`、`web-search-credentials` |
| `scripts/verify-subsystem-pages.ts` | `fork` グループは subsystem ページを持たない | `fork` の免除 |
| `scripts/verify-default-product-isolation.ts` | 既定 bundle が `apps/cli` の依存であることを検査する | その検査 |
| `scripts/verify-repository-references.ts` | `PROJECT_GUIDELINE.md` を commit 参照の検査から外す | `excludedFiles` |
| `scripts/gen-cordis-catalog.ts` | `PurposeGuidance`、`PurposeRouteTable`、`SessionOwnership`、`Disposable` のリンク | その 4 エントリ |
| `scripts/project-doc-site.spec.ts` | サイト見出しが `# Anago Harness` であることを見る | その期待 |
| `vitest.config.ts` | `packages/fork/fork-policy/tests/egress-guard.spec.ts` をプロセス束縛テストに入れる | その 1 行 |
| `vitest.expected.config.ts` | `DSH_EXPECTED_MAX_WORKERS` で expected の worker 数を下げられる | その読み取り |
| `README.md`、`README.zh.md`、`README.i18n.yaml` | 製品名 Anago Harness と clone URL | フォークの名前と URL。本文の上流更新は上流を採る |
| `docs/user/index.md` と対 | 見出し Anago Harness | 見出し。対は揃えて `--write` |
| `website/docs.ts` | サイトラベル Anago Harness | その label |
| `website/.vitepress/config.ts` | title と description | Anago Harness の 2 フィールド |
| `packages/README.md` と対 | `fork/` グループの行 | その行 |
| `pnpm-workspace.yaml` | `@earendil-works/pi-ai@1.4.0` の pin と `patchedDependencies` | pin、除外、patch パス。版が変わったら下の patch 節 |
| `packages/llm/llm-pi-ai/package.json` | `"@earendil-works/pi-ai": "^1.4.0"` | その依存。pin と揃える |
| `patches/@earendil-works__pi-ai@1.4.0.patch` | ストリーム中の `block.arguments` 代入を止め、Gemini の thought signature を残す | 版が同じならパッチを残す。版が変わったら作り直す |
| `packages/llm/llm-pi-ai/src/adapter.ts`、`catalog.ts`、`provider.ts` | 保存済み grant で Copilot のモデルを絞り、未サインインでもカタログを出す | その絞り込み |
| `packages/client/tsdown.client.ts` | `__DSH_FONT_*` はフォントプラグインが data URL に置換する。パッケージ資産ではない | その条件 |
| `packages/fs/tool-fs-search/src/glob.ts` | 同じ秒の mtime をパス順で安定化する | `stabilizeGlobMtimeTies` |
| `packages/jobs/tool-jobs/src/index.ts` | `job_output` の既定待ちは 10 分（`600_000`） | その既定と説明文 |
| `.github/workflows/ci.yml` ほか残した workflow | runner を GitHub-hosted の `ubuntu-latest` / `ubuntu-24.04` にする。`dsh-*`、Blacksmith、self-hosted へ戻さない。規則は [.github/AGENTS.md](.github/AGENTS.md) | hosted runner。上流の job 内容は載せる |

`tsconfig.host.json` の Host 参照は `fork-policy`、`knowledge-common`、`memory`、`llm-wiki`、`response-language`、`web-search-brave`、`web-search-exa`、`web-search-credentials`、`anago-core`、`anago-web`、`openai-codex-oauth`、`xai-oauth`、`copilot-oauth`。`packages/preset/orchestrator-policy` の参照も残す。別名 `@deepseek-ai/dsh-orchestrator-policy` は生成範囲に入る。

### 上流パッケージに残っているフォークの振る舞い

ここは短いフックではない。衝突したらフォークの振る舞いを上流の新しい版の上に載せ直す。ours 全体も theirs 全体も採らない。

| 範囲 | 理由 |
|---|---|
| `packages/api/session-controller/src/`、`packages/api/remotes/src/remote-events.ts` | 他プロセスが持つ Session は read-only。`session/ownership`、idle 解放、`api-session/detached` |
| `packages/session/session-persistence/src/index.ts`、`packages/session/session-persistence-jsonl/src/` | 書き込み lease と `ownership()` |
| `packages/session-query/session-query/src/cold-read.ts`、`observation.ts` | 保存済み位置からの read 観測 |
| `packages/core/session/src/index.ts`、`types.ts` | 共有のための Session 型。`known-event-types.ts` は生成物 |
| `packages/core/agent/src/index.ts` | `hold()` / `holds()`。idle 解放が作業中の Agent を捨てない |
| `packages/goal/goal-round-driver/src/index.ts` | drive のあいだ `hold()` する |
| `packages/client/ui-conversation/src/client/contract/composer-blocks.ts`、`slots.ts`、`skeleton/InputBar.tsx`、`locales.ts` | 他プロセス保持中の composer ロック |
| `packages/experimental/liveshare/src/endpoint-classification.ts` | `session/ownership` は owner-only |
| `packages/subagent/tool-subagent/src/` | `providerOwnedRoute`、用途ルーティング、カテゴリのスキル |
| `packages/client/ui-settings-subagent/src/client/` | 用途ルートの設定カード |
| `packages/client/ui-tool/src/client/tool/models/` | 子の provider / model / effort を詳細に出す |
| `packages/core/system-prompt/src/index.ts` | `ORCHESTRATOR_POLICY` の order 550 |
| `packages/bundle/web-app/package.json`、`packages/bundle/web-app/presets/orchestrator.patch.yml` | orchestrator プリセットを bundle に載せる |

### フォーク専用

上流に無い。merge は残す。上流が同じパスを足したら止めて、名前をずらす。消して上流を採らない。

- `packages/fork/**`、`packages/fork/README.md` と対、`packages/fork/README.i18n.yaml`
- `packages/preset/orchestrator-policy/**`（`packages/fork/` の外にあるフォーク追加パッケージ）
- `ci/fork/scan-egress.mjs`、`ci/fork/egress-baseline.json`
- `scripts/fork/setup-dsh-tui.mjs`、`scripts/fork/patch-dsh-tui-i18n.mjs`
- `.github/workflows/fork-egress.yml`
- `docs/fork.md`、`docs/fork.zh.md`、`docs/fork.i18n.yaml`
- `ANAGO_TODO.md`、`ANAGO_PLUGINS_DESIGN.md`、`PROJECT_GUIDELINE.md`、`UPSTREAM_MIGRATION.md`
- `.anago/`
- `snapshots/session/anago-memory/`、`anago-wiki/`、`anago-search/`、`snapshots/session/upstream-compat.cordis.yml`
- `docs/persistence-changes/2026-10-21-anago-message-sources*`、`2026-10-22-memory-review-request*`、`2026-10-26-subagent-purpose-route*`、`2026-10-29-anago-message-sources-after-sync*`
- `docs/upgrade-guide/v0.2.1-rc.2/anago-bundles/`、`web-tui-session-sharing/`、`cursor-pi-subagent-tools/`、`pi-ai-catalog-refresh/`

### 削除したままにする workflow

次のファイルは前回同期した上流にはあり、このツリーには無い。merge が復活させたら消す。

`build-exe-for-ssh-helper.yml`、`build-preview-cloudflare.yml`、`desktop-publish.yml`、`docs-pages.yml`、`e2e.yml`、`issue-lifecycle.yml`、`issue-policy.yml`、`node-addon-system-release.yml`、`pi-ai-provider-e2e.yml`、`publish-ssh-helper.yml`、`python-release.yml`、`release-publish.yml`、`release-vendor-publish.yml`、`release-vendor.yml`、`release.yml`、`weighted-approval-review-event.yml`、`weighted-approval.yml`（いずれも `.github/workflows/`）。

`.gitattributes` に `merge=ours` は無い。バイナリをそれに頼らない。

## 生成物

衝突マーカーを手で解かない。衝突したファイルを消してから生成し直す。`tsconfig.base.json` だけ例外で、ファイルは消さず、`BEGIN generated package aliases` から `END generated package aliases` までを生成器に任せる。手書きの `@anago-harness/*` 別名は残す。

| コマンド | 書くもの |
|---|---|
| `pnpm install` | `pnpm-lock.yaml` |
| `pnpm run gen-tsconfig-paths` | `tsconfig.base.json` の生成範囲 |
| `pnpm run gen-config-catalog` | `docs/config-catalog.md` と `docs/config-catalog.zh.md` |
| `pnpm run gen-plugin-packages` | `packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md` |
| `pnpm run gen-tool-catalog` | `docs/tool-catalog.md` だけ。zh は生成しない |
| `pnpm run gen-client-catalog` | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| `pnpm run gen-persistence-catalog` | `docs/persistence-catalog.md` と対、`docs/experimental-persistence-catalog.md` と対、`docs/persistence-schema.json`、`packages/core/session/src/known-event-types.ts` |
| `pnpm run gen-cordis-api` | `packages/extensions/tool-cordis/src/api-catalog.ts` |
| `pnpm run gen-cordis-catalog` | `docs/cordis-api/` の生成ページ |
| `pnpm run gen-module-graph` | `docs/module-graph.md` と対 |
| `pnpm run gen-doc-graphs` | `docs/capability-seams.md`、`docs/event-producer-consumer.md`、`docs/agent-lifecycle.md`、`docs/tool-execution-pipeline.md`、`docs/graph-atlas.md` |
| `pnpm run gen-provider-data` | `packages/llm/llm-pi-ai/src/provider-data.generated.ts`。pi-ai の pin が変わったとき |
| `pnpm run gen-third-party-notices` | `THIRD_PARTY_NOTICES.md`。lockfile か patch が変わったとき |

ヘッダが `Generated by scripts/...` のファイルは、上に無くても同じ規則。消してヘッダのコマンドを走らせる。

生成器が zh を書かないページは、英語を再生成したあと対を合わせ、確認したペアだけ `pnpm run verify-translation-pairing --write <pair>` する。全対を記録するときは `pnpm run verify-translation-pairing --write --all`。`--write` は確認したペアを記録する操作で、未確認の対訳を正しくする操作ではない。

## 手順

作業ブランチから切らない。先に `master` を `origin` へ fast-forward してから `sync/YYYY-MM-DD` を切る。

1. remote を確認する。`upstream` が無ければ足す。

```sh
git remote
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream --tags
```

2. `master` を最新にしてブランチを切る。日付は作業日。

```sh
git switch master
git pull --ff-only origin master
git switch -c sync/YYYY-MM-DD
```

3. merge する。rebase しない。理由は冒頭。

```sh
git merge upstream/master
```

4. 衝突を種類で解く。フックはフォークの行を残す。生成物は消して再生成する。削除した workflow は復活させない。`git diff --check` で衝突マーカーが残っていないことを見る。

5. バージョンを揃える。次節。

6. 生成し直す。上の表の、衝突したか中身が古くなったコマンドだけ。全部を毎回走らせる必要はない。`pnpm run gen-tsconfig-paths` のあと、手書きの `@anago-harness/*` 別名が残っていることを見る。

7. pi-ai の pin が変わっていたら、patch を作り直す。`pnpm-workspace.yaml` の pin と `patchedDependencies`、`patches/@earendil-works__pi-ai@<version>.patch`、`packages/llm/llm-pi-ai/package.json` の依存を同じ版にする。古い patch は新しい dist には当たらない。当たることを `pnpm install` で確認してから、thought signature とストリーム中の `arguments` 代入禁止が残っていることを patch 本文で見る。そのあと `pnpm run gen-provider-data`。

8. 検証節を走らせる。既知の失敗と違う赤は取り込みの失敗。

9. `master` へ merge commit で入れる。squash も rebase もしない。PR にするときは `sotola122/anago-harness` の `master` 向け。履歴の形は `Merge pull request #N from sotola122/sync/...`。

```sh
git push -u origin sync/YYYY-MM-DD
```

ssh alias（`git@github.com.priv:sotola122/anago-harness.git`）の push が失敗したら、トークンを表示せずに HTTPS で push する。

```sh
git push "https://x-access-token:$(gh auth token --user sotola122)@github.com/sotola122/anago-harness.git" sync/YYYY-MM-DD
```

`fork` remote（`tpy-iori-takiguchi/anago-harness`）へは push しない。作業の push 先は `origin`。

## バージョン合わせ

ルート `package.json` の `version` が正。2026-10-31 時点でルートは `0.2.2-alpha.2`、`packages/fork/*/package.json` 16 個と `packages/preset/orchestrator-policy/package.json` は `0.2.1-rc.2`。`scripts/verify-package-meta.ts` は version を見ない。取り込み後、fork パッケージ 16 個と `orchestrator-policy` の `version` をルートの version に合わせる。vendor、fixture、`native/`、`website/`、`benchmarks/`、`python/sdk-runtime` は合わせない。

`pnpm-lock.yaml` の importer は package.json の version 文字列を持たない。`packages/fork/*` は `workspace:*` と `link:` で解決する。`pnpm install` のあと、`packages/fork/<name>:` と `packages/preset/orchestrator-policy:` の importer が残り、依存が `link:` のままであることを見る。

## 検証

ポート 3080 では検証しない。`anago-web.service` が `100.110.252.31:3080` で動いている。このワークスペースの作業メモは `.dsh/memory/MEMORY.md`（未追跡）。本番プロファイル `~/.dsh/profiles/web-anago` も起動しない。

期待は「コマンドが存在する」ことと、既知の失敗以外が緑なこと。重い検査はここで再実行していない。取り込み側が走らせる。

| コマンド | 期待 |
|---|---|
| `pnpm run build:artifacts` | 終了 0。`apps/cli/lib/bin.js` ができる |
| `pnpm run build:check` | 直前の `build:artifacts` のあとで終了 0 |
| `pnpm run test` | 終了 0。範囲が分かるなら触ったパッケージだけでよい |
| `pnpm run test:snapshot` | 終了 0。書き込まない。`record` も `refresh` も使わない |
| `pnpm run test:docs` | 既知の 1 件以外は終了 0 |
| `pnpm run test:expected` | headless の既知の 13 件以外を取り込みの失敗として追う。全文は未測定 |
| `pnpm run lint` | 終了 0 |
| `node ci/fork/scan-egress.mjs` | 新規ホストが無ければ終了 0。現状は既知の赤。`--write-baseline` はレビューしたホストだけ |
| `pnpm exec vitest run packages/fork/fork-policy/tests/egress-guard.spec.ts` | 終了 0。workflow `.github/workflows/fork-egress.yml` のローカル側 |

スモークは捨てる `DSH_HOME` で行う。出荷テンプレートは oauth bundle を選ばない（`profile.ts` は `anago-core` と `anago-web` だけを足す）。`/xai-status` は `@anago-harness/xai-oauth`、`/codex-status` は `@anago-harness/openai-codex-oauth` が bundle に入っているときだけ登録される。本番の `web-anago` は xai と copilot を選び、openai-codex は選んでいない。

```sh
export DSH_HOME="$(mktemp -d)"
node apps/cli/lib/bin.js --profile web --dump-default-config
```

期待: bundle 列に `@anago-harness/anago-core` と `@anago-harness/anago-web`。行に `memory` と `llm-wiki`。oauth を見るときは、作られた `$DSH_HOME/profiles/web/package.json` の `dsh.profile.bundles` に `@anago-harness/xai-oauth` と `@anago-harness/openai-codex-oauth` を足してから `--dump-config` し、その 2 行が出ることを見る。

```sh
node apps/cli/lib/bin.js --profile web --port 0 --no-open
```

`--port 0` は OS が空きポートを選ぶ（`packages/bundle/web-app/src/startup.ts`）。印字された URL が `:3080` でないこと。プロセスを止めるまで 3080 のサービスには触らない。UI のスラッシュ一覧に、bundle を足したプロファイルなら `/xai-status` と `/codex-status`。ツールは `memory`、`wiki_search`、`wiki_lint`、`wiki_write`。

## 既知の失敗

取り込みの赤と混ぜない。2026-10-31 にこのツリーで確認した。

`pnpm run test:docs` は `verify-package-readme-model-experience` だけが失敗する。`packages/subagent/tool-subagent/README.md` 214 行目。Model Experience の節のあとに、フィールドごとの H5 と `markdown` フェンスが無い。このファイルは HEAD と同一で、作業ツリーの汚れではない。

`pnpm run test:expected` の全文は走らせていない。headless の expected だけを `vitest.expected.config.ts` で走らせ、13 失敗だった。`headless.expected.e2e.ts` が 8、`semantic-checkpoint` が 1、`subagent-diagnostic` が 1、`subagent-inheritance` が 1、`workspace-context-resume` が 2。`mcp-pagination` と `session-format-guard` は緑。

13 件の原因は response-language だけではない。多くの期待ファイルには `response-language:runtime`（「Reply to the user in Japanese (日本語)...」）と `llm-wiki` の skill catalog が無い。それに加えて、DeepSeek defaults のテストはリクエスト数が 0（期待 2）、`subagent-diagnostic` はカタログ行ではなく子セッション JSON、`subagent-inheritance` は子セッションの構造が期待と違う。期待ファイルを取り込みのついでに書き換えない。

`node ci/fork/scan-egress.mjs` は終了 1。新規 6 件。baseline を取り込みの手順で更新しない。

```
NEW  DENIED	packages/util/plugin-detail/src/files.ts	registry.npmmirror.com
NEW  WATCH	scripts/test-official-listing-guard.ts	api.deepseek.com
NEW  other	packages/boot/plugin-market/src/detail-files.ts	raw.githubusercontent.com
NEW  other	packages/experimental/liveshare/src/host/viewer-dispatch.ts	liveshare.internal
NEW  other	packages/util/plugin-detail/src/files.ts	cdn.jsdelivr.net
NEW  other	packages/util/plugin-detail/src/files.ts	unpkg.com
```

`WATCH` の `api.deepseek.com` は baseline にあっても失敗する（`BUILTIN-DEEPSEEK`）。同期でこれ以外の `NEW` が増えたら、それは取り込みの差分。

## 戻し方と周期

merge の途中なら `git merge --abort`。ブランチを `master` から切っていれば `master` は動かない。壊れた `sync/` ブランチは、`master` へ merge する前に捨てる。

`master` へ入れたあとに壊れていたら、`master` を reset しない。直すか、merge commit を revert する。

一度に解けないときは、`git log --oneline master..upstream/master` で途中の commit を選び、そこまで merge して入れてから続きを別の `sync/` でやる。

周期は週 1 回を目安にする。`git fetch upstream` のあと `upstream/master` が `master` に含まれていれば、その週は何もしない。前回の取り込みブランチは `sync/upstream-2026-10-29`（PR #7）。

完了条件:

- `sync/YYYY-MM-DD` が `master` に merge commit で入っている
- 衝突マーカーが残っていない（`git diff --check`）
- 生成物を手で解いていない
- fork パッケージ 16 個と `orchestrator-policy` の version がルートと一致し、lockfile の importer が `link:` のまま
- 検証節を走らせ、既知の失敗以外が緑
- 3080 以外のスモークで `memory` と `llm-wiki` の行があり、oauth を足したプロファイルでは `/xai-status` と `/codex-status` がある
- `origin`（`sotola122/anago-harness`）へ push 済み

## 落とし穴

- 生成物の衝突を手で解くと、次の生成で消える行とフォークの行が混ざる。消して再生成する。
- pi-ai の版を上げたら patch ファイル名も `pnpm-workspace.yaml` のキーも依存も一緒に動かす。古い patch は適用されない。
- `pnpm run test:snapshot:record` と `test:snapshot:refresh` は同期の差分を消すために使わない。[snapshots/AGENTS.md](snapshots/AGENTS.md) は、record と refresh が commit 済み世代を書き換えず、新しい世代を足すと書いている。`pnpm run test:snapshot` は書き込まない。
- `~/.dsh/profiles/web-anago/package.json` は `@anago-harness/copilot-oauth` と `@anago-harness/xai-oauth` をこのチェックアウトの `packages/fork/` へ `link:` している。パスを動かすと本番プロファイルの依存が切れる。このプロファイルを検証で起動しない。
- 本番はポート 3080。`--port` を付けない `web` は 3080 になる。
- `packages/preset/orchestrator-policy` は `packages/fork/` の外にある。fork パッケージだけを見ていると、バージョン合わせと衝突解決から漏れる。
- ssh alias の push はこの環境では失敗する。HTTPS の形式は手順 9。
