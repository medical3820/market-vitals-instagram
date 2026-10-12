#!/usr/bin/env node
// 토요일 주간 정리 캐러셀: 한 주(월~금) 지수·금리·환율·원자재 등락, 국내 투자자별 주간 순매수, 다음 주 경제 일정.
// 출력: posts/MVW<금요일YYYYMMDD>/data.json, post.json  (이미지는 render.mjs 가 만든다)
// 환경변수: FRIDAY=YYYY-MM-DD (기본: 오늘(KST) 이전의 가장 최근 금요일), BLOCKLIST(선택)
// 숫자는 야후 파이낸스·다음 금융 원자료에서 직접 받는다. 없는 값은 빼고 추정하지 않는다.

import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { koTitle, keepEvent } from "./calendar_map.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const fail = (m) => { console.error("중단: " + m); process.exit(2); };
const ymdIn = (sec, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(sec * 1000));
const kstNow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();

let FRI = (process.env.FRIDAY || "").trim();
if (!FRI) { FRI = addDays(kstNow, -1); while (dow(FRI) !== 5) FRI = addDays(FRI, -1); }
const MON = addDays(FRI, -4), PREV_FRI = addDays(FRI, -7);
const ID = "MVW" + FRI.replaceAll("-", "");
const md = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`;

async function getJSON(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 1500 * (i + 1))); }
  }
}

// 야후: 이번 주 금요일까지의 마지막 종가 vs 지난주 금요일까지의 마지막 종가
async function weekly(symbol, name, opts = {}) {
  try {
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`);
    const r = j.chart.result[0], tz = r.meta.exchangeTimezoneName;
    const bars = (r.timestamp || []).map((t, i) => ({ d: ymdIn(t, tz), c: r.indicators.quote[0].close[i] })).filter((b) => b.c != null);
    const end = [...bars].reverse().find((b) => b.d <= FRI), ref = [...bars].reverse().find((b) => b.d <= PREV_FRI);
    if (!end || !ref || end.d < MON) throw new Error("이번 주 종가 없음");
    return { symbol, name, ...opts, price: end.c, chg: +((end.c / ref.c - 1) * 100).toFixed(2), date: end.d };
  } catch (e) { console.log(`  제외: ${name} (${e.message})`); return null; }
}

async function daumWeek(market) {
  try {
    const j = await getJSON(`https://finance.daum.net/api/market_index/days?page=1&perPage=20&market=${market}&pagination=true`, { Referer: "https://finance.daum.net/" });
    const rows = (j.data || []).map((r) => ({ d: r.date.slice(0, 10), close: r.tradePrice, ind: r.individualStraightPurchasePrice, frn: r.foreignStraightPurchasePrice, inst: r.institutionStraightPurchasePrice }));
    const week = rows.filter((r) => r.d >= MON && r.d <= FRI);
    const ref = rows.find((r) => r.d <= PREV_FRI);
    if (!week.length || !ref) throw new Error("주간 데이터 없음");
    const sum = (k) => week.reduce((s, r) => s + r[k], 0);
    return { close: week[0].close, chg: +((week[0].close / ref.close - 1) * 100).toFixed(2), days: week.length, individual: sum("ind"), foreign: sum("frn"), institution: sum("inst"), last: week[0].d };
  } catch (e) { console.log(`  제외: 다음 금융 ${market} (${e.message})`); return null; }
}

async function nextWeekEvents() {
  try {
    const list = await getJSON("https://nfs.faireconomy.media/ff_calendar_nextweek.json");
    const seen = new Map();
    for (const e of list) {
      if (!keepEvent(e)) continue;
      const name = koTitle(e.title); if (!name) continue;
      const at = new Date(e.date); if (isNaN(at)) continue;
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
      const g = (t) => p.find((x) => x.type === t).value;
      const key = at.toISOString() + e.country;
      const region = { USD: "미국", CNY: "중국", JPY: "일본", EUR: "유럽" }[e.country];
      if (!seen.has(key)) seen.set(key, { at: at.toISOString(), time: `${+g("month")}/${+g("day")} ${g("hour")}:${g("minute")}`, region, items: [] });
      const s = seen.get(key); if (!s.items.includes(name)) s.items.push(name);
    }
    return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6).map((s) => {
      const it = [...s.items].sort((a, b) => a.startsWith("근원") - b.startsWith("근원"));
      return { time: s.time, region: s.region, item: it.slice(0, 2).join(" · ") + (it.length > 2 ? ` 외 ${it.length - 2}건` : "") };
    });
  } catch (e) { console.log(`  제외: 다음 주 일정 (${e.message})`); return []; }
}

const [us, macro, kospi, kosdaq, events] = await Promise.all([
  Promise.all([
    weekly("^GSPC", "S&P 500", { sub: "대형주 500" }), weekly("^IXIC", "나스닥", { sub: "기술주 중심" }),
    weekly("^DJI", "다우존스", { sub: "우량주 30" }), weekly("^SOX", "필라델피아 반도체", { sub: "SOX" }),
    weekly("^VIX", "VIX", { sub: "변동성 지수" }),
  ]),
  Promise.all([
    weekly("^TNX", "미 국채 10년물", { sub: "금리(%)", unit: "%", d: 3 }), weekly("DX-Y.NYB", "달러인덱스", { sub: "DXY" }),
    weekly("KRW=X", "원/달러", { sub: "원" }), weekly("CL=F", "WTI 원유", { sub: "달러/배럴", prefix: "$" }),
    weekly("GC=F", "금", { sub: "달러/온스", prefix: "$" }), weekly("BTC-USD", "비트코인", { sub: "달러", prefix: "$", d: 0 }),
  ]),
  daumWeek("KOSPI"), daumWeek("KOSDAQ"), nextWeekEvents(),
]);

const spx = us[0];
if (!spx || !kospi) fail("S&P 500 또는 코스피 주간 데이터가 없습니다.");
const num = (v, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const val = (x) => `${x.prefix || ""}${num(x.price, x.d ?? 2)}${x.unit || ""}`;
const row = (x) => ({ name: x.name, sub: x.sub, value: val(x), chg: x.chg });
const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const eok = (won) => { const e = Math.round(Math.abs(won) / 1e8), jo = Math.floor(e / 10000), r = e % 10000; return (won > 0 ? "+" : won < 0 ? "-" : "") + (jo ? `${jo}조${r ? " " + r.toLocaleString("en-US") + "억" : ""}` : `${r.toLocaleString("en-US")}억`); };
const range = `${md(MON)}~${md(FRI)}`;

const cards = [];
const usOk = us.filter(Boolean), macroOk = macro.filter(Boolean);
const ups = usOk.slice(0, 3).filter((x) => x.chg > 0).length;
const krw = macroOk.find((x) => x.symbol === "KRW=X"), tnx = macroOk.find((x) => x.symbol === "^TNX");
cards.push({ type: "cover", label: "마켓바이탈 주간", headline: `S&P 500 ${pct(spx.chg)}\n코스피 ${pct(kospi.chg)}`, sub: `${range} 한 주 시장 정리 · 옆으로 넘겨 보세요`,
  tiles: [
    { name: "S&P 500 · 주간", value: val(spx), chg: spx.chg },
    { name: "코스피 · 주간", value: num(kospi.close), chg: kospi.chg },
    krw ? { name: "원/달러 · 주간", value: val(krw), chg: krw.chg } : { name: "원/달러", value: "-", chg: null },
    tnx ? { name: "미 10년물 · 주간", value: val(tnx), chg: tnx.chg } : { name: "미 10년물", value: "-", chg: null },
  ] });
cards.push({ type: "rows", label: "미국 증시 · 주간", title: (ups === 3 ? "3대 지수 주간 모두 상승" : ups === 0 ? "3대 지수 주간 모두 하락" : "3대 지수 주간 혼조"), rows: usOk.map(row), asof: `미국 현지 ${md(PREV_FRI)} 종가 대비 ${md(FRI)} 종가` });
cards.push({ type: "rows", label: "금리 · 환율 · 원자재 · 주간", title: [tnx && `미 10년물 주간 ${pct(tnx.chg)}`, krw && `원/달러 주간 ${pct(krw.chg)}`].filter(Boolean).join("\n") || "금리·환율·원자재 한 주", rows: macroOk.map(row), asof: `${md(PREV_FRI)} 대비 ${md(FRI)} 종가` });
const flow = (mk, r) => r && ({ market: mk, items: [
  { name: "개인", value: r.individual, text: eok(r.individual) }, { name: "외국인", value: r.foreign, text: eok(r.foreign) }, { name: "기관", value: r.institution, text: eok(r.institution) }] });
cards.push({ type: "flows", label: "국내 증시 · 주간 수급", title: `이번 주 외국인\n${eok(kospi.foreign).replace(/^[+-]/, "")} ${kospi.foreign < 0 ? "순매도" : "순매수"}`,
  rows: [{ name: "코스피", sub: "KOSPI", value: num(kospi.close), chg: kospi.chg }, ...(kosdaq ? [{ name: "코스닥", sub: "KOSDAQ", value: num(kosdaq.close), chg: kosdaq.chg }] : [])],
  flows: [flow("코스피", kospi), flow("코스닥", kosdaq)].filter(Boolean), asof: `${range} ${kospi.days}거래일 합계 · 막대 길이는 시장 안에서만 비교` });
if (events.length) cards.push({ type: "schedule", label: "다음 주 일정", title: "다음 주\n챙겨 볼 경제 일정", items: events, asof: "한국 시간 · 경제 캘린더 기준, 일정은 바뀔 수 있습니다" });
cards.push({ type: "outro", label: "마켓바이탈", lead: "평일 아침엔 개장 전 요약,\n토요일엔 한 주 정리를\n기록합니다.", rules: ["종목 추천을 하지 않습니다", "모든 수치는 표기된 시점 기준입니다", "투자 판단과 책임은 본인에게 있습니다"] });

const caption = [
  `${range} 한 주 시장 정리`,
  "",
  `• S&P 500 주간 ${pct(spx.chg)}, 코스피 주간 ${pct(kospi.chg)}`,
  `• 코스피 외국인 주간 ${eok(kospi.foreign)}원`,
  krw ? `• 원/달러 ${val(krw)}원 (주간 ${pct(krw.chg)})` : null,
  "",
  "다음 주 경제 일정까지 카드로 정리했습니다. 저장해 두고 다음 주에 다시 보세요.",
  "",
  "종목 추천을 하지 않습니다. 모든 수치는 카드에 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 카드에 언급된 종목을 보유하고 있을 수 있습니다.",
  "자료: Yahoo Finance, 다음 금융",
  "",
  "#마켓바이탈 #주간시황 #미국증시 #코스피 #환율",
].filter((x) => x !== null).join("\n");

const block = (process.env.BLOCKLIST || "").split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 2);
const allText = JSON.stringify(cards) + caption;
if (block.filter((w) => allText.toLowerCase().includes(w.toLowerCase())).length) fail("차단 목록 단어가 발견되어 발행하지 않습니다. (단어는 공개 로그에 출력하지 않음)");

const total = cards.length;
cards.forEach((c, i) => { c.page = `${i + 1} / ${total}`; });
const data = { id: ID, date: FRI, dateLabel: `${range} 주간`, handle: "@market.vitals", cards };
const post = { id: ID, caption, first_comment: "다음 주 가장 주목하는 경제 일정은 무엇인가요? 댓글로 알려 주세요.",
  slides: cards.map((c, i) => ({ file: `${String(i + 1).padStart(2, "0")}.jpg`, alt_text: `${i + 1}/${total}장. ${c.label}. ${(c.headline || c.title || c.lead || "").replace(/\n/g, " ")}` })) };
const out = join(ROOT, "posts", ID);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "data.json"), JSON.stringify(data, null, 2));
writeFileSync(join(out, "post.json"), JSON.stringify(post, null, 2));
console.log(`주간 카드 ${total}장 → posts/${ID}/ (${range})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `folder=${ID}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${ID} — 주간 카드 ${total}장\n\n\`\`\`\n${caption}\n\`\`\`\n`);
