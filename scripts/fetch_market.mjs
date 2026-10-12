#!/usr/bin/env node
// 마켓바이탈 숫자 데이터 수집 — 야후 파이낸스(해외 지표), 다음 금융(국내 지수·투자자별 순매수).
// 숫자는 요약 모델을 거치지 않고 원자료에서 직접 받는다. 기사·LLM이 옮겨 적으며 생기는 오류를 막기 위해서다.
//
// 사용: node scripts/fetch_market.mjs [출력경로=market.json]
// Node 20+ (내장 fetch). 실패한 항목은 null 로 남기고 errors 배열에 사유를 적는다 — 추정값으로 채우지 않는다.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.argv[2] || "market.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const errors = [];

const kstParts = (date) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}` };
};
const dayIn = (sec, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(sec * 1000));

async function getJSON(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

// 야후: range=1d 의 previousClose 가 야후 화면의 등락률 기준(전일 종가·정산가)과 같다.
async function yahoo(symbol, name, opts = {}) {
  try {
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`);
    const m = j.chart.result[0].meta;
    const price = m.regularMarketPrice;
    const prev = m.previousClose ?? m.chartPreviousClose;
    if (typeof price !== "number" || typeof prev !== "number" || prev === 0) throw new Error("가격 필드 없음");
    return {
      symbol, name, ...opts,
      price, prev,
      chg: +(((price / prev) - 1) * 100).toFixed(2),
      date: dayIn(m.regularMarketTime, m.exchangeTimezoneName), // 거래소 현지 날짜
      time: new Date(m.regularMarketTime * 1000).toISOString(),
    };
  } catch (e) {
    errors.push(`${name}(${symbol}): ${e.message}`);
    return { symbol, name, ...opts, price: null, chg: null, date: null, time: null };
  }
}

// 다음 금융: Referer 가 있어야 열린다. 원 단위 순매수 금액.
async function daum(market, todayKST, nowHM) {
  try {
    const j = await getJSON(
      `https://finance.daum.net/api/market_index/days?page=1&perPage=20&market=${market}&pagination=true`,
      { Referer: "https://finance.daum.net/" },
    );
    const rows = (j.data || []).map((r) => ({
      date: r.date.slice(0, 10),
      close: r.tradePrice,
      change: r.changePrice,
      chg: +((r.changePrice / (r.tradePrice - r.changePrice)) * 100).toFixed(2),
      individual: r.individualStraightPurchasePrice,
      foreign: r.foreignStraightPurchasePrice,
      institution: r.institutionStraightPurchasePrice,
    }));
    // 장중 값이 섞이지 않게: 오늘 줄은 16:00(KST) 이후에만 확정으로 본다.
    const done = rows.filter((r) => r.date < todayKST || (r.date === todayKST && nowHM >= "16:00"));
    if (!done.length) throw new Error("확정된 거래일 없음");
    const last = done[0];
    // 외국인 연속 순매수/순매도 일수 (확정일 기준)
    const sign = Math.sign(last.foreign);
    let streak = 0;
    for (const r of done) { if (Math.sign(r.foreign) === sign && sign !== 0) streak++; else break; }
    return { market, ...last, foreignStreak: sign === 0 ? 0 : sign * streak, recent: done.slice(0, 5) };
  } catch (e) {
    errors.push(`다음 금융 ${market}: ${e.message}`);
    return null;
  }
}

// 경제 일정: 공개 경제 캘린더(ForexFactory 내보내기). 시각은 KST 로 바꾸고, 같은 시각·같은 지표의 m/m·y/y 는 한 줄로 묶는다.
const REGION = { USD: "미국", CNY: "중국", JPY: "일본", EUR: "유럽" };
const KO = {
  "CPI": "소비자물가지수(CPI)", "Core CPI": "근원 CPI", "PPI": "생산자물가지수(PPI)", "Core PPI": "근원 PPI",
  "Retail Sales": "소매판매", "Core Retail Sales": "근원 소매판매", "Non-Farm Employment Change": "비농업 고용",
  "Unemployment Rate": "실업률", "Average Hourly Earnings": "평균 시간당 임금", "Unemployment Claims": "신규 실업수당 청구",
  "Federal Funds Rate": "연준 기준금리 결정", "FOMC Statement": "FOMC 성명", "FOMC Press Conference": "FOMC 기자회견",
  "FOMC Meeting Minutes": "FOMC 의사록", "Advance GDP": "GDP 속보치", "Prelim GDP": "GDP 잠정치", "Final GDP": "GDP 확정치",
  "GDP": "GDP", "Core PCE Price Index": "근원 PCE 물가", "PCE Price Index": "PCE 물가", "ISM Manufacturing PMI": "ISM 제조업 PMI",
  "ISM Services PMI": "ISM 서비스업 PMI", "JOLTS Job Openings": "JOLTS 구인건수", "Prelim UoM Consumer Sentiment": "미시간대 소비자심리(예비)",
  "CB Consumer Confidence": "콘퍼런스보드 소비자신뢰", "ADP Non-Farm Employment Change": "ADP 민간고용",
  "Empire State Manufacturing Index": "뉴욕 제조업지수", "Philly Fed Manufacturing Index": "필라델피아 제조업지수",
  "Durable Goods Orders": "내구재 주문", "Core Durable Goods Orders": "근원 내구재 주문", "Industrial Production": "산업생산",
  "Building Permits": "건축허가", "Housing Starts": "주택착공", "Existing Home Sales": "기존주택 판매", "New Home Sales": "신규주택 판매",
  "Crude Oil Inventories": "원유 재고", "Trade Balance": "무역수지", "Manufacturing PMI": "제조업 PMI", "Caixin Manufacturing PMI": "차이신 제조업 PMI",
  "BOJ Policy Rate": "일본은행 금리 결정", "BOJ Press Conference": "일본은행 기자회견", "Main Refinancing Rate": "ECB 금리 결정",
  "ECB Press Conference": "ECB 기자회견", "Monetary Policy Statement": "통화정책 결정",
};
const koTitle = (t) => {
  const base = t.replace(/\s+(m\/m|y\/y|q\/q)$/, "");
  if (KO[base]) return KO[base];
  const sp = base.match(/^(Fed Chair(?:man)?|FOMC Member|ECB President|BOJ Gov) (.+) Speaks$/);
  if (sp) return { "Fed Chair": "연준 의장", "Fed Chairman": "연준 의장", "FOMC Member": "연준 위원", "ECB President": "ECB 총재", "BOJ Gov": "일본은행 총재" }[sp[1]] + ` ${sp[2]} 발언`;
  return null;
};
async function calendar() {
  try {
    const list = await getJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    const ev = [];
    for (const e of list) {
      if (!REGION[e.country]) continue;
      if (!(e.impact === "High" || (e.country === "USD" && e.impact === "Medium"))) continue;
      const name = koTitle(e.title);
      if (!name) continue;
      const at = new Date(e.date);
      if (isNaN(at)) continue;
      const k = kstParts(at);
      ev.push({ at: at.toISOString(), kstDate: k.ymd, time: k.hm, region: REGION[e.country], item: name, impact: e.impact });
    }
    // 같은 시각·지역·지표 이름은 한 번만
    const seen = new Set();
    return ev.filter((e) => { const key = e.at + e.region + e.item; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => a.at.localeCompare(b.at));
  } catch (e) {
    errors.push(`경제 일정: ${e.message}`);
    return null;
  }
}

const now = new Date();
const { ymd: todayKST, hm: nowHM } = kstParts(now);

const [us, futures, asia, macro, sectors, kospi, kosdaq, events] = await Promise.all([
  Promise.all([
    yahoo("^GSPC", "S&P 500", { sub: "대형주 500" }),
    yahoo("^IXIC", "나스닥", { sub: "기술주 중심" }),
    yahoo("^DJI", "다우존스", { sub: "우량주 30" }),
    yahoo("^SOX", "필라델피아 반도체", { sub: "SOX" }),
    yahoo("^VIX", "VIX", { sub: "변동성 지수" }),
  ]),
  Promise.all([
    yahoo("ES=F", "S&P 500 선물"),
    yahoo("NQ=F", "나스닥 100 선물"),
  ]),
  Promise.all([
    yahoo("^N225", "닛케이 225", { sub: "일본" }),
    yahoo("^HSI", "항셍", { sub: "홍콩" }),
    yahoo("000001.SS", "상하이 종합", { sub: "중국" }),
  ]),
  Promise.all([
    yahoo("^TNX", "미 국채 10년물", { sub: "금리(%)", unit: "%" }),
    yahoo("DX-Y.NYB", "달러인덱스", { sub: "DXY" }),
    yahoo("KRW=X", "원/달러", { sub: "원", live: true }),
    yahoo("CL=F", "WTI 원유", { sub: "달러/배럴", prefix: "$", live: true }),
    yahoo("GC=F", "금", { sub: "달러/온스", prefix: "$", live: true }),
    yahoo("BTC-USD", "비트코인", { sub: "달러", prefix: "$", live: true }),
  ]),
  Promise.all([
    yahoo("XLK", "기술", { sub: "XLK" }),
    yahoo("SMH", "반도체", { sub: "SMH" }),
    yahoo("XLY", "경기소비재", { sub: "XLY" }),
    yahoo("XLF", "금융", { sub: "XLF" }),
    yahoo("XLV", "헬스케어", { sub: "XLV" }),
    yahoo("XLI", "산업재", { sub: "XLI" }),
    yahoo("XLE", "에너지", { sub: "XLE" }),
    yahoo("XLU", "유틸리티", { sub: "XLU" }),
  ]),
  daum("KOSPI", todayKST, nowHM),
  daum("KOSDAQ", todayKST, nowHM),
  calendar(),
]);

const out = {
  fetchedAt: now.toISOString(),
  fetchedKST: `${todayKST} ${nowHM}`,
  us, futures, asia, macro, sectors,
  kr: { kospi, kosdaq },
  events,
  errors,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`저장: ${OUT} (오류 ${errors.length}건)`);
for (const e of errors) console.log("  - " + e);
