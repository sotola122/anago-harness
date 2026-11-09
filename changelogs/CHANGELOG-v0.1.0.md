# Anago v0.1.0

- リリース日: 2026-11-04
- 上流ベース: [`dsh-v0.2.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)
- ブランチ / タグ: `releases/anago-v0.1.0` / `anago-v0.1.0`

Anago として最初の独立バージョン。ワークスペース全体を上流 `dsh-v0.2.2-rc.1` に同期し、
Anago 独自のリリース番号とリリースブランチ運用を開始した。

## Added

- Anago 独自バージョンの管理: `ANAGO_RELEASE.json`（`anagoVersion` と、そのリリースが
  基づく `upstreamVersion` / `upstreamCommit`）と `releases/anago-v<version>` 運用を定めた
  ([#17](https://github.com/sotola122/anago-harness/pull/17))。
- 上流取り込み手順書 [UPSTREAM_MIGRATION.md](../UPSTREAM_MIGRATION.md): 手順、再適用対象、
  生成物、既知の失敗、ライブホストの運用ガード
  ([#13](https://github.com/sotola122/anago-harness/pull/13),
  [#15](https://github.com/sotola122/anago-harness/pull/15))。

## Changed

- 上流 `dsh-v0.2.2-rc.1` へ同期。フォーク 16 パッケージと `packages/preset/orchestrator-policy`
  の `version` を `0.2.2-rc.1` に統一し、パッケージ版は下流プラグインとの互換契約として
  上流に追随させる方針を確認した
  ([#18](https://github.com/sotola122/anago-harness/pull/18))。
- 同期に伴う記録済みセッションのスナップショット、設定・ツール・永続化カタログを再生成。

## Migration

- 既存プロファイルはパッケージ版が `0.2.2-rc.1` に変わるため、利用中のプラグインが
  `engines.dsh` / peer 依存で `0.2.2-rc.1` を許容するか確認する。許容しないプラグインは
  Loader が起動時にスキップする（例: `@mars-sea/dsh-commandcode-provider@0.15.4`）。
