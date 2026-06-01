// 取引先マスタを Supabase partner_master テーブルで管理（v2.10 でJSONファイルからDB化）
// 戻り値の形は従来どおり: { [title]: { debit, credit, tax, memo } }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    `/partner_master?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=title,debit_account,credit_account,tax_category,memo`
  );
  const master = {};
  for (const r of (rows || [])) {
    master[r.title] = {
      debit: r.debit_account || '',
      credit: r.credit_account || '',
      tax: r.tax_category || '',
      memo: r.memo || ''
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
  migrateMasterFilesToDb
};
