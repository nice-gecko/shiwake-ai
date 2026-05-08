# shiwake-ai v2.2.0 実装仕様書

> **v2.2.0 の位置づけ**: v2.0.0 / v2.1.0 で確定した戦略(2モデル併売 + Elite追加)を、**実装基盤として整える**マイナーバージョン。
>
> 機能フラグの判定基盤、新料金体系への切り替え、DB拡張、UI出し分け、テスト顧客の移行、**代理店制度の入れ物整備**、までを一気にクリーンに行う。
>
> **件数従量課金(Stripe Metered Billing)は v2.2.1 に分離**。
> **代理店送金の Stripe Connect 統合は v2.2.5 に分離**(v2.2.0は手動振込で運用)。

---

## 📌 v2.2.0 ゴール

| 項目 | 達成基準 |
|---|---|
| **DB拡張** | users テーブルに plan_key・edition・billing_period_*・referral_code・referred_by の6列追加 |
| **新プラン定義** | server.js の STRIPE_PLANS が新料金体系(SaaS/Agent/Elite)に置き換わる |
| **機能フラグ** | `canUse(uid, feature)` 関数で AI SaaS版/Agent版/Elite の機能を判定可能 |
| **UI出し分け** | 料金ページ・サイドバー・ダッシュボード が edition に応じて表示変更 |
| **件数集計の正しさ** | monthly_count が月初に自動リセット、AgentとSaaSで上限判定が分岐 |
| **テスト顧客移行** | 旧プラン契約者を新プランに振り分けるスクリプト整備 |
| **代理店制度** | 紹介URL捕捉・代理店登録・段階制レート・月次バッチ・ダッシュボード・CSV出力 |

---

## 🗺 影響範囲

### 変更ファイル

| ファイル | 変更内容 | 規模 |
|---|---|---|
| `server.js` | STRIPE_PLANS 全面書き換え + 機能フラグ関数追加 + 件数リセット + 代理店API群追加 | 特大 |
| `index.html` | 料金ページ全面改修 + サイドバー出し分け + ステータス表示 + 代理店UI追加 | 特大 |
| `scripts/calculate-commissions.js` | 月次バッチ処理(新規ファイル) | 中 |
| Supabase | users列追加 + referrals/commissions/affiliates テーブル新設 | 中 |
| Stripe ダッシュボード | 新プラン作成・旧プラン archive(手動作業) | 中 |
| Render | Cron Job 設定追加(月次バッチ用) | 小 |

### 変更しないファイル

- `master.js`(取引先マスタ・触らない)
- `session.js`(セッション管理・触らない)
- API キー類(環境変数・触らない)

---

## 💾 1. DB設計変更

### 1.1 users テーブルへの列追加

Supabase の users テーブルに以下3列を追加する。

| 列名 | 型 | NULL | デフォルト | 説明 |
|---|---|---|---|---|
| `plan_key` | text | YES | NULL | 加入プランのキー(下記プラン定義参照) |
| `edition` | text | YES | NULL | 'saas' / 'agent' / 'elite' のいずれか |
| `billing_period_start` | timestamptz | YES | NULL | 当月の請求期間開始日(Stripe webhook由来) |
| `billing_period_end` | timestamptz | YES | NULL | 当月の請求期間終了日(月初リセット判定に使用) |

**既存列との関係**:
- `is_paid`: 既存のまま継続(plan_key が NULL でない = is_paid: true と一致させる)
- `monthly_count`: 既存のまま継続(billing_period_end を超えたら 0 リセットするロジックを server.js 側に追加)

### 1.2 マイグレーション SQL

```sql
ALTER TABLE users ADD COLUMN plan_key text;
ALTER TABLE users ADD COLUMN edition text;
ALTER TABLE users ADD COLUMN billing_period_start timestamptz;
ALTER TABLE users ADD COLUMN billing_period_end timestamptz;

-- 既存ユーザーの初期値設定(後述「テスト顧客移行」で詳細化)
UPDATE users SET plan_key = 'unlimited', edition = 'saas' 
WHERE is_paid = true AND plan_key IS NULL;
```

### 1.3 設計方針の理由

- **plan_key と edition を分けて持つ理由**: edition は機能判定の主軸(SaaS/Agent/Elite)、plan_key は課金ロジック・件数上限の参照に使う。両方持つことで「Agent ベーシックは agent edition だが含む件数は 200件」という細かい判定が可能。
- **subscriptions テーブルを別に作らなかった理由**: 1ユーザー1プランの前提が現状崩れていない、users テーブル拡張の方が変更影響が小さい、将来複数プラン契約が必要になったら別テーブルに切り出す。
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
| `agent_elite` | elite | Agent Elite | ¥250,000/月 | 3,000件 | ¥20/件 |

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

1. Stripe テストモードで以下9プランを新規作成
   - saas_lite (¥980)
   - saas_unlimited (¥5,800)
   - saas_team_lite (¥20,000)
   - saas_team_std (¥50,000)
   - saas_team_prem (¥100,000)
   - agent_basic (¥30,000)
   - agent_std (¥80,000)
   - agent_premium (¥150,000)
   - agent_elite (¥250,000)
2. 各プランの **price_ID** を取得して Claude Code に伝える(server.js への反映に必要)
3. 旧プラン(lite, unlimited, agency_*)を archive する
4. インセンティブオプション3つは旧プランのまま継続(price_ID 変更不要)

**注意**: `team_lite/std/prem` は旧 price_ID を流用するか、新規作成するかは要判断。価格・含む内容に変更がないなら流用が楽。新規作成するなら旧 team_* を archive。

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
  // ===== Agent Elite =====
  agent_elite:      { price_id: 'price_xxx', name: 'Agent Elite',         edition: 'elite', limit: 3000,  seats: 1, overage_unit_yen: 20 },
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
│   [★Agent Elite ¥250,000](最上位・対話モード搭載) │
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

**Agent Elite(edition: elite)で追加表示するもの**:
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
👤 Agent Elite ・ Lv5 エリート
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

## 🤝 6. 代理店制度(全プラン対象・継続インセンティブ)

### 6.1 制度の全体像

shiwake-ai は **全プラン(SaaS版5種・Agent版4種・Elite)を代理店経由でも販売可能**。代理店は紹介した顧客が支払い続ける限り、毎月**継続的に手数料**を受け取れる。

| 項目 | 内容 |
|---|---|
| **資格** | オープン(誰でも代理店登録可) |
| **対象プラン** | 全プラン(SaaS版・Agent版・Elite すべて) |
| **手数料形式** | 月次継続(顧客が支払う限り毎月発生) |
| **レート** | 段階制(紹介数に応じて 20% / 25% / 30%) |
| **送金方法** | v2.2.0: 手動振込(月次CSV) → v2.2.5: Stripe Connect 自動 |
| **支払いタイミング** | 月末締め・翌月末払い |

### 6.2 段階制レート

紹介した顧客数(=現在課金中の顧客数)に応じてレートが変わる。

| 段階 | 現在の有効紹介数 | レート | 例: Agentベーシック ¥30,000 紹介時の月収 |
|---|---|---|---|
| **Bronze** | 1〜4社 | **20%** | 月¥6,000 / 1社 |
| **Silver** | 5〜19社 | **25%** | 月¥7,500 / 1社 |
| **Gold** | 20社〜 | **30%** | 月¥9,000 / 1社 |

**重要なルール**:
- レートは **その月の有効紹介数で全紹介者に適用**(=Goldになると過去の紹介者全員も30%になる)
- 紹介数のカウントは「**当月課金が発生した紹介者数**」で算出
- 顧客が解約した場合、その月の手数料は発生しない

**シミュレーション例**:
- 3社紹介中(Bronze 20%): Agent ベーシック×3 → 月¥18,000
- 7社紹介中(Silver 25%): Agent ベーシック×7 → 月¥52,500
- 25社紹介中(Gold 30%): Agent ベーシック×25 → 月¥225,000

「専業代理店化」の到達点を月¥20万超に設定することで、**税理士事務所の副業**としても十分魅力的な収入源になる。

### 6.3 DB設計拡張

#### users テーブルに2列追加

| 列名 | 型 | NULL | 説明 |
|---|---|---|---|
| `referral_code` | text | YES | 自分の紹介コード(代理店登録時に発行・固有) |
| `referred_by` | text | YES | 自分を紹介した代理店の referral_code |

```sql
ALTER TABLE users ADD COLUMN referral_code text UNIQUE;
ALTER TABLE users ADD COLUMN referred_by text;
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);
```

#### referrals テーブル新設(紹介関係の履歴管理)

紹介関係を時系列で管理する。「いつ紐付いたか」「現在も有効か」を追えるようにする。

```sql
CREATE TABLE referrals (
  id bigserial PRIMARY KEY,
  affiliate_uid text NOT NULL,       -- 代理店のFirebase UID
  customer_uid text NOT NULL,         -- 紹介された顧客のFirebase UID
  affiliate_code text NOT NULL,       -- 紹介時に使われた紹介コード
  referred_at timestamptz NOT NULL DEFAULT NOW(),
  status text NOT NULL DEFAULT 'active', -- 'active' / 'churned' / 'invalid'
  notes text,
  UNIQUE(customer_uid)                -- 1顧客は1代理店にのみ紐付く
);
CREATE INDEX idx_referrals_affiliate ON referrals(affiliate_uid);
CREATE INDEX idx_referrals_status ON referrals(status);
```

#### commissions テーブル新設(月次報酬の記録)

月ごとに発生する報酬を記録する。CSV出力・支払い管理の元データ。

```sql
CREATE TABLE commissions (
  id bigserial PRIMARY KEY,
  affiliate_uid text NOT NULL,        -- 代理店のFirebase UID
  customer_uid text NOT NULL,         -- 顧客のFirebase UID
  period_yyyymm text NOT NULL,        -- '2026-05' 形式
  customer_payment_yen integer NOT NULL,  -- 顧客がその月支払った金額(税抜)
  rate decimal(4,2) NOT NULL,         -- 適用レート(0.20 / 0.25 / 0.30)
  commission_yen integer NOT NULL,    -- 報酬額(payment * rate)
  status text NOT NULL DEFAULT 'pending', -- 'pending' / 'paid' / 'cancelled'
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(affiliate_uid, customer_uid, period_yyyymm)
);
CREATE INDEX idx_commissions_affiliate_period ON commissions(affiliate_uid, period_yyyymm);
CREATE INDEX idx_commissions_status ON commissions(status);
```

#### affiliates テーブル新設(代理店プロフィール)

代理店としての登録情報を管理。連絡先、振込先(v2.2.0は手動振込)、登録日時など。

```sql
CREATE TABLE affiliates (
  uid text PRIMARY KEY,               -- Firebase UID(usersのidと一致)
  referral_code text NOT NULL UNIQUE, -- usersにも入るが正規データはこちら
  display_name text,
  email text,
  bank_info text,                     -- 振込先情報(v2.2.0手動振込用・暗号化推奨)
  agreed_terms_at timestamptz,        -- 代理店規約同意日時
  status text NOT NULL DEFAULT 'active', -- 'active' / 'suspended'
  created_at timestamptz NOT NULL DEFAULT NOW()
);
```

### 6.4 紹介URL・紹介コードの仕組み

#### 紹介コード発行

代理店登録時に、6〜8文字の英数字コードを自動生成。例: `AGT8K2X`, `M9P3LQ4R`

```javascript
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  let code;
  do {
    code = '';
    for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (await codeExists(code)); // 重複チェック
  return code;
}
```

#### 紹介URL の形式

```
https://shiwake-ai.com/?ref=AGT8K2X
```

URL アクセス時の処理:
1. `ref` パラメータがあれば localStorage に保存(キー: `shiwake_referral`)
2. localStorage の有効期限は **30日**(その間に登録すれば紐付く)
3. ユーザーが新規登録 → `/api/user/upsert` で `referred_by` 列に保存
4. 同時に `referrals` テーブルに紐付けレコードを作成

```javascript
// index.html 側
(function captureReferral() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem('shiwake_referral', JSON.stringify({
      code: ref,
      capturedAt: Date.now()
    }));
  }
})();

// upsertUser時に送る
function getActiveReferral() {
  const data = localStorage.getItem('shiwake_referral');
  if (!data) return null;
  const { code, capturedAt } = JSON.parse(data);
  const ageMs = Date.now() - capturedAt;
  if (ageMs > 30 * 24 * 60 * 60 * 1000) return null; // 30日超は無効
  return code;
}
```

#### 既存ユーザー(自分自身)による不正紹介の防止

- 自分の紹介コードで自分が登録できないようチェック
- 既に他の代理店経由で登録済みのユーザーは上書き不可

### 6.5 段階制レート判定ロジック

月次バッチで以下を実行。月初(毎月1日 0:00 JST)に走らせる想定。

```javascript
async function calculateMonthlyCommissions(targetYearMonth) {
  // targetYearMonth: '2026-05' 等
  
  // 1. 全代理店のリストを取得
  const affiliates = await supabaseQuery('/affiliates?status=eq.active');
  
  for (const affiliate of affiliates) {
    // 2. その代理店の「当月有効紹介者数」をカウント
    //   = referrals.status='active' かつ 顧客のusers.is_paid=true かつ 当月課金が発生
    const activeReferrals = await getActiveReferralsForMonth(
      affiliate.uid, 
      targetYearMonth
    );
    
    const count = activeReferrals.length;
    
    // 3. レート判定
    let rate;
    if (count >= 20) rate = 0.30;
    else if (count >= 5) rate = 0.25;
    else if (count >= 1) rate = 0.20;
    else continue; // 紹介者なしならスキップ
    
    // 4. 各紹介者ごとに commission レコードを作成
    for (const ref of activeReferrals) {
      const customerPayment = await getCustomerMonthlyPayment(
        ref.customer_uid, 
        targetYearMonth
      );
      const commissionYen = Math.floor(customerPayment * rate);
      
      await supabaseQuery('/commissions', 'POST', {
        affiliate_uid: affiliate.uid,
        customer_uid: ref.customer_uid,
        period_yyyymm: targetYearMonth,
        customer_payment_yen: customerPayment,
        rate: rate,
        commission_yen: commissionYen,
        status: 'pending'
      });
    }
  }
}
```

**重要な設計判断**:
- 月次バッチは **node-cron** または **Render の Cron Job** で実装
- 顧客の月次支払額は Stripe API から取得(`invoice.amount_paid`)
- 一度作成された commission レコードは原則変更しない(再計算が必要なら手動)

### 6.6 server.js への API追加

#### POST /api/affiliate/register

代理店登録(誰でも可・即時発行)

```javascript
if (req.method === 'POST' && req.url === '/api/affiliate/register') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { uid, email, displayName, bankInfo } = JSON.parse(body);
      
      // 既に代理店登録済みかチェック
      const existing = await supabaseQuery(`/affiliates?uid=eq.${uid}`);
      if (existing?.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true, 
          referralCode: existing[0].referral_code,
          alreadyRegistered: true 
        }));
        return;
      }
      
      // 紹介コード生成・登録
      const referralCode = await generateReferralCode();
      await supabaseQuery('/affiliates', 'POST', {
        uid, referral_code: referralCode, display_name: displayName,
        email, bank_info: bankInfo, agreed_terms_at: new Date().toISOString()
      });
      
      // users テーブルにも referral_code を反映
      await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { 
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

#### GET /api/affiliate/dashboard?uid=xxx

代理店ダッシュボードのデータ取得

```javascript
if (req.method === 'GET' && req.url.startsWith('/api/affiliate/dashboard')) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
  try {
    // 代理店情報
    const aff = (await supabaseQuery(`/affiliates?uid=eq.${uid}`))?.[0];
    if (!aff) { res.writeHead(404); res.end(JSON.stringify({ error: 'not registered' })); return; }
    
    // 紹介者一覧(active のみ)
    const refs = await supabaseQuery(`/referrals?affiliate_uid=eq.${uid}&status=eq.active`);
    
    // 当月の有効紹介者数 → レート判定
    const activeCount = refs.length;
    let currentRate = 0.20, tier = 'Bronze';
    if (activeCount >= 20) { currentRate = 0.30; tier = 'Gold'; }
    else if (activeCount >= 5) { currentRate = 0.25; tier = 'Silver'; }
    
    // 累計報酬
    const allCommissions = await supabaseQuery(`/commissions?affiliate_uid=eq.${uid}`);
    const totalEarned = allCommissions.reduce((sum, c) => sum + c.commission_yen, 0);
    const pendingPayment = allCommissions
      .filter(c => c.status === 'pending')
      .reduce((sum, c) => sum + c.commission_yen, 0);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      affiliate: aff,
      referralCode: aff.referral_code,
      referralUrl: `https://shiwake-ai.com/?ref=${aff.referral_code}`,
      stats: {
        activeReferrals: activeCount,
        currentTier: tier,
        currentRate: currentRate,
        totalEarned: totalEarned,
        pendingPayment: pendingPayment,
      },
      referrals: refs,
      commissions: allCommissions,
    }));
  } catch(e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
  return;
}
```

#### GET /api/admin/commissions/csv?period=2026-05

運営者向け: 月次報酬のCSV出力(振込用データ)

```javascript
if (req.method === 'GET' && req.url.startsWith('/api/admin/commissions/csv')) {
  const period = new URL(req.url, 'http://localhost').searchParams.get('period');
  // 認証チェック(管理者のみ)を必ず入れる
  // ...
  try {
    const data = await supabaseQuery(`/commissions?period_yyyymm=eq.${period}&status=eq.pending`);
    
    // 代理店ごとに集計
    const grouped = {};
    for (const c of data) {
      if (!grouped[c.affiliate_uid]) grouped[c.affiliate_uid] = [];
      grouped[c.affiliate_uid].push(c);
    }
    
    // CSV作成
    let csv = '代理店UID,代理店名,メール,振込先,合計報酬額,件数\n';
    for (const [uid, items] of Object.entries(grouped)) {
      const aff = (await supabaseQuery(`/affiliates?uid=eq.${uid}`))?.[0];
      const total = items.reduce((sum, c) => sum + c.commission_yen, 0);
      csv += `${uid},"${aff?.display_name || ''}","${aff?.email || ''}","${aff?.bank_info || ''}",${total},${items.length}\n`;
    }
    
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="commissions_${period}.csv"`
    });
    res.end('\uFEFF' + csv); // BOM付きでExcel対応
  } catch(e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
  }
  return;
}
```

#### POST /api/admin/commissions/mark-paid

支払い完了マーク(振込後に実行)

```javascript
if (req.method === 'POST' && req.url === '/api/admin/commissions/mark-paid') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { period, affiliateUids } = JSON.parse(body);
      // 管理者認証チェック
      // ...
      for (const uid of affiliateUids) {
        await supabaseQuery(
          `/commissions?affiliate_uid=eq.${uid}&period_yyyymm=eq.${period}&status=eq.pending`,
          'PATCH',
          { status: 'paid', paid_at: new Date().toISOString() }
        );
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

### 6.7 月次バッチの実装方法

Render の Cron Job 機能を使う。`render.yaml` または Render ダッシュボードで設定:

```yaml
# render.yaml
services:
  - type: cron
    name: monthly-commissions
    schedule: "0 0 1 * *"  # 毎月1日 0:00 UTC = 9:00 JST
    buildCommand: ""
    startCommand: "node scripts/calculate-commissions.js"
```

`scripts/calculate-commissions.js`:
```javascript
const { calculateMonthlyCommissions } = require('../server');

const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const ym = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

calculateMonthlyCommissions(ym)
  .then(() => { console.log(`✓ Commissions calculated for ${ym}`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
```

### 6.8 index.html への追加

#### 紹介URL の捕捉(全ページ共通)

ページ読み込み時に `?ref=XXX` パラメータを localStorage に保存(30日有効)。詳細は 6.4 参照。

#### 代理店登録ページ

新規ページ `affiliate-register.html` または既存 index.html 内のセクション:

```
┌──── 🤝 代理店として登録 ────────────────────┐
│                                            │
│ shiwake-ai を紹介して、継続収入を得る       │
│                                            │
│ ✓ 全プラン紹介可能(SaaS〜Elite)             │
│ ✓ 段階制レート(20% / 25% / 30%)             │
│ ✓ 紹介した顧客が支払い続ける限り、毎月収入  │
│ ✓ 登録は無料・即時発行                      │
│                                            │
│ [代理店規約に同意する] チェックボックス      │
│                                            │
│ 振込先情報(銀行・支店・口座番号・名義)       │
│ [入力フィールド]                             │
│                                            │
│ [代理店登録する]                             │
└──────────────────────────────────────────┘
```

登録後、紹介コードと紹介URLが表示される。

#### 代理店ダッシュボード

新規ページ or サイドバーから飛べる:

```
┌──── 📊 代理店ダッシュボード ─────────────────────┐
│                                                  │
│ 🤝 あなたのステータス                             │
│   ランク: 🥈 Silver(レート 25%)                  │
│   有効紹介数: 7社 / 次のランクまで あと13社       │
│                                                  │
│ 🔗 あなたの紹介URL                                │
│   https://shiwake-ai.com/?ref=AGT8K2X            │
│   [📋 コピー]                                     │
│                                                  │
│ 💰 累計報酬                                       │
│   累計獲得: ¥185,500                              │
│   未払い残高: ¥52,500                             │
│   次回支払予定: 2026-06-30                        │
│                                                  │
│ 👥 紹介者一覧                                     │
│   ┌─────────────────────────────────────────┐    │
│   │ 顧客名 │ プラン         │ 月額    │ 報酬  │    │
│   ├─────────────────────────────────────────┤    │
│   │ A税理士 │ Agent ベーシック │ ¥30,000 │¥7,500│    │
│   │ B事務所 │ Agent Standard  │ ¥80,000 │¥20,000│   │
│   │ ...                                    │    │
│   └─────────────────────────────────────────┘    │
│                                                  │
│ 📜 報酬履歴                                       │
│   2026-04: ¥120,000(支払済 2026-05-31)         │
│   2026-03: ¥85,000(支払済 2026-04-30)          │
│                                                  │
└──────────────────────────────────────────────┘
```

### 6.9 法務・税務の論点(v2.2.0で整理しておく)

v2.2.0 では Stripe Connect を使わないため、運営側で**個人代理店への支払いは雑所得・事業所得**扱いになる。以下の論点を仕様書段階で確認しておく。

#### 6.9.1 支払調書の提出義務

- 個人代理店への年間支払額が **5万円超** の場合、運営側は支払調書を税務署に提出する義務
- 代理店側に「マイナンバー」を求める運用が必要
- v2.2.0 リリース時点で、この収集フォームは登録時に必須化推奨

#### 6.9.2 源泉徴収

- 個人事業主への報酬は、業種により 10.21% の源泉徴収義務がある場合がある
- 紹介料・あっせん料は源泉徴収対象外(国税庁見解)が多いが、要確認
- **税理士に確認の上、必要なら源泉徴収を実装**(初期は要相談)

#### 6.9.3 インボイス制度対応

- 適格請求書発行事業者として登録された代理店からの請求は仕入税額控除可
- 未登録代理店からの請求は経過措置期間中(2029年9月まで段階的削減)
- 代理店登録時に「**適格請求書発行事業者か否か**」を入力させる
- 運営側のインボイス対応は会計士と相談

#### 6.9.4 代理店規約

最低限の規約を整備する。論点:
- 紹介料の算定方法・支払い時期・支払い方法
- 解約時の取り扱い
- 不正紹介(自己契約の偽装等)の禁止
- 個人情報の取り扱い
- 解約事由・運営側の解除権
- 準拠法・管轄裁判所

専門家(弁護士・税理士)監修推奨。テンプレートは v2.2.0 までに整備。

### 6.10 v2.2.5 への引き継ぎ事項

v2.2.5 で Stripe Connect に移行する際の準備として、v2.2.0 で意識する設計:

- `affiliates.bank_info` は Stripe Connect 移行時には不要になる(削除予定の列)
- 月次の commission 計算ロジックは Stripe Connect でも流用可能(Application Fee として実装)
- 紹介URL・紹介コードの仕組みは Stripe Connect 関係なく継続使用
- 代理店ダッシュボードのUIも継続使用

v2.2.5 で追加実装するもの:
- Stripe Connect Express アカウント作成フロー
- 代理店オンボーディング(本人確認・銀行口座登録)
- Application Fee 経由の自動送金
- KYC・税務情報の自動収集

---

## 🚀 7. デプロイ手順

### 7.1 作業の順序

トラブル時の切り戻しを考えて、以下の順序で進める。

1. **DB列・テーブル追加**(Supabase ダッシュボードで SQL 実行)
   - users テーブル列追加(plan_key, edition, billing_period_*, referral_code, referred_by)
   - referrals / commissions / affiliates テーブル新設
   - 列・テーブル追加だけなら既存コードに影響なし
2. **Stripe 新プラン作成**(Stripe ダッシュボードで手動)
   - 旧プランは archive せず、まだ残す
3. **server.js 改修 + デプロイ**
   - STRIPE_PLANS、機能フラグ関数、API追加、webhook拡張
   - 代理店API群(/api/affiliate/*, /api/admin/commissions/*)
   - 新旧プランどちらでも動く状態を維持
4. **index.html 改修 + デプロイ**
   - 新料金ページ表示、サイドバー出し分け、ステータスバナー
   - 紹介URL捕捉(全ページ共通)
   - 代理店登録ページ・代理店ダッシュボード
5. **代理店規約・特商法表記の整備**(法務確認後にデプロイ)
6. **月次バッチ設定**(Render Cron Job)
   - `scripts/calculate-commissions.js` を `0 0 1 * *` で実行設定
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
git add server.js scripts/calculate-commissions.js
git commit -m "v2.2.0: 代理店制度API・月次バッチ・段階制レート判定"

# コミット3: index.html 改修(プラン表示)
git add index.html
git commit -m "v2.2.0: 料金ページ全面改修・サイドバー出し分け・ステータスバナー"

# コミット4: index.html 代理店UI追加
git add index.html
git commit -m "v2.2.0: 代理店登録ページ・代理店ダッシュボード・紹介URL捕捉"

# コミット5: 引き継ぎドキュメント
git add shiwake-ai_引き継ぎ_v2_2_0.md
git commit -m "v2.2.0: 引き継ぎドキュメント"

# まとめてpush
git push origin main
```

### 7.3 ロールバック手順

問題発生時は git revert で1コミットずつ戻す。Stripe 側のプラン作成・archive は手動で巻き戻す。
DB 列・テーブル追加は revert しない(列・テーブルがあっても既存コードは動く)。

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

### 8.6 代理店制度

- [ ] `/api/affiliate/register` で代理店登録 → referral_code 発行・affiliates テーブルに記録
- [ ] 紹介URL `?ref=AGT8K2X` でアクセス → localStorage に保存(30日有効)
- [ ] 紹介URL経由で新規登録 → users.referred_by に紹介コードが入る
- [ ] referrals テーブルに紐付けレコードが作成される
- [ ] 自分の紹介コードで自分が登録できないこと(防止)
- [ ] 既に紐付いた顧客が別の代理店経由で再登録しても上書きされないこと
- [ ] 代理店ダッシュボード `/api/affiliate/dashboard` で紹介者一覧・累計報酬・現在ランクが正しく表示される
- [ ] 紹介数 4社 → Bronze 20% / 5社 → Silver 25% / 20社 → Gold 30% に変わる
- [ ] 月次バッチが commission レコードを生成する(テスト実行可能であること)
- [ ] 管理者向けCSV出力 `/api/admin/commissions/csv?period=2026-05` が正しく動く
- [ ] 支払いマーク `/api/admin/commissions/mark-paid` で status: 'paid' に更新される
- [ ] 顧客が解約した月は commission が発生しない

---

## 📦 9. v2.2.1 / v2.2.5 への引き継ぎ事項

### 9.1 v2.2.1: 件数従量課金(Stripe Metered Billing)

v2.2.0 完了後、v2.2.1 で「件数従量課金」を実装する。

**追加実装するもの**:
- Stripe Metered Billing 用の price 作成(超過分用、¥20/件)
- subscription 作成時に「ベース料金 + 従量料金」の line_items にする
- 月締め時に Stripe へ usage_record を送る処理(server.js)
- 件数集計の正確性確保(既に v2.2.0 で月初リセットは入る)

**v2.2.0 で意識する設計判断**:
- monthly_count は agent/elite では「課金件数の根拠」になるため、不正な加算がないか厳密に
- 1ファイル複数件処理(明細分割)時のカウント方法を v2.2.1 で詰める
- API失敗時の補償(処理は成功したがカウントが進まない、など)も v2.2.1 で対応

### 9.2 v2.2.5: 代理店制度の Stripe Connect 移行

v2.2.0 では代理店への送金は手動振込(月次CSV)だが、v2.2.5 で Stripe Connect に移行する。

**追加実装するもの**:
- Stripe Connect Express アカウント作成フロー
- 代理店オンボーディング(本人確認 KYC・銀行口座登録)
- Application Fee 経由の自動送金
- 代理店規約・税務情報の自動収集UI
- `account.updated`、`transfer.created` などの webhook イベント追加

**v2.2.0 で意識する設計判断**:
- `affiliates.bank_info` は Stripe Connect 移行時には Stripe 側で管理されるため、削除予定の列
- 月次の commission 計算ロジックは Stripe Connect でも流用可能(Application Fee として実装)
- 紹介URL・紹介コードの仕組みは Stripe Connect 関係なく継続使用
- 代理店ダッシュボードのUIも継続使用

**法務・税務の継続論点**:
- マイナンバー収集・支払調書提出義務 → Stripe Connect 移行後も運営側責任
- 源泉徴収義務の有無 → 専門家確認結果を踏まえて自動化判断
- インボイス制度対応 → 代理店登録時の入力情報を Stripe Connect 側にも連携

---

## 🛡 10. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| 移行中にテスト顧客の処理が止まる | 中 | 移行は1社ずつ、サブスク cancel → 即新プラン加入で空白を最小化 |
| webhook が動かず plan_key が NULL のまま | 高 | `/api/user/upsert` 時に「plan_key NULL かつ is_paid: true なら警告ログ」を入れる |
| 旧プラン archive 漏れで新規が旧プラン買える | 低 | 移行完了確認後に必ず archive |
| edition 未設定ユーザーで機能フラグが意図せず通る | 中 | EDITION_FEATURES のフォールバックは必ず 'saas' に固定 |
| 月初リセットが二重に走って件数が逆に増える | 中 | リセット判定を「billing_period_end が過去」のみで行う(現在の月かどうかは見ない) |
| 紹介コードの自己契約による不正(自分→自分) | 中 | 登録時に `referred_by !== referral_code` のチェック必須 |
| 既存ユーザーが後から紹介URL経由で再アクセスして紐付け上書きされる | 中 | 既に `referred_by` が設定されているユーザーは上書きしない |
| 月次バッチ失敗で報酬計算が抜ける | 高 | バッチ失敗時にメール通知(運営側)、再実行コマンドを用意 |
| 代理店規約・特商法表記の整備遅れ | 高 | リリース前に弁護士・税理士監修 必須 |
| 個人代理店への支払いで支払調書提出義務(年5万超) | 中 | マイナンバー収集を登録時に必須化 |
| 大量紹介でレート計算負荷増 | 低 | 月次バッチで実行のため即時性は不要、N+1問題には注意 |

---

## 📌 設計思想の継承

v2.2.0 は基盤づくりだが、以下の v2.0.0 設計思想を踏襲する。

- **「何をどう判断させるかを明確に見せること」が継続利用につながる**
  - ステータスバナーで「いまあなたはこのプラン、この件数」を常に可視化
  - 代理店ダッシュボードで「いま何ランクで、次のランクまで何社」を可視化
- **ユーザーが自分専用ツールを育てている感覚を大事にする**
  - 「機能準備中」メニュー項目で「これからこうなる」を見せる
  - 代理店も「育成プロセス(Bronze→Silver→Gold)」で関与感を演出
- **AI仕訳精度ファースト(コスト最適化より精度優先)**
  - v2.2.0 で AI 処理ロジックには手を入れない
- **代理店もエージェントとして遇する**
  - 単なる紹介者ではなく、商品を熟知して紹介する「販売エージェント」として位置づける
  - 段階制レートで「成長」を演出、税理士事務所の副業として魅力的に

---

## 📚 関連ドキュメント

- [`shiwake-ai_引き継ぎ_v2_0_0.md`](#) - 戦略・プロダクト方向性の確定
- [`shiwake-ai_引き継ぎ_v2_1_0.md`](#) - Agent Elite 新設・5階層キャリアパス
- 次に作る: `shiwake-ai_引き継ぎ_v2_2_0.md` - 実装完了後の引き継ぎ

---

## 🎯 v2.2.0 完了の定義

### 必須(プラン分離)
- [ ] users テーブルに4列追加完了(plan_key, edition, billing_period_start, billing_period_end)
- [ ] Stripe に新プラン9種が作成済み
- [ ] server.js のプラン分離・機能フラグ・件数リセット改修完了・デプロイ済み
- [ ] index.html の料金ページ・サイドバー出し分け・ステータスバナー完了・デプロイ済み
- [ ] テスト顧客全員が新プランに移行完了
- [ ] 旧プランが Stripe で archive 済み

### 必須(代理店制度)
- [ ] users テーブルに2列追加完了(referral_code, referred_by)
- [ ] referrals / commissions / affiliates テーブル作成完了
- [ ] server.js の代理店API群(register / dashboard / commissions / mark-paid)完了・デプロイ済み
- [ ] `scripts/calculate-commissions.js` 作成・Render Cron Job 設定完了
- [ ] index.html の紹介URL捕捉・代理店登録ページ・代理店ダッシュボード完了・デプロイ済み
- [ ] 代理店規約・特商法表記の整備完了(法務監修済み)

### 共通
- [ ] 動作確認チェックリスト全項目クリア
- [ ] 引き継ぎドキュメント `v2_2_0.md` 作成・ナレッジ追加完了

ここまで揃ったら、**v2.3.0(Phase 1: 自動取り込み実装)に進める**。
