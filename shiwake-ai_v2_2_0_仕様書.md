# shiwake-ai v2.2.0 実装仕様書

> **v2.2.0 の位置づけ**: v2.0.0 / v2.1.0 で確定した戦略(2モデル併売 + Elite追加)を、**実装基盤として整える**マイナーバージョン。
>
> 機能フラグの判定基盤、新料金体系への切り替え、DB拡張、UI出し分け、テスト顧客の移行、までを一気にクリーンに行う。
>
> **件数従量課金(Stripe Metered Billing)は v2.2.1 に分離**。v2.2.0 では「件数集計の仕組みを整える」ところまで。

---

## 📌 v2.2.0 ゴール

| 項目 | 達成基準 |
|---|---|
| **DB拡張** | users テーブルに plan_key・edition・billing_period_start/end の3列追加 |
| **新プラン定義** | server.js の STRIPE_PLANS が新料金体系(SaaS/Agent/Elite)に置き換わる |
| **機能フラグ** | `canUse(uid, feature)` 関数で AI SaaS版/Agent版/Elite の機能を判定可能 |
| **UI出し分け** | 料金ページ・サイドバー・ダッシュボード が edition に応じて表示変更 |
| **件数集計の正しさ** | monthly_count が月初に自動リセット、AgentとSaaSで上限判定が分岐 |
| **テスト顧客移行** | 旧プラン契約者を新プランに振り分けるスクリプト整備 |

---

## 🗺 影響範囲

### 変更ファイル

| ファイル | 変更内容 | 規模 |
|---|---|---|
| `server.js` | STRIPE_PLANS 全面書き換え + 機能フラグ関数追加 + 件数リセットロジック追加 | 大 |
| `index.html` | 料金ページ全面改修 + サイドバー出し分け + ステータス表示 | 大 |
| Supabase users テーブル | 列追加(plan_key, edition, billing_period_start, billing_period_end) | 中 |
| Stripe ダッシュボード | 新プラン作成・旧プラン archive(手動作業) | 中 |

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

## 🚀 6. デプロイ手順

### 6.1 作業の順序

トラブル時の切り戻しを考えて、以下の順序で進める。

1. **DB列追加**(Supabase ダッシュボードで SQL 実行)
   - 列追加だけなら既存コードに影響なし
2. **Stripe 新プラン作成**(Stripe ダッシュボードで手動)
   - 旧プランは archive せず、まだ残す
3. **server.js 改修 + デプロイ**
   - STRIPE_PLANS、機能フラグ関数、API追加、webhook拡張
   - 新旧プランどちらでも動く状態を維持
4. **index.html 改修 + デプロイ**
   - 新料金ページ表示、サイドバー出し分け、ステータスバナー
5. **テスト顧客に告知 → 移行作業**
   - 1社ずつ確認しながら
6. **旧プラン archive**(Stripe ダッシュボードで手動)
   - 全テスト顧客の移行完了後

### 6.2 コミット単位

```bash
# コミット1: server.js 改修
git add server.js
git commit -m "v2.2.0: STRIPE_PLANS刷新・機能フラグ・件数リセット・webhook拡張"

# コミット2: index.html 改修
git add index.html
git commit -m "v2.2.0: 料金ページ全面改修・サイドバー出し分け・ステータスバナー"

# コミット3: 引き継ぎドキュメント
git add shiwake-ai_引き継ぎ_v2_2_0.md
git commit -m "v2.2.0: 引き継ぎドキュメント"

# まとめてpush
git push origin main
```

### 6.3 ロールバック手順

問題発生時は git revert で1コミットずつ戻す。Stripe 側のプラン作成・archive は手動で巻き戻す。
DB 列追加は revert しない(列があっても既存コードは動く)。

---

## ✅ 7. 動作確認チェックリスト

### 7.1 機能フラグ

- [ ] SaaS版ユーザーで `/api/user/plan` を叩くと `edition: 'saas'`、`features.auto_ingest: false` が返る
- [ ] Agent版ユーザーで叩くと `edition: 'agent'`、`features.auto_ingest: true` が返る
- [ ] Elite版ユーザーで叩くと `edition: 'elite'`、`features.chat_mode: true` が返る
- [ ] 未契約ユーザー(is_paid: false)で叩くと SaaS のデフォルト feature が返る

### 7.2 課金・webhook

- [ ] Stripe テストモードで saas_lite を購入 → users テーブルに plan_key='saas_lite', edition='saas' が入る
- [ ] agent_basic を購入 → plan_key='agent_basic', edition='agent', billing_period_start/end が入る
- [ ] agent_elite を購入 → plan_key='agent_elite', edition='elite' が入る
- [ ] subscription cancel → is_paid: false に戻る(plan_key/edition は履歴として残してOK or NULL に戻すか要判断)

### 7.3 UI

- [ ] 料金ページが新プラン体系で表示される
- [ ] SaaS版契約者は SaaS 用サイドバー、Agent版契約者は Agent 用サイドバー
- [ ] ステータスバナーがプランに応じた件数・上限を表示
- [ ] 「機能準備中」バッジが未実装メニューに表示

### 7.4 件数集計

- [ ] 月初(billing_period_end 経過後)に最初の処理で monthly_count が 0 にリセットされる
- [ ] 月中の累積カウントが正しい
- [ ] saas_lite で 100件超えるとアラート表示(既存ロジック維持)
- [ ] agent_basic で 200件まで含む扱い、201件目はカウントは進むが課金は v2.2.1 まで未対応

### 7.5 テスト顧客移行

- [ ] 既存 is_paid テスト顧客が新プランに移行完了
- [ ] 移行後の処理件数カウントが新プランの請求期間に紐づいている

---

## 📦 8. v2.2.1 への引き継ぎ事項

v2.2.0 完了後、v2.2.1 で「件数従量課金(Stripe Metered Billing)」を実装する。そのために以下を準備しておく。

### 8.1 v2.2.1 で追加実装するもの

- Stripe Metered Billing 用の price 作成(超過分用、¥20/件)
- subscription 作成時に「ベース料金 + 従量料金」の line_items にする
- 月締め時に Stripe へ usage_record を送る処理(server.js)
- 件数集計の正確性確保(既に v2.2.0 で月初リセットは入る)

### 8.2 v2.2.0 で意識する設計判断

- monthly_count は agent/elite では「課金件数の根拠」になるため、不正な加算がないか厳密に
- 1ファイル複数件処理(明細分割)時のカウント方法を v2.2.1 で詰める
- API失敗時の補償(処理は成功したがカウントが進まない、など)も v2.2.1 で対応

---

## 🛡 9. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| 移行中にテスト顧客の処理が止まる | 中 | 移行は1社ずつ、サブスク cancel → 即新プラン加入で空白を最小化 |
| webhook が動かず plan_key が NULL のまま | 高 | `/api/user/upsert` 時に「plan_key NULL かつ is_paid: true なら警告ログ」を入れる |
| 旧プラン archive 漏れで新規が旧プラン買える | 低 | 移行完了確認後に必ず archive |
| edition 未設定ユーザーで機能フラグが意図せず通る | 中 | EDITION_FEATURES のフォールバックは必ず 'saas' に固定 |
| 月初リセットが二重に走って件数が逆に増える | 中 | リセット判定を「billing_period_end が過去」のみで行う(現在の月かどうかは見ない) |

---

## 📌 設計思想の継承

v2.2.0 は基盤づくりだが、以下の v2.0.0 設計思想を踏襲する。

- **「何をどう判断させるかを明確に見せること」が継続利用につながる**
  - ステータスバナーで「いまあなたはこのプラン、この件数」を常に可視化
- **ユーザーが自分専用ツールを育てている感覚を大事にする**
  - 「機能準備中」メニュー項目で「これからこうなる」を見せる
- **AI仕訳精度ファースト(コスト最適化より精度優先)**
  - v2.2.0 で AI 処理ロジックには手を入れない

---

## 📚 関連ドキュメント

- [`shiwake-ai_引き継ぎ_v2_0_0.md`](#) - 戦略・プロダクト方向性の確定
- [`shiwake-ai_引き継ぎ_v2_1_0.md`](#) - Agent Elite 新設・5階層キャリアパス
- 次に作る: `shiwake-ai_引き継ぎ_v2_2_0.md` - 実装完了後の引き継ぎ

---

## 🎯 v2.2.0 完了の定義

- [ ] DB に4列追加完了
- [ ] Stripe に新プラン9種が作成済み
- [ ] server.js 改修完了・デプロイ済み
- [ ] index.html 改修完了・デプロイ済み
- [ ] テスト顧客全員が新プランに移行完了
- [ ] 旧プランが Stripe で archive 済み
- [ ] 動作確認チェックリスト全項目クリア
- [ ] 引き継ぎドキュメント `v2_2_0.md` 作成・ナレッジ追加完了

ここまで揃ったら、**v2.3.0(Phase 1: 自動取り込み実装)に進める**。
