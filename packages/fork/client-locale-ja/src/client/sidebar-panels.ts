/**
 * Sidebar panel dictionaries: the right Sidebar dock
 * (`sidebarRight`), the terminal tab (`sidebarTerminal`), the file tree
 * (`sidebarFiles`), and the document tab with its per-format renderers
 * (`sidebarDocumentPreview`, `sidebarCodePreview`, `sidebarExcel`,
 * `documentHtml`, `sidebarImage`, `documentMarkdown`, `sidebarOffice`,
 * `sidebarPdf`).
 */

/** Japanese dictionary for the `sidebarRight` namespace. */
export const sidebarRightJa = {
  'command.close': '現在のページまたはウィンドウを閉じる',
  'command.refresh': '現在のページを更新',
  'command.noRefresh': 'このページは更新できません',
  'command.toggle': '右サイドバーを開閉',
  'command.fullscreen': 'パネルの全画面表示を切り替え',
  'command.noSession': '先にセッションを選択してください',
  'command.noFocus': '先に右サイドバーのペインをフォーカスしてください',
  'command.stale': 'ページが変更されました。もう一度フォーカスしてください',
  'command.collapsed': '先に右サイドバーを展開してください',
  'command.float': 'フローティングパネルではこの操作は使用できません',
  'command.empty': '先にページを開いてください',
  'command.budget': 'ペインは 2 つまでです',
  'command.width': '分割する幅が足りません。サイドバーを広げてください',
  'chrome.expand': 'サイドバーを開く',
  'chrome.expandAria': '右サイドバーを開く',
  'chrome.collapse': 'サイドバーを折りたたむ',
  'chrome.collapseAria': '右サイドバーを折りたたむ',
  'chrome.toFullscreen': '全画面表示',
  'chrome.exitFullscreen': '全画面表示を終了',
  'dock.emptyPane': '空のペイン',
  'dock.splitPane': '分割',
  'dock.splitPaneDisabled': 'ペインは 2 つまでです',
  'dock.splitPaneNarrow': '分割する幅が足りません。サイドバーを広げてください',
  'dock.closeTab': '閉じる',
  'dock.addTab': '新しいタブ',
  'dock.dockFloat': 'サイドバーに戻す',
  'dock.closeFloat': '閉じる',
  'dock.drop.center': 'ここに移動',
  'dock.drop.left': '左に分割を追加',
  'dock.drop.right': '右に分割を追加',
  'dock.drop.top': '上に分割を追加',
  'dock.drop.bottom': '下に分割を追加',
  'tab.guide.title': 'はじめに',
  'tab.unavailable': 'この種類のコンテンツを表示できるものがまだありません。',
}

/** Japanese dictionary for the `sidebarTerminal` namespace. */
export const sidebarTerminalJa = {
  'shortcut.noSession': '先にセッションを選択してください',
  'recoveryFailed': 'ターミナルの復元に失敗しました：{message}',
  'retryRecovery': 'ターミナルの復元を再試行',
  'shell': 'シェルを選択',
  'shellLoading': 'シェルを読み込んでいます…',
  'shellEmpty': '利用できるシェルはありません',
  'description': 'セッションのワークスペースでコマンドを実行します',
  'title': 'ターミナル',
  'new': '新しいターミナル',
  'loading': 'ターミナル環境を読み込んでいます…',
  'creating': '開始しています…',
  'connecting': '接続しています…',
  'disconnected': '接続が切断されました。',
  'reconnect': '再接続',
  'readonly': 'この表示は読み取り専用です。',
  'control': '操作を引き継ぐ',
  'closed': 'ターミナルを閉じました。',
  'exited': 'プロセスが終了しました（{code}）',
  'failed': 'ターミナルエラー：{message}',
  'rename': 'ターミナル名',
  'unavailable': '利用不可',
  'retry': '再試行',
  'cleanupFailed': 'ターミナル「{title}」を終了できませんでした：{message}',
  'missingTerminal': 'このターミナルはもう存在しません。新しいターミナルを開いてください。',
  'inputFull': '入力バッファがいっぱいです。再接続して再試行してください。',
  'attachmentEnded': 'ターミナルの接続が終了しました。続けるには再接続してください。',
  'invalidOutput': 'ターミナル画面を受信できませんでした。再接続して復元してください。',
  'terminalLimit': 'ターミナルの上限に達しました。未使用のターミナルを閉じて再試行してください。終了したターミナルも上限に含まれます。',
}

/** Japanese dictionary for the `sidebarFiles` namespace. */
export const sidebarFilesJa = {
  'shortcut.noSession': '先にセッションを選択してください',
  'type.label': 'ファイル',
  'guide.title': 'ワークスペースのファイル',
  'guide.description': 'このセッションのワークスペース内のファイルを参照します',
  'loading': '読み込んでいます…',
  'empty': '空のディレクトリ',
  'truncated': '項目が多すぎるため、一部のみ表示しています。',
  'noWorkspace': 'このセッションにはワークスペースディレクトリがありません。',
  'reload': '再読み込み',
  'autoRefresh': '自動更新',
  'autoRefresh.enable': '自動更新を有効にする',
  'autoRefresh.disable': '自動更新を無効にする',
  'entry.other': 'ファイルでもディレクトリでもないため開けません。',
  'error.notFound': 'そのディレクトリは存在しません。移動または削除された可能性があります。',
  'error.outsideWorkspace': 'そのディレクトリはワークスペースの外にあるため、サイドバーでは読み取りません。',
  'error.notDirectory': 'ディレクトリではありません。',
  'error.unavailable': '読み取りに失敗しました：{message}',
}

/** Japanese dictionary for the `sidebarDocumentPreview` namespace. */
export const sidebarDocumentPreviewJa = {
  'loading': 'ドキュメントを描画しています…',
  'loadMore': 'さらに読み込む',
  'changed': 'ファイルが変更されました。以前の内容を表示しています。',
  'reloadNow': '再読み込み',
  'reload': 'ファイルを読み直す',
  'autoRefresh': '自動更新',
  'autoRefresh.enable': '自動更新を有効にする',
  'autoRefresh.disable': '自動更新を無効にする',
  'wrap.enable': '行の折り返しを有効にする',
  'wrap.disable': '行の折り返しを無効にする',
  'wrap.aria': '行の折り返し',
  'openWith': '別のアプリで開く',
  'viewer.text': 'プレーンテキスト',
  'resourceUnavailable': 'ファイルリソースサービスを利用できません。',
  'rendererUnavailable': '{name} のプレビューを利用できません。',
  'unsupportedFile': 'この種類のファイルはまだプレビューできません。',
  'error.notFound': 'ファイルが見つかりません。移動または削除された可能性があります。',
  'error.tooLarge': 'このページは {limit} の上限を超えているため読み取れません。',
  'error.notText': 'この種類のファイルはまだプレビューできません。',
  'error.notRegularFile': '通常のファイルではないため表示できません。',
  'error.unavailable': '読み取りに失敗しました：{message}',
  'retry': '再試行',
}

/** Japanese dictionary for the `sidebarCodePreview` namespace. */
export const sidebarCodePreviewJa = {
  'title': 'コード',
  'copy': 'コピー',
  'copied': 'コピーしました',
}

/** Japanese dictionary for the `sidebarExcel` namespace. */
export const sidebarExcelJa = {
  'title': 'スプレッドシート',
  'language': 'ja-JP',
  'loading': 'ドキュメントを描画しています…',
  'invalid': 'このスプレッドシートを開けませんでした。形式、内容、パスワード保護を確認してください。',
  'tooLarge': 'このブックはプレビューのサイズ上限を超えています。',
  'timeout': 'このブックを開く処理がタイムアウトしました。より小さいファイルをお試しください。',
  'encoding': 'この文字エンコーディングは読み取れませんでした。ファイルを BOM 付きの UTF-8 または UTF-16 で保存し、再試行してください。',
  'formulaWarning': 'このブックには数式が含まれています。表示される結果が欠けていたり不正確だったりする場合があります。',
  'unsupportedNotice': 'このプレビューはこのブックの {features} に対応していません。完全な表示にはシステムのアプリで開いてください。',
  'charts': 'グラフ',
  'images': '画像',
  'shapes': '図形',
  'conditionalFormatting': '条件付き書式',
  'featureSeparator': '、',
  'retry': '再試行',
}

/** Japanese dictionary for the `documentHtml` namespace. */
export const documentHtmlJa = {
  'title': 'HTML',
  'frame': 'HTML ドキュメントのプレビュー',
  'loading': 'ドキュメントを描画しています…',
  'failed': 'この HTML ドキュメントはプレビューできませんでした。',
}

/** Japanese dictionary for the `sidebarImage` namespace. */
export const sidebarImageJa = {
  'zoomControls': 'ズーム操作',
  'zoomMenu': 'ズームを選択',
  'zoomOut': '縮小',
  'zoomIn': '拡大',
  'zoomFitWidth': '幅に合わせる',
  'zoomValue': '{percent}%',
  'title': '画像',
  'preview': '画像プレビュー：{name}',
  'loading': 'ドキュメントを描画しています…',
  'failed': 'この画像を表示できませんでした。',
  'unsupported': '画像プレビューには完全なファイル内容が必要です。',
}

/** Japanese dictionary for the `documentMarkdown` namespace. */
export const documentMarkdownJa = {
  'viewer.label': 'Markdown',
  'code.copy': 'コピー',
  'code.copied': 'コピーしました',
  'footnotes': '脚注',
}

/** Japanese dictionary for the `sidebarOffice` namespace. */
export const sidebarOfficeJa = {
  'title': 'Office ドキュメント',
  'loading': 'ドキュメントを描画しています…',
  'retry': '再試行',
  'viewMissingFonts': '不足しているフォント：{count} 件。クリックして表示。',
  'missingFontsTitle': '不足しているフォント',
  'missingFontsDescription': 'これらのフォントはこのプレビューで利用できません。テキストとレイアウトが元のドキュメントと異なる場合があります。',
  'missingFontsCount': 'フォント：{count} 件',
  'closeDetails': 'フォントの詳細を閉じる',
  'unavailable': 'Office のプレビューを利用できません。DeepSeek Harness を実行しているコンピューターでドキュメントプレビューサービスを有効にしてください。',
  'invalid': 'この Office ファイルはプレビューできません。破損しているか、パスワード保護されているか、拡張子が正しくない可能性があります。',
  'tooLarge': 'Office ファイルまたは変換後の PDF がプレビューのサイズ上限を超えています。ファイルサイズを小さくするか、プレビュー設定を調整してください。',
  'failed': 'Office の変換で使用可能な PDF が生成されませんでした。ファイルを確認して再試行してください。',
  'timeout': 'Office の変換がタイムアウトしました。再試行してください。',
  'busy': 'Office のプレビューが混み合っています。しばらくしてから再試行してください。',
  'changed': '読み取り中にファイルが変更されました。プレビューを開き直してください。',
}

/** Japanese dictionary for the `sidebarPdf` namespace. */
export const sidebarPdfJa = {
  'zoomControls': 'ズーム操作',
  'zoomMenu': 'ズームを選択',
  'zoomOut': '縮小',
  'zoomIn': '拡大',
  'zoomFitWidth': '幅に合わせる',
  'zoomValue': '{percent}%',
  'title': 'PDF',
  'pageImage': 'PDF ページ {page}',
  'loading': 'ドキュメントを描画しています…',
  'rendering': 'ページを描画しています…',
  'failed': 'PDF を表示できません：{message}',
  'password': 'この PDF にはパスワードが必要です。パスワード保護されたプレビューには対応していません。',
  'workerFailed': 'PDF の描画プロセスを続行できませんでした。再試行してください。',
  'unsupported': 'PDF プレビューには完全なファイル内容が必要です。',
  'retry': '再試行',
}
