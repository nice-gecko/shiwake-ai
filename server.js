const http = require('http');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { loadMaster, saveMaster, getMasterRoutes, updateMasterRoute, deleteMasterRoute } = require('./master');

const PORT = process.env.PORT || 3456;

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const SYSTEM = `あなたは日本の会計仕訳の専門家です。証憑画像を分析し、弥生会計の勘定科目体系に従って仕訳を生成してください。

【貸方（支払手段）の判定ルール】
1. クレジットカードの記載（VISA/Mastercard/JCB/カード/クレジット/サイン欄/カード番号末尾4桁など）があれば → 「未払金」
2. 電子マネー（Suica/nanaco/WAON/楽天Edy/PayPay/交通系ICなど）の記載があれば → 「未払金」
3. 銀行振込・口座引落の記載があれば → 「普通預金」
4. 「現金」「お預かり」「お釣り」の記載があれば → 「現金」
5. 判断できない場合のみ → 「現金」

【業種別デフォルト勘定科目】
以下の業種・店名パターンは対応する勘定科目を優先して使用してください：
- レストラン・居酒屋・カフェ・ファミレス・ファストフード・飲食店全般 → 借方「会議費」
- コンビニ（セブン-イレブン・ファミリーマート・ローソン等） → 借方「消耗品費」
- 100円ショップ（セリア・ダイソー・キャンドゥ等） → 借方「消耗品費」
- タクシー・電車・バス・ETC・交通系 → 借方「旅費交通費」
- ガス・電気・水道 → 借方「水道光熱費」
- 携帯・通信・インターネット → 借方「通信費」
- Amazon・楽天・通販サイト → 借方「消耗品費」

【複数明細の処理】
レシートに複数の商品・取引がある場合は明細ごとに分けてください。通帳の場合も明細ごとに分けてください。

【出力ルール - 最重要】
ページに記載されているすべての取引明細行を出力してください。
- 日付（YYYY/MM/DD）・店名・金額の3つが揃っている行はすべて出力
- 同じ店名・日付・金額の行が複数あっても、それぞれ別オブジェクトとして出力（絶対にまとめない）
- 半角カタカナの店名も正常な明細として出力
- 出力件数が少なすぎる場合はページを再確認して漏れがないか確認してください

【除外するもの - これだけ除外】
- 「ご請求金額合計」など合計金額のみの1行
- 「翌月繰越残高」など残高のみの行
- タイトル行・ヘッダー行

返答はJSON配列のみ。説明文・バッククォート・マークダウン記法は絶対に含めないでください。
[{"title":"取引先名","date":"YYYY/MM/DD","amount":"¥X,XXX","debit":"借方科目","credit":"貸方科目","tax":"課税仕入(10%)|課税仕入(8%軽減)|非課税|不課税","memo":"摘要","confidence":"high|mid|low","reason":"根拠50字以内"}]`;

async function callClaudeOnce(apiKey, content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content }] })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const startIdx = raw.indexOf('[');
  const endIdx = raw.lastIndexOf(']');
  if (startIdx === -1) return [];
  let jsonStr = endIdx > startIdx ? raw.slice(startIdx, endIdx + 1) : raw.slice(startIdx);
  try {
    return JSON.parse(jsonStr);
  } catch(e) {
    const lastComplete = jsonStr.lastIndexOf('},');
    if (lastComplete > 0) return JSON.parse(jsonStr.slice(0, lastComplete + 1) + ']');
    return [];
  }
}

// 最大2回試して件数が多い方を採用
async function callClaude(apiKey, content) {
  const result1 = await callClaudeOnce(apiKey, content);
  console.log(`  1回目: ${result1.length}件`);
  // 1回目で十分な件数（25件以上）なら2回目も試して多い方を採用
  const result2 = await callClaudeOnce(apiKey, content);
  console.log(`  2回目: ${result2.length}件`);
  const best = result1.length >= result2.length ? result1 : result2;
  console.log(`  採用: ${best.length}件`);
  // さらに少ない場合は3回目も試す
  if (best.length < 30) {
    const result3 = await callClaudeOnce(apiKey, content);
    console.log(`  3回目: ${result3.length}件`);
    const best3 = result3.length > best.length ? result3 : best;
    console.log(`  最終採用: ${best3.length}件`);
    return best3;
  }
  return best;
}

async function splitPdfToChunks(base64Data, chunkSize = 1) {
  const pdfBytes = Buffer.from(base64Data, 'base64');
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();
  const chunks = [];
  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await chunkDoc.copyPages(srcDoc, pageIndices);
    pages.forEach(p => chunkDoc.addPage(p));
    const chunkBytes = await chunkDoc.save();
    chunks.push({ data: Buffer.from(chunkBytes).toString('base64'), startPage: start + 1, endPage: end, totalPages });
  }
  return chunks;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/master') { getMasterRoutes(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/master') { updateMasterRoute(req, res); return; }
  if (req.method === 'DELETE' && req.url === '/api/master') { deleteMasterRoute(req, res); return; }

  if (req.method === 'POST' && req.url === '/api/split-pdf') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { data, fileName } = JSON.parse(body);
        const chunks = await splitPdfToChunks(data, 1);
        console.log(`split-pdf: ${fileName} → ${chunks.length}チャンク(${chunks[0]?.totalPages}ページ)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ chunks: chunks.map(c => ({ ...c, fileName })) }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze-chunk') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { imageDataList, fileNames, chunkIndex, totalChunks } = JSON.parse(body);
        const apiKey = process.env.ANTHROPIC_API_KEY || '';
        if (!apiKey) throw new Error('APIキーが設定されていません');

        const content = [];
        imageDataList.forEach((img, i) => {
          if (img.mediaType === 'application/pdf') {
            content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } });
          } else {
            content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
          }
          content.push({ type: 'text', text: `証憑${i+1}（${fileNames[i]}）を分析してください。` });
        });
        content.push({ type: 'text', text: 'JSON配列のみ返してください。バッククォートや説明文は不要です。' });

        const rawItems = await callClaude(apiKey, content);
        const master = loadMaster();

        // 日付不明・集計行を除外 + マスタ適用
        const EXCLUDE_TITLES = ['ETC', 'ETCカード', 'ETCカード利用分', 'ETC利用分'];
        const EXCLUDE_MEMOS = ['ETCカード利用分', 'ETC利用分', 'カード利用分'];
        const items = rawItems
          .filter(item => {
            const date = item.date || '';
            if (date === '不明' || date === '' || date === 'YYYY/MM/DD') return false;
            if (!/\d{4}\/\d{2}\/\d{2}/.test(date)) return false;
            // タイトルが集計行パターンなら除外
            const title = (item.title || '').trim();
            if (EXCLUDE_TITLES.includes(title)) return false;
            // 摘要が集計行パターンで金額が合計っぽければ除外
            const memo = (item.memo || '');
            if (EXCLUDE_MEMOS.some(m => memo.includes(m)) && !item.title.match(/[ぁ-ん]/)) return false;
            return true;
          })
          .map(item => {
            const rule = master[item.title];
            if (rule) {
              return { ...item, debit: rule.debit, credit: rule.credit, tax: rule.tax, masterApplied: true };
            }
            return item;
          });

        console.log(`チャンク ${chunkIndex+1}/${totalChunks}: ${rawItems.length}件取得 → ${items.length}件（マスタ${Object.keys(master).length}件適用）`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));
      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  console.log(`🔑 APIキー: ${process.env.ANTHROPIC_API_KEY ? '設定済み' : '未設定'}`);
});
