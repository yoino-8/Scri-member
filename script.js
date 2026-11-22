// PDFを読むライブラリ(pdf.js)は、リポジトリに入れず、CDN(jsDelivr)から読み込む。バージョンは固定
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs";
import { extractRows, parseRows } from "./pdfscript.js";
const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108"; // 上のimportと同じバージョンにすること
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + "/legacy/build/pdf.worker.min.mjs";
const $ = id => document.getElementById(id);
const S = { pdf: null, rows: [], items: [], mine: new Set(), names: new Map(), i: -1, page: 1, reveal: false, cache: {}, tok: 0, hide: false };

$("pick").onclick = () => $("file").click();
$("file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $("status").textContent = "読み込み中…";
  try {
    S.pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), cMapUrl: PDFJS_CDN + "/cmaps/", cMapPacked: true, standardFontDataUrl: PDFJS_CDN + "/standard_fonts/" }).promise;
    S.cache = {}; S.rows = []; S.mine.clear(); S.names = new Map();
    for (let p = 1; p <= S.pdf.numPages; p++) S.rows.push(...await extractRows(await S.pdf.getPage(p), p, pdfjsLib.Util));
    if (!S.rows.length) { $("status").textContent = "テキストを抽出できませんでした（スキャン画像のPDFは未対応）"; return }
    S.rows.forEach(r => r.raw = r.text); applyFix(); parse(); showOdd(); $("pgmax").textContent = "/ " + S.pdf.numPages; $("pg").max = S.pdf.numPages;
    $("status").textContent = `${f.name}：${S.pdf.numPages}ページ / ${S.items.length}項目（${S.rows.filter(r => r.vertical).length > S.rows.length / 2 ? "縦書き" : "横書き"}として読み込み）`;
    $("setup").hidden = false; renderChips(); sizeViewer(); S.i = -1; go(-1, true);
  } catch (err) { console.error(err); $("status").textContent = "読み込み失敗：" + err.message }
};

// ---- 台本のパース（処理本体は pdfscript.js） ----
function parse() {
  const r = parseRows(S.rows, S.manual || [], { parenDir: $("parenDir").checked, softBreak: $("softBreak").checked });
  S.names = r.names; S.items = r.items; S.rowItem = r.rowItem; showDiag();
}
// 読み取り結果の確認用：項目の区切りと、PDFから読み取った行を一覧にする
function showDiag() {
  const L = [];
  S.items.forEach((it, k) => {
    L.push(`■${k + 1} [${it.type === "dir" ? "ト書き" : "セリフ:" + it.speaker}] p${it.page}`);
    it.rows.forEach(ri => L.push(`   ${S.rows[ri].vertical ? "縦" : "横"} ${S.rows[ri].text}`));
  });
  $("diag").textContent = L.slice(0, 2000).join("\n");
}
$("parenDir").onchange = () => { rebuild() };
$("softBreak").onchange = () => { rebuild() };
const isMine = it => it && it.type === "line" && it.speakers.some(n => S.mine.has(n)); // 「佐藤・田中」のような同時セリフは、どちらかを選べば隠す

function renderChips() {
  $("chips").innerHTML = "";
  S.names.forEach((c, n) => {
    const b = document.createElement("span"); b.className = "chip" + (S.mine.has(n) ? " on" : ""); b.textContent = `${n}（${c}）`;
    b.onclick = () => { S.mine.has(n) ? S.mine.delete(n) : S.mine.add(n); renderChips(); refresh() };
    $("chips").appendChild(b);
  });
  $("start").disabled = !S.mine.size;
}
$("addBtn").onclick = () => {
  const n = $("addName").value.trim(); if (!n || !S.pdf) return;
  (S.manual = S.manual || []).push(n); const keep = new Set(S.mine); parse(); S.mine = keep; S.mine.add(n);
  $("addName").value = ""; renderChips(); go(-1, true);
};
$("start").onclick = () => go(S.items.findIndex(it => it.page >= S.page) - 0, true);

// ---- 移動・表示 ----
function go(i, force) {
  if (!S.items.length) return;
  i = Math.max(-1, Math.min(S.items.length - 1, i)); const old = S.page;
  S.i = i; S.reveal = false;
  if (i >= 0) S.page = S.items[i].page;
  $("pg").value = S.page;
  if (S.page !== old || force || !S.rendered) renderPage(); else drawOverlay();
  panels();
}
function refresh() { drawOverlay(); panels() }
function panels() {
  const it = S.items[S.i]; let o = null;
  for (let j = S.i; j >= 0; j--) if (!isMine(S.items[j])) { o = S.items[j]; break }
  $("topT").className = o && o.type === "dir" ? "dir" : "";
  $("topT").innerHTML = o ? (o.type === "line" ? `<span class="sp">${esc(o.speaker)}</span>` : "") + esc(o.text) : '<span class="muted">→ キーで開始</span>';
  const b = $("botT");
  if (isMine(it)) {
    b.className = ""; b.innerHTML = `<span class="sp">${esc(it.speaker)}</span><span class="mask${!S.hide || S.reveal ? " show" : ""}" id="m">${esc(it.text)}</span>`;
    $("m").onclick = toggleReveal;
  } else { b.className = "muted"; b.textContent = "（次の自分のセリフがここに出ます）" }
  const prog = $("prog"); // 進捗表示の要素は、HTMLから外していてもエラーにならないようにする
  if (prog) prog.textContent = S.i >= 0 ? `${S.i + 1} / ${S.items.length}` : "";
}
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function toggleReveal() { if (!S.hide) return; S.reveal = !S.reveal; panels(); drawOverlay() }

async function renderPage() {
  const tok = ++S.tok, p = S.page;
  const page = S.cache[p] || (S.cache[p] = await S.pdf.getPage(p));
  const w0 = page.getViewport({ scale: 1 }).width, avail = Math.max(280, $("pv").clientWidth - 20);
  S.scale = Math.min(1.8, avail / w0);
  const vp = page.getViewport({ scale: S.scale }), dpr = window.devicePixelRatio || 1, cv = $("cv");
  cv.width = vp.width * dpr; cv.height = vp.height * dpr; cv.style.width = vp.width + "px"; cv.style.height = vp.height + "px";
  $("wrap").style.width = vp.width + "px"; $("wrap").style.height = vp.height + "px";
  const ov = $("ov"); ov.style.width = vp.width + "px"; ov.style.height = vp.height + "px";
  await page.render({ canvasContext: cv.getContext("2d"), viewport: page.getViewport({ scale: S.scale * dpr }) }).promise;
  if (tok !== S.tok) return; S.rendered = true; drawOverlay();
}
// 黒塗り＆クリック領域
function drawOverlay() {
  const ov = $("ov"); ov.innerHTML = ""; const k = S.scale;
  S.rows.forEach((r, ri) => {
    if (r.page !== S.page) return;
    const idx = S.rowItem[ri], it = S.items[idx], d = document.createElement("div");
    const hide = isMine(it) && !(idx === S.i && (!S.hide || S.reveal));
    d.className = (hide ? "mine " : "") + (idx === S.i ? "cur" : "");
    Object.assign(d.style, { left: r.x * k - 2 + "px", top: r.y * k + "px", width: r.w * k + 4 + "px", height: r.h * k + "px" });
    d.onclick = () => go(idx); ov.appendChild(d);
  });
}

// ---- 日本語縦書きバグ改善（文字化けした文字の置換） ----
$("fixTbl").value = "W⇒ー\nÕ⇒～\nY⇒っ\n~⇒ッ\n¦⇒ゃ\nþ⇒ょ\nþ⇒ャ@カ\n¿⇒ュ\n/⇒ョ\nq⇒ぁ\n\u009d⇒ぃ\n\u0089⇒ぅ\ns⇒ぇ\n×⇒ぉ\nj⇒ァ\n+⇒ェ";
S.fix = false;
const variants = c => {
  const n = c.codePointAt(0), v = [c];
  if (c === "~") return v;                                              // 半角チルダのみ変換（全角～は対象外）
  if (n >= 0x21 && n <= 0x7E) v.push(String.fromCharCode(n + 0xFEE0));       // 半角→全角
  else if (n >= 0xFF01 && n <= 0xFF5E) v.push(String.fromCharCode(n - 0xFEE0)); // 全角→半角
  else if (c === "¦") v.push("￤"); else if (c === "￤") v.push("¦");
  return v
};
function fixMap() {
  // 通常ルール「変換前⇒変換後」と、条件付きルール「変換前⇒変換後@カ」（前の文字がカタカナのときだけ使う）
  const direct = new Map(), kata = new Map(), m = new Map(), k = new Map();
  for (const line of $("fixTbl").value.split(/\r?\n/)) {
    const p = line.split(/⇒|=>|->/); if (p.length < 2) continue;
    const a = [...p[0].trim()], raw = p[1].trim(), cond = /[@＠]カ$/.test(raw), b = raw.replace(/[@＠]カ$/, "").trim();
    if (a.length === 1 && b) (cond ? kata : direct).set(a[0], b);
  }
  direct.forEach((b, a) => m.set(a, b));
  direct.forEach((b, a) => variants(a).forEach(c => { if (!m.has(c)) m.set(c, b) }));
  kata.forEach((b, a) => k.set(a, b));
  kata.forEach((b, a) => variants(a).forEach(c => { if (!k.has(c)) k.set(c, b) }));
  return { m, k };
}
// 1文字ずつ1回だけ置換（二重置換なし）。条件付きルールは、直前の変換後の文字がカタカナ（ー含む）のときに優先する
const convert = (s, fx) => {
  let out = "";
  for (const c of s) {
    const prev = out.slice(-1);
    if (fx.k.has(c) && /[\u30A0-\u30FF]/.test(prev)) out += fx.k.get(c);
    else out += fx.m.has(c) ? fx.m.get(c) : c;
  }
  return out;
};
function applyFix() { const fx = fixMap(); S.rows.forEach(r => r.text = S.fix ? convert(r.raw, fx) : r.raw) }
function showOdd() { // 変換表にない怪しい文字(制御文字・Latin-1)を一覧表示
  const fx = fixMap(), cnt = new Map();
  for (const r of S.rows) for (const c of r.raw) { const n = c.codePointAt(0); if ((n < 0x20 || (n >= 0x7F && n <= 0xFF)) && n !== 0xA0 && !fx.m.has(c) && !fx.k.has(c)) cnt.set(c, (cnt.get(c) || 0) + 1) }
  $("odd").textContent = cnt.size ? "変換表にない怪しい文字： " + [...cnt].slice(0, 12).map(([c, k]) => { const n = c.codePointAt(0); return `U+${n.toString(16).toUpperCase().padStart(4, "0")}${n > 0x9F || (n > 0x20 && n < 0x7F) ? "「" + c + "」" : ""}×${k}` }).join(" / ") : "";
}
function rebuild() {
  if (!S.pdf) return;
  applyFix(); parse(); S.mine = new Set([...S.mine].filter(n => S.names.has(n)));
  showOdd(); renderChips(); go(-1, true);
}
$("fixBtn").onclick = () => { S.fix = !S.fix; $("fixBtn").textContent = "縦書きバグ修正：" + (S.fix ? "ON" : "OFF"); $("fixBtn").classList.toggle("pri", S.fix); rebuild() };
$("fixTbl").onchange = () => { if (S.fix) rebuild(); else showOdd() };

// PDFビューワーの大きさ：読み込み時の画面サイズから1回だけ決めて、使用中は固定
function sizeViewer() {
  const W = innerWidth, H = innerHeight, mobile = W <= 800, pv = $("pv");
  const w = mobile ? W - 32 : Math.round((W - 48) / 2), h = mobile ? Math.round(H * .55) : Math.max(420, H - 62 - 16);
  Object.assign(pv.style, { width: w + "px", height: h + "px", minHeight: "0", flex: "none" });
}

// ---- 操作 ----
$("hideMode").onchange = () => { S.hide = $("hideMode").checked; S.reveal = false; refresh() };
document.addEventListener("click", e => { if (e.target.tagName === "BUTTON") e.target.blur() }); // ボタンにフォーカスが残るとSpaceが誤作動するため
$("next").onclick = () => go(S.i + 1); $("prev").onclick = () => go(S.i - 1);
// ページを移動する（ページ入力欄・◀▶ボタンの共通処理）。そのページに項目があれば、先頭の項目へ移る
function changePage(n) {
  if (!S.pdf) return;
  const p = Math.max(1, Math.min(S.pdf.numPages, Math.round(+n) || 1));
  const k = S.items.findIndex(it => it.page >= p);
  if (k >= 0 && S.items[k].page === p) go(k); else { S.page = p; S.i = Math.max(-1, k - 1); go(S.i, true); S.page = p; $("pg").value = p; renderPage() }
}
$("pg").onchange = () => changePage($("pg").value);
$("pgPrev").onclick = () => changePage(S.page - 1);
$("pgNext").onclick = () => changePage(S.page + 1);
document.addEventListener("keydown", e => {
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") { e.preventDefault(); go(S.i + 1) }
  else if (e.key === "ArrowLeft") { e.preventDefault(); go(S.i - 1) }
  else if (e.key === "ArrowDown" || e.key === " ") { e.preventDefault(); if (isMine(S.items[S.i])) toggleReveal() }
});
// ※画面サイズが変わってもPDFビューワーの大きさは変えない（読み込み時に1回だけ決める）
