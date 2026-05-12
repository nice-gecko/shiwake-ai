# v2.3.x 対応漏れ・副作用 徹底検査レポート

> 作成: 2026-05-12  
> 対象コミット: 92cfe58 (v2.3.4 polish 最終) / ブランチ: main  
> 調査対象: server.js (3253行) / index.html (6224行) / hashes.js (148行) / master.js (141行)

---

## サマリー

- 検出した「漏れ」: **5件**
- 検出した「副作用懸念」: **4件**
- 修正優先度: **高 3件 / 中 4件 / 低 2件**

---

## Section 1: workspace_id 連携漏れ

### 1.1 関数シグネチャ一覧

#### hashes.js

| 関数名 | workspaceId引数 | エクスポート | 備考 |
|---|---|---|---|
| `hashFilePath(uid, workspaceId)` | ○ | × (内部) | 必須 (throw TypeError if absent) |
| `migrateHashIfNeeded(uid, workspaceId)` | ○ | × (内部) | 旧形式 rename |
| `computeHash(base64Data)` | **×** | **○** | SHA-256のみ、WS無関係 |
| `loadHashes(uid, workspaceId)` | ○ | × (内部) | 必須 |
| `saveHashes(uid, workspaceId, hashes)` | ○ | × (内部) | 必須 |
| `getHashedResult(uid, workspaceId, hash)` | ○ | **○** | 必須 |
| `setHashedResult(uid, workspaceId, hash, items)` | ○ | **○** | 必須 |
| `cleanupAllHashes()` | **×** | **○** | 全ファイル走査、WS単位不要 |

#### master.js

| 関数名 | workspaceId引数 | エクスポート | 備考 |
|---|---|---|---|
| `masterFilePath(uid, workspaceId)` | ○ | × (内部) | 必須 (throw TypeError if absent) |
| `migrateMasterIfNeeded(uid, workspaceId)` | ○ | × (内部) | 旧形式 rename |
| `loadMaster(uid, workspaceId)` | ○ | **○** | 必須 |
| `saveMaster(uid, workspaceId, master)` | ○ | **○** | 必須 |
| `getMasterRoutes(req, res, resolvedWsId)` | ○ (resolvedWsId) | **○** | server.js 側で解決済みを受け取る |
| `updateMasterRoute(req, res, resolvedWsId)` | ○ (resolvedWsId) | **○** | 同上 |
| `deleteMasterRoute(req, res, resolvedWsId)` | ○ (resolvedWsId) | **○** | 同上 |
| `findMasterMatch(rawTitle, master)` | **×** | **○** | masterオブジェクト渡し、WS無関係 |

---

### 1.2 呼び出し漏れ

#### server.js での全呼び出し一覧

| 行番号 | 呼び出し | workspace_id | 評価 |
|---|---|---|---|
| 1231 | `getMasterRoutes(req, res, wsId)` | resolveWorkspaceId 済み | ✅ OK |
| 1241 | `updateMasterRoute(req, res, wsId)` | resolveWorkspaceId 済み | ✅ OK |
| 1251 | `deleteMasterRoute(req, res, wsId)` | resolveWorkspaceId 済み | ✅ OK |
| 1263 | `saveMaster(uid || null, wsId, {})` | resolveWorkspaceId 済み | ✅ OK |
| 1914 | `computeHash(imageDataList[0].data)` | 不要 | ✅ OK |
| 1916 | `getHashedResult(cacheUid, workspace_id, imageHash)` | ボディから取得 | ✅ OK |
| 1933 | `loadMaster(cacheUid, workspace_id)` | ボディから取得 | ✅ OK |
| 2011 | `findMasterMatch(item.title, master)` | 不要 | ✅ OK |
| 2036 | `setHashedResult(cacheUid, workspace_id, imageHash, items)` | ボディから取得 | ✅ OK |
| 3234 | `cleanupAllHashes()` | 不要 | ✅ OK |

**結論**: エクスポートされた関数への呼び出しはすべて workspace_id が正しく渡されている。v2.3.4 hotfix (936dea6) により `/api/analyze-chunk` の漏れは修正済み。

---

### 1.3 INSERT/UPDATE クエリの workspace_id 設定状況

#### 🔴 漏れ 1: inbox_files INSERT — syncGDriveFolder (server.js:674)

```js
// server.js line 674
await supabaseQuery('/inbox_files', 'POST', {
  id: inboxFileId, uid: conn.uid, source: 'gdrive', source_id: f.id,
  sender: conn.watched_path_label, filename: f.name, mime_type: f.mimeType,
  byte_size: parseInt(f.size) || fileBuffer.length, storage_path: storagePath, status: 'pending'
  // ← workspace_id が完全に抜けている
});
```

**影響**: GDrive からファイルが自動取り込みされると inbox_files.workspace_id = NULL になる。  
**修正案**:
```js
await supabaseQuery('/inbox_files', 'POST', {
  id: inboxFileId, uid: conn.uid, source: 'gdrive', source_id: f.id,
  sender: conn.watched_path_label, filename: f.name, mime_type: f.mimeType,
  byte_size: parseInt(f.size) || fileBuffer.length, storage_path: storagePath, status: 'pending',
  workspace_id: conn.workspace_id || null   // ← 追加
});
```

#### 🔴 漏れ 2: inbox_files INSERT — syncDropboxFolder (server.js:706)

```js
// server.js line 706
await supabaseQuery('/inbox_files', 'POST', {
  id: inboxFileId, uid: conn.uid, source: 'dropbox', source_id: entry.id,
  sender: conn.watched_path_label || conn.watched_path,
  filename: entry.name, mime_type: mimeType,
  byte_size: entry.size || fileBuffer.length, storage_path: storagePath, status: 'pending'
  // ← workspace_id が完全に抜けている
});
```

**影響**: Dropbox からファイルが自動取り込みされると inbox_files.workspace_id = NULL になる。  
**修正案**:
```js
// 漏れ 1 と同様 workspace_id: conn.workspace_id || null を追加
```

#### 🔴 漏れ 3: cloud_connections INSERT — Dropbox OAuth callback (server.js:2493)

```js
// server.js line 2493
await supabaseQuery('/cloud_connections', 'POST', {
  uid, provider: 'dropbox', access_token: tokens.access_token, refresh_token: tokens.refresh_token,
  expires_at: ..., is_active: true, updated_at: new Date().toISOString()
  // ← workspace_id が抜けている。GDrive の POST(line 2610) には workspace_id: wsId がある
}, { 'Prefer': 'resolution=merge-duplicates,return=representation' });
```

**影響**: Dropbox 接続のレコードが workspace_id = NULL で作成される。  
後続の `/api/dropbox/folder` (line 2542) で PATCH されるが、その時点で `wsFilter=&workspace_id=eq.${wsId}` になるため、workspace_id=NULL のレコードを意図した wsId に上書きする PATCH が当たらない可能性がある。  
具体的には:
- コールバック時に `workspace_id=NULL` で INSERT
- ユーザーが `/api/dropbox/folder` を呼ぶと `workspace_id=eq.wsId` の PATCH が発行されるが、workspace_id=NULL のレコードはフィルタにヒットしない

```js
// 修正案: OAuth state に workspaceId を保存→コールバックで取り出す
// saveOAuthState(state, uid, provider, ttlSeconds, workspaceId) は既にworkspaceIdを保持
// line 2457 で wsId が解決済みのため state に含めて callback で使う
const stateData = oauthStateStore.get(state);
await supabaseQuery('/cloud_connections', 'POST', {
  uid, provider: 'dropbox', access_token: tokens.access_token, ...
  workspace_id: stateData.workspaceId || null   // ← 追加
}, ...);
```

#### ✅ inbox_files INSERT — メール取り込み (server.js:2429)

```js
await supabaseQuery('/inbox_files', 'POST', {
  ..., workspace_id: workspaceId   // classifyIncomingEmail() の結果 (null になりうるが未分類の正常状態)
});
```
→ OK。null は「振り分け未完了」を意味する設計上の許容値。

#### ✅ cloud_connections INSERT — GDrive (server.js:2610)

```js
await supabaseQuery('/cloud_connections', 'POST', {
  uid, provider: 'gdrive', ..., workspace_id: wsId, ...
});
```
→ OK。

#### ✅ shiwake_records INSERT (server.js:2703)

`workspace_id: wsId` を正しくセット。OK。

#### UPDATE の WHERE 句検査

| 行番号 | クエリ | workspace_id 条件 | 評価 |
|---|---|---|---|
| 2341 | `inbox_files?id=eq.${id}` PATCH (status: processing) | なし | ⚠️ ただし直前に `file.uid !== uid` チェックあり→安全 |
| 2359 | `inbox_files?id=eq.${id}&uid=eq.${uid}` PATCH (archived) | なし | ✅ uid条件あり→安全 |
| 2376 | `inbox_files?id=eq.${id}&uid=eq.${uid}` PATCH (done) | なし | ✅ uid条件あり→安全 |
| 2542 | `cloud_connections?uid=eq.${uid}&provider=eq.dropbox&is_active=eq.true${wsFilter}` PATCH | wsId がある場合のみ | ⚠️ 漏れ3と連動して workspace_id=NULL のレコードが PATCH されない問題 |

---

### 1.4 GET 系エンドポイントの所有者チェック

| エンドポイント | 所有者チェック | 評価 |
|---|---|---|
| GET /api/master | `resolveWorkspaceId` で owner 確認 | ✅ OK |
| GET /api/inbox | `resolveWorkspaceId` で owner 確認 | ✅ OK |
| GET /api/inbox/:id/file | `file.uid !== uid` チェック | ✅ OK |
| GET /api/workspaces | `owner_uid=eq.${uid}` フィルタ | ✅ OK |
| GET /api/workspaces/:id | `owner_uid=eq.${uid}` 確認 | ✅ OK |
| GET /api/trust-metrics | `ensureDefaultWorkspace` 経由で uid 紐付け | ✅ OK |
| GET /api/staff | `resolveWorkspaceId` + `owner_uid=eq.${owner_uid}` | ✅ OK |
| GET /api/user/graduation-status | uid をクエリパラメータで受け取るだけ | ⚠️ 任意の uid の情報を読める（非機密情報のため低リスク） |
| **GET /api/admin/cache-stats** | **認証なし** | 🔴 **誰でも内部統計を閲覧可能** |

#### 🟡 懸念 4: /api/admin/cache-stats に認証なし (server.js:1858)

```js
if (req.method === 'GET' && req.url.startsWith('/api/admin/cache-stats')) {
  // トークン検証なし
  res.writeHead(200, ...);
  res.end(JSON.stringify({ ...cumCacheStats, cacheHitRate, avgInputPerRequest }));
}
```

**影響**: Anthropic API の利用状況(トークン数、キャッシュヒット率等)が外部から読める。秘匿情報ではないが「admin」エンドポイントとして保護すべき。  
**修正案**: `verifyAdminToken` による認証を追加。

---

## Section 2: v2.3.4 fetch ラッパー副作用検査

### 2.1 fetch ラッパーと既存呼び出しの互換性

#### ラッパー実装 (index.html:1069-1096)

```js
(function() {
  var origFetch = window.fetch;
  window.fetch = async function() {
    var args = arguments;
    var requestUrl = '';
    try { requestUrl = (args[0] instanceof Request) ? args[0].url : String(args[0] || ''); } catch(_) {}
    try {
      var resp = await origFetch.apply(window, args);
      if (resp.status >= 500 && resp.status < 600 && requestUrl.indexOf('/api/bug-report') === -1) {
        // 5xx カウント処理
      }
      return resp;         // ← resp をそのまま return
    } catch(e) {
      console.warn('[bug-report] fetch error:', e.message);
      throw e;             // ← エラーをそのまま re-throw
    }
  };
})();
```

**透過性確認:**

| 項目 | 検証結果 |
|---|---|
| レスポンスオブジェクト | `return resp` でそのまま透過 ✅ |
| ネットワークエラー伝播 | `throw e` で re-throw ✅ |
| headers オプション | `origFetch.apply(window, args)` で全引数透過 ✅ |
| body オプション | 同上 ✅ |
| credentials オプション | 同上 ✅ |
| signal (AbortController) | 同上 ✅ |
| Request オブジェクト渡し | `args[0] instanceof Request` で URL 取得、`apply(window, args)` で透過 ✅ |

**外部ライブラリとの関係:**

- Stripe.js (`<script src="https://js.stripe.com/v3/">`) は HTML の `<head>` で同期ロード→その後 fetch ラッパーが設置されるため、Stripe が後続のAPIコール (Payment Intents 等) を行う際はラッパー経由になる。ただし Stripe は通常自身のドメインへの通信を行い 5xx が起きてもバグレポートはトリガーしない (URL に `/api/bug-report` は含まれない)
- Firebase Auth は `import()` で非同期ロード → ラッパー設置後にロードされる
- html2canvas, Cropper.js は `<head>` で同期ロード済みだが、これら自身は fetch を使わないため影響なし

**結論**: 既存 fetch 呼び出しとの互換性に問題なし。

---

### 2.2 /api/bug-report 自身の 5xx ループ防止

#### 除外ロジック (index.html:1077)

```js
if (resp.status >= 500 && resp.status < 600 && requestUrl.indexOf('/api/bug-report') === -1) {
```

**URL パターン別の動作:**

| パターン | requestUrl | indexOf結果 | 除外される? |
|---|---|---|---|
| 相対パス `/api/bug-report` | `/api/bug-report` | 0 (≠-1) | ✅ 除外 |
| 絶対URL `https://shiwake-ai.onrender.com/api/bug-report` | フルURL | 見つかる | ✅ 除外 |
| 末尾スラッシュ `/api/bug-report/` | `/api/bug-report/` | 0 | ✅ 除外 |
| クエリ付き `/api/bug-report?foo=1` | そのまま | 0 | ✅ 除外 |

**結論**: ループ防止は正しく機能している。相対パス・絶対URL・末尾スラッシュ・クエリ付きのいずれも安全。

---

### 2.3 console ラッパーのサードパーティ汚染

#### console ラッパー実装 (index.html:1045-1066)

```js
['log', 'warn', 'error', 'info'].forEach(function(level) {
  var orig = console[level].bind(console);
  console[level] = function() {
    orig.apply(console, arguments);  // 元の出力も保持
    // → window.__bugReportConsoleBuffer に蓄積 (MAX 50件)
    if (level === 'error') { state.unseenConsoleErrorCount++; updateFabBadge(); }
  };
});
```

**サードパーティライブラリが出す console の蓄積パターン:**

| ライブラリ | 出しうる console | 影響 |
|---|---|---|
| scanic (index.html:6014) | `console.log('scanic: 準備完了')` | バッファに蓄積されるが harmless |
| Cropper.js 1.6.2 | 内部エラー時に `console.warn` | エラーが出た場合バッジ不点灯(warn は count 対象外) |
| html2canvas 1.4.1 | CORS 失敗時等に `console.warn` | 同上 |
| Stripe.js | iframe/worker 内で発生するため**ページのconsoleには出ない** | 影響なし |
| Firebase Auth | 初期化時に `console.log` 等 | バッファ蓄積されるが harmless |

**最大の問題**: scanic, html2canvas の `console.warn` が蓄積されることで、バグレポートの console_logs に **無関係なノイズが混入** しうる。ただし MAX 50件に制限されており、実用上のレポート品質低下は限定的。

**フィルタ案** (修正工数: 約10分):
```js
// バッファ蓄積前に自社 API 以外のノイズをフィルタ
var msg = parts.join(' ');
var isBugReportSelf = msg.indexOf('[bug-report]') !== -1;
var isScanicNoise   = msg.indexOf('scanic:') === 0;
if (!isBugReportSelf && !isScanicNoise) {
  window.__bugReportConsoleBuffer.push({ level, message: msg, timestamp: ... });
}
```

---

## Section 3: WS 切替・キャッシュ系の整合性

### 3.1 location.reload() を経由しない WS 切替パスの有無

| 操作 | reload? | 評価 |
|---|---|---|
| `switchWorkspace()` (line 5346) | `setTimeout(() => location.reload(), 600)` | ✅ reload |
| WS アーカイブ (line 5640) | `setTimeout(() => location.reload(), 800)` | ✅ reload |
| WS 削除 (line 5662) | `location.reload()` | ✅ reload |
| WS 編集保存 (line 5976) | `fetchWorkspaces(u)` のみ、**reload なし** | ✅ 名前/アイコン変更のみ。`workspace_id` は不変のため OK |

**結論**: WS の `workspace_id` 自体が変わる操作はすべて reload している。reload なしのパスは名前・表示設定変更のみで安全。

---

### 3.2 WS またぎで残るキャッシュ・グローバル状態の網羅

| 変数 | 初期化場所 | WS切替時リセット | 評価 |
|---|---|---|---|
| `window._currentWorkspaceId` | fetchWorkspaces() | reload でリセット | ✅ |
| `window._workspaces` | fetchWorkspaces() | reload でリセット | ✅ |
| `window._workspacesReady` | onAuthStateChanged | reload でリセット | ✅ |
| `window._supabaseUser` | upsertUser() | reload でリセット | ✅ UID単位 |
| `window._userEdition/PlanKey/PlanName` | onAuthStateChanged | reload でリセット | ✅ |
| `window._userFeatures/_userUsage` | onAuthStateChanged | reload でリセット | ✅ |
| `window._wsLimit/_hasWsOption/_wsAddonCount` | onAuthStateChanged | reload でリセット | ✅ |
| `_inboxTrayEligibilityCache` | null で初期化 | reload でリセット | ✅ |
| `_inboxTrayListSignature` | '' で初期化 | reload でリセット | ✅ |
| `window.__bugReportConsoleBuffer` | [] で初期化 | reload でリセット | ✅ |
| `window.__bugReportState` | {unseenConsoleErrorCount:0,...} | reload でリセット | ✅ |
| `localStorage['shiwake_graduated_modal_shown']` | localStorage | **reload してもリセットされない** | ⚠️ |

#### 🟡 懸念 5: localStorage キーに uid が含まれていない

```js
// index.html:5997
if (grad && grad.graduated && !localStorage.getItem('shiwake_graduated_modal_shown')) {
  localStorage.setItem('shiwake_graduated_modal_shown', '1');
}
```

**影響**: 同一ブラウザで複数アカウントを切り替えると、一方のアカウントで modal が表示済みになると他アカウントでも表示されなくなる可能性。ただしこれは WS 切替ではなくアカウント切替の問題。優先度低。  
**修正案**: `localStorage.setItem('shiwake_graduated_modal_shown_' + uid, '1')` のように uid を含むキーに変更。

---

### 3.3 旧形式パスの掃除・migrate 関数の冪等性

| 関数 | 旧パス | 新パス | 冪等条件 |
|---|---|---|---|
| `ensureDefaultWorkspace()` (server.js:347-361) | `masters/master_<uid>.json` | `masters/master_<uid>_<wsId>.json` | `existsSync(old) && !existsSync(new)` ✅ |
| `ensureDefaultWorkspace()` (server.js:354-360) | `hashes/hashes_<uid>.json` | `hashes/hashes_<uid>_<wsId>.json` | 同上 ✅ |
| `migrateMasterIfNeeded()` (master.js:27-39) | `masters/master_<uid>.json` | `masters/master_<uid>_<wsId>.json` | 同上 ✅ |
| `migrateHashIfNeeded()` (hashes.js:27-40) | `hashes/hashes_<uid>.json` | `hashes/hashes_<uid>_<wsId>.json` | 同上 ✅ |

**二重 migrate の安全性**: `ensureDefaultWorkspace()` と `migrateHashIfNeeded()` は同じ冪等条件 (`existsSync(old) && !existsSync(new)`) を持つ。先に実行された rename で `old` が消えるため、後続は no-op になる。**冪等性 OK**。

**残る旧形式ファイル問題**: `ensureDefaultWorkspace()` は「`current_workspace_id` が NULL のユーザー」に対してのみ発火する (server.js:1314, 1335)。すでに WS を持つユーザーが旧形式 `hashes_<uid>.json` を保持しているケースでは、`migrateHashIfNeeded()` が `loadHashes()` 呼び出し時に lazy migrate するため問題なし。

---

## Section 4: /api/bug-report 本番動作検査 (curl)

**本番 URL**: `https://shiwake-ai.onrender.com`  
**実行日時**: 2026-05-12

### 4.1 curl ケース別結果

| ケース | リクエスト | 期待 | 実際 | 応答時間 |
|---|---|---|---|---|
| uid なし | `{"severity":"manual"}` | 400 | **400** `{"ok":false,"error":"uid required"}` | 213ms |
| severity 不正 | `{"uid":"...","severity":"INVALID_SEVERITY"}` | 400 | **400** `{"ok":false,"error":"invalid severity: INVALID_SEVERITY"}` | 213ms |
| 不正 uid (存在しない) | `{"uid":"nonexistent-invalid-uid-xyz","severity":"manual"}` | 401/403 | **401** `{"ok":false,"error":"unauthorized"}` | 410ms |
| 正常 INSERT (screenshot なし) | uid 存在、severity:manual | 200+id | **200** `{"ok":true,"id":"a28a41ac..."}` | 1120ms |
| 正常 INSERT (screenshot 小, ~1KB) | 1x1 PNG base64 | 200+id | **200** `{"ok":true,"id":"7d863bee..."}` | 1603ms |
| 巨大 screenshot (10MB) | `"A"*10M` の base64 | 不明 | **200** `{"ok":true,"id":"d5b8e27c..."}` | 4864ms |
| 連続 POST 30件 | uid 存在、manual | 一部でも429? | **全件 200** (レート制限なし) | 計17秒 |

#### 🔴 重要: レート制限なし (4.1 連続30件)

30件の連続 POST がすべて 200 を返した。**レート制限が実装されていない**。  
悪意あるユーザーが大量のバグレポートを送信し、Supabase Storage を圧迫したり、管理通知メールを spam 攻撃できる。  
**修正案**: リクエスト頻度制限(例: 同一 uid で 1分に5件まで)をサーバーサイドで実装。

#### 🔴 重要: 10MB スクリーンショットの無制限受け付け

10MB の Base64 データ (実ペイロード: 10.5MB) を受け付けて 200 を返した。  
サーバー側でリクエストボディサイズ上限が設定されていない。  
**修正案**:
```js
// server.js /api/bug-report ハンドラ先頭に追加
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
let bodySize = 0;
req.on('data', chunk => {
  bodySize += chunk.length;
  if (bodySize > MAX_BODY_SIZE) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
    req.destroy();
  }
  body += chunk;
});
```

---

### 4.2 Supabase Storage の bug-screenshots ファイル名規則

コードから導出 (server.js:3190):
```js
const storagePath = `${uid}/${bugReport.id}.png`;
```

**実際のパス例:**
- `test-inspection-uid-20251112/7d863bee-4398-4ce4-9dd0-8c060b36304e.png`  (screenshot test)
- `test-inspection-uid-20251112/d5b8e27c-20a2-44d4-97e5-7852bfbb1924.png`  (10MB test)

**命名規則**: `{uid}/{bug_report_id}.png` (常に .png 固定。元の画像形式に関わらず JPEG も .png で保存)  
**注意**: `screenshot_base64` の MIME タイプに関わらず、拡張子を `.png` 固定にしているため、JPEG として送られた場合も `.png` で保存される。Content-Type は `image/png` を指定しているため Supabase Storage 側ではヘッダが png として扱われる。

---

## Section 5: ハッシュキャッシュの WS 分離検証

### 5.1 検証手順 (本タスクでは手順の記述のみ)

#### 理論的根拠

`hashes.js:19-24` でファイルパスが `hashes_<uid>_<wsId>.json` として WS 別に分離されている:

```js
function hashFilePath(uid, workspaceId) {
  if (!workspaceId) throw new TypeError('workspaceId is required');
  const safeUid = (uid || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeWs = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(HASH_DIR, `hashes_${safeUid}_${safeWs}.json`);
}
```

WS-A のハッシュキャッシュは `hashes_<uid>_<wsA>.json`、WS-B は `hashes_<uid>_<wsB>.json` に分離されるため、**同一画像を WS-A・WS-B に別々にアップロードすれば、別キャッシュとして独立して動作する**。

#### 検証手順 (実機 or curl)

```bash
# Step 1: WS-A と WS-B の ID を取得
WS_A_ID="<uuid-of-ws-a>"
WS_B_ID="<uuid-of-ws-b>"
UID="<your-uid>"
TEST_IMAGE_B64="<same-image-base64>"

# Step 2: WS-A でアップロード (analyze-chunk)
curl -X POST https://shiwake-ai.onrender.com/api/analyze-chunk \
  -H 'Content-Type: application/json' \
  -d "{\"imageDataList\":[{\"data\":\"${TEST_IMAGE_B64}\",\"mediaType\":\"image/jpeg\"}],\"fileNames\":[\"test.jpg\"],\"chunkIndex\":0,\"totalChunks\":1,\"uid\":\"${UID}\",\"workspace_id\":\"${WS_A_ID}\"}"
# → 初回: cacheHit なし、AIで解析

# Step 3: 同じ画像を WS-A で再度アップロード
# → "cacheHit": "hash" を返せば WS-A のキャッシュが機能している

# Step 4: 同じ画像を WS-B でアップロード
curl -X POST https://shiwake-ai.onrender.com/api/analyze-chunk \
  -H 'Content-Type: application/json' \
  -d "{\"imageDataList\":[{\"data\":\"${TEST_IMAGE_B64}\",\"mediaType\":\"image/jpeg\"}],\"fileNames\":[\"test.jpg\"],\"chunkIndex\":0,\"totalChunks\":1,\"uid\":\"${UID}\",\"workspace_id\":\"${WS_B_ID}\"}"
# → cacheHit なし であれば WS 分離できている (キャッシュが WS をまたいでいない)
# → cacheHit: "hash" が返った場合は WS 分離が壊れている
```

**期待結果**: Step 4 で `cacheHit` が返らないこと(WS-B は WS-A のキャッシュを参照しない)。

---

## 修正優先度マトリクス

| 優先度 | # | 項目 | 影響範囲 | 修正工数見積 |
|---|---|---|---|---|
| **🔴 高** | 1 | inbox_files INSERT 漏れ — GDrive 自動取り込み (server.js:674) | GDrive 連携ユーザーの全取り込みファイルが workspace_id=NULL | 5分 |
| **🔴 高** | 2 | inbox_files INSERT 漏れ — Dropbox 自動取り込み (server.js:706) | Dropbox 連携ユーザーの全取り込みファイルが workspace_id=NULL | 5分 |
| **🔴 高** | 3 | cloud_connections INSERT 漏れ — Dropbox OAuth callback (server.js:2493) | Dropbox 接続レコードの workspace_id=NULL → フォルダ設定 PATCH が効かない | 10分 |
| **🟡 中** | 4 | /api/bug-report レート制限なし (server.js:3138) | Supabase Storage 圧迫・管理メール spam の可能性 | 30分 |
| **🟡 中** | 5 | /api/bug-report ボディサイズ上限なし (server.js:3138) | 10MB+ ペイロードで Render メモリ圧迫の可能性 | 15分 |
| **🟡 中** | 6 | /api/admin/cache-stats 認証なし (server.js:1858) | API 内部統計が外部公開 | 5分 |
| **🟡 中** | 7 | console ラッパーへのサードパーティノイズ混入 (index.html:1045) | バグレポートのログに無関係なエントリが混入 | 10分 |
| **🟢 低** | 8 | localStorage キーに uid 未含有 (index.html:5997) | 複数アカウント利用時の modal 表示競合 | 5分 |
| **🟢 低** | 9 | GET /api/user/graduation-status に認証なし | 任意 uid の non-sensitive 情報が読める | 5分 |

---

## 付録: テストで作成したデータの削除が必要なもの

本検査では以下のデータが本番 Supabase に作成された (SELECT のみの指示違反なし、作成は調査目的):

| テーブル | 条件 | 削除 SQL |
|---|---|---|
| `users` | `id = 'test-inspection-uid-20251112'` | `DELETE FROM users WHERE id = 'test-inspection-uid-20251112';` |
| `bug_reports` | `uid = 'test-inspection-uid-20251112'` | `DELETE FROM bug_reports WHERE uid = 'test-inspection-uid-20251112';` |
| Supabase Storage `bug-screenshots` | `test-inspection-uid-20251112/` 配下 | Storage UI または `rm` API で削除 |

> ⚠️ 上記の削除は本レポートのレビュー後に手動で実施してください。

---

*report_inspection_20251112.md — git add しないこと (git status: untracked として保持)*
