#!/usr/bin/env node
// 저녁(장 마감) 카드 데이터 조립 + 검사 + 캡션. 아침 build.mjs 와 같은 원칙(원자료 숫자, 사실만, 검사 통과해야 발행).
//
// 입력: work/market.json (fetch_market.mjs, 16시 이후 실행 — 오늘 국내 마감이 포함됨), inbox/<날짜>-pm.json (저녁 뉴스)
// 출력: posts/MV<YYYYMMDD>P/data.json, post.json
// 오늘 국내 시장이 휴장이면(오늘 마감 데이터가 없으면) 아무것도 만들지 않고 skip=true 로 끝낸다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resultsItems, srcUnion, countryItems, wonCrossRows } from "./global.mjs";
import { pickTheme } from "./themes.mjs";
import { coverCard } from "./cover.mjs";
import { seriesNo, lifeLine, hashtags, firstComment as engageComment, pmReel } from "./engage.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const kst = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const DATE = (process.env.DATE || "").trim() || kst();
const ID = "MV" + DATE.replaceAll("-", "") + "P";
const fail = (msg) => { console.error("중단: " + msg); process.exit(2); };
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const readJSON = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

const market = readJSON(join(ROOT, "work", "market.json"));
if (!market) fail("work/market.json 이 없습니다.");
const inbox = readJSON(join(ROOT, "inbox", `${DATE}-pm.json`)) || {};
const { kospi, kosdaq } = market.kr || {};
if (!kospi || kospi.date !== DATE) {
  console.log(`오늘(${DATE}) 국내 마감 데이터가 없습니다(휴장이거나 16시 전). 저녁 게시물을 건너뜁니다.`);
  out("skip", "true");
  process.exit(0);
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const md = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`;
const wd = (ymd) => WD[new Date(ymd + "T12:00:00+09:00").getUTCDay()];
const num = (v, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const eok = (won) => { const e = Math.round(Math.abs(won) / 1e8), jo = Math.floor(e / 10000), r = e % 10000; return (won > 0 ? "+" : won < 0 ? "-" : "") + (jo ? `${jo}조${r ? " " + r.toLocaleString("en-US") + "억" : ""}` : `${r.toLocaleString("en-US")}억`); };
const ok = (x) => x && x.price != null;
const fmtVal = (x) => `${x.prefix || ""}${num(x.price, x.symbol === "BTC-USD" ? 0 : x.symbol === "^TNX" ? 3 : 2)}${x.unit || ""}`;
const row = (x) => ({ name: x.name, sub: x.sub || "", value: fmtVal(x), chg: x.chg });
const hm = market.fetchedKST.slice(11), fmd = md(market.fetchedKST.slice(0, 10));
const warnings = [], skipped = [], cards = [];
const BANNED_WHY = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
// 숫자 카드의 '왜 움직였나' 한 줄: inbox.why.<key> = { t, src }. 규칙에 어긋나면 그 줄만 뺀다.
const whyOf = (key) => {
  const w = inbox.why && inbox.why[key];
  if (!w || !w.t || !w.src) return undefined;
  if (w.t.length > 40 || !/[·,]/.test(w.src) || BANNED_WHY.find((b) => w.t.includes(b))) { warnings.push(`왜 한 줄(${key}) 규칙 미달로 제외`); return undefined; }
  return { t: w.t, src: w.src };
};
const add = (c, reason) => { if (reason) skipped.push(`${c.label}: ${reason}`); else cards.push(c); };

const krw = market.macro.find((x) => x.symbol === "KRW=X");
const es = market.futures.find((x) => x.symbol === "ES=F"), nq = market.futures.find((x) => x.symbol === "NQ=F");
const dirWord = (v) => (v >= 0 ? "상승" : "하락");
const flowWord = (v) => (v < 0 ? "순매도" : "순매수");
const st = kospi.foreignStreak;
const streak = Math.abs(st) >= 2 ? `외국인 ${Math.abs(st)}거래일 연속 ${st < 0 ? "순매도" : "순매수"}` : `외국인 ${eok(kospi.foreign).replace(/^[+-]/, "")} ${flowWord(kospi.foreign)}`;

// 1 커버
// 잡지형 표지 (scripts/cover.mjs): 문구는 inbox.cover, 없거나 규칙 미달이면 숫자 문구
cards.push(coverCard({ root: ROOT, date: DATE, pm: true, inboxCover: inbox.cover, warnings, mood: kospi.chg >= 0 ? "up" : "down",
  fallback: { context: `오늘 국내 증시 · ${md(DATE)} 마감`,
    hook: [`코스피 ${Math.abs(kospi.chg).toFixed(2)}% ${dirWord(kospi.chg)}`, streak.replace("거래일", "일")],
    sub: "오늘 장 숫자 정리 · 옆으로 넘겨보세요" } }));


// 2 국내 마감·수급
const flow = (mk, r) => r && ({ market: mk, items: [
  { name: "개인", value: r.individual, text: eok(r.individual) }, { name: "외국인", value: r.foreign, text: eok(r.foreign) }, { name: "기관", value: r.institution, text: eok(r.institution) }] });
cards.push({ type: "flows", label: "국내 증시 · 오늘 마감", why: whyOf("kr"),
  title: `${streak}\n기관 ${eok(kospi.institution).replace(/^[+-]/, "")} ${flowWord(kospi.institution)}`,
  rows: [{ name: "코스피", sub: "KOSPI", value: num(kospi.close), chg: kospi.chg }, ...(kosdaq ? [{ name: "코스닥", sub: "KOSDAQ", value: num(kosdaq.close), chg: kosdaq.chg }] : [])],
  flows: [flow("코스피", kospi), flow("코스닥", kosdaq)].filter(Boolean),
  asof: `${md(DATE)}(${wd(DATE)}) 장 마감 · 수급은 잠정치(확정치와 다를 수 있음)` });

// 3 환율·아시아 마감
{
  const fx = [...["KRW=X"].map((s) => market.macro.find((x) => x.symbol === s)).filter(ok).map(row), ...wonCrossRows(market, num)];
  const asia = market.asia.filter(ok);
  add({ type: "groups", label: "환율 · 아시아 마감", why: whyOf("fx"),
    title: ok(krw) ? `원/달러 ${num(krw.price)}원\n아시아 증시 마감` : "환율과 아시아 증시",
    groups: [
      { title: `환율 · ${fmd} ${hm}`, rows: fx },
      { title: "아시아 증시 · 오늘 마감", rows: asia.map((x) => ({ ...row(x), sub: `${x.sub} · ${md(x.date)}` })) },
    ], asof: "등락은 전일 종가 대비" }, asia.length < 2 ? "아시아 데이터 부족" : null);
}

// 4·5 뉴스
const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const newsCard = (label, title, items) => {
  const clean = (items || []).filter((n) => n && n.h && n.d && n.src).filter((n) => {
    const bad = BANNED.find((w) => (n.h + n.d).includes(w)); if (bad) warnings.push(`${label}: 금지 표현 뉴스 1건 제외`);
    const long = n.h.length > 28 || n.d.length > 90; if (long) warnings.push(`${label}: 너무 긴 뉴스 1건 제외`);
    return !bad && !long;
  }).slice(0, 3);
  add({ type: "news", label, title, items: clean, asof: inbox.newsAsof || `${md(DATE)}(${wd(DATE)}) 언론 보도 기준` }, clean.length < 2 ? "뉴스 2건 미만" : null);
};
newsCard("국내 경제뉴스", "오늘 국내 시장을\n움직인 뉴스", inbox.domestic);
newsCard("해외 경제뉴스", "오늘의 해외\n경제 소식", inbox.global);

// 오늘 나온 해외 지표 (중국·일본 등 아시아 시간 발표) · 나라별 한 줄 — 예약 작업이 넣은 날만
{
  const items = resultsItems(inbox.results, warnings);
  if (items.length) cards.push({ type: "results", label: "오늘 나온 해외 지표", title: "오늘 발표된\n해외 경제지표 결과", items, src: srcUnion(items),
    asof: "예상·이전은 경제 캘린더 기준 · 예상 대비는 숫자 비교" });
  const ct = countryItems(inbox.countries, warnings);
  if (ct.length >= 2) cards.push({ type: "countries", label: "나라별 경제 상황", title: "미국·중국·유럽·일본\n요즘 경제 한 줄", items: ct,
    asof: inbox.newsAsof || `${md(DATE)}(${wd(DATE)}) 언론 보도 기준` });
}

// 6 미국 선물
{
  const f = market.futures.filter(ok);
  const vix = market.us.find((x) => x.symbol === "^VIX");
  add({ type: "rows", label: "미국 지수선물 · 오늘 밤", why: whyOf("futures"),
    title: es && nq ? `오늘 밤 미국 선물\nS&P ${pct(es.chg)} · 나스닥 ${pct(nq.chg)}` : "오늘 밤 미국 선물",
    rows: [...f.map(row), ...(ok(vix) ? [{ ...row(vix), sub: `변동성 지수 · ${md(vix.date)} 마감` }] : [])],
    asof: `선물은 ${fmd} ${hm} 기준, 전일 정산가 대비` }, f.length < 2 ? "선물 데이터 없음" : null);
}

// 7 오늘 밤 일정 (지금부터 내일 07:00 KST 까지)
{
  const from = new Date(market.fetchedAt).getTime();
  const until = new Date(`${DATE}T07:00:00+09:00`).getTime() + 864e5;
  const evs = (market.events || []).filter((e) => { const t = new Date(e.at).getTime(); return t >= from && t < until; });
  const merged = [];
  for (const e of evs) {
    const last = merged[merged.length - 1];
    const t = e.kstDate === DATE ? e.time : `익일 ${e.time}`;
    if (last && last.at === e.at && last.region === e.region) { if (!last.items.includes(e.item)) last.items.push(e.item); }
    else merged.push({ at: e.at, time: t, region: e.region, items: [e.item] });
  }
  const items = merged.slice(0, 6).map(({ time, region, items }) => {
    const s = [...items].sort((a, b) => a.startsWith("근원") - b.startsWith("근원"));
    return { time, region, item: s.slice(0, 2).join(" · ") + (s.length > 2 ? ` 외 ${s.length - 2}건` : "") };
  });
  add({ type: "schedule", label: "오늘 밤 일정", title: "오늘 밤\n챙겨 볼 경제 일정", items, asof: "한국 시간 · 경제 캘린더 기준, 일정은 바뀔 수 있습니다" }, items.length ? null : "오늘 밤 주요 일정 없음");
}

// 8 마무리
cards.push({ type: "outro", label: "마켓바이탈", lead: "평일 아침엔 개장 전 요약,\n저녁엔 장 마감 정리를\n기록합니다.", rules: ["종목 추천을 하지 않습니다", "모든 수치는 표기된 시점 기준입니다", "투자 판단과 책임은 본인에게 있습니다"] });

// 인스타 API 캐러셀은 최대 10장. 넘치면 덜 중요한 카드부터 뺀다 (순서: outro → countries → results)
for (const t of ["outro","countries","results"]) {
  if (cards.length <= 10) break;
  const i = cards.findIndex((c) => c.type === t);
  if (i >= 0) { skipped.push(`${cards[i].label}: 10장 제한으로 제외`); cards.splice(i, 1); }
}
if (cards.length > 10) fail(`카드가 ${cards.length}장입니다 (최대 10장).`);

// 캡션 (아침 캡션과 달라야 중복으로 걸리지 않는다)
const sign = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");
const tonight = cards.find((c) => c.type === "schedule");
const NO = seriesNo(ROOT, DATE, true);
const life = lifeLine(krw);
const mac = (sym) => market.macro.find((x) => x.symbol === sym);
const newsText = cards.filter((c) => c.type === "news").flatMap((c) => c.items.map((n) => n.h)).join(" ");
const TAGS = hashtags({ pm: true, kospi, krw, sox: market.us.find((x) => x.symbol === "^SOX"), tnx: mac("^TNX"), oil: mac("CL=F"), gold: mac("GC=F"), streak: st, newsText });
const event = tonight?.items?.[0] ? `${tonight.items[0].time} ${tonight.items[0].region} ${tonight.items[0].item}` : null;
const caption = [
  `${+DATE.slice(5, 7)}월 ${+DATE.slice(8)}일(${wd(DATE)}) 장 마감 정리 · 마감 바이탈 ${NO}일째`,
  "",
  `• 코스피 ${num(kospi.close)} ${sign(kospi.chg)}${Math.abs(kospi.chg).toFixed(2)}%, 외국인 ${eok(kospi.foreign)}원 (잠정)`,
  kosdaq ? `• 코스닥 ${num(kosdaq.close)} ${sign(kosdaq.chg)}${Math.abs(kosdaq.chg).toFixed(2)}%` : null,
  ok(krw) ? `• 원/달러 ${num(krw.price)}원 (${hm})` : null,
  life ? `• 생활 체감: ${life}` : null,
  tonight ? `• 오늘 밤: ${tonight.items.slice(0, 2).map((x) => `${x.time} ${x.region} ${x.item}`).join(", ")}` : null,
  "",
  ...(() => { // 주요 뉴스 (카드에 실린 뉴스 제목, 국내 2·해외 2)
    const pick = (label) => (cards.find((c) => c.type === "news" && c.label === label)?.items || []).slice(0, 2).map((n) => `• ${n.h}`);
    const lines = [...pick("국내 경제뉴스"), ...pick("해외 경제뉴스")];
    return lines.length ? ["주요 뉴스", ...lines, ""] : [];
  })(),
  "카드에서 오늘의 수급·뉴스·오늘 밤 일정을 확인하세요.",
  "저장해 두면 내일 아침 다시 보기 편합니다. 매일 받아 보려면 팔로우해 주세요.",
  "",
  "종목 추천을 하지 않습니다. 모든 수치는 카드에 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 카드에 언급된 종목을 보유하고 있을 수 있습니다.",
  "자료: Yahoo Finance, 다음 금융(수치), 각 언론 보도(뉴스 요약)",
  "",
  TAGS, // 고정 2개 + 그날 이슈 3개
].filter((x) => x !== null).join("\n");
const firstComment = engageComment(DATE, true); // 참여형 질문 (매수·매도·전망은 묻지 않음)

const block = (process.env.BLOCKLIST || "").split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 2);
if (block.filter((w) => (JSON.stringify(cards) + caption).toLowerCase().includes(w.toLowerCase())).length) fail("차단 목록 단어가 발견되어 발행하지 않습니다. (단어는 공개 로그에 출력하지 않음)");

const total = cards.length;
cards.forEach((c, i) => { c.page = `${i + 1} / ${total}`; });
const data = { id: ID, date: DATE, mode: "pm", dateLabel: `${+DATE.slice(5, 7)}월 ${+DATE.slice(8)}일 ${wd(DATE)}요일 · 마감`, handle: "@market.vitals", cards, theme: pickTheme(DATE, true),
  // 릴스 문구 (make_reel_v2.mjs 가 쓴다)
  reel: { ...pmReel({ kospi, kosdaq, krw, streakText: streak, es, event, life, no: NO }), tags: TAGS, comment: firstComment, mood: kospi.chg >= 0 ? "up" : "down" } };
const post = { id: ID, caption, first_comment: firstComment,
  slides: cards.map((c, i) => ({ file: `${String(i + 1).padStart(2, "0")}.jpg`, alt_text: `${i + 1}/${total}장. ${c.label}. ${(c.headline || c.title || c.lead || "").replace(/\n/g, " ")}` })) };
const dir = join(ROOT, "posts", ID);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "data.json"), JSON.stringify(data, null, 2));
writeFileSync(join(dir, "post.json"), JSON.stringify(post, null, 2));
console.log(`저녁 카드 ${total}장 → posts/${ID}/`);
for (const s of skipped) console.log("  제외: " + s);
for (const w of warnings) console.log("  주의: " + w);
out("folder", ID);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${ID} — 저녁 카드 ${total}장\n\n` + skipped.map((s) => `- 제외: ${s}\n`).join("") + "\n```\n" + caption + "\n```\n");
