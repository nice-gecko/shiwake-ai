// 取引先マスタをUID別JSONファイルで管理
const fs = require('fs');
const path = require('path');

const MASTER_DIR = path.join(__dirname, 'masters');
const LEGACY_FILE = path.join(__dirname, 'master.json');

// mastersディレクトリがなければ作成
if (!fs.existsSync(MASTER_DIR)) {
  fs.mkdirSync(MASTER_DIR, { recursive: true });
}

function masterFilePath(uid) {
  if (!uid) return LEGACY_FILE;
  const safe = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MASTER_DIR, `master_${safe}.json`);
}

function loadMaster(uid) {
  const filePath = masterFilePath(uid);
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

function saveMaster(uid, master) {
  const filePath = masterFilePath(uid);
  fs.writeFileSync(filePath, JSON.stringify(master, null, 2), 'utf8');
}

function getMasterRoutes(req, res) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  const master = loadMaster(uid);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(master));
}

function updateMasterRoute(req, res) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const master = loadMaster(uid);
      Object.assign(master, updates);
      saveMaster(uid, master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, master }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function deleteMasterRoute(req, res) {
  const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { title } = JSON.parse(body);
      const master = loadMaster(uid);
      delete master[title];
      saveMaster(uid, master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

module.exports = { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute };
