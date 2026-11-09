# Anago v0.1.1

- リリース日: 2026-11-09
- 上流ベース: `dsh-v0.2.2-rc.1`（`0.1.0` と同じ。上流の再同期はなし）
- ブランチ / タグ: `releases/anago-v0.1.1` / `anago-v0.1.1`

サブエージェント基盤の作り直し、Web UI の外観設定（フォント・テーマ・言語）、プロバイダ
利用量の可視化、プラグインのリポジトリ分離、検証用コンテナの常設化。

## Added

- **設定画面の Usage セクション**: Codex / OpenCode Go / GitHub Copilot / xAI の利用量を
  1 画面に表示する。Codex は `wham/usage` のプラン・使用量・クレジット・レート制限、
  OpenCode Go は rolling / weekly / monthly、Copilot はクォータ、xAI はベストエフォート。
  取得はセクションを開いたときと手動 Refresh のみで、30 秒の共有キャッシュを持つ
  ([#24](https://github.com/sotola122/anago-harness/pull/24),
  [#30](https://github.com/sotola122/anago-harness/pull/30))。
- **資格情報の `renew`**: `AuthorizationFlow.renew?()` / `AuthorizationService.renew(key, signal)`
  を追加。モデルリクエストと同じ資格情報キー・同じロックで更新するため、リフレッシュ
  トークンの二重ローテートが起きない
  ([#30](https://github.com/sotola122/anago-harness/pull/30))。
- **フォントの設定**: `text` / `code` / `terminal` のフォントをプロファイルから指定でき、
  設定画面では同梱フォント（UDEV Gothic / Noto Sans JP / Intel One Mono）とシステム
  スタックの一覧から選べる。空文字は上流の組み込みスタック
  ([#20](https://github.com/sotola122/anago-harness/pull/20),
  [#23](https://github.com/sotola122/anago-harness/pull/23))。
- **Gruvbox テーマ**: 外観設定に `gruvbox` を追加。シェル全体（サイドバー・会話・入力欄・
  コード・ツールカード・ダイアログ・スクロールバー・シンタックス）を Gruvbox のパレットで
  描画し、初回描画前から背景色を適用する
  ([#21](https://github.com/sotola122/anago-harness/pull/21))。
- **`dsh-plugins` リポジトリ**: fork プラグイン 17 パッケージを
  [dsh-plugins](https://github.com/sotola122/dsh-plugins) へ分離し、`plugins/` に git
  submodule として取り込んだ。ビルド・Typert・Vitest・カタログ生成・egress 走査の探索対象に
  `plugins/*` を追加
  ([#25](https://github.com/sotola122/anago-harness/pull/25))。
- **コンテナ検証ホスト**: `ci/verify-container/` に、このチェックアウトをイメージ内で
  ビルドして Web ホストを起動する検証環境を常設。資格情報は podman secret で渡し、
  起動時に書き込み可能な 0600 の資格情報ストアへ展開する
  ([#31](https://github.com/sotola122/anago-harness/pull/31))。

## Changed

- **subagent の seam**: 実行ごとの `permission_mode`、拒否されたツール呼び出しの診断、
  外部子の実行中に親 Agent を解放しないホールドを追加。`claude-subagent` は非対話実行の
  許可判定を `permissionPrompts: 'none'` に変更し、`init` のモード不一致と `timeoutMs`
  超過を失敗として扱う
  ([#19](https://github.com/sotola122/anago-harness/pull/19))。
- **委譲カード**: `subagent` / `subagent_fork` のカードに実効の provider / model /
  reasoning effort と、指名された category を表示
  ([#27](https://github.com/sotola122/anago-harness/pull/27))。
- **設定画面**: フォント一覧を開いた時点で展開。モバイルでは Enter を改行にし、送信は
  Send ボタンと Ctrl/Cmd+Enter に任せる
  ([#22](https://github.com/sotola122/anago-harness/pull/22))。
- **UI 言語**: `en` 固定を解除し、設定とブラウザ設定に従う（内蔵辞書は zh / en）
  ([#20](https://github.com/sotola122/anago-harness/pull/20))。
- `dsh-mobile-maxxing` をバンドル一覧から外した。

## Fixed

- purpose routing 経由で `permission_mode` が提供方に渡らず、`plan` などを指定しても既定
  モードで動いていた
  ([#32](https://github.com/sotola122/anago-harness/pull/32))。
- Usage の `timeoutMs` が資格情報ストアや renew の待ちに効かず、全行が loading のまま
  止まり得た（`plugins/ui-settings-usage`）
  ([#32](https://github.com/sotola122/anago-harness/pull/32))。
- モバイルで IME 確定に伴う Enter が送信になっていた
  ([#32](https://github.com/sotola122/anago-harness/pull/32))。
- `ci/verify-container` が gitignore 下の旧パスを参照し、新規クローンでビルドできなかった。
  併せて中国語版 README を追加し、`verify-translation-pairing` を green に戻した
  ([#32](https://github.com/sotola122/anago-harness/pull/32))。
- `build:check` の client 集約型チェックが落ちていたテスト 3 種の型エラー
  ([#26](https://github.com/sotola122/anago-harness/pull/26),
  [#28](https://github.com/sotola122/anago-harness/pull/28),
  [#29](https://github.com/sotola122/anago-harness/pull/29))。
- 検証コンテナを一時 systemd ユニットから起動すると cgroup 破棄で即終了する条件を
  README に明記
  ([#33](https://github.com/sotola122/anago-harness/pull/33))。

## Migration

- **プロファイルの `link:` 更新が必要**: fork プラグインは `packages/fork/<pkg>` から
  `plugins/<pkg>` へ移った。`~/.dsh/profiles/web-anago/package.json` の
  `@anago-harness/{xai-oauth,copilot-oauth,openai-codex-oauth}` の `link:` を新しいパスへ
  書き換え、プロファイルで `pnpm install` してからサービスを再起動する。
- 上流ファイルへの変更が増えた。次回上流同期では
  [UPSTREAM_MIGRATION.md](../UPSTREAM_MIGRATION.md) の Re-apply に従って再適用する
  （`ui-theme` の Gruvbox、`ui-sidebar-terminal` の端末フォント、`ui-conversation` の
  keymap、`credentials/authorization` の `renew`、`llm-pi-ai` の login ほか）。
- パッケージの `version` は上流互換のため `0.2.2-rc.1` のまま。Anago のバージョンは
  `ANAGO_RELEASE.json` のみで表す。
