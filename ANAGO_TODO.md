# ANAGO TODO — 指摘と作業の管理

依頼者からの指摘、レビュー結果、実装中の未着手項目を 1 か所で管理する。状態は「修正済み / 確認済み / 未着手」で分け、各項目に受入条件と根拠を書く。完了した項目は消さず、根拠とともに残す。

- 最終更新: 2026-10-22
- 関連: [ANAGO_PLUGINS_DESIGN.md](ANAGO_PLUGINS_DESIGN.md)（設計）、[PROJECT_GUIDELINE.md](PROJECT_GUIDELINE.md)（フォーク計画）
- 実行状態: 3080 が現行 dsh（npm 0.2.1-rc.2 + ユーザープラグイン）、3081 が anago フォークの検証環境（`~/.dsh-anago-trial`）

## 修正済み

### 1. 応答言語: 明示的な別言語依頼は尊重し、既定は日本語

- 指摘: このセッションで応答が中国語になった。日本語にするプロンプト注入が不十分。
- 原因: 旧文言は「ユーザーが別言語を使うとき」だけを想定し、明示的な言語指定との優先関係が不明確だった。位置も system prompt の中ほど（order 9950）にあった。
- 対応: 文言を「明示的に別言語を求められた場合はその言語で返す。指定がなければ日本語」に変更。セクションは system prompt の最後（`DEPLOYMENT_PERSONA_SUFFIX` の直後）へ移動。
- 受入: 「Answer in English only」→ 英語で回答。「指定なし」→ 日本語で回答（3081 の headless で確認）。
- 備考: 本セッションの中国語応答そのものは、モデル側の一度の逸脱として扱う。以後は上記の規則で運用する。

### 2b. pi-subagent のモデル・effort 実行時指定 — 実装完了

- 要件: **エージェントが `subagent_pi` 呼び出し時に model / effort を指定できること**。
- 経緯: 当初はプロバイダ側の対応のみでツールに引数がなく、次に上流の `subagent-model-selection` へ乗せようとしたが、これは preset スコープと DSH の LLM カタログを前提とするため外部 CLI には使えなかった。
- 設計（フォーク差分）: `tool-subagent` に `providerOwnedRoute: true` を追加。
  - ツールスキーマに `provider` / `model` / `reasoning_effort` を出す（Host 設定・preset スコープ不要）
  - 実行時に `agentOptions` としてプロバイダへ渡す。モデル選択ポリシーと DSH ルートの preflight はスキップ
  - プロバイダ未対応（`agentOptions` なし）はロード時に fail loud
- 組成: `anago-core` の `tool-subagent-pi` / `tool-subagent-cursor` に `providerOwnedRoute: true`。
- 実機確認: headless で provider `command-code` / model `deepseek/deepseek-v4.1-flash` / effort `high` を渡し、子の出力 **`RUNTIME_OK`** を取得。
- 追加修正（実機フィードバック）:
  - **provider / model のペア必須を解除**: `providerOwnedRoute` では 3 フィールドを独立に受け付ける（model のみ・provider のみ・effort のみ可）。空文字はツール境界で拒否。`providerOwnedAgentOptions()` を追加し、テスト 4 件を追加。
  - **失敗診断の改善**: 子が assistant メッセージなしで終了した場合、`parse.ts` の `failure()` が stderr 末尾（`truncateUtf8Tail`、マスク済み、1 KiB、全体 4 KiB 上限）を diagnostic に付加。実機で `Unknown provider "commandcode"` がモデルに届くことを確認。
  - テスト: pi 98 件・`tool-subagent` 145 件、両方カバレッジ 100%。

### 3. UI の表示言語が中国語になる

- 指摘: anago harness の UI が中国語ベースで、漢字表記になっている。
- 原因: クライアントは en / zh の 2 言語のみ。ブラウザの言語がどちらにも一致しない場合の挙動が環境依存で、中国語が選ばれる場合があった。
- 対応: `anago-web` で `locale.preference: en` を既定に固定（ユーザーが明示的に選んだ場合はそちらが優先）。
- 受入: `--dump-config`（web）で `locale.config.preference: en` を確認。
- 方針変更（ユーザー指示）: **UI の日本語化は不要。英語 UI のままフォントだけ適用する**。`locale.preference: en` を既定に固定し、日本語辞書パックは追加しない。

## 確認済み（バグではない）

### 4. cursor-subagent はモデルを固定していない

- 指摘: pi と同様に cursor もモデルを縛っていないか。
- 確認結果: `subagent-cursor` の `model` は未設定が既定で、`--model` は設定時のみ付与。**モデルを固定していない**（未設定なら Cursor CLI 自身の既定）。
- 制約: per-call のモデル選択は未対応。ツール側の `allowedModels` は DSH の provider/model ルートで、Cursor CLI のモデル名と名前空間が一致しないため、写像すると誤った値になる。必要なら CUR 専用のモデル設定を別途設計する（項目 12）。

## 対応済み（このラウンド）

### 5. UI 言語 — 英語固定（日本語 UI は不要）

- ユーザー指示により、UI は英語のままとする（日本語ロケールは追加しない）。
- `anago-web` で `locale.preference: en` を既定に固定し、ブラウザ言語が未対応でも中国語に落ちないようにした。
- 一度追加した `@anago-harness/client-locale-ja`（49 名前空間 / 2032 キー）は、この指示に従って**削除**し、配線・lockfile・生成物も元に戻した。
- 検証: ヘッドレス Chrome で `lang="en"`、本文が英語（Into the Unknown / Preview / Choose workspace）、フォントは UDEV Gothic 適用済みを確認。

### 6. 日本語フォント — 完了

- `@anago-harness/client-ui-fonts-anago` を追加。UDEV Gothic（**無改変**の上流フォントを TTF→WOFF2 変換のみ。CSS の `unicode-range` でかな・漢字に限定）、Noto Sans JP（latin/kana/kanji の 3 分割 woff2）、Intel One Mono（latin/latin-ext/symbols）。合計 5.02 MiB、OFL 同梱。
- CSS は `?inline` + effect で `<style>` を注入し、`:root:root` で text / code のフォント変数を上書き。コードスタックにも日本語フォントを先行。
- 検証: 18 テスト（全角 = 2 × 半角の実測を含む）、lint 0、tsc 成功。

### 7. ツールカタログ — 完了

- `gen-tool-catalog` に `@anago-harness/memory`（`memory`）と `@anago-harness/llm-wiki`（`wiki_write` / `wiki_search` / `wiki_lint`）の mount レシピを追加し、`docs/tool-catalog.md` / `.zh.md` を再生成。
- 検証: `--check` 成功、`gen-tool-catalog.spec` 10/10、md-links / md-wrap / pairing 通過。

### 8. フォーク固有スナップショット — 完了

- `snapshots/session/anago-{memory,wiki,search}` を録音し、キーなしで replay 可能（3/3 成功）。
- `headless.snapshot.ts` は `anago` 構成で upstream-compat をスキップし、検索フィクスチャを起動して Brave が選ばれたことを検証。
- 互換レイヤーに `subagent-pi` / `tool-subagent-pi` の無効化を追加し、upstream の text-turn replay も復旧。

### 10. client manifest 契約テスト — 完了

- `tests/manifest.spec.ts` を追加（`platform: web`、`./client` の types/default、inject の宣言、runtime 依存なし、CSS Modules 不使用）。

### 11. Exa numResults — 完了

- 効果のない `numResults` を Exa の config / provider / カード / 辞書 / テストから削除（`maxResults` は従来どおり `numResults` に写像）。

### 13. 設計・記録の整合 — 完了

- 互換 patch の warn + skip を `vendor/include` の `applyEntryPatches` で確認し、設計に根拠を記載。
- persistence 記録の「optional message source」を「required source + unknown producer discriminator」に修正（英中）。

### 14. TUI — 主要ギャップを実装

- ツールカード、モデルピッカー（Ctrl+P / `/model`）、セッションピッカー（Ctrl+R / `/resume`）、スラッシュコマンド（`/help` `/model` `/clear` `/resume` `/quit`）、推論ブロック、使用量フッター。
- テスト 79 → 247 件。残りは README の Known Limitations に記載（推論強度ピッカー、`/resume` のメタデータのみ、画像、ジョブ UI など）。

### 9. カバレッジ 100% — 完了

- `packages/fork/**/src/**/*.{ts,tsx}` が **全ファイル 100% / 100% / 100% / 100%**（statements / branches / functions / lines）。カバレッジゲートは exit 0、`does not meet` なし。
- 到達可能なコードはすべてテスト済み（fork 全体で **1736 テスト成功**）。残っていたのは静的に到達不能な防御コードで、削除を基本とし、fs 境界・未信頼 JSON・ライフサイクル不変条件の 5 箇所だけ根拠付き `/* v8 ignore next -- ... */` を付けた。
- 併せて、既存の型エラー（committed fork テスト 21 件）を修正し、`tsc -b host+client` も 0 エラーにした。

## フォローアップ（2026-10-23）

### no-unknown-casts — 完了

- `packages/fork` の `as unknown` 42 件（src 12 / tests 30）を除去。テストのフェイクはパッケージごとの型付きヘルパーに集約し、src は構造的部分型・`unknown` 戻り値・`JSON.parse` の型注釈で解消。
- ゲート: `no new assertions; 1361 existing assertions remain`。テスト 1739 件、カバレッジ 100%、lint/JSDoc/jscpd すべて通過。

### dsh-TUI の運用組み込み — 完了

- `scripts/fork/setup-dsh-tui.mjs` を追加。インストール済みパッケージに対して、初回ウィザードのスキップ（`~/.dsh-tui/onboarding.json`）、言語の英語固定（`lang.json`）、コマンド説明の英語補完（i18n パッチ）を冪等に実行する。`ash` インストーラから呼ぶ想定。

### web-anago の subagent-pi 行 — 完了

- per-call 指定が可能になったため、`web-anago` の `subagent-pi` 行の `provider`/`model` 固定を削除。

## TUI: dsh-TUI（ccch1mneyyy）の検証 — 完了

- 検証ホームに `profiles/dsh-tui` を作成: `dsh-base` + `@deepseek-harness-tui/dsh-tui` 0.16.1 + `@mars-sea/dsh-commandcode-provider` + `@anago-harness/anago-core`（126 行）。
- インストールは `pnpm` が PATH に必要だったため、corepack 版への一時シムを用意した。
- 実 PTY（tmux）で確認:
  - 初回ウィザード（API キー/言語/モデル/ショートカット）→ Esc でスキップ
  - `/help` に `/compact` ほかのコマンド一覧
  - `/plugin list`（インストール済みバンドルのみ表示、プラグイン管理の入口）
  - `/settings`（49 ページ。Command Code の接続/モデル、dsh-tui の外観・言語・Launchpad など）
  - ツール呼び出し: `Bash(echo dsh-tui-ok)` のカードと結果を表示
  - `/compact`: 「Session summary is ready」→ コンテキストが 14k → 6.2k に減少
  - anago-core 併用時は日本語で応答（response-language が有効）
- 起動: `DSH_HOME=~/.dsh-anago-trial node apps/cli/lib/bin.js --profile dsh-tui`
- DeepSeek API キーは不要。初回ウィザードは `~/.dsh-tui/onboarding.json` に `{"completed":true,"version":1}` を置くと永続的にスキップでき、起動直後に入力欄が出る（コード修正は不要）。将来的に `ash` のインストーラでこのファイルを未作成時のみ書けば、利用者はウィザードを見ずに済む。
- モデルはプロファイル patch の `agent-default-model`（commandcode）で固定。`/setup` を実行しない限り DeepSeek の経路は使われない。
- 本番ホームを置き換え済み（2026-10-23）:
  - `~/.dsh/profiles/tui` = `dsh-base` + `@deepseek-harness-tui/dsh-tui` + `commandcode` + `anago-core`（126 行）
  - `~/.dsh/profiles/tui-pi` = `dsh-base` + `anago-core` + `anago-tui` + `commandcode`（pi-tui ベース。2026-10-24 にプロファイルを削除。パッケージと `anago-tui` バンドルはリポジトリに残る）
  - `~/.dsh/profiles/tui-oc` = 旧 dsh-oc-tui プロファイル（退避）
- 中国語表示の修正: `lib/types/i18n.js` の `cmd-desc-*` 60 キーに英語がなく、英語モードで中国語へフォールバックしていた。`scripts/fork/patch-dsh-tui-i18n.mjs` が `commands.js` の英語説明から `en` を補完する（冪等、更新後に再実行）。本番・検証の両プロファイルに適用済みで、`en` 欠落キーは 0。
- ステータスバーの中国語: `dsh-working-activity` の言語解決が `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → OS ロケール → **zh** の順で、この環境は `LANG=ja_JP.UTF-8` のため中国語に落ちていた（プラグインの進捗コピーと、モデルに注入する `⏵` 自己ナレーション指示の両方）。`~/.dsh-tui/lang.json` に `{"lang":"en"}` を置いて英語に固定。確認: 進捗行は `Executing sleep 6; echo finished · 5s`、完了時は `Finished`。`⏵` の内容自体は response-language により日本語。`ash` のインストーラでも未作成時にこのファイルを書く。

## 実機検証（3081）— サーバ側は完了

検証環境: `~/.dsh-anago-trial` / `--profile web` / `--port 3081`。現行 3080 は無変更。

| 確認項目 | 結果 |
|---|---|
| 組成 | `--dump-config` に anago-core / anago-web / locale(ja) / anago-locale-ja / anago-fonts / subagent-pi / tool-subagent-pi |
| ブートグラフ | `window.__DSH_BOOT__` に `@anago-harness/client-ui-fonts-anago`（7.47 MB）を確認 |
| フォント | 配信バンドルに `UDEV Gothic` と `data:font/woff2` 8 件、`Anago Gothic` 0 件 |
| 検索 | headless で `web_search` → Brave 経由で実 URL を取得 |
| メモリ | headless で `memory` 追記 → `~/.dsh-anago-trial/memories/USER.md` に反映 |
| サブエージェント | `subagent_pi` → 子の出力 `PI_OK` |
| スナップショット | `anago-{memory,wiki,search}` 3/3 をキーなしで replay |
| TUI（実 PTY） | `script` で PTY を割り当てて起動 → 2.6 KB の描画（ANSI・罫線・日本語フッター）を確認、クラッシュなし |
| ブラウザ描画（ヘッドレス Chrome） | `lang="en"`、本文は英語（Into the Unknown / Preview / Choose workspace / Standard mode） |
| フォント適用 | `getComputedStyle` = `"UDEV Gothic", "Noto Sans JP", ...`、`document.fonts.check('16px "UDEV Gothic"')` = true、スクリーンショットで日本語グリフを確認 |

残るのは**ブラウザでの見た目確認**（日本語表示・UDEV Gothic・xterm の全角幅）のみ。

## 切り替え準備（完了）

- 本番ホーム `~/.dsh` に新プロファイル `profiles/web-anago` を作成済み（`profiles/web` は無変更）。
  - バンドル: `dsh-base` / `dsh-web-app` / `anago-core` / `anago-web` / `dsh-commandcode-provider`
  - 設定: モデル `commandcode`、検索 Brave、`agentsHome`、`subagent-pi`（openai/gpt-6-astra）、セッションログ無効
  - `--dump-config` で 203 行、`locale ja` / `anago-locale-ja` / `anago-fonts` / `subagent-pi` を確認
- 起動コマンド: `node apps/cli/lib/bin.js --profile web-anago --host 100.110.252.31 --port 3080 --no-open`
- ロールバック: `~/.local/bin/dsh --profile web --host 100.110.252.31 --no-open`

## subagent_claude_code の導入（2026-10-23）

- `web-anago` と検証 `headless` に導入し、実機で `CLAUDE-E2E-OK` を確認。
- コマンド（**バージョン固定が必須**。npm の `latest` は 0.0.1-rc.1 で 0.2.1-rc.2 非対応、`next` が 0.2.1-rc.2）:
  - `dsh plugin --profile web-anago add @deepseek-ai/dsh-subagent-claude-code@0.2.1-rc.2`
  - `dsh plugin --profile web-anago add @mars-sea/dsh-commandcode-provider@0.14.1`（プロファイルの依存として明示。未宣言だと plugin install で消える）
- `subagent-claude-code` / `tool-subagent-claude-code` 行が組成に追加され、`claude` CLI 2.1.309 を使用。

## 日本語注入の強化（2026-10-23）

- 中国語の応答を確認。セッションログでは日本語指示は各リクエストに含まれていた（注入自体は機能）。静的セクションだけでは、中国語の過去応答を含む文脈に負けることがある。
- `response-language` に **毎リクエストの runtime context リマインダ**（`response-language:runtime`、最後のコンテキスト位置、`required: true`）を追加。文言で「過去の非日本語の assistant メッセージ・ツール出力・要約・メモは先例として無視する」と明示。
- 検証: headless のリクエストにリマインダが入ることをログで確認。テスト 1741 件、カバレッジ 100%。
- 併せて `session-log-deepseek` を無効化（`deepseek-llm-api-extensions` 無効化に伴う pending 警告の解消）し、egress-guard テストを NODE_OPTIONS 非継承にした（フォークの web プロセス内でも決定的に動く）。

## Web UI の DeepSeek 依存除去（2026-10-23）

- ブラウザから CN ドメインへアクセスする行を構成から削除（Node の egress guard はブラウザ通信を遮断できないため）。
  - ホスト（anago-core）: `deepseek-account` / `llm-deepseek-account` / `message-feedback` / `command-feedback` / `session-telemetry-otel` / `plugin-package-inventory-deepseek` / `web-search-deepseek` / `web-deepseek-api` / `deepseek-llm-api-extensions` / `llm-deepseek`
  - Web（anago-web）: `ui-settings-account` / `account-controller` / `ui-message-feedback` / `ui-deepseek-model-label-1017`
- 検証: 更新後の構成を 3082 で起動し、ヘッドレス Chrome で確認 → ログイン/アカウント/フィードバックの操作要素 0、`deepseek.com` リンク 0。
- 反映には `anago-web.service` の再起動が必要（再起動後に `anago-web-url` で新しい URL を取得）。

## 3080 切り替え — 完了（systemd 移行込み）

- 2026-10-23 15:54 に切り替え完了。3080 はフォーク（`web-anago` プロファイル）で稼働。
- systemd: `anago-web.service`（`~/.local/bin/anago-web-tailnet` → チェックアウトの `apps/cli/lib/bin.js --profile web-anago`、`Restart=always`、ログは `/tmp/anago-web.log`）。旧 `dsh-web.service` は **disabled**。
- URL コマンド:
  - `anago-web-url` … `/tmp/anago-web.log` から最新トークンを読み、HTTP で検証して表示。`--restart` / `--qr` 対応。
  - `dsh-web-url` … 互換シム。`anago-web.service` が active なら `anago-web-url`、そうでなければ `dsh-web-url.legacy`（旧 journal 版）へ委譲。旧サービスへのロールバックでもそのまま使える。
- ロールバック: `systemctl --user disable --now anago-web.service; systemctl --user enable --now dsh-web.service`
- 注意: 前回の切り替えは `dsh-web.service` の `Restart=always` が旧 dsh を再起動して失敗していた。今回のようにユニットごと移行するのが正しい手順。

## Web / TUI セッション共有（2026-10-23）

- 閲覧は書き込みにしない: `session/follow` に `mode: 'activate' | 'read'` を追加。Web クライアントは常に `read` で開き、Agent を resume しない。`SessionObservation.savedCursor` を保存済み末尾の基準にし、合成 closer を cursor に使わない。
- 所有権は advisory: `SessionPersistence.ownership()` が `free` / `owned-here` / `held-elsewhere` / `missing` / `unknown` を返す（ディレクトリもロックファイルも作らない）。最終判定は従来の flock。
- ターン外解放: `releaseOnIdle` / `releaseIdleDelayMs` / `releaseRetryMs`。idle + inbox 空 + 子 Agent なし + `ctx.agents.hold()` 0 + admission なしで `AgentHandle` を dispose。memory review と goal round driver は hold を取る。`anago-web` で 250ms 遅延の有効化。
- 切り離しと削除の分離: `api-session/detached` を追加し、通常セッションの Agent 終了では行・履歴・draft を保持。durable subagent 行のみ `removed`。
- Web read-only: 新 `@anago-harness/client-ui-session-share` が 1 秒ごとに ownership を確認し、`held-elsewhere` で composer を `lock: 'all'`（モデル席も停止）。`remote` と `remote.session` の両 inject が必須（property proxy の規則）。
- TUI: `/resume` の行をグレー表示＋理由、選択拒否。`--resume` は同一理由で exit 1。切替は「新セッションを開いてから旧 Agent を破棄」に変更。
- ライブ追従: read モードの follower が `stat().revision` を 500ms で確認し、変化時のみ既存 read で差分取得。実測: 検知 3 ms / 差分 read 1 ms。
- 実機検証: 3080 が保持するセッションを 3081 の Web UI（Chromium）で開き、read-only 理由の表示と composer 不活性を確認。TUI `--resume` も同じ理由で拒否。3080 のセッションには影響なし。
- コミット: `8890d47b80`（機能）、`581d6e9352`（docs:build）、`aa8f8d786c`（テスト）、`9729cc3cab`（policy）、`71b3478886`（remote inject）、`0767309a7e`（TUI 拒否）。
- 残作業（環境要因）: `anago-web` 再起動後に TUI 保持 → Web read-only → TUI 終了で解禁 → Web ターン終了後の `flock` 解放を手動確認。5 件の headless スナップショットは HEAD `36580d63d1` のリマインダー追加に伴い再録音が必要（API キー必須）。`vendor rescope` は fork 移植時の既存 20 箇所。

## TUI の起動コマンド（2026-10-24）

- PATH 上の `dsh` は公開 CLI（`~/.local/lib/node_modules/@deepseek-ai/dsh`）で、フォークの private workspace bundle（`@anago-harness/*`）を解決できない。`dsh tui` は `@anago-harness/anago-core` を **skip** し、memory / wiki / Brave / Exa / response-language 抜きで起動する。
- 対策: `~/.local/bin/anago`（リポジトリの `apps/cli/lib/bin.js` を exec するラッパー）を追加。`anago tui` / `anago web-anago …` はフォーク CLI で起動し、bundle を解決する。チェックアウト内なら `pnpm dsh --profile tui` でも同じ。
- `anago-core` が web 専用 row `message-feedback` を無効化していたため TUI 構成で「patch: entry not found」警告が出ていた。無効化を `anago-web` へ移し、`tui` / `web-anago` の dump で警告ゼロを確認（`dsh-tui` 自身の `tool-ralph` 警告のみ残るが、これは外部 bundle のもので無害）。
