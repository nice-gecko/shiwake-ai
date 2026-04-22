# 証憑仕訳AI v1.0

領収書・レシート・クレジットカード明細PDFから、弥生会計用の仕訳を自動生成するWebアプリです。

## 機能
- JPG/PNG/PDF対応（領収書・レシート・クレジットカード明細）
- Claude AIによるOCR＋仕訳自動生成
- クレジットカード→未払金の自動判定
- 取引先マスタ（承認時に自動学習・管理画面で編集可能）
- 承認時に同一取引先を一括更新
- 重複の可能性バッジ表示
- 承認済みのみ／全件のCSV出力（弥生会計インポート対応）
- 途中停止→続きから再開

## セットアップ

### 必要なもの
- Node.js 18以上
- Anthropic APIキー（sk-ant-...）
- npm

### インストール
```bash
npm install pdf-lib
```

### 環境変数の設定
```bash
echo "ANTHROPIC_API_KEY=sk-ant-xxxxxxxx" > .env
```

### 起動
```bash
node server.js
```

ブラウザで http://localhost:3456 を開く

## Renderへのデプロイ
1. このリポジトリをGitHubにpush
2. render.com → New → Web Service
3. リポジトリを選択
4. Environment Variables: `ANTHROPIC_API_KEY=sk-ant-...`
5. Start Command: `node server.js`
6. Deploy

## ファイル構成
- `server.js` — APIサーバー（PDF分割・Claude API連携・マスタ管理）
- `index.html` — フロントエンドUI
- `master.js` — 取引先マスタ管理モジュール
- `master.json` — 取引先マスタデータ（自動生成）
- `.env` — APIキー（Gitにコミットしない）

## 注意
- `.env`はGitにコミットしないでください
- `master.json`はチームで共有する場合はGitで管理してください
