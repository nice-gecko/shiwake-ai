# Phase 4: status 列新設 実装影響メモ

作成日: 2026-05-14  
対象 SQL: `sql/v2_6_x_shiwake_status.sql`

---

## 1. status 値の設計

| 値 | 意味 | 遷移元 |
|---|---|---|
| `'approved'` | 通常承認済み（手動・自動どちらも）| INSERT 時デフォルト |
| `'reverted'` | 差し戻し済み（再レビュー待ち） | `'approved'` から revert API 呼び出し時 |
| `'re_approved'` | 差し戻し後に再承認済み | `'reverted'` から再承認時 |

既存レコードはすべて `DEFAULT 'approved'` で自動的に正しい値になる。UPDATE backfill 不要。

---

## 2. approved_at の revert 時の扱い → **履歴として保持（NULL にしない）**

### 現在の revert 実装（server.js:4804–4809）

```js
// approved_at をクリアして承認前状態に戻す
await supabaseQuery(`/shiwake_records?id=eq.${record_id}`, 'PATCH', { approved_at: null });
```

現状は `approved_at = null` で「承認前」に戻しているが、status 列導入後は以下の理由で **approved_at を保持する方が整合的**。

### 理由

1. **信頼度計算（calc_trust_metrics）が approved_at 基準で動いている**  
   `WHERE approved_at >= v_since` で全期間・30日・リセット後を計算している。  
   approved_at を NULL にすると「差し戻し前の承認実績」が信頼度計算から消える → 信頼度スコアが突然上下するリスク。

2. **自動承認ログ画面（server.js:4739）も approved_at 降順でソートしている**  
   NULL にするとログから消えてしまい、「いつ自動承認されたか」の履歴が失われる。

3. **detectAndStoreRules（server.js:1766）でも approved_at 基準で学習済みルールを参照している**  
   NULL にすると直近90日の学習データから外れる可能性がある。

4. **status='reverted' で「差し戻し済み」が判別できるので、approved_at は不要になる**  
   NULL の役割（承認前フラグ）を status 列が担う。

### 推奨する revert 時の PATCH 内容（次フェーズ実装用）

```js
await supabaseQuery(`/shiwake_records?id=eq.${record_id}`, 'PATCH', {
  status: 'reverted'
  // approved_at は変更しない（履歴として保持）
});
```

---

## 3. server.js で WHERE status を追加する必要がある箇所

### 【必須】エクスポート対象クエリ — status='reverted' を除外する

差し戻したレコードがエクスポートに混入しないよう、以下3箇所に `&status=neq.reverted` を追加する。

| 行番号 | クエリ内容 | 追加内容 |
|---|---|---|
| 449 | `exported_at=is.null&select=*` (merged モード) | `&status=neq.reverted` |
| 456 | `exported_at=is.null&select=*` (ws指定モード) | `&status=neq.reverted` |
| 622–623 | `exported_at=is.null&select=id` (未エクスポート件数) | `&status=neq.reverted` |
| 3855–3856 | `exported_at=is.null&select=id` (auto-export settings 画面) | `&status=neq.reverted` |

### 【必須】revert API — status を 'reverted' に更新

| 行番号 | 現状 | 変更内容 |
|---|---|---|
| 4807–4809 | `{ approved_at: null }` のみ | `{ status: 'reverted' }` に変更、approved_at は保持 |

### 【必須】承認 POST — status を明示的に 'approved' でセット

| 行番号 | 現状 | 変更内容 |
|---|---|---|
| 3709（INSERT 本体） | status 列なし | `status: 'approved'` を追加（DEFAULT があるので必須ではないが明示推奨） |

### 【検討】detectAndStoreRules — 差し戻し済みを学習から除外するか

| 行番号 | クエリ内容 | 検討事項 |
|---|---|---|
| 1766 | `approved_at=gte.${ninetyDaysAgo}&was_modified=eq.false` | `&status=neq.reverted` を追加することで「差し戻しされた仕訳をルール学習に使わない」ができる。v2.7 以降で検討。 |

### 【検討】calc_trust_metrics RPC — 差し戻し済みを信頼度から除外するか

現在の RPC は `WHERE approved_at >= v_since` で全レコードを対象にしている。  
「差し戻しされたレコードも信頼度計算に含めるか」は設計判断が必要。  
- **含める場合**: 承認ミスの実績として信頼度に反映される（厳しい評価）
- **除外する場合**: 手動で訂正されたことを信頼度に影響させない  
→ v2.7 以降で `AND status != 'reverted'` を追加するか検討。

---

## 4. index.html の再レビュー導線 — 候補

### Candidate A: 「自動承認ログ」画面に統合

- 現在 `v2.6.0` で実装済みの自動承認ログ画面（サイドバー「自動承認ログ」）
- 「差し戻し済み」フィルタタブを追加するだけで再レビュー一覧として機能する
- **メリット**: 新規画面不要、承認→差し戻し→再承認のフロー文脈が揃う
- **デメリット**: 手動承認分の差し戻しは「自動承認ログ」に表示するのが不自然

### Candidate B: 「仕訳レビュー」画面（既存）に「差し戻し待ち」タブ追加

- 既存の仕訳レビュー画面に `status='reverted'` 件数バッジを付け、タブ切り替えで表示
- **メリット**: 再承認が同じ画面でできる（UX が自然）
- **デメリット**: 既存レビュー画面の改修量が増える

### Candidate C: 独立した「差し戻し一覧」ページ

- サイドバーに「差し戻し待ち」メニューを新設（バッジで件数表示）
- **メリット**: 目立つ、専用 API 設計しやすい
- **デメリット**: ページ追加コストが高い

**推奨**: 最初は **Candidate A**（自動承認ログへの統合）でコスト最小化し、手動承認の差し戻しが増えたら Candidate B に移行する。

---

## 5. 既存ロジックへのリスク・懸念点

### リスク 1: DEFAULT 'approved' の適用タイミング

Supabase の `ALTER TABLE ... ADD COLUMN ... DEFAULT` は既存行に即座にデフォルト値を設定する（PostgreSQL 11+ の挙動）。  
→ **UPDATE backfill 不要、既存データへの影響ゼロ**。

### リスク 2: revert API の approved_at=null からの移行

現在 `{ approved_at: null }` で「承認前」に戻しているが、status 列導入後に `approved_at=null` のままにすると「reverted なのに approved_at が null」という中途半端な状態が残る。  
→ **revert API の実装変更と status 列追加は同タイミングで行うこと**（分離して中途半端な状態にしない）。

### リスク 3: CHECK 制約の扱い

`CHECK (status IN ('approved', 'reverted', 're_approved'))` は INSERT/UPDATE 時に強制される。  
将来値を追加する場合（例: `'pending'`）は `ALTER TABLE` で制約変更が必要。  
→ 今後の拡張性を考えると CHECK 制約なしにする選択肢もあるが、今のフェーズでは安全側を取る。

### リスク 4: 既存の `exported_at=is.null` クエリへの漏れ

差し戻しレコードは `exported_at=null`（エクスポートされていない）なので、`status=neq.reverted` を忘れるとエクスポートに混入する。  
→ **上記3箇所の修正を必ずセットで行うこと**（§3 の「必須」リスト参照）。
