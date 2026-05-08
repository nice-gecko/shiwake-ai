# shiwake-ai-PR Agent 実装指示書 v2.0（骨組み）

> 本ファイルは v2 の構造確認用。詳細（コード雛形・SQL・プロンプト全文）は骨組み確定後に追記。
> 作成: 2026-05-08 / 指示出し: Claude chat / 実装: claude code

---

## 0. claude code への申し送り
- トークン節約最優先（着手前に確認）
- 5回セルフチェック → push
- `cd ~/APP/shiwake-ai/pr-agent` 後、ディレクトリ移動を挟まず git一括
- shiwake-ai設計思想「判断の見える化」をPR Agent側にも適用（DSKさん本人にもAgent判断ログが見える）

---

## 1. プロジェクト概要
- 名称: shiwake-ai-PR Agent / 外向き「証憑仕訳AI Agent」
- 目的: shiwake-ai.com の認知拡大・ユーザー獲得・代理店開拓
- 性格: 外面プロ（信頼性）×内面ドタバタ（ユーモア0.8/ドタバタ0.9/衝撃0.6/真面目0.7）
- ターゲット2方向: SNS自律運用 + toB/toC営業ツール
- 開発期間: 5週間想定（Phase 1〜4）

---

## 2. 確定技術構成
| レイヤー | 採用 |
|---------|-----|
| 言語 | Python 3.12+ |
| 実行環境 | Cloud Run（月$5〜$20想定） |
| データストア | Supabase（DB + Storage + pgvector） |
| Agent FW | LangGraph |
| LLM | Claude Sonnet 4.6 / Opus 4.7 |
| ブラウザ自動化 | Playwright |
| 画像処理 | Pillow / OpenCV |
| 通知 | LINE Notify or Discord Webhook |
| 公開フロー | 初期承認制 → 段階的自動化解禁 |

---

## 3. Agent 7ノード構成

```
TrendWatcher → Planner → MaterialScout → Writer → Publisher → Analyst
                                                       ↓
                                                    Panic
        ↑↓ Memory Bank (Supabase)
```

| ノード | 責務 |
|-------|-----|
| ① TrendWatcher | 競合・税制・トレンド監視（外部情報） |
| ② Planner | 今日のネタ・ペルソナ・構文・キャラ・時間帯を決定 |
| ③ MaterialScout | 必要素材の在庫確認 → 無ければ生成依頼 |
| ④ Writer | キャラ×構文×3軸トリガーで原稿生成 |
| ⑤ Publisher | 承認後、各SNSへ配信 |
| ⑥ Analyst | 反応取得（30min/3h/24h）+ 要因分析 |
| ⑦ Panic | バズ検知時のセルフリプライ + パニック投稿提案 |

---

## 4. 設計の3軸

### 軸A: ペルソナ（誰に）
| ID | ターゲット | 訴求軸 | ベスト投稿時間 |
|----|----------|-------|--------------|
| P1 | 個人/フリラン | 時短・980円・スマホスキャン | 21:00-23:00 |
| P2 | 中規模会社（スタッフ層） | インセンティブ・ゲーム化 | 12:00-13:00 / 18:00 |
| P3 | 中規模会社（経営者層） | 教育コスト削減・自律化 | 8:00-9:00 / 17:00 |
| P4 | 税理士事務所 | マスタ学習・顧問先管理 | 8:00-9:00 / 20:00 |

### 軸B: キャラクター（誰が話す）
- shoyo_kun（ドタバタ男子）/ shoyo_chan（ドタバタ女子）
- zeirishi_sensei（真面目男性）/ keiri_san（共感女性）/ shacho（関西弁おっちゃん）
- 各キャラに性格パラメーター5種を保持

### 軸C: 戦略（どう攻める）
- **構文ウェポン6種**: W1常識破壊 / W2比較 / W3専門知識 / W4エモ独白 / W5巻き込み / W6パニック
- **拡散トリガー3軸**（構文と直交・Gemini採用）: Antagonism / Altruism / Storytelling

→ Plannerが「P4×zeirishi_sensei×W3×Altruism×8:00投稿」のように4軸で組み合わせを決定

---

## 5. 対応SNSとPhase別範囲
| SNS | 優先度 | 認証/制約 |
|-----|-------|---------|
| Threads | ★★★ | Meta公式API/無料 |
| X | ★★★ | Basic $200/月（要予算判断） |
| Instagram | ★★ | Graph API/画像必須 |
| note | ★★ | API無し→Playwright（規約注意） |
| Zenn | ★ | GitHub連携で記事更新 |
| Qiita | × | 後回し |

| Phase | Week | 対応範囲 |
|-------|------|---------|
| Phase 1 | 1-2 | Threads + X / Writer + 承認 / Memory Bank基盤 |
| Phase 2 | 3 | Instagram + Analyst + MaterialScout |
| Phase 3 | 4 | note + Panic + 自動化解禁ロジック + TrendWatcher |
| Phase 4 | 5 | Zenn + 営業ツール連携 + ダッシュボード |

---

## 6. ディレクトリ構成（採用案）

```
~/APP/shiwake-ai/pr-agent/
├── brain/                       # 判断ロジック
│   ├── trend_watcher.py
│   ├── planner.py
│   ├── material_scout.py
│   ├── writer.py
│   ├── analyst.py
│   ├── panic.py
│   ├── personalities/           # キャラ5体の性格定義
│   ├── weapons/                 # 構文6種のプロンプト
│   └── triggers/                # 3軸トリガーの修飾子
├── connectors/                  # 外部API
│   ├── x_api.py
│   ├── meta_api.py              # Threads + Instagram統合
│   ├── note_api.py              # Playwright
│   ├── zenn_api.py              # GitHub経由
│   └── mail_sender.py           # 営業メール
├── visuals/                     # 画像処理
│   ├── ui_annotator.py
│   ├── ogp_generator.py
│   ├── screenshot_capture.py    # Playwright撮影
│   ├── character_compositor.py  # キャラ画像合成
│   └── raw/                     # 12枚＋自動撮影分
├── memory/
│   ├── supabase_client.py
│   ├── schema.sql
│   └── git_log_harvester.py     # ★ 実績ゼロ期戦略（Geminiから採用）
├── notify/
│   └── line.py
├── sales/                       # 営業ツール（Phase 4で本格化）
│   ├── lead_finder.py
│   └── outreach_writer.py
├── dashboard/                   # 承認画面（FastAPI + 軽量UI）
├── config/
│   ├── personas.yaml
│   ├── characters.yaml
│   ├── weapons.yaml
│   ├── triggers.yaml
│   └── time_table.yaml          # ペルソナ別最適時間帯
├── main.py                      # 統括ループ
└── pyproject.toml
```

---

## 7. Memory Bank スキーマ（テーブル一覧のみ）

| テーブル | 用途 |
|---------|-----|
| posts | 全投稿履歴 + retry_of 系譜 |
| engagements | 30min/3h/24h 計測 |
| memory_bank | 要因分析・next_action記録 |
| visual_assets | 画像カタログ（12枚 + 自動撮影 + 生成画像） |
| success_patterns | 構文×ペルソナ×キャラの勝ちパターン |
| trends | TrendWatcherの検知ログ |
| leads | 営業リード（Phase 4） |
| outreach_history | 営業履歴（Phase 4） |
| incentive_events | shiwake-ai本体からのインセンティブ通知 ★ |
| git_commits | DSKさんのコミット履歴を素材化 ★ |

★ = Gemini採用項目

---

## 8. Gemini採用6項目の実装位置

| # | 項目 | 実装位置 |
|---|------|---------|
| A | 実績ゼロ期戦略（Gitログ素材化） | `memory/git_log_harvester.py` + Plannerが参照 |
| B | ペルソナ別最適時間帯 | `config/time_table.yaml` + Planner |
| C | 拡散トリガー3軸 | `brain/triggers/` + Writerに修飾子注入 |
| D | パニック時セルフリプライ | `brain/panic.py` を2段構え（元投稿リプライ + 続報） |
| E | インセンティブ連動 | shiwake-ai本体→Webhook→`incentive_events`テーブル→Plannerが祝福投稿企画 |
| F | 競合言及ガードレール | Writerシステムプロンプトに「freee/マネフォ/弥生の社名は出さない」明記 |

---

## 9. 重要なリーガル/リスクガードレール

- **競合社名禁止**（Geminiの「Antagonism攻撃モード」を制限版で採用）
  - OK: 「従来のクラウド会計ソフトでは…」
  - NG: 「freeeでは…」「マネフォでは…」
- **税法の具体数値・条文を出すときは必ず根拠URL** + 「不確実なら出さない」
- **note Playwright**: Phase 3着手前に規約再確認
- **デモアカウント**: 本番DBに `is_demo: true` フラグ追加し統計から除外
- **公開12枚画像**: Image 4（Agent価格）と Image 9（店名）はぼかし加工

---

## 10. Phase 1 タスク（Week 1-2）

### Week 1
- T1-1: Cloud Run + Supabase 環境構築
- T1-2: `memory/schema.sql` 適用（最小: posts/engagements/memory_bank/visual_assets）
- T1-3: `config/` YAML 5本作成（personas/characters/weapons/triggers/time_table）
- T1-4: 12枚をSupabase Storageへ + visual_assets登録
- T1-5: ui_annotator.py で12枚一括検証
- T1-6: Writer ノード（キャラ×構文×トリガーの3軸プロンプト合成）

### Week 2
- T2-1: X / Threads APIコネクタ
- T2-2: Publisher（承認制で配信）
- T2-3: 承認ダッシュボード（FastAPI + Tailwind 簡易版）
- T2-4: LINE/Discord 通知
- T2-5: Planner（Gitログ素材化 + 時間帯テーブル参照）
- T2-6: Phase 1 完了報告 → DSKさんレビュー

### Phase 1 完了の定義
「DSKさんが朝LINE通知を受けて、3案からスマホで1案承認 → Threadsに投稿される」が動く。

---

## 11. Phase 2-4 概要（詳細はPhase 1完了後）
- Phase 2 (Week 3): Instagram + Analyst（30min/3h/24h計測）+ MaterialScout（画像在庫検索 → 無ければ生成）
- Phase 3 (Week 4): note + Panic（セルフリプライ含む）+ TrendWatcher + 自動化解禁ロジック
- Phase 4 (Week 5): Zenn + 営業ツール（lead_finder + outreach_writer）+ ダッシュボード強化

---

## 12. 完成イメージ（DSKさんの1日）

```
朝9:05  LINE「今日のネタ3案できました」→ タップ承認 → X/Threads投稿
昼12:00 LINE「Threadsバズってます…(動揺)」→ タップ承認 → セルフリプライ＋続報
夕18:00 LINE「税理士事務所10件のリードに営業メール下書きできました」→ レビュー
夜21:00 LINE「本日レポート: リーチ12,800 / 新規45 / W4×keiri_sanが今日の勝者」
```

---

## 13. claude code への最初の一言（DSKさん→claude code）

> この `shiwake-ai-PR-Agent_実装指示書_v2.md` を読んで、Phase 1 T1-1から順に進めてください。
> 着手前に必ず私（DSK）に「これから○○を作ります」と確認。
> 5回見直しでpush。トークン節約。
> 不明点はClaude chat（指示出し役）に相談OK。

---

# v2 骨組みここまで。
# 確認後、各セクションの詳細（コード雛形・SQL全文・プロンプト全文）を肉付けする。
