// v2.12.0 L2: 国税庁 法人番号Web-API クライアント（T番号＝登録番号による1件照会のみ）
//
// 【v2.11.x の名称検索(/name)を全面廃止した理由・DSK が curl で実測】
//   ・法人格を付けると必ず0件（/name は法人格を含まない名称部分を検索対象にしている）
//       「株式会社高島屋」→0件 / 「株式会社阪急阪神百貨店」→0件
//   ・法人格を外すと今度は候補が上限100件に達して切られる（「高島屋」→100件）
//   ・候補1件でも正解とは限らない（「阪急百貨店」→1件だが「阪急百貨店ユニフォーム株式会社」＝別法人）
//   ・半角英数と日本語の混在で HTTP 400（「flowershopStyle寺田町」）
//   → 名称からの同定は構造的に成立しない。登録番号(T番号)による1件取得に一本化する。
//
// 【T番号方式が優れている点・実測】
//   T4140001032990 → 芦有ドライブウェイ株式会社
//     ※ AI は「芦屋ドライブウェイ 芦屋料金所」と読み取っていたが、現物のレシートは「芦有」。
//        T番号が AI の誤読を検出した。これが L2 の本来の目的。
//   T9120001131732 → アクセス・アイ株式会社
//
// 【設計方針】
//   /num は法人番号を指定した1件取得であり、あいまいさが構造的に存在しない。
//   よって候補の突合・スコアリング・フォールバックは一切実装しない。

// fast-xml-parser は遅延 require する。
// 理由: npm install 漏れでサーバ起動そのものが落ちるのを防ぐため。
// 未インストール時は verifyByInvoiceNumber が throw → 呼び出し側が 'error' を記録するだけ。
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

const NTA_NUM_ENDPOINT = 'https://api.houjin-bangou.nta.go.jp/4/num';
// 適格請求書発行事業者の登録番号。T + 数字13桁。法人の場合、13桁は法人番号と一致する。
const INVOICE_NUMBER_RE = /^T[0-9]{13}$/;

// 登録番号(T番号)で法人を1件照会する。
// 戻り値:
//   null … 照会しなかった（形式不正 / NTA_APP_ID 未設定）。呼び出し側で「スキップ」扱い
//   { verified_status: 'not_found' }                                  … 該当なし
//   { verified_status: 'verified', corporate_number, verified_name, … } … 確定
// throw … HTTP非200 / XMLパース不可（呼び出し側で 'error' を記録して後日再試行できる）
async function verifyByInvoiceNumber(invoiceNumber) {
  const raw = (invoiceNumber == null) ? '' : String(invoiceNumber).trim();
  if (!INVOICE_NUMBER_RE.test(raw)) return null;   // 形式不正 → APIを叩かない
  const appId = process.env.NTA_APP_ID;
  if (!appId) return null;                          // 未設定 → 何もしない（エラーにしない）

  const corporateNumber = raw.slice(1);             // 先頭の "T" を除いた13桁
  const params = new URLSearchParams({
    id: appId,
    number: corporateNumber,
    type: '12',       // XML
    // ※ /num に mode パラメータは存在しない（/name 専用）ので付けない
  });

  const res = await fetch(`${NTA_NUM_ENDPOINT}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`NTA /num error: HTTP ${res.status}`);
  }
  const xml = await res.text();

  const XMLParser = getXMLParser();
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,   // 法人番号13桁を数値化させない（先頭0の欠落・精度落ちを防ぐ）
    trimValues: true,
  });
  const parsed = parser.parse(xml);

  // 応答ルートは <corporations><corporation>…</corporation></corporations>
  const root = parsed?.corporations || parsed?.Corporations || {};
  let list = root.corporation || root.Corporation || [];
  if (!Array.isArray(list)) list = list ? [list] : [];

  if (list.length === 0) {
    return { verified_status: 'not_found', corporate_number: null, verified_name: null,
             queried: raw, close_date: null, location: null };
  }

  const c = list[0];   // 法人番号指定なので常に1件。あいまいさは構造的に存在しない
  const closeDate = (c.closeDate != null && String(c.closeDate) !== '') ? String(c.closeDate) : null;
  const location = [c.prefectureName, c.cityName]
    .map(v => (v != null ? String(v) : ''))
    .filter(Boolean)
    .join('');

  return {
    verified_status: 'verified',
    corporate_number: c.corporateNumber != null ? String(c.corporateNumber) : corporateNumber,
    verified_name: c.name != null ? String(c.name) : '',
    queried: raw,
    // 閉鎖済みでも verified とする（過去の取引としては正当なため）。呼び出し側でログに出す。
    close_date: closeDate,
    location: location || null,
  };
}

module.exports = {
  INVOICE_NUMBER_RE,
  verifyByInvoiceNumber,
};
