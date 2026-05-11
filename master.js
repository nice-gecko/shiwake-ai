// 取引先マスタをUID別JSONファイルで管理
const fs = require('fs');
const path = require('path');

const MASTER_DIR = path.join(__dirname, 'masters');
const LEGACY_FILE = path.join(__dirname, 'master.json');

// mastersディレクトリがなければ作成
if (!fs.existsSync(MASTER_DIR)) {
  fs.mkdirSync(MASTER_DIR, { recursive: true });
}

function masterFilePath(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  if (!uid) return LEGACY_FILE;
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeWs = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MASTER_DIR, `master_${safeUid}_${safeWs}.json`);
}

// 旧パス(masters/master_<uid>.json)が存在する場合、新パスへ自動 rename
function migrateMasterIfNeeded(uid, workspaceId) {
  if (!uid || !workspaceId) return;
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const oldPath = path.join(MASTER_DIR, `master_${safeUid}.json`);
  const newPath = masterFilePath(uid, workspaceId);
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`マスタファイルをマイグレーション: master_${safeUid}.json → master_${safeUid}_${workspaceId}.json`);
    } catch(e) {
      console.warn('master migration error:', e.message);
    }
  }
}

function loadMaster(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  migrateMasterIfNeeded(uid, workspaceId);
  const filePath = masterFilePath(uid, workspaceId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    // UID別ファイルなし → レガシーファイルをフォールバック
    if (uid && fs.existsSync(LEGACY_FILE)) {
      return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveMaster(uid, workspaceId, master) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  const filePath = masterFilePath(uid, workspaceId);
  fs.writeFileSync(filePath, JSON.stringify(master, null, 2), 'utf8');
}

function getMasterRoutes(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  const master = loadMaster(uid, workspaceId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(master));
}

function updateMasterRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const master = loadMaster(uid, workspaceId);
      Object.assign(master, updates);
      saveMaster(uid, workspaceId, master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, master }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function deleteMasterRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'workspace_id is required' }));
    return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { title } = JSON.parse(body);
      const master = loadMaster(uid, workspaceId);
      delete master[title];
      saveMaster(uid, workspaceId, master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// 戻り値: { matched_id, debit_account, method: 'exact'|'partial'|null }
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

module.exports = { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute, findMasterMatch };
