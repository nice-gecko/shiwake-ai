// 画像ハッシュキャッシュをUID別JSONファイルで管理
// 同じ画像が再アップロードされた場合、過去の仕訳結果を返してAPIコストを削減する
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HASH_DIR = path.join(__dirname, 'hashes');

// 設定値
const TTL_DAYS = 30;                   // 30日経過で自動削除
const MAX_ENTRIES_PER_USER = 1000;     // 1ユーザーあたり最大件数
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

// hashesディレクトリがなければ作成
if (!fs.existsSync(HASH_DIR)) {
  fs.mkdirSync(HASH_DIR, { recursive: true });
}

function hashFilePath(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  const safeUid = (uid || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeWs = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HASH_DIR, `hashes_${safeUid}_${safeWs}.json`);
}

// 旧パス(hashes/hashes_<uid>.json)が存在する場合、新パスへ自動 rename
function migrateHashIfNeeded(uid, workspaceId) {
  if (!uid || !workspaceId) return;
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const oldPath = path.join(HASH_DIR, `hashes_${safeUid}.json`);
  const newPath = hashFilePath(uid, workspaceId);
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`ハッシュキャッシュをマイグレーション: hashes_${safeUid}.json → hashes_${safeUid}_${workspaceId}.json`);
    } catch(e) {
      console.warn('hashes migration error:', e.message);
    }
  }
}

// base64画像データからハッシュを計算（SHA-256）
function computeHash(base64Data) {
  return crypto.createHash('sha256').update(base64Data).digest('hex');
}

// ワークスペース単位でハッシュキャッシュを読み込み
// 同時にTTL超過・件数超過のエントリをクリーンアップ
function loadHashes(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  migrateHashIfNeeded(uid, workspaceId);
  const filePath = hashFilePath(uid, workspaceId);
  let data = {};
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    }
  } catch(e) {
    return {};
  }
  // クリーンアップ
  const now = Date.now();
  let entries = Object.entries(data);
  // TTL超過を除外
  entries = entries.filter(([, v]) => {
    if (!v || !v.savedAt) return false;
    return (now - new Date(v.savedAt).getTime()) < TTL_MS;
  });
  // 件数超過なら古い順に削除
  if (entries.length > MAX_ENTRIES_PER_USER) {
    entries.sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));
    entries = entries.slice(0, MAX_ENTRIES_PER_USER);
  }
  return Object.fromEntries(entries);
}

function saveHashes(uid, workspaceId, hashes) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  const filePath = hashFilePath(uid, workspaceId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(hashes), 'utf8');
  } catch(e) {
    console.warn('hashes save error:', e.message);
  }
}

// ハッシュをキーにキャッシュ取得（ヒット時はitemsを返す、なければnull）
function getHashedResult(uid, workspaceId, hash) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  if (!hash) return null;
  const hashes = loadHashes(uid, workspaceId);
  const entry = hashes[hash];
  if (!entry) return null;
  // 保存と同時に書き戻して有効期限を延長（アクセス時刻を更新）
  hashes[hash] = { ...entry, lastAccessedAt: new Date().toISOString() };
  saveHashes(uid, workspaceId, hashes);
  return entry.items || null;
}

// ハッシュキャッシュに保存
function setHashedResult(uid, workspaceId, hash, items) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  if (!hash || !Array.isArray(items)) return;
  const hashes = loadHashes(uid, workspaceId);
  hashes[hash] = {
    items,
    savedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString()
  };
  saveHashes(uid, workspaceId, hashes);
}

// 起動時に全ユーザーのハッシュをクリーンアップ（古い・上限超過を削除）
function cleanupAllHashes() {
  try {
    if (!fs.existsSync(HASH_DIR)) return;
    const files = fs.readdirSync(HASH_DIR);
    let totalRemoved = 0;
    for (const file of files) {
      if (!file.startsWith('hashes_') || !file.endsWith('.json')) continue;
      const filePath = path.join(HASH_DIR, file);
      try {
        const before = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
        const beforeCount = Object.keys(before).length;
        const now = Date.now();
        let entries = Object.entries(before).filter(([, v]) => {
          if (!v || !v.savedAt) return false;
          return (now - new Date(v.savedAt).getTime()) < TTL_MS;
        });
        if (entries.length > MAX_ENTRIES_PER_USER) {
          entries.sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));
          entries = entries.slice(0, MAX_ENTRIES_PER_USER);
        }
        const after = Object.fromEntries(entries);
        const afterCount = Object.keys(after).length;
        if (afterCount !== beforeCount) {
          fs.writeFileSync(filePath, JSON.stringify(after), 'utf8');
          totalRemoved += (beforeCount - afterCount);
        }
      } catch(e) {}
    }
    if (totalRemoved > 0) console.log(`🧹 ハッシュキャッシュをクリーンアップ: ${totalRemoved}件削除`);
  } catch(e) {
    console.warn('hashes cleanup error:', e.message);
  }
}

module.exports = { computeHash, getHashedResult, setHashedResult, cleanupAllHashes };
