// v2.11.0 L2: 国税庁 法人番号Web-API クライアント（純粋なAPI呼び出し＋判定のみ。DBには触らない）
//
// 実測済み仕様（DSK が curl で確認済み）:
//   ・エンドポイント: https://api.houjin-bangou.nta.go.jp/4/name
//   ・パラメータ: id（アプリケーションID） / name / type=12（XML） / mode=1（前方一致）
//   ・応答は XML のみ（JSON 非対応）
//   ・半角ハイフン等の記号を含む名前を送ると HTTP 400（例:「セブン-イレブン」→400）
//   ・記号を除去すると精度が上がる（例:「セブンイレブン」→3件）
//   ・応答の並び順は関連度順ではなく法人番号順 → 先頭を採用してはならない
// fast-xml-parser は遅延 require する。
// 理由: npm install 漏れでサーバ起動そのものが落ちるのを防ぐため。
// 未インストール時は searchByName が throw → verifyName が 'error' を返すだけで、承認処理は成功する。
let _XMLParser = null;
function getXMLParser() {
  if (_XMLParser) return _XMLParser;
  try {
    _XMLParser = require('fast-xml-parser').XMLParser;
  } catch (e) {
    throw new Error('fast-xml-parser が未インストールです（npm install を実行してください）');
  }
  return _XMLParser;
}

const NTA_ENDPOINT = 'https://api.houjin-bangou.nta.go.jp/4/name';

// 比較時に両側から除去する法人格・法人格の略記
// ※ 長いものから順に並べる（「一般社団法人」が「社団法人」より先に当たるように）
const LEGAL_FORMS = [
  '特定非営利活動法人', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '社会福祉法人', '独立行政法人', '国立大学法人', '公立大学法人', '医療法人社団',
  '医療法人財団', '学校法人', '宗教法人', '医療法人', '社会医療法人',
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '相互会社',
  '協同組合', '信用金庫', '信用組合', '農業協同組合',
];

// 送信用の正規化: 英数字・ひらがな・カタカナ・漢字「以外」を全除去する。
// 記号を含むと API が 400 を返すため、これは必須の前処理。
//   例: 「セブン-イレブン」 → 「セブンイレブン」
//       「(株)ローソン 渋谷店」 → 「株ローソン渋谷店」
function normalizeForQuery(str) {
  if (!str) return '';
  return String(str)
    // 記号除去より先に法人格の略記を正式表記へ戻す
    // （先に記号を落とすと「(株)」が孤立した「株」として残り、社名の一部と区別できなくなるため）
    .replace(/[㈱]|[（(]株[）)]/g, '株式会社')
    .replace(/[㈲]|[（(]有[）)]/g, '有限会社')
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    // 許可: 半角英数字 / ひらがな / カタカナ(長音符ーを含む) / CJK統合漢字 / 々〆ヵヶ
    .replace(/[^0-9A-Za-zぁ-ゖァ-ヺー一-鿿々〆]/g, '')
    .trim();
}

// 比較用の正規化: normalizeForQuery に加えて法人格を除去し、英字は小文字に揃える。
//   例: 「株式会社ローソン」 → 「ろーそん」ではなく「ローソン」（カナはそのまま）
//       「ローソン株式会社」 → 「ローソン」
function normalizeForCompare(str) {
  let s = normalizeForQuery(str);   // この時点で ㈱/(株) は「株式会社」に正規化済み
  if (!s) return '';
  for (const form of LEGAL_FORMS) {
    s = s.split(form).join('');
  }
  return s.toLowerCase().trim();
}

// 国税庁APIを名称で検索する。
// 戻り値: [{ corporateNumber, name, closeDate, prefectureName, cityName }, ...]
//   ・closeDate が入っている法人（閉鎖済み）は除外して返す
//   ・NTA_APP_ID 未設定 / 正規化後が空 の場合は null を返す（呼び出し側で「何もしない」判断に使う）
async function searchByName(rawName) {
  const appId = process.env.NTA_APP_ID;
  if (!appId) return null;                       // 未設定なら何もしない（エラーにしない）
  const query = normalizeForQuery(rawName);
  if (!query) return null;

  const params = new URLSearchParams({
    id: appId,
    name: query,
    type: '12',   // XML
    mode: '1',    // 前方一致
  });
  const res = await fetch(`${NTA_ENDPOINT}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`NTA API error: HTTP ${res.status}`);
  }
  const xml = await res.text();

  const XMLParser = getXMLParser();
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,      // 法人番号13桁を数値化させない（先頭0の欠落・精度落ちを防ぐ）
    trimValues: true,
  });
  const parsed = parser.parse(xml);

  // 応答ルートは <corporations><corporation>…</corporation></corporations>
  const root = parsed?.corporations || parsed?.Corporations || {};
  let list = root.corporation || root.Corporation || [];
  if (!Array.isArray(list)) list = list ? [list] : [];

  return list
    .map(c => ({
      corporateNumber: c.corporateNumber != null ? String(c.corporateNumber) : null,
      name:            c.name != null ? String(c.name) : '',
      closeDate:       c.closeDate != null && String(c.closeDate) !== '' ? String(c.closeDate) : null,
      prefectureName:  c.prefectureName != null ? String(c.prefectureName) : '',
      cityName:        c.cityName != null ? String(c.cityName) : '',
    }))
    .filter(c => !c.closeDate);   // 閉鎖済みは候補から除外
}

// ===== v2.11.1: 店舗名フォールバック =====
// レシートの取引先名は「登記名＋店舗名」が常態のため、1段目が0件のときだけ
// 末尾の店舗名を落として1回だけ再検索する（APIコールは1件あたり最大2回）。
const BRANCH_SUFFIXES = ['営業所', '出張所', '支店', '支社', '本店', '店']; // 長い順に判定
// 社名の一部であり、絶対に落としてはならない語（「山田商店」→「山田」を防ぐ）
const BRANCH_EXCLUDE  = ['商店', '酒店', '売店', '書店', '薬店', '販売店'];
const MIN_CORE_LEN    = 3;  // 法人格を除いた実体部分の最小長
const MAX_PLACE_CHARS = 4;  // 店舗名の地名部分として落とす上限文字数

// v2.11.2: 文字種の判定。同一クラスの連続を途中で切らないための土台。
//   'kata'（カタカナ） / 'hira'（ひらがな） / 'alnum'（半角英数字） / 'kanji' / 'other'
//   長音符「ー」(U+30FC) は、ひらがな語にもカタカナ語にも付くため 'long'（ワイルドカード）とし、
//   隣がかな（ひらがな/カタカナ/長音符）ならすべて「同一クラス扱い」にする。
//   例:「すかいらーく」は ら|ー、ー|く の境界で切らせない。
function charClass(ch) {
  if (!ch) return 'other';
  if (ch === 'ー') return 'long';
  if (/[ァ-ヺ]/.test(ch)) return 'kata';
  if (/[ぁ-ゖ]/.test(ch)) return 'hira';
  if (/[0-9A-Za-z]/.test(ch)) return 'alnum';
  if (/[一-鿿々〆]/.test(ch)) return 'kanji';
  return 'other';
}

// 「境界 prev|next で切ってよいか」。同一クラスの連続を途中で切る場合は false。
// ・漢字どうしは許可（地名は漢字が大半のため）
// ・カタカナどうし / ひらがなどうし / 半角英数字どうし は禁止
// ・長音符「ー」は隣がかなならすべて禁止（かな語の途中を切らない）
function canCutBetween(prev, next) {
  const a = charClass(prev), b = charClass(next);
  if (a === 'other' || b === 'other') return true;
  if (a === 'kanji' || b === 'kanji') return true;          // 漢字が絡む境界は許可
  const kana = c => (c === 'kata' || c === 'hira' || c === 'long');
  if (kana(a) && kana(b)) {
    // かな同士: 長音符が絡むなら常に禁止。それ以外は同一クラスのときだけ禁止
    if (a === 'long' || b === 'long') return false;
    return a !== b;                                          // カタカナ|ひらがな の境界は許可
  }
  if (a === 'alnum' && b === 'alnum') return false;
  return true;
}

// 正規化済み文字列から末尾の店舗名を1回だけ落とす。
// v2.11.2: 貪欲な最大カットをやめ、地名の文字数を 4→3→2→1→0 の順に試し、
//   「文字種制約」と「最小長制約」を両方満たす最初の候補を採用する。
// 戻り値: { stripped, removed } / null（フォールバックしない）
function stripBranchSuffix(normalized) {
  if (!normalized) return null;
  // 除外語に該当したらフォールバックしない
  for (const ex of BRANCH_EXCLUDE) {
    if (normalized.endsWith(ex)) return null;
  }
  const suffix = BRANCH_SUFFIXES.find(s => normalized.endsWith(s) && normalized.length > s.length);
  if (!suffix) return null;

  const base = normalized.slice(0, -suffix.length);   // 接尾辞だけ落とした状態（末尾1回だけ・再帰なし）
  // 先頭の法人格（「株式会社」等）の長さ。ここへ食い込むカットは禁止する。
  // ※ normalizeForCompare は「完全な法人格」しか除去できないため、
  //   「株式会社」を「株式会」に切ると実体3文字と誤判定される。その穴を塞ぐ。
  const legalPrefix = LEGAL_FORMS.find(f => normalized.startsWith(f));
  const legalLen = legalPrefix ? legalPrefix.length : 0;

  // 地名部分を n 文字（4→0）落とす候補を長い順に評価する
  for (let n = MAX_PLACE_CHARS; n >= 0; n--) {
    if (n > base.length) continue;
    const stripped = n === 0 ? base : base.slice(0, -n);
    if (!stripped || stripped === normalized) continue;
    // 最小長制約（法人格を割らない ＋ 実体3文字以上）
    if (stripped.length < legalLen + MIN_CORE_LEN) continue;
    if (stripped.length < MIN_CORE_LEN) continue;
    if (normalizeForCompare(stripped).length < MIN_CORE_LEN) continue;
    // 文字種制約: 残る最後の文字と、除去部分の先頭文字が同一クラス連続なら切らない
    const prev = stripped[stripped.length - 1];
    const next = normalized[stripped.length];
    if (!canCutBetween(prev, next)) continue;   // 1文字短い候補へバックオフ
    return { stripped, removed: normalized.slice(stripped.length) };
  }
  return null;
}

// フォールバック時の判定（1段目より厳しくする＝誤登録防止）
// v2.11.2: 削りすぎを直したので厳格版に戻した。以下の【両方】を満たす候補のみ採用する。
//   (a) 候補の正規化名が「除去後の名前」と完全一致する
//   (b) 候補の正規化名が「除去前の名前（正規化済み）」の先頭部分に一致する
// 両方を満たす候補がちょうど1件のときだけ verified。複数なら ambiguous、0件なら not_found。
function judgeFallback(originalQuery, strippedQuery, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { verified_status: 'not_found', corporate_number: null, verified_name: null };
  }
  const origCore  = normalizeForCompare(originalQuery);
  const stripCore = normalizeForCompare(strippedQuery);
  if (!stripCore) {
    return { verified_status: 'not_found', corporate_number: null, verified_name: null };
  }

  const hits = candidates.filter(c => {
    const cc = normalizeForCompare(c.name);
    return cc === stripCore            // (a) 除去後の名前と完全一致
        && origCore.startsWith(cc);    // (b) 除去前の名前の先頭に一致
  });
  if (hits.length === 0) {
    return { verified_status: 'not_found', corporate_number: null, verified_name: null };
  }
  if (hits.length > 1) {
    return { verified_status: 'ambiguous', corporate_number: null, verified_name: null };
  }
  return {
    verified_status: 'verified',
    corporate_number: hits[0].corporateNumber,
    verified_name: hits[0].name,
  };
}

// 候補リストから確認結果を判定する（文字列一致のみ。Sonnet は使わない）
// 戻り値: { verified_status, corporate_number, verified_name }
// ※ v2.11.1 でも 1段目の判定ロジックは変更していない
function judge(title, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    // 該当なし。個人事業主・屋号は法人番号を持たないため、これは異常ではない
    return { verified_status: 'not_found', corporate_number: null, verified_name: null };
  }
  if (candidates.length === 1) {
    return {
      verified_status: 'verified',
      corporate_number: candidates[0].corporateNumber,
      verified_name: candidates[0].name,
    };
  }
  // 複数候補: 法人格を落とした正規化名で完全一致するものを探す
  // ※ 応答は法人番号順で関連度順ではないため、先頭採用は絶対にしない
  const target = normalizeForCompare(title);
  const exact = candidates.filter(c => normalizeForCompare(c.name) === target);
  if (target && exact.length === 1) {
    return {
      verified_status: 'verified',
      corporate_number: exact[0].corporateNumber,
      verified_name: exact[0].name,
    };
  }
  return { verified_status: 'ambiguous', corporate_number: null, verified_name: null };
}

// 名称1件を確認する高水準API。DBには触らない。
// 戻り値: { verified_status, corporate_number, verified_name } / null(NTA_APP_ID未設定等でスキップ)
async function verifyName(title) {
  const q1 = normalizeForQuery(title);

  // ---- 1段目: そのままの名前で検索（v2.11.0 と同一の挙動） ----
  let c1;
  try {
    c1 = await searchByName(title);
  } catch (e) {
    console.warn('NTA searchByName failed (stage1):', title, e.message);
    return { verified_status: 'error', corporate_number: null, verified_name: null,
             stage: 1, query: q1, candidate_count: 0, removed_suffix: null };
  }
  if (c1 === null) return null;   // 未設定・正規化後が空 → 何もしない
  if (c1.length > 0) {
    return { ...judge(title, c1),
             stage: 1, query: q1, candidate_count: c1.length, removed_suffix: null };
  }

  // ---- 2段目: 1段目が0件のときだけ、末尾の店舗名を落として再検索 ----
  const fb = stripBranchSuffix(q1);
  if (!fb) {
    return { verified_status: 'not_found', corporate_number: null, verified_name: null,
             stage: 1, query: q1, candidate_count: 0, removed_suffix: null };
  }
  let c2;
  try {
    c2 = await searchByName(fb.stripped);
  } catch (e) {
    console.warn('NTA searchByName failed (stage2):', fb.stripped, e.message);
    return { verified_status: 'error', corporate_number: null, verified_name: null,
             stage: 2, query: fb.stripped, candidate_count: 0, removed_suffix: fb.removed };
  }
  if (c2 === null) return null;
  return { ...judgeFallback(q1, fb.stripped, c2),
           stage: 2, query: fb.stripped, candidate_count: c2.length, removed_suffix: fb.removed };
}

module.exports = {
  normalizeForQuery,
  normalizeForCompare,
  stripBranchSuffix,
  searchByName,
  judge,
  judgeFallback,
  verifyName,
};
