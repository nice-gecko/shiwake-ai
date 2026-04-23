const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'sessions.json');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveSessions(data) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function cleanExpired(sessions) {
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].updatedAt > SESSION_TTL_MS) {
      delete sessions[id];
      changed = true;
    }
  }
  if (changed) saveSessions(sessions);
  return sessions;
}

// セッション取得
function getSession(sessionId) {
  const sessions = cleanExpired(loadSessions());
  return sessions[sessionId] || null;
}

// 仕訳をセッションに追加（既存に追記）
function appendToSession(sessionId, items) {
  const sessions = loadSessions();
  if (!sessions[sessionId]) {
    sessions[sessionId] = { items: [], updatedAt: Date.now() };
  }
  sessions[sessionId].items = sessions[sessionId].items.concat(items);
  sessions[sessionId].updatedAt = Date.now();
  saveSessions(sessions);
  return sessions[sessionId];
}

// セッション全体を上書き保存（承認状態など同期用）
function saveSession(sessionId, items) {
  const sessions = loadSessions();
  sessions[sessionId] = { items, updatedAt: Date.now() };
  saveSessions(sessions);
  return sessions[sessionId];
}

// セッション削除
function deleteSession(sessionId) {
  const sessions = loadSessions();
  delete sessions[sessionId];
  saveSessions(sessions);
}

module.exports = { getSession, appendToSession, saveSession, deleteSession };
