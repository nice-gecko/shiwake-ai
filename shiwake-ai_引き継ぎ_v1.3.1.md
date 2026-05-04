# shiwake-ai 引き継ぎ情報 v1.3.1

## リポジトリ・URL
- GitHub: https://github.com/nice-gecko/shiwake-ai
- 本番URL: https://shiwake-ai.onrender.com
- ローカル: ~/APP/shiwake-ai

---

## 技術スタック
- Node.js（server.js）+ HTML/CSS/JS（index.html）+ pdf-lib
- Claude Sonnet 4.6（claude-sonnet-4-6）← メイン処理
- Claude Haiku（claude-haiku-4-5-20251001）← フォーマット判定のみ
- Firebase Auth（Google・メール/パスワード認証）
- Supabase（ユーザー管理DB）
- Stripe（決済）
- Renderでホスティング（無料プラン）

---

## 環境変数（Renderに設定済み）
| Key | 説明 |
|---|---|
| ANTHROPIC_API_KEY | Claude API キー |
| SUPABASE_SECRET_KEY | sb_secret_qAuQvfInScIceI0sah4nVA_zy7SQUJv |
| STRIPE_SECRET_KEY | sk_test_51TQjjh2ZetSuudnLeHXq5uKZF8hOsc6l1G4qo3TflmxdrjfdOeGhsZaw9UAEOJfa3heW1EDSQIPw465nc6fDNjrl00S6IsBkLE |
| STRIPE_WEBHOOK_SECRET | whsec_4sj7nkaidGADcQkoAqREtgMVEY5qJWOD |

---

## Firebase設定
- プロジェクトID: shiwake-ai-59afe
- AuthDomain: shiwake-ai-59afe.firebaseapp.com
- 承認済みドメイン: shiwake-ai.onrender.com ✅
- Google認証: 有効 ✅
- メール/パスワード認証: 有効 ✅

---

## Supabase設定
- Project URL: https://tmddairlgpyinqfekkfg.supabase.co
- Publishable key: sb_publishable_lOW444_86CFPvXq81T5N1Q_bc3PoN7I
- Secret key: sb_secret_qAuQvfInScIceI0sah4nVA_zy7SQUJv
- テーブル: users（id:text, email:text, display_name:text, is_paid:bool, is_free_trial:bool, monthly_count:int, stripe_customer_id:text）

---

## Stripe設定
- テストモード
- Webhook: https://shiwake-ai.onrender.com/api/stripe/webhook
- 監視イベント: checkout.session.completed, customer.subscription.deleted

### 料金プラン
| プランID | 商品名 | 価格 | price_ID |
|---|---|---|---|
| lite | 証憑仕訳AI - ライト | ¥980/月 | price_1TQjqc2ZetSuudnL00xEQgQs |
| unlimited | 証憑仕訳AI - アンリミテッド | ¥5,800/月 | price_1TQlsh2ZetSuudnLlgDUN35b |
| agency_lite | 証憑仕訳AI - 代理店ライト | ¥35,000/月 | price_1TQlwT2ZetSuudnL4cxHabfQ |
| agency_std | 証憑仕訳AI - 代理店スタンダード | ¥100,000/月 | price_1TQlxt2ZetSuudnLIzU5Auw7 |
| agency_prem | 証憑仕訳AI - 代理店プレミアム | ¥200,000/月 | price_1TQlzN2ZetSuudnLbtzI77fc |

---

## ファイル構成
```
shiwake-ai/
├── index.html    # フロントエンド（全機能）
├── server.js     # バックエンド（API・Stripe・Supabase）
├── session.js    # セッション管理
├── master.js     # 取引先マスタ管理
└── .env          # ローカル用（Renderは環境変数で管理）
```

---

## 現在のバージョン：v1.3.1

---

## v1.3.1 実装済み機能

### AI処理（server.js）
- モデル：Sonnet 4.6（claude-sonnet-4-6）
- 2段階処理：Haikuでフォーマット判定 → Sonnetでタイプ別読み取り
- 日本の領収書12種類のフォーマット定義を内蔵：
  - register_receipt（レジレシート）
  - handwritten（手書き領収書）
  - restaurant（飲食店）
  - transportation（交通費）
  - utility（公共料金）
  - ec_online（通販・EC）
  - medical（医療・薬局）
  - gas_station（ガソリンスタンド）
  - hotel_accommodation（宿泊）
  - bank_atm（銀行・ATM）
  - golf（ゴルフ場）
  - coffee_chain（コーヒーチェーン）
- 取引先マスタをプロンプトに渡して精度向上
- リトライ：0件時のみ1回
- プロンプト改善：
  - ¥マークを4と誤読しない
  - 空欄の内訳欄を別仕訳にしない
  - 非課税・クレジット・重複の判定ルール明示
  - インボイス登録番号（T+13桁）の抽出

### フロントエンド（index.html）
- 書類種別選択UI（6種類）：ボタンホバーで吹き出しツールチップ表示
  - 🧾 一般レシート
  - 🍽️ 飲食店
  - 🚃 交通費
  - ✍️ 手書き領収書
  - 📦 ECサイト・請求書
  - 🏦 通帳・カード明細
- 「仕訳ルール学習」（旧：取引先マスタ）
- CSV統合・変換パネル（複数CSV読み込み・フォーマット変換）
- インボイス適格（緑）・不適格（赤）バッジ
- 不適格時の控除割合セレクト（デフォルト80%）
- 削除→グレー表示＋「元に戻す」ボタン（セッション中いつでも復元）
- 重複仕訳：自動除外なし・「⚠ 重複の可能性」バッジ表示のみ
- 仕訳カードに領収書サムネイル表示、クリックで原本プレビュー
- 縦横混在・画像回転モード（スキャンパネル）
- スキャン後「続けてスキャン」ボタン
- スマートデフォルト（パース補正の四隅を10%内側に自動設定）
- CSV出力にインボイス登録番号・適格区分列を追加
- バージョン表示：サイドバー下部の線の上に「v1.3.1 · Sonnet 4.6」

---

## 未実装タスク
- 自信度「？」マーク表示（confidenceがlowの仕訳カードにバッジ）
- 月次レポート機能
- 無料期間終了→Stripe課金ONのスイッチ
- Apple ID認証（要Apple Developer Program $99/年）
- 2026年10月以降：控除割合デフォルトを50%に変更が必要

---

## ⚠️ 重要ルール（Claudeへの注意事項）

### ルール１：ミスがないように2〜3度確認しながら進める
### ルール２：デザイン変更は先にビジュアルチェックしてからコードを書く

### デプロイ手順（必ずこの3〜4行のみ）
```bash
cd ~/APP/shiwake-ai
git add .
git commit -m "変更内容"
git push origin main
```

### ⚠️ Claudeが繰り返したミス（絶対に繰り返さないこと）

**ミス①：ダウンロード先を無視したcpコマンド**
- ユーザーはファイルを`~/APP/shiwake-ai`に直接ダウンロードしている
- `cp ~/Downloads/index.html ~/APP/shiwake-ai/index.html`は不要・間違い
- デプロイ時は`cd ~/APP/shiwake-ai`してそのまま`git add .`するだけ

**ミス②：cd忘れ**
- ターミナルは毎回ホームディレクトリ（~）から始まる
- コマンド指示の最初は必ず`cd ~/APP/shiwake-ai`から始める
- これを忘れるとkabucheckなど別リポジトリで操作してしまう

**ミス③：古いファイルをベースに作業**
- 新しいチャットセッションでは作業ファイルが消える
- 必ずユーザーに最新の`index.html`と`server.js`をアップロードしてもらってから作業開始する
- outputsフォルダの内容を信頼しない（セッションをまたぐと古くなる）

**ミス④：モデル名の誤り**
- 正しいモデル名：`claude-sonnet-4-6`（Sonnet 4.6）
- 古い名前`claude-sonnet-4-20250514`は使用不可・エラーになる

---

## 連絡先・アカウント
- Supabase: easy.you.me@gmail.com
- Firebase: easy.you.me@gmail.com
- Stripe: easy.you.me@gmail.com
- 代理店プラン問い合わせ先: easy.you.me@gmail.com
