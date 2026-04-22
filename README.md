# 証憑仕訳AI — ローカル起動手順

## 必要なもの
- Node.js 18以上（`node --version` で確認）
- Anthropic APIキー（sk-ant-...）

## 起動方法

```bash
cd siwake-app
node server.js
```

ブラウザで http://localhost:3456 を開く

## 使い方
1. APIキーを入力（sk-ant-...）
2. 領収書・レシートの画像をアップロード（最大4枚）
3. 「Claude APIで仕訳を生成」をクリック
4. 承認 or 修正して「弥生CSV出力」

## ファイル構成
- server.js   — プロキシサーバー（CORS回避）+ APIルーティング
- index.html  — フロントエンドUI
