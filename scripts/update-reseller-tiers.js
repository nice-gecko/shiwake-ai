// 月次代理店ランク判定バッチ
// Render Cron Job: 毎月1日 0:00 UTC (= 9:00 JST)
// スケジュール設定: "0 0 1 * *"

const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
const fs = require('fs');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const SUPABASE_URL = 'https://tmddairlgpyinqfekkfg.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

const RESELLER_TIER_THRESHOLDS = { silver: 100000, gold: 500000 };
const RESELLER_COUPONS = {
  silver: 'silver_discount',
  gold:   'gold_discount',
  bronze: null,
};

// plan_key → Bronze 卸売価格のマッピング
const RESELLER_PRICE_MAP = {
  ai_saas_lite: 686, ai_saas_unlimited: 4060,
  ai_saas_team_lite: 14000, ai_saas_team_std: 35000, ai_saas_team_prem: 70000,
  agent_lite: 21000, agent_std: 56000, agent_premium: 105000, agent_elite: 175000,
};

async function supabaseQuery(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=representation',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function stripeRequest(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  };
  if (body) opts.body = new URLSearchParams(body).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data;
}

async function updateAllResellerTiers() {
  const resellers = await supabaseQuery('/users?is_reseller=eq.true&select=id,email,stripe_customer_id,current_tier');
  if (!resellers || resellers.length === 0) {
    console.log('代理店アカウントなし');
    return;
  }
  console.log(`代理店数: ${resellers.length}`);

  for (const r of resellers) {
    try {
      const customers = await supabaseQuery(
        `/users?reseller_uid=eq.${r.id}&is_paid=eq.true&select=plan_key`
      );
      let volume = 0;
      for (const c of customers) {
        const price = RESELLER_PRICE_MAP[c.plan_key];
        if (price) volume += price;
      }

      const newTier = volume >= RESELLER_TIER_THRESHOLDS.gold   ? 'gold'
                    : volume >= RESELLER_TIER_THRESHOLDS.silver ? 'silver'
                    : 'bronze';
      const oldTier = r.current_tier || 'bronze';

      console.log(`${r.email}: volume=¥${volume} ${oldTier} → ${newTier}`);

      if (newTier !== oldTier) {
        await supabaseQuery(`/users?id=eq.${r.id}`, 'PATCH', { current_tier: newTier });

        // Stripe Coupon を全 subscription に適用/削除
        if (r.stripe_customer_id && STRIPE_SECRET_KEY) {
          const subs = await stripeRequest(
            `/subscriptions?customer=${r.stripe_customer_id}&status=active&limit=100`
          );
          const couponId = RESELLER_COUPONS[newTier] || '';
          for (const sub of subs.data) {
            await stripeRequest(`/subscriptions/${sub.id}`, 'POST', { coupon: couponId });
          }
          console.log(`  Coupon更新: ${couponId || '(削除)'} (${subs.data.length}件)`);
        }
      }
    } catch(e) {
      console.error(`${r.email} エラー:`, e.message);
    }
  }
  console.log('完了');
}

updateAllResellerTiers()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
