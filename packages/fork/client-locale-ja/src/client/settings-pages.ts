/**
 * Small settings-page dictionaries: Appearance and fonts
 * (`settings.theme`), the Built-in plugins section (`settings.plugins`), the
 * Agent loop page (`settings.agentLoop`), the Subagent page
 * (`settings.subagent`), and the Session-log upload row
 * (`session-log-deepseek`).
 */

/** Japanese dictionary for the `settings.theme` namespace. */
export const themeJa = {
  'appearance.title': '外観',
  'appearance.light': 'ライト',
  'appearance.dark': 'ダーク',
  'appearance.system': 'システム',
  'fontSize.text.title': '文字サイズ',
  'fontSize.text.description': '会話の内容にのみ適用されます',
  'fontSize.text.increase': '文字サイズを大きくする',
  'fontSize.text.decrease': '文字サイズを小さくする',
  'fontSize.code.title': 'コードの文字サイズ',
  'fontSize.code.description': 'コードブロック、インラインコード、ツールの出力に使用されます',
  'fontSize.code.increase': 'コードの文字サイズを大きくする',
  'fontSize.code.decrease': 'コードの文字サイズを小さくする',
  'fontSize.terminal.title': 'ターミナルの文字サイズ',
  'fontSize.terminal.description': 'サイドバーのターミナルに使用されます',
  'fontSize.terminal.increase': 'ターミナルの文字サイズを大きくする',
  'fontSize.terminal.decrease': 'ターミナルの文字サイズを小さくする',
  'fontSize.unit': 'px',
  'fontFamily.text.title': '本文フォント',
  'fontFamily.text.description': 'インターフェースと会話の本文に使用されます。フォントはカンマで区切ります。空欄の場合は既定のフォントを使用します',
  'fontFamily.code.title': 'コードフォント',
  'fontFamily.code.description': 'コードブロック、インラインコード、ツールの出力に使用されます。フォントはカンマで区切ります。空欄の場合は既定のフォントを使用します',
  'fontFamily.terminal.title': 'ターミナルフォント',
  'fontFamily.terminal.description': 'サイドバーのターミナルに使用されます。フォントはカンマで区切ります。空欄の場合は既定のフォントを使用します',
  'fontFamily.placeholder': '既定',
  'fontSize.more': 'その他のフォント設定',
}

/** Japanese dictionary for the `settings.plugins` namespace. */
export const pluginsSettingsJa = {
  'nav': '組み込みプラグイン',
  'title': '組み込みプラグイン',
  'intro': 'この配備に含まれるプラグインを確認します。',
  'tabs': 'プラグインの表示',
  'empty': 'この配備には表示できるプラグインビューがありません。',
}

/** Japanese dictionary for the `settings.agentLoop` namespace. */
export const agentLoopJa = {
  'title': 'エージェントループ',
  'description': 'エージェントがツール呼び出しを分配する方法を設定します。',
  'maxParallel': '並列ツール呼び出し',
  'maxParallelHint': '1 ステップ内で同時に実行できる並列安全な呼び出しの上限です。',
  'overridden': '上書き済み',
  'reset': '既定に戻す',
  'readOnly': 'この配備では設定を読み取り専用で保存します。',
  'unavailable': 'このプラグインは読み込まれていないため、現在は設定できません。',
  'save': '保存',
  'saving': '保存中…',
  'saveFailed': 'この配備は値を受理しませんでした。修正できるよう値を残しています。',
  'invalidNumber': '数値を入力するか、空欄のまま既定値を使用してください。',
}

/** Japanese dictionary for the `settings.subagent` namespace. */
export const subagentSettingsJa = {
  'overridden': '上書き済み',
  'reset': '既定に戻す',
  'readOnly': 'この配備では設定を読み取り専用で保存します。',
  'unavailable': 'このプラグインは読み込まれていないため、現在は設定できません。',
  'save': '保存',
  'saving': '保存中…',
  'saveFailed': 'この配備は値を受理しませんでした。修正できるよう値を残しています。',
  'subagentTitle': 'サブエージェント',
  'subagentDescription': 'サブエージェントの再帰の深さ、数、モデルを設定します。',
  'subagentLimitsTitle': '制限',
  'subagentMaxDepth': '最大再帰深度',
  'subagentDepthHelpLabel': '最大再帰深度について',
  'subagentDepthHelp': 'エージェントが作成できるサブエージェントの階層数を制限します。',
  'subagentDepthZero': 'サブエージェントを無効化',
  'subagentDepthOne': 'メインエージェントのみサブエージェントを作成できます',
  'subagentDepthOverride': 'ツールが独自の最大再帰深度を定義している場合は、その設定が優先されます。',
  'subagentMaxActive': 'サブエージェントの並列数上限',
  'subagentCapacityHelpLabel': 'サブエージェントの並列数上限について',
  'subagentCapacityHelp': '同じメインエージェント配下で、すべての再帰階層を通じた稼働中のサブエージェント数の合計です。メインエージェントは含みません。上限に達すると新しい開始要求は拒否されます。',
  'subagentDepthInvalid': '0 以上の整数を入力してください。',
  'subagentCapacityInvalid': '1 以上の整数を入力してください。',
  'subagentModelSelectionTitle': 'モデルの選択',
  'subagentModelSelectionToggle': 'エージェントがサブエージェントのモデルを選択できるようにする',
  'subagentModelSelectionChoose': '有効にすると、エージェントは以下の許可されたモデルからサブエージェントごとにプロバイダー、モデル、推論レベルを選択できます。新しいセッションにのみ適用されます。',
  'subagentModelSelectionAllowed': 'エージェントが選択できるモデル',
  'subagentModelSelectionLoading': 'モデルを読み込んでいます…',
  'subagentModelSelectionLoadFailed': 'モデルを読み込めませんでした。',
  'subagentModelSelectionRetry': '再試行',
  'subagentModelSelectionPartial': '一部のモデルプロバイダーを読み込めませんでした。保存済みの選択は削除できます。',
  'subagentModelSelectionUnavailable': '現在利用できません',
  'subagentModelSelectionUnavailableGroup': '保存済みですが現在利用できません',
  'subagentModelSelectionEmpty': '現在モデルを公開しているプロバイダーはありません。',
  'subagentModelSelectionRequired': '保存する前にモデルを 1 つ以上選択してください。',
  'subagentModelSelectionConflict': '設定が別の場所で変更されました。下書きを破棄して再試行してください。',
  'subagentModelSelectionOff': 'サブエージェントは設定済みの既定値を使うか、親エージェントのモデルを継承します。保存済みのモデル選択は保持されます。',
}

/** Japanese dictionary for the `session-log-deepseek` namespace. */
export const sessionLogJa = {
  'title': '公式モデル API の使用時にセッションログをアップロード',
  'description': 'DeepSeek のモデルと製品の改善にご協力ください。',
  'saved': '設定を保存しました',
  'failed': '設定を保存できませんでした',
}
