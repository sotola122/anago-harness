/**
 * `common` dictionary — the shared shell vocabulary every feature reads
 * through the namespace-miss → `common` lookup step.
 */

import type { CommonKey } from '@deepseek-ai/dsh-client-locale/client'

/** Japanese dictionary for the `common` namespace, complete against `CommonKey`. */
export const commonJa: Record<CommonKey, string> = {
  'ok': 'OK',
  'cancel': 'キャンセル',
  'close': '閉じる',
  'copy': 'コピー',
  'copied': 'コピーしました',
  'codeBlock.title': 'コードブロック',
  'codeBlock.wrap': '行を折り返す',
  'codeBlock.unwrap': '行を折り返さない',
  'copy.failed': 'コピーできませんでした',
  'copy.value': '値をコピー',
  'copy.json': 'JSON をコピー',
  'copy.path': 'プロパティパスをコピー',
  'copy.prettyJson': '整形した JSON をコピー',
  'copy.compactJson': '圧縮した JSON をコピー',
  'copy.optionsHint': '{action}（右クリックでコピー方法を選択）',
  'retry': '再試行',
  'loading': '読み込み中…',
  'load.failed': '読み込みに失敗しました',
  'submit': '送信',
  'submitting': '送信中…',
  'next': '次へ',
  'previous': '前へ',
  'skip': 'スキップ',
  'delete': '削除',
  'edit': '編集',
  'save': '保存',
  'search': '検索',
  'more': 'その他',
  'collapse': '折りたたむ',
  'expand': '展開',
  'back': '戻る',
  'brand.localBuild': 'DSH ローカルビルド',
  'workspace.defaultName': '既定のワークスペース',
  'unknown': '不明',
  'none': 'なし',
  'truncated': '省略表示',
  'json.label': 'JSON',
  'markdown.footnotes': '脚注',
  'markdown.truncatedCharacters': '… {total} 文字で省略',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
}
