const http = require('http');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute } = require('./master');
const { getSession, appendToSession, saveSession, deleteSession } = require('./session');

// Stripe設定
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PLANS = {
  light:        { price_id: 'price_1TQjqc2ZetSuudnL00xEQgQs', name: 'ライト',             limit: 100 },
  unlimited:    { price_id: 'price_1TQlsh2ZetSuudnLlgDUN35b', name: 'アンリミテッド',     limit: null },
  agency_light: { price_id: 'price_1TQlwT2ZetSuudnL4cxHabfQ', name: '代理店ライト',       limit: null, seats: 10 },
  agency_std:   { price_id: 'price_1TQlxt2ZetSuudnLIzU5Auw7', name: '代理店スタンダード', limit: null, seats: 30 },
  agency_prem:  { price_id: 'price_1TQlzN2ZetSuudnLbtzI77fc', name: '代理店プレミアム',   limit: null, seats: 60 },
};
const STRIPE_SUCCESS_URL = 'https://shiwake-ai.onrender.com/?payment=success';
const STRIPE_CANCEL_URL = 'https://shiwake-ai.onrender.com/?payment=cancel';

async function stripeRequest(path, method='GET', body=null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  if (body) opts.body = new URLSearchParams(body).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data;
}

// Supabase設定（サーバー側はSecret keyを使用）
const SUPABASE_URL = 'https://tmddairlgpyinqfekkfg.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

async function supabaseQuery(path, method='GET', body=null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SECRET_KEY,
      'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
      'Prefer': 'return=representation'
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

const PORT = process.env.PORT || 3456;

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const SYSTEM = `あなたは日本の会計仕訳の専門家であり、OCRの専門家でもあります。証憑画像（レシート・領収書・手書き領収書・銀行通帳など）を分析し、弥生会計の勘定科目体系に従って仕訳を生成してください。

【画像読み取りのガイドライン】
- 手書き文字は文脈から推測して読み取ってください
- 崩し字・略字も可能な限り解読してください
- 金額は「¥」「円」「,」の有無に関わらず数値として読み取ってください
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
- タクシー・電車・バス・ETC・交通系 → 借方「旅費交通費」
- ガス・電気・水道 → 借方「水道光熱費」
- 携帯・通信・インターネット → 借方「通信費」
- Amazon・楽天・通販サイト → 借方「消耗品費」

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

【インボイス登録番号の抽出】
- 「T」で始まる13桁の数字（例：T1234567890123）を必ず探してください
- 見つかった場合はinvoice_numberフィールドに記載してください
- 見つからない場合はinvoice_numberを空文字にしてください

【税区分の判定ルール - 厳守】
- 「非」「非課税」「非課」の記載がある → 必ず「非課税」
- 「不課税」「対象外」の記載がある → 必ず「不課税」
- 「軽減」「8%」「食品」「飲食料品」の記載がある → 「課税仕入(8%軽減)」
- 上記以外 → 「課税仕入(10%)」

【重複の防止 - 厳守】
- 同じ日付・同じ店名・同じ金額の組み合わせは1件のみ出力してください
- 合計行と明細行が両方ある場合は明細行のみ出力してください
- 「小計」「合計」「総合計」行は出力しないでください

返答はJSON配列のみ。説明文・バッククォート・マークダウン記法は絶対に含めないでください。
[{"title":"取引先名","date":"YYYY/MM/DD","amount":"¥X,XXX","debit":"借方科目","credit":"貸方科目","tax":"課税仕入(10%)|課税仕入(8%軽減)|非課税|不課税","memo":"摘要","invoice_number":"T1234567890123または空文字","confidence":"high|mid|low","reason":"根拠50字以内"}]`;

async function callClaudeOnce(apiKey, content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
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

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  // ===== マスタAPI =====
  if (req.method === 'GET' && req.url === '/api/master') { getMasterRoutes(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/master') { updateMasterRoute(req, res); return; }
  if (req.method === 'DELETE' && req.url === '/api/master') { deleteMasterRoute(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/master/clear') {
    saveMaster({});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    console.log('マスタをクリアしました');
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
        // upsert（存在すれば更新、なければ挿入）
        const data = await supabaseQuery(
          '/users?on_conflict=id',
          'POST',
          { id: uid, email, display_name: display_name || email }
        );
        console.log(`ユーザーupsert: ${email}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, user: data?.[0] || null }));
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: data?.[0] || null }));
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/user/count → 月次処理件数を加算
  if (req.method === 'POST' && req.url === '/api/user/count') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { uid, amount } = JSON.parse(body);
        // 現在の件数を取得してから加算
        const current = await supabaseQuery(`/users?id=eq.${uid}&select=monthly_count`);
        const cur = current?.[0]?.monthly_count || 0;
        await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', { monthly_count: cur + (amount || 1) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, monthly_count: cur + (amount || 1) }));
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
          'line_items[0][price]': plan.price_id,
          'line_items[0][quantity]': '1',
          success_url: STRIPE_SUCCESS_URL,
          cancel_url: STRIPE_CANCEL_URL,
          'metadata[firebase_uid]': uid,
          'metadata[plan_key]': plan_key || 'light',
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
          if (uid) {
            await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
              is_paid: true,
              is_free_trial: false,
              stripe_customer_id: customerId,
              paid_at: new Date().toISOString()
            });
            console.log(`有料会員に更新: ${uid}`);
          }
        }
        if (event.type === 'customer.subscription.deleted') {
          const customerId = event.data.object.customer;
          await supabaseQuery(`/users?stripe_customer_id=eq.${customerId}`, 'PATCH', {
            is_paid: false
          });
          console.log(`サブスク解約: ${customerId}`);
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
  if (req.method === 'POST' && req.url === '/api/split-pdf') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { data, fileName } = JSON.parse(body);
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
        const { imageDataList, fileNames, chunkIndex, totalChunks } = JSON.parse(body);
        const apiKey = process.env.ANTHROPIC_API_KEY || '';
        if (!apiKey) throw new Error('APIキーが設定されていません');

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

        const rawItems = await callClaude(apiKey, content);
        const master = loadMaster();

        const EXCLUDE_TITLES = ['ETC', 'ETCカード', 'ETCカード利用分', 'ETC利用分'];
        const EXCLUDE_MEMOS = ['ETCカード利用分', 'ETC利用分', 'カード利用分'];
        const items = rawItems
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
            const rule = master[item.title];
            if (rule) {
              return { ...item, debit: rule.debit, credit: rule.credit, tax: rule.tax, masterApplied: true };
            }
            return item;
          });

        console.log(`チャンク ${chunkIndex+1}/${totalChunks}: ${rawItems.length}件取得 → ${items.length}件（マスタ${Object.keys(master).length}件適用）`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));
      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  console.log(`🔑 APIキー: ${process.env.ANTHROPIC_API_KEY ? '設定済み' : '未設定'}`);
});
