// 取引先マスタを Supabase partner_master テーブルで管理（v2.10 でJSONファイルからDB化）
// 戻り値の形は従来どおり: { [title]: { debit, credit, tax, memo } }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nta = require('./nta');   // v2.11.0 L2: 国税庁 法人番号Web-API クライアント

const MASTER_DIR = path.join(__dirname, 'masters');

// ===== Supabase 小ヘルパー（server.js:357 の supabaseQuery に合わせる） =====
const SUPABASE_URL = 'https://tmddairlgpyinqfekkfg.supabase.co';

async function supabaseQuery(path, method = 'GET', body = null, extraHeaders = {}) {
  const SECRET = process.env.SUPABASE_SECRET_KEY || '';
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SECRET,
      'Authorization': `Bearer ${SECRET}`,
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

// partner_master を workspace_id で読み込み、{ [title]: { debit, credit, tax, memo } } を返す。
// uid は後方互換のため引数に残すが使用しない。
async function loadMaster(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  const rows = await supabaseQuery(
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=title,debit_account,credit_account,tax_category,memo,verified_status,verified_name,corporate_number`
  );
  const master = {};
  for (const r of (rows || [])) {
    // v2.11.0 L2: verified_* はプロパティ追加のみ。戻り値の構造 {title:{debit,credit,tax,memo}} は変えない
    // （server.js の masterText 生成が rule.debit/credit/tax を参照しているため）
    master[r.title] = {
      debit: r.debit_account || '',
      credit: r.credit_account || '',
      tax: r.tax_category || '',
      memo: r.memo || '',
      verified_status: r.verified_status || null,
      verified_name: r.verified_name || null,
      corporate_number: r.corporate_number || null
    };
  }
  return master;
}

// 1件 upsert。既存行があれば値のみ更新し created_by は絶対に上書きしない。
async function upsertMaster(workspaceId, title, rule, createdBy) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  if (!title) return;
  const r = rule || {};
  const existing = await supabaseQuery(
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&title=eq.${encodeURIComponent(title)}&select=id&limit=1`
  );
  const now = new Date().toISOString();
  if (existing && existing.length > 0) {
    // 既存 → 値のみ更新（created_by は触らない）
    await supabaseQuery(
      `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&title=eq.${encodeURIComponent(title)}`,
      'PATCH',
      {
        debit_account: r.debit ?? null,
        credit_account: r.credit ?? null,
        tax_category: r.tax ?? null,
        memo: r.memo ?? null,
        updated_at: now
      },
      { 'Prefer': 'return=minimal' }
    );
  } else {
    // 新規 → INSERT（created_by を記録）
    await supabaseQuery('/partner_master', 'POST', {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      title: title,
      debit_account: r.debit ?? null,
      credit_account: r.credit ?? null,
      tax_category: r.tax ?? null,
      memo: r.memo ?? null,
      created_by: createdBy || null,
      created_at: now,
      updated_at: now
    }, { 'Prefer': 'return=minimal' });
  }
}

// 1件削除
async function deleteMaster(workspaceId, title) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  if (!title) return;
  await supabaseQuery(
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&title=eq.${encodeURIComponent(title)}`,
    'DELETE',
    null,
    { 'Prefer': 'return=minimal' }
  );
}

// WS の全行削除
async function clearMaster(workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  await supabaseQuery(
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    'DELETE',
    null,
    { 'Prefer': 'return=minimal' }
  );
}

async function getMasterRoutes(req, res, resolvedWsId) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  const workspaceId = resolvedWsId || url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  try {
    const master = await loadMaster(uid, workspaceId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(master));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function updateMasterRoute(req, res, resolvedWsId) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  const workspaceId = resolvedWsId || url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body);
      const createdBy = parsed.created_by || null;
      for (const title of Object.keys(parsed)) {
        if (title === 'created_by') continue;
        await upsertMaster(workspaceId, title, parsed[title], createdBy);
      }
      const master = await loadMaster(uid, workspaceId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, master }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function deleteMasterRoute(req, res, resolvedWsId) {
  const url = new URL(req.url, 'http://localhost');
  const workspaceId = resolvedWsId || url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { title } = JSON.parse(body);
      await deleteMaster(workspaceId, title);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ===== v2.12.0 L2: 取引先の実体確認（国税庁 法人番号Web-API・T番号による1件照会） =====
// 承認時に fire-and-forget で呼ばれる。title は絶対に書き換えない（結合キーのため）。
//   title         … partner_master のどの行を更新するかの特定に使う
//   invoiceNumber … 何を照会するかに使う（T+13桁）
// v2.11.x の名称検索は廃止（実測で機能しないことが判明。理由は nta.js 冒頭に記載）。
async function verifyPartnerName(workspaceId, title, invoiceNumber) {
  // v2.11.1 で追加したスキップ理由ログは全て維持する（原因特定に有効だったため）
  if (!workspaceId || !title) {
    console.warn(`L2skip: 引数不足 ws=${workspaceId} title="${title}"`);
    return;
  }
  if (!process.env.NTA_APP_ID) {
    console.warn('L2skip: NTA_APP_ID 未設定');
    return;
  }
  // v2.12.0: 登録番号が無い/形式不正なら API を叩かずスキップ
  const inv = (invoiceNumber == null) ? '' : String(invoiceNumber).trim();
  if (!inv) {
    console.warn(`L2skip: 登録番号なし title="${title}"`);
    return;
  }
  if (!nta.INVOICE_NUMBER_RE.test(inv)) {
    console.warn(`L2skip: 登録番号の形式不正 (T+13桁ではない) title="${title}" invoice="${inv}"`);
    return;
  }

  const rows = await supabaseQuery(
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&title=eq.${encodeURIComponent(title)}&select=id,verified_status&limit=1`
  );
  const row = rows && rows[0];
  if (!row) {
    console.warn(`L2skip: partner_master に行なし ws=${workspaceId} title="${title}"`);
    return;
  }
  if (row.verified_status) {
    // 正常動作（重複呼び出し防止）なので log レベル
    console.log(`L2skip: 既に確認済み (${row.verified_status}) title="${title}"`);
    return;
  }

  const result = await nta.verifyByInvoiceNumber(inv);
  if (!result) {
    console.warn(`L2skip: 照会スキップ（形式不正 or NTA_APP_ID 未設定） title="${title}" invoice="${inv}"`);
    return;
  }

  await supabaseQuery(
    `/partner_master?id=eq.${encodeURIComponent(row.id)}`,
    'PATCH',
    {
      corporate_number: result.corporate_number,
      verified_status: result.verified_status,
      verified_name: result.verified_name,
      verified_at: new Date().toISOString()
      // ※ title / debit_account / credit_account / tax_category / memo / created_by は触らない
    },
    { 'Prefer': 'return=minimal' }
  );

  // 成功ログ: 照会したT番号 / 判定 / 登記名 / title と登記名が異なるか
  const diff = (result.verified_name && result.verified_name !== title) ? ' ★AI読み取りと相違' : '';
  const closed = result.close_date ? ` ※閉鎖済み(${result.close_date})` : '';
  const loc = result.location ? ` ${result.location}` : '';
  console.log(
    `L2確認: "${title}" [invoice=${inv}] → ${result.verified_status}` +
    `${result.verified_name ? ` 登記名="${result.verified_name}"${loc}` : ''}` +
    `${diff}${closed}`
  );
}

// 戻り値: { matched_id, debit_account, method: 'exact'|'partial'|null }
// ※無改修（読み込んだオブジェクトに対して動く既存ロジックのまま）
function findMasterMatch(rawTitle, master) {
  if (!rawTitle || !master) return { matched_id: null, debit_account: null, method: null };
  const t = String(rawTitle).trim();
  if (!t) return { matched_id: null, debit_account: null, method: null };
  // 完全一致を最優先
  if (master[t]) return { matched_id: t, debit_account: master[t].debit || null, method: 'exact' };
  // 部分一致（長いキーから優先）
  const keys = Object.keys(master).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!key) continue;
    if (t.includes(key) || key.includes(t)) return { matched_id: key, debit_account: master[key].debit || null, method: 'partial' };
  }
  return { matched_id: null, debit_account: null, method: null };
}

// ===== 一回限りの移行: masters/master_*.json を partner_master へ投入 =====
// ファイル名末尾の uuid を workspace_id として抽出。created_by=NULL（移行分）。
// 既存行があれば created_by を保持したまま値更新（idempotent）。
async function migrateMasterFilesToDb() {
  let files = [];
  try {
    files = fs.readdirSync(MASTER_DIR).filter(f => /^master_.*\.json$/.test(f));
  } catch (e) {
    return { migrated: 0, skipped_files: [], workspaces: [] };
  }
  let migrated = 0;
  const skipped_files = [];
  const workspaces = new Set();
  for (const file of files) {
    const m = file.match(/_([0-9a-fA-F-]{36})\.json$/);
    if (!m) { skipped_files.push(file); continue; }
    const workspaceId = m[1];
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(MASTER_DIR, file), 'utf8'));
    } catch (e) {
      skipped_files.push(file);
      continue;
    }
    if (!data || typeof data !== 'object') { skipped_files.push(file); continue; }
    workspaces.add(workspaceId);
    for (const title of Object.keys(data)) {
      const rule = data[title] || {};
      await upsertMaster(workspaceId, title, {
        debit: rule.debit,
        credit: rule.credit,
        tax: rule.tax,
        memo: rule.memo
      }, null);
      migrated++;
    }
  }
  return { migrated, skipped_files, workspaces: Array.from(workspaces) };
}

module.exports = {
  loadMaster,
  upsertMaster,
  deleteMaster,
  clearMaster,
  getMasterRoutes,
  updateMasterRoute,
  deleteMasterRoute,
  findMasterMatch,
  migrateMasterFilesToDb,
  verifyPartnerName
};
