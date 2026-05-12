const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute, findMasterMatch } = require('./master');
const { getSession, appendToSession, saveSession, deleteSession } = require('./session');
const { computeHash, getHashedResult, setHashedResult, cleanupAllHashes } = require('./hashes');

// Dropbox SDK (オプション: npm install dropbox が必要)
let DropboxClass;
try { DropboxClass = require('dropbox').Dropbox; } catch(e) { console.warn('dropbox package not installed — Dropbox integration disabled'); }

// googleapis (オプション: npm install googleapis が必要)
let googleApis;
try { googleApis = require('googleapis').google; } catch(e) { console.warn('googleapis package not installed — GDrive integration disabled'); }

// インセンティブ設定（後から変更可能）
const INCENTIVE_THRESHOLD = 1000; // 何枚でギフト券1枚
const INCENTIVE_AMOUNT    = 500;  // ギフト券の金額（円）
const INCENTIVE_ALL_PLANS = false; // 本番: 代理店・チームプランのみ（adminは画面で切替可能）

// Stripe設定
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PLANS = {
  // ===== AI SaaS版 =====
  ai_saas_lite:               { price_id: 'price_1TVDERFHQeEbTFygV4V6gpgQ', name: 'ライト',                          edition: 'saas',  limit: 100,  seats: 1,  price_yen: 980 },
  ai_saas_unlimited:          { price_id: 'price_1TVDETFHQeEbTFygtldA3HrT', name: 'アンリミテッド',                  edition: 'saas',  limit: null, seats: 1,  price_yen: 5800 },
  ai_saas_team_lite:          { price_id: 'price_1TVDEPFHQeEbTFygV6mYPkpt', name: 'チームライト',                    edition: 'saas',  limit: null, seats: 5,  price_yen: 20000 },
  ai_saas_team_std:           { price_id: 'price_1TVDEQFHQeEbTFygAbVoJjDN', name: 'チームスタンダード',              edition: 'saas',  limit: null, seats: 15, price_yen: 50000 },
  ai_saas_team_prem:          { price_id: 'price_1TVDEOFHQeEbTFygtEaOFUgp', name: 'チームプレミアム',                edition: 'saas',  limit: null, seats: 30, price_yen: 100000 },
  // ===== Agent版 =====
  agent_lite:                 { price_id: 'price_1TVDELFHQeEbTFygpkygCb35', name: 'Agent ライト',                    edition: 'agent', limit: 200,  seats: 1,  price_yen: 30000,  overage_unit_yen: 20 },
  agent_std:                  { price_id: 'price_1TVDELFHQeEbTFygfxPsDcsY', name: 'Agent スタンダード',              edition: 'agent', limit: 500,  seats: 1,  price_yen: 80000,  overage_unit_yen: 20 },
  agent_premium:              { price_id: 'price_1TVDEKFHQeEbTFyglupfKzyD', name: 'Agent プレミアム',                edition: 'agent', limit: 1500, seats: 1,  price_yen: 150000, overage_unit_yen: 20 },
  // ===== Agent エリート =====
  agent_elite:                { price_id: 'price_1TVDELFHQeEbTFyglRCfriEn', name: 'Agent エリート',                  edition: 'elite', limit: 3000, seats: 1,  price_yen: 250000, overage_unit_yen: 20 },
  // ===== インセンティブオプション(継続) =====
  incentive_lite:             { price_id: 'price_1TVDEKFHQeEbTFyg1VHrtyGV', name: 'インセンティブ ライト',           edition: 'option', price_yen: 5000,   is_option: true },
  incentive_std:              { price_id: 'price_1TVDEKFHQeEbTFygg72epXo2', name: 'インセンティブ スタンダード',     edition: 'option', price_yen: 10000,  is_option: true },
  incentive_prem:             { price_id: 'price_1TVDEKFHQeEbTFygZqZvBMPH', name: 'インセンティブ プレミアム',       edition: 'option', price_yen: 20000,  is_option: true },
  // ===== 代理店プラン: AI SaaS版(Bronze 70%基準価格) =====
  reseller_ai_saas_lite:      { price_id: 'price_1TVDEKFHQeEbTFygRRCL6YfT', name: '【代理店】ライト',               edition: 'saas',  limit: 100,  seats: 1,  price_yen: 686,    is_reseller: true, base_plan_key: 'ai_saas_lite' },
  reseller_ai_saas_unlimited: { price_id: 'price_1TVDEKFHQeEbTFygVPW6tRSR', name: '【代理店】アンリミテッド',       edition: 'saas',  limit: null, seats: 1,  price_yen: 4060,   is_reseller: true, base_plan_key: 'ai_saas_unlimited' },
  reseller_ai_saas_team_lite: { price_id: 'price_1TVDEEFHQeEbTFygZnwfIyzl', name: '【代理店】チームライト',         edition: 'saas',  limit: null, seats: 5,  price_yen: 14000,  is_reseller: true, base_plan_key: 'ai_saas_team_lite' },
  reseller_ai_saas_team_std:  { price_id: 'price_1TVDEHFHQeEbTFygRVa66KZo', name: '【代理店】チームスタンダード',   edition: 'saas',  limit: null, seats: 15, price_yen: 35000,  is_reseller: true, base_plan_key: 'ai_saas_team_std' },
  reseller_ai_saas_team_prem: { price_id: 'price_1TVDEFFHQeEbTFygchTlpz9V', name: '【代理店】チームプレミアム',     edition: 'saas',  limit: null, seats: 30, price_yen: 70000,  is_reseller: true, base_plan_key: 'ai_saas_team_prem' },
  // ===== 代理店プラン: Agent版 + Elite =====
  reseller_agent_lite:        { price_id: 'price_1TVDEEFHQeEbTFygCJxV4QCK', name: '【代理店】Agent ライト',         edition: 'agent', limit: 200,  seats: 1,  price_yen: 21000,  is_reseller: true, base_plan_key: 'agent_lite',    overage_unit_yen: 20 },
  reseller_agent_std:         { price_id: 'price_1TVDEEFHQeEbTFygtYu3cr3f', name: '【代理店】Agent スタンダード',   edition: 'agent', limit: 500,  seats: 1,  price_yen: 56000,  is_reseller: true, base_plan_key: 'agent_std',     overage_unit_yen: 20 },
  reseller_agent_premium:     { price_id: 'price_1TVDEFFHQeEbTFyg4SyAaLwQ', name: '【代理店】Agent プレミアム',     edition: 'agent', limit: 1500, seats: 1,  price_yen: 105000, is_reseller: true, base_plan_key: 'agent_premium', overage_unit_yen: 20 },
  reseller_agent_elite:       { price_id: 'price_1TVDEEFHQeEbTFygRHKkZ2UP', name: '【代理店】Agent エリート',       edition: 'elite', limit: 3000, seats: 1,  price_yen: 175000, is_reseller: true, base_plan_key: 'agent_elite',   overage_unit_yen: 20 },
  // ===== 代理店プラン: インセンティブオプション =====
  reseller_incentive_lite:    { price_id: 'price_1TVDEFFHQeEbTFygrCNjeNWS', name: '【代理店】インセンティブ ライト',     edition: 'option', price_yen: 3500,  is_option: true, is_reseller: true, base_plan_key: 'incentive_lite' },
  reseller_incentive_std:     { price_id: 'price_1TVDEFFHQeEbTFyg1HSgKr6U', name: '【代理店】インセンティブ スタンダード', edition: 'option', price_yen: 7000,  is_option: true, is_reseller: true, base_plan_key: 'incentive_std' },
  reseller_incentive_prem:    { price_id: 'price_1TVDEFFHQeEbTFygLeO0KDkK', name: '【代理店】インセンティブ プレミアム',   edition: 'option', price_yen: 14000, is_option: true, is_reseller: true, base_plan_key: 'incentive_prem' },
  // ===== ワークスペース機能 =====
  workspace_option_10:          { price_id: 'price_1TVt5LFHQeEbTFygLQ8W2d17', name: 'ワークスペース10枠オプション',         edition: 'option', price_yen: 20000, workspace_unlock: 10 },
  workspace_addon_10:           { price_id: 'price_1TVt5rFHQeEbTFygdm6j6zTL', name: '追加ワークスペース10枠',               edition: 'option', price_yen: 10000, workspace_unlock: 10, is_cumulative: true },
  // ===== 代理店プラン: ワークスペース機能 =====
  reseller_workspace_option_10: { price_id: 'price_1TVt6GFHQeEbTFygxirmsks4', name: '【代理店】ワークスペース10枠オプション', edition: 'option', price_yen: 14000, is_reseller: true, base_plan_key: 'workspace_option_10' },
  reseller_workspace_addon_10:  { price_id: 'price_1TVt87FHQeEbTFygF4tk6fzH', name: '【代理店】追加ワークスペース10枠',       edition: 'option', price_yen: 7000,  is_reseller: true, base_plan_key: 'workspace_addon_10' },
};

// 代理店ランク別 Coupon ID(Stripe で作成済み)
const RESELLER_COUPONS = {
  silver: 'silver_discount', // 7.14% off, Forever, 70%→65% に相当
  gold:   'gold_discount',   // 14.28% off, Forever, 70%→60% に相当
  bronze: null,               // Bronze はクーポンなし(=70% 卸売価格そのまま)
};

// 代理店ランク判定の閾値(月次取引高ベース・卸売Bronze価格基準)
const RESELLER_TIER_THRESHOLDS = {
  silver: 100000, // ¥100,001〜 で Silver
  gold:   500000, // ¥500,001〜 で Gold
};

// edition ごとの機能定義
const EDITION_FEATURES = {
  saas: {
    receipt_upload: true,
    ai_judgment: true,
    master_learning: true,
    csv_export: true,
    incentive: 'option',
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
    auto_ingest: true,
    auto_export: true,
    auto_rule_learning: true,
    auto_approval: true,
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
    chat_mode: true,
    context_cross_judgment: true,
    closing_self_drive: true,
    fiscal_year_assist: true,
  },
};

// 管理者トークン検証
function verifyAdminToken(token) {
  const adminToken = process.env.ADMIN_TOKEN || '';
  return adminToken && token === adminToken;
}

// 紹介コード生成(7文字英数字・重複チェック付き)
async function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 7; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const existing = await supabaseQuery(`/users?referral_code=eq.${code}&select=id`);
    if (!existing || existing.length === 0) return code;
  }
  throw new Error('紹介コード生成失敗');
}

// 管理者通知メール
async function sendAdminNotification(subject, data) {
  const adminEmail = process.env.ADMIN_EMAIL || 'easy.you.me@gmail.com';
  const html = `<pre style="font-family:monospace">${JSON.stringify(data, null, 2)}</pre>`;
  await sendEmail(adminEmail, `【shiwake-ai 管理通知】${subject}`, html);
}

// 機能フラグ判定関数
async function canUse(uid, feature) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=edition,plan_key`);
  const user = data?.[0];
  if (!user) return false;
  const edition = user.edition || 'saas';
  const features = EDITION_FEATURES[edition] || EDITION_FEATURES.saas;
  return features[feature] === true;
}

// ワークスペース上限計算関数(§6.2)
async function getWorkspaceLimit(uid) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=plan_key,has_workspace_option,workspace_addon_count`);
  if (!data || !data[0]) return 0;
  const { plan_key, has_workspace_option, workspace_addon_count } = data[0];
  const isElite = plan_key === 'agent_elite' || plan_key === 'reseller_agent_elite';
  const baseLimit = (isElite || has_workspace_option) ? 10 : 1;
  return baseLimit + (workspace_addon_count || 0) * 10;
}

// プラン情報取得関数
async function getUserPlan(uid) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
  const user = data?.[0];
  if (!user || !user.plan_key) return null;
  const plan = STRIPE_PLANS[user.plan_key];
  return plan ? { ...plan, key: user.plan_key, edition: user.edition } : null;
}

// ===== SendGridメール送信 =====
async function sendEmail(to, subject, html) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL || 'noreply@shiwake-ai.com';
  if (!apiKey) { console.warn('SENDGRID_API_KEY未設定'); return; }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: '証憑仕訳AI' },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    });
    if (!res.ok) console.error('SendGrid error:', res.status, await res.text());
    else console.log(`メール送信完了: ${to} / ${subject}`);
  } catch(e) {
    console.error('SendGrid例外:', e.message);
  }
}

async function sendIncentiveNotification(ownerEmail, staffName, unredeemedCount) {
  const adminEmail = process.env.ADMIN_EMAIL || 'easy.you.me@gmail.com';
  const subject = `【証憑仕訳AI】インセンティブ付与対象: ${staffName}さんが${unredeemedCount}件到達`;
  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="color:#185FA5;">🎁 インセンティブ付与対象のお知らせ</h2>
  <p><strong>${staffName}</strong>さんの処理件数が<strong>${unredeemedCount}件</strong>に到達しました。</p>
  <p>Amazonギフト券（¥${INCENTIVE_AMOUNT}相当）の付与をお願いします。</p>
  <hr style="margin:16px 0;">
  <p style="font-size:12px;color:#888;">証憑仕訳AI / shiwake-ai.com</p>
</div>`;
  await sendEmail(ownerEmail, subject, html);
  await sendEmail(adminEmail, subject, html);
}

const STRIPE_SUCCESS_URL = 'https://shiwake-ai.onrender.com/?payment=success';
const STRIPE_CANCEL_URL = 'https://shiwake-ai.onrender.com/?payment=cancel';

function flattenForStripe(obj, prefix = '') {
  const result = {};
  for (const key in obj) {
    const value = obj[key];
    const newKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          Object.assign(result, flattenForStripe(item, `${newKey}[${i}]`));
        } else {
          result[`${newKey}[${i}]`] = String(item);
        }
      });
    } else if (typeof value === 'object') {
      Object.assign(result, flattenForStripe(value, newKey));
    } else {
      result[newKey] = String(value);
    }
  }
  return result;
}

async function stripeRequest(path, method='GET', body=null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
  };
  if (body) {
    const flat = flattenForStripe(body);
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(flat).toString();
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data;
}

// Supabase設定（サーバー側はSecret keyを使用）
const SUPABASE_URL = 'https://tmddairlgpyinqfekkfg.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

async function supabaseQuery(path, method='GET', body=null, extraHeaders={}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=representation',
      ...extraHeaders
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ===== v2.3.1: ワークスペース + 信頼度メトリクス ヘルパー =====

// workspace_id を解決する（Group 3-B 共通ヘルパー）
// - queryWsId 指定あり: owner_uid=uid で所有確認 → 他人のWSなら 403 エラー
// - queryWsId 未指定: users.current_workspace_id を採用 → null なら null を返す(呼び出し側で 400)
// ※ ensureDefaultWorkspace が /api/user/upsert(新規作成時)と /api/user(ログイン時フォールバック)で
//   呼ばれるため、ログイン済みユーザーで current_workspace_id が null になることは通常ない
async function resolveWorkspaceId(uid, queryWsId) {
  if (queryWsId) {
    const ws = await supabaseQuery(
      `/workspaces?id=eq.${queryWsId}&owner_uid=eq.${uid}&select=id`
    );
    if (!ws || ws.length === 0) {
      const err = new Error('workspace not found or access denied');
      err.status = 403;
      throw err;
    }
    return queryWsId;
  }
  const user = await supabaseQuery(`/users?id=eq.${uid}&select=current_workspace_id`);
  return user?.[0]?.current_workspace_id || null;
}

// resolveWorkspaceId のエラーをレスポンスに変換するヘルパー
function handleWsError(e, res) {
  const status = e.status === 403 ? 403 : 500;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: e.message }));
}

// default ワークスペースを保証する（なければ作成し workspace_id を返す）
// 冪等: 既存の default WS があればそのまま id を返す（重複作成しない）
async function ensureDefaultWorkspace(uid) {
  const existing = await supabaseQuery(
    `/workspaces?owner_uid=eq.${uid}&is_default=eq.true&select=id`
  );
  if (existing && existing.length > 0) return existing[0].id;

  const wsId = crypto.randomUUID();
  await supabaseQuery('/workspaces', 'POST', {
    id: wsId,
    owner_uid: uid,
    name: 'マイワークスペース',
    slug: 'default',
    is_default: true
  });
  await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { current_workspace_id: wsId });

  // 旧形式ファイルを新形式にrename（master_<uid>.json → master_<uid>_<wsId>.json）
  // master.js / hashes.js の lazy migrate と二重にならないよう existsSync で保護
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const MASTER_DIR_LOCAL = path.join(__dirname, 'masters');
  const HASH_DIR_LOCAL   = path.join(__dirname, 'hashes');
  try {
    const oldMaster = path.join(MASTER_DIR_LOCAL, `master_${safeUid}.json`);
    const newMaster = path.join(MASTER_DIR_LOCAL, `master_${safeUid}_${wsId}.json`);
    if (fs.existsSync(oldMaster) && !fs.existsSync(newMaster)) {
      fs.renameSync(oldMaster, newMaster);
      console.log(`マスタファイル migrate: master_${safeUid}.json → master_${safeUid}_${wsId}.json`);
    }
  } catch(e) { console.warn('master file rename error:', e.message); }
  try {
    const oldHash = path.join(HASH_DIR_LOCAL, `hashes_${safeUid}.json`);
    const newHash = path.join(HASH_DIR_LOCAL, `hashes_${safeUid}_${wsId}.json`);
    if (fs.existsSync(oldHash) && !fs.existsSync(newHash)) {
      fs.renameSync(oldHash, newHash);
      console.log(`ハッシュファイル migrate: hashes_${safeUid}.json → hashes_${safeUid}_${wsId}.json`);
    }
  } catch(e) { console.warn('hash file rename error:', e.message); }

  return wsId;
}

// メール振り分けロジック §5.1-5.2 (A3a設計書)
// 戻り値: workspace_id (UUID) または null(未振り分け)
async function classifyIncomingEmail(uid, fromAddress, subject) {
  const workspaces = await supabaseQuery(
    `/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&select=id,client_email_addresses,client_email_domains,subject_keywords&order=display_order.asc`
  );
  if (!Array.isArray(workspaces) || workspaces.length === 0) return null;

  // 1. 送信元アドレス完全一致
  for (const ws of workspaces) {
    if (ws.client_email_addresses?.includes(fromAddress)) return ws.id;
  }

  // 2. ドメイン一致
  const domain = fromAddress.split('@')[1] || '';
  for (const ws of workspaces) {
    if (domain && ws.client_email_domains?.includes(domain)) return ws.id;
  }

  // 3. 件名キーワード
  for (const ws of workspaces) {
    if (ws.subject_keywords?.some(kw => subject.includes(kw))) return ws.id;
  }

  return null;
}

// 信頼度メトリクスを再計算して workspace_trust_metrics を upsert
async function recalculateTrustMetrics(workspaceId) {
  try {
    const [recent, all] = await Promise.all([
      supabaseQuery('/rpc/calc_trust_metrics', 'POST', { p_workspace_id: workspaceId, p_period: 'recent' }),
      supabaseQuery('/rpc/calc_trust_metrics', 'POST', { p_workspace_id: workspaceId, p_period: 'all' })
    ]);

    const masterStat = await supabaseQuery(
      `/shiwake_records?workspace_id=eq.${workspaceId}&select=master_hit_method`
    );
    const total = masterStat ? masterStat.length : 0;
    const hit = masterStat ? masterStat.filter(r => r.master_hit_method !== null).length : 0;
    const masterHitRate = total > 0 ? (hit * 100 / total) : 0;

    const totalApproved = all?.total_approved || 0;
    const recentTrust = recent?.trust_score || 0;
    let maturityLevel = 'rookie';
    if (totalApproved >= 200 && recentTrust >= 95) maturityLevel = 'mature';
    else if (totalApproved >= 50) maturityLevel = 'stable';

    await supabaseQuery('/workspace_trust_metrics', 'POST', {
      workspace_id: workspaceId,
      total_approved: all?.total_approved || 0,
      total_modified: all?.total_modified || 0,
      trust_score_all: all?.trust_score,
      field_accuracy_all: all?.field_accuracy,
      modification_trend_all: all?.modification_trend,
      recent_approved: recent?.total_approved || 0,
      recent_modified: recent?.total_modified || 0,
      trust_score_recent: recent?.trust_score,
      field_accuracy_recent: recent?.field_accuracy,
      modification_trend_recent: recent?.modification_trend,
      master_hit_rate: masterHitRate,
      maturity_level: maturityLevel,
      last_calculated_at: new Date().toISOString()
    }, { 'Prefer': 'resolution=merge-duplicates' });
  } catch(e) {
    console.warn('recalculateTrustMetrics error:', e.message);
  }
}

// 単一 WS の stats を取得（一覧・単一取得で共通利用）
async function buildWorkspaceStats(wsId) {
  try {
    const metrics = await supabaseQuery(
      `/workspace_trust_metrics?workspace_id=eq.${wsId}&select=workspace_id,trust_score_recent,total_approved`
    );
    const m = metrics?.[0];
    return {
      shiwake_count: m?.total_approved || 0,
      last_activity_at: null,
      master_count: 0,
      trust_score: m?.trust_score_recent || null
    };
  } catch(e) {
    return { shiwake_count: 0, last_activity_at: null, master_count: 0, trust_score: null };
  }
}

// ===== v2.3.0: 自動取り込み機能 ヘルパー =====

// OAuthステート管理（インメモリ・10分TTL）
const oauthStateStore = new Map();
function saveOAuthState(state, uid, provider, ttlSeconds = 600, workspaceId = null) {
  oauthStateStore.set(state, { uid, provider, workspaceId, expiresAt: Date.now() + ttlSeconds * 1000 });
  for (const [k, v] of oauthStateStore.entries()) { if (v.expiresAt < Date.now()) oauthStateStore.delete(k); }
}
function consumeOAuthState(state) {
  const d = oauthStateStore.get(state);
  if (!d) return null;
  oauthStateStore.delete(state);
  return d.expiresAt >= Date.now() ? d : null;
}

// ランダムlocal_part生成 [a-z0-9]{len}
function generateRandomLocalPart(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let r = '';
  for (let i = 0; i < len; i++) r += chars[bytes[i] % chars.length];
  return r;
}

// 拡張子→MIME
function mimeFromExt(ext) {
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[ext] || 'application/octet-stream';
}

// Supabase Storage REST API
async function supabaseStorageUpload(bucket, filePath, buffer, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': contentType,
    },
    body: buffer
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Storage upload error: ${t}`); }
  return await res.json();
}

async function supabaseStorageSignedUrl(bucket, filePath, expiresIn = 300) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${filePath}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn })
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Storage sign error: ${t}`); }
  const json = await res.json();
  return `${SUPABASE_URL}/storage/v1${json.signedURL}`;
}

// 自動取り込み機能利用判定
async function canUseAutoIntake(uid) {
  const data = await supabaseQuery(`/users?id=eq.${uid}&select=is_paid,plan_key,graduated_rookie_at,cumulative_shiwake_count`);
  const user = data?.[0];
  if (!user) return { allowed: false, reason: 'user_not_found' };
  if (!user.is_paid) return { allowed: false, reason: 'free_trial_not_allowed' };
  if (user.plan_key && user.plan_key.startsWith('agent_')) return { allowed: true };
  if (!user.graduated_rookie_at) {
    return { allowed: false, reason: 'rookie_not_graduated', cumulative_count: user.cumulative_shiwake_count || 0, threshold: 50 };
  }
  return { allowed: true };
}

// 累計仕訳件数インクリメント + ルーキー卒業判定
async function bumpCumulativeAndCheckGraduation(uid, addCount) {
  try {
    const data = await supabaseQuery(`/users?id=eq.${uid}&select=cumulative_shiwake_count,graduated_rookie_at,plan_key,is_paid`);
    const user = data?.[0];
    if (!user) return null;
    const newCount = (user.cumulative_shiwake_count || 0) + addCount;
    const updates = { cumulative_shiwake_count: newCount };
    let justGraduated = false;
    const isPaid = user.is_paid === true;
    const isAgent = user.plan_key && user.plan_key.startsWith('agent_');
    if (isPaid && !isAgent && !user.graduated_rookie_at && newCount >= 50) {
      updates.graduated_rookie_at = new Date().toISOString();
      justGraduated = true;
    }
    await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', updates);
    return { just_graduated: justGraduated, cumulative_count: newCount };
  } catch(e) {
    console.error('bumpCumulative error:', e.message);
    return null;
  }
}

// multipart/form-data パーサー（busboy不要・ネイティブ実装）
function bufIndexOf(buf, search, start = 0) {
  const slen = search.length;
  outer: for (let i = start; i <= buf.length - slen; i++) {
    for (let j = 0; j < slen; j++) { if (buf[i + j] !== search[j]) continue outer; }
    return i;
  }
  return -1;
}

function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bm) return reject(new Error('No multipart boundary'));
    const boundary = bm[1] || bm[2];
    const delim = Buffer.from('\r\n--' + boundary);
    const firstDelim = Buffer.from('--' + boundary);

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const fields = {};
        const files = [];

        let pos = bufIndexOf(body, firstDelim, 0);
        if (pos === -1) return resolve({ fields, files });
        pos += firstDelim.length;
        if (body[pos] === 0x0d && body[pos+1] === 0x0a) pos += 2;

        while (pos < body.length) {
          const headerEnd = bufIndexOf(body, Buffer.from('\r\n\r\n'), pos);
          if (headerEnd === -1) break;
          const headers = body.slice(pos, headerEnd).toString('utf8');
          pos = headerEnd + 4;
          const nextBound = bufIndexOf(body, delim, pos);
          const partEnd = nextBound === -1 ? body.length : nextBound;
          const partContent = body.slice(pos, partEnd);

          const dispM = headers.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
          const fileM = headers.match(/filename="([^"]*)"/i);
          const ctM   = headers.match(/Content-Type:\s*([^\r\n]+)/i);

          if (dispM) {
            const name = dispM[1];
            if (fileM && fileM[1]) {
              files.push({
                fieldname: name,
                originalname: fileM[1],
                mimetype: ctM ? ctM[1].trim() : 'application/octet-stream',
                buffer: partContent,
                size: partContent.length
              });
            } else {
              fields[name] = partContent.toString('utf8');
            }
          }
          if (nextBound === -1) break;
          pos = nextBound + delim.length;
          if (body[pos] === 0x2d && body[pos+1] === 0x2d) break;
          if (body[pos] === 0x0d && body[pos+1] === 0x0a) pos += 2;
        }
        resolve({ fields, files });
      } catch(e) { reject(e); }
    });
  });
}

// Google Drive サービスアカウントクライアント
function getDriveClient() {
  if (!googleApis) throw new Error('googleapis package not installed');
  const credRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const credentials = JSON.parse(credRaw);
  const jwtClient = new googleApis.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  return googleApis.drive({ version: 'v3', auth: jwtClient });
}

// GDrive Watchチャンネル設定
async function setupGDriveWatch(uid, folderId) {
  const drive = getDriveClient();
  const channelId = crypto.randomUUID();
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await drive.files.watch({
    fileId: folderId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: 'https://shiwake-ai.com/api/gdrive/webhook',
      token: process.env.GOOGLE_DRIVE_PUSH_TOKEN || '',
      expiration: String(expiration)
    }
  });
  await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.gdrive&is_active=eq.true`, 'PATCH', {
    channel_id: channelId,
    channel_expires_at: new Date(expiration).toISOString()
  });
}

// GDriveフォルダ同期
async function syncGDriveFolder(conn) {
  try {
    const drive = getDriveClient();
    const folderId = conn.watched_path;
    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType='application/pdf' or mimeType contains 'image/')`,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 50
    });
    for (const f of list.data.files || []) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.mimeType)) continue;
      const existing = await supabaseQuery(`/inbox_files?uid=eq.${conn.uid}&source=eq.gdrive&source_id=eq.${f.id}&select=id`);
      if (existing && existing.length > 0) continue;
      const dl = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
      const fileBuffer = Buffer.from(dl.data);
      const inboxFileId = crypto.randomUUID();
      const storagePath = `${conn.uid}/${inboxFileId}/${f.name}`;
      await supabaseStorageUpload('inbox-files', storagePath, fileBuffer, f.mimeType);
      await supabaseQuery('/inbox_files', 'POST', {
        id: inboxFileId, uid: conn.uid, source: 'gdrive', source_id: f.id,
        sender: conn.watched_path_label, filename: f.name, mime_type: f.mimeType,
        byte_size: parseInt(f.size) || fileBuffer.length, storage_path: storagePath, status: 'pending'
      });
    }
  } catch(e) { console.error('syncGDriveFolder error:', e.message); }
}

// Dropboxフォルダ同期
async function syncDropboxFolder(conn) {
  if (!DropboxClass) { console.warn('Dropbox SDK not installed'); return; }
  try {
    const dbx = new DropboxClass({ accessToken: conn.access_token });
    let result;
    if (conn.cursor) {
      result = await dbx.filesListFolderContinue({ cursor: conn.cursor });
    } else {
      result = await dbx.filesListFolder({ path: conn.watched_path || '', recursive: false, include_deleted: false });
    }
    for (const entry of result.result.entries || []) {
      if (entry['.tag'] !== 'file') continue;
      const ext = (entry.name.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) continue;
      const existing = await supabaseQuery(`/inbox_files?uid=eq.${conn.uid}&source=eq.dropbox&source_id=eq.${encodeURIComponent(entry.id)}&select=id`);
      if (existing && existing.length > 0) continue;
      const dl = await dbx.filesDownload({ path: entry.path_lower });
      const fileBuffer = dl.result.fileBinary;
      const mimeType = mimeFromExt(ext);
      const inboxFileId = crypto.randomUUID();
      const storagePath = `${conn.uid}/${inboxFileId}/${entry.name}`;
      await supabaseStorageUpload('inbox-files', storagePath, fileBuffer, mimeType);
      await supabaseQuery('/inbox_files', 'POST', {
        id: inboxFileId, uid: conn.uid, source: 'dropbox', source_id: entry.id,
        sender: conn.watched_path_label || conn.watched_path,
        filename: entry.name, mime_type: mimeType,
        byte_size: entry.size || fileBuffer.length, storage_path: storagePath, status: 'pending'
      });
    }
    if (result.result.cursor) {
      await supabaseQuery(`/cloud_connections?id=eq.${conn.id}`, 'PATCH', { cursor: result.result.cursor, updated_at: new Date().toISOString() });
    }
    if (result.result.has_more) {
      await syncDropboxFolder({ ...conn, cursor: result.result.cursor });
    }
  } catch(e) { console.error('syncDropboxFolder error:', e.message); }
}

const PORT = process.env.PORT || 3456;

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

// プロンプトキャッシュ統計（プロセス起動以降の累計）
const cumCacheStats = { write: 0, read: 0, input: 0, output: 0, requests: 0 };

const SYSTEM = `あなたは日本の会計仕訳の専門家であり、OCRの専門家でもあります。証憑画像（レシート・領収書・手書き領収書・銀行通帳など）を分析し、弥生会計の勘定科目体系に従って仕訳を生成してください。

【画像読み取りのガイドライン】
- 手書き文字は文脈・筆跡から推測して積極的に読み取ってください
- 崩し字・略字・かすれた文字も可能な限り解読してください
- 金額は「¥」「円」「,」の有無に関わらず数値として読み取ってください
- 【重要】手書き領収書の金額欄：最初のマス目の記号は必ず通貨記号（¥）です。「4」「¥」「Y」のように見えても通貨記号として扱い、金額に含めないでください。例：「¥6,880」の「¥」は金額ではありません
- 【重要】金額欄が空白・未記入・「¥」のみ・「-」のみの行は仕訳として出力しないでください。税抜金額欄・消費税欄が空欄の場合も除外してください
- 【手書き金額の誤読防止・最重要】★・☆マークは金額欄の装飾記号であり通貨記号ではない。★の直後の文字や数字を金額の一部として読まないこと。例：「★¥11,950-」→金額は11,950円
- 【手書き金額の誤読防止・最重要】手書きの「2」を「1」「3」や「7」「8」に分解・誤読しない。「22,150」を「13,150」や「7,860」と読まない。金額欄の数字は全体を一つの数値として読み取ること
- 【手書き金額の誤読防止】金額末尾の「-」「ー」は慣習的な締め記号（例：¥11,860-）。金額の一部ではない
- 【手書き金額の誤読防止】金額欄に複数の数字が見える場合、横線で囲まれた欄内の最大の数値が合計金額。部分的な数字を合計と誤認しないこと
- 【手書き金額の桁数検証】領収書の金額は文脈から妥当性を検証すること。飲食代が¥130や¥860は不自然（¥1,300・¥8,600の可能性）。税込金額と消費税額の整合性も確認
- 【手書き日付】「令和7年」=2025年、「令和6年」=2024年、「令和5年」=2023年に変換して出力。日付欄が空白の場合はconfidenceを「low」にして仮入力
- 【手書き取引先名】印鑑・角印・スタンプの中の文字を優先して取引先名とする。「様」の前の文字は受取人名のため取引先名に含めない
- 【但し書き】「但」「但し」の後の文字を摘要に使用。但し書きが空欄・判読不能の場合は「但し書き不明」と明記。「上記正に領収いたしました」は定型文のため無視
- 1枚の領収書から出力する仕訳の件数は、内訳行の有無で決まります（下記【内訳行と集計行の判定】参照）
- 傾いた画像や影があっても最大限読み取ってください
- 銀行通帳の場合：入金（+）は「売上高」または「雑収入」、出金（-）は支出として処理してください
- 読み取れない文字は「?」で表現し、confidenceを「low」にしてください

【貸方（支払手段）の判定ルール】
1. クレジットカードの記載（VISA/Mastercard/JCB/カード/クレジット/サイン欄/カード番号末尾4桁など）があれば → 「未払金」
2. 電子マネー（Suica/nanaco/WAON/楽天Edy/PayPay/交通系ICなど）の記載があれば → 「未払金」
3. 銀行振込・口座引落の記載があれば → 「普通預金」
4. 「現金」「お預かり」「お釣り」の記載があれば → 「現金」
5. 判断できない場合のみ → 「現金」

【業種別デフォルト勘定科目】
以下の業種・店名パターンは対応する勘定科目を優先して使用してください：
- レストラン・居酒屋・カフェ・ファミレス・ファストフード・飲食店全般 → 借方「会議費」
- コンビニ（セブン-イレブン・ファミリーマート・ローソン等） → 借方「消耗品費」
- 100円ショップ（セリア・ダイソー・キャンドゥ等） → 借方「消耗品費」
- タクシー・電車・バス・交通系 → 借方「旅費交通費」・非課税（ただしタクシーは課税仕入10%）
- ガス・電気・水道 → 借方「水道光熱費」
- 携帯・通信・インターネット → 借方「通信費」
- Amazon・楽天・通販サイト → 借方「消耗品費」
- 書店・本屋（未来屋書店・紀伊國屋・ブックオフ・TSUTAYA等）で購入した書籍・雑誌・図書 → 借方「新聞図書費」
- ETC・有料道路・高速道路 → 借方「旅費交通費」・課税仕入(10%)（電車・バスの非課税と混同しないこと）
- フラワーショップ・花屋 → 借方「交際費」・課税仕入(10%)
- 医師会・弁護士会・税理士会・同業者組合・協会・商工会議所のパーティ・懇親会 → 借方「交際費」・課税仕入(10%)
- 取引先・ビジネスパートナーとの会食・パーティ → 借方「交際費」・課税仕入(10%)
- 全従業員対象の忘年会・新年会・社内パーティ → 借方「福利厚生費」・課税仕入(10%)
- 保険会社への保険料支払い → 借方「保険料」・非課税（掛け捨て・貯蓄型問わず）
- 銀行振込手数料・ATM手数料・口座維持手数料 → 借方「支払手数料」・非課税
- 紙の新聞（定期購読） → 課税仕入(8%軽減)
- 電子書籍・デジタル新聞・オンラインニュース → 課税仕入(10%)（紙と混同しないこと）

【非課税・不課税の判定ルール】
- 郵便切手・郵便料金 → 借方「消耗品費」・非課税
- 収入印紙（印紙税） → 借方「租税公課」・非課税
- 商品券・ギフト券・プリペイドカード購入 → 非課税
- 粗大ごみ処理券・指定ごみ袋（自治体発行） → 非課税
- 社会保険医療・介護保険サービス → 非課税
- 居住用家賃（社宅・従業員住居） → 非課税
- 寄附金・祝金・見舞金・香典・祝儀 → 不課税
  ※取引先・関係者向け → 借方「交際費」・不課税
  ※従業員向け（社内規程に基づく慶弔金） → 借方「福利厚生費」・不課税
- 出張日当・旅費規程に基づく支給 → 借方「旅費交通費」・不課税（実費の交通費とは別処理）
- 補助金・助成金・給付金の入金 → 借方「雑収入」・不課税
- 駐車違反金・交通反則金・罰金・科料 → 借方「租税公課」・不課税
  ※摘要に「損金不算入」と必ず記載すること

【複数明細の処理】
レシートに複数の商品・取引がある場合は明細ごとに分けてください。通帳の場合も明細ごとに分けてください。

【出力ルール - 最重要】
ページに記載されているすべての取引明細行を出力してください。
- 日付（YYYY/MM/DD）・店名・金額の3つが揃っている行はすべて出力
- 同じ店名・日付・金額の行が複数あっても、それぞれ別オブジェクトとして出力（絶対にまとめない）
- 半角カタカナの店名も正常な明細として出力
- 出力件数が少なすぎる場合はページを再確認して漏れがないか確認してください

【除外するもの - これだけ除外】
- 「ご請求金額合計」など合計金額のみの1行
- 「翌月繰越残高」など残高のみの行
- タイトル行・ヘッダー行

【税区分の判定ルール - 厳守】
- 「非」「非課税」「非課」の記載がある → 必ず「非課税」
- 「不課税」「対象外」の記載がある → 必ず「不課税」
- 「軽減」「8%」「食品」「飲食料品」の記載がある → 「課税仕入(8%軽減)」
- 上記以外 → 「課税仕入(10%)」

【内訳行と集計行の判定 - 最重要】
レシートの金額行は「個別仕訳にする行」と「除外する行」に分類してください。

■ 個別仕訳にする行（金額が明記された商品・サービスの内訳）
- 商品カテゴリ別内訳（例：文芸ビジネス ¥1,870 / 児童書 ¥1,320）
- コンビニの商品明細（例：サンドイッチ ¥350 / コーヒー ¥150）
- 内訳行が存在する場合は内訳行を個別仕訳にし、合計行は出力しない

■ 除外する行（集計・補足情報）
- 「小計」「合計」「総合計」「内税対象額」「内税」「消費税等」「税込合計」
- 「メーター運賃」「運賃料合計」など合計と同額の内訳補足行
- 「お預かり」「お釣り」「ポイント利用」「割引」
- 税抜金額・消費税額のみの行

■ 判定例
【タクシー領収書】
  メーター運賃 ¥1,000 → 除外（合計と同額の内訳補足）
  運賃料合計 ¥1,000 → 除外
  合計 ¥1,000 → ✅ 仕訳1件のみ

【書店レシート（商品カテゴリ別内訳あり）】
  文芸ビジネス ¥1,870 → ✅ 仕訳1件（新聞図書費）
  児童書 ¥1,320 → ✅ 仕訳1件（新聞図書費）
  小計 ¥3,190 → 除外
  内税対象額 ¥3,190 → 除外
  合計 ¥3,190 → 除外（内訳行があるため）

【重複の防止 - 厳守】
- 同じ日付・同じ店名・同じ金額の組み合わせは1件のみ出力してください
- 内訳行と合計行が両方ある場合は内訳行のみ出力し、合計行は必ず除外してください

返答はJSON配列のみ。説明文・バッククォート・マークダウン記法は絶対に含めないでください。
[{"title":"取引先名","date":"YYYY/MM/DD","amount":"¥X,XXX","debit":"借方科目","credit":"貸方科目","tax":"課税仕入(10%)|課税仕入(8%軽減)|非課税|不課税","memo":"摘要（但し書き・取引内容・品目等20字以内）","confidence":"high|mid|low","reason":"根拠50字以内"}]`;

// ===== 書類フォーマット定義（10種類）=====
const RECEIPT_FORMATS = {
  register_receipt: {
    name: 'レジレシート型',
    features: '縦長・合計金額は最下部・税率別内訳あり・登録番号あり・小計/合計/お預かり/お釣りの記載',
    examples: 'コンビニ・スーパー・ドラッグストア・100円ショップ・ホームセンター',
    readingPoints: '合計欄を優先・小計は除外・8%軽減税率品目に注意・登録番号を必ず読む',
  },
  handwritten: {
    name: '手書き領収書型',
    features: '縦書きまたは横書き・金額は中央に大きく・但し書きあり・収入印紙貼付の場合あり・領収書スタンプ',
    examples: '個人商店・飲食店・タクシー・駐車場・各種サービス業',
    readingPoints: '金額の漢数字・大字（壱・弐・参）を正確に読む・但し書きを摘要に・印紙は無視',
  },
  restaurant: {
    name: '飲食店レシート型',
    features: '品目別明細・個数・単価・小計・サービス料・消費税の記載・テーブル番号や人数',
    examples: 'レストラン・居酒屋・カフェ・ファミレス・ファストフード',
    readingPoints: '合計金額のみ使用・品目明細は除外・サービス料は合計に含める・会議費で処理',
  },
  transportation: {
    name: '交通系領収書型',
    features: '乗車区間・日時・金額・領収書番号・タクシーメーター印字またはIC乗車券',
    examples: 'タクシー・電車・バス・新幹線・高速道路ETC',
    readingPoints: '旅費交通費で処理・乗車区間を摘要に・非課税（電車・バス）と課税（タクシー）を区別',
  },
  utility: {
    name: '公共料金型',
    features: '請求期間・使用量・基本料金・従量料金・合計請求額・支払期限',
    examples: '電気・ガス・水道・NHK受信料',
    readingPoints: '水道光熱費で処理・請求期間を摘要に・合計請求額を金額として読む',
  },
  ec_online: {
    name: '通販・EC型',
    features: '注文番号・商品名・数量・単価・送料・合計金額・配送先・Amazon/楽天ロゴ',
    examples: 'Amazon・楽天・Yahoo!ショッピング・各種ECサイト',
    readingPoints: '消耗品費で処理・商品名を摘要に・送料は含めて合計金額を使用',
  },
  medical: {
    name: '医療・薬局型',
    features: '患者名・診療科・診療日・点数・自己負担額・保険適用額・薬剤名',
    examples: '病院・クリニック・調剤薬局・歯科医院',
    readingPoints: '福利厚生費または医療費で処理・自己負担額を金額として使用・非課税',
  },
  gas_station: {
    name: 'ガソリンスタンド型',
    features: '給油量・単価・給油種別（レギュラー/軽油）・合計金額・車両番号の場合あり',
    examples: 'ENEOS・出光・コスモ石油・シェル・各ガソリンスタンド',
    readingPoints: '車両費または旅費交通費で処理・給油種別を摘要に・課税仕入10%',
  },
  hotel_accommodation: {
    name: '宿泊・ホテル型',
    features: 'チェックイン/アウト日・宿泊料金・食事代・サービス料・消費税・領収書宛名',
    examples: 'ホテル・旅館・民宿・ゲストハウス',
    readingPoints: '旅費交通費で処理・宿泊期間を摘要に・食事代が別記の場合は会議費で別仕訳',
  },
  bank_atm: {
    name: '銀行・ATM明細型',
    features: '取引日時・取引種別・金額・残高・口座番号・ATM番号',
    examples: '銀行ATM・振込明細・記帳明細',
    readingPoints: '普通預金で処理・取引種別を摘要に・残高は無視・金額のみ読む',
  },
  golf: {
    name: 'ゴルフ場領収書型',
    features: 'プレー日・コース名・プレー費・カート費・食事代・ロッカー代・消費税・領収書宛名・メンバー/ビジター区分',
    examples: 'ゴルフ場・ゴルフクラブ・パブリックコース・打ちっぱなし練習場',
    readingPoints: '接待交際費または福利厚生費で処理・プレー費と食事代が別記の場合は合計金額を使用・ゴルフ場名を取引先に・コース名を摘要に',
  },
  coffee_chain: {
    name: 'コーヒーチェーン型',
    features: '縦長レシート・品目と数量・合計金額・テイクアウト/店内区分・ポイント・会員番号・税率別内訳',
    examples: 'スターバックス・ドトール・コメダ珈琲・タリーズ・エクセルシオール・サンマルクカフェ',
    readingPoints: '会議費で処理・テイクアウトは8%軽減・店内飲食は10%・品目明細は除外して合計金額のみ使用・店舗名を取引先に',
  },
};

// ===== Haikuでフォーマット＋向き判定 =====
async function detectReceiptFormat(apiKey, imageData) {
  const formatList = Object.entries(RECEIPT_FORMATS)
    .map(([key, f]) => `・${key}: ${f.name}（例：${f.examples}）`)
    .join('\n');

  const content = [
    imageData.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageData.data } }
      : { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.data } },
    { type: 'text', text: `この証憑画像について3つを判定してください。説明不要。JSONのみ返答。

【1】フォーマット：以下から最も近いキーを1つ
${formatList}

【2】画像の向き：
・normal: 文字が正立していて読める（縦向きのみ）
・rotate: 画像全体が90°または270°回転していて横倒しになっている
・mixed: 縦向きと横向きの文字が混在している

【3】内訳仕訳モード（line_item_mode）：
・individual: 内訳行を個別仕訳にすべき業種（コンビニ・書店・文具店・ドラッグストアなど、商品カテゴリが混在しやすい小売店）
・total_only: 合計行のみ1件仕訳にすべき業種（飲食店・タクシー・ガソリンスタンド・ホテル・ECサイト・公共料金・医療など）
判定基準：店名・業種・レシートの形式から判断する。コンビニ（セブン-イレブン・ファミマ・ローソン等）、書店（紀伊國屋・丸善・TSUTAYA等）、文具店（ロフト・東急ハンズ等）、ドラッグストア（マツキヨ・ウエルシア・ツルハ等）は"individual"。それ以外は"total_only"。

返答形式（このJSONのみ）：{"format":"register_receipt","orientation":"normal","line_item_mode":"total_only"}` }
  ];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 60, messages: [{ role: 'user', content }] })
    });
    const data = await res.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try {
      const parsed = JSON.parse(raw);
      const format = RECEIPT_FORMATS[parsed.format] ? parsed.format : 'register_receipt';
      const orientation = ['normal','rotate','mixed'].includes(parsed.orientation) ? parsed.orientation : 'normal';
      const line_item_mode = parsed.line_item_mode === 'individual' ? 'individual' : 'total_only';
      return { format, orientation, line_item_mode };
    } catch(e) {
      // JSON解析失敗時はフォーマットキーのみ抽出してnormalを返す
      const key = raw.toLowerCase().replace(/[^a-z_]/g, '');
      return { format: RECEIPT_FORMATS[key] ? key : 'register_receipt', orientation: 'normal', line_item_mode: 'total_only' };
    }
  } catch(e) {
    return { format: 'register_receipt', orientation: 'normal', line_item_mode: 'total_only' };
  }
}

// ===== タイプ別プロンプト生成 =====
function buildSystemPromptParts(formatKey, line_item_mode = 'total_only') {
  const fmt = RECEIPT_FORMATS[formatKey] || RECEIPT_FORMATS['register_receipt'];
  const lineItemInstruction = line_item_mode === 'individual'
    ? `\n\n【内訳仕訳モード：個別仕訳】\nこの証憑は「個別仕訳モード」で処理してください。\n- 商品・カテゴリごとの内訳行を1件ずつ個別に仕訳してください\n- 「小計」「合計」「総合計」などの集計行は出力しないでください\n- 内訳行が存在しない場合のみ合計行を1件出力してください`
    : `\n\n【内訳仕訳モード：合計のみ】\nこの証憑は「合計のみモード」で処理してください。\n- 内訳行・品目明細・小計行はすべて除外してください\n- 【重要】税率が混在する場合（8%軽減と10%が両方ある場合）は税率ごとに分けて複数件出力してください\n  例：食料品合計（8%軽減）¥1,200 と 日用品合計（10%）¥300 → 2件出力\n- 税率が1種類のみの場合は合計1件のみ出力してください\n- 「合計」「金額」「領収金額」「乗車料金」「金」「￥」などの総合計行は参照するが、税率別内訳がある場合はその内訳金額を使用してください\n- 摘要には「食料品（軽減）」「日用品」など税率が分かる内容を記載してください`;
  const formatPart = `

【証憑タイプ】
この証憑は「${fmt.name}」と判定されました。
特徴：${fmt.features}
読み取りポイント：${fmt.readingPoints}
上記の特徴を踏まえて、より正確に読み取ってください。` + lineItemInstruction;
  return { base: SYSTEM, format: formatPart };
}

// 互換性のための関数（既存呼び出し対応）
function buildSystemPrompt(formatKey, line_item_mode = 'total_only') {
  const parts = buildSystemPromptParts(formatKey, line_item_mode);
  return parts.base + parts.format;
}


// ===== Haikuでインボイス番号のみ抽出（摘要はSonnetが処理する）=====
async function extractInvoiceWithHaiku(apiKey, imageData, items) {
  if (!items || items.length === 0) return items;
  const titles = items.map((it, i) => `[${i}] ${it.title} ¥${it.amount}`).join('\n');
  const prompt = `以下の仕訳リストの画像から、インボイス番号（適格請求書発行事業者の登録番号）のみを抽出してください。

仕訳リスト：
${titles}

ルール：
- 「T」で始まる13桁の数字を探す。ハイフン入り（例：T4-1200-0101-8967）も有効
- スタンプ・印字・手書き問わず読み取る
- 見つからなければ空文字
- 1枚の領収書には通常1つのインボイス番号しかないので、同じ画像内の全idxに同じ番号が入る場合が多い

返答はJSON配列のみ（説明文・バッククォート不要）：
[{"idx":0,"invoice_number":"T1234567890123または空文字"}]
- 全仕訳に対してidxを必ず含めること`;

  const imageContent = imageData.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageData.data } }
    : { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.data } };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
      })
    });
    const data = await res.json();
    if (!res.ok) {
      items.forEach(it => { it.invoice_number = it.invoice_number || ''; });
      return items;
    }
    const raw = (data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '').trim();
    const start = raw.indexOf('['), end = raw.lastIndexOf(']');
    if (start === -1) {
      items.forEach(it => { it.invoice_number = it.invoice_number || ''; });
      return items;
    }
    const parsed = JSON.parse(raw.slice(start, end + 1));
    parsed.forEach(({ idx, invoice_number }) => {
      if (items[idx]) {
        items[idx].invoice_number = invoice_number || '';
      }
    });
    items.forEach(it => { it.invoice_number = it.invoice_number || ''; });
  } catch(e) {
    console.warn('Haikuインボイス抽出エラー:', e.message);
    items.forEach(it => { it.invoice_number = it.invoice_number || ''; });
  }
  return items;
}

async function callClaudeWithFormat(apiKey, content, systemPromptOrParts, masterText) {
  // 3層キャッシュブロック構造（変更頻度の低い順）:
  //   1. 基底SYSTEM (最も静的・全リクエスト共通)
  //   2. フォーマット+モード (証憑タイプごと変化)
  //   3. マスタ (マスタ追加・変更時のみ作り直し)
  // それぞれを独立した cache_control ブロックにすることで、
  // マスタ変更時に基底SYSTEMのキャッシュが無効化されない。
  let systemBlocks;
  if (typeof systemPromptOrParts === 'string') {
    // 旧スタイル（互換性）
    systemBlocks = [
      { type: 'text', text: systemPromptOrParts, cache_control: { type: 'ephemeral', ttl: '1h' } }
    ];
  } else {
    // 新スタイル {base, format} + masterText
    systemBlocks = [
      { type: 'text', text: systemPromptOrParts.base, cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: systemPromptOrParts.format, cache_control: { type: 'ephemeral', ttl: '1h' } }
    ];
    if (masterText) {
      systemBlocks.push({ type: 'text', text: masterText, cache_control: { type: 'ephemeral', ttl: '1h' } });
    }
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'extended-cache-ttl-2025-04-11'
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: systemBlocks, messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  // キャッシュ使用状況をログ出力（デバッグ用）
  if (data.usage) {
    const cw = data.usage.cache_creation_input_tokens || 0;
    const cr = data.usage.cache_read_input_tokens || 0;
    const it = data.usage.input_tokens || 0;
    const ot = data.usage.output_tokens || 0;
    if (cw > 0 || cr > 0) console.log(`  📦 cache write:${cw} read:${cr} input:${it} output:${ot}`);
    // 統計を集積
    cumCacheStats.write += cw;
    cumCacheStats.read += cr;
    cumCacheStats.input += it;
    cumCacheStats.output += ot;
    cumCacheStats.requests += 1;
  }
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const startIdx = raw.indexOf('[');
  const endIdx = raw.lastIndexOf(']');
  if (startIdx === -1) return [];
  let jsonStr = endIdx > startIdx ? raw.slice(startIdx, endIdx + 1) : raw.slice(startIdx);
  try {
    return JSON.parse(jsonStr);
  } catch(e) {
    const lastComplete = jsonStr.lastIndexOf('},');
    if (lastComplete > 0) return JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
    return [];
  }
}

async function callClaudeOnce(apiKey, content) {
  const systemBlocks = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }
  ];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'extended-cache-ttl-2025-04-11'
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, system: systemBlocks, messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  if (data.usage) {
    const cw = data.usage.cache_creation_input_tokens || 0;
    const cr = data.usage.cache_read_input_tokens || 0;
    if (cw > 0 || cr > 0) console.log(`  📦 cache write:${cw} read:${cr}`);
  }
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const startIdx = raw.indexOf('[');
  const endIdx = raw.lastIndexOf(']');
  if (startIdx === -1) return [];
  let jsonStr = endIdx > startIdx ? raw.slice(startIdx, endIdx + 1) : raw.slice(startIdx);
  try {
    return JSON.parse(jsonStr);
  } catch(e) {
    const lastComplete = jsonStr.lastIndexOf('},');
    if (lastComplete > 0) return JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
    return [];
  }
}

async function callClaude(apiKey, content) {
  // Sonnetベース：1回で十分な精度を期待。0件の時のみ1回だけリトライ
  const result1 = await callClaudeOnce(apiKey, content);
  console.log(`  1回目: ${result1.length}件`);
  if (result1.length > 0) return result1;
  // 0件の場合のみ1回リトライ
  console.log(`  0件のため再試行...`);
  const result2 = await callClaudeOnce(apiKey, content);
  console.log(`  2回目: ${result2.length}件`);
  return result2;
}

async function splitPdfToChunks(base64Data, chunkSize = 1) {
  const pdfBytes = Buffer.from(base64Data, 'base64');
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();
  const chunks = [];
  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await chunkDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => chunkDoc.addPage(p));
    const chunkBytes = await chunkDoc.save();
    chunks.push({ data: Buffer.from(chunkBytes).toString('base64'), startPage: start + 1, endPage: end, totalPages });
  }
  return chunks;
}

// セッションIDをURLから取得するユーティリティ
function getSessionIdFromUrl(url) {
  const u = new URL(url, 'http://localhost');
  return u.searchParams.get('sessionId') || null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqPath = req.url.split('?')[0];

  if (req.method === 'GET' && (reqPath === '/' || reqPath === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }
  if (req.method === 'GET' && (reqPath === '/terms' || reqPath === '/terms.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'terms.html')));
    return;
  }
  if (req.method === 'GET' && (reqPath === '/privacy' || reqPath === '/privacy.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'privacy.html')));
    return;
  }
  if (req.method === 'GET' && (reqPath === '/tokushoho' || reqPath === '/tokushoho.html' || reqPath === '/legal')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'tokushoho.html')));
    return;
  }

  // ===== マスタAPI =====
  if (req.method === 'GET' && (req.url === '/api/master' || req.url.startsWith('/api/master?'))) {
    const _url = new URL(req.url, 'http://localhost');
    const _uid = _url.searchParams.get('uid');
    try {
      const wsId = await resolveWorkspaceId(_uid, _url.searchParams.get('workspace_id'));
      if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
      getMasterRoutes(req, res, wsId);
    } catch(e) { handleWsError(e, res); }
    return;
  }
  if (req.method === 'POST' && (req.url === '/api/master' || req.url.startsWith('/api/master?'))) {
    const _url = new URL(req.url, 'http://localhost');
    const _uid = _url.searchParams.get('uid');
    try {
      const wsId = await resolveWorkspaceId(_uid, _url.searchParams.get('workspace_id'));
      if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
      updateMasterRoute(req, res, wsId);
    } catch(e) { handleWsError(e, res); }
    return;
  }
  if (req.method === 'DELETE' && (req.url === '/api/master' || req.url.startsWith('/api/master?'))) {
    const _url = new URL(req.url, 'http://localhost');
    const _uid = _url.searchParams.get('uid');
    try {
      const wsId = await resolveWorkspaceId(_uid, _url.searchParams.get('workspace_id'));
      if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
      deleteMasterRoute(req, res, wsId);
    } catch(e) { handleWsError(e, res); }
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/api/master/clear')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, workspace_id } = JSON.parse(body || '{}');
        const wsId = await resolveWorkspaceId(uid || null, workspace_id);
        if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
        saveMaster(uid || null, wsId, {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        console.log(`マスタをクリアしました uid=${uid} wsId=${wsId}`);
      } catch(e) { handleWsError(e, res); }
    });
    return;
  }

  // ===== ユーザー管理API =====

  // POST /api/user/upsert → ログイン時にユーザーをDB登録・更新
  if (req.method === 'POST' && req.url === '/api/user/upsert') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, email, display_name } = JSON.parse(body);
        if (!uid || !email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'uid and email required' }));
          return;
        }
        // 1) まずidで存在確認
        const byId = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
        if (byId && byId.length > 0) {
          // 既存（id一致）→ 表示名のみ更新
          const updated = await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { display_name: display_name || email });
          console.log(`ユーザー更新(id一致): ${email}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user: updated?.[0] || byId[0] }));
          return;
        }
        // 2) emailで既存ユーザーがいるか確認（同じメールでUIDが変わった場合）
        const byEmail = await supabaseQuery(`/users?email=eq.${encodeURIComponent(email)}&select=*`);
        if (byEmail && byEmail.length > 0) {
          // 既存（email一致・id違い）→ idを新しいUIDに付け替え + display_name更新
          // ただし既存のレコードを削除して新規作成すると関連データを失う恐れがあるので、
          // ここでは「既存ユーザーをそのまま返す」だけにする（idは古いまま）
          // フロントは返却されたuser.idを使えば既存データを参照できる
          console.log(`ユーザー既存(email一致): ${email}（既存idを返却）`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user: byEmail[0], existed: true }));
          return;
        }
        // 3) どちらも存在しない → 新規作成
        const created = await supabaseQuery('/users', 'POST', {
          id: uid, email, display_name: display_name || email
        });
        console.log(`ユーザー新規作成: ${email}`);
        // default ワークスペース自動作成
        ensureDefaultWorkspace(uid).catch(e => console.warn('ensureDefaultWorkspace error:', e.message));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, user: created?.[0] || null }));
      } catch(e) {
        console.error('User upsert error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/user?uid=xxx → ユーザー情報取得
  if (req.method === 'GET' && req.url.startsWith('/api/user?')) {
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const data = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
      const user = data?.[0] || null;
      // フォールバック: current_workspace_id が未設定(ワークスペース0件)ならここで保証
      if (user && !user.current_workspace_id) {
        const wsId = await ensureDefaultWorkspace(uid).catch(e => {
          console.warn('ensureDefaultWorkspace fallback error:', e.message);
          return null;
        });
        if (wsId) user.current_workspace_id = wsId;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/user/plan?uid=xxx → ユーザーのプラン情報・edition・利用可能機能を返す
  if (req.method === 'GET' && req.url.startsWith('/api/user/plan')) {
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const data = await supabaseQuery(`/users?id=eq.${uid}&select=plan_key,edition,monthly_count,billing_period_end,has_workspace_option,workspace_addon_count`);
      const user = data?.[0];
      if (!user || !user.plan_key) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plan: null, edition: 'saas', features: EDITION_FEATURES.saas }));
        return;
      }
      const plan = STRIPE_PLANS[user.plan_key];
      const [workspaceLimit, wsRows] = await Promise.all([
        getWorkspaceLimit(uid),
        supabaseQuery(`/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&select=id`)
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        plan: { key: user.plan_key, ...plan },
        edition: user.edition,
        features: EDITION_FEATURES[user.edition] || EDITION_FEATURES.saas,
        usage: {
          monthly_count: user.monthly_count || 0,
          limit: plan?.limit || null,
          billing_period_end: user.billing_period_end,
        },
        workspace_limit: workspaceLimit,
        has_workspace_option: user.has_workspace_option || false,
        workspace_addon_count: user.workspace_addon_count || 0,
        current_workspace_count: (wsRows || []).length,
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/user/count → 月次処理件数・インセンティブカウントを加算
  if (req.method === 'POST' && req.url === '/api/user/count') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, amount, workspace_id } = JSON.parse(body);
        const n = amount || 1;
        // workspace_id を解決(信頼度メトリクス再計算で使用)
        const wsId = await resolveWorkspaceId(uid, workspace_id).catch(() => null);
        // 現在の値を取得
        const current = await supabaseQuery(`/users?id=eq.${uid}&select=monthly_count,incentive_total,incentive_unredeemed,stripe_plan,plan_key,incentive_plan,billing_period_end`);
        const row = current?.[0] || {};
        // 請求期間が終了していたら月次カウントをリセット
        let cur = row.monthly_count || 0;
        if (row.billing_period_end && new Date(row.billing_period_end) < new Date()) {
          cur = 0;
        }
        const incTotal = (row.incentive_total || 0) + n;
        const incUnredeemed = (row.incentive_unredeemed || 0) + n;
        // インセンティブ対象判定:
        //   1. INCENTIVE_ALL_PLANS=true（テスト時のみ）
        //   2. 旧代理店・チームプラン / 新チームプラン / 代理店プラン
        //   3. インセンティブオプション購入済み（incentive_plan）
        const planForCheck = row.plan_key || row.stripe_plan;
        const isAgency = INCENTIVE_ALL_PLANS
          || ['agency_light','agency_std','agency_prem','team_lite','team_std','team_prem',
              'ai_saas_team_lite','ai_saas_team_std','ai_saas_team_prem',
              'reseller_ai_saas_team_lite','reseller_ai_saas_team_std','reseller_ai_saas_team_prem'].includes(planForCheck)
          || (row.incentive_plan && STRIPE_PLANS[row.incentive_plan]?.is_option === true);
        const patch = { monthly_count: cur + n };
        if (isAgency) {
          patch.incentive_total      = incTotal;
          patch.incentive_unredeemed = incUnredeemed;
        }
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', patch);

        // 累計件数インクリメント + 卒業判定
        const gradResult = await bumpCumulativeAndCheckGraduation(uid, n).catch(() => null);
        // workspace_id が解決できた場合は信頼度メトリクスを再計算
        if (wsId) recalculateTrustMetrics(wsId).catch(e => console.warn('trust metrics error:', e.message));

        // 1000件到達チェック → オーナーとadminにメール通知
        if (isAgency) {
          const prevUnredeemed = row.incentive_unredeemed || 0;
          const crossed = Math.floor(prevUnredeemed / INCENTIVE_THRESHOLD) < Math.floor(incUnredeemed / INCENTIVE_THRESHOLD);
          if (crossed) {
            try {
              // スタッフ情報とオーナー情報を取得
              const staffRow = (await supabaseQuery(`/users?id=eq.${uid}&select=display_name,email,owner_id,role`))?.[0] || {};
              const staffName = staffRow.display_name || staffRow.email || uid;
              let ownerEmail = staffRow.email;
              if (staffRow.role === 'staff' && staffRow.owner_id) {
                const ownerRow = (await supabaseQuery(`/users?id=eq.${staffRow.owner_id}&select=email`))?.[0];
                if (ownerRow?.email) ownerEmail = ownerRow.email;
              }
              await sendIncentiveNotification(ownerEmail, staffName, incUnredeemed);
            } catch(e) {
              console.error('インセンティブ通知エラー:', e.message);
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          monthly_count: cur + n,
          total_count: cur + n,
          incentive_total: isAgency ? incTotal : (row.incentive_total || 0),
          incentive_unredeemed: isAgency ? incUnredeemed : (row.incentive_unredeemed || 0),
          incentive_threshold: INCENTIVE_THRESHOLD,
          incentive_amount: INCENTIVE_AMOUNT,
          is_agency: isAgency,
          graduation: gradResult
        }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ===== 代理店API =====

  // POST /api/affiliate/apply → 代理店申込
  if (req.method === 'POST' && req.url === '/api/affiliate/apply') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, email, companyName, industry, contact, estimatedCustomers, agreedTerms } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        if (!agreedTerms) { res.writeHead(400); res.end(JSON.stringify({ error: 'terms not agreed' })); return; }
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
          affiliate_application: JSON.stringify({
            companyName, industry, contact, estimatedCustomers,
            appliedAt: new Date().toISOString(),
            status: 'pending'
          })
        });
        await sendAdminNotification('代理店申込', { uid, email, companyName, industry, contact, estimatedCustomers });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'pending' }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/affiliate/dashboard?uid=xxx → 代理店ダッシュボードデータ取得
  if (req.method === 'GET' && req.url.startsWith('/api/affiliate/dashboard')) {
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const userData = await supabaseQuery(`/users?id=eq.${uid}&select=*`);
      const user = userData?.[0];
      if (!user || !user.is_reseller) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'not a reseller' })); return;
      }
      const customers = await supabaseQuery(
        `/users?reseller_uid=eq.${uid}&is_paid=eq.true&select=id,email,plan_key,billing_period_end`
      );
      let monthlyVolume = 0;
      for (const c of customers) {
        const resellerPlan = STRIPE_PLANS[`reseller_${c.plan_key}`];
        if (resellerPlan?.price_yen) monthlyVolume += resellerPlan.price_yen;
      }
      let nextTier = null, nextThreshold = null;
      if (user.current_tier === 'bronze')      { nextTier = 'silver'; nextThreshold = RESELLER_TIER_THRESHOLDS.silver; }
      else if (user.current_tier === 'silver') { nextTier = 'gold';   nextThreshold = RESELLER_TIER_THRESHOLDS.gold; }
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
        customers,
        referralUrl: user.referral_code ? `https://shiwake-ai.com/?ref=${user.referral_code}` : null,
      }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/admin/affiliate/approve → 代理店申込承認(運営専用)
  if (req.method === 'POST' && req.url === '/api/admin/affiliate/approve') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { adminToken, uid } = JSON.parse(body);
        if (!verifyAdminToken(adminToken)) {
          res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return;
        }
        const referralCode = await generateReferralCode();
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
          is_reseller: true,
          current_tier: 'bronze',
          referral_code: referralCode,
          affiliate_application: null,
        });
        console.log(`代理店承認: ${uid} referral_code=${referralCode}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, referralCode }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ===== Stripe決済API =====

  // POST /api/stripe/checkout → Stripe Checkoutセッション作成
  if (req.method === 'POST' && req.url === '/api/stripe/checkout') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, email, plan_key } = JSON.parse(body);
        const plan = STRIPE_PLANS[plan_key] || STRIPE_PLANS.light;
        // エリートユーザーがworkspace_option_10を購入しようとした場合を防止(§10.2 重要3)
        const isWorkspaceOptionKey = plan_key === 'workspace_option_10' || plan_key === 'reseller_workspace_option_10';
        if (isWorkspaceOptionKey) {
          const userData = await supabaseQuery(`/users?id=eq.${uid}&select=plan_key`);
          const currentPlanKey = userData?.[0]?.plan_key;
          if (currentPlanKey === 'agent_elite' || currentPlanKey === 'reseller_agent_elite') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'elite_already_includes_workspace', message: 'エリートプランには10枠が標準装備されています' }));
            return;
          }
        }
        if (!STRIPE_SECRET_KEY) {
          // 無料期間中：課金スキップ
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ free_trial: true }));
          return;
        }
        // Stripeカスタマー作成 or 取得
        const customers = await stripeRequest(`/customers?email=${encodeURIComponent(email)}&limit=1`);
        let customerId;
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
        } else {
          const customer = await stripeRequest('/customers', 'POST', { email, metadata: { firebase_uid: uid } });
          customerId = customer.id;
        }
        // Checkout セッション作成
        const session = await stripeRequest('/checkout/sessions', 'POST', {
          customer: customerId,
          mode: 'subscription',
          line_items: [{ price: plan.price_id, quantity: 1 }],
          success_url: STRIPE_SUCCESS_URL,
          cancel_url: STRIPE_CANCEL_URL,
          metadata: { firebase_uid: uid, plan_key: plan_key || 'light' },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: session.url }));
      } catch(e) {
        console.error('Stripe checkout error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/stripe/webhook → Stripe Webhook処理
  if (req.method === 'POST' && req.url === '/api/stripe/webhook') {
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', async () => {
      try {
        const event = JSON.parse(rawBody);
        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const uid = session.metadata?.firebase_uid;
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const planKey = session.metadata?.plan_key || null;
          const isIncentiveOption = planKey && STRIPE_PLANS[planKey]?.is_option === true;
          const isResellerPlan = planKey && STRIPE_PLANS[planKey]?.is_reseller === true;
          const isWorkspaceOption = planKey === 'workspace_option_10' || planKey === 'reseller_workspace_option_10';
          const isWorkspaceAddon = planKey === 'workspace_addon_10' || planKey === 'reseller_workspace_addon_10';
          const isWorkspacePlan = isWorkspaceOption || isWorkspaceAddon;

          if (uid) {
            if (isWorkspacePlan) {
              // ワークスペースオプション/追加枠購入(§10.2 重要2: 冪等性)
              const existing = await supabaseQuery(`/workspace_addon_subscriptions?subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`);
              const existingRecord = existing?.[0];
              if (existingRecord?.status === 'active') {
                console.log(`ワークスペースサブスク購入スキップ(冪等): ${subscriptionId}`);
              } else {
                if (existingRecord) {
                  await supabaseQuery(`/workspace_addon_subscriptions?subscription_id=eq.${encodeURIComponent(subscriptionId)}`, 'PATCH', {
                    status: 'active', updated_at: new Date().toISOString()
                  });
                } else {
                  await supabaseQuery('/workspace_addon_subscriptions', 'POST', {
                    subscription_id: subscriptionId, uid, plan_key: planKey,
                    status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
                  });
                }
                if (isWorkspaceOption) {
                  await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { has_workspace_option: true });
                  console.log(`ワークスペース10枠オプション購入: ${uid} plan=${planKey}`);
                } else {
                  const userData = await supabaseQuery(`/users?id=eq.${uid}&select=workspace_addon_count`);
                  const current = userData?.[0]?.workspace_addon_count || 0;
                  await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { workspace_addon_count: current + 1 });
                  console.log(`追加ワークスペース10枠購入: ${uid} plan=${planKey} count=${current + 1}`);
                }
              }
            } else if (isIncentiveOption) {
              // インセンティブオプション購入: incentive_planのみ更新
              await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
                incentive_plan: planKey,
                incentive_purchased_at: new Date().toISOString()
              });
              console.log(`インセンティブオプション購入: ${uid} plan=${planKey}`);
            } else {
              // 通常/代理店プラン購入: billing_period・edition・is_reseller を保存
              let billingPeriodStart = null, billingPeriodEnd = null;
              if (subscriptionId) {
                try {
                  const sub = await stripeRequest(`/subscriptions/${subscriptionId}`);
                  billingPeriodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null;
                  billingPeriodEnd   = sub.current_period_end   ? new Date(sub.current_period_end   * 1000).toISOString() : null;
                } catch(e) {
                  console.warn('subscription取得失敗:', e.message);
                }
              }
              const plan = STRIPE_PLANS[planKey];
              const edition = plan?.edition || 'saas';
              const isAgentPlan = planKey && planKey.startsWith('agent_');
              const patchData = {
                is_paid: true,
                is_free_trial: false,
                stripe_customer_id: customerId,
                stripe_plan: planKey,
                plan_key: planKey,
                edition: edition,
                is_reseller: isResellerPlan ? true : false,
                billing_period_start: billingPeriodStart,
                billing_period_end: billingPeriodEnd,
                monthly_count: 0,
                paid_at: new Date().toISOString()
              };
              if (isAgentPlan) patchData.graduated_rookie_at = new Date().toISOString();
              await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', patchData);
              console.log(`プラン契約: ${uid} → ${planKey} (${edition})${isResellerPlan ? ' [代理店]' : ''}${isAgentPlan ? ' [agent→graduated]' : ''}`);
            }
          }
        }
        if (event.type === 'customer.subscription.updated') {
          const sub = event.data.object;
          const customerId = sub.customer;
          const billingPeriodStart = new Date(sub.current_period_start * 1000).toISOString();
          const billingPeriodEnd   = new Date(sub.current_period_end   * 1000).toISOString();
          await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}`, 'PATCH', {
            billing_period_start: billingPeriodStart,
            billing_period_end: billingPeriodEnd,
            monthly_count: 0,
          });
          console.log(`請求期間更新: ${customerId}`);
        }
        if (event.type === 'invoice.paid') {
          const invoice = event.data.object;
          const customerId = invoice.customer;
          const lineItems = invoice.lines?.data || [];
          const newPlanKey = lineItems.map(l => l.metadata?.plan_key).find(k => k) || null;
          if (newPlanKey && newPlanKey.startsWith('agent_')) {
            const users = await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}&select=id,graduated_rookie_at`);
            const user = Array.isArray(users) ? users[0] : null;
            if (user && !user.graduated_rookie_at) {
              await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}`, 'PATCH', {
                graduated_rookie_at: new Date().toISOString()
              });
              console.log(`invoice.paid agent→graduated: ${customerId}`);
            }
          }
        }
        if (event.type === 'customer.subscription.deleted') {
          const deletedSub = event.data.object;
          const deletedSubId = deletedSub.id;
          const customerId = deletedSub.customer;
          // ワークスペースサブスクかどうかを subscription_id で判定(§10.2 重要2: 冪等性)
          const addonRows = await supabaseQuery(`/workspace_addon_subscriptions?subscription_id=eq.${encodeURIComponent(deletedSubId)}&select=*`);
          const addonRecord = addonRows?.[0];
          if (addonRecord) {
            if (addonRecord.status === 'active') {
              await supabaseQuery(`/workspace_addon_subscriptions?subscription_id=eq.${encodeURIComponent(deletedSubId)}`, 'PATCH', {
                status: 'cancelled', updated_at: new Date().toISOString()
              });
              const { uid, plan_key: addonPlanKey } = addonRecord;
              const isOpt10 = addonPlanKey === 'workspace_option_10' || addonPlanKey === 'reseller_workspace_option_10';
              const isAdd10 = addonPlanKey === 'workspace_addon_10' || addonPlanKey === 'reseller_workspace_addon_10';
              if (isOpt10) {
                await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { has_workspace_option: false });
                console.log(`ワークスペース10枠オプション解約: ${uid}`);
              } else if (isAdd10) {
                const userData = await supabaseQuery(`/users?id=eq.${uid}&select=workspace_addon_count`);
                const current = userData?.[0]?.workspace_addon_count || 0;
                await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { workspace_addon_count: Math.max(0, current - 1) });
                console.log(`追加ワークスペース10枠解約: ${uid} count→${Math.max(0, current - 1)}`);
              }
            } else {
              console.log(`ワークスペースサブスク解約スキップ(冪等): ${deletedSubId} already ${addonRecord.status}`);
            }
          } else {
            // 既存プランの解約処理(ワークスペースサブスク以外)
            await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}`, 'PATCH', {
              is_paid: false,
              plan_key: null,
              edition: null,
              is_reseller: false,
            });
            console.log(`サブスク解約: ${customerId}`);
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        console.error('Webhook error:', e.message);
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ===== セッションAPI =====

  // GET /api/session?sessionId=xxx → 仕訳一覧取得
  if (req.method === 'GET' && req.url.startsWith('/api/session')) {
    const sessionId = getSessionIdFromUrl(req.url);
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId required' }));
      return;
    }
    const session = getSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: session ? session.items : [] }));
    return;
  }

  // POST /api/session/append → 仕訳を追記（スマホでスキャン後に呼ぶ）
  if (req.method === 'POST' && req.url === '/api/session/append') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionId, items } = JSON.parse(body);
        if (!sessionId || !items) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId and items required' }));
          return;
        }
        const session = appendToSession(sessionId, items);
        console.log(`セッション追記 [${sessionId}]: ${items.length}件追加 → 合計${session.items.length}件`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, total: session.items.length }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/session/save → 仕訳全体を上書き保存（承認状態の同期用）
  if (req.method === 'POST' && req.url === '/api/session/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionId, items } = JSON.parse(body);
        if (!sessionId || !items) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sessionId and items required' }));
          return;
        }
        saveSession(sessionId, items);
        console.log(`セッション保存 [${sessionId}]: ${items.length}件`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/session?sessionId=xxx → セッション削除
  if (req.method === 'DELETE' && req.url.startsWith('/api/session')) {
    const sessionId = getSessionIdFromUrl(req.url);
    if (sessionId) deleteSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ===== 既存API =====
  // ===== admin: キャッシュ統計 =====
  if (req.method === 'GET' && req.url.startsWith('/api/admin/cache-stats')) {
    const totalIn = cumCacheStats.input + cumCacheStats.write + cumCacheStats.read;
    const cacheRate = totalIn > 0 ? Math.round((cumCacheStats.read / totalIn) * 100) : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...cumCacheStats,
      cacheHitRate: cacheRate,
      avgInputPerRequest: cumCacheStats.requests > 0 ? Math.round(totalIn / cumCacheStats.requests) : 0
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/split-pdf') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { data, fileName } = JSON.parse(body);
        // ページ数チェック
        const PDF_PAGE_LIMIT = 50;
        const pdfBytes = Buffer.from(data, 'base64');
        const probeDoc = await PDFDocument.load(pdfBytes);
        const totalPages = probeDoc.getPageCount();
        if (totalPages > PDF_PAGE_LIMIT) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `PDFは最大${PDF_PAGE_LIMIT}ページまでです（${totalPages}ページ検出）。分割してアップロードしてください。`
          }));
          return;
        }
        const chunks = await splitPdfToChunks(data, 1);
        console.log(`split-pdf: ${fileName} → ${chunks.length}チャンク(${chunks[0]?.totalPages}ページ)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ chunks: chunks.map(c => ({ ...c, fileName })) }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze-chunk') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { imageDataList, fileNames, chunkIndex, totalChunks, docType, line_item_mode: requestedMode, uid, masterUid, catRules } = JSON.parse(body);
        const apiKey = process.env.ANTHROPIC_API_KEY || '';
        if (!apiKey) throw new Error('APIキーが設定されていません');

        // ===== ステップ0: ハッシュキャッシュ確認（同一画像の再処理を回避） =====
        // 単一画像チャンクの場合のみキャッシュを使う（複数画像の合成は対象外）
        const cacheUid = masterUid || uid || null;
        let imageHash = null;
        if (imageDataList.length === 1 && cacheUid) {
          imageHash = computeHash(imageDataList[0].data);
          console.log(`  🔑 hash: ${imageHash.slice(0,12)}... uid=${cacheUid.slice(0,8)}...`);
          const cachedItems = getHashedResult(cacheUid, imageHash);
          if (cachedItems && cachedItems.length > 0) {
            console.log(`  ⚡ ハッシュキャッシュヒット: ${cachedItems.length}件（API呼び出しなし）`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              items: cachedItems,
              orientation: 'normal',
              line_item_mode: 'total_only',
              cacheHit: 'hash'
            }));
            return;
          }
        } else {
          console.log(`  ⚠️ ハッシュキャッシュ無効: imageCount=${imageDataList.length} cacheUid=${cacheUid?'有':'無'}`);
        }

        // マスタを先に読み込む（cacheUid基準）
        const master = loadMaster(cacheUid);
        const masterKeys = Object.keys(master);

        // ===== ステップ1: フォーマット判定（Haiku・高速） =====
        let formatKey = docType || null;
        let orientation = 'normal';
        let line_item_mode = requestedMode || null; // フロントから指定があれば優先
        if (!formatKey && imageDataList.length > 0) {
          const detected = await detectReceiptFormat(apiKey, imageDataList[0]);
          formatKey = detected.format;
          orientation = detected.orientation;
          if (!line_item_mode) line_item_mode = detected.line_item_mode;
          console.log(`  フォーマット判定: ${formatKey}（${RECEIPT_FORMATS[formatKey]?.name}）向き: ${orientation} モード: ${line_item_mode}`);
        } else if (formatKey) {
          // docType指定時もHaikuで向きだけ判定
          if (imageDataList.length > 0) {
            const detected = await detectReceiptFormat(apiKey, imageDataList[0]);
            orientation = detected.orientation;
            if (!line_item_mode) line_item_mode = detected.line_item_mode;
          }
          console.log(`  フォーマット指定: ${formatKey}（${RECEIPT_FORMATS[formatKey]?.name || '不明'}）向き: ${orientation} モード: ${line_item_mode}`);
        }
        if (!line_item_mode) line_item_mode = 'total_only';

        // ===== ステップ2: systemプロンプトを構築（3層キャッシュブロック構造） =====
        // 基底SYSTEM + フォーマット + マスタを別ブロックにすることで
        // マスタ変更時に基底SYSTEMのキャッシュが無効化されない
        const systemParts = buildSystemPromptParts(formatKey || 'register_receipt', line_item_mode);
        let masterText = null;
        if (masterKeys.length > 0) {
          masterText = `\n\n【学習済み取引先マスタ】\n以下の取引先は過去の承認済み仕訳実績です。同じ取引先名（または部分一致）が出た場合は、この勘定科目を優先して使用してください：\n` +
            Object.entries(master)
              .map(([title, rule]) => `・${title} → 借方:${rule.debit} 貸方:${rule.credit} 税:${rule.tax}`)
              .join('\n');
        }
        // カテゴリルール（ユーザー定義の最優先ルール）
        if (catRules && Array.isArray(catRules) && catRules.length > 0) {
          const catRuleText = `\n\n【ユーザー定義カテゴリルール（最優先）】\n以下の条件に合致する取引先は、マスタより優先してこのルールを適用してください：\n` +
            catRules.map(r => `・${r.condition} → 借方「${r.debit}」・${r.tax}`).join('\n');
          masterText = (masterText || '') + catRuleText;
        }

        // ===== ステップ3: Sonnetへ画像を渡す =====
        const content = [];
        imageDataList.forEach((img, i) => {
          if (img.mediaType === 'application/pdf') {
            content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } });
          } else {
            content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
          }
          content.push({ type: 'text', text: `証憑${i+1}（${fileNames[i]}）を分析してください。` });
        });
        content.push({ type: 'text', text: 'JSON配列のみ返してください。バッククォートや説明文は不要です。' });

        // タイプ別プロンプトでSonnetを呼ぶ（0件時のみ1回リトライ）
        let rawItems = await callClaudeWithFormat(apiKey, content, systemParts, masterText);
        console.log(`  1回目: ${rawItems.length}件`);
        if (rawItems.length === 0) {
          console.log(`  0件のため再試行...`);
          rawItems = await callClaudeWithFormat(apiKey, content, systemParts, masterText);
          console.log(`  2回目: ${rawItems.length}件`);
        }

        const EXCLUDE_TITLES = ['ETC', 'ETCカード', 'ETCカード利用分', 'ETC利用分'];
        const EXCLUDE_MEMOS = ['ETCカード利用分', 'ETC利用分', 'カード利用分'];
        let items = rawItems
          .filter(item => {
            const date = item.date || '';
            if (date === '不明' || date === '' || date === 'YYYY/MM/DD') return false;
            if (!/\d{4}\/\d{2}\/\d{2}/.test(date)) return false;
            const title = (item.title || '').trim();
            if (EXCLUDE_TITLES.includes(title)) return false;
            const memo = (item.memo || '');
            if (EXCLUDE_MEMOS.some(m => memo.includes(m)) && !item.title.match(/[ぁ-ん]/)) return false;
            return true;
          })
          .map(item => {
            // マスタヒット判定（部分一致）
            const matchResult = findMasterMatch(item.title, master);
            if (matchResult.matched_id) {
              const rule = master[matchResult.matched_id];
              return {
                ...item,
                debit: rule.debit,
                credit: rule.credit,
                tax: rule.tax,
                masterApplied: true,
                masterKey: matchResult.matched_id,
                masterMethod: matchResult.method
              };
            }
            return { ...item, masterApplied: false };
          });

        // ===== ステップ4: Haikuでインボイス番号のみ抽出（Sonnetから分離してコスト削減） =====
        if (items.length > 0 && imageDataList.length > 0) {
          items = await extractInvoiceWithHaiku(apiKey, imageDataList[0], items);
        } else {
          items.forEach(it => { it.invoice_number = it.invoice_number || ''; });
        }

        // ===== ステップ5: ハッシュキャッシュに保存（次回同じ画像なら即返却） =====
        if (imageHash && cacheUid && items.length > 0) {
          setHashedResult(cacheUid, imageHash, items);
        }

        // マスタヒット件数を集計（フロントのヒット率表示用）
        const masterHitCount = items.filter(it => it.masterApplied).length;

        console.log(`チャンク ${chunkIndex+1}/${totalChunks}: ${rawItems.length}件取得 → ${items.length}件（フォーマット:${formatKey}・モード:${line_item_mode}・マスタ${masterKeys.length}件・ヒット${masterHitCount}件）`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          items,
          orientation,
          line_item_mode,
          masterHitCount,
          totalCount: items.length
        }));
      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }


  // ===== 招待・スタッフ管理API =====

  // POST /api/invite → 招待コード生成・メール送信
  if (req.method === 'POST' && req.url === '/api/invite') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { owner_uid, email, workspace_id } = JSON.parse(body);
        if (!owner_uid || !email) { res.writeHead(400); res.end(JSON.stringify({ error: 'owner_uid and email required' })); return; }
        // workspace_id を解決(invites テーブルに workspace_id 列なし、所有確認のみ)
        try { await resolveWorkspaceId(owner_uid, workspace_id); } catch(e) { handleWsError(e, res); return; }
        // オーナー確認
        const ownerData = await supabaseQuery(`/users?id=eq.${owner_uid}&select=role,email,display_name`);
        const owner = ownerData?.[0];
        if (!owner || owner.role === 'staff') { res.writeHead(403); res.end(JSON.stringify({ error: 'owner only' })); return; }
        // 招待コード生成（UUID相当）
        const code = Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)+Date.now().toString(36);
        // 既存の招待があれば削除
        await supabaseQuery(`/invites?owner_id=eq.${owner_uid}&email=eq.${encodeURIComponent(email)}&status=eq.pending`, 'DELETE');
        // 新規招待を作成
        await supabaseQuery('/invites', 'POST', { id: code, owner_id: owner_uid, email, status: 'pending' });
        const inviteUrl = `https://shiwake-ai.onrender.com/?invite=${code}`;
        console.log(`招待作成: ${email} → ${inviteUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, code, invite_url: inviteUrl, owner_name: owner.display_name || owner.email }));
      } catch(e) {
        console.error('Invite error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/invite?code=xxx → 招待コード検証
  if (req.method === 'GET' && req.url.startsWith('/api/invite?')) {
    const code = new URL(req.url, 'http://localhost').searchParams.get('code');
    if (!code) { res.writeHead(400); res.end(JSON.stringify({ error: 'code required' })); return; }
    try {
      const data = await supabaseQuery(`/invites?id=eq.${code}&select=*`);
      const invite = data?.[0];
      if (!invite) { res.writeHead(404); res.end(JSON.stringify({ error: '招待コードが無効です' })); return; }
      if (invite.status !== 'pending') { res.writeHead(400); res.end(JSON.stringify({ error: 'この招待は既に使用されています' })); return; }
      // オーナー名も取得
      const ownerData = await supabaseQuery(`/users?id=eq.${invite.owner_id}&select=display_name,email`);
      const ownerName = ownerData?.[0]?.display_name || ownerData?.[0]?.email || '事務所';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, invite, owner_name: ownerName }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/invite/accept → 招待承認・スタッフ登録
  if (req.method === 'POST' && req.url === '/api/invite/accept') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { code, uid, email, display_name } = JSON.parse(body);
        if (!code || !uid || !email) { res.writeHead(400); res.end(JSON.stringify({ error: 'code, uid, email required' })); return; }
        // 招待コード確認
        const data = await supabaseQuery(`/invites?id=eq.${code}&select=*`);
        const invite = data?.[0];
        if (!invite || invite.status !== 'pending') { res.writeHead(400); res.end(JSON.stringify({ error: '招待コードが無効または使用済みです' })); return; }
        // スタッフとして登録
        await supabaseQuery(
          '/users?on_conflict=id', 'POST',
          { id: uid, email, display_name: display_name || email, role: 'staff', owner_id: invite.owner_id },
          { 'Prefer': 'resolution=merge-duplicates,return=representation' }
        );
        // 招待を使用済みに
        await supabaseQuery(`/invites?id=eq.${code}`, 'PATCH', { status: 'accepted' });
        console.log(`スタッフ登録: ${email} → owner: ${invite.owner_id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, owner_id: invite.owner_id }));
      } catch(e) {
        console.error('Invite accept error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/staff?owner_uid=xxx&workspace_id=yyy → スタッフ一覧取得
  if (req.method === 'GET' && req.url.startsWith('/api/staff?')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const owner_uid = params.get('owner_uid');
    if (!owner_uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'owner_uid required' })); return; }
    try {
      // workspace_id を検証(指定された場合は所有確認、未指定は current_workspace_id でフォールバック)
      // staff_members テーブル未実装のため wsId はフィルタに未使用
      await resolveWorkspaceId(owner_uid, params.get('workspace_id')).catch(e => { if (e.status === 403) throw e; });
      const data = await supabaseQuery(`/users?owner_id=eq.${owner_uid}&role=eq.staff&select=id,email,display_name,incentive_total,incentive_unredeemed,monthly_count`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ staff: data || [] }));
    } catch(e) {
      if (e.status === 403) { res.writeHead(403); res.end(JSON.stringify({ error: e.message })); return; }
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ===== v2.3.0: 自動取り込み API =====

  // GET /api/user/graduation-status?uid=xxx
  if (req.method === 'GET' && reqPath === '/api/user/graduation-status') {
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const data = await supabaseQuery(`/users?id=eq.${uid}&select=cumulative_shiwake_count,graduated_rookie_at,plan_key,is_paid`);
      const user = data?.[0];
      const isAgent = user?.plan_key?.startsWith('agent_');
      const cumulativeCount = user?.cumulative_shiwake_count || 0;
      const threshold = 50;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        graduated: !!user?.graduated_rookie_at,
        is_agent: isAgent,
        is_paid: user?.is_paid || false,
        cumulative_count: cumulativeCount,
        threshold,
        progress_pct: Math.min(100, Math.floor((cumulativeCount / threshold) * 100)),
        remaining: Math.max(0, threshold - cumulativeCount),
        graduated_at: user?.graduated_rookie_at
      }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // GET /api/inbox/address?uid=xxx&workspace_id=yyy (将来用、現状は uid 単位)
  if (req.method === 'GET' && reqPath === '/api/inbox/address') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const uid = params.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      // workspace_id は受け取るが、専用アドレスは uid 単位のため現在は検証のみ
      if (params.get('workspace_id')) {
        await resolveWorkspaceId(uid, params.get('workspace_id'));
      }
      const data = await supabaseQuery(`/inbox_addresses?uid=eq.${uid}&is_active=eq.true&select=local_part,created_at`);
      const addr = data?.[0];
      if (!addr) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ address: null })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ address: `${addr.local_part}@inbox.shiwake-ai.com`, created_at: addr.created_at }));
    } catch(e) {
      if (e.status === 403) { res.writeHead(403); res.end(JSON.stringify({ error: e.message })); return; }
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/inbox/address/issue → 専用メールアドレス発行/再発行
  if (req.method === 'POST' && reqPath === '/api/inbox/address/issue') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const check = await canUseAutoIntake(uid);
        if (!check.allowed) { res.writeHead(403); res.end(JSON.stringify({ error: check.reason, ...check })); return; }

        const graceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await supabaseQuery(`/inbox_addresses?uid=eq.${uid}&is_active=eq.true`, 'PATCH', { is_active: false, revoked_at: graceUntil });

        let localPart;
        for (let i = 0; i < 10; i++) {
          localPart = generateRandomLocalPart(8);
          const existing = await supabaseQuery(`/inbox_addresses?local_part=eq.${localPart}&select=id`);
          if (!existing || existing.length === 0) break;
        }
        await supabaseQuery('/inbox_addresses', 'POST', { uid, local_part: localPart, is_active: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ address: `${localPart}@inbox.shiwake-ai.com`, grace_until: graceUntil }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // GET /api/inbox/settings?uid=xxx&workspace_id=yyy
  if (req.method === 'GET' && reqPath === '/api/inbox/settings') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const uid = params.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      // workspace_id を検証(inbox_settings テーブル未実装のため検証のみ、フィルタは uid 単位)
      try { await resolveWorkspaceId(uid, params.get('workspace_id')); } catch(e) { handleWsError(e, res); return; }
      const data = await supabaseQuery(`/users?id=eq.${uid}&select=auto_intake_enabled,auto_shiwake_enabled,graduated_rookie_at`);
      const u = data?.[0];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        auto_intake_enabled: u?.auto_intake_enabled || false,
        auto_shiwake_enabled: u?.auto_shiwake_enabled || false,
        graduated: !!u?.graduated_rookie_at
      }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // PUT /api/inbox/settings → 取り込み設定更新
  if (req.method === 'PUT' && reqPath === '/api/inbox/settings') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid, auto_intake_enabled, auto_shiwake_enabled, workspace_id } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        // workspace_id を検証(inbox_settings テーブル未実装のため検証のみ)
        try { await resolveWorkspaceId(uid, workspace_id); } catch(e) { handleWsError(e, res); return; }
        if (auto_intake_enabled === true) {
          const check = await canUseAutoIntake(uid);
          if (!check.allowed) { res.writeHead(403); res.end(JSON.stringify({ error: check.reason, ...check })); return; }
        }
        const update = {};
        if (typeof auto_intake_enabled === 'boolean') update.auto_intake_enabled = auto_intake_enabled;
        if (typeof auto_shiwake_enabled === 'boolean') update.auto_shiwake_enabled = auto_shiwake_enabled;
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', update);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // GET /api/inbox?uid=xxx&workspace_id=yyy&status=pending
  if (req.method === 'GET' && reqPath === '/api/inbox') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const uid = params.get('uid');
    const status = params.get('status') || 'pending';
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const wsId = await resolveWorkspaceId(uid, params.get('workspace_id'));
      if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
      let q = `/inbox_files?uid=eq.${uid}&workspace_id=eq.${wsId}&select=id,source,sender,filename,mime_type,byte_size,status,error_message,created_at&order=created_at.desc&limit=100`;
      if (status === 'pending') q += '&status=in.(pending,processing,failed)';
      else if (status === 'archived') q += '&status=eq.archived';
      const data = await supabaseQuery(q);
      const files = data || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files, pending_count: files.filter(f => f.status === 'pending').length }));
    } catch(e) {
      if (e.status === 403) { res.writeHead(403); res.end(JSON.stringify({ error: e.message })); return; }
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/inbox/:id/file?uid=xxx
  if (req.method === 'GET' && reqPath.startsWith('/api/inbox/') && reqPath.endsWith('/file')) {
    const id = reqPath.replace('/api/inbox/', '').replace('/file', '');
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const data = await supabaseQuery(`/inbox_files?id=eq.${id}&select=uid,storage_path,mime_type,filename`);
      const file = data?.[0];
      if (!file || file.uid !== uid) { res.writeHead(404); res.end(JSON.stringify({ error: 'not_found' })); return; }
      const signedUrl = await supabaseStorageSignedUrl('inbox-files', file.storage_path, 300);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: signedUrl, mime_type: file.mime_type, filename: file.filename }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /api/inbox/:id/start-shiwake
  if (req.method === 'POST' && reqPath.match(/^\/api\/inbox\/[^/]+\/start-shiwake$/)) {
    const id = reqPath.split('/')[3];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const data = await supabaseQuery(`/inbox_files?id=eq.${id}&select=uid,storage_path,mime_type,filename,status`);
        const file = data?.[0];
        if (!file || file.uid !== uid) { res.writeHead(404); res.end(JSON.stringify({ error: 'not_found' })); return; }
        if (file.status !== 'pending' && file.status !== 'failed') {
          res.writeHead(409); res.end(JSON.stringify({ error: 'already_processed' })); return;
        }
        await supabaseQuery(`/inbox_files?id=eq.${id}`, 'PATCH', { status: 'processing' });
        const signedUrl = await supabaseStorageSignedUrl('inbox-files', file.storage_path, 600);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, inbox_id: id, file: { url: signedUrl, mime_type: file.mime_type, filename: file.filename } }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // POST /api/inbox/:id/archive
  if (req.method === 'POST' && reqPath.match(/^\/api\/inbox\/[^/]+\/archive$/)) {
    const id = reqPath.split('/')[3];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        await supabaseQuery(`/inbox_files?id=eq.${id}&uid=eq.${uid}`, 'PATCH', { status: 'archived' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // POST /api/inbox/:id/done (仕訳完了後にstatus更新)
  if (req.method === 'POST' && reqPath.match(/^\/api\/inbox\/[^/]+\/done$/)) {
    const id = reqPath.split('/')[3];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid, shiwake_id } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        await supabaseQuery(`/inbox_files?id=eq.${id}&uid=eq.${uid}`, 'PATCH', {
          status: 'done',
          shiwake_id: shiwake_id || null,
          processed_at: new Date().toISOString()
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // POST /api/inbound-parse/:token → SendGrid Inbound Parse Webhook
  if (req.method === 'POST' && reqPath.startsWith('/api/inbound-parse/')) {
    const token = reqPath.replace('/api/inbound-parse/', '');
    try {
      if (token !== (process.env.INBOUND_PARSE_BASIC_AUTH || '')) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'invalid_token' }));
        return;
      }
      const { fields, files } = await parseMultipartFormData(req);
      const to = fields.to || '';
      const from = fields.from || '';
      const subject = fields.subject || '';
      const text = fields.text || null;
      const spamScore = parseFloat(fields.spam_score || '0');
      if (spamScore > 5) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ignored: 'spam' }));
        return;
      }
      const match = to.match(/^([a-z0-9]{8})@inbox\.shiwake-ai\.com/i);
      if (!match) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ignored: true })); return; }
      const localPart = match[1].toLowerCase();
      const addrData = await supabaseQuery(`/inbox_addresses?local_part=eq.${localPart}&select=uid,is_active,revoked_at`);
      const addr = addrData?.[0];
      if (!addr) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ignored: true })); return; }
      const isWithinGrace = !addr.is_active && addr.revoked_at && new Date(addr.revoked_at) > new Date();
      if (!addr.is_active && !isWithinGrace) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ignored: true })); return; }
      const uid = addr.uid;
      const featureCheck = await canUseAutoIntake(uid);
      if (!featureCheck.allowed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ignored: true })); return; }

      const workspaceId = await classifyIncomingEmail(uid, from, subject).catch(() => null);
      const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
      let savedCount = 0;
      for (const file of files) {
        if (!ALLOWED_MIME.includes(file.mimetype)) continue;
        const inboxFileId = crypto.randomUUID();
        const storagePath = `${uid}/${inboxFileId}/${file.originalname}`;
        try {
          await supabaseStorageUpload('inbox-files', storagePath, file.buffer, file.mimetype);
          const messageId = (fields.headers || '').match(/Message-ID:\s*(<[^>]+>)/i)?.[1] || null;
          await supabaseQuery('/inbox_files', 'POST', {
            id: inboxFileId, uid, source: 'email', source_id: messageId,
            sender: from, filename: file.originalname, mime_type: file.mimetype,
            byte_size: file.size, storage_path: storagePath, status: 'pending', email_body: text,
            workspace_id: workspaceId
          });
          savedCount++;
        } catch(e) { console.error('inbox email upload failed:', e.message); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, saved: savedCount }));
    } catch(e) {
      console.error('inbound-parse error:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
    return;
  }

  // GET /api/dropbox/auth-url?uid=xxx&workspace_id=yyy
  if (req.method === 'GET' && reqPath === '/api/dropbox/auth-url') {
    const qp = new URL(req.url, 'http://localhost').searchParams;
    const uid = qp.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const wsId = await resolveWorkspaceId(uid, qp.get('workspace_id'));
      if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
      const check = await canUseAutoIntake(uid);
      if (!check.allowed) { res.writeHead(403); res.end(JSON.stringify({ error: check.reason })); return; }
      if (!process.env.DROPBOX_APP_KEY) { res.writeHead(503); res.end(JSON.stringify({ error: 'Dropbox not configured' })); return; }
      const state = crypto.randomBytes(16).toString('hex');
      saveOAuthState(state, uid, 'dropbox', 600, wsId);
      const params = new URLSearchParams({
        client_id: process.env.DROPBOX_APP_KEY,
        response_type: 'code',
        redirect_uri: 'https://shiwake-ai.com/api/dropbox/callback',
        state,
        token_access_type: 'offline'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: `https://www.dropbox.com/oauth2/authorize?${params}` }));
    } catch(e) {
      if (e.status === 403) { res.writeHead(403); res.end(JSON.stringify({ error: e.message })); return; }
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /api/dropbox/callback
  if (req.method === 'GET' && reqPath === '/api/dropbox/callback') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const code = params.get('code');
    const state = params.get('state');
    try {
      const stateData = consumeOAuthState(state);
      if (!stateData || stateData.provider !== 'dropbox') { res.writeHead(400); res.end('invalid state'); return; }
      const uid = stateData.uid;
      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET, redirect_uri: 'https://shiwake-ai.com/api/dropbox/callback' })
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) { res.writeHead(500); res.end('token exchange failed'); return; }
      await supabaseQuery('/cloud_connections', 'POST', {
        uid, provider: 'dropbox', access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
        is_active: true, updated_at: new Date().toISOString()
      }, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
      res.writeHead(302, { Location: '/?dropbox=connected' });
      res.end();
    } catch(e) { res.writeHead(500); res.end('error: ' + e.message); }
    return;
  }

  // GET /api/dropbox/webhook → Dropbox verification challenge
  if (req.method === 'GET' && reqPath === '/api/dropbox/webhook') {
    const challenge = new URL(req.url, 'http://localhost').searchParams.get('challenge') || '';
    res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end(challenge);
    return;
  }

  // POST /api/dropbox/webhook → Dropbox notification
  if (req.method === 'POST' && reqPath === '/api/dropbox/webhook') {
    res.writeHead(200); res.end('OK');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { list_folder } = JSON.parse(body || '{}');
        const accountIds = list_folder?.accounts || [];
        for (const accountId of accountIds) {
          const conns = await supabaseQuery(`/cloud_connections?provider=eq.dropbox&is_active=eq.true&dropbox_account_id=eq.${accountId}&select=*`);
          for (const conn of conns || []) { syncDropboxFolder(conn).catch(e => console.error('dropbox webhook error:', e.message)); }
        }
      } catch(e) { console.error('dropbox webhook parse error:', e.message); }
    });
    return;
  }

  // POST /api/dropbox/folder → 監視フォルダ設定
  if (req.method === 'POST' && reqPath === '/api/dropbox/folder') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid, path: folderPath, workspace_id } = JSON.parse(body);
        if (!uid || !folderPath || !folderPath.startsWith('/')) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_path' })); return; }
        let wsId;
        try { wsId = await resolveWorkspaceId(uid, workspace_id); } catch(e) { handleWsError(e, res); return; }
        if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
        const wsFilter = wsId ? `&workspace_id=eq.${wsId}` : '';
        await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.dropbox&is_active=eq.true${wsFilter}`, 'PATCH', { watched_path: folderPath, watched_path_label: folderPath, cursor: null, updated_at: new Date().toISOString() });
        const connData = await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.dropbox&is_active=eq.true${wsFilter}&select=*`);
        if (connData?.[0]) syncDropboxFolder(connData[0]).catch(e => console.error('initial dropbox sync failed:', e.message));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // DELETE /api/dropbox/connection
  if (req.method === 'DELETE' && reqPath === '/api/dropbox/connection') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const connData = await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.dropbox&is_active=eq.true&select=access_token`);
        const conn = connData?.[0];
        if (conn?.access_token) {
          await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: `Bearer ${conn.access_token}` } }).catch(() => {});
        }
        await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.dropbox&is_active=eq.true`, 'PATCH', { is_active: false });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // GET /api/gdrive/info?uid=xxx&workspace_id=yyy → サービスアカウントメール取得
  if (req.method === 'GET' && reqPath === '/api/gdrive/info') {
    const qp = new URL(req.url, 'http://localhost').searchParams;
    const uid = qp.get('uid');
    // workspace_id 受け取り: uid がある場合のみ検証(静的情報なので uid なしでも返す)
    if (uid && qp.get('workspace_id')) {
      try { await resolveWorkspaceId(uid, qp.get('workspace_id')); } catch(e) { handleWsError(e, res); return; }
    }
    let serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
    if (!serviceAccountEmail) {
      try {
        const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
        serviceAccountEmail = sa.client_email || '';
      } catch(e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ serviceAccountEmail }));
    return;
  }

  // POST /api/gdrive/connect
  if (req.method === 'POST' && reqPath === '/api/gdrive/connect') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid, folder_id, workspace_id } = JSON.parse(body);
        if (!uid || !folder_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid and folder_id required' })); return; }
        let wsId;
        try { wsId = await resolveWorkspaceId(uid, workspace_id); } catch(e) { handleWsError(e, res); return; }
        if (!wsId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'workspace_id is required' })); return; }
        const check = await canUseAutoIntake(uid);
        if (!check.allowed) { res.writeHead(403); res.end(JSON.stringify({ error: check.reason })); return; }
        let drive;
        try { drive = getDriveClient(); } catch(e) { res.writeHead(503); res.end(JSON.stringify({ error: e.message })); return; }
        const meta = await drive.files.get({ fileId: folder_id, fields: 'id, name, mimeType' });
        if (meta.data.mimeType !== 'application/vnd.google-apps.folder') { res.writeHead(400); res.end(JSON.stringify({ error: 'not_a_folder' })); return; }
        await supabaseQuery('/cloud_connections', 'POST', {
          uid, provider: 'gdrive', access_token: 'service_account',
          workspace_id: wsId,
          watched_path: folder_id, watched_path_label: meta.data.name,
          is_active: true, updated_at: new Date().toISOString()
        }, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
        setupGDriveWatch(uid, folder_id).catch(e => console.error('gdrive watch setup failed:', e.message));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, folder_name: meta.data.name }));
      } catch(e) {
        console.error('gdrive connect failed:', e.message);
        res.writeHead(403); res.end(JSON.stringify({ error: 'access_denied', message: 'shiwake-ai のサービスアカウントにフォルダが共有されていない可能性があります。' }));
      }
    });
    return;
  }

  // POST /api/gdrive/webhook → GDrive Push通知
  if (req.method === 'POST' && reqPath === '/api/gdrive/webhook') {
    const token = req.headers['x-goog-channel-token'];
    if (token !== (process.env.GOOGLE_DRIVE_PUSH_TOKEN || '')) { res.writeHead(403); res.end(); return; }
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    res.writeHead(200); res.end();
    if (resourceState === 'sync') return;
    supabaseQuery(`/cloud_connections?channel_id=eq.${channelId}&is_active=eq.true&select=*`)
      .then(data => { if (data?.[0]) syncGDriveFolder(data[0]).catch(e => console.error('gdrive sync error:', e.message)); })
      .catch(e => console.error('gdrive webhook error:', e.message));
    return;
  }

  // DELETE /api/gdrive/connection
  if (req.method === 'DELETE' && reqPath === '/api/gdrive/connection') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const connData = await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.gdrive&is_active=eq.true&select=*`);
        const conn = connData?.[0];
        if (conn?.channel_id) {
          try {
            const drive = getDriveClient();
            await drive.channels.stop({ requestBody: { id: conn.channel_id, resourceId: conn.watched_path } }).catch(() => {});
          } catch(e) { /* getDriveClient失敗時も無視 */ }
        }
        await supabaseQuery(`/cloud_connections?uid=eq.${uid}&provider=eq.gdrive&is_active=eq.true`, 'PATCH', { is_active: false });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // ===== v2.3.1: 信頼度メトリクス =====

  // POST /api/shiwake/approve → 仕訳の永続保存 + 信頼度再計算トリガー
  if (req.method === 'POST' && reqPath === '/api/shiwake/approve') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, workspace_id, session_id, record } = JSON.parse(body);
        if (!uid || !record) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'uid and record required' }));
          return;
        }

        // workspace_id が未指定なら default を使用
        const wsId = workspace_id || await ensureDefaultWorkspace(uid);

        // ワークスペース所有者確認
        const ws = await supabaseQuery(
          `/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=id`
        );
        if (!ws || !ws[0]) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }

        // 差分計算
        const ai = record.ai_proposed || {};
        const modifiedFields = [];
        if (record.debit_account !== ai.debit_account) modifiedFields.push('debit_account');
        if (record.credit_account !== ai.credit_account) modifiedFields.push('credit_account');
        if (record.tax_category !== ai.tax_category) modifiedFields.push('tax_category');
        if (record.memo !== ai.memo) modifiedFields.push('memo');
        const wasModified = modifiedFields.length > 0;

        const id = crypto.randomUUID();
        await supabaseQuery('/shiwake_records', 'POST', {
          id,
          uid,
          workspace_id: wsId,
          shiwake_date: record.shiwake_date || null,
          partner_name: record.partner_name || null,
          debit_account: record.debit_account || null,
          credit_account: record.credit_account || null,
          tax_category: record.tax_category || null,
          amount: record.amount || null,
          memo: record.memo || null,
          invoice_number: record.invoice_number || null,
          ai_proposed_debit_account: ai.debit_account || null,
          ai_proposed_credit_account: ai.credit_account || null,
          ai_proposed_tax_category: ai.tax_category || null,
          ai_proposed_memo: ai.memo || null,
          was_modified: wasModified,
          modified_fields: wasModified ? modifiedFields : null,
          matched_master_key: record.matched_master_key || null,
          master_hit_method: record.master_hit_method || null,
          source_session_id: session_id || null,
          source_file_name: record.source_file_name || null,
          approved_at: new Date().toISOString()
        });

        // 信頼度メトリクス再計算（非同期）
        recalculateTrustMetrics(wsId).catch(e => console.warn('trust metrics error:', e.message));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          record_id: id,
          was_modified: wasModified,
          modified_fields: wasModified ? modifiedFields : null
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/trust-metrics?uid=xxx&workspace_id=yyy
  if (req.method === 'GET' && reqPath === '/api/trust-metrics') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const uid = params.get('uid');
    const workspaceId = params.get('workspace_id');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const wsId = workspaceId || await ensureDefaultWorkspace(uid);

      const metrics = await supabaseQuery(
        `/workspace_trust_metrics?workspace_id=eq.${wsId}&select=*`
      );
      const m = metrics?.[0];

      if (!m) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          workspace_id: wsId,
          total_approved: 0,
          trust_score_status: 'insufficient_data',
          remaining_to_threshold: 30,
          message: '信頼度を表示するには、あと30件の承認が必要です。',
          maturity_level: 'rookie'
        }));
        return;
      }

      if (m.total_approved < 30) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          workspace_id: wsId,
          total_approved: m.total_approved,
          trust_score_status: 'insufficient_data',
          remaining_to_threshold: 30 - m.total_approved,
          message: `信頼度を表示するには、あと${30 - m.total_approved}件の承認が必要です。`,
          maturity_level: m.maturity_level
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        workspace_id: wsId,
        total_approved: m.total_approved,
        total_modified: m.total_modified,
        trust_score_all: m.trust_score_all,
        trust_score_recent: m.trust_score_recent,
        field_accuracy_recent: m.field_accuracy_recent,
        modification_trend_recent: m.modification_trend_recent,
        master_count: m.master_count,
        master_hit_rate: m.master_hit_rate,
        maturity_level: m.maturity_level,
        last_calculated_at: m.last_calculated_at
      }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ===== v2.3.2 Group 4-B: ワークスペース管理 API(CRUD 系) =====

  // POST /api/workspaces → 新規ワークスペース作成
  if (req.method === 'POST' && reqPath === '/api/workspaces') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, name, slug, color, icon } = JSON.parse(body);
        if (!uid || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid and name required' })); return; }
        // 上限チェック(§8.3: getWorkspaceLimit による動的上限)
        const [wsLimit, existing] = await Promise.all([
          getWorkspaceLimit(uid),
          supabaseQuery(`/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&select=id`)
        ]);
        const currentCount = (existing || []).length;
        if (currentCount >= wsLimit) {
          res.writeHead(400); res.end(JSON.stringify({
            error: 'workspace_limit_exceeded',
            current_count: currentCount,
            limit: wsLimit,
            upgrade_url: '/pricing#workspace-option'
          })); return;
        }
        // slug 重複チェック
        if (slug) {
          const dup = await supabaseQuery(`/workspaces?owner_uid=eq.${uid}&slug=eq.${encodeURIComponent(slug)}&select=id`);
          if (dup && dup.length > 0) { res.writeHead(409); res.end(JSON.stringify({ error: 'slug already in use' })); return; }
        }
        const wsId = crypto.randomUUID();
        const created = await supabaseQuery('/workspaces', 'POST', {
          id: wsId, owner_uid: uid, name,
          slug: slug || null, color: color || null, icon: icon || null,
          is_default: false, is_archived: false
        }, { 'Prefer': 'return=representation' });
        const w = created?.[0] || { id: wsId, owner_uid: uid, name, slug: slug || null, color: color || null, icon: icon || null, is_default: false, is_archived: false };
        const stats = await buildWorkspaceStats(wsId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...w, stats }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // POST /api/workspaces/:id/archive → アーカイブ(論理削除)
  if (req.method === 'POST' && reqPath.startsWith('/api/workspaces/') && reqPath.endsWith('/archive')) {
    const wsId = reqPath.slice('/api/workspaces/'.length, -'/archive'.length);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=*`);
        if (!ws || ws.length === 0) { res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return; }
        if (ws[0].is_default) { res.writeHead(400); res.end(JSON.stringify({ error: 'cannot archive default workspace' })); return; }
        await supabaseQuery(`/workspaces?id=eq.${wsId}`, 'PATCH', { is_archived: true, updated_at: new Date().toISOString() });
        // current_workspace_id が archive 対象なら default WS(または最古の非 archive)に切り替え
        const userData = await supabaseQuery(`/users?id=eq.${uid}&select=current_workspace_id`);
        let newCurrentWsId = userData?.[0]?.current_workspace_id;
        if (newCurrentWsId === wsId) {
          const others = await supabaseQuery(
            `/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&id=neq.${wsId}&select=id,is_default&order=is_default.desc,created_at.asc&limit=1`
          );
          newCurrentWsId = others?.[0]?.id || null;
          if (newCurrentWsId) await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { current_workspace_id: newCurrentWsId });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, current_workspace_id: newCurrentWsId }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // POST /api/workspaces/:id/restore → アーカイブ解除(復元)
  if (req.method === 'POST' && reqPath.startsWith('/api/workspaces/') && reqPath.endsWith('/restore')) {
    const wsId = reqPath.slice('/api/workspaces/'.length, -'/restore'.length);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=*`);
        if (!ws || ws.length === 0) { res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return; }
        if (!ws[0].is_archived) { res.writeHead(400); res.end(JSON.stringify({ error: 'workspace is not archived' })); return; }
        // 上限チェック(§8.4: 復元で上限超過する場合は拒否)
        const [wsLimit, activeWs] = await Promise.all([
          getWorkspaceLimit(uid),
          supabaseQuery(`/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&select=id`)
        ]);
        const currentCount = (activeWs || []).length;
        if (currentCount >= wsLimit) {
          res.writeHead(400); res.end(JSON.stringify({
            error: 'workspace_limit_exceeded',
            current_count: currentCount,
            limit: wsLimit,
            upgrade_url: '/pricing#workspace-option'
          })); return;
        }
        await supabaseQuery(`/workspaces?id=eq.${wsId}`, 'PATCH', { is_archived: false, updated_at: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // DELETE /api/workspaces/:id → 完全削除
  if (req.method === 'DELETE' && /^\/api\/workspaces\/[a-zA-Z0-9_-]+$/.test(reqPath)) {
    const wsId = reqPath.slice('/api/workspaces/'.length);
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=*`);
      if (!ws || ws.length === 0) { res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return; }
      if (ws[0].is_default) { res.writeHead(400); res.end(JSON.stringify({ error: 'cannot delete default workspace' })); return; }
      // current_workspace_id が削除対象なら切り替え
      const userData = await supabaseQuery(`/users?id=eq.${uid}&select=current_workspace_id`);
      let newCurrentWsId = userData?.[0]?.current_workspace_id;
      if (newCurrentWsId === wsId) {
        const others = await supabaseQuery(
          `/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&id=neq.${wsId}&select=id,is_default&order=is_default.desc,created_at.asc&limit=1`
        );
        newCurrentWsId = others?.[0]?.id || null;
        if (newCurrentWsId) await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { current_workspace_id: newCurrentWsId });
      }
      // DB 削除(ON DELETE CASCADE)
      await supabaseQuery(`/workspaces?id=eq.${wsId}`, 'DELETE');
      // ファイル削除
      const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeWs  = wsId.replace(/[^a-zA-Z0-9_-]/g, '_');
      try { const f = path.join(__dirname, 'masters', `master_${safeUid}_${safeWs}.json`); if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) { console.warn('master delete error:', e.message); }
      try { const f = path.join(__dirname, 'hashes',  `hashes_${safeUid}_${safeWs}.json`); if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) { console.warn('hash delete error:', e.message); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, current_workspace_id: newCurrentWsId }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // PATCH /api/workspaces/:id → ワークスペース編集
  if (req.method === 'PATCH' && /^\/api\/workspaces\/[a-zA-Z0-9_-]+$/.test(reqPath)) {
    const wsId = reqPath.slice('/api/workspaces/'.length);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, name, slug, color, icon, is_archived,
                client_email_addresses, client_email_domains, subject_keywords } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=*`);
        if (!ws || ws.length === 0) { res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return; }
        // 振り分けルール配列バリデーション
        const _validateArr = (arr, label, maxLen, itemCheck) => {
          if (arr === undefined) return null;
          if (!Array.isArray(arr)) return `${label} は配列で指定してください`;
          if (arr.length > maxLen) return `${label} は最大 ${maxLen} 件です`;
          for (const item of arr) {
            if (typeof item !== 'string') return `${label} の要素は文字列で指定してください`;
            const e = itemCheck(item); if (e) return e;
          }
          return null;
        };
        const emailErr = _validateArr(client_email_addresses, 'メールアドレス', 50,
          v => /^\S+@\S+\.\S+$/.test(v) ? null : `無効なメールアドレス: ${v}`);
        if (emailErr) { res.writeHead(400); res.end(JSON.stringify({ error: emailErr })); return; }
        const domainErr = _validateArr(client_email_domains, 'ドメイン', 50,
          v => /^[^@]+\.[^@]+$/.test(v) ? null : `無効なドメイン: ${v}`);
        if (domainErr) { res.writeHead(400); res.end(JSON.stringify({ error: domainErr })); return; }
        const kwErr = _validateArr(subject_keywords, 'キーワード', 50,
          v => { const t = v.trim(); return (t.length >= 1 && t.length <= 100) ? null : 'キーワードは1〜100文字にしてください'; });
        if (kwErr) { res.writeHead(400); res.end(JSON.stringify({ error: kwErr })); return; }
        // slug 変更時は重複チェック(自分自身は除外)
        if (slug !== undefined && slug !== null) {
          const dup = await supabaseQuery(`/workspaces?owner_uid=eq.${uid}&slug=eq.${encodeURIComponent(slug)}&id=neq.${wsId}&select=id`);
          if (dup && dup.length > 0) { res.writeHead(409); res.end(JSON.stringify({ error: 'slug already in use' })); return; }
        }
        const patch = { updated_at: new Date().toISOString() };
        if (name        !== undefined) patch.name        = name;
        if (slug        !== undefined) patch.slug        = slug;
        if (color       !== undefined) patch.color       = color;
        if (icon        !== undefined) patch.icon        = icon;
        if (is_archived !== undefined) patch.is_archived = is_archived;
        if (client_email_addresses !== undefined) patch.client_email_addresses = client_email_addresses;
        if (client_email_domains   !== undefined) patch.client_email_domains   = client_email_domains;
        if (subject_keywords       !== undefined) patch.subject_keywords       = subject_keywords;
        const updated = await supabaseQuery(`/workspaces?id=eq.${wsId}`, 'PATCH', patch, { 'Prefer': 'return=representation' });
        const w = updated?.[0] || { ...ws[0], ...patch };
        const stats = await buildWorkspaceStats(wsId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...w, stats }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // ===== v2.3.2 Group 4-A: ワークスペース管理 API(読み取り系 + 切り替え) =====

  // POST /api/workspaces/check-slug → slug 重複チェック
  if (req.method === 'POST' && reqPath === '/api/workspaces/check-slug') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, slug, exclude_id } = JSON.parse(body);
        if (!uid || !slug) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid and slug required' })); return; }
        let q = `/workspaces?owner_uid=eq.${uid}&slug=eq.${encodeURIComponent(slug)}&select=id`;
        if (exclude_id) q += `&id=neq.${exclude_id}`;
        const existing = await supabaseQuery(q);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ available: !existing || existing.length === 0 }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // GET /api/workspaces?uid=xxx[&include_archived=true] → ワークスペース一覧
  if (req.method === 'GET' && reqPath === '/api/workspaces') {
    const _params = new URL(req.url, 'http://localhost').searchParams;
    const uid = _params.get('uid');
    const includeArchived = _params.get('include_archived') === 'true';
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const archiveFilter = includeArchived ? '' : '&is_archived=eq.false';
      const [workspaces, userData] = await Promise.all([
        supabaseQuery(`/workspaces?owner_uid=eq.${uid}${archiveFilter}&select=*&order=display_order.asc,created_at.asc`),
        supabaseQuery(`/users?id=eq.${uid}&select=current_workspace_id`)
      ]);
      const wsList = workspaces || [];
      const current_workspace_id = userData?.[0]?.current_workspace_id || null;
      // used は is_archived=false 件数のみ(枠の消費は実働 WS のみカウント)
      const usedCount = includeArchived ? wsList.filter(w => !w.is_archived).length : wsList.length;

      // 一括で stats 取得（workspace_trust_metrics から）
      const statsArr = await Promise.all(wsList.map(w => buildWorkspaceStats(w.id)));
      const statsMap = Object.fromEntries(wsList.map((w, i) => [w.id, statsArr[i]]));

      const result = wsList.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug || null,
        is_default: w.is_default,
        is_archived: w.is_archived || false,
        color: w.color || null,
        icon: w.icon || null,
        created_at: w.created_at,
        client_email_addresses: w.client_email_addresses || [],
        client_email_domains:   w.client_email_domains   || [],
        subject_keywords:       w.subject_keywords       || [],
        stats: statsMap[w.id]
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        workspaces: result,
        current_workspace_id,
        limit: 10,
        used: usedCount
      }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /api/workspaces/:id/switch → カレントワークスペース切り替え
  if (req.method === 'POST' && reqPath.startsWith('/api/workspaces/') && reqPath.endsWith('/switch')) {
    const wsId = reqPath.slice('/api/workspaces/'.length, -'/switch'.length);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=id`);
        if (!ws || ws.length === 0) {
          res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return;
        }
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { current_workspace_id: wsId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, current_workspace_id: wsId }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // GET /api/workspaces/:id?uid=xxx → 単一ワークスペース詳細
  if (req.method === 'GET' && /^\/api\/workspaces\/[a-zA-Z0-9_-]+$/.test(reqPath)) {
    const wsId = reqPath.slice('/api/workspaces/'.length);
    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
    try {
      const ws = await supabaseQuery(`/workspaces?id=eq.${wsId}&owner_uid=eq.${uid}&select=*`);
      if (!ws || ws.length === 0) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'workspace not found or access denied' })); return;
      }
      const w = ws[0];
      const stats = await buildWorkspaceStats(wsId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: w.id,
        name: w.name,
        slug: w.slug || null,
        is_default: w.is_default,
        is_archived: w.is_archived || false,
        color: w.color || null,
        icon: w.icon || null,
        created_at: w.created_at,
        client_email_addresses: w.client_email_addresses || [],
        client_email_domains:   w.client_email_domains   || [],
        subject_keywords:       w.subject_keywords       || [],
        stats
      }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /api/workspaces/ensure-default → ログイン済みユーザーに default ワークスペースを付与
  if (req.method === 'POST' && reqPath === '/api/workspaces/ensure-default') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid } = JSON.parse(body);
        if (!uid) { res.writeHead(400); res.end(JSON.stringify({ error: 'uid required' })); return; }
        const wsId = await ensureDefaultWorkspace(uid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workspace_id: wsId }));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // ===== v2.3.4: バグ報告 =====

  // POST /api/bug-report → バグ報告を受け取り Supabase に保存 + 管理通知
  if (req.method === 'POST' && reqPath === '/api/bug-report') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const {
          uid, workspace_id, url, user_agent, viewport,
          comment, console_logs, screenshot_base64, severity, error_info
        } = JSON.parse(body || '{}');

        if (!uid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'uid required' }));
          return;
        }

        const VALID_SEVERITIES = ['manual', 'console_error', 'js_error', 'unhandled_rejection', 'api_error'];
        if (!VALID_SEVERITIES.includes(severity)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `invalid severity: ${severity}` }));
          return;
        }

        const userCheck = await supabaseQuery(`/users?id=eq.${uid}&select=id`);
        if (!userCheck || userCheck.length === 0) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
          return;
        }

        // a) まず screenshot_path=null で INSERT → ID を取得
        const inserted = await supabaseQuery('/bug_reports', 'POST', {
          uid,
          workspace_id: workspace_id || null,
          url: url || null,
          user_agent: user_agent || null,
          viewport: viewport || null,
          comment: comment || null,
          console_logs: (console_logs || []).slice(0, 50),
          screenshot_path: null,
          severity,
          error_info: error_info || null,
        });
        const bugReport = inserted?.[0];
        if (!bugReport) throw new Error('bug_reports INSERT failed');

        // b) screenshot があれば Storage に保存 → screenshot_path を UPDATE
        let screenshotSaved = false;
        if (screenshot_base64) {
          try {
            const base64Data = screenshot_base64.replace(/^data:image\/[a-z]+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const storagePath = `${uid}/${bugReport.id}.png`;
            await supabaseStorageUpload('bug-screenshots', storagePath, imageBuffer, 'image/png');
            await supabaseQuery(`/bug_reports?id=eq.${bugReport.id}`, 'PATCH', { screenshot_path: storagePath });
            bugReport.screenshot_path = storagePath;
            screenshotSaved = true;
          } catch(e) {
            console.warn('[bug-report] screenshot upload failed:', e.message);
          }
        }

        // c) 管理通知(非同期、レスポンスを待たせない)
        sendAdminNotification(`バグ報告 [${severity}] uid=${uid.slice(0, 8)}`, {
          id: bugReport.id,
          severity,
          uid,
          workspace_id: workspace_id || null,
          url: url || null,
          user_agent: user_agent || null,
          viewport: viewport || null,
          comment: comment || null,
          error_info: error_info || null,
          console_logs_recent5: (console_logs || []).slice(-5),
          screenshot_saved: screenshotSaved,
          supabase_dashboard_hint: 'Supabase Dashboard > bug_reports テーブルで詳細確認',
        }).catch(e => console.error('[bug-report] notification error:', e.message));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: bugReport.id }));
      } catch(e) {
        console.error('[bug-report] error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  console.log(`🔑 APIキー: ${process.env.ANTHROPIC_API_KEY ? '設定済み' : '未設定'}`);
  // ハッシュキャッシュのクリーンアップ（古いエントリ・上限超過を削除）
  cleanupAllHashes();

  // v2.3.0: GDrive Watch期限延長バッチ（1日1回）
  async function refreshExpiringGDriveWatches() {
    try {
      const oneDayLater = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const conns = await supabaseQuery(`/cloud_connections?provider=eq.gdrive&is_active=eq.true&channel_expires_at=lt.${oneDayLater}&select=*`);
      for (const conn of conns || []) {
        try {
          const drive = getDriveClient();
          if (conn.channel_id) {
            await drive.channels.stop({ requestBody: { id: conn.channel_id, resourceId: conn.watched_path } }).catch(() => {});
          }
          await setupGDriveWatch(conn.uid, conn.watched_path);
        } catch(e) { console.error('refresh gdrive watch failed:', conn.uid, e.message); }
      }
    } catch(e) { console.error('refreshExpiringGDriveWatches error:', e.message); }
  }
  setInterval(refreshExpiringGDriveWatches, 24 * 60 * 60 * 1000);
});
