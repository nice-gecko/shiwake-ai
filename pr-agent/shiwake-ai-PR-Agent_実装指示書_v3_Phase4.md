# shiwake-ai-PR Agent 実装指示書 v3.0 — Phase 4 詳細版

> 本ファイルは Phase 4(Week 5 相当・短縮版)の実装指示書。
> Phase 1・2・3 が完走済みの前提で記述している。
> 作成: 2026-05-09 / 指示出し: Web版Claude / 実装: claude code
>
> **前提となる完了済みタスク**:
> - Phase 1: T1-1〜T1-9, T2-3, T2-4, T2-6(Threadsへの3案生成 → Discord通知 → 承認 → 投稿)
> - Phase 2: P2-1〜P2-4(Analyst, MaterialScout, Pipeline統合, Cowork指示書 x_metrics_collect/visual_generation)
> - Phase 3: P3-1〜P3-5(Panic, TrendWatcher, 自動化解禁, note補助, 勝ちパターン抽出)

---

## 0. claude code への申し送り(Phase 4 共通)

- **トークン節約最優先**(着手前に DSKさんへ「これから○○を作ります」と確認)
- 5回セルフチェック → push
- `cd ~/APP/shiwake-ai/pr-agent` 後、ディレクトリ移動を挟まず git一括
- shiwake-ai 設計思想「判断の見える化」を PR Agent 側にも適用
- **Cowork は DSKさん側で動かす**(claude code の実装範囲外、🖥 マークで識別)
- Phase 4 は **「事業化フェーズ」**(Phase 1〜3 で集めたデータを使って収益・営業に繋げる)

### v3 凡例(継続)

```
🤖 Cloud Run Agent  = LangGraph で動く 24時間自律本体
👨‍💻 Claude Code     = ローカルでコード実装(本実装指示書の対象)
🖥 Cowork           = DSKさんの Mac で動く AI 同僚(別指示書で運用)
👤 DSKさん本人        = 手動操作
```

### Phase 4 の特殊性

引き継ぎ文書 v3 骨組み記載の通り、Phase 4 は **「Cowork 代替で工数圧縮」**を活用する設計。

```
当初想定(v2): 5〜7日
v3 で Cowork 代替化: 0.5〜1日
合計工数削減: 約5〜6日
```

→ Claude Code が書くコード量は最小限、Cowork 指示書(Markdown)が実質メイン。

---

## 1. Phase 4 全体像

### 目的

Phase 1〜3 で完成した「投稿 → 計測 → 学習 → 拡散」のループに、以下を追加する:

第一に、**営業自動化**(P4-2): 税理士事務所リードの自動探索 + カスタマイズ営業メール下書き

第二に、**技術ブランディング**(P4-1): Zenn での技術記事自動投稿(SEO効果 + エンジニア層への認知)

第三に、**運用最適化**(P4-3): ダッシュボード強化、月次レポートの可視化、Cowork 連携の整備

### 完了の定義

```
1. ダッシュボードから「税理士事務所リード10件探して」とトリガー → Cowork が指示書を実行 → leads テーブルに10件投入
2. 各リードに対してカスタマイズメール下書きが生成され、outreach_history テーブルに記録される
3. Zenn 記事の Markdown が自動生成され、GitHub の zenn-content リポジトリに push される
4. ダッシュボードに月次レポートビューが追加される(リーチ・エンゲージメント・新規ユーザー)
5. 「W3 × zeirishi_sensei × altruism が今月の勝者」のような勝ちパターンが可視化される
```

### Phase 4 タスク一覧(優先順)

| ID | タスク | 担当 | 工数目安 | 優先度 |
|----|------|------|---------|------|
| P4-2 | 営業ツール(Cowork指示書3本) | 👨‍💻 + 🖥 | 0.5日 | 🔴 最高 |
| P4-3 | ダッシュボード強化 | 👨‍💻 | 1日 | 🟡 高 |
| P4-1 | Zenn 連携(GitHub経由) | 👨‍💻 | 0.5日 | 🟢 中 |

**合計: 2日**(当初v2の5〜7日 → 大幅短縮)

---

## 2. P4-2: 営業ツール(Cowork指示書3本)【最優先】

### 2.1 設計方針

**Cowork で完全代替**(v3 引き継ぎ文書の方針):

- Web 検索・人間的判断・カスタマイズが必要な作業は Cowork に任せる
- Claude Code は連携用の最小実装のみ(Supabase テーブル、API エンドポイント)
- DSKさんが Cowork に「これやって」と頼むだけで作業完結する設計

### 2.2 既存テーブル活用(Phase 1で定義済)

```sql
-- leads テーブル(Phase 1 schema.sql で定義済の想定)
create table if not exists leads (
    id uuid primary key default gen_random_uuid(),
    company_name text not null,                  -- 税理士事務所名
    contact_person text,                         -- 担当者名(代表税理士など)
    email text,
    phone text,
    website text,
    address text,
    
    -- 事務所の特徴(Cowork が分析して書き込む)
    size_estimate text,                          -- 'small'(1-3名) / 'medium'(4-10名) / 'large'(10名超)
    specialty text[],                            -- ['法人税務', '相続', '国際税務'] など
    digital_savvy_score integer,                 -- 1-5(HPの作りこみ・ブログ更新頻度から判定)
    
    -- 営業優先度
    priority_score integer,                      -- 1-5(specialty + size + digital_savvy から算出)
    target_persona text default 'P4',            -- どのペルソナでアプローチするか
    
    -- メタ情報
    found_at timestamptz default now(),
    found_by text default 'cowork',              -- 'cowork' / 'manual' / 'referral'
    notes text,                                  -- Cowork のメモ
    status text default 'new'                    -- 'new' / 'contacted' / 'replied' / 'converted' / 'rejected' / 'archived'
);

create index idx_leads_priority on leads(priority_score desc);
create index idx_leads_status on leads(status);

-- outreach_history テーブル
create table if not exists outreach_history (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references leads(id) on delete cascade,
    sent_at timestamptz default now(),
    channel text not null,                       -- 'email' / 'phone' / 'in_person' / 'webform'
    subject text,                                -- メール件名(channel='email'の場合)
    body text,                                   -- メール本文 / 通話メモ等
    template_used text,                          -- 使った文面テンプレ識別子
    sent_by text default 'cowork',               -- 'cowork' / 'dsk' / 'auto'
    
    -- 反応
    response_received boolean default false,
    response_received_at timestamptz,
    response_summary text,                       -- 返信内容の要約(Cowork が記録)
    response_sentiment text,                     -- 'positive' / 'neutral' / 'negative'
    
    -- 結果
    led_to_meeting boolean default false,
    led_to_signup boolean default false,
    notes text
);

create index idx_outreach_lead on outreach_history(lead_id);
create index idx_outreach_sent on outreach_history(sent_at desc);
```

→ Phase 1 の `memory/schema.sql` に上記が含まれているか確認。なければ追記して Supabase に適用。

### 2.3 Cowork 指示書 #1: `cowork_handoff/lead_finder.md`

```markdown
# Cowork 指示書: 税理士事務所リード探索

## あなたの役割
shiwake-ai のターゲット顧客である税理士事務所を Web 検索で見つけて、
leads テーブルに投入できる形式で一覧化する。

## 入力(DSKさんから受け取る情報)
- **エリア**: 例「東京23区」「大阪市」「全国」
- **件数**: 例「10件」「30件」
- **特徴フィルタ**(任意): 例「法人税務に強い」「相続専門」「IT 導入支援に積極的」
- **規模**(任意): 'small'(1-3名) / 'medium'(4-10名) / 'large'(10名超)

## 作業手順

### Step 1: Web 検索でリスト作成
- Google で「[エリア] 税理士事務所 [特徴フィルタ]」を検索
- 公式 HP がある事務所を優先
- 各事務所の公式 HP にアクセスして以下を取得:
  - 事務所名
  - 代表税理士名(可能なら)
  - メールアドレス(問い合わせフォームしかない場合は webform フラグ)
  - 電話番号
  - 住所
  - 所属税理士・スタッフ数(規模判定)
  - 専門分野(specialty)
  - HP の作り込み・ブログ更新頻度(digital_savvy_score 判定材料)

### Step 2: 規模・スコア判定
- **size_estimate**:
  - small(1-3名): 1人税理士事務所 or 個人スタッフ数名
  - medium(4-10名): 中規模事務所、IT・複数業界対応
  - large(10名超): 法人税理士法人、複数拠点
  
- **digital_savvy_score**(1-5):
  - 1: HP がない or 古い(2010年代の作り)
  - 2: HP はあるが更新されてない、ブログなし
  - 3: HP は普通、ブログがあるが更新は半年に1回程度
  - 4: HP がモダン、ブログ更新が月1以上、SNS あり
  - 5: HP が極めて作り込まれてる、毎週ブログ更新、複数SNS活用

- **priority_score**(1-5):
  - digital_savvy_score が 3-5 = AI ツール導入の素地あり → 加点
  - 法人税務・複数業界対応 = AI 仕訳の需要高 → 加点
  - 規模 medium = 効率化ニーズ大 → 加点

### Step 3: leads テーブル投入用 CSV 作成
出力形式(レイアウト固定):

```csv
company_name,contact_person,email,phone,website,address,size_estimate,specialty,digital_savvy_score,priority_score,notes
山田税理士事務所,山田太郎,info@yamada-tax.jp,03-1234-5678,https://yamada-tax.jp,東京都新宿区...,medium,"法人税務,相続",4,4,代表ブログで電子帳簿保存法について熱心に発信
```

### Step 4: 出力場所
- ローカル: `~/APP/shiwake-ai/pr-agent/dashboard/output/leads/`
- ファイル名: `leads_YYYY-MM-DD_HHmmss.csv`
- DSKさんに保存場所を報告

### Step 5: Supabase 投入(可能なら)
- DSKさんが Supabase MCP 経由で leads テーブルに投入できる権限を渡している場合、Cowork が直接 INSERT 実行
- 権限がない場合は CSV ファイルを DSKさんに渡し、DSKさんが Supabase Studio から手動インポート

## NG 行動
- **個人税理士の自宅住所など、プライバシー情報を取得しない**(公開HPにある事業所住所のみ)
- **税理士会の名簿(非公開)から取得しない**
- **個別事務所の機密情報(顧問先名など)に立ち入らない**
- **自動化ツールでサイトを大量クロールしない**(各サイトは手動アクセスで OK)

## 完了報告
作業完了時に以下を報告:
```
✅ リード探索完了
- エリア: <エリア>
- 取得件数: <件数>件
- 高優先度(priority 4-5): <件数>件
- CSV 保存先: <パス>
- Supabase 投入: 完了 / 手動インポート待ち
```
```

### 2.4 Cowork 指示書 #2: `cowork_handoff/outreach_writer.md`

```markdown
# Cowork 指示書: カスタマイズ営業メール下書き

## あなたの役割
leads テーブルから営業対象のリードを選択し、
各リードにカスタマイズした営業メール下書きを作成する。

## 入力(DSKさんから受け取る情報)
- **対象**: lead_id 一覧 or「直近追加されたリード」「priority 4-5 のみ」など
- **メールトーン**: 'formal'(かしこまった)/ 'friendly'(親しみのある)/ 'professional'(プロフェッショナル)
- **CTA**: 何をお願いするか('demo'(デモ依頼)/ 'meeting'(打ち合わせ)/ 'trial'(無料試用))

## 作業手順

### Step 1: 対象リードの取得
- Supabase の leads テーブルから対象リードを SELECT
- 各リードについて以下を確認:
  - company_name(事務所名)
  - contact_person(代表名、あれば)
  - specialty(専門分野)
  - notes(Cowork が探索時に記録した特徴)
  - digital_savvy_score(導入素地)

### Step 2: メール下書き作成

**フォーマット**:
```
件名: [事務所名]様 - 仕訳業務の効率化につきまして(shiwake-ai)

[事務所名] [代表名]様

突然のご連絡失礼いたします。
合同会社和泉グミ代表の和泉と申します。

御社の HP にて、[notes から拾った具体的な特徴]を拝見しました。
[特徴に対するコメント、なぜ shiwake-ai が貴所にフィットすると考えるか]

弊社では、AIを活用した仕訳補助ツール「shiwake-ai」を提供しており、
税理士事務所様向けには以下のメリットがあります:

- [specialty に応じた具体的なベネフィット 2-3点]

無料デモのご案内をさせていただきたく、
ご都合の良い日時をいくつか教えていただけますでしょうか。

shiwake-ai 詳細: https://shiwake-ai.com

何卒よろしくお願いいたします。

合同会社和泉グミ
代表 和泉大介
support@shiwake-ai.com
```

### Step 3: カスタマイズの肝
- **必ず1リードに1メールをカスタマイズ**(コピペ・テンプレ流用は禁止)
- notes に書かれた特徴を少なくとも1つは引用する
- specialty に応じたベネフィットを 2-3 個列挙
- digital_savvy_score が低い場合は「導入の手軽さ」を強調、高い場合は「機能の専門性」を強調

### Step 4: ガードレール(必須チェック)
以下を含むメールは送らない・修正する:
- ❌ 競合社名(freee, マネーフォワード, 弥生)
- ❌ 税法の数値・条文の断定(「税率は◯%」と書くのは NG、根拠リンク必須)
- ❌ 誇大表現(「絶対に儲かる」「100%失敗しない」など)
- ❌ 機密情報・個人情報

### Step 5: 出力
各メールを以下の形式で保存:
- ローカル: `~/APP/shiwake-ai/pr-agent/dashboard/output/outreach/draft_[lead_id]_[YYYY-MM-DD].md`
- 内容:
  ```
  ---
  lead_id: <UUID>
  company_name: <事務所名>
  contact_email: <メールアドレス>
  channel: email
  generated_at: <ISO8601>
  ---
  件名: ...
  本文: ...
  ```

### Step 6: outreach_history テーブル投入
- DSKさんがレビュー後、送信した分について outreach_history に INSERT
- 送信前は status='draft' のまま、送信後に status='sent' へ更新

## NG 行動
- DSKさんのレビューなしで送信しない(草稿のみ作成)
- ガードレール違反があれば DSKさんに警告
- 同じ文面を複数リードに送らない(必ずカスタマイズ)

## 完了報告
作業完了時に以下を報告:
```
✅ メール下書き作成完了
- 対象件数: <件数>件
- ガードレール違反検知: <件数>件(あれば詳細を報告)
- 草稿保存先: <パス>
- DSKさんレビュー待ち
```
```

### 2.5 Cowork 指示書 #3: `cowork_handoff/monthly_report.md`

```markdown
# Cowork 指示書: 月次レポート作成

## あなたの役割
shiwake-ai PR Agent の月次運用レポートを作成する。
Memory Bank(Supabase)から集計し、Google スプレッドシート or Markdown レポートを生成。

## 入力(DSKさんから受け取る情報)
- **対象月**: 例「2026-04」
- **出力形式**: 'sheet'(Google スプレッドシート)/ 'md'(Markdown)/ 'both'

## 作業手順

### Step 1: データ集計
Supabase から以下を取得・集計:

#### 投稿系
- 月内の投稿総数(プラットフォーム別: Threads / Instagram / X / note / Zenn)
- 公開済 / 草稿 / 却下の比率
- ペルソナ別投稿数(P1-P4)
- キャラ別投稿数(shoyo_kun / shoyo_chan / zeirishi_sensei / keiri_san / shacho)
- 構文別投稿数(W1-W6)
- トリガー別投稿数(Antagonism / Altruism / Storytelling)

#### エンゲージメント系
- 月内総リーチ(impressions 合計)
- 総いいね・リポスト・コメント数
- エンゲージメント率の平均と最高値
- 24h時点のエンゲージメント率上位5投稿(投稿テキスト + ペルソナ × キャラ × 構文 × トリガー)

#### 成果系
- バズった投稿数(Panic 発火回数)
- 自動化解禁状態の推移
- 勝ちパターン上位3(success_patterns から)
- 負けパターン下位3(改善対象)

#### 営業系(P4-2 連動)
- 月内に追加されたリード数
- メール送信数
- 返信率(response_received=true / sent 数)
- ミーティング獲得数(led_to_meeting=true)
- サインアップ獲得数(led_to_signup=true)

### Step 2: 出力フォーマット

#### 'sheet'(Google スプレッドシート)
- スプレッドシートを新規作成 or 既存ファイルに月次タブ追加
- ファイル名: `shiwake-ai-PR-Agent_月次レポート_YYYY`
- タブ名: `YYYY-MM`
- セクション:
  1. サマリー(全数値1ページに集約)
  2. 投稿一覧
  3. エンゲージメント分析
  4. 勝ちパターン / 負けパターン
  5. 営業実績
  6. 翌月の推奨アクション(Cowork が分析・記述)

#### 'md'(Markdown)
- 出力場所: `~/APP/shiwake-ai/pr-agent/dashboard/output/reports/YYYY-MM_monthly_report.md`
- フォーマット:
  ```markdown
  # shiwake-ai PR Agent 月次レポート(YYYY-MM)
  
  ## エグゼクティブサマリー
  - 総投稿数: XX件 / 公開: XX件 / 却下: XX件
  - 総リーチ: XXX,XXX
  - エンゲージメント率: X.XX%
  - 営業: リード XX件 / メール送信 XX件 / 返信 XX件
  
  ## 投稿分析
  ### プラットフォーム別
  ...
  
  ## エンゲージメント分析
  ### 上位5投稿
  ...
  
  ## 勝ちパターン
  ### TOP3
  1. P3 × zeirishi_sensei × W3 × altruism @threads → 勝率 85%
  ...
  
  ## 営業実績
  ...
  
  ## 翌月の推奨アクション
  Cowork による分析:
  - W3(専門知識)構文の発信を増やす(現在の主力)
  - P4(税理士)向け Zenn 記事を強化(技術ブランディング)
  - X 手動投稿の頻度を週2 → 週3 に
  ...
  ```

### Step 3: ダッシュボード連携
- 生成したレポートを `dashboard/output/reports/` に配置
- ダッシュボードの「月次レポート」タブで参照可能にする(P4-3 で実装)

### Step 4: Discord 通知
完了時に Discord に以下を送信:
```
📊 月次レポート作成完了(YYYY-MM)
- 総投稿数: XX件 / 総リーチ: XXX,XXX
- 営業: リード XX件 / 返信 XX件
- 詳細: [スプレッドシート / レポートへのリンク]
```

## NG 行動
- 数値の捏造(該当データなしの場合は "N/A" 表記)
- センシティブな個別投稿内容を社外共有可能な形式で出力しない(社内利用前提)
- 顧客個人情報を含む形でレポートを作らない

## 完了報告
作業完了時に以下を報告:
```
✅ 月次レポート作成完了
- 対象月: YYYY-MM
- 出力形式: <sheet/md/both>
- スプレッドシートURL: <URL>(該当時)
- Markdown ファイル: <パス>
- Discord 通知: 完了
```
```

### 2.6 Claude Code 側で必要な実装(最小)

```python
# brain/sales_pipeline.py(新規)

"""
P4-2: 営業ツール連携 — Cowork が leads / outreach_history を扱うための補助コード

主な機能:
- leads テーブルの読み書き API
- outreach_history の集計
- ダッシュボードからの「リード探索トリガー」発火

CLI:
  uv run python -m brain.sales_pipeline list-leads --status new --priority-min 4
  uv run python -m brain.sales_pipeline import-leads --csv path/to/leads.csv
  uv run python -m brain.sales_pipeline outreach-stats --month 2026-04
"""

# 詳細実装は最小限。Cowork が読み書きしやすい CLI を提供すれば十分。
# ダッシュボードの API 経由でも同じデータにアクセス可能にする。
```

→ コードは Cowork が動作するための最小限の補助のみ。実際の業務ロジックは Cowork 指示書に集約。

---

## 3. P4-3: ダッシュボード強化【優先度・高】

### 3.1 設計方針

Phase 1〜3 で作ったダッシュボード(FastAPI + Tailwind)を以下の方向で強化:

第一に、**月次レポートビュー**(P4-2 の monthly_report と連動)
第二に、**営業ステータス可視化**(leads / outreach_history の集計表示)
第三に、**勝ちパターン可視化の強化**(P3-5 の success_patterns を見やすく)
第四に、**Cowork 連携 UI**(指示書を選んで実行ボタン → Cowork に依頼内容が伝わる)

### 3.2 追加するエンドポイント・ビュー

#### `/api/sales/leads`(新規)
- GET: leads 一覧(フィルタ: status / priority / found_by)
- POST: 新規リード追加(Cowork 経由 or 手動)
- PATCH `/api/sales/leads/:id`: ステータス更新

#### `/api/sales/outreach`(新規)
- GET: outreach_history 一覧(フィルタ: lead_id / channel / sent_at)
- POST: 新規送信履歴追加

#### `/api/sales/stats`(新規)
- GET: 営業 KPI 集計(月別、累計)

#### `/api/reports/monthly`(新規)
- GET `/api/reports/monthly/:yyyy-mm`: 月次レポート取得(Markdown or JSON)
- POST: 月次レポート生成依頼(Cowork 起動シグナル)

#### `/api/cowork/trigger`(新規)
- POST: Cowork 指示書を実行依頼
- パラメータ: `{ instruction: 'lead_finder', params: {...} }`
- 動作: dashboard/output/cowork_requests/ に実行依頼ファイルを作成
- Cowork 側はこのファイルを監視 or DSKさんが手動で Cowork に渡す

### 3.3 追加するフロントエンドビュー

#### 「営業」タブ(新規)
- リード一覧テーブル(ソート・フィルタ可能)
- 各リードに対する outreach_history(展開ビュー)
- 「リード探索」ボタン → Cowork 起動依頼

#### 「月次レポート」タブ(新規)
- 月選択ドロップダウン
- レポート本文表示(Markdown レンダリング)
- 過去レポートへのリンク
- 「今月のレポート生成」ボタン → Cowork 起動依頼

#### 「勝ちパターン」タブ(P3-5 の強化版)
- TOP10 勝ちパターン
- 負けパターン(改善対象)TOP5
- ペルソナ別 / キャラ別 / 構文別 / トリガー別の集計グラフ
- 自動化解禁の判断材料を一画面で見える化

### 3.4 Cowork 連携バッファ構造

```
~/APP/shiwake-ai/pr-agent/dashboard/output/
├── cowork_requests/                    ← ⭐ ダッシュボードが Cowork に依頼を出す場所
│   ├── 2026-05-09_lead_finder.json
│   ├── 2026-05-09_outreach_writer.json
│   └── 2026-05-09_monthly_report.json
├── leads/                              ← Cowork が leads を出力する場所(P4-2)
│   └── leads_2026-05-09_140530.csv
├── outreach/                           ← Cowork が outreach 草稿を出す場所(P4-2)
│   ├── draft_<uuid1>_2026-05-09.md
│   └── draft_<uuid2>_2026-05-09.md
├── reports/                            ← Cowork が月次レポートを出す場所(P4-2)
│   └── 2026-04_monthly_report.md
└── note_drafts/                        ← Phase 3 から継続
    ├── 2026-05-09_インボイス制度の落とし穴.md
    └── posted/
```

### 3.5 cowork_requests/*.json のフォーマット

```json
{
  "instruction": "lead_finder",
  "params": {
    "area": "東京23区",
    "count": 10,
    "specialty_filter": "法人税務",
    "size": "medium"
  },
  "requested_at": "2026-05-09T14:05:30+09:00",
  "requested_by": "dashboard",
  "status": "pending"
}
```

→ Cowork が定期的にこのディレクトリを見るか、DSKさんが Cowork に「未処理の依頼やって」と言うことで実行される。

---

## 4. P4-1: Zenn 連携(GitHub経由)【優先度・中】

### 4.1 設計方針

Zenn は GitHub と連携して、`zenn-content` リポジトリにマークダウンを push すれば自動的に記事として公開される仕組み。

→ つまり **Zenn API は不要**、GitHub にコミット&プッシュするだけで動く。

### 4.2 連携の流れ

```
ダッシュボードで「Zenn 記事生成」ボタン
  ↓
Writer ノード(Zenn 用長文モード、3000-5000字、技術記事フォーマット)で生成
  ↓
~/APP/shiwake-ai/pr-agent/dashboard/output/zenn_drafts/ に Markdown を配置
  ↓
Discord 通知「Zenn 下書きできました、レビューして承認してください」
  ↓
DSKさんが承認(ダッシュボードの承認ボタン)
  ↓
Claude Code(または手動)で zenn-content リポジトリに移動・push
  ↓
数分後に Zenn に公開される
```

### 4.3 必要な準備(初回のみ)

```bash
# zenn-content リポジトリのセットアップ(GitHub & ローカル)
mkdir ~/APP/zenn-content
cd ~/APP/zenn-content
git init
npm install zenn-cli
npx zenn init

# GitHub に push
git remote add origin git@github.com:nice-gecko/zenn-content.git
git push -u origin main

# Zenn の管理画面で「GitHub からのデプロイ」を有効化
# https://zenn.dev/dashboard/deploys
```

### 4.4 Zenn 記事フォーマット

```markdown
---
title: "shiwake-ai における Memory Bank 設計 — Supabase × LangGraph で勝ちパターンを学習する"
emoji: "🧠"
type: "tech"
topics: ["langgraph", "supabase", "ai", "agent"]
published: true
---

## はじめに

(本文 3000-5000字、技術ブログとして読み応えがある内容)

...

## まとめ

shiwake-ai では、上記のアーキテクチャで「投稿 → 計測 → 学習」のループを回しています。
記事中で触れた API は [shiwake-ai.com](https://shiwake-ai.com) でも使われています。

(著者プロフィール、shiwake-ai リンクなどを footer に)
```

### 4.5 コード骨格(`brain/zenn_writer.py` 新規)

```python
"""
P4-1: Zenn 記事生成

Writer ノードを Zenn 用長文モードで起動し、Markdown 記事を生成。
zenn-content リポジトリ用のフォーマットで出力。

CLI:
  uv run python -m brain.zenn_writer generate --topic "Memory Bank 設計"
  uv run python -m brain.zenn_writer publish --draft 2026-05-09_memory-bank-design.md
"""

# Writer の長文モードに切り替え、3000-5000字を生成
# Zenn のフロントマター(title/emoji/type/topics/published)を自動付与
# 出力先: ~/APP/shiwake-ai/pr-agent/dashboard/output/zenn_drafts/
# 承認後、zenn-content リポジトリにコピー → git commit → push
```

### 4.6 トピック選定方針

技術ブランディングが目的なので、以下のテーマを優先:

第一に、**shiwake-ai の技術記事**:
- Memory Bank 設計(Supabase × LangGraph)
- 仕訳判定の AI ロジック(誤判定の補正手法)
- マルチペルソナ × マルチキャラのプロンプト設計

第二に、**PR Agent の技術記事**:
- LangGraph で 24時間自走 Agent を作る
- Claude Sonnet 4.6 を使った3案生成プロンプト設計
- Supabase で Memory Bank を実装する

第三に、**会計テック × AI の汎用記事**:
- AI 仕訳の精度向上テクニック
- 経理業務の自動化アーキテクチャ
- 中小企業のデジタル化の実装パターン

→ 月2-3本ペース、エンジニア層へのリーチ + SEO効果を狙う。

---

## 5. テスト計画

### 5.1 単体テスト

| ノード/機能 | テスト方法 |
|----------|---------|
| sales_pipeline | `uv run python -m brain.sales_pipeline list-leads --status new` で SELECT 確認 |
| ダッシュボード /api/sales/leads | curl で GET / POST 確認 |
| ダッシュボード /api/cowork/trigger | POST → cowork_requests/*.json が生成されるか |
| zenn_writer | `--topic "テスト"` で Zenn フォーマットの md が生成されるか |

### 5.2 Cowork 連携テスト

```
1. ダッシュボードから「リード探索: 東京23区, 10件」をトリガー
2. cowork_requests/lead_finder.json が生成されることを確認
3. DSKさんが Cowork に「未処理の依頼やって」と指示
4. Cowork が lead_finder.md の手順を実行
5. leads/ に CSV が出力される
6. Supabase の leads テーブルに10件投入される
7. ダッシュボード「営業」タブで10件のリードが表示される
```

### 5.3 統合テスト(Phase 4 完了の最終確認)

```bash
# 1. 営業フロー
# ダッシュボード → リード探索トリガー → Cowork → leads 投入 → outreach 草稿生成 → DSK レビュー → 送信記録

# 2. 月次レポート
# ダッシュボード → 月次レポート生成トリガー → Cowork → reports/ に Markdown 出力 → ダッシュボードで表示

# 3. Zenn 記事
uv run python -m brain.zenn_writer generate --topic "Memory Bank 設計"
# → zenn_drafts/ に Markdown 出力
# → 承認 → zenn-content リポジトリに push → Zenn 公開
```

---

## 6. Phase 4 完了の定義

以下の全てが動く状態で Phase 4 完了:

第一に、**営業ツール動作**: ダッシュボードからリード探索 → Cowork 経由で leads 投入 → カスタマイズメール下書き生成 → outreach_history 記録

第二に、**月次レポート動作**: ダッシュボードからトリガー → Cowork が Memory Bank 集計 → reports/ に Markdown 出力 → ダッシュボードで参照可能

第三に、**Zenn 連携動作**: Writer 長文モードで記事生成 → zenn-content リポジトリへの push 手順が確立 → Zenn に公開される

第四に、**ダッシュボード強化**: 営業タブ・月次レポートタブ・勝ちパターン強化版が動く

第五に、**Cowork 指示書3本**: lead_finder.md / outreach_writer.md / monthly_report.md が完成し、Cowork が実行できる状態

---

## 7. Phase 5 以降のロードマップ

Phase 4 完了で **PR Agent としての機能は一通り完成**。

Phase 5 以降は **コンテンツ品質向上**を中心とした機能追加を継続検討する(DSKさんの判断で実装):

### 7.1 コンテンツ品質向上(Phase 5 候補)

#### P5-1: 画像生成強化(Adobe MCP連携の深化)
- Phase 2 の MaterialScout に「自動生成依頼」を組み込む
- Cowork + Adobe MCP で生成した画像を visual_assets テーブルに自動投入
- ペルソナ・キャラ・構文に最適化した画像をプロンプトで生成
- 工数: 2-3日

#### P5-2: 動画生成(将来検討)
- Threads / Instagram で動画コンテンツを増やす
- Adobe MCP 経由で短尺動画(リール / Threadsの動画)生成
- 工数: 5-7日(複雑、要 PoC)

#### P5-3: 多言語展開(将来検討)
- 英語版コンテンツ生成(海外向けマーケティング)
- 同じ Writer ロジックで言語切り替え
- 工数: 2-3日

#### P5-4: 競合 SNS 監視(X API 契約後)
- Phase 3 の TrendWatcher に X 監視を追加
- freee/マネフォ/弥生の公式アカウントの動向を観察(社名は出さない発信に活かす)
- 工数: 1-2日(X API 契約済前提)

### 7.2 設計思想の維持

```
shiwake-ai = 本体ビジネス
  → 「安定」が最重要
  → 機能追加より安定運用優先

PR Agent = shiwake-ai の認知拡大ツール
  → 「進化」が重要
  → コンテンツ品質を上げる実験 OK
  → 落ちても shiwake-ai 本体に影響なし

両者は独立したシステムを維持する
```

→ PR Agent は Phase 5 以降も独立した自走 Agent として進化を続けるが、shiwake-ai 本体には絶対に統合しない(障害分離 + 別プロダクト化の余地維持)。

---

## 8. リスク・既知の課題

第一に、**Cowork の実行タイミング**: cowork_requests/*.json を Cowork が見るタイミングが DSKさん依存
- 対策: 月次レポートは月末の Cron で自動依頼、リード探索は手動でOK(頻度低い)

第二に、**営業メールのスパム判定**: 自動生成メールがスパムフィルタに引っかかる可能性
- 対策: カスタマイズ徹底、送信元 IP の評判を維持、SendGrid 経由で送る

第三に、**Zenn の規約**: 自動生成記事の大量投稿はガイドライン違反
- 対策: 月2-3本ペースを上限、必ず DSKさん承認制、技術記事として価値あるものに限定

第四に、**leads データの取得方法**: Web スクレイピングで多くの事務所HPから情報取得すると、対象サイトに負荷をかける
- 対策: Cowork に「手動アクセスで OK」と指示、自動クローラーを使わない

第五に、**個人情報保護**: leads テーブルに事業所情報を保存する点
- 対策: 公開HPに掲載されている情報のみ収集、税理士会名簿等は使わない

---

## 9. claude code への最初の一言(DSKさん→claude code)

> この `shiwake-ai-PR-Agent_実装指示書_v3_Phase4.md` を読んで、P4-2 から順に進めてください。
> 着手前に必ず私(DSK)に「これから○○を作ります」と確認。
> 5回見直しでpush。トークン節約。
>
> 【Phase 4 の特徴】
> - 事業化フェーズ(Phase 1〜3 で集めた基盤を使って収益・営業に繋げる)
> - Cowork で大幅に工数圧縮(Claude Code が書くコードは最小限)
> - 主要成果物は Cowork 指示書3本(lead_finder / outreach_writer / monthly_report)
>
> 【優先順位】
> 1. P4-2 営業ツール(Cowork指示書3本作成)← 最優先、事業インパクト最大
> 2. P4-3 ダッシュボード強化(営業タブ・月次レポートタブ・勝ちパターン強化)
> 3. P4-1 Zenn 連携(GitHub 経由、技術ブランディング)
>
> 【Cowork 指示書を Claude Code が書く理由】
> - Cowork 指示書は Cowork が動くためのドキュメントだが、フォーマットや連携の正確性が必要
> - Claude Code はリポジトリ全体を見れるので、connector や schema との整合性を取りやすい
> - DSKさんが手動で書くより速い・正確
>
> 不明点は Web版Claude(指示出し役)に相談OK。

---

## 10. 変更履歴

| 日付 | 版 | 内容 |
|-----|---|-----|
| 2026-05-09 | v3 Phase4 初版 | Q1〜Q3 の選択を反映、P4-2 営業ツール優先、Phase 5 ロードマップ含む |

---

**作成日**: 2026年5月9日(土)
**作成者**: 和泉大介(指示) + Web版Claude(原案)
**前提**: Phase 1〜3 完走済み
**Phase 4 着手予定**: 2026-05-10 以降(DSKさんの判断)

---

# Phase 4 実装指示書ここまで。
