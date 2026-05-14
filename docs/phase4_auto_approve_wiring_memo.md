# Phase 4 自動承認: 結線ポイント調査メモ

作成日: 2026-05-14  
対象バージョン: v2.5.0 (HEAD: cc574bb)  
対象ファイル: server.js (2344行), index.html (4957行)

---

## 1. 仕訳生成箇所

**server.js:2466 `POST /api/analyze-chunk`**

処理順序（v2.5.0 確定済み）:
```
① 取引先マスタ（loadMaster）
② 学習ルール（findLearnedRuleMatch） ← ここで learnedRuleId が付与される
③ ハッシュキャッシュ（cacheHit: 'hash'）
④ Claude Sonnet（callClaudeWithFormat）
```

- マスタヒット: `item.masterApplied = true, item.masterKey`
- ルールヒット: `item.learnedRuleApplied = true, item.learnedRuleId`（server.js:2620-2629 および 2509-2511）
- AI出力: 上記いずれも非ヒット時

**自動承認フラグの差し込みタイミング**:  
analyze-chunk レスポンスに `_autoApprove: true` と `_autoApproveType: 'learned'|'all'` を付与するのが最もシンプル。  
ただし、信頼度とトグル状態の確認が必要なため、このエンドポイント内で workspaces を SELECT するコストが発生する。

---

## 2. 承認箇所

### 2-A: フロントエンド `approveGroup()` (index.html:4626)

```
approveGroup(indices)
  → 各 i に対して fetch('/api/shiwake/approve', {..., rule_id: r._rule_id})
```

- `r._source === 'learned_rule'` の場合のみ `rule_id` を渡している（index.html:4658）
- **自動承認差し込み点**: 自動承認フラグ付きアイテムに対して、ユーザー操作なしに `approveGroup` を呼ぶ新関数 `autoApproveItems(indices)` をフロント側に追加する

### 2-B: サーバー `POST /api/shiwake/approve` (server.js:3572)

```javascript
const { uid, workspace_id, session_id, record, rule_id } = JSON.parse(body);
// → INSERT INTO shiwake_records (...)
// → recalculateTrustMetrics(wsId)   非同期
// → checkAutoExportTrigger(uid, wsId) 非同期
// → detectAndStoreRules(wsId, ...)   非同期（auto_rule_learning_enabled 時）
```

**自動承認差し込み点 (server.js:3578)**:
1. リクエストボディに `auto_approved`, `auto_approve_type` を追加受け取り
2. INSERT payload (server.js:3608) に追加:
   ```javascript
   auto_approved: auto_approved || false,
   auto_approve_type: auto_approve_type || null,
   applied_learned_rule_id: (auto_approve_type === 'learned' ? rule_id : null) || null,
   ```
3. workspaces SELECT (server.js:3590) に追加カラムを含める:
   ```
   select=id,auto_rule_learning_enabled,auto_rule_strictness,
          auto_approve_learned_enabled,auto_approve_all_enabled,auto_approve_paused_at
   ```
4. 承認前に paused チェックを追加（paused_at が NULL でなければ自動承認をスキップ）

---

## 3. learned_rule 適用箇所

| 関数 | 場所 | 役割 |
|---|---|---|
| `findLearnedRuleMatch(partnerName, description, rules)` | server.js:1629 | パートナー名+キーワードでルール照合（純粋関数） |
| `incrementRuleApplied(ruleId)` | server.js:1644 | 適用カウントアップ（非同期） |
| `autoRuleAnomalyCheck(ruleId, strictness)` | server.js:1654 | 修正率チェック → anomaly_flag 設定（承認時に呼ばれる） |

**自動承認との関係**:
- `findLearnedRuleMatch` の戻り値の `id` が `applied_learned_rule_id` FK になる
- 自動承認でも `incrementRuleApplied` を呼ぶ（通常承認と同じカウント）
- 自動承認後にユーザーが手動修正した場合の `autoRuleAnomalyCheck` 呼び出しは別途検討（自動承認レコードの `rule_id` を引き継ぐ必要あり）

---

## 4. 信頼度再計算箇所

**`recalculateTrustMetrics(workspaceId)` (server.js:730)**

現在の呼び出し:
```javascript
supabaseQuery('/rpc/calc_trust_metrics', 'POST', { p_workspace_id: workspaceId, p_period: 'recent' })
supabaseQuery('/rpc/calc_trust_metrics', 'POST', { p_workspace_id: workspaceId, p_period: 'all' })
```

**trust_reset_at 反映の差し込み点**:
1. 関数先頭で workspaces から `trust_reset_at` を取得（1クエリ追加）:
   ```javascript
   const [wsData] = await supabaseQuery(`/workspaces?id=eq.${workspaceId}&select=trust_reset_at`);
   const resetAt = wsData?.trust_reset_at || null;
   ```
2. 'all' の呼び出しに `p_reset_at` を追加:
   ```javascript
   supabaseQuery('/rpc/calc_trust_metrics', 'POST', {
     p_workspace_id: workspaceId, p_period: 'all', p_reset_at: resetAt
   })
   ```
3. 'recent' は従来通り（30日固定）

**自動承認トグル解放チェックの差し込み点**:  
`recalculateTrustMetrics` の最後（workspace_trust_metrics UPSERT 後）に追加:
- `recentTrust >= 80` かつ `auto_approve_learned_unlocked_at` が NULL → workspaces に `unlocked_at` を書き込む
- `recentTrust >= 95` かつ `auto_approve_all_unlocked_at` が NULL → 同上
- `recentTrust < 80` かつ `(auto_approve_learned_enabled OR auto_approve_all_enabled)` → `auto_approve_paused_at = NOW()`
- `recentTrust >= 80` かつ `auto_approve_paused_at IS NOT NULL` → `auto_approve_paused_at = NULL`（自動解除）

---

## 5. 自動承認フロー全体図（提案）

```
analyze-chunk レスポンス
  → フロント: 各アイテムに _autoApprove フラグ付与判定
       ├─ workspace.auto_approve_all_enabled = true → 全件フラグ
       ├─ workspace.auto_approve_learned_enabled = true → learnedRuleApplied のみフラグ
       └─ paused_at IS NOT NULL → フラグなし（停止中）
  → フロント: _autoApprove = true なアイテムを即座に approveGroup() へ渡す
  → server.js POST /api/shiwake/approve (auto_approved: true, auto_approve_type: 'learned'|'all')
  → shiwake_records INSERT (auto_approved=true, ...)
  → recalculateTrustMetrics (非同期) → 閾値チェック → paused_at 更新
```

---

## 6. paused 状態の表現について

### 採用案: `auto_approve_paused_at TIMESTAMPTZ`
- NULL = 停止なし（通常）
- 非NULL = その日時に停止された（いつ止まったかが記録される）
- ✅ 推奨。停止時刻が監査ログとして機能する

### 代替案: `auto_approve_paused BOOLEAN`
- シンプルだが「いつ止まったか」が失われる
- ✗ 非推奨

### 代替案: `auto_approve_status TEXT` ('active' / 'paused' / 'unlocked')
- 状態が増えた場合に拡張しやすいが、現仕様ではオーバーエンジニアリング
- ✗ 非推奨（現時点では paused_at で十分）

---

## 7. 名前衝突・懸念点チェック

| 追加カラム | 衝突チェック | 判定 |
|---|---|---|
| `workspaces.auto_approve_learned_enabled` | 既存: `auto_rule_learning_enabled`, `auto_export_enabled` | ✅ 衝突なし |
| `workspaces.auto_approve_all_enabled` | — | ✅ 衝突なし |
| `workspaces.auto_approve_learned_unlocked_at` | 既存: `auto_rule_unlocked_at` | ✅ 衝突なし（別カラム）|
| `workspaces.auto_approve_all_unlocked_at` | — | ✅ 衝突なし |
| `workspaces.trust_reset_at` | — | ✅ 衝突なし |
| `workspaces.auto_approve_paused_at` | — | ✅ 衝突なし |
| `shiwake_records.auto_approved` | — | ✅ 衝突なし |
| `shiwake_records.auto_approve_type` | — | ✅ 衝突なし |
| `shiwake_records.applied_learned_rule_id` | — | ✅ 衝突なし |

### 懸念点

1. **`calc_trust_metrics` のシグネチャ変更**  
   既存の呼び出しはすべて2引数 (`p_workspace_id`, `p_period`)。  
   新パラメータ `p_reset_at DEFAULT NULL` はデフォルト付きのため**後方互換あり**（既存呼び出しを変更しなくてもよい）。

2. **`applied_learned_rule_id` の FK 設定**  
   `ON DELETE SET NULL` を推奨。learned_rule が削除されても shiwake_records の履歴は残す。

3. **自動承認時の `was_modified` / `modified_fields` の扱い**  
   自動承認では AI 提案をそのまま通すので `was_modified = false`, `modified_fields = NULL` が期待値。  
   `approve` 側での計算ロジック変更は不要（自動承認フラグを立てるだけでよい）。

4. **既存の `shiwake_records` レコードへの影響**  
   `auto_approved DEFAULT FALSE` → 既存レコードはすべて `false` になる。問題なし。

5. **`auto_approve_type` の値管理**  
   現状 `text` 型で `'learned'` / `'all'` の2値。将来拡張があれば `CHECK` 制約追加を検討。  
   今回は追加しない（仕様変更コスト vs 柔軟性のトレードオフ）。
