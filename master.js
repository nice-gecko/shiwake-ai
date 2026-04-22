// 取引先マスタをJSONファイルで管理
const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.join(__dirname, 'master.json');

function loadMaster() {
  try {
    if (fs.existsSync(MASTER_FILE)) {
      return JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveMaster(master) {
  fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2), 'utf8');
}

function getMasterRoutes(req, res) {
  const master = loadMaster();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(master));
}

function updateMasterRoute(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const master = loadMaster();
      Object.assign(master, updates);
      saveMaster(master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, master }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function deleteMasterRoute(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { title } = JSON.parse(body);
      const master = loadMaster();
      delete master[title];
      saveMaster(master);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

module.exports = { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute };
