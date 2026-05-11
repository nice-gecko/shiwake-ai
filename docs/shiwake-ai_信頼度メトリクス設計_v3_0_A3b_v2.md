# shiwake-ai 信頼度メトリクス設計書 v3.0 改訂版(A-3b v2)

> **本ドキュメントの位置づけ**
> 2026年5月10日改訂。初版 A-3b は `shiwake_records` テーブルの存在を前提に書かれていたが、実際は存在せず、仕訳記録は session.js による**24時間限定の一時保存**のみで運用されていることが判明。
>
> 本書では実態に合わせて全面改訂し、**仕訳記録の永続化基盤(DB保存)**を含めた設計とする。
>
> 関連:
> - `A-3a: ワークスペース機能設計書`(前提、すべての記録が workspace_id 単位)
> - `A-3c: 料金プラン拡張設計書`(独立、影響なし)
> - `shiwake-ai_設計思想_v3_0.md`(北極星)

---

## 📌 改訂サマリー(初版から何が変わったか)

| 項目 | 初版 A-3b | 改訂版 A-3b v2 |
|---|---|---|
| **前提テーブル** | `shiwake_records` 存在 | **存在しない**(新設が必要) |
| **既存の仕訳保存** | DB前提 | **session.jsで24h限定保存のみ** |
| **設計範囲** | 列追加とAPI改修 | **テーブル新設+保存基盤+信頼度** |
| **session.js の扱い** | 言及なし | **作業中バッファとして温存** |
| **マイグレーション** | 既存データ前提 | **新規仕訳から記録開始** |
| **実装ボリューム** | 1〜2週間 | **2〜3週間**(基盤実装含むため) |

---

## 📌 設計の要約

| 項目 | 内容 |
|---|---|
| **仕訳記録の保存基盤** | `shiwake_records` テーブル新設、承認時に DB へ保存 |
| **session.js の役割** | 作業中の一時バッファ(承認前)として温存 |
| **記録対象項目** | 主要4項目(借方科目・貸方科目・税区分・摘要) |
| **計算単位** | ワークスペース別(A-3a 前提) |
| **期間軸** | 直近30日 + 全期間 |
| **段階的フェードアウト** | rookie / stable / mature の3段階 |
| **データ保持** | DB上で全期間保持(消えない) |

---

## 1. 設計思想(初版から継承)

### 1.1 北極星

> **「AIを評価するのはユーザー。AIは数字で自分を見せる。」**

設計思想 v3.0 で確立した方針。これは初版 A-3b から不変。

### 1.2 信頼確立の旅程

```
段階1: 試用期(〜50件、rookie)
  → 信頼度UIを目立つ位置に
段階2: 安定期(50件〜、承認率90%超え、stable)
  → 信頼度UIはコンパクト化
段階3: 熟達期(自動承認ON、運用に乗る、mature)
  → 信頼度UIは背景に退く
```

### 1.3 「信頼の透明性」がブランド価値

shiwake-ai は精度を**全部開示する**ことで、税理士の業界文化(数字で語る)に響く。これは初版から不変。

---

## 2. 仕訳記録の保存基盤(新規設計)

### 2.1 現状の問題

調査結果(session.js 分析):
- 仕訳記録は `sessions.json` ファイルに保存
- **24時間TTLで自動削除**
- uid 紐付けなし(sessionId はブラウザ発行)
- ワークスペース対応なし

これでは信頼度メトリクスの計算が不可能。**永続的な仕訳記録の保存基盤**を新設する必要がある。

### 2.2 アーキテクチャ方針

**役割分担を明確化**:

| 層 | 役割 | 実装 |
|---|---|---|
| **作業中バッファ** | 仕訳生成〜承認前の一時保管 | session.js(温存) |
| **永続記録** | 承認後の仕訳の長期保存 | shiwake_records テーブル(新設) |
| **計算キャッシュ** | 信頼度メトリクスの集計結果 | workspace_trust_metrics テーブル(新設) |

データの流れ:

```
1. 仕訳生成(/api/analyze-chunk)
   ↓
2. session.js に items[] を一時保存(24h TTL)
   ↓
3. ユーザーが承認(approve関数 + /api/shiwake/approve 呼び出し)
   ↓
4. shiwake_records テーブルに永続保存
   ↓
5. workspace_trust_metrics を再計算(非同期)
   ↓
6. /api/trust-metrics で読み出してダッシュボード表示
```

### 2.3 shiwake_records テーブル定義

```sql
CREATE TABLE shiwake_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- 仕訳の確定値(ユーザーが承認した最終値)
  shiwake_date DATE,
  partner_name TEXT,
  debit_account TEXT,
  credit_account TEXT,
  tax_category TEXT,
  amount NUMERIC,
  memo TEXT,
  invoice_number TEXT,

  -- AI提案値(承認時点でのスナップショット)
  ai_proposed_debit_account TEXT,
  ai_proposed_credit_account TEXT,
  ai_proposed_tax_category TEXT,
  ai_proposed_memo TEXT,

  -- 修正情報
  was_modified BOOLEAN NOT NULL DEFAULT false,
  modified_fields TEXT[] DEFAULT NULL,

  -- マスタヒット情報
  matched_master_key TEXT DEFAULT NULL,
  master_hit_method TEXT DEFAULT NULL,    -- 'exact' | 'partial' | 'fuzzy' | NULL

  -- メタデータ
  source_session_id TEXT,                  -- 元のセッションID(任意、デバッグ用)
  source_file_name TEXT,                   -- 元の証憑ファイル名
  approved_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX idx_shiwake_records_workspace_approved
  ON shiwake_records(workspace_id, approved_at);
CREATE INDEX idx_shiwake_records_uid
  ON shiwake_records(uid);
CREATE INDEX idx_shiwake_records_was_modified
  ON shiwake_records(workspace_id, was_modified)
  WHERE was_modified IS NOT NULL;
```

#### 列の用途まとめ

| 列 | 役割 |
|---|---|
| `id` | レコード一意ID |
| `uid` | 所有者(Firebase UID) |
| `workspace_id` | A-3a のワークスペース別管理 |
| `shiwake_date` 〜 `invoice_number` | ユーザー確定値 |
| `ai_proposed_*` | AIが提案した内容(差分計算用) |
| `was_modified` | AI提案から修正されたか |
| `modified_fields` | 修正された項目の配列 |
| `matched_master_key` | マスタヒット先 |
| `master_hit_method` | マスタヒット方式 |
| `source_session_id` | 元セッションID(任意、デバッグ・調査用) |
| `approved_at` | 承認日時(信頼度の期間判定に使用) |

### 2.4 workspace_trust_metrics テーブル定義

信頼度の計算結果キャッシュ。承認イベント時に非同期更新。

```sql
CREATE TABLE workspace_trust_metrics (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- 全期間
  total_approved INTEGER NOT NULL DEFAULT 0,
  total_modified INTEGER NOT NULL DEFAULT 0,
  trust_score_all NUMERIC,
  field_accuracy_all JSONB,
  modification_trend_all JSONB,

  -- 直近30日
  recent_approved INTEGER NOT NULL DEFAULT 0,
  recent_modified INTEGER NOT NULL DEFAULT 0,
  trust_score_recent NUMERIC,
  field_accuracy_recent JSONB,
  modification_trend_recent JSONB,

  -- マスタ系
  master_count INTEGER NOT NULL DEFAULT 0,
  master_hit_rate NUMERIC,

  -- 状態判定(段階的フェードアウト用、内部状態)
  maturity_level TEXT NOT NULL DEFAULT 'rookie',
                                          -- 'rookie' | 'stable' | 'mature'

  last_calculated_at TIMESTAMPTZ DEFAULT now()
);
```

### 2.5 マイグレーション(既存データの扱い)

ユーザーが0人のため、複雑な既存データ移行は不要。

- 既存の `sessions.json` データは**そのまま放置**(24時間で自然消滅)
- shiwake_records は**新規仕訳から記録開始**
- 既存セッションの仕訳は**信頼度計算の対象外**(問題なし、件数が少ない)

---

## 3. 仕訳記録の保存ロジック(server.js 改修)

### 3.1 既存の仕訳生成API(変更なし)

`/api/analyze-chunk`(server.js:1603〜):
- 既存ロジックそのまま維持
- 仕訳生成後、items[] をレスポンスで返す
- フロント側で session.js に一時保存(既存ロジック)

ここに `ai_proposed_*` 等を追加保存する必要はない(承認時に確定値とセットで保存するため)。

### 3.2 新規エンドポイント: 承認時の永続保存

`POST /api/shiwake/approve` を新設。

#### リクエスト
```json
{
  "uid": "abc123",
  "workspace_id": "uuid-1",
  "session_id": "sess_1234567890",
  "record": {
    "shiwake_date": "2026-05-10",
    "partner_name": "セブン-イレブン東京駅店",
    "debit_account": "会議費",
    "credit_account": "現金",
    "tax_category": "課税仕入10%",
    "amount": 1200,
    "memo": "懇親会",
    "invoice_number": "T1234567890123",
    "ai_proposed": {
      "debit_account": "会議費",
      "credit_account": "現金",
      "tax_category": "課税仕入10%",
      "memo": "雑費"
    },
    "matched_master_key": "セブン-イレブン",
    "master_hit_method": "partial",
    "source_file_name": "20260510_receipt.jpg"
  }
}
```

#### サーバ側処理

```javascript
// /api/shiwake/approve(新規)
if (req.method === 'POST' && reqPath === '/api/shiwake/approve') {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { uid, workspace_id, session_id, record } = JSON.parse(body);

      // ワークスペース所有者確認(セキュリティ)
      const ws = await supabaseQuery(
        `/workspaces?id=eq.${workspace_id}&owner_uid=eq.${uid}&select=id`
      );
      if (!ws[0]) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }

      // 差分計算
      const ai = record.ai_proposed || {};
      const modifiedFields = [];
      if (record.debit_account !== ai.debit_account) modifiedFields.push('debit_account');
      if (record.credit_account !== ai.credit_account) modifiedFields.push('credit_account');
      if (record.tax_category !== ai.tax_category) modifiedFields.push('tax_category');
      if (record.memo !== ai.memo) modifiedFields.push('memo');
      const wasModified = modifiedFields.length > 0;

      // shiwake_records に INSERT
      const id = crypto.randomUUID();
      await supabaseQuery('/shiwake_records', 'POST', {
        id,
        uid,
        workspace_id,
        shiwake_date: record.shiwake_date,
        partner_name: record.partner_name,
        debit_account: record.debit_account,
        credit_account: record.credit_account,
        tax_category: record.tax_category,
        amount: record.amount,
        memo: record.memo,
        invoice_number: record.invoice_number,
        ai_proposed_debit_account: ai.debit_account || null,
        ai_proposed_credit_account: ai.credit_account || null,
        ai_proposed_tax_category: ai.tax_category || null,
        ai_proposed_memo: ai.memo || null,
        was_modified: wasModified,
        modified_fields: wasModified ? modifiedFields : null,
        matched_master_key: record.matched_master_key || null,
        master_hit_method: record.master_hit_method || null,
        source_session_id: session_id,
        source_file_name: record.source_file_name || null,
        approved_at: new Date().toISOString()
      });

      // 信頼度メトリクス再計算(非同期、レスポンスを待たせない)
      recalculateTrustMetrics(workspace_id).catch(e => {
        console.warn('trust metrics recalc error:', e.message);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        record_id: id,
        was_modified: wasModified,
        modified_fields: wasModified ? modifiedFields : null
      }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

### 3.3 フロント側の改修(index.html)

既存の `approve(i)` 関数(line 3704〜)を改修。承認時に新エンドポイントを呼ぶ:

```javascript
// 既存 approve 関数の改修
async function approve(i){
  approved.add(i);deleted.delete(i);
  await autoLearn(results[i]);
  syncSessionSave();  // 既存処理(session.jsへの一時保存)

  // === 新規: shiwake_records への永続保存 ===
  try {
    const uid = window._firebaseUser?.uid;
    const workspaceId = getCurrentWorkspaceId();  // A-3a で実装
    if (uid && workspaceId) {
      await fetch('/api/shiwake/approve', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          uid,
          workspace_id: workspaceId,
          session_id: SESSION_ID,
          record: {
            shiwake_date: results[i].date,
            partner_name: results[i].title,
            debit_account: results[i].debit,
            credit_account: results[i].credit,
            tax_category: results[i].tax,
            amount: results[i].amount,
            memo: results[i].memo,
            invoice_number: results[i].invoice_number,
            ai_proposed: results[i]._aiProposed || null,
            matched_master_key: results[i].masterKey || null,
            master_hit_method: results[i].masterApplied ? 'partial' : null,
            source_file_name: results[i]._sourceFileName || null
          }
        })
      });
    }
  } catch(e) {
    console.warn('shiwake record save error:', e);
    // 永続保存失敗してもUI上は承認扱いにする(優先度: UI > DB)
  }

  // 既存処理続き
  const rule = {debit:results[i].debit, credit:results[i].credit, tax:results[i].tax, memo:results[i].memo};
  results.forEach((r,j)=>{
    if(j!==i && r.title===results[i].title && !approved.has(j) && !deleted.has(j)){
      results[j]={...r,...rule,masterApplied:true};
    }
  });
  const masterCount=Object.keys(masterData||{}).length;
  showToast(`✓ 承認完了 · 学習済み取引先 ${masterCount}社`);
  renderCards();updateBottom();
  setTimeout(()=>checkAllApproved(), 800);
}
```

### 3.4 AI提案値の保持(フロント側、新規)

承認時に「AIが最初に提案した値」を知るために、フロント側で `_aiProposed` を保持する必要がある:

```javascript
// /api/analyze-chunk のレスポンス受信時(addItems関数内、index.html line 3284付近)
items.forEach(it => {
  // === 新規: AI提案値のスナップショット ===
  it._aiProposed = {
    debit_account: it.debit,
    credit_account: it.credit,
    tax_category: it.tax,
    memo: it.memo
  };
  // 既存処理
  results.push({...it, _sourceUrl:srcUrl, _lineItemMode:lineItemMode||'total_only', _sourceB64:srcB64||null, _sourceMediaType:srcMediaType||null});
});
```

これで、ユーザーが UI で編集しても `_aiProposed` は変わらない。承認時に `_aiProposed` と最終値を比較できる。

### 3.5 承認後の編集禁止

A-3b 初版で言及した通り、承認後の編集は **was_modified が事実と乖離する**ため禁止する。

実装方針:
- 承認後のカードは編集ボタンを無効化
- 編集したい場合は「差し戻し」→ 再承認のフロー
- ただし当面は **承認後に編集できないUIで運用**(差し戻し機能は v2.4 以降で検討)

---

## 4. 計算ロジック

### 4.1 メトリクス一覧(初版から変更なし)

| メトリクス | 計算式 | 表示例 |
|---|---|---|
| **承認率(全体)** | `was_modified=false の件数 / 全承認件数 × 100` | 96.7% |
| **項目別精度(借方科目)** | `'debit_account' を含まない modified_fields / 全承認件数 × 100` | 98% |
| **項目別精度(貸方科目)** | 同上(credit_account) | 99% |
| **項目別精度(税区分)** | 同上(tax_category) | 95% |
| **項目別精度(摘要)** | 同上(memo) | 92% |
| **修正傾向** | 修正された項目の頻度順 | 摘要(8) > 税区分(3) > 借方科目(2) |
| **学習済み取引先数** | master.json のキー数(workspace別) | 23社 |
| **マスタヒット率** | `master_hit_method IS NOT NULL の件数 / 全承認件数` | 78% |

### 4.2 期間軸(初版から変更なし)

- **直近30日**: 「今、どれくらい使えるか」のスナップショット
- **全期間**: 「累計でどれくらい学習したか」

### 4.3 サンプル数による信頼区間(初版から変更なし)

- **最低承認件数**: 30件
- 30件未満は「データ蓄積中」表示
- 過大な楽観/悲観を防ぐ

### 4.4 RPC関数(Supabase SQL)

A-3b 初版の §8.3 をそのまま採用。

```sql
CREATE OR REPLACE FUNCTION calc_trust_metrics(
  p_workspace_id UUID,
  p_period TEXT  -- 'recent' or 'all'
)
RETURNS JSONB AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_total INTEGER;
  v_modified INTEGER;
  v_field_acc JSONB;
  v_trend JSONB;
BEGIN
  v_since := CASE WHEN p_period = 'recent'
                   THEN NOW() - INTERVAL '30 days'
                   ELSE '1900-01-01'::TIMESTAMPTZ
              END;

  SELECT
    COUNT(*) FILTER (WHERE was_modified IS NOT NULL),
    COUNT(*) FILTER (WHERE was_modified = true)
  INTO v_total, v_modified
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id
    AND approved_at >= v_since;

  -- 項目別精度
  SELECT jsonb_build_object(
    'debit_account',  100 - (COUNT(*) FILTER (WHERE 'debit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'credit_account', 100 - (COUNT(*) FILTER (WHERE 'credit_account' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'tax_category',   100 - (COUNT(*) FILTER (WHERE 'tax_category' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0),
    'memo',           100 - (COUNT(*) FILTER (WHERE 'memo' = ANY(modified_fields))) * 100.0 / NULLIF(v_total, 0)
  ) INTO v_field_acc
  FROM shiwake_records
  WHERE workspace_id = p_workspace_id AND approved_at >= v_since;

  -- 修正傾向(頻度順)
  SELECT jsonb_agg(jsonb_build_object('field', f, 'count', c) ORDER BY c DESC)
  INTO v_trend
  FROM (
    SELECT unnest(modified_fields) AS f, COUNT(*) AS c
    FROM shiwake_records
    WHERE workspace_id = p_workspace_id AND approved_at >= v_since AND modified_fields IS NOT NULL
    GROUP BY f
  ) t;

  RETURN jsonb_build_object(
    'period', p_period,
    'total_approved', v_total,
    'total_modified', v_modified,
    'trust_score', CASE WHEN v_total > 0 THEN (v_total - v_modified) * 100.0 / v_total ELSE NULL END,
    'field_accuracy', v_field_acc,
    'modification_trend', v_trend
  );
END;
$$ LANGUAGE plpgsql;
```

### 4.5 再計算関数(server.js)

```javascript
async function recalculateTrustMetrics(workspaceId) {
  try {
    const recent = await supabaseQuery(`/rpc/calc_trust_metrics`, 'POST', {
      p_workspace_id: workspaceId,
      p_period: 'recent'
    });
    const all = await supabaseQuery(`/rpc/calc_trust_metrics`, 'POST', {
      p_workspace_id: workspaceId,
      p_period: 'all'
    });

    // master_count を取得(ファイルベースから)
    const master = loadMaster(/* uid */, workspaceId);
    const masterCount = Object.keys(master).length;

    // master_hit_rate を計算
    const masterStat = await supabaseQuery(
      `/shiwake_records?workspace_id=eq.${workspaceId}&select=master_hit_method`
    );
    const total = masterStat.length;
    const hit = masterStat.filter(r => r.master_hit_method !== null).length;
    const masterHitRate = total > 0 ? hit * 100 / total : 0;

    // maturity_level を判定
    const totalApproved = all.total_approved || 0;
    const recentTrust = recent.trust_score || 0;
    let maturityLevel = 'rookie';
    if (totalApproved >= 200 && recentTrust >= 95) {
      maturityLevel = 'mature';
    } else if (totalApproved >= 50) {
      maturityLevel = 'stable';
    }

    // upsert
    await supabaseQuery('/workspace_trust_metrics', 'POST', {
      workspace_id: workspaceId,
      total_approved: all.total_approved || 0,
      total_modified: all.total_modified || 0,
      trust_score_all: all.trust_score,
      field_accuracy_all: all.field_accuracy,
      modification_trend_all: all.modification_trend,
      recent_approved: recent.total_approved || 0,
      recent_modified: recent.total_modified || 0,
      trust_score_recent: recent.trust_score,
      field_accuracy_recent: recent.field_accuracy,
      modification_trend_recent: recent.modification_trend,
      master_count: masterCount,
      master_hit_rate: masterHitRate,
      maturity_level: maturityLevel,
      last_calculated_at: new Date().toISOString()
    }, { 'Prefer': 'resolution=merge-duplicates' });
  } catch(e) {
    console.warn('recalculateTrustMetrics error:', e.message);
  }
}
```

---

## 5. APIエンドポイント設計

### 5.1 `POST /api/shiwake/approve`(新規)

§3.2 で定義済み。承認時の永続保存と信頼度再計算をトリガー。

### 5.2 `GET /api/trust-metrics`(新規)

#### リクエスト
```
GET /api/trust-metrics?uid=xxx&workspace_id=yyy
```

#### レスポンス
```json
{
  "workspace_id": "uuid-1",
  "total_approved": 152,
  "total_modified": 5,
  "trust_score_all": 96.7,
  "trust_score_recent": 96.7,
  "field_accuracy_recent": {
    "debit_account": 98,
    "credit_account": 99,
    "tax_category": 95,
    "memo": 92
  },
  "modification_trend_recent": [
    {"field": "memo", "count": 8},
    {"field": "tax_category", "count": 3}
  ],
  "master_count": 23,
  "master_hit_rate": 78,
  "maturity_level": "stable",
  "last_calculated_at": "2026-05-10T14:30:00Z"
}
```

#### サンプル不足時のレスポンス
```json
{
  "workspace_id": "uuid-1",
  "total_approved": 12,
  "trust_score_status": "insufficient_data",
  "remaining_to_threshold": 18,
  "message": "信頼度を表示するには、あと18件の承認が必要です。",
  "maturity_level": "rookie"
}
```

### 5.3 `GET /api/workspaces`(A-3a 連携)

A-3a §6.3 のレスポンスに、本設計のメトリクスを含める:

```json
{
  "workspaces": [
    {
      "id": "uuid-1",
      "name": "合同会社A商事",
      "stats": {
        "shiwake_count": 234,
        "trust_score": 96.7,           // ← workspace_trust_metrics から
        "maturity_level": "stable",
        "master_count": 23
      }
    }
  ]
}
```

### 5.4 `GET /api/shiwake/records`(新規、将来用)

過去の仕訳一覧を取得するエンドポイント。当面は信頼度UIで使うのみ、CSV再出力等の用途は将来。

```
GET /api/shiwake/records?uid=xxx&workspace_id=yyy&limit=100&offset=0
```

---

## 6. UI仕様(初版から継承、変更なし)

### 6.1 表示の3パターン(成熟度別)

初版 §5.1 と同じ。

#### rookie(50件未満)
- メイン画面上部に進捗バー大きく
- 「あと◯件で精度が表示されます」

#### stable(50件以上、承認率<95%)
- メイン画面にコンパクト表示
- クリックで詳細展開(項目別精度、修正傾向)

#### mature(200件以上、承認率95%超)
- ヘッダーに小さく表示のみ
- 必要時のみ詳細確認

### 6.2 段階的フェードアウト

```javascript
function getDashboardLayout(metrics) {
  if (metrics.total_approved < 50) return 'rookie_layout';
  if (metrics.trust_score_recent >= 95 && metrics.total_approved >= 200) return 'mature_layout';
  return 'stable_layout';
}
```

逆遷移:
- 承認率80%を切ったら mature → stable

### 6.3 ワークスペース一覧での信頼度表示

A-3a の管理画面に各ワークスペースの精度を表示。初版 §5.4 と同じ。

### 6.4 自動承認ON時の表示

「自動承認モード中」ラベルを併記。初版 §5.5 と同じ。

---

## 7. プラン制約との連動

初版から変更なし。設計思想 v3.0 §6.2「機能ボタンは表示、プラン不足はアップグレード案内」と整合。

---

## 8. 既存システムとの結線

### 8.1 卒業判定ロジック

`bumpCumulativeAndCheckGraduation` 関数(server.js:344-364)は**維持**:
- `cumulative_shiwake_count` は統計用として温存
- フロント側は卒業フラグを参照しない
- バックエンドはそのまま動く

### 8.2 session.js との関係

- session.js は **作業中バッファ**として温存
- 仕訳生成〜承認前の一時保管に使う
- 承認後は shiwake_records が真の保存先
- session.js の24h TTL はそのまま(消えても影響なし)

### 8.3 ハッシュキャッシュ

A-3a §7.2 で「ワークスペース別に分離」と設計。
キャッシュヒット時の仕訳も `was_modified=false` で記録される(運用実態と整合)。

### 8.4 取引先マスタとの結線

`master.js` の `findMasterMatch()` を改修し、ヒット方式(`exact` / `partial` / `fuzzy`)を返すよう拡張。
仕訳作成時、この `method` を承認 API に渡し、`shiwake_records.master_hit_method` に保存。

### 8.5 自動承認との結線(v2.6.0 連携)

自動承認(v2.6.0で実装予定)ON時:
- AI生成 → 即 `was_modified=false` として承認
- ユーザー編集ゼロ
- 承認率 100%(AIが正解扱い)

ラベル表示で「自動承認モード中」を明示。サンプル検証モードは将来実装。

---

## 9. マイグレーション手順

### 9.1 既存データの扱い

- 既存ユーザー: 0人 → 影響なし
- 既存セッション: 24時間で自然消滅 → 移行不要
- 既存の shiwake_records: 存在しない → 新規作成のみ

### 9.2 ステップ

1. **DB変更**(Supabase SQL editor):
   - `shiwake_records` テーブル作成
   - `workspace_trust_metrics` テーブル作成
   - RPC関数 `calc_trust_metrics` 作成
   - インデックス作成

2. **master.js 改修**: `findMasterMatch()` 戻り値拡張(method 追加)

3. **server.js 改修**:
   - `/api/shiwake/approve` 新規追加
   - `/api/trust-metrics` 新規追加
   - `/api/workspaces` レスポンスに stats 追加(A-3a 連携)
   - `recalculateTrustMetrics()` 関数実装

4. **index.html 改修**:
   - `_aiProposed` 保持ロジック追加
   - `approve()` 関数で承認API呼び出し
   - 信頼度ダッシュボード実装(rookie/stable/mature の3UI)
   - ワークスペース一覧での精度表示

5. **動作確認**

### 9.3 ステップ実行順序の依存関係

```
DB変更 → master.js → server.js → index.html → 動作確認
   ↑          ↑           ↑           ↑
  必須      仕訳前提  仕訳前提   API前提
```

---

## 10. Claude Code 向け実装指示

### 10.1 実装順序(慎重に進める)

#### Phase 1: DB変更(土台)
1. `shiwake_records` テーブル作成
2. `workspace_trust_metrics` テーブル作成
3. RPC関数 `calc_trust_metrics` 作成
4. インデックス・FK制約作成
5. 動作確認(空のテーブルに INSERT/SELECT できるか)

#### Phase 2: master.js 改修
1. `findMasterMatch()` の戻り値拡張
2. 既存呼び出し元が壊れていないか確認

#### Phase 3: server.js API実装
1. `/api/shiwake/approve` 新規追加
2. `recalculateTrustMetrics()` 関数実装
3. `/api/trust-metrics` 新規追加

#### Phase 4: index.html フロント実装
1. `_aiProposed` 保持(addItems関数内)
2. `approve()` 関数で承認API呼び出し
3. 信頼度ダッシュボードUI実装(3パターン)

#### Phase 5: 動作確認

### 10.2 注意事項

#### 重要1: workspace_id の取り扱い
本書は A-3a(ワークスペース機能)実装後を前提。
**A-3a 実装前に本書を実装する場合は、`workspace_id` をすべての箇所で「default」のダミー値で動作するようにする**(後で本物の workspace_id に切り替え)。

#### 重要2: session.js は触らない
session.js は作業中バッファとして温存。**改修不要、削除不要**。

#### 重要3: `_aiProposed` のスナップショット
フロント側で AI提案値を保持するロジックを必ず実装。
ユーザーが編集を始める前に保存しないと、編集後の値が AI提案として誤って記録される。

#### 重要4: 承認後の編集禁止
承認後の仕訳カードは編集UIを無効化。
差し戻し機能は v2.4 以降で検討。

#### 重要5: 永続保存の失敗ハンドリング
shiwake_records への INSERT が失敗しても、フロントUI上は承認扱いにする(優先度: UX > データ完全性)。
失敗ログは出すが、ユーザーには見せない。後で別途リトライ機構を検討。

### 10.3 動作確認チェックリスト

- [ ] DBに `shiwake_records` と `workspace_trust_metrics` が作成されている
- [ ] 仕訳を生成→承認すると `shiwake_records` に1行 INSERT される
- [ ] AI提案そのままで承認 → `was_modified=false` で記録
- [ ] 借方科目を編集して承認 → `was_modified=true`, `modified_fields=['debit_account']` で記録
- [ ] 複数項目編集 → 全て modified_fields に含まれる
- [ ] 承認イベント後、`workspace_trust_metrics` が更新される
- [ ] `/api/trust-metrics` が正しい値を返す
- [ ] 30件未満で `insufficient_data` 表示
- [ ] 50件以上で stable レイアウト
- [ ] 200件以上+承認率95%以上で mature レイアウト
- [ ] 承認率が 80% を切ると mature → stable
- [ ] ワークスペース切替で信頼度UIも切り替わる
- [ ] 自動承認ON時に「自動承認モード中」表示

---

## 11. 既知の課題・将来検討事項

### 11.1 自動承認後の実精度測定

自動承認ON時の「実精度」は測れない(誰も検証していないため)。
将来:
- サンプル検証モード(自動承認結果の5%を人間に出す)
- 異常検知連動

これらは v2.7.0(異常検知)以降で別途設計。

### 11.2 取引先別の精度

「セブン-イレブンの仕訳精度98%」のような取引先別精度。
データ的には計算可能(shiwake_records から partner_name でグループ化)。
UI追加は v2.10.0 で検討。

### 11.3 期間カスタマイズ

「直近7日」「直近90日」など。
v2.10.0 以降で検討。

### 11.4 修正された値の学習

自動ルール学習(v2.5.0 = Phase 3)で実装予定。

### 11.5 差し戻し機能

承認後の編集を可能にする機能。v2.4 以降で検討。

### 11.6 バックグラウンド計算の信頼性

`workspace_trust_metrics` のバッチ更新が失敗した場合、API読み出し時に `last_calculated_at` 確認→1時間以上古ければオンデマンド再計算。

---

## 12. 関連ドキュメント

| ドキュメント | 役割 |
|---|---|
| `shiwake-ai_設計思想_v3_0.md` | 北極星 |
| `shiwake-ai_ワークスペース機能設計_v3_0_A3a.md` | 本書の前提 |
| **本書(A-3b v2)** | **信頼度メトリクス設計(改訂版)** |
| `shiwake-ai_料金プラン拡張設計_v3_0_A3c.md` | 独立、影響なし |
| `~/APP/shiwake-ai/session.js` | 作業中バッファ(温存) |

---

## 13. 想定実装ボリューム

| 領域 | ボリューム |
|---|---|
| DB変更(2テーブル + RPC関数) | 1日 |
| `master.js` 改修(method追加) | 0.5日 |
| `server.js` `/api/shiwake/approve` 新規 | 1〜2日 |
| `server.js` `/api/trust-metrics` 新規 | 0.5日 |
| `server.js` `recalculateTrustMetrics()` | 0.5日 |
| `server.js` `/api/workspaces` レスポンス拡張 | 0.5日 |
| フロント `_aiProposed` 保持 | 0.5日 |
| フロント `approve()` 改修 | 0.5日 |
| 信頼度ダッシュボード UI(3パターン) | 2〜3日 |
| ワークスペース一覧での精度表示 | 0.5日 |
| 動作確認・バグ修正 | 1〜2日 |
| **合計** | **2〜3週間**(専念時) |

初版 A-3b(1〜2週間)より長くなった理由:
- `shiwake_records` テーブル新設(基盤実装)
- 承認API新設
- フロントの保存ロジック追加

---

## 14. 改訂履歴

| 日付 | バージョン | 変更内容 |
|---|---|---|
| 2026-05-10 | A-3b 初版 | 既存テーブル前提で記述 |
| 2026-05-10 | A-3b v2(本書) | shiwake_records テーブル新設前提に全面改訂、session.js との役割分担明記 |

---

**作成日**: 2026年5月10日
**作成契機**: 初版 A-3b の前提テーブル誤認による全面改訂
**前提**: A-3a ワークスペース機能の実装完了(本書はその上に乗る)
**次のアクション**: 統合実装ロードマップ v3.0 の改訂(本書 v2 を反映)
