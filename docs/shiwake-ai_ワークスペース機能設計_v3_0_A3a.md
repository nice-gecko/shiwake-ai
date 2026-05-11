# shiwake-ai ワークスペース機能設計書 v3.0(A-3a)

> **本ドキュメントの位置づけ**
> 2026年5月10日作成。`shiwake-ai_設計思想_v3_0.md` で確立した税理士B2B戦略を実装するための、**マルチテナント機能(=ワークスペース機能)** の設計書。
>
> 関連: 後続で `A-3b: 信頼度メトリクス設計書`、`A-3c: 料金プラン拡張設計書` を作成予定。本書はその**土台**となる。

---

## 📌 設計の要約

| 項目 | 内容 |
|---|---|
| **方式** | ワークスペース方式(独立データ空間、Slack型) |
| **デフォルト枠** | プレミアム以上で10ワークスペース込み |
| **拡張** | 10ワークスペース単位で追加課金(料金は A-3c で確定) |
| **個人ユーザー** | 「default」ワークスペース1つを自動作成、切り替えUI非表示 |
| **顧問先スタッフ** | 当面ログイン不可(将来 Y 拡張余地あり) |
| **メール振り分け** | 自動振り分け(送信元/件名)+ 手動振り分け(未振り分けトレイ) |
| **呼称** | 日本語「ワークスペース」で統一 |

---

## 1. 設計思想

### 1.1 なぜワークスペースが必要か

shiwake-ai の戦略的ターゲットは**税理士事務所**であり、税理士は**複数の顧問先(クライアント)を担当する**。1人の税理士アカウントで:

- 顧問先A社の領収書・取引先マスタ・仕訳記録
- 顧問先B社の領収書・取引先マスタ・仕訳記録
- 顧問先C社の…

を**完全に分離して管理**する必要がある。混ざると以下の事故が起きる:

- A社の取引先マスタがB社の仕訳に適用される(摘要や勘定科目が誤る)
- A社の領収書がB社のCSVに混入する(税務調査リスク)
- A社のスタッフがB社のデータを見る(機密漏洩)

### 1.2 設計の北極星

> **「税理士アカウント=ワークスペースの管理者。各ワークスペースは独立した shiwake-ai」**

各ワークスペースは:
- 独自の取引先マスタを持つ
- 独自のハッシュキャッシュを持つ
- 独自の自動取り込み設定を持つ
- 独自のスタッフ管理を持つ
- 独自の仕訳記録を持つ

これにより、税理士は「ワークスペース切り替え=瞬時に別の事業者の経理担当になる」体験を得る。

### 1.3 個人ユーザーへの配慮

ワークスペースは税理士向け概念だが、**個人ユーザーにも(隠れた形で)適用される**:
- 個人ユーザーは「default」ワークスペース1つを自動作成
- 切り替えUIは表示されない(設定で非表示)
- 個人ユーザーは「ワークスペース」という言葉を意識しない

これにより:
- データベース構造は全員同じ(コードがシンプル)
- 個人 → 税理士へのプラン変更時、データ移行が不要(ワークスペースを増やすだけ)
- 「アカウント種別」という概念を作らずに済む

### 1.4 ブランディング上の配慮

「ワークスペース」という呼称は、税理士限定の機能と思われないよう中立的に保つ。「税理士向け」「事務所向け」のような訴求は避け、「**複数の事業を管理できます**」という拡張性として位置付ける。

---

## 2. データ構造の変更

### 2.1 新規テーブル: `workspaces`

ワークスペース自体を管理するテーブル。

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid TEXT NOT NULL,             -- 所有者(Firebase UID)
  name TEXT NOT NULL,                  -- 表示名(例: 「合同会社A商事」)
  slug TEXT,                           -- 内部識別用の短縮名(例: 「a-corp」)
  is_default BOOLEAN DEFAULT false,    -- デフォルトワークスペースか
  is_archived BOOLEAN DEFAULT false,   -- アーカイブ(論理削除)
  display_order INTEGER DEFAULT 0,     -- 表示順
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 振り分けルール用メタデータ
  client_email_domains TEXT[],         -- 自動振り分け用(例: ['a-corp.co.jp'])
  client_email_addresses TEXT[],       -- 自動振り分け用(個別アドレス)
  subject_keywords TEXT[],             -- 件名キーワード振り分け用

  -- 表示用メタデータ
  color TEXT,                          -- ワークスペースの色(UI識別用)
  icon TEXT,                           -- アイコン絵文字(例: '🏢')

  CONSTRAINT unique_owner_default UNIQUE (owner_uid, is_default)
                                       -- 1ユーザーにつきデフォルトは1つだけ
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_uid);
CREATE INDEX idx_workspaces_owner_active ON workspaces(owner_uid, is_archived);
```

### 2.2 既存テーブルへの `workspace_id` 列追加

以下のテーブル(全てSupabase上)に `workspace_id` 列を追加:

| テーブル | 内容 | NOT NULL | DEFAULT |
|---|---|---|---|
| `users` | 「現在選択中のワークスペース」を保持 | NULL可 | NULL |
| `inbox_files` | 取り込まれたメール/クラウドファイル | 必須 | - |
| `inbox_addresses` | 専用メアド | 必須 | - |
| `inbox_settings` | 自動取り込み設定 | 必須 | - |
| `shiwake_records` | 仕訳記録 | 必須 | - |
| `staff_members` | スタッフ管理 | 必須 | - |
| `cloud_connections` | Dropbox/GDrive接続 | 必須 | - |
| `oauth_tokens` | OAuth認証トークン | 必須 | - |

`users.current_workspace_id` の追加で、ユーザーが「今どのワークスペースで作業中か」を保持する(セッション切り替えで永続化)。

```sql
-- 各テーブルへの追加例
ALTER TABLE users ADD COLUMN current_workspace_id UUID;
ALTER TABLE inbox_files ADD COLUMN workspace_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE inbox_addresses ADD COLUMN workspace_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
-- ... 以下同様

-- 外部キー制約
ALTER TABLE inbox_files ADD CONSTRAINT fk_workspace
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
-- ... 以下同様

-- インデックス(検索高速化)
CREATE INDEX idx_inbox_files_workspace ON inbox_files(workspace_id);
CREATE INDEX idx_shiwake_records_workspace ON shiwake_records(workspace_id);
-- ... 以下同様
```

### 2.3 ファイルベース管理の変更

`master.js`、`hashes.js` のファイル命名規則を変更:

#### 旧設計
```
masters/master_<uid>.json
hashes/hashes_<uid>.json
```

#### 新設計
```
masters/master_<uid>_<workspace_id>.json
hashes/hashes_<uid>_<workspace_id>.json
```

理由: ワークスペース単位でファイルを分離(マスタ・ハッシュとも独立)。

#### マイグレーション
既存の `master_<uid>.json` は、その uid の `default` ワークスペースに属するとみなして renameする:

```bash
# 例
master_abc123.json → master_abc123_<default_workspace_uuid>.json
hashes_abc123.json → hashes_abc123_<default_workspace_uuid>.json
```

これは初回ログイン時に自動実行(後述)。

### 2.4 Cookie/セッション管理

切り替え状態の保持方法:
- **DB保持(推奨)**: `users.current_workspace_id` に保存
  - メリット: マルチデバイス間で同期、強い永続性
  - デメリット: DB書き込みが増える
- **localStorage保持**: フロントだけで管理
  - メリット: 軽量
  - デメリット: デバイス間で同期しない、税理士はPC・スマホ両方使う

**推奨: DB保持(`users.current_workspace_id`)**

ログイン時にこの値を読み、フロントの状態に反映する。

---

## 3. 既存ユーザーのマイグレーション

### 3.1 既存ユーザーへの自動 default ワークスペース作成

現在のユーザー全員に対して、初回ログイン時(または一括バッチ)で:

1. `workspaces` テーブルに `is_default=true` のワークスペースを1つ作成
   - `name`: ユーザーの表示名 or 「マイワークスペース」
   - `owner_uid`: Firebase UID
   - `slug`: `default` または UID短縮形
2. 既存の `inbox_files`、`shiwake_records` 等のレコードに、その workspace_id を埋める
3. `users.current_workspace_id` を default ワークスペースのIDに設定
4. `master_<uid>.json` を `master_<uid>_<default_ws_id>.json` にrename
5. `hashes_<uid>.json` を `hashes_<uid>_<default_ws_id>.json` にrename

### 3.2 マイグレーションスクリプト案

```javascript
// migrate-to-workspaces.js (一回限り実行)
async function migrateUserToWorkspace(uid) {
  // 1. default ワークスペース作成(なければ)
  const existing = await supabaseQuery(
    `/workspaces?owner_uid=eq.${uid}&is_default=eq.true&select=id`
  );
  if (existing.length > 0) return existing[0].id;

  const wsId = crypto.randomUUID();
  await supabaseQuery('/workspaces', 'POST', {
    id: wsId,
    owner_uid: uid,
    name: 'マイワークスペース',
    slug: 'default',
    is_default: true
  });

  // 2. 既存レコードに workspace_id 付与
  const tables = [
    'inbox_files', 'inbox_addresses', 'inbox_settings',
    'shiwake_records', 'staff_members', 'cloud_connections', 'oauth_tokens'
  ];
  for (const tbl of tables) {
    await supabaseQuery(
      `/${tbl}?uid=eq.${uid}&workspace_id=eq.00000000-0000-0000-0000-000000000000`,
      'PATCH',
      { workspace_id: wsId }
    );
  }

  // 3. users.current_workspace_id 更新
  await supabaseQuery(`/users?id=eq.${uid}`, 'PATCH', {
    current_workspace_id: wsId
  });

  // 4. ファイル rename
  const oldMaster = path.join(MASTER_DIR, `master_${uid}.json`);
  const newMaster = path.join(MASTER_DIR, `master_${uid}_${wsId}.json`);
  if (fs.existsSync(oldMaster)) fs.renameSync(oldMaster, newMaster);

  const oldHash = path.join(HASH_DIR, `hashes_${uid}.json`);
  const newHash = path.join(HASH_DIR, `hashes_${uid}_${wsId}.json`);
  if (fs.existsSync(oldHash)) fs.renameSync(oldHash, newHash);

  return wsId;
}
```

### 3.3 新規ユーザー登録時

新規ユーザー登録時(`/api/user/upsert` エンドポイント)に同じ処理を実行:
1. ユーザー作成
2. default ワークスペース自動作成
3. `users.current_workspace_id` セット

---

## 4. UI仕様

### 4.1 ワークスペース切り替えセレクタ

**配置: ヘッダー上部 or サイドバー上部**

```
┌─────────────────────────────────────┐
│ shiwake-ai                          │
│                                     │
│ ┌─────────────────────────────┐ ▼  │
│ │ 🏢 合同会社A商事             │    │
│ └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

クリックでドロップダウン表示:

```
┌─────────────────────────────┐
│ 🏢 合同会社A商事     ✓      │
│ 🏪 株式会社B工房            │
│ 🍴 飲食店C                  │
│ ─────────────────────       │
│ ➕ ワークスペースを追加       │
│ ⚙ ワークスペースを管理       │
└─────────────────────────────┘
```

#### 表示条件

| ユーザー種別 | 表示 |
|---|---|
| ワークスペース1個のみ | **非表示**(個人ユーザーがこれに該当) |
| ワークスペース2個以上 | 表示 |
| プラン制限で複数化不可 | 「ワークスペースを追加」ボタンクリック時に**プランアップグレード案内** |

### 4.2 ワークスペース管理画面

設定メニューの中に「ワークスペース管理」を新設。

#### レイアウト

```
┌────────────────────────────────────────┐
│ ワークスペース管理                       │
│                                        │
│ ご利用中: 3 / 10 ワークスペース           │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ 🏢 合同会社A商事                    │ │
│ │ 仕訳: 234件  最終: 2026-05-09       │ │
│ │ [編集] [アーカイブ]                  │ │
│ └────────────────────────────────────┘ │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ 🏪 株式会社B工房                    │ │
│ │ 仕訳: 89件  最終: 2026-05-08        │ │
│ │ [編集] [アーカイブ]                  │ │
│ └────────────────────────────────────┘ │
│                                        │
│ [➕ 新しいワークスペースを追加]          │
└────────────────────────────────────────┘
```

#### アクション

- **追加**: フォームでワークスペース名・色・アイコンを入力 → 作成
- **編集**: 名前・色・アイコン・振り分けルールを編集
- **アーカイブ**: 論理削除(`is_archived=true`)、データは残す
- **デフォルト変更**: どれか1つを「デフォルト」に指定可能

### 4.3 ワークスペース設定画面

各ワークスペースの詳細設定。

```
┌────────────────────────────────────────┐
│ ⚙ 合同会社A商事 の設定                  │
│                                        │
│ ワークスペース名: [合同会社A商事    ]   │
│ 色:              ● ○ ○ ○ ○            │
│ アイコン:         [🏢]                  │
│                                        │
│ ─── 自動振り分けルール ───              │
│                                        │
│ このメール送信元はこのワークスペースへ:   │
│ ・accounting@a-corp.co.jp [削除]       │
│ ・mr-tanaka@a-corp.co.jp  [削除]       │
│ [+ 追加]                               │
│                                        │
│ このドメインからのメールはここへ:        │
│ ・@a-corp.co.jp [削除]                 │
│ [+ 追加]                               │
│                                        │
│ 件名にこのキーワードがあればここへ:      │
│ ・[A社]                                │
│ ・A商事                                │
│ [+ 追加]                               │
└────────────────────────────────────────┘
```

### 4.4 メール未振り分けトレイ

自動振り分けに失敗したメールを処理する画面。

```
┌────────────────────────────────────────┐
│ 📥 未振り分けトレイ (3件)                │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ 🧾 領収書_5月分.pdf                 │ │
│ │ From: receipt@gourmet-restaurant.jp │ │
│ │ Subject: 領収書(5月分)             │ │
│ │ Received: 2026-05-09 14:32         │ │
│ │ → ワークスペース選択: [▼ 選択...]   │ │
│ │   [このルールを記憶する]             │ │
│ └────────────────────────────────────┘ │
│                                        │
│ ...                                    │
└────────────────────────────────────────┘
```

「このルールを記憶する」をチェックすると、選択したワークスペースの `client_email_addresses` にこの送信元アドレスを自動追加。**ルール学習**として機能する。

### 4.5 仕訳パネルでの表示

メイン画面のヘッダー部分に**現在のワークスペース名**を常時表示し、誤操作を防ぐ:

```
┌────────────────────────────────────────┐
│ 仕訳処理 [🏢 合同会社A商事 ▼]            │
│ ────────────────────────────────────── │
│ 累計108件  今月79件                     │
│ ...                                    │
└────────────────────────────────────────┘
```

色分けやアイコンで「今どこにいるか」を視覚的に分かりやすく。

---

## 5. メール振り分け仕様

### 5.1 振り分けロジック(優先順位)

メール受信時、以下の順で振り分けを試行:

1. **完全一致(送信元アドレス)**: `client_email_addresses` に含まれる送信元
2. **ドメイン一致**: `client_email_domains` に含まれるドメイン
3. **件名キーワード**: `subject_keywords` のいずれかが件名に含まれる
4. **未振り分け**: 上記すべて失敗 → `inbox_files` に `workspace_id=NULL` または `unassigned` フラグで保存

### 5.2 実装イメージ

```javascript
// server.js の inbox 受信処理に追加
async function classifyIncomingEmail(uid, fromAddress, subject) {
  const workspaces = await supabaseQuery(
    `/workspaces?owner_uid=eq.${uid}&is_archived=eq.false&select=*`
  );

  // 1. 完全一致(送信元)
  for (const ws of workspaces) {
    if (ws.client_email_addresses?.includes(fromAddress)) {
      return ws.id;
    }
  }

  // 2. ドメイン一致
  const domain = fromAddress.split('@')[1];
  for (const ws of workspaces) {
    if (ws.client_email_domains?.includes(domain)) {
      return ws.id;
    }
  }

  // 3. 件名キーワード
  for (const ws of workspaces) {
    if (ws.subject_keywords?.some(kw => subject.includes(kw))) {
      return ws.id;
    }
  }

  // 4. 未振り分け
  return null;
}
```

### 5.3 未振り分けの扱い

- `inbox_files.workspace_id` を `NULL` で保存
- フロント側で「未振り分けトレイ」として表示
- 税理士が手動で振り分け
- 振り分け確定時に「ルール記憶」をオプションで提供

### 5.4 メールアドレス設計の決定

ワークスペースごとにアドレスを発行する**必要はない**(本要件)。

全ワークスペース共通で1ユーザー1アドレス:
```
abc123@inbox.shiwake-ai.com
```

このアドレスから受信したメールを、振り分けロジックでワークスペースに自動分類する。

メリット:
- 顧問先がアドレスを覚えやすい(1つだけ)
- ユーザーUIがシンプル
- 「税理士臭」のあるアドレス命名を回避

デメリット:
- 1顧問先=複数事業所の場合、振り分け失敗の可能性あり
- 手動振り分けの運用が必要

### 5.5 Dropbox/GDrive の振り分け

Dropbox/GDriveは**ワークスペース別に異なるフォルダを監視**する設計に変更:

```
ワークスペース: 合同会社A商事
  Dropbox: /A商事/領収書

ワークスペース: 株式会社B工房
  Dropbox: /B工房/領収書
```

各ワークスペース設定で個別にフォルダパスを指定。`cloud_connections` テーブルに `workspace_id` 列を追加(§2.2)。

---

## 6. APIエンドポイント設計

### 6.1 新規エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/workspaces?uid=xxx` | 自分のワークスペース一覧取得 |
| POST | `/api/workspaces` | 新規ワークスペース作成 |
| PATCH | `/api/workspaces/:id` | ワークスペース編集 |
| DELETE | `/api/workspaces/:id` | アーカイブ(論理削除) |
| POST | `/api/workspaces/:id/restore` | アーカイブから復元 |
| POST | `/api/workspaces/:id/switch` | 現在のワークスペース切替(`current_workspace_id` 更新) |
| POST | `/api/workspaces/:id/assign-files` | 未振り分けファイルをワークスペースに割当 |
| POST | `/api/workspaces/:id/learn-rule` | ルール学習(送信元・ドメイン・件名追加) |

### 6.2 既存エンドポイントの変更

すべての既存エンドポイントに **`workspace_id` クエリパラメータ**を追加し、データを workspace 単位でフィルタリングする。

#### 影響を受けるエンドポイント

| エンドポイント | 変更内容 |
|---|---|
| `GET /api/master?uid=xxx` | `&workspace_id=xxx` 必須に |
| `POST /api/master?uid=xxx` | `&workspace_id=xxx` 必須に |
| `DELETE /api/master?uid=xxx` | `&workspace_id=xxx` 必須に |
| `GET /api/inbox?uid=xxx` | `&workspace_id=xxx` 必須に |
| `GET /api/inbox/settings?uid=xxx` | `&workspace_id=xxx` 必須に |
| `PUT /api/inbox/settings` | body に `workspace_id` 必須に |
| `POST /api/user/count` | body に `workspace_id` 必須に |
| `GET /api/staff?uid=xxx` | `&workspace_id=xxx` 必須に |
| `POST /api/invite` | body に `workspace_id` 必須に |
| `GET /api/dropbox/auth-url` | クエリに `workspace_id` 追加 |
| `POST /api/dropbox/folder` | body に `workspace_id` 必須に |
| `GET /api/gdrive/info` | `&workspace_id=xxx` 必須に |
| `POST /api/gdrive/connect` | body に `workspace_id` 必須に |
| `GET /api/inbox/address` | `&workspace_id=xxx` 必須に(将来用、現状は uid単位でOK) |

#### 互換性維持

`workspace_id` が指定されない既存クライアントの場合は、`users.current_workspace_id` を自動採用してフォールバック。これにより**フロントの段階的移行**が可能になる。

```javascript
// 例: マスタ取得 API の対応
function getMasterRoutes(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid');
  let wsId = url.searchParams.get('workspace_id');

  // フォールバック: 指定がなければ current_workspace_id を採用
  if (!wsId) {
    const user = await supabaseQuery(`/users?id=eq.${uid}&select=current_workspace_id`);
    wsId = user[0]?.current_workspace_id;
  }

  const master = loadMaster(uid, wsId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(master));
}
```

### 6.3 サンプル: GET /api/workspaces

レスポンス例:
```json
{
  "workspaces": [
    {
      "id": "uuid-1",
      "name": "合同会社A商事",
      "slug": "a-corp",
      "is_default": true,
      "color": "#1D9E75",
      "icon": "🏢",
      "stats": {
        "shiwake_count": 234,
        "last_activity_at": "2026-05-09T14:32:00Z",
        "master_count": 23,
        "trust_score": 96.7
      }
    },
    {
      "id": "uuid-2",
      "name": "株式会社B工房",
      "slug": "b-koubou",
      "is_default": false,
      "color": "#185FA5",
      "icon": "🏪",
      "stats": { /* ... */ }
    }
  ],
  "current_workspace_id": "uuid-1",
  "limit": 10,
  "used": 2
}
```

### 6.4 サンプル: POST /api/workspaces/:id/switch

リクエスト:
```json
{ "uid": "abc123" }
```

レスポンス:
```json
{ "ok": true, "current_workspace_id": "uuid-2" }
```

サーバ側で `users.current_workspace_id` を更新。

---

## 7. 既存機能との影響範囲

### 7.1 取引先マスタ(`master.js`)

#### 変更内容
- 関数シグネチャ: `loadMaster(uid)` → `loadMaster(uid, workspaceId)`
- ファイルパス: `masters/master_<uid>_<wsid>.json`
- API: `?uid=xxx&workspace_id=yyy` 必須

#### 影響度: 大(全API変更)

### 7.2 ハッシュキャッシュ(`hashes.js`)

#### 変更内容
- 関数シグネチャ: `getHashedResult(uid, hash)` → `getHashedResult(uid, workspaceId, hash)`
- 関数シグネチャ: `setHashedResult(uid, hash, items)` → `setHashedResult(uid, workspaceId, hash, items)`
- ファイルパス: `hashes/hashes_<uid>_<wsid>.json`
- 仕訳API(`/api/analyze-chunk`): リクエストボディに `workspace_id` 必須

#### 影響度: 大(仕訳ロジックのコアに直結)

⚠️ **重要**: ハッシュキャッシュをワークスペース別にしないと、**A社の領収書がB社で使い回される**事故が起きる。これは絶対に避けたい。

### 7.3 自動取り込み設定

#### 変更内容
- `inbox_settings` テーブルに `workspace_id` 列追加
- 設定はワークスペース別(A社は自動取り込みON、B社は手動のまま等)
- 専用メアドは uid単位で1つのみ(振り分けで対応、§5.4)

#### 影響度: 中

### 7.4 スタッフ管理 / インセンティブ

#### 変更内容
- `staff_members` テーブルに `workspace_id` 列追加
- スタッフはワークスペース別(A社のスタッフがB社の仕訳をしない)
- インセンティブ計算もワークスペース別

#### 影響度: 中

⚠️ 注意: 税理士視点ではインセンティブ機能は使わない可能性あり。これは**設定で非表示**で対応(プラン側で制御)。

### 7.5 仕訳記録 (`shiwake_records`)

#### 変更内容
- `workspace_id` 列追加
- CSV出力時のフィルタリングが workspace 単位

#### 影響度: 大(全仕訳機能に影響)

### 7.6 卒業判定 / 信頼度メトリクス(A-3b)

#### 変更内容
- `cumulative_shiwake_count` を `users` テーブルから `workspace_settings` 等のテーブルに移動
- 信頼度はワークスペース別に計算
- 「この税理士全体の精度」ではなく「A社の精度97%、B社の精度92%」と表示

#### 影響度: 大(A-3b で詳細設計)

### 7.7 Dropbox/GDrive 接続

#### 変更内容
- `cloud_connections` テーブルに `workspace_id` 列追加
- ワークスペース別に異なる Dropbox/GDrive アカウントを接続可能
- 同じアカウントでも、ワークスペース別に異なるフォルダを監視

#### 影響度: 中

### 7.8 料金プラン / 課金(A-3c)

#### 変更内容
- プランによってワークスペース上限が変わる(SaaS版=1、プレミアム以上=10、Elite=10)
- 追加ワークスペースは課金 (A-3c で詳細)

#### 影響度: 中(A-3c で詳細設計)

---

## 8. プラン制約との連動

### 8.1 ワークスペース上限

| プラン | 上限 |
|---|---|
| 無料トライアル | 1個(default のみ) |
| AI SaaS版(全プラン) | 1個 |
| Agent ライト | 1個 |
| Agent スタンダード | 1個 |
| Agent プレミアム | 10個 + 税理士オプションで解放 |
| Agent エリート | 10個(標準装備) |
| 追加オプション | +10個単位で課金(A-3c) |

### 8.2 上限超過時の挙動

- 上限ちょうど → 「追加」ボタンを表示しつつ、押すと上位プラン or 追加オプションを案内
- ワークスペース作成API側でも上限チェック → 超過なら 400 エラー返す

### 8.3 上位プランからダウングレードした場合

- 既存ワークスペースは保持(削除しない)
- 新規作成のみブロック
- ダッシュボードで「上限超過しています、◯個のワークスペースをアーカイブしてください」と警告
- アーカイブまでは全ワークスペースの**閲覧のみ可能**(編集・新規仕訳は不可)

これにより**データ消失を防ぎつつ、課金圧力**を保つ。

---

## 9. UIに表示しないケース(個人ユーザー)

### 9.1 表示制御の原則

ワークスペースが**1個のみ**の場合:
- ヘッダーの切り替えセレクタ: 非表示
- サイドバーの「ワークスペース管理」メニュー: 非表示
- 設定画面: 非表示
- 「ワークスペース」という言葉: 一切表示しない

ワークスペースが**2個以上**の場合:
- 切り替えセレクタ: 表示
- 各種メニュー: 表示

ワークスペースを**作成可能**な場合(プレミアム以上):
- 1個のみの状態でも、「ワークスペース管理」メニューは表示
- そこから「新しいワークスペースを追加」できる

### 9.2 個人ユーザーへの非露出

個人ユーザーが**ワークスペース機能の存在を意識しない**よう、以下の徹底:

- 「マイワークスペース」を `default=true` で作成済み(意識せず使える)
- データは全部その default に紐付く
- 機能アップグレードを促すLPでも「複数の事業を管理」と表現(税理士限定と思わせない)

---

## 10. Claude Code 向け実装指示

### 10.1 実装の順序

#### Phase 1: DB変更(まず土台)
1. `workspaces` テーブル作成(Supabase SQL editor)
2. 既存テーブルへの `workspace_id` 列追加(マイグレーションスクリプト)
3. 既存ユーザーへの default ワークスペース付与スクリプト実行
4. ファイル(masters/, hashes/) のリネームスクリプト実行

#### Phase 2: バックエンド対応
1. `master.js` の関数シグネチャ変更(workspaceId 引数追加)
2. `hashes.js` の関数シグネチャ変更(workspaceId 引数追加)
3. `server.js` の各エンドポイントに `workspace_id` パラメータ受け取り追加
4. フォールバック処理(`current_workspace_id` 自動採用)
5. 新規エンドポイント `/api/workspaces` 系の実装

#### Phase 3: フロント対応
1. ワークスペース API クライアントの実装(fetchWorkspaces, switchWorkspace等)
2. ヘッダーに切り替えセレクタを追加
3. ワークスペース管理画面の追加
4. ワークスペース設定画面の追加
5. 既存の API 呼び出しに `workspace_id` を含めるよう修正
6. 個人ユーザー向けの非表示制御

#### Phase 4: メール振り分け
1. 振り分けロジック実装(server.js の inbox 受信処理)
2. 未振り分けトレイUIの実装
3. ルール学習機能の実装

#### Phase 5: 既存機能との結線
1. 仕訳処理(`/api/analyze-chunk`)が `workspace_id` を受け取って処理
2. 取引先マスタが workspace 別に動作
3. CSV出力が workspace 別に動作
4. スタッフ管理が workspace 別に動作

### 10.2 注意事項

- **既存ユーザーのデータが壊れないこと**を最優先(マイグレーションは必ず DB バックアップ後)
- **段階リリース**: マイグレーション → バックエンド対応 → フロント対応(各段階で動作確認)
- 個人ユーザー(ワークスペース1個)で**今までと同じ操作感**になること(UIに新概念が出ないこと)
- 仕訳ロジックでハッシュキャッシュが**ワークスペースをまたがないこと**(セキュリティ事故防止)
- 「税理士」という言葉が UI に出ないこと(中立的な「ワークスペース」表現で統一)

### 10.3 動作確認チェックリスト

- [ ] 既存ユーザー(個人)の動作が変わらない
- [ ] 個人ユーザーに切り替えUIが出ない
- [ ] プレミアムプラン以上で複数ワークスペース作成可能
- [ ] ワークスペース切り替えで取引先マスタが切り替わる
- [ ] ワークスペース切り替えでハッシュキャッシュが切り替わる(別の領収書を仕訳したらキャッシュが効かない)
- [ ] ワークスペース切り替えで仕訳記録の表示が切り替わる
- [ ] 自動取り込み: 同一uidで複数ワークスペースに振り分けられる
- [ ] 未振り分けトレイで手動振り分け可能
- [ ] ルール学習で次回から自動振り分け
- [ ] ワークスペースアーカイブ後、復元可能
- [ ] Dropbox/GDrive がワークスペース別フォルダを監視

---

## 11. 既知の課題・将来検討事項

### 11.1 顧問先スタッフのログイン(将来 Y 拡張)

設計思想 §1.3 で言及した「将来的な顧問先スタッフのログイン」について:
- ワークスペース → スタッフ(招待制)の権限管理が必要
- 「税理士は全ワークスペースを見れる、スタッフは自分のワークスペースのみ」
- これは v3.x 以降で別途設計

### 11.2 ワークスペース間のデータコピー

「A社の取引先マスタの一部をB社にコピーしたい」という要望が出る可能性。
- 当面は手動でCSV exportして、別ワークスペースで import
- 将来的に「マスタコピー機能」を追加検討

### 11.3 ワークスペース数の課金トリガー

11個目を作ろうとした時の挙動を A-3c で確定:
- 自動課金(Stripe)
- 手動承認後に課金
- 申込制

### 11.4 削除(完全削除)の扱い

`is_archived=true` でアーカイブはするが、**完全削除**は当面実装しない:
- データは残す(税務上7年保存など)
- 完全削除はサポート問い合わせ経由で対応

---

## 12. 関連ドキュメント

| ドキュメント | 役割 |
|---|---|
| `shiwake-ai_設計思想_v3_0.md` | 北極星、本書の根拠 |
| `shiwake-ai_UI言語置換マップ_v3_0.md` | 並行作業のUI言語改訂 |
| **本書(A-3a)** | **ワークスペース機能設計** |
| (今後作成) A-3b 信頼度メトリクス設計 | ワークスペース別の信頼度計算 |
| (今後作成) A-3c 料金プラン拡張設計 | ワークスペース上限・追加課金 |

---

## 13. 想定実装ボリューム

| 領域 | ボリューム |
|---|---|
| DB変更(SQL) | 1日 |
| マイグレーションスクリプト | 0.5〜1日 |
| `master.js` / `hashes.js` 改修 | 0.5日 |
| `server.js` API改修(既存 + 新規) | 3〜5日 |
| フロント(切替UI、管理画面) | 3〜5日 |
| メール振り分けロジック | 1〜2日 |
| 動作確認・バグ修正 | 2〜3日 |
| **合計** | **2〜3週間**(専念時) |

---

**作成日**: 2026年5月10日
**作成契機**: 税理士B2B戦略の確定により、複数顧問先を1アカウントで管理する必要性が明確化
**前提**: `shiwake-ai_設計思想_v3_0.md` の方針に基づく
**次のアクション**: A-3b(信頼度メトリクス設計、ワークスペース別の信頼度計算込み)
