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

## 進行中

### 9. カバレッジ 100%（段階）

- 到達可能なコードはテスト済み: fork 全体で **1731 テスト成功**、statements 99.6% / branches 97.6%。
- 残りは静的に到達不能な防御コード（`?? fallback`、regex グループ、二重 settle ガードなど）。削除または根拠付き `/* v8 ignore */` で 100% にするクリーンアップを実行中。
- 受入: `vitest run packages/fork --coverage --coverage.include='packages/fork/**/src/**/*.{ts,tsx}'` が ERROR なし、全ファイル 100%。

## 未着手（優先度順）


### 5. [P1] 日本語 UI（ja ロケール）

- 内容: `LOCALE_IDS` は `['zh', 'en']`。ja を足すには全クライアントパッケージの locale 辞書（en/zh の対）を日本語化し、`LocaleNamespaceMap` の各エントリを揃える必要がある。
- 受入: ブラウザ言語 ja で UI が日本語。`verify-client-ui-i18n` と pairing ゲートが通る。
- 規模: 大（クライアント 30 パッケージ超）。

### 6. [P1] 日本語フォント

- 内容: PROJECT_GUIDELINE §6.4 の未実装。UDEV Gothic（かな・漢字、`unicode-range`）と Intel One Mono（欧文）、Noto Sans JP（可変 woff2 を range 分割）、OFL.txt 同梱、xterm の再計測確認。
- 受入: Web UI・デスクトップ・インストーラで指定フォント。全角幅が xterm で 2 セルとして扱われる。
- 現状: 既定フォントのまま。

### 7. [P1] ツールカタログへの fork ツール掲載

- 内容: `memory` / `wiki_write` / `wiki_search` / `wiki_lint` / `subagent_cursor` / `subagent_pi` が `docs/tool-catalog.md` に未掲載。`gen-tool-catalog` の boot manifest に `mount` レシピ付きで追加する。
- 受入: `gen-tool-catalog --check` とカタログの記載が一致。

### 8. [P1] フォーク固有スナップショット 3 本

- 内容: メモリ注入・wiki 通知・検索プロバイダ選択。upstream 由来の 214 本は互換 layer で維持済みだが、フォーク構成そのものの統合検証は未実施。
- 受入: `test:snapshot` でフォーク構成の 3 本が再生可能（録音にはモデルキーが必要）。

### 9. [P2] カバレッジ 100%（段階）

- 内容: `packages/fork` の per-file 100%。現状は移設テストのみで、`coverage.exclude` への追加も未実施。設計 §8.2 の段階計画（追加ファイル 100%、除外は縮小のみ、最終フェーズでゼロ）で進める。

### 10. [P2] client 半の manifest 契約テスト

- 内容: 設計 §8.1 で約束した `packages/fork/client-ui-settings-web-search/tests/manifest.spec.ts`（`dsh.client.platform === 'web'`、`exports['./client']`、CSS Modules 不使用、`inject` と peer 依存の一致）が未実装。

### 11. [P2] Exa の `numResults` の扱い

- 内容: `web_search` ツールが常に `maxResults` を渡すため、Exa の `numResults` 設定は通常経路で効かない。要求上限へ配線するか、カードから項目を外す。

### 12. [P2] cursor のモデル選択（必要なら）

- 内容: Cursor CLI のモデル名を安全に指定できる設定（例: `subagent-cursor.config.model`）は既にある。ツールからの per-call 選択は名前空間の不一致により未対応。必要になった時点で、カーソル専用の allowed 設定を設計する。

### 13. [P2] 設計・記録の整合

- 内容:
  - 互換 patch の「warn + skip」を boot 側の `applyEntryPatches` で確認する。
  - persistence 記録の「optional message source」を「unknown producer discriminator」に直す。

### 14. [P2] TUI の拡張

- 内容: ツールカード、モデル・セッション選択、スラッシュコマンド、推論ブロック、使用量、alt-screen のスクロール、画像、実 PTY 確認（README の Known Limitations に列挙）。

### 15. [P2] 実機検証と切り替え判断

- 内容: 3081 の UI で Plugins（anago バンドル / Exa・Brave カード / `subagent_pi`）、検索、メモリ、`/wiki` を確認。問題なければ 3080 をフォークへ切り替える（旧プロファイルは退避）。
- 受入: 3081 での確認項目がすべて通り、切り替え手順とロールバックが文書化されている。
