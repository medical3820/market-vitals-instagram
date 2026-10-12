#!/usr/bin/env node
// 마켓바이탈 카드 데이터 조립 + 발행 전 검사 + 캡션.
//
// 입력: work/market.json (fetch_market.mjs 결과), inbox/<날짜>.json (뉴스·일정, 클라우드 예약 작업이 작성)
//       inbox/<날짜>.market.json (예약 작업이 따로 받아 둔 숫자 — 액션에서 다음 금융이 막힐 때 국내 수급 대체용)
// 출력: posts/MV<YYYYMMDD>/data.json, post.json  (이미지는 render.mjs 가 만든다)
//
// 환경변수: DATE (YYYY-MM-DD, 기본 오늘 KST), BLOCKLIST (원장님 보유 종목 이름·코드, 쉼표/줄바꿈 구분 — GitHub secret)
//
// 이 저장소와 액션 로그는 공개다. 차단 목록의 단어나 보유 종목은 어떤 경우에도 출력하지 않는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const kst = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const DATE = (process.env.DATE || "").trim() || kst();
const ID = "MV" + DATE.replaceAll("-", "");
const OUTDIR = join(ROOT, "posts", ID);
const log = (...a) => console.log(...a);
const warnings = [];
const fail = (msg) => { console.error("중단: " + msg); process.exit(2); };

// ── 입력 ──────────────────────────────────────────────────────────────
const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const market = readJSON(join(ROOT, "work", "market.json"));
if (!market) fail("work/market.json 이 없습니다. fetch_market.mjs 를 먼저 실행하세요.");
const inbox = readJSON(join(ROOT, "inbox", `${DATE}.json`)) || {};
const backup = readJSON(join(ROOT, "inbox", `${DATE}.market.json`));
if (!market.kr?.kospi && backup?.kr?.kospi) { market.kr = backup.kr; warnings.push("국내 지수·수급은 예약 작업이 받아 둔 값을 사용"); }

// ── 서식 ──────────────────────────────────────────────────────────────
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const md = (ymd) => { const [, m, d] = ymd.split("-"); return `${+m}/${+d}`; };
const wd = (ymd) => WD[new Date(ymd + "T12:00:00+09:00").getUTCDay()];
const mdw = (ymd) => `${md(ymd)}(${wd(ymd)})`;
const num = (v, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const eok = (won) => { // 원 → "2조 767억" (한국식)
  const e = Math.round(Math.abs(won) / 1e8), jo = Math.floor(e / 10000), r = e % 10000;
  const s = jo ? `${jo}조${r ? " " + r.toLocaleString("en-US") + "억" : ""}` : `${r.toLocaleString("en-US")}억`;
  return (won > 0 ? "+" : won < 0 ? "-" : "") + s;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const fresh = (ymd, maxDays) => ymd && daysBetween(ymd, DATE) >= 0 && daysBetween(ymd, DATE) <= maxDays;
const fetchedHM = market.fetchedKST.slice(11);
const fmtVal = (x) => {
  if (x.price == null) return null;
  const d = x.symbol === "BTC-USD" ? 0 : x.symbol === "^TNX" ? 3 : 2;
  return `${x.prefix || ""}${num(x.price, d)}${x.unit || ""}`;
};
const row = (x) => ({ name: x.name, sub: x.sub || "", value: fmtVal(x), chg: x.chg });
const ok = (x) => x && x.price != null;

// ── 카드 ──────────────────────────────────────────────────────────────
const cards = [];
const skipped = [];
const add = (card, reason) => { if (reason) skipped.push(`${card.label}: ${reason}`); else cards.push(card); };

const [spx, ndx, dji, sox, vix] = market.us;
const usDate = spx.date;
const { kospi, kosdaq } = market.kr || {};
if (!ok(spx) || !fresh(usDate, 5)) fail("미국 지수 데이터가 없거나 오래됐습니다.");
if (!kospi || !fresh(kospi.date, 7)) fail("국내 지수 데이터가 없거나 오래됐습니다.");

// 1 커버
const idx3 = [spx, ndx, dji];
const ups = idx3.filter((x) => x.chg > 0).length;
const usLine = ups === 3 ? "뉴욕 3대 지수 모두 상승" : ups === 0 ? "뉴욕 3대 지수 모두 하락" : "뉴욕 3대 지수 혼조";
const krLine = `코스피 ${Math.abs(kospi.chg).toFixed(2)}% ${kospi.chg >= 0 ? "상승" : "하락"}`;
const krw = market.macro.find((x) => x.symbol === "KRW=X");
cards.push({
  type: "cover", label: "마켓바이탈",
  headline: `${usLine}\n${krLine}`,
  sub: "개장 전 시장 요약 · 옆으로 넘겨 보세요",
  tiles: [
    { name: `S&P 500 · ${md(usDate)}`, value: fmtVal(spx), chg: spx.chg },
    { name: `코스피 · ${md(kospi.date)}`, value: num(kospi.close), chg: kospi.chg },
    ok(krw) ? { name: `원/달러 · ${fetchedHM}`, value: num(krw.price), chg: krw.chg } : { name: "원/달러", value: "-", chg: null },
    ok(vix) ? { name: `VIX · ${md(vix.date)}`, value: fmtVal(vix), chg: vix.chg } : { name: "VIX", value: "-", chg: null },
  ],
});

// 뉴스 카드 공통: 금지 표현이 있는 항목은 뺀다
const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라","급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const newsCard = (label, title, items) => {
  const clean = (items || []).filter((n) => n && n.h && n.d && n.src).filter((n) => {
    const bad = BANNED.find((w) => (n.h + n.d).includes(w));
    if (bad) warnings.push(`${label}: 금지 표현이 있는 뉴스 1건 제외`);
    const long = n.h.length > 28 || n.d.length > 90; // 카드 밖으로 넘치지 않게
    if (long) warnings.push(`${label}: 너무 긴 뉴스 1건 제외 (제목 28자·요약 90자 이내)`);
    return !bad && !long;
  }).slice(0, 3);
  add({ type: "news", label, title, items: clean, asof: inbox.newsAsof || `${mdw(DATE)} 오전 기준` },
    clean.length < 2 ? "뉴스 2건 미만" : null);
};

// 2 해외 뉴스
newsCard("해외 경제뉴스", "간밤 세계 시장을\n움직인 뉴스", inbox.global);

// 3 미국 증시
{
  const soxNote = ok(sox) && Math.sign(sox.chg) !== Math.sign(ups >= 2 ? 1 : -1)
    ? `\n반도체지수는 ${Math.abs(sox.chg).toFixed(2)}% ${sox.chg >= 0 ? "상승" : "하락"}` : "";
  add({ type: "rows", label: "미국 증시", title: usLine.replace("뉴욕 ", "") + soxNote,
    rows: market.us.filter(ok).map(row), asof: `미국 현지 ${mdw(usDate)} 마감` });
}

// 4 미국 업종
{
  const s = market.sectors.filter((x) => ok(x) && x.date === usDate).sort((a, b) => b.chg - a.chg);
  const top = s[0], bot = s[s.length - 1];
  add({ type: "bars", label: "미국 업종 흐름",
    title: s.length ? `${top.name} ${pct(top.chg)} 가장 강세\n${bot.name} ${pct(bot.chg)} 가장 약세` : "",
    items: s.map((x) => ({ name: x.name, sub: x.sub, chg: x.chg })),
    note: "미국은 투자자별 매매가 공개되지 않아 업종 ETF 등락으로 돈의 방향을 봅니다",
    asof: `미국 현지 ${mdw(usDate)} 마감` }, s.length < 5 ? "업종 데이터 부족" : null);
}

// 5 금리·환율·원자재
{
  const m = market.macro.filter(ok);
  const tnx = m.find((x) => x.symbol === "^TNX");
  add({ type: "rows", label: "금리 · 환율 · 원자재",
    title: [tnx && `미 10년물 ${num(tnx.price, 3)}%`, ok(krw) && `원/달러 ${num(krw.price)}원`].filter(Boolean).join("\n"),
    rows: m.map(row),
    asof: `금리·달러 ${md(usDate)} 마감 · 그 외 ${md(DATE)} ${fetchedHM}` }, m.length < 4 ? "지표 부족" : null);
}

// 6 지수선물·아시아
{
  const f = market.futures.filter(ok), a = market.asia.filter(ok);
  const es = f.find((x) => x.symbol === "ES=F"), nq = f.find((x) => x.symbol === "NQ=F");
  add({ type: "groups", label: "지수선물 · 아시아",
    title: es && nq ? `미국 선물 S&P ${pct(es.chg)}\n나스닥 ${pct(nq.chg)}` : "개장 전 선물과 아시아",
    groups: [
      { title: `미국 지수선물 · ${md(DATE)} ${fetchedHM}`, rows: f.map(row) },
      { title: "아시아 증시 · 최근 마감", rows: a.map((x) => ({ ...row(x), sub: `${x.sub} · ${md(x.date)}` })) },
    ],
    asof: "선물은 전일 정산가 대비" }, f.length < 2 ? "선물 데이터 없음" : null);
}

// 7 국내 뉴스
newsCard("국내 경제뉴스", "국내 시장을\n움직인 뉴스", inbox.domestic);

// 8 국내 증시·수급
{
  const st = kospi.foreignStreak;
  const streak = Math.abs(st) >= 2 ? `외국인 ${Math.abs(st)}거래일 연속 ${st < 0 ? "순매도" : "순매수"}`
    : `외국인 ${eok(kospi.foreign).replace(/^[+-]/, "")} ${kospi.foreign < 0 ? "순매도" : "순매수"}`;
  const flow = (mk, r) => r && ({ market: mk, items: [
    { name: "개인", value: r.individual, text: eok(r.individual) },
    { name: "외국인", value: r.foreign, text: eok(r.foreign) },
    { name: "기관", value: r.institution, text: eok(r.institution) },
  ] });
  add({ type: "flows", label: "국내 증시 · 투자자별 순매수",
    title: `${streak}\n${krLine}`,
    rows: [
      { name: "코스피", sub: "KOSPI", value: num(kospi.close), chg: kospi.chg },
      ...(kosdaq ? [{ name: "코스닥", sub: "KOSDAQ", value: num(kosdaq.close), chg: kosdaq.chg }] : []),
    ],
    flows: [flow("코스피", kospi), flow("코스닥", kosdaq)].filter(Boolean),
    asof: `${mdw(kospi.date)} 확정 · 막대 길이는 시장 안에서만 비교` });
}

// 9 오늘 일정 — 해외는 경제 캘린더(코드 수집), 국내는 예약 작업이 inbox.schedule_kr 로 보탠다.
{
  const from = new Date(market.fetchedAt).getTime();
  const until = new Date(`${DATE}T08:00:00+09:00`).getTime() + 864e5; // 다음 날 08:00 KST 까지
  const kr = (inbox.schedule_kr || []).filter((x) => x && x.time && x.item)
    .map((x) => ({ at: new Date(`${DATE}T${x.time}:00+09:00`).toISOString(), kstDate: DATE, time: x.time, region: "한국", item: x.item }));
  const all = [...(market.events || []), ...kr].sort((a, b) => a.at.localeCompare(b.at));
  // 같은 시각·지역은 한 줄로 묶는다 (예: 21:30 미국 CPI · 근원 CPI)
  const merge = (list, withDate) => {
    const out = [];
    for (const e of list) {
      const t = withDate ? `${md(e.kstDate)} ${e.time}` : (e.kstDate === DATE ? e.time : `익일 ${e.time}`);
      const last = out[out.length - 1];
      if (last && last.at === e.at && last.region === e.region) { if (!last.item.includes(e.item)) last.item += ` · ${e.item}`; }
      else out.push({ at: e.at, time: t, region: e.region, item: e.item });
    }
    return out.slice(0, 6).map(({ time, region, item }) => ({ time, region, item }));
  };
  let items = merge(all.filter((e) => { const t = new Date(e.at).getTime(); return t >= from - 36e5 && t < until; }), false);
  let title = `${mdw(DATE)} 챙겨 볼 일정`;
  if (!items.length) { // 오늘 큰 일정이 없으면 이번 주 남은 일정
    items = merge(all.filter((e) => new Date(e.at).getTime() >= from), true);
    title = "이번 주 남은\n주요 일정";
  }
  if (market.events == null) warnings.push("경제 캘린더 수집 실패 — 국내 일정만 사용");
  add({ type: "schedule", label: "경제 일정", title, items,
    asof: "한국 시간 · 해외 지표는 경제 캘린더 기준, 일정은 바뀔 수 있습니다" }, items.length < 1 ? "일정 없음" : null);
}

// 10 마무리
cards.push({ type: "outro", label: "마켓바이탈",
  lead: "매일 개장 전,\n같은 지표를 같은 순서로\n기록합니다.",
  rules: ["종목 추천을 하지 않습니다", "모든 수치는 표기된 시점 기준입니다", "투자 판단과 책임은 본인에게 있습니다"] });

// ── 캡션 ──────────────────────────────────────────────────────────────
const sign = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");
const caption = [
  `${+DATE.slice(5, 7)}월 ${+DATE.slice(8)}일(${wd(DATE)}) 개장 전 시장 요약`,
  "",
  `• 미국(${md(usDate)} 마감): S&P 500 ${sign(spx.chg)}${Math.abs(spx.chg).toFixed(2)}%, 나스닥 ${sign(ndx.chg)}${Math.abs(ndx.chg).toFixed(2)}%`,
  `• 코스피(${md(kospi.date)}): ${num(kospi.close)} ${sign(kospi.chg)}${Math.abs(kospi.chg).toFixed(2)}%, 외국인 ${eok(kospi.foreign)}원`,
  ok(krw) ? `• 원/달러: ${num(krw.price)}원 (${md(DATE)} ${fetchedHM})` : null,
  "",
  "카드에서 뉴스·업종 흐름·수급·오늘 일정을 확인하세요.",
  "",
  "종목 추천을 하지 않습니다. 모든 수치는 카드에 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "자료: Yahoo Finance, 다음 금융(수치), 각 언론 보도(뉴스 요약)",
  "",
  "#마켓바이탈 #아침시황 #미국증시 #코스피 #환율 #경제뉴스 #주식공부",
].filter((x) => x !== null).join("\n");

// ── 검사: 차단 목록(보유 종목) ─────────────────────────────────────────
const block = (process.env.BLOCKLIST || "").split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 2);
if (!block.length) warnings.push("BLOCKLIST 가 비어 있음 — 보유 종목 검사를 하지 못함");
const allText = JSON.stringify(cards) + "\n" + caption;
const hits = block.filter((w) => allText.toLowerCase().includes(w.toLowerCase())).length;
if (hits) fail(`차단 목록 단어가 ${hits}개 발견되었습니다. 발행하지 않습니다. (단어는 공개 로그에 출력하지 않음)`);

// ── 출력 ──────────────────────────────────────────────────────────────
const total = cards.length;
cards.forEach((c, i) => { c.page = `${i + 1} / ${total}`; });
const data = { id: ID, date: DATE, dateLabel: `${+DATE.slice(5, 7)}월 ${+DATE.slice(8)}일 ${wd(DATE)}요일`, handle: "@marketvitals.kr", cards };
const altOf = (c, i) => `${i + 1}/${total}장. ${c.label}. ${(c.headline || c.title || c.lead || "").replace(/\n/g, " ")}`;
const post = {
  id: ID, caption, first_comment: "",
  slides: cards.map((c, i) => ({ file: `${String(i + 1).padStart(2, "0")}.jpg`, alt_text: altOf(c, i) })),
};
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, "data.json"), JSON.stringify(data, null, 2));
writeFileSync(join(OUTDIR, "post.json"), JSON.stringify(post, null, 2));

log(`카드 ${total}장 → posts/${ID}/`);
for (const s of skipped) log("  제외: " + s);
for (const w of warnings) log("  주의: " + w);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `folder=${ID}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### ${ID} — 카드 ${total}장\n\n` + skipped.map((s) => `- 제외: ${s}\n`).join("") + warnings.map((w) => `- 주의: ${w}\n`).join("") +
    "\n```\n" + caption + "\n```\n");
}
