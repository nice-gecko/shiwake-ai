# cowork_handoff/ - Cowork 用指示書集約ディレクトリ

このディレクトリには、Anthropic Cowork(DSKさんの Mac で動く AI 同僚)に渡す指示書を集約します。

## 概要

PR Agent 本体(Cloud Run + LangGraph)は 24時間自律運用しますが、
以下の作業は Cowork に移譲することで実装工数を削減し、運用効率を上げています:

- 朝の3案レビュー支援(`morning_review.md`)
- X 手動投稿の補助(`x_manual_post.md`)
- X 24h数値の自動取得(`x_metrics_collect.md`)
- note 投稿補助(`note_post.md`)
- 月次レポート作成(`monthly_report.md`)
- 営業リード探索(`lead_finder.md`)
- 営業メール下書き(`outreach_writer.md`)

## 指示書の作成タイミング

各 Phase で必要になった時点で追加します:

- **Phase 1 完了後**: morning_review.md, x_manual_post.md
- **Phase 2 着手時**: x_metrics_collect.md, visual_generation.md
- **Phase 3 着手時**: note_post.md
- **Phase 4 着手時**: lead_finder.md, outreach_writer.md, monthly_report.md

## Cowork 利用上のリスク管理

以下は **Cowork に渡さない**:
- Stripe 関連の操作(プロンプトインジェクション攻撃リスク)
- 顧客個人情報の処理
- API キー(環境変数のまま、Cloud Run側で保持)

## 参照ドキュメント

- `../shiwake-ai-PR-Agent_実装指示書_v3_骨組み.md` - メイン仕様書
- `../shiwake-ai-PR-Agent_実装指示書_v2.md` - v2 仕様書(アーカイブ)
- `../patch_001_x_manual.md` - X 手動投稿パッチ
