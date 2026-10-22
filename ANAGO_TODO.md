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

### 2. pi-subagent にモデル指定がなく実行できない

- 指摘: `subagent_pi` がモデル引数を持たず失敗する。
- 原因: プロバイダが `agentOptions` 非対応（`NO_START_CAPABILITIES`）で、per-call の provider/model を受け取れなかった。加えて既定では Pi 自身の既定モデル（この環境では 429 のルート）を使っていた。
- 対応:
  - `capabilities.agentOptions: true` にし、`agentOptions.provider` / `model` / `reasoningEffort` を `--provider` / `--model` / `--thinking` に写像。
  - `agentOptions.maxTokens`（Pi に該当フラグなし）と、Pi の語彙外の reasoningEffort は**黙って無視せず拒否**。
  - 行の `provider` / `model` を既定ルートとして併用可（両方そろったときだけ `agentRouteDefaults` を公開）。
  - 検証環境の `subagent-pi` 行に `provider: openai` / `model: gpt-6-astra` を設定。
- 受入: `subagent_pi` に「PI_OK を返せ」と委譲 → 子の出力 `PI_OK` を取得（3081 の headless で確認）。
- 備考: モデルの per-call 選択を UI から使うには Host 設定 `subagent-model-selection`（`enabled: true` と `allowedModels`）が必要。行の config だけでも既定ルートとして機能する。

### 3. UI の表示言語が中国語になる

- 指摘: anago harness の UI が中国語ベースで、漢字表記になっている。
- 原因: クライアントは en / zh の 2 言語のみ。ブラウザの言語がどちらにも一致しない場合の挙動が環境依存で、中国語が選ばれる場合があった。
- 対応: `anago-web` で `locale.preference: en` を既定に固定（ユーザーが明示的に選んだ場合はそちらが優先）。
- 受入: `--dump-config`（web）で `locale.config.preference: en` を確認。
- 未対応: **日本語 UI（ja ロケール）は未実装**。全パッケージの locale 辞書の翻訳が必要（項目 5）。

## 確認済み（バグではない）

### 4. cursor-subagent はモデルを固定していない

- 指摘: pi と同様に cursor もモデルを縛っていないか。
- 確認結果: `subagent-cursor` の `model` は未設定が既定で、`--model` は設定時のみ付与。**モデルを固定していない**（未設定なら Cursor CLI 自身の既定）。
- 制約: per-call のモデル選択は未対応。ツール側の `allowedModels` は DSH の provider/model ルートで、Cursor CLI のモデル名と名前空間が一致しないため、写像すると誤った値になる。必要なら CUR 専用のモデル設定を別途設計する（項目 12）。

## 対応済み（このラウンド）

### 5. 日本語 UI（ja ロケール）— 完了

- `@anago-harness/client-locale-ja` を追加し、`common`（41）、`settings`（41）、`settings.locale`（1）、`settings.shell`（14）、`settings.pluginInventory`（37）、`pluginManager`（220/221）、`settings.webSearchProviders`（35）の **389 キー**を日本語化。未訳キーは en へフォールバック。
- `anago-web` で `locale.preference: ja` を既定に固定。
- 検証: パッケージテスト 5 件、lint 0、tsc 成功、README ゲート通過。

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

## 実機検証（3081）— サーバ側は完了

検証環境: `~/.dsh-anago-trial` / `--profile web` / `--port 3081`。現行 3080 は無変更。

| 確認項目 | 結果 |
|---|---|
| 組成 | `--dump-config` に anago-core / anago-web / locale(ja) / anago-locale-ja / anago-fonts / subagent-pi / tool-subagent-pi |
| ブートグラフ | `window.__DSH_BOOT__` に `@anago-harness/client-locale-ja`（34.5 KB）と `@anago-harness/client-ui-fonts-anago`（7.47 MB）を確認 |
| 日本語辞書 | 配信バンドルに「キャンセル」等の日本語キーを確認 |
| フォント | 配信バンドルに `UDEV Gothic` と `data:font/woff2` 8 件、`Anago Gothic` 0 件 |
| 検索 | headless で `web_search` → Brave 経由で実 URL を取得 |
| メモリ | headless で `memory` 追記 → `~/.dsh-anago-trial/memories/USER.md` に反映 |
| サブエージェント | `subagent_pi` → 子の出力 `PI_OK` |
| スナップショット | `anago-{memory,wiki,search}` 3/3 をキーなしで replay |
| TUI（実 PTY） | `script` で PTY を割り当てて起動 → 2.6 KB の描画（ANSI・罫線・日本語フッター）を確認、クラッシュなし |

残るのは**ブラウザでの見た目確認**（日本語表示・UDEV Gothic・xterm の全角幅）のみ。

## 切り替え準備（完了）

- 本番ホーム `~/.dsh` に新プロファイル `profiles/web-anago` を作成済み（`profiles/web` は無変更）。
  - バンドル: `dsh-base` / `dsh-web-app` / `anago-core` / `anago-web` / `dsh-commandcode-provider`
  - 設定: モデル `commandcode`、検索 Brave、`agentsHome`、`subagent-pi`（openai/gpt-6-astra）、セッションログ無効
  - `--dump-config` で 203 行、`locale ja` / `anago-locale-ja` / `anago-fonts` / `subagent-pi` を確認
- 起動コマンド: `node apps/cli/lib/bin.js --profile web-anago --host 100.110.252.31 --port 3080 --no-open`
- ロールバック: `~/.local/bin/dsh --profile web --host 100.110.252.31 --no-open`

## 3080 切り替え（ユーザー確認待ち）

手順（現行を止める前に、必ず 3081 で見た目を確認する）:

1. 現行プロファイルを退避: `cp -a ~/.dsh/profiles/web ~/.dsh/profiles/web.pre-anago`
2. 切り替え: `~/.dsh` をそのまま使う場合、`profiles/web` を anago 構成へ移行する（`dsh rescue --from-default-profile web` 相当 + 設定の再適用）。別ホーム運用なら `DSH_HOME=~/.dsh` のまま新プロファイル `web-anago` を作り、`--profile web-anago` で起動する。
3. 停止と起動: 現行 PID を停止 → `node apps/cli/lib/bin.js --profile web-anago --host 100.110.252.31 --port 3080 --no-open`
4. ロールバック: 旧コマンド `~/.local/bin/dsh --profile web --host 100.110.252.31 --no-open` を再実行し、退避したプロファイルを戻す。

注意: 3080 の停止は**このセッションと GUI を切断する**。実施はユーザーの明示的な指示で行う。
