# Cowork 指示書: 税理士事務所リード探索

## あなたの役割

shiwake-ai のターゲット顧客である税理士事務所を Web 検索で見つけて、
leads テーブルに投入できる形式で一覧化する。

---

## 入力（DSKさんから受け取る情報）

| 項目 | 例 |
|------|----|
| エリア | 「東京23区」「大阪市」「全国」 |
| 件数 | 「10件」「30件」 |
| 特徴フィルタ（任意） | 「法人税務に強い」「相続専門」「IT 導入支援に積極的」 |
| 規模（任意） | small(1-3名) / medium(4-10名) / large(10名超) |

---

## 作業手順

### Step 1: Web 検索でリスト作成

- Google で「[エリア] 税理士事務所 [特徴フィルタ]」を検索
- 公式 HP がある事務所を優先
- 各事務所の公式 HP にアクセスして以下を取得:

| 取得項目 | 備考 |
|----------|------|
| 事務所名 | company_name |
| 代表税理士名 | contact_person（可能なら） |
| メールアドレス | email（問い合わせフォームしかない場合は webform フラグ） |
| 電話番号 | phone |
| 住所 | address（事業所のみ、自宅住所は取得しない） |
| スタッフ数 | size_estimate 判定材料 |
| 専門分野 | specialty |
| HP の作り込み | digital_savvy_score 判定材料 |

### Step 2: 規模・スコア判定

**size_estimate:**
- `small`: 1人税理士事務所 or 個人スタッフ数名（1-3名）
- `medium`: 中規模事務所、IT・複数業界対応（4-10名）
- `large`: 税理士法人、複数拠点（10名超）

**digital_savvy_score（1-5）:**
- 1: HP がない or 2010年代の古いデザイン
- 2: HP はあるが更新されていない、ブログなし
- 3: HP は普通、ブログがあるが更新は半年に1回程度
- 4: HP がモダン、ブログ月1以上、SNS あり
- 5: HP が極めて作り込まれている、週次ブログ更新、複数 SNS 活用

**priority_score（1-5）:**
- digital_savvy_score 3-5 → AI ツール導入の素地あり → 加点
- 法人税務・複数業界対応 → AI 仕訳の需要高 → 加点
- 規模 medium → 効率化ニーズ大 → 加点

### Step 3: leads テーブル投入用 CSV 作成

出力形式（レイアウト固定）:

```csv
company_name,contact_person,email,phone,website,address,size_estimate,specialty,digital_savvy_score,priority_score,notes
山田税理士事務所,山田太郎,info@yamada-tax.jp,03-1234-5678,https://yamada-tax.jp,東京都新宿区...,medium,"法人税務,相続",4,4,代表ブログで電子帳簿保存法について熱心に発信
```

### Step 4: 出力場所

- ローカル: `~/APP/shiwake-ai/pr-agent/dashboard/output/leads/`
- ファイル名: `leads_YYYY-MM-DD_HHmmss.csv`
- DSKさんに保存場所を報告

### Step 5: Supabase 投入

権限がある場合は直接 INSERT。ない場合は CSV を DSKさんに渡し、Supabase Studio から手動インポート。

---

## NG 行動

- 個人税理士の**自宅住所**は取得しない（公開 HP にある事業所住所のみ）
- 税理士会の**非公開名簿**から取得しない
- 個別事務所の**顧問先名など機密情報**に立ち入らない
- **自動クローラー**でサイトを大量収集しない（各サイトは手動アクセスで OK）

---

## 完了報告フォーマット

```
✅ リード探索完了
- エリア: <エリア>
- 取得件数: <件数>件
- 高優先度(priority 4-5): <件数>件
- CSV 保存先: ~/APP/shiwake-ai/pr-agent/dashboard/output/leads/leads_YYYY-MM-DD_HHmmss.csv
- Supabase 投入: 完了 / 手動インポート待ち
```
