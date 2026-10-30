// 사람을 붙잡는 문구 모음: 릴스 훅·캡션 첫 줄, 그날 이슈 해시태그, 생활 체감 한 줄, 연재 번호, 참여형 첫 댓글.
// build.mjs(아침)·build_pm.mjs(저녁)가 숫자를 넘기면 문구를 돌려준다. 원칙은 같다: 사실과 계산만, 전망·매매 권유 없음.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const won = (v) => { // 133233 → "13만 3,233원"
  const r = Math.round(v), man = Math.floor(r / 10000), rest = r % 10000;
  return (man ? `${man}만${rest ? " " + rest.toLocaleString("en-US") : ""}` : rest.toLocaleString("en-US")) + "원";
};
const dir = (v) => (v >= 0 ? "상승" : "하락");
const abs2 = (v) => Math.abs(v).toFixed(2);

// 연재 번호: 이미 만든 게시물 폴더 수 + 1 (아침 MV<날짜>, 저녁 MV<날짜>P)
export function seriesNo(root, date, pm) {
  const p = join(root, "posts");
  if (!existsSync(p)) return 1;
  const re = pm ? /^MV(\d{8})P$/ : /^MV(\d{8})$/;
  const today = date.replaceAll("-", "");
  return readdirSync(p).filter((f) => { const m = f.match(re); return m && m[1] < today; }).length + 1;
}

// 생활 체감: 원/달러로 100달러 결제 금액, 전일 대비 차이 (계산만)
export function lifeLine(krw) {
  if (!krw || krw.price == null) return null;
  const now = krw.price * 100;
  if (krw.chg == null) return `100달러 결제하면 약 ${won(now)}`;
  const diff = now - now / (1 + krw.chg / 100);
  const d = Math.round(Math.abs(diff) / 10) * 10;
  return `100달러 결제하면 약 ${won(now)}` + (d >= 10 ? ` (전일보다 약 ${d.toLocaleString("en-US")}원 ${diff > 0 ? "더 듦" : "덜 듦"})` : " (전일과 비슷)");
}

// 해시태그 5개 (인스타는 게시물당 5개 제한, 2025-12~). 검색 유입은 캡션·대체 텍스트 키워드가 더 크고, 해시태그는
//   브랜드 1 + 사람들이 실제로 검색하는 넓은 주제 2 + 그날 크게 움직였거나 뉴스에 나온 주제 2 로 쓴다.
//   이슈 태그도 검색량이 많은 짧은 말(#환율·#금리·#유가)을 쓰고 긴 합성어(#원달러환율·#미국채금리)는 피한다. 전략 메모: HASHTAGS.md
export function hashtags({ pm, ndx, kospi, krw, sox, tnx, oil, gold, streak, newsText = "" }) {
  const c = []; // [점수, 태그]
  const mv = (x) => (x && x.chg != null ? Math.abs(x.chg) : 0);
  const core = pm ? ["#주식", "#코스피"] : ["#미국주식", "#주식"];
  if (!pm && mv(ndx) >= 1) c.push([mv(ndx) * 2, "#나스닥"]);
  if (!pm && mv(kospi) >= 1) c.push([mv(kospi) * 2, "#코스피"]);
  if (mv(krw) >= 0.4 || /환율/.test(newsText)) c.push([mv(krw) * 5 + 1, "#환율"]);
  if (mv(sox) >= 2 || /반도체/.test(newsText)) c.push([mv(sox) + 1, "#반도체"]);
  if (mv(tnx) >= 1.5 || /국채|금리/.test(newsText)) c.push([mv(tnx) + 1, "#금리"]);
  if (mv(oil) >= 2 || /유가|원유/.test(newsText)) c.push([mv(oil) + 1, "#유가"]);
  if (mv(gold) >= 1.5 || /금값|금 가격/.test(newsText)) c.push([mv(gold) + 1, "#금값"]);
  if (/연준|FOMC|파월/.test(newsText)) c.push([3, "#연준"]);
  if (/엔화|일본은행|엔\/달러/.test(newsText)) c.push([2, "#엔화"]);
  if (/비트코인|가상자산/.test(newsText)) c.push([2, "#비트코인"]);
  if (Math.abs(streak || 0) >= 3) c.push([Math.abs(streak), "#외국인"]);
  const picked = [...new Set(c.sort((a, b) => b[0] - a[0]).map((x) => x[1]))].filter((t) => !core.includes(t)).slice(0, 2);
  for (const t of pm ? ["#환율", "#경제뉴스"] : ["#코스피", "#경제뉴스"]) if (picked.length < 2 && !picked.includes(t)) picked.push(t);
  return ["#마켓바이탈", ...core, ...picked].join(" ");
}

// 검색 키워드 줄: 인스타 검색은 캡션 앞부분 키워드를 본다. 사람들이 치는 말을 자연스러운 한 줄로.
export function keywordLine(pm) {
  return pm ? "오늘 주식 시황 · 코스피 마감 · 외국인 수급 · 환율 정리" : "오늘 주식 시황 · 미국 증시 마감 · 나스닥 · 코스피 개장 전 · 환율 정리";
}

// 참여형 첫 댓글 (요일별). 매수·매도·전망은 묻지 않는다.
const AM_Q = [
  "오늘 가장 신경 쓰이는 숫자는 무엇인가요? 1 환율 2 금리 3 반도체 — 번호로 남겨 주세요.",
  "출근길에 가장 먼저 확인하는 숫자는? 1 나스닥 2 코스피 3 환율 — 번호로 남겨 주세요.",
  "오늘 카드에서 가장 의외였던 숫자는 무엇인가요? 댓글로 알려 주세요.",
  "카드에 더 보고 싶은 지표가 있나요? 댓글로 남겨 주시면 반영해 보겠습니다.",
  "이번 주 시장을 한 단어로 표현한다면? 댓글로 남겨 주세요.",
];
const PM_Q = [
  "오늘 장에서 가장 눈에 띈 숫자는? 1 지수 2 수급 3 환율 — 번호로 남겨 주세요.",
  "오늘 밤 가장 궁금한 일정은 무엇인가요? 댓글로 알려 주세요.",
  "오늘 수급에서 가장 의외였던 부분은? 1 외국인 2 기관 3 개인 — 번호로 남겨 주세요.",
  "내일 아침 카드에서 꼭 보고 싶은 지표가 있나요? 댓글로 남겨 주세요.",
  "이번 주 국내 시장을 한 단어로 표현한다면? 댓글로 남겨 주세요.",
];
export function firstComment(date, pm) {
  const i = (new Date(date + "T12:00:00+09:00").getUTCDay() + 6) % 7 % 5;
  return (pm ? PM_Q : AM_Q)[i];
}

// 아침 릴스: 영상 훅과 캡션 첫 줄 (숫자 4가지를 약속하고 캡션에서 바로 보여 준다)
export function amReel({ spx, ndx, dji, kospi, krw, tnx, newsHead, event, life, no }) {
  const big = [spx, ndx, dji].filter((x) => x && x.chg != null).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))[0];
  const l1 = big ? `${big.name} ${abs2(big.chg)}% ${dir(big.chg)}` : "뉴욕 증시 마감";
  const head = (newsHead || "").split(/[,…]/)[0].trim();
  const l2 = head && head.length <= 16 ? head : `코스피 ${abs2(kospi.chg)}% ${dir(kospi.chg)}`;
  const points = [
    `1. 미국: S&P 500 ${abs2(spx.chg)}% ${dir(spx.chg)}, 나스닥 ${abs2(ndx.chg)}% ${dir(ndx.chg)}`,
    `2. 코스피(전일): ${abs2(kospi.chg)}% ${dir(kospi.chg)}, 외국인 ${kospi.foreign < 0 ? "순매도" : "순매수"}`,
    krw && krw.price != null ? `3. 원/달러 ${krw.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}원${life ? ` — ${life}` : ""}` : null,
    event ? `4. 오늘 일정: ${event}` : tnx && tnx.price != null ? `4. 미 국채 10년물 ${tnx.price.toFixed(3)}%` : null,
  ].filter(Boolean);
  return {
    kicker: "밤사이 시장은",
    hook: [l1, l2],
    bottom: `개장 전 꼭 볼 숫자 ${points.length}가지 ↓`,
    title: `밤사이 ${l1}, 개장 전 꼭 볼 숫자 ${points.length}가지`,
    keywords: `출근 전 15초 시황 · 바이탈 체크 ${no}일째 | 미국증시 마감 · 코스피 · 환율 · 금리`,
    points,
  };
}

// 저녁 릴스
export function pmReel({ kospi, kosdaq, krw, streakText, es, event, life, no }) {
  const l1 = `코스피 ${abs2(kospi.chg)}% ${dir(kospi.chg)} 마감`;
  const l2 = streakText.replace("거래일", "일");
  const points = [
    `1. 코스피 ${abs2(kospi.chg)}% ${dir(kospi.chg)}${kosdaq ? `, 코스닥 ${abs2(kosdaq.chg)}% ${dir(kosdaq.chg)}` : ""}`,
    `2. 수급(잠정): ${streakText}`,
    krw && krw.price != null ? `3. 원/달러 ${krw.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}원${life ? ` — ${life}` : ""}` : null,
    event ? `4. 오늘 밤: ${event}` : es && es.chg != null ? `4. 미국 S&P 500 선물 ${abs2(es.chg)}% ${dir(es.chg)}` : null,
  ].filter(Boolean);
  return {
    kicker: "오늘 장 마감",
    hook: [l1, l2],
    bottom: `퇴근길에 볼 숫자 ${points.length}가지 ↓`,
    title: `${l1}, 오늘 장 숫자 ${points.length}가지`,
    keywords: `퇴근길 15초 시황 · 마감 바이탈 ${no}일째 | 코스피 마감 · 외국인 수급 · 환율`,
    points,
  };
}
