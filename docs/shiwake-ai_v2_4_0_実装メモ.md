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
