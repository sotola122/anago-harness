/**
 * `settings` dictionaries: the settings shell and General page
 * (`ui-settings-general`), the Language row (`settings.locale`), and the
 * shell-executor page (`settings.shell`).
 */

/** Japanese dictionary for the `settings` namespace (settings shell and General page). */
export const settingsJa = {
  'trigger': '設定',
  'shortcut.open': '設定を開く',
  'desktop.update.available': '更新',
  'desktop.update.checking': '更新を確認しています…',
  'desktop.update.progress': '{percent}%',
  'desktop.update.verifying': '更新ファイルを検証しています…',
  'desktop.update.installing': '再起動の準備をしています…',
  'desktop.update.ready': 'インストールして再起動',
  'desktop.update.retry': '更新を再試行',
  'desktop.update.versionDetail': '{label}：{version}',
  'desktop.update.downloadDetail': '更新をダウンロード中：{percent}%\n対象バージョン：{version}',
  'desktop.update.checkFailed': '更新を確認できませんでした。しばらくしてから再試行してください。',
  'desktop.update.downloadFailed': '更新をダウンロードできませんでした。再試行してください。',
  'desktop.update.installFailed': '更新をインストールできませんでした。しばらくしてから再試行してください。',
  'desktop.update.checkNetworkFailed': '更新を確認できませんでした。接続を確認して再試行してください。',
  'desktop.update.downloadNetworkFailed': '更新をダウンロードできませんでした。接続を確認して再試行してください。',
  'desktop.update.installNetworkFailed': '更新をインストールできませんでした。接続を確認して再試行してください。',
  'desktop.update.stopFailed': 'タスクを安全に停止できなかったため、更新はインストールされていません。しばらくしてから再試行してください。',
  'desktop.update.tasksChanged': '新しいタスクが開始されました。タスクを停止して更新するかどうか、もう一度確認してください。',
  'desktop.update.tasksUnavailable': 'タスクの状態を確認できません。ワークスペースが準備できてから更新を再試行してください。',
  'title': '設定',
  'close': '閉じる',
  'openDocument': '設定ファイルを開く',
  'openDocument.error': '設定ファイルを開けませんでした',
  'general.nav': '一般',
  'general.currentVersion': '現在のバージョン：{version}',
  'developerTools.title': 'コード作業ビューを表示',
  'developerTools.error': '保存できませんでした。再試行してください。',
  'developerTools.description': '実行の軌跡、今回のコード差分、すべての Agent プリセットを表示します',
  'connection.error': '接続が切断されました',
  'connection.connecting': '再接続中',
  'connection.connected': '接続済み',
  'connection.reconnect': '接続が切断されました。今すぐ再接続',
  'connection.restart': '再接続中です。今すぐ再接続',
  'hostRelease.title': 'サービスバージョンが変更されました',
  'hostRelease.description': 'サービスバージョンが変更されました。このページのライブ更新は停止しています。再読み込みして新しいバージョンを読み込んでください。',
  'hostRelease.service': 'サービス',
  'hostRelease.page': 'ページ',
  'hostRelease.unknown': '不明',
  'hostRelease.reload': '再読み込みして新しいバージョンを反映する',
  'hostRelease.later': '後で',
}

/** Japanese dictionary for the `settings.locale` namespace (the Language row). */
export const localeJa = {
  'language.title': '言語',
}

/** Japanese dictionary for the `settings.shell` namespace (shell executor settings page). */
export const shellJa = {
  'title': 'シェル',
  'description': '各コマンドの実行時間と出力量の上限を設定します。',
  'timeoutMs': 'コマンドのタイムアウト（ミリ秒）',
  'timeoutMsHint': '1 つのコマンドを終了するまで実行できる時間。',
  'maxOutputBytes': 'ストリームごとの出力上限（バイト）',
  'maxOutputBytesHint': '上限を超えた出力は失われず、一時ファイルに退避されます。',
  'overridden': '上書き済み',
  'reset': '既定に戻す',
  'readOnly': 'この環境では設定が読み取り専用です。',
  'unavailable': 'このプラグインは読み込まれていないため、現在は設定できません。',
  'save': '保存',
  'saving': '保存中…',
  'saveFailed': 'この環境は値を受理しませんでした。修正できるよう値を残しています。',
  'invalidNumber': '数値を入力するか、空欄のまま既定値を使用してください。',
}
