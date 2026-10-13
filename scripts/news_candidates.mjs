#!/usr/bin/env node
// 뉴스 후보 수집: 언론사 RSS에서 기간 안의 기사 제목·시각·언론사·링크를 모아 텍스트로 출력한다.
// 클라우드 예약 작업 환경에서는 언론사 사이트에 접속이 안 되므로, 이 스크립트는 GitHub Actions(candidates.yml)가 돌린다.
// 예약 작업은 이 목록에서 뉴스를 고르고, 같은 사실이 두 언론사 이상에 있는지 이 목록으로 교차 확인한다.
//
// 사용: node scripts/news_candidates.mjs 2026-10-13 [pm] > inbox/2026-10-13.candidates.txt
// 기간: 아침(기본)은 직전 평일 15:30(KST) ~ 실행 시각(월요일이면 금요일 15:30부터), 저녁(pm)은 그날 06:00 ~ 실행 시각.

const DATE = process.argv[2] || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const PM = process.argv[3] === "pm";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const FEEDS = [
  ["연합뉴스", "https://www.yna.co.kr/rss/economy.xml"],
  ["연합뉴스", "https://www.yna.co.kr/rss/market.xml"],
  ["연합뉴스", "https://www.yna.co.kr/rss/international.xml"],
  ["한국경제", "https://www.hankyung.com/feed/economy"],
  ["한국경제", "https://www.hankyung.com/feed/international"],
  ["한국경제", "https://www.hankyung.com/feed/finance"],
  ["매일경제", "https://www.mk.co.kr/rss/50200011/"],
  ["머니투데이", "https://rss.mt.co.kr/mt_news.xml"],
  ["파이낸셜뉴스", "https://www.fnnews.com/rss/r20/fn_realnews_all.xml"],
  ["서울경제", "https://www.sedaily.com/rss/economy"],
  ["헤럴드경제", "https://biz.heraldcorp.com/rss/google/economy"],
  ["동아일보", "https://rss.donga.com/economy.xml"],
  ["조선일보", "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml"],
  ["이투데이", "https://rss.etoday.co.kr/eto/finance_news.xml"],
];

// 시장 흐름과 무관하거나 종목 홍보성인 기사는 후보에서 뺀다
const NOISE = /\[(게시판|인사|동정|부고|포토|사진|쇼츠|영상|특징주|공모주|MK시그널|머니톡스|테크스냅|바이오스냅|오늘의 운세)\]|골든크로스|초고수|부고|별세|이벤트|출시|모집|개최|협약|맞손|수상|선정|기념/;
// 시장 관련 단어가 하나라도 있어야 후보로 남긴다 (fnnews 처럼 전 분야를 내보내는 피드 대비)
const MARKET = /증시|뉴욕|코스피|코스닥|나스닥|다우|S&P|금리|국채|채권|환율|달러|원화|엔화|위안|유가|원유|금값|물가|CPI|PCE|고용|연준|Fed|FOMC|한은|한국은행|금통위|기준금리|ECB|일본은행|관세|무역|수출|수입|경기|GDP|성장률|외국인|기관|순매수|순매도|반도체|가계부채|부동산|집값|재정|국채|비트코인|중국|일본|유럽|트럼프|중동|휴전/;

const kstDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const fmt = (d) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(/\.\s?/g, "/").replace(/\/ /, " ").replace(/\/(\d\d:)/, " $1");

// 기간 시작: 직전 평일 15:30 KST
const base = new Date(`${DATE}T12:00:00+09:00`);
const prev = new Date(base);
do { prev.setUTCDate(prev.getUTCDate() - 1); } while ([0, 6].includes(new Date(`${kstDay(prev)}T12:00:00+09:00`).getUTCDay()));
const since = PM ? new Date(`${DATE}T06:00:00+09:00`) : new Date(`${kstDay(prev)}T15:30:00+09:00`);

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

async function getText(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { if (i === 1) throw e; }
  }
}

const items = [];
const failed = [];
await Promise.all(FEEDS.map(async ([outlet, url]) => {
  try {
    const xml = await getText(url);
    for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
      const b = m[0];
      const title = tag(b, "title");
      let when = new Date(tag(b, "pubDate") || tag(b, "dc:date"));
      // 한국 시간을 GMT 로 잘못 표기한 피드(예: 헤럴드경제)는 9시간 미래로 찍힌다 — 미래 시각이면 9시간을 뺀다
      if (when - Date.now() > 10 * 60 * 1000) when = new Date(when.getTime() - 9 * 3600 * 1000);
      if (!title || isNaN(when) || when < since) continue;
      if (NOISE.test(title) || !MARKET.test(title)) continue;
      items.push({ outlet, when, title, link: tag(b, "link") });
    }
  } catch (e) {
    failed.push(`${outlet} ${url} (${e.message})`);
  }
}));

// 같은 언론사의 같은 제목(여러 섹션 피드에 중복)은 한 번만
const seen = new Set();
const uniq = items.sort((a, b) => b.when - a.when).filter((x) => { const k = x.outlet + x.title; if (seen.has(k)) return false; seen.add(k); return true; });

const out = [];
out.push(`# 뉴스 후보 ${DATE}${PM ? " 저녁" : ""} (기간: ${fmt(since)} ~ ${fmt(new Date())} KST, ${uniq.length}건, 언론사 ${new Set(uniq.map((x) => x.outlet)).size}곳)`);
out.push("# 형식: 시각 | 언론사 | 제목 | 링크. 같은 사실이 두 언론사 이상에 있을 때만 뉴스로 쓴다.");
if (failed.length) out.push("# 수집 실패: " + failed.join(" / "));
for (const x of uniq) out.push(`${fmt(x.when)} | ${x.outlet} | ${x.title} | ${x.link}`);
console.log(out.join("\n"));
if (!uniq.length) process.exitCode = 1;
