# shiwake-ai UI言語置換マップ v3.0

> **本ドキュメントの位置づけ**
> 2026年5月10日作成。`shiwake-ai_設計思想_v3_0.md` で確立した新方針(キャリアパス物語の廃止、信頼度ベースへの転換)を実装するための、`index.html` の置換指示書。
>
> Claude Code に渡す形式: 行番号 / 旧文言 / 新文言 / 補足。
> 対象ファイル: `~/APP/shiwake-ai/index.html`(2026年5月10日時点 v2.3.0、4957行)

---

## 📌 全体方針

### 削除/置換のルール

| カテゴリ | 方針 |
|---|---|
| キャリアパス語彙(顧客向け) | **完全削除**、信頼度ベースに置換 |
| プラン名(Agent ライト/プレミアム/エリート 等) | **そのまま維持**(機能差別化の名前として使う) |
| 「Agent版」呼称(料金ページ) | **維持**(製品ライン名として使う) |
| 代理店制度のBronze/Silver/Gold | **維持**(別ドキュメントで管理、本表の対象外) |
| 完了演出 🎉(処理完了等の業務イベント) | **維持**(キャリアパスの卒業演出のみ削除対象) |

### 残す/消す の判断軸

- **業務イベントの祝意** = 残す(「今月の仕訳、完了!」「お支払いありがとうございます」)
- **AIがユーザーを評価する演出** = 削除(「ルーキー卒業」「育成中」)

---

## 📋 置換対象一覧(28箇所)

### 🔴 Group A: 卒業モーダル(削除対象、最重要)

#### A-1. 卒業モーダル全体(line 1344-1359)
**操作: 削除**

該当ブロック全削除:
```html
<!-- v2.3.0: 卒業演出モーダル -->
<div class="grad-modal" id="gradModal" hidden>
  <div class="grad-modal-inner">
    <div class="grad-emoji">🎉</div>
    <h2>ルーキー卒業!</h2>
    <p>累計50件の仕訳をクリアしました。<br>あなたは<strong>ジュニア</strong>に昇格しました。</p>
    <div class="grad-unlock">
      <h3>🔓 アンロック: 自動取り込み</h3>
      <p>これからは、領収書をメールで送信したり、Dropbox/Google Drive のフォルダに放り込むだけで、shiwake-ai が自動で取り込んでくれます。</p>
    </div>
    <div class="grad-actions">
      <button onclick="openAutoIntakeSettings()">今すぐ設定する</button>
      <button onclick="document.getElementById('gradModal').hidden=true">あとで設定</button>
    </div>
  </div>
</div>
```

理由: キャリアパス物語の中核演出。新設計では「自動取り込みは初日から表示・有効化可能」のため不要。

代替: なし(削除)。

---

#### A-2. 卒業モーダルCSS(line 681-692)
**操作: 削除**

```css
/* v2.3.0: ルーキー卒業モーダル */
.grad-modal{...}
.grad-modal-inner{...}
.grad-emoji{...}
.grad-modal h2{...}
.grad-modal p{...}
.grad-unlock{...}
.grad-unlock h3{...}
.grad-unlock p{...}
.grad-actions{...}
.grad-actions button{...}
.grad-actions button:first-child{...}
```

理由: 卒業モーダル本体を削除するためCSSも不要。

---

#### A-3. 卒業演出ロジック(line 4669-4691)
**操作: 削除**

```javascript
// ===== 卒業演出 =====
function showGradModal() {
  const modal = document.getElementById('gradModal');
  if (modal) modal.hidden = false;
}

function openAutoIntakeSettings() {
  const modal = document.getElementById('gradModal');
  if (modal) modal.hidden = true;
  if (typeof switchTab === 'function') switchTab('auto-intake');
}

// incrementMonthlyCount のレスポンスから卒業チェック（既存関数をラップ）
(function() {
  const _orig = window.incrementSupabaseCount;
  window.incrementSupabaseCount = async function(uid, n) {
    const res = typeof _orig === 'function' ? await _orig(uid, n) : null;
    if (res && res.graduation && res.graduation.just_graduated) {
      setTimeout(showGradModal, 500);
    }
    return res;
  };
})();
```

理由: 卒業モーダルを発火させるラッパーが不要になる。

注意: `openAutoIntakeSettings()` は他箇所から呼ばれていないか確認(grepで `openAutoIntakeSettings` を検索 → 卒業モーダル内のみで使用、削除して問題なし)。

---

### 🔴 Group B: ルーキー進捗セクション(削除対象)

#### B-1. ルーキー進捗セクション(line 1868-1878)
**操作: 削除**

```html
<!-- 卒業ステータス（未卒業のみ） -->
<div class="intake-settings-section" id="gradStatusSection" hidden>
  <h3>📊 ルーキー進捗</h3>
  <div class="grad-progress-wrap">
    <div class="grad-progress-bar-bg">
      <div class="grad-progress-bar-fill" id="gradProgressBarFill" style="width:0%"></div>
    </div>
    <div class="grad-progress-text"><span id="gradCountText">0</span> / 50 件 で<strong>ルーキー卒業</strong></div>
    <div class="grad-hint-text">卒業すると自動取り込み機能が使えるようになります。</div>
  </div>
</div>
```

理由: 「50件達成で卒業=機能解放」のロジックを廃止。新設計では誰でも(プラン制約のみで)機能を有効化できる。

代替: なし(削除)。ただし**今後 v2.3.1 で「精度サマリーセクション」を別途追加予定**(本書の対象外)。

---

#### B-2. 卒業演出関連CSS(line 698-702)
**操作: 削除**

```css
.grad-progress-wrap{margin-bottom:14px;}
.grad-progress-bar-bg{height:8px;background:#f0efe9;border-radius:4px;overflow:hidden;margin-bottom:6px;}
.grad-progress-bar-fill{height:100%;background:#BA7517;border-radius:4px;transition:width 0.5s;}
.grad-progress-text{font-size:12px;color:#555;}
.grad-hint-text{font-size:11px;color:#888;margin-top:4px;}
```

理由: ルーキー進捗セクションを削除するためCSSも不要。

注意: コメント `/* v2.3.0: 自動取り込み設定 */` の直下にある `.lock-badge` 〜 `.intake-settings-section h4` は維持(`.intake-settings-section` 自体は別の用途で残るため)。

---

#### B-3. ルーキー進捗ロード処理(line 4694-4742)
**操作: 部分修正**

該当: `loadAutoIntakeSettings()` 関数。

**修正方針:**
- 「未卒業ならルーキー進捗を表示、卒業後なら設定パネルを表示」の二分岐を廃止
- 「有料プランなら設定パネルを表示」のみに簡略化

修正後:
```javascript
async function loadAutoIntakeSettings() {
  const uid = window._firebaseUser?.uid;
  if (!uid) return;
  try {
    const grad = await fetchGraduationStatus();
    const settings = await fetchInboxSettings();

    const intakeSection  = document.getElementById('autoIntakeSection');
    const autoIntakeToggle = document.getElementById('autoIntakeToggle');
    const autoShiwakeToggle = document.getElementById('autoShiwakeToggle');
    const emailRow       = document.getElementById('emailAddressRow');
    const dropboxRow     = document.getElementById('dropboxRow');
    const gdriveRow      = document.getElementById('gdriveRow');
    const autoShiwakeRow = document.getElementById('autoShiwakeRow');

    if (!grad || !grad.is_paid) {
      if (intakeSection) intakeSection.hidden = true;
      return;
    }

    // 有料プランなら全員設定可能
    if (intakeSection) intakeSection.hidden = false;
    if (autoIntakeToggle) autoIntakeToggle.checked = settings.auto_intake_enabled;
    if (autoShiwakeToggle) autoShiwakeToggle.checked = settings.auto_shiwake_enabled;

    const isOn = settings.auto_intake_enabled;
    if (emailRow)       emailRow.hidden       = !isOn;
    if (dropboxRow)     dropboxRow.hidden      = !isOn;
    if (gdriveRow)      gdriveRow.hidden       = !isOn;
    if (autoShiwakeRow) autoShiwakeRow.hidden  = !isOn;

    if (isOn) {
      loadInboxAddress();
      loadCloudConnections();
    }
  } catch(e) { console.warn('loadAutoIntakeSettings error:', e); }
}
```

理由: 卒業判定の分岐を廃止、有料プランなら誰でも有効化可能に。

⚠️ 重要: `autoIntakeSection` の `hidden` 属性も併せてHTML側で初期 `hidden` を維持(JSで制御される)。ただし `gradStatusSection` の参照は削除。

---

### 🟡 Group C: サイドバーのロックバッジ(削除対象)

#### C-1. ロックバッジCSS(line 694)
**操作: 維持(他用途の可能性、念のため確認)**

```css
.lock-badge{font-size:10px;background:#e0dfd8;color:#777;border-radius:4px;padding:1px 5px;margin-left:auto;white-space:nowrap;}
```

判定: `.lock-badge` クラスは grep 結果ではサイドバーのみで使用されているため**削除推奨**。ただし将来「Agent版以上で利用可能」等のバッジに使い回す可能性があれば**維持**。

**推奨: 維持**(将来「Agent版」バッジで使い回せる)

---

#### C-2. サイドバー出し分けロジック(line 4885-4906)
**操作: 修正**

該当: `setupAutoIntakeMenuItem()` 関数。

修正前:
```javascript
async function setupAutoIntakeMenuItem() {
  const menuItem = document.getElementById('navAutoIntake');
  if (!menuItem) return;
  const grad = await fetchGraduationStatus();
  if (!grad) { menuItem.style.display = 'none'; return; }
  if (!grad.is_paid) {
    menuItem.style.display = 'none';
  } else if (grad.is_agent || grad.graduated) {
    menuItem.style.display = '';
    const lb = menuItem.querySelector('.lock-badge');
    if (lb) lb.remove();
  } else {
    menuItem.style.display = '';
    if (!menuItem.querySelector('.lock-badge')) {
      const badge = document.createElement('span');
      badge.className = 'lock-badge';
      badge.textContent = `🔒 ${grad.cumulative_count}/50`;
      menuItem.appendChild(badge);
    }
  }
}
```

修正後:
```javascript
async function setupAutoIntakeMenuItem() {
  const menuItem = document.getElementById('navAutoIntake');
  if (!menuItem) return;
  const grad = await fetchGraduationStatus();
  if (!grad) { menuItem.style.display = 'none'; return; }
  // 有料プランなら表示、無料は非表示
  menuItem.style.display = grad.is_paid ? '' : 'none';
  // 既存のロックバッジは念のため削除
  const lb = menuItem.querySelector('.lock-badge');
  if (lb) lb.remove();
}
```

理由: 「卒業前はロック」表示を廃止。有料プランなら誰でもメニュー表示。

⚠️ 重要: バックエンドの `/api/user/graduation-status` の `is_paid`、`is_agent`、`graduated` の判定はそのまま維持(server.js側はDB列も含めて温存)。フロント表示のみ簡略化する。

---

### 🟢 Group D: 料金ページ(語彙修正)

#### D-1. Agent版ヘッダーコピー(line 1714-1715)
**操作: 文言修正**

修正前:
```html
<div class="pricing-section-title" style="margin-top:28px;">🤖 Agent版 — 自走する記帳エージェント</div>
<div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">ルーキーから、エージェントへ。そしてエリートへ。AIが自律的に仕訳・ルール学習・自動取り込みを行います。</div>
```

修正後:
```html
<div class="pricing-section-title" style="margin-top:28px;">🤖 Agent版 — 自走する記帳エージェント</div>
<div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">AIが自律的に仕訳・ルール学習・自動取り込み・自動承認を行います。精度を確認しながら、お好きな機能を有効化できます。</div>
```

理由: 「ルーキー〜エリート」のキャリアパス語彙を削除。新方針(信頼度確認→ユーザー判断で有効化)に沿った訴求に変更。

---

#### D-2. Agent プレミアム説明(line 1735)
**操作: 文言修正**

修正前:
```html
<div class="pricing-card-desc">月1,500件含む。大規模処理・キャリアパス全機能対応。</div>
```

修正後:
```html
<div class="pricing-card-desc">月1,500件含む。大規模処理・全自動化機能対応。</div>
```

理由: 「キャリアパス」は内部用語、顧客向けには「全自動化機能」で表現。

---

### 🟡 Group E: 取引先マスタの「育成中」「育成度」(数字ベースへ転換)

#### E-1. 「育成中」バッジ(line 1429)
**操作: 削除または文言変更**

修正前:
```html
<span class="incentive-badge" style="background:#E1F5EE;color:#0F6E56;">育成中</span>
```

修正後(2案):
- **案A(削除)**: バッジ自体を削除、シンプルに
- **案B(数字化)**: `<span class="incentive-badge" style="background:#E1F5EE;color:#0F6E56;">学習中</span>` に変更(より業務的)

**推奨: 案B「学習中」**

理由: 「育成」は人間メタファーで幼稚に感じる、「学習」は技術的で業務文脈に合う。バッジ自体は視覚的に意味があるので残す。

---

#### E-2. 「育成度」ラベル + ⭐表示(line 1446-1448)
**操作: 文言修正 + 表示変更**

修正前:
```html
<div class="master-extra-right">
  <div class="master-extra-label">育成度</div>
  <div class="master-extra-stars" id="masterStars">☆☆☆☆☆</div>
</div>
```

修正後(2案):
- **案A**: 「育成度」→「学習進度」、⭐表示は維持
- **案B**: 「育成度」→「学習取引先数」、⭐ではなく数字表示(例: `23/100社`)

**推奨: 案B(完全数字化)**

修正後:
```html
<div class="master-extra-right">
  <div class="master-extra-label">学習取引先数</div>
  <div class="master-extra-value" id="masterCountDisplay" style="color:#0F6E56;">0社</div>
</div>
```

理由: 「育成度⭐⭐⭐⭐⭐」は新方針で明示的に廃止対象(設計思想 v3.0 §3.1)。「学習取引先数」を数字で見せることで信頼度ベースの考え方に統一。

注意: ⭐表示用のクラス `.master-extra-stars` も併せて削除可能。

---

#### E-3. 育成度計算ロジック(line 2678-2685)
**操作: 削除または書き換え**

修正前:
```javascript
// 育成度（20件で1個・100件超えで⭐に変化）
const elStars = document.getElementById('masterStars');
if(elStars){
  const filled = Math.min(5, Math.floor(masterCount / 20));
  const isMax = masterCount >= 100;
  const star = isMax ? '⭐' : '★';
  elStars.textContent = star.repeat(filled) + '☆'.repeat(5-filled);
}
```

修正後(E-2案Bに対応):
```javascript
// 学習取引先数の表示
const elCountDisp = document.getElementById('masterCountDisplay');
if(elCountDisp){
  elCountDisp.textContent = `${masterCount}社`;
}
```

理由: ⭐表示ロジックを廃止、数字表示に統一。

---

### 🟢 Group F: コメント類(削除対象、優先度低)

#### F-1. CSS コメント(line 681)
**操作: 削除**(A-2と同時)

```css
/* v2.3.0: ルーキー卒業モーダル */
```

→ 該当CSSブロックごと削除。

---

#### F-2. HTMLコメント(line 1344, 1868, 1880)
**操作: 削除または修正**

- line 1344 `<!-- v2.3.0: 卒業演出モーダル -->` → 削除(A-1と同時)
- line 1868 `<!-- 卒業ステータス（未卒業のみ） -->` → 削除(B-1と同時)
- line 1880 `<!-- 機能ON/OFF（卒業後 or Agent版） -->` → `<!-- 自動取り込み設定 -->` に修正

---

#### F-3. JSコメント(line 4669, 4681, 4718)
**操作: 削除**(A-3、B-3と同時)

- line 4669 `// ===== 卒業演出 =====` → 削除
- line 4681 `// incrementMonthlyCount のレスポンスから卒業チェック...` → 削除
- line 4718 `// ルーキー進捗表示` → 削除

---

### ⚪ Group G: 維持する箇所(対象外)

参考までに、grep ヒットしたが**維持**するもの:

| 行 | 内容 | 理由 |
|---|---|---|
| 752 | `🎉 お支払いありがとうございます！` | 業務イベントの祝意、維持 |
| 1008 | `agent_premium:'Agent プレミアム', agent_elite:'Agent エリート'` | プラン名(機能差別化の名前として維持) |
| 1111 | `🎉 今なら無料期間中` | 業務告知、維持 |
| 1292 | `🎉 無料期間中` バッジ | 業務告知、維持 |
| 1740 | `Agent エリート` プラン名 | 維持 |
| 4443 | `🎉` 仕訳完了モーダル | 業務イベント、維持 |

---

## 🔧 実装順序の推奨(Claude Code向け)

### Step 1: 削除系(壊れにくい)
1. A-1 卒業モーダルHTML削除
2. A-2 卒業モーダルCSS削除
3. A-3 卒業演出JSロジック削除
4. B-1 ルーキー進捗セクション削除
5. B-2 卒業演出関連CSS削除
6. F-1, F-2, F-3 関連コメント削除

### Step 2: 文言修正(慎重に)
7. D-1 Agent版ヘッダーコピー修正
8. D-2 Agent プレミアム説明修正
9. E-1 「育成中」→「学習中」修正

### Step 3: ロジック書き換え(影響大)
10. B-3 `loadAutoIntakeSettings()` 関数の二分岐削除
11. C-2 `setupAutoIntakeMenuItem()` 関数の簡略化

### Step 4: 表示変更(数字ベース化)
12. E-2 「育成度⭐」→「学習取引先数」HTML変更
13. E-3 育成度計算ロジック → 数字表示ロジックに置き換え

### Step 5: 動作確認
- 無料トライアルユーザーで自動取り込みメニューが非表示
- 有料プランユーザー(SaaS版含む)で自動取り込みメニューが表示
- 設定パネルが直接開ける(ルーキー進捗バー無し)
- 卒業モーダルが発火しないこと
- 取引先マスタの「学習取引先数」が数字で表示されること

---

## ⚠️ 注意事項(Claude Code向け申し送り)

### バックエンドDB列は維持
- `users.cumulative_shiwake_count` は残す(精度メトリクスの土台になる)
- `users.graduated_rookie_at` は残す(将来の分析用)
- `/api/user/graduation-status` エンドポイントは残す(`is_paid` 判定で利用)

### 関連影響
- `gradModal`, `gradStatusSection`, `gradProgressBarFill`, `gradCountText`, `masterStars` といった id を別箇所で参照していないか **要確認**(grep で再チェック)
- 削除予定の関数 `showGradModal`, `openAutoIntakeSettings` の呼び出し元が他にないか **要確認**

### バージョン表記
- line 1265: `v2.3.0 · Sonnet 4.6` → 本作業完了時に **v2.3.1** へアップデート
  ```html
  <div style="text-align:right;...">v2.3.1 · Sonnet 4.6</div>
  ```

### 後続作業(本書の範囲外、v2.3.1 で別途実装予定)
- 信頼度メトリクスの記録(承認/修正フラグ・項目別)→ DB変更が必要
- 信頼度ダッシュボードの追加(承認率・修正パターン・項目別精度等)
- 「Agent版にアップグレード」CTAの追加(SaaS版で自動承認等を有効化しようとした場合)

これらは Phase A-3(信頼度メトリクスのDB設計)で別途仕様書を作成する。

---

## 📝 ドキュメントの依存関係

| ドキュメント | 役割 |
|---|---|
| `shiwake-ai_設計思想_v3_0.md` | 北極星、本書の根拠 |
| `shiwake-ai_UI言語置換マップ_v3_0.md`(本書) | index.html の修正指示書 |
| (今後作成) `shiwake-ai_信頼度メトリクス設計_v3_0.md` | DB変更とダッシュボード仕様(Phase A-3) |
| (今後作成) `shiwake-ai_v2_3_1_仕様書.md` | v2.3.1 リリース実装仕様(Phase B) |

---

**作成日**: 2026年5月10日
**作成契機**: 設計思想 v3.0 への転換に伴うUI改訂作業
**対象実装バージョン**: v2.3.1(リリース予定)
**作業担当**: Claude Code(本ドキュメントを基に実装)
