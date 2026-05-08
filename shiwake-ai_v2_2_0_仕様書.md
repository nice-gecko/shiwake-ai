# shiwake-ai v2.2.0 実装仕様書

> **v2.2.0 の位置づけ**: v2.0.0 / v2.1.0 で確定した戦略(2モデル併売 + Elite追加)を、**実装基盤として整える**マイナーバージョン。
>
> 機能フラグの判定基盤、新料金体系への切り替え、DB拡張、UI出し分け、テスト顧客の移行、**代理店制度(卸売モデル + 階段制マージン)**、までを一気にクリーンに行う。
>
> **件数従量課金(Stripe Metered Billing)は v2.2.1 に分離**。
> **代理店制度は卸売モデル**(通常価格の70/65/60%で代理店が仕入れて再販)、Stripe Connect は不要。

---

## 📌 v2.2.0 ゴール

| 項目 | 達成基準 |
|---|---|
| **DB拡張** | users テーブルに plan_key・edition・billing_period_*・is_reseller・reseller_uid・current_tier の7列追加 |
| **新プラン定義** | server.js の STRIPE_PLANS が新料金体系(SaaS/Agent/Elite)に置き換わる |
| **機能フラグ** | `canUse(uid, feature)` 関数で AI SaaS版/Agent版/Elite の機能を判定可能 |
| **UI出し分け** | 料金ページ・サイドバー・ダッシュボード が edition に応じて表示変更 |
| **件数集計の正しさ** | monthly_count が月初に自動リセット、AgentとSaaSで上限判定が分岐 |
| **テスト顧客移行** | 旧プラン契約者を新プランに振り分けるスクリプト整備 |
| **代理店制度** | 卸売プラン9種・代理店申込/審査・階段制マージン(Bronze/Silver/Gold)・月次ランク判定バッチ・代理店ダッシュボード |

---

## 🗺 影響範囲

### 変更ファイル

| ファイル | 変更内容 | 規模 |
|---|---|---|
| `server.js` | STRIPE_PLANS 全面書き換え + 機能フラグ関数追加 + 件数リセット + 代理店API群追加 + ランク判定ロジック | 特大 |
| `index.html` | 料金ページ全面改修 + サイドバー出し分け + ステータス表示 + 代理店申込/ダッシュボード | 特大 |
| `scripts/update-reseller-tiers.js` | 月次ランク判定バッチ(新規ファイル) | 小 |
| Supabase | users列追加(7列) | 中 |
| Stripe ダッシュボード | 通常プラン9種 + 卸売プラン9種 = 計18種作成、旧プラン archive(手動作業) | 中 |
| Render | Cron Job 設定追加(月次ランク判定用) | 小 |

### 変更しないファイル

- `master.js`(取引先マスタ・触らない)
- `session.js`(セッション管理・触らない)
- API キー類(環境変数・触らない)

---

## 💾 1. DB設計変更

### 1.1 users テーブルへの列追加

Supabase の users テーブルに以下7列を追加する。

| 列名 | 型 | NULL | デフォルト | 説明 |
|---|---|---|---|---|
| `plan_key` | text | YES | NULL | 加入プランのキー(下記プラン定義参照) |
| `edition` | text | YES | NULL | 'saas' / 'agent' / 'elite' のいずれか |
| `billing_period_start` | timestamptz | YES | NULL | 当月の請求期間開始日(Stripe webhook由来) |
| `billing_period_end` | timestamptz | YES | NULL | 当月の請求期間終了日(月初リセット判定に使用) |
| `is_reseller` | boolean | NO | false | 代理店アカウントか否か |
| `reseller_uid` | text | YES | NULL | この顧客を仕入れている代理店のFirebase UID(代理店経由顧客のみ) |
| `current_tier` | text | YES | NULL | 代理店の現在のランク('bronze' / 'silver' / 'gold')、代理店アカウントのみ使用 |

**既存列との関係**:
- `is_paid`: 既存のまま継続(plan_key が NULL でない = is_paid: true と一致させる)
- `monthly_count`: 既存のまま継続(billing_period_end を超えたら 0 リセットするロジックを server.js 側に追加)

### 1.2 マイグレーション SQL

```sql
ALTER TABLE users ADD COLUMN plan_key text;
ALTER TABLE users ADD COLUMN edition text;
ALTER TABLE users ADD COLUMN billing_period_start timestamptz;
ALTER TABLE users ADD COLUMN billing_period_end timestamptz;
ALTER TABLE users ADD COLUMN is_reseller boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN reseller_uid text;
ALTER TABLE users ADD COLUMN current_tier text;
CREATE INDEX idx_users_reseller_uid ON users(reseller_uid);
CREATE INDEX idx_users_is_reseller ON users(is_reseller) WHERE is_reseller = true;

-- 既存ユーザーの初期値設定(後述「テスト顧客移行」で詳細化)
UPDATE users SET plan_key = 'saas_unlimited', edition = 'saas' 
WHERE is_paid = true AND plan_key IS NULL;
```

### 1.3 設計方針の理由

- **plan_key と edition を分けて持つ理由**: edition は機能判定の主軸(SaaS/Agent/Elite)、plan_key は課金ロジック・件数上限の参照に使う。両方持つことで「Agent ベーシックは agent edition だが含む件数は 200件」という細かい判定が可能。
- **代理店制度を users テーブルで完結させる理由**: 別テーブル(referrals, commissions, affiliates)を作らないことで、複雑性を大幅に低減。卸売モデルでは「誰が代理店か」「どの顧客がどの代理店経由か」が分かれば十分で、紹介履歴やキックバック計算は不要。
- **current_tier を users に持つ理由**: 月次バッチで判定したランクを保存しておくことで、ダッシュボード表示時に再計算不要。月次バッチが書き換える前提のキャッシュ列。
- **billing_period_end を持つ理由**: monthly_count のリセットタイミングを Stripe の請求サイクルと一致させるため。今は月末リセットで動いているが、Stripe の請求日(契約日基準)と月末がずれるとカウントが噛み合わない。

---

## 💰 2. Stripe設計変更

### 2.1 新プラン一覧(v2.0.0/v2.1.0 反映)

#### AI SaaS版(廉価帯)

| plan_key | edition | 商品名 | 価格 | 含む件数 | 備考 |
|---|---|---|---|---|---|
| `saas_lite` | saas | 個人ライト | ¥980/月 | 100件 | 旧 lite 相当 |
| `saas_unlimited` | saas | アンリミテッド | ¥5,800/月 | 無制限 | 旧 unlimited 相当 |
| `saas_team_lite` | saas | チームライト | ¥20,000/月 | 5ID | 旧 team_lite 継承 |
| `saas_team_std` | saas | チームスタンダード | ¥50,000/月 | 15ID | 旧 team_std 継承 |
| `saas_team_prem` | saas | チームプレミアム | ¥100,000/月 | 30ID | 旧 team_prem 継承 |

#### Agent版(高価格帯)

| plan_key | edition | 商品名 | 価格 | 含む件数 | 超過単価 |
|---|---|---|---|---|---|
| `agent_basic` | agent | Agent ベーシック | ¥30,000/月 | 200件 | ¥20/件(v2.2.1で実装) |
| `agent_std` | agent | Agent スタンダード | ¥80,000/月 | 500件 | ¥20/件 |
| `agent_premium` | agent | Agent プレミアム | ¥150,000/月 | 1,500件 | ¥20/件 |
| `agent_elite` | elite | Agent エリート | ¥250,000/月 | 3,000件 | ¥20/件 |

#### 卸売プラン(代理店専用・新設)

通常プランそれぞれに対応する**卸売プラン**を Stripe 上で別 price として作成。
**Bronze ランク(70%)を基準価格**として登録し、Silver/Gold ランクへの移行は **Stripe Coupon の動的適用**で実現する(ランク判定ロジックの章を参照)。

| 卸売 plan_key | 対応する通常プラン | Bronze価格(70%) | edition |
|---|---|---|---|
| `wholesale_saas_lite` | saas_lite | ¥686/月 | saas |
| `wholesale_saas_unlimited` | saas_unlimited | ¥4,060/月 | saas |
| `wholesale_saas_team_lite` | saas_team_lite | ¥14,000/月 | saas |
| `wholesale_saas_team_std` | saas_team_std | ¥35,000/月 | saas |
| `wholesale_saas_team_prem` | saas_team_prem | ¥70,000/月 | saas |
| `wholesale_agent_basic` | agent_basic | ¥21,000/月 | agent |
| `wholesale_agent_std` | agent_std | ¥56,000/月 | agent |
| `wholesale_agent_premium` | agent_premium | ¥105,000/月 | agent |
| `wholesale_agent_elite` | agent_elite | ¥175,000/月 | elite |

**設計のポイント**:
- 通常プランと卸売プランは Stripe 上で**別の price_ID** を持つ
- 代理店アカウント(`is_reseller: true`)は購入時に自動的に卸売プランが選択される
- Silver/Gold への昇格は、卸売 subscription に対して Stripe Coupon を適用して実現(後述 6.5 節)

#### インセンティブオプション(SaaS版のみ・継続)

| plan_key | edition | 商品名 | 価格 |
|---|---|---|---|
| `incentive_lite` | (オプション) | インセンティブ ライト | ¥5,000/月 |
| `incentive_std` | (オプション) | インセンティブ スタンダード | ¥10,000/月 |
| `incentive_prem` | (オプション) | インセンティブ プレミアム | ¥20,000/月 |

### 2.2 旧プラン処理

旧プラン(lite, unlimited, agency_light, agency_std, agency_prem)は **Stripe ダッシュボード上で archive(無効化)** する。
理由: 削除するとテスト顧客の既存 subscription が壊れる。archive なら既存契約は継続できるが新規購入は不可。

新規ユーザーは新プランのみ選択可能、テスト顧客は移行スクリプトで新プランに切り替え後、旧プランの subscription を Stripe で cancel する。

### 2.3 手動作業(あなた側)

Claude Code では Stripe ダッシュボードの操作はできないので、以下はユーザー側の手動作業。

**Step 1: 通常プラン9種を新規作成**
- saas_lite (¥980)
- saas_unlimited (¥5,800)
- saas_team_lite (¥20,000) ※既存 price_ID 流用可
- saas_team_std (¥50,000) ※既存 price_ID 流用可
- saas_team_prem (¥100,000) ※既存 price_ID 流用可
- agent_basic (¥30,000)
- agent_std (¥80,000)
- agent_premium (¥150,000)
- agent_elite (¥250,000)

**Step 2: 卸売プラン9種を新規作成**(Bronze価格で登録)
- wholesale_saas_lite (¥686)
- wholesale_saas_unlimited (¥4,060)
- wholesale_saas_team_lite (¥14,000)
- wholesale_saas_team_std (¥35,000)
- wholesale_saas_team_prem (¥70,000)
- wholesale_agent_basic (¥21,000)
- wholesale_agent_std (¥56,000)
- wholesale_agent_premium (¥105,000)
- wholesale_agent_elite (¥175,000)

**Step 3: Coupon を2種類作成**
- `silver_discount`: percent_off=7.143%(70%→65%相当・代理店マージンUP)
- `gold_discount`: percent_off=14.286%(70%→60%相当・代理店マージンUP)
- いずれも duration=forever、Stripe テストモードで作成

**Step 4: 各プランの price_ID と coupon ID を Claude Code に伝える**
server.js の STRIPE_PLANS と COUPON 定数に反映するため。

**Step 5: 旧プラン(lite, unlimited, agency_*)を archive する**
**Step 6: インセンティブオプション3つは旧プランのまま継続**(price_ID 変更不要)

**注意**: `team_lite/std/prem` は旧 price_ID を流用するか、新規作成するかは要判断。価格・含む内容に変更がないなら流用が楽。

---

## 🔧 3. server.js 変更

### 3.1 STRIPE_PLANS の置き換え

```javascript
const STRIPE_PLANS = {
  // ===== AI SaaS版 =====
  saas_lite:        { price_id: 'price_xxx', name: '個人ライト',         edition: 'saas',  limit: 100,   seats: 1 },
  saas_unlimited:   { price_id: 'price_xxx', name: 'アンリミテッド',     edition: 'saas',  limit: null,  seats: 1 },
  saas_team_lite:   { price_id: 'price_xxx', name: 'チームライト',       edition: 'saas',  limit: null,  seats: 5 },
  saas_team_std:    { price_id: 'price_xxx', name: 'チームスタンダード', edition: 'saas',  limit: null,  seats: 15 },
  saas_team_prem:   { price_id: 'price_xxx', name: 'チームプレミアム',   edition: 'saas',  limit: null,  seats: 30 },
  // ===== Agent版 =====
  agent_basic:      { price_id: 'price_xxx', name: 'Agent ベーシック',   edition: 'agent', limit: 200,   seats: 1, overage_unit_yen: 20 },
  agent_std:        { price_id: 'price_xxx', name: 'Agent スタンダード', edition: 'agent', limit: 500,   seats: 1, overage_unit_yen: 20 },
  agent_premium:    { price_id: 'price_xxx', name: 'Agent プレミアム',   edition: 'agent', limit: 1500,  seats: 1, overage_unit_yen: 20 },
  // ===== Agent エリート =====
  agent_elite:      { price_id: 'price_xxx', name: 'Agent エリート',         edition: 'elite', limit: 3000,  seats: 1, overage_unit_yen: 20 },
  // ===== インセンティブオプション(継続) =====
  incentive_lite:   { price_id: 'price_1TUI5s2ZetSuudnLDdCVo6P2', name: 'インセンティブ ライト',     edition: 'option' },
  incentive_std:    { price_id: 'price_1TUI762ZetSuudnLZPo5BGON', name: 'インセンティブ スタンダード', edition: 'option' },
  incentive_prem:   { price_id: 'price_1TUI7v2ZetSuudnLYL0b0VjT', name: 'インセンティブ プレミアム',   edition: 'option' },
};
```

`price_xxx` の部分はユーザーから受け取った price_ID で埋める。

### 3.2 機能フラグ判定関数の追加

```javascript
// edition ごとの機能定義
const EDITION_FEATURES = {
  saas: {
    receipt_upload: true,
    ai_judgment: true,
    master_learning: true,
    csv_export: true,
    incentive: 'option', // インセンティブオプション加入時のみ
    auto_ingest: false,
    auto_export: false,
    auto_rule_learning: false,
    auto_approval: false,
    industry_template: false,
    my_template: false,
    dashboard_full: false,
    career_path_full: false,
    chat_mode: false,
  },
  agent: {
    receipt_upload: true,
    ai_judgment: true,
    master_learning: true,
    csv_export: true,
    incentive: false,
    auto_ingest: true,         // 段階的アンロック対象
    auto_export: true,         // 段階的アンロック対象
    auto_rule_learning: true,  // 段階的アンロック対象
    auto_approval: true,       // 段階的アンロック対象
    industry_template: true,
    my_template: true,
    dashboard_full: true,
    career_path_full: true,
    chat_mode: false,
  },
  elite: {
    receipt_upload: true,
    ai_judgment: true,
    master_learning: true,
    csv_export: true,
    incentive: false,
    auto_ingest: true,
    auto_export: true,
    auto_rule_learning: true,
    auto_approval: true,
    industry_template: true,
    my_template: true,
    dashboard_full: true,
    career_path_full: true,
    chat_mode: true,           // Elite限定
    context_cross_judgment: true,
    closing_self_drive: true,
    fiscal_year_assist: true,
  },
};

// 機能判定関数
async function canUse(uid, feature) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=edition,plan_key`);
  const user = data?.[0];
  if (!user) return false;
  const edition = user.edition || 'saas'; // 未設定はSaaSとして扱う
  const features = EDITION_FEATURES[edition] || EDITION_FEATURES.saas;
  return features[feature] === true;
}

// プラン情報取得関数
async function getUserPlan(uid) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
  const user = data?.[0];
  if (!user || !user.plan_key) return null;
  const plan = STRIPE_PLANS[user.plan_key];
  return plan ? { ...plan, key: user.plan_key, edition: user.edition } : null;
}
```

**注意**: 段階的アンロック(ルーキー→ジュニア→...)の判定は v2.2.0 では作らない。v2.3.0 以降で `unlock_status` 列を追加して制御する。v2.2.0 では「Agent版ならその機能はON、SaaS版ならOFF」のシンプルな判定だけ。

### 3.3 月初リセットロジックの追加

現状の monthly_count は localStorage と Supabase の両方で管理されているが、月初リセットが localStorage 側でしか動いていない(月キーで参照しているため自然に変わるだけ)。Supabase 側はリセットされず累積する。これを修正する。

```javascript
// POST /api/user/count の処理を以下に修正
// 件数加算前に「請求期間が変わっていたら 0 リセット」を入れる
if (req.method === 'POST' && req.url === '/api/user/count') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { uid, amount } = JSON.parse(body);
      const userData = await supabaseQuery(`/users?id=eq.${uid}&select=monthly_count,billing_period_end`);
      const user = userData?.[0];
      const now = new Date();
      let cur = user?.monthly_count || 0;
      
      // 請求期間が終了していたらリセット
      if (user?.billing_period_end && new Date(user.billing_period_end) < now) {
        cur = 0;
        // 次の請求期間は webhook で更新されるため、ここでは触らない
      }
      
      const newCount = cur + (amount || 1);
      await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { monthly_count: newCount });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, monthly_count: newCount }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

### 3.4 Stripe Webhook の拡張

checkout.session.completed の処理で、plan_key と edition と billing_period_*** を保存する。

```javascript
if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  const uid = session.metadata?.firebase_uid;
  const planKey = session.metadata?.plan_key;
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  
  // subscription 情報を取得して請求期間を保存
  let billingPeriodStart = null, billingPeriodEnd = null;
  if (subscriptionId) {
    const sub = await stripeRequest(`/subscriptions/${subscriptionId}`);
    billingPeriodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null;
    billingPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  }
  
  const plan = STRIPE_PLANS[planKey];
  const edition = plan?.edition || 'saas';
  
  if (uid) {
    await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
      is_paid: true,
      is_free_trial: false,
      stripe_customer_id: customerId,
      paid_at: new Date().toISOString(),
      plan_key: planKey,
      edition: edition,
      billing_period_start: billingPeriodStart,
      billing_period_end: billingPeriodEnd,
      monthly_count: 0, // 新規加入時はリセット
    });
    console.log(`プラン契約: ${uid} → ${planKey} (${edition})`);
  }
}
```

`customer.subscription.updated` イベントも追加で監視する(請求期間更新のため)。

```javascript
// Stripeダッシュボード側で 'customer.subscription.updated' イベントの監視を追加してもらう
if (event.type === 'customer.subscription.updated') {
  const sub = event.data.object;
  const customerId = sub.customer;
  const billingPeriodStart = new Date(sub.current_period_start * 1000).toISOString();
  const billingPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
  await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}`, 'PATCH', {
    billing_period_start: billingPeriodStart,
    billing_period_end: billingPeriodEnd,
    monthly_count: 0, // 請求期間が更新されたら件数リセット
  });
  console.log(`請求期間更新: ${customerId}`);
}
```

### 3.5 GET /api/user/plan エンドポイント追加

フロント側からプラン情報を取得するための新エンドポイント。

```javascript
// GET /api/user/plan?uid=xxx → ユーザーのプラン情報取得
if (req.method === 'GET' && req.url.startsWith('/api/user/plan')) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
  try {
    const data = await supabaseQuery(`/users?id=eq.${uid}&select=plan_key,edition,monthly_count,billing_period_end`);
    const user = data?.[0];
    if (!user || !user.plan_key) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plan: null, edition: 'saas', features: EDITION_FEATURES.saas }));
      return;
    }
    const plan = STRIPE_PLANS[user.plan_key];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      plan: { key: user.plan_key, ...plan },
      edition: user.edition,
      features: EDITION_FEATURES[user.edition] || EDITION_FEATURES.saas,
      usage: {
        monthly_count: user.monthly_count || 0,
        limit: plan?.limit || null,
        billing_period_end: user.billing_period_end,
      }
    }));
  } catch(e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
  return;
}
```

---

## 🎨 4. index.html 変更

### 4.1 料金ページの全面改修

現状の料金ページは旧プラン(lite, unlimited, agency_*)が表示されている。これを新プラン(SaaS版5プラン + Agent版4プラン)に置き換える。

構成案:

```
┌─ AI SaaS版(自分で操作する仕訳ツール) ────────────┐
│   [個人ライト ¥980] [アンリミテッド ¥5,800]        │
│   [チームライト ¥20,000] [スタンダード ¥50,000]    │
│   [チームプレミアム ¥100,000]                      │
└──────────────────────────────────────────────┘

┌─ Agent版(自走する記帳エージェント) ──────────────┐
│   [Agent ベーシック ¥30,000]                      │
│   [Agent スタンダード ¥80,000]                    │
│   [Agent プレミアム ¥150,000]                     │
│   [★Agent エリート ¥250,000](最上位・対話モード搭載) │
└──────────────────────────────────────────────┘
```

メッセージング(v2.0.0/v2.1.0 のコピーガイドから引用):
- AI SaaS版セクションのリード: 「自分で操作する仕訳ツール」
- Agent版セクションのリード: 「ルーキーから、エージェントへ。そしてエリートへ。」
- Elite カードに特別感を出すバッジ: 「対話モード搭載」「内向き: ダブルO」

### 4.2 サイドバーの出し分け

`/api/user/plan` を取得して、edition に応じて表示するメニューを変える。

**SaaS版(edition: saas)で表示するもの**:
- ホーム、仕訳処理、取引先マスタ、CSV出力(現状維持)
- インセンティブ管理(オプション加入時のみ)

**Agent版(edition: agent)で追加表示するもの**:
- 「シワケのステータス」(キャリアパス表示)
- 「業種テンプレート」「Myテンプレート」(機能はv2.4.0以降だが、メニュー項目だけ用意)
- 「ダッシュボード」(機能はv2.10.0だが、メニュー項目だけ用意)

**Agent エリート(edition: elite)で追加表示するもの**:
- 「対話モード設定」(機能はv3.1.0以降だが、メニュー項目だけ用意)

メニュー項目を先に置く理由は、契約者に「将来こうなる」というロードマップを見せるため、および UI の見た目で差別化を成立させるため。実機能未実装の項目は「準備中」バッジを表示。

### 4.3 ステータス表示の追加

ホーム画面上部に、自分のプラン状態を示すバナーを追加。

**SaaS版の表示例**:
```
📋 アンリミテッドプラン
 今月の処理: 247件 / 無制限
 [Agent版にアップグレード →]
```

**Agent版の表示例**:
```
🤖 Agent ベーシック ・ ルーキー(0/50件)
 今月の処理: 12件 / 含む200件
 [Agent認定する] (機能準備中)
```

**Elite版の表示例**:
```
👤 Agent エリート ・ Lv5 エリート
 今月の処理: 1,234件 / 含む3,000件
 対話モード: Slack 連携済み(機能準備中)
```

### 4.4 旧UIの整理

- 旧 agency_* の表示は削除
- インセンティブオプションの表示は SaaS版選択時のみ表示

---

## 🚚 5. テスト顧客移行手順

### 5.1 既存テスト顧客の状態把握

まず Supabase から `is_paid: true` のユーザー一覧を出力して、現状の契約状況を確認する。

```sql
SELECT id, email, display_name, is_paid, monthly_count, stripe_customer_id 
FROM users WHERE is_paid = true;
```

### 5.2 移行ルール

旧プラン → 新プランの対応表:

| 旧プラン | 新プラン | 備考 |
|---|---|---|
| lite | saas_lite | 価格据え置き |
| unlimited | saas_unlimited | 価格据え置き |
| team_lite | saas_team_lite | 価格据え置き |
| team_std | saas_team_std | 価格据え置き |
| team_prem | saas_team_prem | 価格据え置き |
| agency_light | agent_basic | ¥35,000 → ¥30,000 に値下げ |
| agency_std | agent_std | ¥100,000 → ¥80,000 に値下げ |
| agency_prem | agent_premium | ¥200,000(またはv1.6.19の¥180,000) → ¥150,000 に値下げ |

### 5.3 移行手順

テスト顧客のみのため、以下のシンプルな手順で行う。

1. 該当テスト顧客に告知(LINE/メール等)
2. Stripe ダッシュボードで該当ユーザーの旧 subscription を確認
3. 既存 subscription を cancel(at_period_end でも即時でも可)
4. ユーザーに新プラン購入リンクを送り、再加入してもらう
5. webhook が走って Supabase に新 plan_key/edition が記録される

または、Claude Code 側で「移行用スクリプト」として、Supabase の plan_key/edition を直接書き換える運用も可能(Stripe 側との整合性は手動で取る)。

### 5.4 注意事項

- 旧 stripe_customer_id は維持(Stripe 側の決済履歴を引き継ぐため)
- monthly_count は移行時に 0 リセット推奨
- billing_period_*** は新 subscription の作成時に webhook 経由で設定される

---

## 🤝 6. 代理店制度(卸売モデル + 階段制マージン)

### 6.1 制度の全体像

shiwake-ai は **全9プラン(SaaS版5種・Agent版3種・Elite)を代理店に卸売販売**できる。代理店は通常価格の 60〜70% で仕入れ、自分の顧客に再販することで差額をマージンとして得る。

**重要な特徴**:
- shiwake-ai は代理店からの決済を直接受け取る(Stripe Connect 不要)
- 代理店は自分の顧客と直接契約・課金関係を持つ(代理店名義の請求書を発行)
- shiwake-ai 側は「代理店のサブスクリプション数 = 売上単位」で管理
- 代理店の月次取引高に応じて、卸売価格が階段状に下がる(マージンUP)

| 項目 | 内容 |
|---|---|
| **資格** | 簡易審査制(税理士・会計事務所・コンサル業を想定、申込後1〜2営業日で発行) |
| **対象プラン** | 全9プラン(SaaS版・Agent版・Elite すべて) |
| **卸売価格** | Bronze: 70% / Silver: 65% / Gold: 60% |
| **階段判定** | 月次取引高で自動判定(下記 6.2 節) |
| **送金方法** | 代理店 → shiwake-ai に直接 Stripe 決済(Connect不要) |
| **顧客への請求** | 代理店が独自に行う(shiwake-ai 関与なし) |

### 6.2 階段制マージンの設計

代理店の月次取引高(その代理店経由の全 subscription の卸売価格合計)で次月のランクを決定する。

| ランク | 月次取引高 | 卸売率 | 代理店マージン |
|---|---|---|---|
| **🥉 Bronze** | 〜¥100,000 | 70% | 30% |
| **🥈 Silver** | ¥100,001〜¥500,000 | 65% | 35% |
| **🥇 Gold** | ¥500,001〜 | 60% | 40% |

**シミュレーション例**:
- Agent ベーシック3社: ¥21,000×3 = ¥63,000(Bronze、マージン¥27,000)
- Agent プレミアム3社: ¥105,000×3 = ¥315,000(Silver、マージン¥135,000相当へ昇格)
- Agent エリート 2社+Agent ベーシック1社: ¥175,000×2+¥21,000 = ¥371,000(Silver)
- Agent エリート 4社: ¥175,000×4 = ¥700,000(Gold、マージン¥300,000相当)

**重要なルール**:
- ランク判定は**前月の取引高ベース**(月初バッチで判定 → 翌月のクーポン適用)
- 顧客の解約・追加でランクが変動する可能性あり
- 月次取引高は**卸売価格(Bronze基準)で計算**

### 6.3 マージン率変更の実装方式: Stripe Coupon

Stripe の subscription は契約時の price_ID で固定されるため、ランク変動を「Stripe Coupon を動的に適用」して実現する。

**仕組み**:
1. 代理店は **常に Bronze 価格(70%)の卸売プラン** で契約する
2. ランクが Silver/Gold に上がったら、subscription に Coupon を適用
   - `silver_discount`: 7.143% off → 実質65%価格
   - `gold_discount`: 14.286% off → 実質60%価格
3. ランクが下がったら Coupon を削除 or 別 Coupon に差し替え
4. これにより subscription を解約・再契約することなく価格変更できる

**計算根拠**:
- Bronze→Silver: ¥21,000 → ¥19,500(¥1,500 off / 7.143%)
- Bronze→Gold: ¥21,000 → ¥18,000(¥3,000 off / 14.286%)

### 6.4 DB設計(再掲・1.1節参照)

users テーブルの追加3列で代理店制度を管理:
- `is_reseller`(boolean): 代理店アカウントか
- `reseller_uid`(text): 顧客がどの代理店経由か
- `current_tier`(text): 'bronze' / 'silver' / 'gold'(代理店アカウントのみ)

### 6.5 代理店申込・審査フロー

**申込側(代理店候補)**:
1. 代理店申込ページ `/affiliate-apply` にアクセス
2. 法人名・業種・代表者名・連絡先・想定取扱顧客数を入力
3. 代理店規約に同意して送信

**審査側(運営)**:
1. 申込通知メールを受信
2. 業種が想定範囲内(税理士・会計事務所・コンサル等)かを目視確認
3. Supabase 管理画面で該当 user の `is_reseller = true` に更新
4. `current_tier = 'bronze'` をセット
5. 申込者にメールで「代理店登録完了」を通知

**運営側の作業を簡略化するため、自動審査ではなく手動審査を採用**(月数件レベルなら手動で十分)。

### 6.6 紹介URL の捕捉(代理店経由顧客の追跡)

代理店は固有の紹介URL を持つ。例: `https://shiwake-ai.com/?ref=AFF8K2X`

このURL経由で来た訪問者が新規登録した場合、`users.reseller_uid` に代理店UIDが自動セットされる。

**実装**:
```javascript
// index.html 側(全ページ共通)
(function captureReseller() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem('shiwake_reseller_ref', JSON.stringify({
      code: ref, capturedAt: Date.now()
    }));
  }
})();

// upsertUser 時に送る
function getActiveResellerRef() {
  const data = localStorage.getItem('shiwake_reseller_ref');
  if (!data) return null;
  const { code, capturedAt } = JSON.parse(data);
  const ageMs = Date.now() - capturedAt;
  if (ageMs > 30 * 24 * 60 * 60 * 1000) return null; // 30日有効
  return code;
}
```

### 6.7 server.js への API追加

#### POST /api/affiliate/apply

代理店申込(誰でも申込可・運営審査後に有効化)

```javascript
if (req.method === 'POST' && req.url === '/api/affiliate/apply') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { uid, email, companyName, industry, contact, estimatedCustomers, agreedTerms } = JSON.parse(body);
      if (!agreedTerms) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'terms not agreed' })); return;
      }
      // 申込内容を保存(承認待ちフラグ付き)
      await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
        affiliate_application: JSON.stringify({
          companyName, industry, contact, estimatedCustomers,
          appliedAt: new Date().toISOString(),
          status: 'pending'
        })
      });
      // 運営にメール通知(SendGrid 等)
      await sendAdminNotification('代理店申込', { uid, email, companyName });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'pending' }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

注: `affiliate_application` 列も users テーブルに追加(jsonb型で柔軟に保存)。

#### GET /api/affiliate/dashboard?uid=xxx

代理店ダッシュボードのデータ取得

```javascript
if (req.method === 'GET' && req.url.startsWith('/api/affiliate/dashboard')) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  try {
    const userData = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
    const user = userData?.[0];
    if (!user || !user.is_reseller) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'not a reseller' })); return;
    }
    // 配下の顧客一覧
    const customers = await supabaseQuery(
      `/users?reseller_uid=eq.${uid}&is_paid=eq.true&select=id,email,plan_key,billing_period_end`
    );
    // 月次取引高(卸売価格ベース・Bronze基準)
    let monthlyVolume = 0;
    for (const c of customers) {
      const wholesale = STRIPE_PLANS[`wholesale_${c.plan_key}`];
      if (wholesale?.price_yen) monthlyVolume += wholesale.price_yen;
    }
    // 次のランクまで
    let nextTier = null, nextThreshold = null;
    if (user.current_tier === 'bronze') { nextTier = 'silver'; nextThreshold = 100000; }
    else if (user.current_tier === 'silver') { nextTier = 'gold'; nextThreshold = 500000; }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      reseller: { uid, currentTier: user.current_tier, referralCode: user.referral_code },
      stats: {
        customerCount: customers.length,
        monthlyVolume,
        nextTier,
        nextThreshold,
        amountToNextTier: nextThreshold ? Math.max(0, nextThreshold - monthlyVolume) : null,
      },
      customers: customers,
      referralUrl: `https://shiwake-ai.com/?ref=${user.referral_code}`,
    }));
  } catch(e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
  return;
}
```

#### POST /api/admin/affiliate/approve

運営側: 代理店申込を承認

```javascript
if (req.method === 'POST' && req.url === '/api/admin/affiliate/approve') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { adminToken, uid } = JSON.parse(body);
      // 管理者認証(別途実装)
      if (!verifyAdminToken(adminToken)) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return;
      }
      // 紹介コード生成
      const referralCode = await generateReferralCode();
      // 代理店として有効化
      await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
        is_reseller: true,
        current_tier: 'bronze',
        referral_code: referralCode
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, referralCode }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

### 6.8 月次ランク判定バッチ

毎月1日 0:00 JST に走らせて、各代理店の取引高を集計しランクを更新する。

`scripts/update-reseller-tiers.js`:
```javascript
async function updateAllResellerTiers() {
  const resellers = await supabaseQuery('/users?is_reseller=eq.true');
  
  for (const r of resellers) {
    // 配下の active 顧客を取得
    const customers = await supabaseQuery(
      `/users?reseller_uid=eq.${r.id}&is_paid=eq.true`
    );
    
    // 取引高合計(卸売Bronze価格ベース)
    let volume = 0;
    for (const c of customers) {
      const wp = STRIPE_PLANS[`wholesale_${c.plan_key}`];
      if (wp?.price_yen) volume += wp.price_yen;
    }
    
    // ランク判定
    const newTier = volume >= 500000 ? 'gold' : volume >= 100000 ? 'silver' : 'bronze';
    const oldTier = r.current_tier;
    
    if (newTier === oldTier) continue;
    
    // ランク変動 → users 更新
    await supabaseQuery(`/users?id=eq.${r.id}`, 'PATCH', { current_tier: newTier });
    
    // Stripe Coupon の更新
    //   代理店本人の subscription に対して Coupon を適用/削除
    const couponId = newTier === 'gold' ? GOLD_COUPON_ID : 
                     newTier === 'silver' ? SILVER_COUPON_ID : null;
    
    // 代理店の全 subscription を取得
    const subs = await stripeRequest(
      `/subscriptions?customer=${r.stripe_customer_id}&status=active&limit=100`
    );
    for (const sub of subs.data) {
      // 既存 Coupon を削除して新 Coupon を適用
      await stripeRequest(`/subscriptions/${sub.id}`, 'POST', {
        coupon: couponId || ''  // 空文字列でクーポン削除
      });
    }
    
    console.log(`✓ ${r.email}: ${oldTier} → ${newTier} (volume: ¥${volume})`);
  }
}
```

Render の Cron Job で `0 0 1 * *`(月初0時 UTC = 9時 JST)に実行設定。

### 6.9 index.html への追加

#### 代理店申込ページ

```
┌──── 🤝 代理店として申し込む ────────────────────┐
│                                                │
│ shiwake-ai を顧客に提供して、ビジネスを拡大     │
│                                                │
│ 📊 卸売モデル(キックバックではなく仕入れ)       │
│ • Bronze(取引高〜¥10万): 70%卸 = 30%マージン   │
│ • Silver(〜¥50万): 65%卸 = 35%マージン         │
│ • Gold(¥50万超): 60%卸 = 40%マージン           │
│                                                │
│ 法人名・業種・代表者・連絡先・想定取扱顧客数    │
│ [入力フィールド]                                │
│                                                │
│ □ 代理店規約に同意する                          │
│                                                │
│ [申し込む]                                      │
│                                                │
│ ※ 1〜2営業日以内に審査結果をご連絡します       │
└────────────────────────────────────────────┘
```

#### 代理店ダッシュボード

```
┌──── 📊 代理店ダッシュボード ────────────────────┐
│                                                │
│ 🥈 現在のランク: Silver(マージン35%)            │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │
│ 月次取引高: ¥315,000                           │
│ Goldまでの残り: ¥185,000                       │
│ ████████████░░░░ 63%                           │
│                                                │
│ 🔗 紹介URL                                      │
│ https://shiwake-ai.com/?ref=AFF8K2X            │
│ [📋 コピー]                                     │
│                                                │
│ 👥 顧客一覧(active 7社)                         │
│ ┌──────────────────────────────────────────┐  │
│ │顧客 │ プラン         │卸売額  │次回更新 │   │
│ ├──────────────────────────────────────────┤  │
│ │A税理士 │ Agent ベーシック │¥21,000│2026-06-01│  │
│ │B事務所 │ Agent Standard  │¥56,000│2026-06-15│  │
│ │...                                       │   │
│ └──────────────────────────────────────────┘  │
│                                                │
│ 💡 ヒント                                       │
│ • Bronze→Silverで月¥15,750のマージン増加        │
│ • Silver→Goldで月¥31,500のマージン増加         │
└────────────────────────────────────────────┘
```

#### 代理店アカウントの料金ページ

代理店ログイン時は、料金ページが**卸売価格表示**に切り替わる:

```
🤝 代理店専用料金(あなたは Silver ランク・35%マージン)

Agent ベーシック   仕入: ¥19,500/月  (定価¥30,000)
Agent スタンダード 仕入: ¥52,000/月  (定価¥80,000)
Agent プレミアム   仕入: ¥97,500/月  (定価¥150,000)
Agent エリート        仕入: ¥162,500/月 (定価¥250,000)
```

定価との差額がそのまま代理店のマージンになることを明示。

### 6.10 代理店規約・法務論点

#### 規約に含むべき項目

- 卸売契約の対象プラン・価格・支払いサイクル
- 代理店の再販条件(価格自由・最低価格制限の有無等)
- 顧客への請求書発行責任(代理店が行う)
- 顧客サポートの分担(一次サポートは代理店、技術エスカレーションは shiwake-ai)
- 解約条件・通知期間
- 知的財産・商標利用ライセンス
- 機密保持・個人情報取扱い
- 準拠法・管轄裁判所

#### v2.2.0 で必要な準備

- 代理店規約のテンプレート作成(弁護士監修推奨)
- 特定商取引法表記の更新(代理店制度の追記)
- 利用規約への代理店モデル追記

#### 卸売モデルの法務的なシンプルさ

紹介報酬モデルと違い、卸売モデルは法務がシンプル:
- shiwake-ai 側の経理処理は通常の売上計上のみ
- 支払調書・源泉徴収・マイナンバー収集 → **不要**
- インボイス制度: 代理店側が顧客に発行する義務(shiwake-ai は代理店宛のインボイスを発行するだけ)

---

## 🚀 7. デプロイ手順

### 7.1 作業の順序

トラブル時の切り戻しを考えて、以下の順序で進める。

1. **DB列追加**(Supabase ダッシュボードで SQL 実行)
   - users テーブル列追加(plan_key, edition, billing_period_*, is_reseller, reseller_uid, current_tier, referral_code, affiliate_application)
   - 列追加だけなら既存コードに影響なし
2. **Stripe プラン・Coupon 作成**(Stripe ダッシュボードで手動)
   - 通常プラン9種を作成(または既存流用)
   - 卸売プラン9種を新規作成(Bronze 70% 価格)
   - silver_discount / gold_discount Coupon 作成
   - 旧プランは archive せず、まだ残す
3. **server.js 改修 + デプロイ**
   - STRIPE_PLANS、機能フラグ関数、API追加、webhook拡張
   - 代理店API群(/api/affiliate/*, /api/admin/affiliate/approve)
   - 新旧プランどちらでも動く状態を維持
4. **index.html 改修 + デプロイ**
   - 新料金ページ表示、サイドバー出し分け、ステータスバナー
   - 紹介URL捕捉(全ページ共通)
   - 代理店申込ページ・代理店ダッシュボード・代理店向け料金ページ
5. **代理店規約・特商法表記の整備**(法務確認後にデプロイ)
6. **月次ランク判定バッチ設定**(Render Cron Job)
   - `scripts/update-reseller-tiers.js` を `0 0 1 * *` で実行設定
7. **テスト顧客に告知 → 移行作業**
   - 1社ずつ確認しながら
8. **旧プラン archive**(Stripe ダッシュボードで手動)
   - 全テスト顧客の移行完了後

### 7.2 コミット単位

```bash
# コミット1: server.js 改修(プラン分離・機能フラグ)
git add server.js
git commit -m "v2.2.0: STRIPE_PLANS刷新・機能フラグ・件数リセット・webhook拡張"

# コミット2: server.js 代理店制度API追加
git add server.js scripts/update-reseller-tiers.js
git commit -m "v2.2.0: 代理店制度API(卸売モデル・階段制)・月次ランク判定バッチ"

# コミット3: index.html 改修(プラン表示)
git add index.html
git commit -m "v2.2.0: 料金ページ全面改修・サイドバー出し分け・ステータスバナー"

# コミット4: index.html 代理店UI追加
git add index.html
git commit -m "v2.2.0: 代理店申込ページ・代理店ダッシュボード・紹介URL捕捉・代理店向け料金"

# コミット5: 引き継ぎドキュメント
git add shiwake-ai_引き継ぎ_v2_2_0.md
git commit -m "v2.2.0: 引き継ぎドキュメント"

# まとめてpush
git push origin main
```

### 7.3 ロールバック手順

問題発生時は git revert で1コミットずつ戻す。Stripe 側のプラン作成・Coupon 作成・archive は手動で巻き戻す。
DB 列追加は revert しない(列があっても既存コードは動く)。

代理店制度のみのロールバックなら、コミット2と4を revert すれば代理店機能だけ無効化できる(DB は残す)。

---

## ✅ 8. 動作確認チェックリスト

### 8.1 機能フラグ

- [ ] SaaS版ユーザーで `/api/user/plan` を叩くと `edition: 'saas'`、`features.auto_ingest: false` が返る
- [ ] Agent版ユーザーで叩くと `edition: 'agent'`、`features.auto_ingest: true` が返る
- [ ] Elite版ユーザーで叩くと `edition: 'elite'`、`features.chat_mode: true` が返る
- [ ] 未契約ユーザー(is_paid: false)で叩くと SaaS のデフォルト feature が返る

### 8.2 課金・webhook

- [ ] Stripe テストモードで saas_lite を購入 → users テーブルに plan_key='saas_lite', edition='saas' が入る
- [ ] agent_basic を購入 → plan_key='agent_basic', edition='agent', billing_period_start/end が入る
- [ ] agent_elite を購入 → plan_key='agent_elite', edition='elite' が入る
- [ ] subscription cancel → is_paid: false に戻る(plan_key/edition は履歴として残してOK or NULL に戻すか要判断)

### 8.3 UI

- [ ] 料金ページが新プラン体系で表示される
- [ ] SaaS版契約者は SaaS 用サイドバー、Agent版契約者は Agent 用サイドバー
- [ ] ステータスバナーがプランに応じた件数・上限を表示
- [ ] 「機能準備中」バッジが未実装メニューに表示

### 8.4 件数集計

- [ ] 月初(billing_period_end 経過後)に最初の処理で monthly_count が 0 にリセットされる
- [ ] 月中の累積カウントが正しい
- [ ] saas_lite で 100件超えるとアラート表示(既存ロジック維持)
- [ ] agent_basic で 200件まで含む扱い、201件目はカウントは進むが課金は v2.2.1 まで未対応

### 8.5 テスト顧客移行

- [ ] 既存 is_paid テスト顧客が新プランに移行完了
- [ ] 移行後の処理件数カウントが新プランの請求期間に紐づいている

### 8.6 代理店制度(卸売モデル)

- [ ] `/api/affiliate/apply` で代理店申込 → users.affiliate_application に保存・運営に通知
- [ ] `/api/admin/affiliate/approve` で承認 → is_reseller=true、current_tier='bronze'、referral_code発行
- [ ] 紹介URL `?ref=AFF8K2X` でアクセス → localStorage に保存(30日有効)
- [ ] 紹介URL経由で新規顧客が登録 → users.reseller_uid に代理店UIDが入る
- [ ] 自分の紹介コードで自分が登録できないこと(自己契約防止)
- [ ] 既に紐付いた顧客が別の代理店経由で再アクセスしても上書きされないこと
- [ ] 代理店ログイン時、料金ページが**卸売価格**で表示される
- [ ] 代理店が wholesale_agent_basic を購入 → 自分の subscription として ¥21,000/月 が請求される
- [ ] 代理店ダッシュボード `/api/affiliate/dashboard` で顧客一覧・取引高・現在ランク・次のランクまでが正しく表示される
- [ ] 月次バッチで取引高 ¥100k 超 → Silver、¥500k 超 → Gold にランクアップ
- [ ] ランクアップ時、Stripe Coupon が代理店の subscription に自動適用される(silver/gold)
- [ ] ランクダウン時、Coupon が削除または別 Coupon に差し替わる
- [ ] 通常顧客と代理店の動作が明確に分離されている(代理店は卸売料金、通常顧客は通常料金)
- [ ] 代理店規約・特商法表記が更新されている

---

## 📦 9. v2.2.1 / v2.2.5 への引き継ぎ事項

### 9.1 v2.2.1: 件数従量課金(Stripe Metered Billing)

v2.2.0 完了後、v2.2.1 で「件数従量課金」を実装する。

**追加実装するもの**:
- Stripe Metered Billing 用の price 作成(超過分用、¥20/件)
- subscription 作成時に「ベース料金 + 従量料金」の line_items にする
- 月締め時に Stripe へ usage_record を送る処理(server.js)
- 件数集計の正確性確保(既に v2.2.0 で月初リセットは入る)
- 卸売プランも従量課金対応(代理店向けの超過単価設計)

**v2.2.0 で意識する設計判断**:
- monthly_count は agent/elite では「課金件数の根拠」になるため、不正な加算がないか厳密に
- 1ファイル複数件処理(明細分割)時のカウント方法を v2.2.1 で詰める
- API失敗時の補償(処理は成功したがカウントが進まない、など)も v2.2.1 で対応

### 9.2 v2.2.5: 代理店制度の拡張機能

v2.2.0 では卸売モデルの基本機能を実装。v2.2.5 で代理店向けの利便性を高める拡張機能を追加する。

**追加実装するもの**:
- 代理店向け一括管理機能(複数顧客の subscription を1画面でまとめて操作)
- 顧客の自動振り分け機能(代理店が自分の Stripe 経由で顧客を管理しやすく)
- 代理店向けレポート機能(月次取引高推移、ランクアップ予測)
- 代理店の取引高履歴管理(過去6ヶ月分のグラフ表示等)
- 紹介URL の QR コード生成
- 代理店向けの営業ツールキット(LP テンプレート、提案資料等の配布)

**v2.2.0 で意識する設計判断**:
- 代理店ダッシュボードは将来拡張前提でコンポーネント分割
- ランク履歴を保存する場合は別テーブル(`reseller_tier_history`)を追加検討
- 代理店経由の顧客の購買データはグラフ可視化を見据えてクエリ設計

**法務・運用の論点**:
- 卸売モデルは紹介報酬モデルと違い、支払調書・源泉徴収・マイナンバー収集 → **不要**(代理店が shiwake-ai に支払う構造のため)
- 代理店規約・特商法表記の継続更新

---

## 🛡 10. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| 移行中にテスト顧客の処理が止まる | 中 | 移行は1社ずつ、サブスク cancel → 即新プラン加入で空白を最小化 |
| webhook が動かず plan_key が NULL のまま | 高 | `/api/user/upsert` 時に「plan_key NULL かつ is_paid: true なら警告ログ」を入れる |
| 旧プラン archive 漏れで新規が旧プラン買える | 低 | 移行完了確認後に必ず archive |
| edition 未設定ユーザーで機能フラグが意図せず通る | 中 | EDITION_FEATURES のフォールバックは必ず 'saas' に固定 |
| 月初リセットが二重に走って件数が逆に増える | 中 | リセット判定を「billing_period_end が過去」のみで行う(現在の月かどうかは見ない) |
| 通常顧客が誤って卸売プランを購入する | 高 | フロント・サーバ両方で `is_reseller=true` のチェック必須、卸売 price_ID を直接URLで渡せないようにする |
| 紹介コード経由の自己契約による不正(自分→自分) | 中 | 登録時に `reseller_uid !== uid` のチェック必須 |
| 既存ユーザーが後から紹介URL経由で再アクセスして reseller_uid 上書き | 中 | 既に `reseller_uid` が設定されているユーザーは上書きしない |
| 月次ランク判定バッチの失敗 | 高 | バッチ失敗時にメール通知(運営側)、再実行コマンドを用意 |
| Stripe Coupon の適用に失敗 | 高 | バッチで try-catch、失敗した代理店リストを管理者に通知して手動対応 |
| ランク変動時に subscription が複数あって一部だけ Coupon 適用 | 中 | バッチでは代理店の全 subscription を取得して全件に適用、整合性チェック |
| 代理店規約・特商法表記の整備遅れ | 高 | リリース前に弁護士監修 必須 |
| 代理店審査の運用負担 | 中 | 月の申込件数が多くなったら半自動化(業種チェックの簡易判定等)を v2.2.5 で検討 |
| 代理店経由の顧客サポート責任分担の曖昧さ | 中 | 代理店規約で一次サポートは代理店、技術エスカレーションは shiwake-ai と明記 |
| 取引高が¥0でランクが Bronze に固定される代理店 | 低 | ダッシュボードで「まずは1社紹介してみましょう」と促す UI 追加 |

---

## 📌 設計思想の継承

v2.2.0 は基盤づくりだが、以下の v2.0.0 設計思想を踏襲する。

- **「何をどう判断させるかを明確に見せること」が継続利用につながる**
  - ステータスバナーで「いまあなたはこのプラン、この件数」を常に可視化
  - 代理店ダッシュボードで「いま何ランクで、Goldまで¥◯」を可視化
- **ユーザーが自分専用ツールを育てている感覚を大事にする**
  - 「機能準備中」メニュー項目で「これからこうなる」を見せる
  - 代理店も「育成プロセス(Bronze→Silver→Gold)」で関与感を演出
- **AI仕訳精度ファースト(コスト最適化より精度優先)**
  - v2.2.0 で AI 処理ロジックには手を入れない
- **代理店を「再販パートナー」として遇する**
  - 単なる紹介者ではなく、商品を仕入れて自分の顧客に売る「再販事業者」として位置づける
  - 階段制マージン(30→35→40%)で「成長」を演出、税理士事務所の本業の延長として魅力的に
  - 顧客との直接の課金関係は代理店が持つ → 代理店の自立性・収益性を最大化

---

## 📚 関連ドキュメント

- [`shiwake-ai_引き継ぎ_v2_0_0.md`](#) - 戦略・プロダクト方向性の確定
- [`shiwake-ai_引き継ぎ_v2_1_0.md`](#) - Agent Elite 新設・5階層キャリアパス(※過去文書では Agent Elite 表記、v2.2.0 以降は Agent エリート に統一)
- 次に作る: `shiwake-ai_引き継ぎ_v2_2_0.md` - 実装完了後の引き継ぎ

---

## 🎯 v2.2.0 完了の定義

### 必須(プラン分離)
- [ ] users テーブルに4列追加完了(plan_key, edition, billing_period_start, billing_period_end)
- [ ] Stripe に通常プラン9種が作成済み(または既存流用確定)
- [ ] server.js のプラン分離・機能フラグ・件数リセット改修完了・デプロイ済み
- [ ] index.html の料金ページ・サイドバー出し分け・ステータスバナー完了・デプロイ済み
- [ ] テスト顧客全員が新プランに移行完了
- [ ] 旧プランが Stripe で archive 済み

### 必須(代理店制度・卸売モデル)
- [ ] users テーブルに3列追加完了(is_reseller, reseller_uid, current_tier)
- [ ] users テーブルに紹介コード関連列追加(referral_code, affiliate_application)
- [ ] Stripe に卸売プラン9種が作成済み(Bronze 70%価格)
- [ ] Stripe に Coupon 2種類が作成済み(silver_discount, gold_discount)
- [ ] server.js の代理店API群(apply / dashboard / approve)完了・デプロイ済み
- [ ] `scripts/update-reseller-tiers.js` 作成・Render Cron Job 設定完了
- [ ] index.html の紹介URL捕捉・代理店申込ページ・代理店ダッシュボード・代理店向け料金ページ完了・デプロイ済み
- [ ] 代理店規約・特商法表記の整備完了(法務監修済み)
- [ ] 通常顧客が誤って卸売プランを購入できない(セキュリティチェック)

### 共通
- [ ] 動作確認チェックリスト全項目クリア
- [ ] 引き継ぎドキュメント `v2_2_0.md` 作成・ナレッジ追加完了

ここまで揃ったら、**v2.3.0(Phase 1: 自動取り込み実装)に進める**。
