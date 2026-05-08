# shiwake-ai デモアカウント整備フル手順書

> **目的**: PR Agent が Playwright で本番サイトから「映える UI スクショ」を毎朝撮影できるよう、撮影専用デモアカウントを整備する
> **作業者**: DSKさん（claude/claude codeはサポート役）
> **所要時間**: 全体で2-3時間（一気にやらず、分割可能）
> **作成日**: 2026-05-08

---

## 0. 全体像

このドキュメントは**3パート構成**：

- **Part 1: 本体側の改修** — `is_demo` フラグの追加（Supabase + server.js）
- **Part 2: デモアカウントの作成** — Firebase認証 + 撮影映え用データ仕込み
- **Part 3: PR Agent との接続** — 認証情報の Secret Manager 登録、Playwright スクリプトの動作確認

各パートが完了するごとにcommitすることを推奨。

---

## Part 1: 本体側の改修（is_demo フラグ追加）

PR Agent のためにデモユーザーを作るが、このユーザーが本体の admin 統計・SendGridメール・インセンティブ計算に混入すると、本物のユーザーデータが汚染される。これを防ぐため `is_demo` フラグを追加する。

### 1-1. Supabase スキーマ修正

Supabase の SQL Editor で以下を実行：

```sql
-- users テーブルに is_demo カラムを追加
alter table users 
  add column if not exists is_demo boolean not null default false;

-- 既存ユーザーは全員 is_demo=false（明示）
update users set is_demo = false where is_demo is null;

-- インデックス（admin統計で除外検索が頻発するため）
create index if not exists idx_users_is_demo on users(is_demo) 
  where is_demo = false;
```

**確認方法**:
```sql
-- カラムが追加されていること
select column_name, data_type, column_default 
from information_schema.columns 
where table_name = 'users' and column_name = 'is_demo';
-- → is_demo | boolean | false が返る

-- 全ユーザーが is_demo=false であること
select is_demo, count(*) from users group by is_demo;
-- → false | 〇〇人 のみ表示される
```

### 1-2. server.js の改修

`~/APP/shiwake-ai/server.js` で以下の箇所を修正する。

**修正対象の関数を見つける手がかり**:
- admin統計 を返す API エンドポイント（例: `/api/admin/stats`）
- SendGrid でインセンティブ通知を送る関数（例: `sendIncentiveMail`）
- インセンティブを計算するロジック（例: `incentive_total` を更新する処理）

#### A. admin統計から除外

```javascript
// 修正前（推測）:
// const { data: users } = await supabase
//   .from('users')
//   .select('*');

// 修正後:
const { data: users } = await supabase
  .from('users')
  .select('*')
  .eq('is_demo', false);    // デモを除外
```

#### B. SendGrid通知から除外

```javascript
// インセンティブ達成時のメール送信処理に追加
async function sendIncentiveMail(userId) {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  // ★ デモユーザーには通知を送らない
  if (user.is_demo) {
    console.log(`Skip incentive mail for demo user: ${user.email}`);
    return;
  }
  
  // 既存のSendGrid送信処理
  // ...
}
```

#### C. インセンティブ計算から除外（オプション）

`incentive_total` の集計を「全社の処理枚数」として表示している場合、デモ分が混ざらないように除外する：

```javascript
// 旧:
// const { data } = await supabase
//   .from('users')
//   .select('incentive_total');

// 新:
const { data } = await supabase
  .from('users')
  .select('incentive_total')
  .eq('is_demo', false);
```

ただし、**デモアカウント自体のインセンティブ進捗（79/1000枚等）はSNS投稿用に必要**なので、デモアカウント単体の値は維持すること。

#### D. Webhook送信時の display_name マスキング

PR Agent への incentive_events Webhook を送るとき、デモユーザーの実名でなく公開可能な表示名を送る：

```javascript
async function notifyPRAgent(eventType, userId) {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  // デモユーザーの場合は専用の公開表示名を使う
  const display_name = user.is_demo 
    ? user.demo_public_name      // ← Part 2で設定する公開用名前
    : 'スタッフAさん';            // 本物ユーザーは匿名化
  
  await fetch(`${PR_AGENT_WEBHOOK_URL}/api/webhook/incentive`, {
    // ... 既存処理 ...
    body: JSON.stringify({
      event_type: eventType,
      display_name,
      count_value: user.incentive_total,
    }),
  });
}
```

### 1-3. 確認とcommit

```bash
cd ~/APP/shiwake-ai
node -c server.js                       # 構文チェック
git add server.js
git commit -m "feat: add is_demo flag handling for PR Agent demo account"
git push origin main
```

Render が自動デプロイ。動作確認は次のPart 2の最後で行う。

---

## Part 2: デモアカウントの作成

Firebase認証で実アカウントを作り、Supabase users に登録、撮影映え用データを仕込む。

### 2-1. Firebase でデモアカウント作成

#### 推奨アカウント情報

```
Email:     demo-pr@shiwake-ai.com    ← support@へ転送される設定にする
                                        または別のGmailを用意
Password:  （強固なものを生成 → 1Passwordなどで管理）
表示名:    PR Demo Account
```

#### 手順

1. https://shiwake-ai.com/ にアクセス
2. 「メール/パスワードでサインアップ」を選択
3. 上記情報で登録
4. **規約・プライバシー同意チェック**を入れて完了
5. 受信メール（support@ → easy.you.me@gmail.com 経由）で確認URLをクリック

#### Firebase Console での確認

https://console.firebase.google.com/ → プロジェクト `shiwake-ai-59afe` → Authentication

- ユーザー一覧に `demo-pr@shiwake-ai.com` が追加されていること
- UID をメモ（次のステップで使う）

### 2-2. Supabase users に is_demo フラグを立てる

Supabase SQL Editor で：

```sql
-- まずデモユーザーが既に登録されているか確認
select id, email, display_name, is_demo from users 
where email = 'demo-pr@shiwake-ai.com';

-- is_demo フラグを true に + 公開表示名を追加
-- demo_public_name カラムが無ければ先に追加
alter table users add column if not exists demo_public_name text;

update users 
set 
  is_demo = true,
  demo_public_name = '証憑くん（デモ）',     -- SNS投稿で使う公開名
  is_paid = true,                            -- 全機能アクセスのため
  stripe_plan = 'unlimited',                 -- アンリミテッドプラン扱い
  display_name = 'PR Demo Account'
where email = 'demo-pr@shiwake-ai.com';

-- 確認
select email, display_name, demo_public_name, is_demo, is_paid, stripe_plan 
from users where email = 'demo-pr@shiwake-ai.com';
```

**ポイント**:
- `is_paid = true`: 無料トライアル制限を回避し全機能を見せる
- `stripe_plan = 'unlimited'`: 撮影時に「アンリミテッド」表示にする
- 実際の Stripe 決済は通さない（手動で DB 直接更新）

### 2-3. 撮影映え用データの仕込み

実際のレシート画像 or サンプル画像を使って、デモアカウントに以下の状態を作る。

#### 仕込みターゲット数値

| 項目 | 目標値 | 理由 |
|-----|-------|-----|
| 累計処理数 | 91〜108枚 | 12枚カタログのImage 11/12と整合 |
| インセンティブ対象数 | 79枚 | 同上 |
| 取引先マスタ | 13〜17社 | Image 9/11/12と整合 |
| カテゴリルール | 0件（後で増やす） | Image 8と整合 |
| マスタヒット率 | 3% | Image 11と整合 |

#### 必要な領収書バリエーション

12枚のImage 9（取引先マスタ）に出てくる店名と整合させる：

- **コンビニ**: ローソン天神ノ森店、ファミリーマート大阪金剛駅前
- **タクシー**: 日本交通株式会社、南タクシー株式会社
- **百貨店**: ゴディバ（高島屋大阪店）、株式会社 粟玄
- **飲食**: 餃子ノ酒場マイケル天下茶屋店、たこ家道頓堀くくる JR新大阪駅店
- **書籍**: 有限会社十八番（推定書店）
- **雑貨**: Seria 昭和町駅前店、ポアール帝塚山本店
- **交通系**: 西日本旅客鉄道株式会社 鳳駅、東急電鉄都立大学駅、大阪市高速電気軌道株式会社
- **公共**: 日本郵便株式会社、大阪府公安委員会
- **ガソリン**: 芦有ドライブウェイ芦屋料金所

これらの実物 or サンプル領収書画像を10〜15枚用意すれば、リアルな取引先マスタが育つ。

#### 仕込み方法（推奨）

**方法A: 実物のレシートを集める（最もリアル）**
- DSKさん本人が日常で撮りためたレシートを使う
- ただし個人情報（住所・電話番号）が写り込んでいないか注意

**方法B: ChatGPT や Claude にサンプルレシート画像を生成させる**
- リアルな店名・金額・日付の架空レシートを画像生成
- shiwake-ai に投入してOCR→仕訳という流れも撮影映えする

**方法C: shiwake-ai 開発時のテストデータを再利用**
- DSKさんが開発中に使った領収書サンプルがあれば流用

#### 仕込み手順

1. デモアカウントで shiwake-ai にログイン
2. 「スキャン」または「証憑をアップロード」で10〜15枚を順次投入
3. 各仕訳を「承認」して取引先マスタに登録される状態にする
4. 数値が上記目標に近づくまで繰り返す

**所要時間**: 30分〜1時間（枚数による）

### 2-4. 検証スクショ撮影

デモアカウントで以下の画面が「映える」状態になっているか目視確認：

- [ ] ダッシュボード（Image 11相当）— 数値が91以上、インセンティブ79以上、マスタ13社以上
- [ ] スキャン画面（Image 1/10相当）— 「カメラで撮影/画像を選択」ボタンが綺麗に見える
- [ ] 取引先マスタ（Image 9相当）— 13社以上、業種が散らばっている
- [ ] 仕訳カード（Image 3相当）— 「高信頼」「適格」バッジが表示
- [ ] CSV出力（Image 2相当）— 18件以上で「承認済みのみ」ボタンがアクティブ

不足していれば追加投入。

### 2-5. Part 1 と合わせた動作確認

Part 1 で `is_demo` フラグの除外処理が効いているか最終確認：

```sql
-- admin統計用クエリ（is_demo除外）が動くこと
select count(*) as real_users from users where is_demo = false;
-- → デモを含まない実ユーザー数

select count(*) as demo_users from users where is_demo = true;
-- → 1（デモアカウントのみ）

-- インセンティブ集計にデモが混ざっていないこと
select sum(incentive_total) as total_real 
from users where is_demo = false;
-- → デモの 79 が含まれない値
```

admin画面（あれば）からも確認推奨。

---

## Part 3: PR Agent との接続

### 3-1. 認証情報の Secret Manager 登録

Cloud Run + Secret Manager 環境（Part C C-1参照）に以下を登録：

```bash
# Google Cloud Secret Manager にデモアカウント情報を保存
gcloud secrets create shiwake-demo-email \
  --replication-policy="automatic"
echo -n "demo-pr@shiwake-ai.com" | \
  gcloud secrets versions add shiwake-demo-email --data-file=-

gcloud secrets create shiwake-demo-password \
  --replication-policy="automatic"
echo -n "実際のパスワード" | \
  gcloud secrets versions add shiwake-demo-password --data-file=-

# Cloud Run サービスにアクセス権を付与
gcloud secrets add-iam-policy-binding shiwake-demo-email \
  --member="serviceAccount:CLOUD_RUN_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding shiwake-demo-password \
  --member="serviceAccount:CLOUD_RUN_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

PR Agent の Cloud Run デプロイコマンドに以下を追加：

```bash
gcloud run deploy pr-agent \
  ...既存の設定... \
  --set-secrets="...,SHIWAKE_DEMO_EMAIL=shiwake-demo-email:latest,SHIWAKE_DEMO_PASSWORD=shiwake-demo-password:latest"
```

### 3-2. Playwright スクリプトの動作確認

PR Agent 側の `visuals/screenshot_capture.py` で以下のスクリプトをテスト実行：

```python
import asyncio
import os
from playwright.async_api import async_playwright

async def test_login_and_capture():
    """デモアカウントでログインし、ダッシュボードを撮影"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800}
        )
        page = await context.new_page()
        
        # 1. トップページへ
        await page.goto("https://shiwake-ai.com/")
        
        # 2. メール/パスワードでログイン
        # ※ shiwake-ai の実際のログインフォームのセレクタは
        # claude code が本体のindex.htmlを読んで確認すること
        await page.click("text=ログイン")
        await page.fill('input[type="email"]', os.environ["SHIWAKE_DEMO_EMAIL"])
        await page.fill('input[type="password"]', os.environ["SHIWAKE_DEMO_PASSWORD"])
        await page.click('button[type="submit"]')
        
        # 3. ダッシュボード読み込み待ち
        await page.wait_for_selector("text=スタッフインセンティブ", timeout=10000)
        
        # 4. 撮影
        await page.screenshot(path="/tmp/demo_dashboard.png", full_page=False)
        
        await browser.close()
        print("Screenshot saved: /tmp/demo_dashboard.png")

if __name__ == "__main__":
    asyncio.run(test_login_and_capture())
```

ローカルで動作確認：
```bash
cd ~/APP/shiwake-ai/pr-agent
poetry run python -c "
import asyncio
from visuals.screenshot_capture import test_login_and_capture
asyncio.run(test_login_and_capture())
"

# 保存された画像を確認
open /tmp/demo_dashboard.png
```

**期待結果**: Image 11 とほぼ同じレイアウトで、デモアカウントの数値（処理91枚 / インセンティブ79枚 / マスタ13社）が映ったスクショが取れる。

### 3-3. Cloud Run 上での動作確認

Cloud Run にデプロイ後、Cloud Scheduler の trigger エンドポイントを手動で叩いて確認：

```bash
curl -X POST https://pr-agent-xxxxx.run.app/api/cron/scout
# → ログを確認
gcloud run services logs read pr-agent --region asia-northeast1 --limit 50
```

「Demo login successful」「Screenshot saved to Supabase Storage」などのログが出ていればOK。

### 3-4. 自動撮影スケジュールの設定

Cloud Scheduler に「毎朝7:00にデモアカウントから撮影」を追加：

```bash
gcloud scheduler jobs create http pr-agent-daily-capture \
  --schedule="0 7 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://pr-agent-xxxxx.run.app/api/cron/capture-demo" \
  --http-method=POST \
  --location=asia-northeast1
```

これで毎朝7時に最新のUIが visual_assets テーブル + Supabase Storage に蓄積され、Plannerが9時に投稿企画する時には**最新の本番UI画像**が選択肢に入る。

---

## Part 4: 運用上の注意事項

### 4-1. デモアカウントのデータ管理

- **定期的なデータ追加**: 月1回程度、新しい領収書を追加投入してマスタを「育って見える」状態に保つ
- **古いデータの掃除**: 6ヶ月以上前の仕訳は削除して、常に「今期分」が見えるようにする
- **数値の不自然な変化を避ける**: 急に処理数が10倍になると不自然なので、徐々に増やす

### 4-2. Stripe との関係

- デモアカウントは `is_paid=true` だが、実際の Stripe 決済は通していない
- Stripe Webhook 側で「該当の customer_id が無いユーザーは無視」のロジックが既に動いていれば問題なし
- もし Stripe Webhook がデモアカウントに対して何か処理しようとして失敗したら、`stripe_customer_id IS NULL` の条件で除外する

### 4-3. パスワード管理

- `SHIWAKE_DEMO_PASSWORD` は **Google Cloud Secret Manager のみに保存**
- ローカルの `.env` には**保存しない**（誤コミット防止）
- DSKさん個人の保管は 1Password / Bitwarden 等のパスワードマネージャ推奨

### 4-4. アクセスログの観察

デモアカウントが**人間によるログイン以外で使われていないか**を月1で確認：

```sql
-- Firebase Auth のログイン履歴で、Cloud Run の IPからのアクセスのみであることを確認
-- （Firebase Console → Authentication → ユーザー詳細）
```

不審なIPからのアクセスがあれば、即座にパスワードを変更し Secret Manager を更新。

### 4-5. デモアカウント解除の手順（将来）

PR Agent を停止する場合や、本物の有料ユーザーに切り替える場合：

```sql
update users set is_demo = false where email = 'demo-pr@shiwake-ai.com';
-- これで本体の統計に組み込まれる
```

または完全削除：

```sql
-- まず関連データを削除
delete from invites where email = 'demo-pr@shiwake-ai.com';
-- ... 他の関連テーブルからも削除 ...
delete from users where email = 'demo-pr@shiwake-ai.com';

-- Firebase Console からもユーザー削除
```

---

## チェックリスト（完了確認用）

### Part 1: 本体側
- [ ] Supabase users に `is_demo` カラム追加完了
- [ ] Supabase users に `demo_public_name` カラム追加完了
- [ ] server.js の admin 統計クエリに `is_demo=false` フィルタ追加
- [ ] server.js の SendGrid 通知に `is_demo` チェック追加
- [ ] server.js の Webhook 送信に `demo_public_name` 利用ロジック追加
- [ ] commit & push & Render デプロイ完了

### Part 2: デモアカウント
- [ ] Firebase に `demo-pr@shiwake-ai.com` 登録完了
- [ ] Supabase users で `is_demo=true` に設定完了
- [ ] `is_paid=true` / `stripe_plan='unlimited'` 設定完了
- [ ] 領収書10〜15枚投入、累計処理数 91+ 達成
- [ ] 取引先マスタ 13社+ 育成完了
- [ ] インセンティブ 79+ 達成
- [ ] Image 11/12 相当のスクショが手動で撮れることを確認

### Part 3: PR Agent接続
- [ ] Secret Manager に `shiwake-demo-email` / `shiwake-demo-password` 登録
- [ ] Cloud Run サービスアカウントにアクセス権付与
- [ ] Cloud Run デプロイで Secret 参照成功
- [ ] Playwright ローカルテストで自動ログイン+撮影成功
- [ ] Cloud Run 上での `/api/cron/capture-demo` 動作確認
- [ ] Cloud Scheduler で毎朝7時の自動撮影設定完了

### Part 4: 運用
- [ ] パスワードを 1Password 等に保管
- [ ] 月1チェックの予定をカレンダー登録（任意）

---

## トラブルシューティング

### Q. デモアカウントでログインできない
- Firebase Console で「ユーザー一覧」を確認、ステータスが「無効」になっていないか
- パスワードを忘れた場合は Firebase Console から直接リセット可能
- メール認証が未完了の場合は再送信

### Q. is_paid=true にしたのに無料期間終了の表示が消えない
- 本体の `is_free_trial` カラムも `false` にする必要があるかも
- `paid_at` を現在時刻に設定する（Stripe Webhook の代替）
```sql
update users set is_free_trial = false, paid_at = now() 
where email = 'demo-pr@shiwake-ai.com';
```

### Q. Playwright がログイン画面を見つけられない
- shiwake-ai の `index.html` を読んで実際のセレクタを確認
- Firebase 認証は SDK が動的にDOMを生成するため、`wait_for_selector` で待つ
- ヘッドフルモード（`headless=False`）でローカル実行して目視デバッグ

### Q. 撮影スクショが期待と違う
- `viewport` のサイズを確認（推奨 1280x800 / モバイル時は 375x812）
- `wait_for_selector` で確実に要素が出るまで待つ
- `page.wait_for_timeout(2000)` で余裕を持たせる

### Q. インセンティブ通知が誤って本物として送られた
- server.js の `is_demo` チェックを再確認
- Render の環境変数 `PR_AGENT_WEBHOOK_URL` が正しく設定されているか
- ログで `Skip incentive mail for demo user` が出ているか確認

---

# 手順書ここまで。
# 質問や詰まったら Claude chat に相談してください。
