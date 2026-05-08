# shiwake-ai-PR Agent 実装指示書 v2.0 - Part B
## 設定ファイル + Gitログ素材化 + Phase 1完了基準

> Part B は v2 の **設定ファイル群と素材収集ロジック、Phase 1の検収基準**を定義する。
> Part A（データ基盤）に依存。Part C（環境変数+デプロイ+申し送り）と合わせて完成版。
> 作成: 2026-05-08

---

## B-1. config/personas.yaml

```yaml
# 4ペルソナの定義
# Plannerが「今日は誰向けに」を決める時の参照表
# 各ペルソナごとに best_time（時間帯テーブルへの参照）と訴求軸を持つ

personas:
  P1:
    name: "個人/フリーランス"
    appeal_axes:
      - "時短（手入力からの解放）"
      - "格安（月980円）"
      - "スマホスキャンの手軽さ"
    forbidden_topics:
      - "大企業向け会計の難解な議論"
      - "代理店プラン価格の比較"
    tone_hint: "親しみやすく・少し疲れた共感ベース"
    best_platforms: ["x", "threads", "instagram"]

  P2:
    name: "中規模会社・スタッフ層"
    appeal_axes:
      - "スタッフインセンティブ（Amazonギフト券）"
      - "経理が稼げる仕事になる"
      - "ゲーミフィケーション"
    forbidden_topics:
      - "経営判断・税務戦略"
    tone_hint: "ワクワク・現場目線"
    best_platforms: ["instagram", "threads", "x"]

  P3:
    name: "中規模会社・経営者層"
    appeal_axes:
      - "教育コスト削減"
      - "属人化解消"
      - "自律エージェント版による工数ゼロ化"
    forbidden_topics:
      - "個人事業主向けの安さ訴求"
    tone_hint: "論理的・ROI重視"
    best_platforms: ["x", "note"]

  P4:
    name: "税理士事務所"
    appeal_axes:
      - "顧問先ごとのマスタ学習・パーソナライズ"
      - "顧問先管理の効率化"
      - "代理店プラン（ホワイトラベル的活用）"
    forbidden_topics:
      - "競合の名指し批判（業界の礼儀）"
      - "法解釈の断定（プロが見る前提）"
    tone_hint: "プロフェッショナル・敬意"
    best_platforms: ["note", "x", "zenn"]
```

---

## B-2. config/characters.yaml

```yaml
# 5キャラの性格パラメーター
# Writerがシステムプロンプトを組む時に展開
# Memory Bankで「どのキャラがどのペルソナ×構文で勝つか」を学習する

characters:
  shoyo_kun:
    display_name: "証憑くん"
    voice: "male_casual"          # 〜だぜ、〜じゃん
    pronoun: "ぼく"
    parameters:
      humor: 0.8
      shock: 0.6
      slapstick: 0.9
      seriousness: 0.3
    catchphrase_examples:
      - "うわっ、また通知きた！"
      - "ぼくが代わりに仕訳しとく！"
    best_for_weapons: ["W1", "W6"]
    best_for_personas: ["P1", "P2"]

  shoyo_chan:
    display_name: "証憑ちゃん"
    voice: "female_casual"        # 〜だよね、〜なの
    pronoun: "わたし"
    parameters:
      humor: 0.85
      shock: 0.5
      slapstick: 0.95
      seriousness: 0.3
    catchphrase_examples:
      - "えっ、嘘でしょ…！？"
      - "わたしが全部やっとくね"
    best_for_weapons: ["W1", "W5", "W6"]
    best_for_personas: ["P1", "P2"]

  zeirishi_sensei:
    display_name: "税理士先生"
    voice: "male_polite"          # 〜です、〜ます
    pronoun: "私"
    parameters:
      humor: 0.2
      shock: 0.3
      slapstick: 0.0
      seriousness: 0.9
    catchphrase_examples:
      - "意外と知られていませんが"
      - "実務で誤りやすいポイントです"
    best_for_weapons: ["W3"]
    best_for_personas: ["P3", "P4"]
    note: |
      Geminiの仮説: 「ドタバタ女子より冷静な男性キャラの方が
      税理士事務所からのDMに繋がっている」
      → Memory Bankで継続検証する重要キャラ

  keiri_san:
    display_name: "経理さん"
    voice: "female_polite"
    pronoun: "わたし"
    parameters:
      humor: 0.5
      shock: 0.4
      slapstick: 0.2
      seriousness: 0.6
    catchphrase_examples:
      - "前職では毎日残業でした…"
      - "今は定時で帰れています"
    best_for_weapons: ["W4", "W5"]
    best_for_personas: ["P2", "P1"]

  shacho:
    display_name: "社長"
    voice: "male_kansai"          # 関西弁
    pronoun: "ワシ"
    parameters:
      humor: 0.7
      shock: 0.5
      slapstick: 0.4
      seriousness: 0.5
    catchphrase_examples:
      - "ワシのとこの経理スタッフがな…"
      - "AIで経理が稼げるようになるんやて"
    best_for_weapons: ["W2", "W4"]
    best_for_personas: ["P3"]
```

---

## B-3. config/weapons.yaml

```yaml
# 6つの戦略構文
# Writerに渡されると、テンプレートとガイドが展開される

weapons:
  W1:
    name: "常識破壊"
    description: "当たり前と思われている苦労を『無駄』と断じ、共感と驚きを生む"
    structure_hint: |
      【冒頭】既存の苦労を否定する強い問いかけ
      【中段】shiwake-aiでの解放のされ方を具体例で
      【末尾】「人間がやるべきはコレじゃない」という上位概念への昇華
    example_template: |
      まだ〇〇で消耗してるんですか？
      shiwake-aiなら××秒で終わります。
      人間がやるべきは△△のはず。
    risk_notes:
      - "業界の慣習を全否定すると税理士に嫌われる → 範囲を絞る"
      - "競合社名は絶対に出さない（Writerシステムプロンプトで二重ガード）"

  W2:
    name: "比較構造"
    description: "Before/Afterや手入力 vs AIの圧倒的な差をリスト形式で可視化"
    structure_hint: |
      【冒頭】対比軸の宣言（時間/コスト/精度等）
      【中段】箇条書きで Before / After を並列
      【末尾】数値の倍率や差額で締める
    example_template: |
      経理作業の進化論。
      1. 手入力（原始時代）：3時間
      2. クラウド会計（近代）：1時間 + ルール設定の苦行
      3. shiwake-ai（未来）：5分 + ギフト券GET

  W3:
    name: "専門知識"
    description: "プロしか知らない『損をしない知識』を無償提供"
    structure_hint: |
      【冒頭】「知ってましたか？」型の問いかけ
      【中段】具体的な仕訳ミスとその正解
      【末尾】「shiwake-aiならAIが弾く」で着地
    example_template: |
      慶弔費を福利厚生費で出して損していませんか？
      実は間違えやすい仕訳ワースト3：
      ・〇〇費 → 正しくは△△費
      ・……
      shiwake-aiは過去事例から判断します。
    legal_guard: "数値・条文を出すときは根拠URL必須。不確実なら出さない"

  W4:
    name: "エモ独白"
    description: "なぜ作ったかという『人間味』に訴える"
    structure_hint: |
      【冒頭】開発の苦労 or 個人的な原体験
      【中段】「〇〇な人を救いたかった」という動機
      【末尾】少しの照れ + 製品紹介で締める
    example_template: |
      正直、この機能を作るのは地獄でした。
      でもスタッフが経理を嫌がる姿を見るのが辛くて、
      『仕訳したらAmazonギフト券が届くボタン』を作りました。
      狂ってると言われたけど、現場が笑顔になるなら本望です。
    best_platforms: ["note", "x"]
    notes: "長文が伸びやすい媒体向け"

  W5:
    name: "巻き込み"
    description: "ユーザーへの問いかけで会話とインプを発生させる"
    structure_hint: |
      【冒頭】具体的な問いかけ（二択 or オープン）
      【中段】shiwake-aiとの関連を控えめに示唆
      【末尾】返信を促す一言
    example_template: |
      経理で一番「これ、無駄だな」って思う瞬間、教えてください。
      全部AIで解決できるか試します。

  W6:
    name: "パニック"
    description: "バズ検知時のみ使用。エージェント自身が動揺するリアクション"
    structure_hint: |
      【冒頭】驚愕の擬音 or セルフツッコミ
      【中段】信じられない数字への困惑
      【末尾】DSKさん（中の人）への助け呼び（演出）
    example_template: |
      ちょっ、待って…
      なんで今日に限って通知止まらないの…？
      ぼく、変なこと言いました…？
      @_dsk 助けて
    use_only_when: "Panicノードが閾値超えを検知した時のみ"
```

---

## B-4. config/triggers.yaml

```yaml
# 3つの拡散トリガー軸（Gemini採用C）
# 構文6種と直交する別軸として、Writerのプロンプトに修飾子として注入

triggers:
  antagonism:
    name: "対立構造"
    description: "古いやり方を少し攻撃的に否定し、新しさを強調"
    intensity_hint: "やや強め。ただし業界全体への礼儀は保つ"
    suitable_weapons: ["W1", "W2"]
    forbidden:
      - "競合の社名を出す"
      - "特定の士業・業界全体を見下す"
    modifier_text: |
      古いやり方の不合理さを少し強めに指摘してください。
      ただし、特定の会社名や業界全体への侮辱は禁止。

  altruism:
    name: "利他性"
    description: "ユーザーに役立つTipsを無償提供する"
    intensity_hint: "穏やか・親切"
    suitable_weapons: ["W3", "W5"]
    modifier_text: |
      読者が「得した」「保存しておこう」と思える具体的情報を提供。
      宣伝色を薄め、知識のシェアに徹してください。

  storytelling:
    name: "物語性"
    description: "開発の苦労やインセンティブ機能の誕生秘話を語る"
    intensity_hint: "感情的・人間味"
    suitable_weapons: ["W4"]
    modifier_text: |
      製品スペックではなく、開発者の感情・原体験を中心に語ってください。
      具体的な情景描写を1つ入れること。
```

---

## B-5. config/time_table.yaml

```yaml
# ペルソナ × プラットフォーム別の最適投稿時間帯
# Plannerが scheduled_at を決める時に参照（Gemini採用B）
# JST 24h表記

time_table:
  P1:  # 個人/フリーランス
    x:         ["07:30", "12:30", "22:00"]
    threads:   ["12:30", "22:00"]
    instagram: ["12:00", "21:00"]
    note:      ["20:00"]

  P2:  # 中規模会社・スタッフ層
    x:         ["12:00", "18:00"]
    threads:   ["12:30", "18:30"]
    instagram: ["12:00", "18:00", "21:00"]
    note:      ["18:00"]

  P3:  # 中規模会社・経営者層
    x:         ["08:00", "17:00"]
    threads:   ["08:30"]
    note:      ["08:00", "17:00"]
    zenn:      ["09:00"]

  P4:  # 税理士事務所
    x:         ["08:00", "20:00"]
    threads:   ["08:30"]
    note:      ["08:00", "20:00"]
    zenn:      ["09:00"]

# プラットフォーム別の文字数上限（Writerが守る）
char_limits:
  x:         280            # 英数換算。日本語は実質140文字
  threads:   500
  instagram: 2200           # キャプション
  note:      null           # 上限なし、推奨1500-3000
  zenn:      null

# 媒体別の特性メモ（Writerプロンプトに展開される）
platform_traits:
  x:         "拡散重視。冒頭1行が命。短文＋強い言葉"
  threads:   "会話重視。問いかけや独白が伸びる。スレッド分割可"
  instagram: "画像必須。キャプションは長文OK、ハッシュタグ重要"
  note:      "ストーリー・思想重視。SEO効く。長文歓迎"
  zenn:      "技術・論理重視。コードや図解が映える"
```

---

## B-6. memory/git_log_harvester.py

Gemini採用A「実績ゼロ期戦略」の実装。GitHubコミットを素材化する。

```python
"""
GitLogHarvester: shiwake-ai 本体（nice-gecko/shiwake-ai）のコミット履歴を素材化

責務:
1. 直近24時間のコミットを GitHub API で取得
2. 各コミットメッセージを LLM で「ユーザー利益の言葉」に翻訳
3. 投稿価値があるかをLLMが判定
4. git_commits テーブルに保存（Plannerが消費）

例:
  入力: "fix: OCR rotation correction for landscape receipts"
  出力(user_benefit): "横向きの領収書も自動で正しく読み取れるようになりました"
  category: "fix"
  worth_posting: true
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional

GITHUB_REPO = "nice-gecko/shiwake-ai"

@dataclass
class CommitRecord:
    sha: str
    message: str
    committed_at: datetime
    files_changed: List[str]
    additions: int
    deletions: int

@dataclass
class HarvestedCommit:
    sha: str
    message: str
    user_benefit: str          # LLM翻訳結果
    category: str              # 'feature'|'fix'|'perf'|'ui'|'refactor'|'chore'
    worth_posting: bool        # 投稿価値あり
    rationale: str             # なぜworth_postingと判定したか

class GitLogHarvester:
    SYSTEM_PROMPT = """
あなたはshiwake-aiの開発ログを「ユーザー利益」に翻訳する翻訳者です。

【翻訳ルール】
1. 技術用語をユーザー目線に変換
   悪い例: "OCR精度を改善" → そのまま
   良い例: "OCR精度を改善" → "斜めに撮ったレシートでも正しく読み取れるようになりました"
2. 内部リファクタや chore 系は worth_posting=false
3. ユーザーが体感する変化があるものだけ worth_posting=true
4. 競合社名・顧問先名を含むコミットメッセージは読み飛ばす
5. category は次から選ぶ: feature / fix / perf / ui / refactor / chore

【出力形式】
JSON で以下を返す:
{
  "user_benefit": "ユーザー利益の文言",
  "category": "feature",
  "worth_posting": true,
  "rationale": "判定理由"
}
"""

    def __init__(self, github_client, llm_client, supabase_client):
        self.gh = github_client
        self.llm = llm_client
        self.db = supabase_client

    async def harvest_recent(self, hours: int = 24) -> List[HarvestedCommit]:
        """直近 hours 時間のコミットを取得して翻訳・保存"""
        since = datetime.utcnow() - timedelta(hours=hours)
        commits = await self._fetch_commits_since(since)
        results = []
        for c in commits:
            if await self._already_harvested(c.sha):
                continue
            translated = await self._translate(c)
            await self._save(c, translated)
            results.append(translated)
        return results

    async def _fetch_commits_since(self, since: datetime) -> List[CommitRecord]:
        """GitHub REST API: GET /repos/{owner}/{repo}/commits?since=..."""
        ...

    async def _already_harvested(self, sha: str) -> bool:
        """git_commits テーブルに既に sha があるか確認"""
        ...

    async def _translate(self, commit: CommitRecord) -> HarvestedCommit:
        """LLMでユーザー利益に翻訳"""
        ...

    async def _save(self, commit: CommitRecord, translated: HarvestedCommit):
        """git_commits テーブルにinsert（consumed=false）"""
        ...

    async def get_unconsumed_for_planner(self, limit: int = 5):
        """Plannerが今朝のネタを探す時に呼ぶ。worth_posting=true & consumed=false"""
        ...
```

### Plannerとの接続フロー

```
[毎朝 8:30] GitLogHarvester.harvest_recent(24)
              ↓ 5件のコミットを翻訳・保存
[毎朝 9:00] Planner.plan_today()
              ↓ get_unconsumed_for_planner(5) 呼び出し
              ↓ 投稿価値ありの2件を seeds として採用
              ↓ 採用したものは consumed=true に更新
            PostPlan 生成
```

---

## B-7. Phase 1 タスクの完了基準

骨組みのセクション10で挙げた T1-1〜T2-6 の各タスクに、**「これが動けば完了」の判定基準**を付ける。

### Week 1

#### T1-1: Cloud Run + Supabase 環境構築
**完了基準**:
- [ ] Google Cloud プロジェクト作成済み
- [ ] Cloud Run サービス1つデプロイ済み（Hello World レベルで可）
- [ ] Supabase プロジェクト作成、プロジェクトURLとservice_role_keyが取得済み
- [ ] `.env.example` 配置、`.env` がgitignoreに入っている
- [ ] DSKさんが Cloud Run のヘルスチェックURLにアクセスして "OK" が返る

#### T1-2: Supabase スキーマ適用
**完了基準**:
- [ ] Part A の SQL を Supabase SQL Editor で実行、10テーブル作成成功
- [ ] `supabase` Python クライアントから全テーブルへの insert/select が動く
- [ ] 簡易テスト: `posts` に1件insert → selectで取れる

#### T1-3: config/ YAML 5本作成
**完了基準**:
- [ ] personas.yaml / characters.yaml / weapons.yaml / triggers.yaml / time_table.yaml が `config/` 配下に配置
- [ ] `config_loader.py` で全YAMLをdictとしてロードできる
- [ ] 起動時にスキーマ検証（pydantic等）でエラーなくパスする

#### T1-4: 12枚をSupabase Storageへ + visual_assets登録
**完了基準**:
- [ ] Supabase Storage に `visuals-bucket` 作成
- [ ] 12枚のファイルが `visuals-bucket/raw/manual/001_*.png` 〜 `012_*.png` に配置
- [ ] visual_assets テーブルに12レコード登録、tags / has_pii / masking_required が正しく設定
  - Image 4: `has_pii=true, masking_required=true, tags=['pricing','agent_plan']`
  - Image 9: `has_pii=true, masking_required=true, tags=['master_list','vendor_names']`
  - 他10枚: `has_pii=false, masking_required=false`

#### T1-5: ui_annotator.py で12枚一括検証
**完了基準**:
- [ ] `ui_annotator.py` に `add_arrow(image, point, label)` と `mask_region(image, bbox)` の2関数実装
- [ ] CLI: `python -m visuals.ui_annotator --batch-test` で12枚に対し赤枠とラベル合成→`/tmp/annotated/` に出力
- [ ] Image 4 と Image 9 はマスキング処理が走り、価格と店名が黒塗り（or ぼかし）される
- [ ] DSKさんが目視で12枚すべてOK判定

#### T1-6: Writer ノード実装
**完了基準**:
- [ ] `brain/writer.py` の `Writer.write(plan, asset_ids)` が動作
- [ ] `config/` の YAML を読み込んで SYSTEM_PROMPT_BASE に展開できる
- [ ] テストケース: `plan = {persona:'P1', character_id:'shoyo_chan', weapon:'W1', trigger_axis:'antagonism', platform:'threads'}` で原稿生成 → posts に draft 保存
- [ ] **生成された原稿に競合社名（freee/マネフォ/弥生/勘定奉行）が含まれない** ことを assertion でテスト

### Week 2

#### T2-1: X API コネクタ
**完了基準**:
- [ ] `connectors/x_api.py` に `XConnector.post(content, media)` 実装
- [ ] X Developer Portal で Basic プラン契約済み（DSKさん予算判断後）
- [ ] テスト投稿1件成功（テキストのみ）→ 即削除でOK
- [ ] external_id と external_url が posts テーブルに保存される

#### T2-2: Threads API コネクタ
**完了基準**:
- [ ] `connectors/meta_api.py` に `ThreadsConnector.post(content, media)` 実装
- [ ] Meta Developer でアプリ作成、Threads API のアクセストークン取得
- [ ] テスト投稿1件成功 → 即削除でOK

#### T2-3: Publisher 実装 + 承認連動
**完了基準**:
- [ ] `brain/publisher.py` の `Publisher.publish(post_id)` が動作
- [ ] status='approved' のpostだけが配信される（draftは弾く）
- [ ] 配信後 status='published'、external_id/external_url が保存される
- [ ] エラー時のリトライ・ログ記録

#### T2-4: 承認ダッシュボード
**完了基準**:
- [ ] FastAPI で `/dashboard` ルート、draft一覧表示
- [ ] 各draft に「承認」「却下」「修正依頼」ボタン
- [ ] スマホブラウザで快適に操作できる（最低限のレスポンシブ）
- [ ] 承認時に Publisher を起動するエンドポイント `POST /api/approve/{id}`

#### T2-5: LINE/Discord 通知
**完了基準**:
- [ ] DSKさん選択（LINE Notify or Discord Webhook）に従って `notify/line.py` or `notify/discord.py` 実装
- [ ] draft が3件作成された時点で通知（タイトル + ダッシュボードURL）
- [ ] テスト: ダミーdraftを3件作って通知が来る

#### T2-6: Planner 実装（Git素材化 + 時間帯テーブル参照）
**完了基準**:
- [ ] `memory/git_log_harvester.py` 実装、GitHubから直近24hコミットを取得・翻訳・保存
- [ ] `brain/planner.py` の `Planner.plan_today(3)` が PostPlan を3件返す
- [ ] 各PostPlan の scheduled_at が time_table.yaml に従っている
- [ ] DSKさんが手動で `python -m brain.planner --run-now` を叩くと、Writer→Publisher draft保存→LINE通知 までフルフローで動く

### Phase 1 全体の検収シナリオ

```
[DSKさん操作] python -m main --phase1-run
   ↓
TrendWatcher（最小実装で空でもOK）
GitLogHarvester（直近24h取得、5件翻訳）
   ↓
Planner.plan_today(3) → PostPlan × 3
   ↓
MaterialScout（Phase 1では既存12枚から選ぶだけ、生成は無し）
   ↓
Writer × 3 → posts に draft 3件
   ↓
LINE通知「今日の3案できました」+ ダッシュボードURL
   ↓
[DSKさん操作] スマホでダッシュボード開く → 1案承認
   ↓
Publisher → Threads（or X）に投稿成功
   ↓
posts.status='published', external_url 保存
   ↓
[DSKさん確認] 実際にThreadsで投稿が見える
```

これが**5分以内に通せたら Phase 1 完了**。

---

## B-8. Part B の完了基準

claude code が Part B を実装し終えた状態：

- [ ] `config/` 配下に YAML 5本配置、`config_loader.py` で全部ロード可能
- [ ] `memory/git_log_harvester.py` 実装、GitHubトークンを使ってコミット取得→翻訳→DB保存が動く
- [ ] Phase 1 の T1-1〜T2-6 各タスクの完了基準が claude code 自身でチェックリスト化されている
- [ ] 統合テスト: Phase 1 検収シナリオが手動で1回通る

---

# Part B ここまで。
# 次は Part C（環境変数 + デプロイ手順 + claude code申し送り決定版）
