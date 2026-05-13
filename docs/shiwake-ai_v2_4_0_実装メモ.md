# shiwake-ai v2.4.0 自動エクスポート 実装メモ

> 作成日: 2026-05-13
> 状態: Group 1〜2 完了 / Group 3〜5 未着手

## Group 1: DB変更 + サーバAPI基本(コミット 3721472)
- shiwake_records.exported_at 追加
- shiwake_exports 新規テーブル(status/output_destinations/record_count等)
- workspaces に auto_export_* 6カラム追加
- /api/auto-export/settings (GET/PATCH)、/api/auto-export/history、/api/auto-export/trigger-check 実装

## Group 2: エクスポート実行エンジン(コミット 95ed32b → 0999846 → 配線修正最新)
- CSV生成ロジックを index.html exportCSV() からサーバ側 generateCsvContent() へ移植
- メール配送(SendGrid v3 API、CSV base64添付)
- クラウド配送(Dropbox filesUpload / GDrive files.create)
- ローカルDL(Supabase Storage `auto-exports` バケット、private)
- 統合関数 executeAutoExport()
- /api/shiwake/approve 末尾に checkAutoExportTrigger() 非同期呼び出し

### Group 2 で発覚した重要なバグ修正
1. **/api/shiwake/approve が誰からも呼ばれていなかった**
   - フロントの「✓承認」ボタンは approveGroup() → syncSessionSave() → /api/session/save のみ呼んでおり、shiwake_records への INSERT は永続化されていなかった
   - v2.3.1 で実装されたはずの仕訳記録永続化が、実は使われていなかった
   - 修正: approveGroup() が各仕訳に対し /api/shiwake/approve を Fetch するように変更
   - 副次効果: 仕訳記録の DB 永続化が実際に動くようになった(v2.3.1 設計通り)

2. **フロントから workspace_id を承認APIに渡していなかった**
   - サーバが ensureDefaultWorkspace(uid) でフォールバックしていたため、ユーザー選択中WSがデフォルトと違うと checkAutoExportTrigger が誤ったWSを参照
   - 修正: index.html の approve() 呼び出しに workspace_id を明示的に追加

## 動作確認結果(2026-05-13 16:13)
- threshold=1, destinations=["email"], format="yayoi" で動作確認
- 仕訳2件承認 → /api/shiwake/approve 200 → shiwake_exports.status="success" → メール到着(CSV添付)
- ファイル名: default_yayoi_20260513-070942.csv

## 残テスト(Group 3〜5 完了後にまとめて実施)
- cloud destination(Dropbox / GDrive)
- local destination(ローカルDL通知)
- threshold デフォルト30の発火タイミング
- output_unit='merged'(WS統合モード)
- 失敗時のリトライ挙動(未エクスポート仕訳の次回トリガー引き継ぎ)

## 残実装(Group 3〜5)
- Group 3: WS編集モーダルに自動エクスポート設定セクション追加
- Group 4: 設定画面に「アンロック機能一覧」新設(将来枠のプラン制限機能含む)
- Group 5: サイドバーに「エクスポート履歴」追加 + アプリ内通知 + 失敗通知メール

## v2.4.x 範囲の追加方針(2026-05-13 議論結果)

### A. CSV出力件数の上限(Group 5 で実装)

- ユーザー判断: 500件で十分
- 実装: executeAutoExport() で未エクスポート仕訳を取得する際、500件ずつバッチに分割
- 500件超のケース:
  - 1つのトリガーで複数CSVを生成(default_yayoi_20260513_part1.csv / _part2.csv ...)
  - shiwake_exports に1行ずつ記録(全バッチ成功で初めて exported_at 更新)
  - メール本文に「Nファイルに分割して送信」と明記
- 通常運用(threshold=30)では発生しない想定、配送失敗が続いた場合の安全弁

### B. アンロック機能一覧 → 設定詳細への導線(Group 4 で実装)

- ユーザー判断: C案採用(アンロック機能一覧から設定を開く)
- 配置:
  - 設定画面の「アンロック機能一覧」セクション内、自動エクスポート行に「設定を開く」ボタンを追加
  - クリック時の動作: 現在の選択中WSの編集モーダルを開き、自動エクスポートセクションまでスクロールジャンプ
- 実装ヒント:
  - WS編集モーダルの自動エクスポートセクションに id="auto-export-section" を付与
  - 「設定を開く」ボタンの click で openWorkspaceEditModal(currentWsId, { scrollTo: 'auto-export-section' })
  - スクロールジャンプは scrollIntoView({ behavior: 'smooth' })

### C. サイドバー再構成(v2.4.0 完走後の独立タスク、Group 5 直後に実施)

- 現状サイドバーが10項目近くまで増え、新機能追加で煩雑になる懸念
- 業務フロー軸で「入口→処理→出口」のグルーピングに再構成

#### グループ案(名称は実装時に再検討)
