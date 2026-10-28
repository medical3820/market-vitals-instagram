// 해외 경제 카드 재료: 간밤 해외 지표 결과, 나라별 한 줄, 유럽 증시, 원화로 본 주요 통화.
// 숫자(증시·환율)는 코드가 원자료에서, 지표 실제 값·나라별 한 줄은 예약 작업이 두 곳 이상 언론에서 확인해 inbox 에 쓴다.

const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const twoSrc = (s) => typeof s === "string" && /[·,]/.test(s);
const numOf = (s) => { const m = String(s || "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };

// inbox.results = [{ region, item, actual, forecast?, previous?, src }]  (최대 5건)
export function resultsItems(list, warnings) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || !x.region || !x.item || !x.actual || !twoSrc(x.src)) { warnings.push("해외 지표 1건 제외 (지역·지표·실제 값·출처 2곳 필요)"); continue; }
    if (x.item.length > 22 || String(x.actual).length > 10) { warnings.push("해외 지표 1건 제외 (지표 22자·값 10자 이내)"); continue; }
    const a = numOf(x.actual), f = numOf(x.forecast);
    const tag = a == null || f == null ? "" : a > f ? "예상 상회" : a < f ? "예상 하회" : "예상 부합";
    out.push({ region: x.region, item: x.item, actual: String(x.actual), forecast: x.forecast || "", previous: x.previous || "", tag, src: x.src });
  }
  return out.slice(0, 5);
}
export const srcUnion = (items) => [...new Set(items.flatMap((x) => x.src.split(/[·,]\s*/)))].join("·");

// inbox.countries = { us: {t, src}, cn: ..., eu: ..., jp: ... }
const CTRY = [["us", "미국"], ["cn", "중국"], ["eu", "유럽"], ["jp", "일본"]];
export function countryItems(obj, warnings) {
  const out = [];
  for (const [k, region] of CTRY) {
    const w = obj && obj[k];
    if (!w) continue;
    if (!w.t || w.t.length > 34 || !twoSrc(w.src) || BANNED.find((b) => w.t.includes(b))) { warnings.push(`나라별 한 줄(${k}) 규칙 미달로 제외 (34자·출처 2곳)`); continue; }
    out.push({ region, t: w.t, src: w.src });
  }
  return out;
}

// 원화로 본 주요 통화: 원/달러 × 달러 대비 각 통화 (등락도 두 값으로 계산)
export function wonCrossRows(market, num) {
  const g = (s) => [...(market.macro || []), ...(market.fx || [])].find((x) => x.symbol === s && x.price != null);
  const krw = g("KRW=X"), jpy = g("JPY=X"), eur = g("EURUSD=X"), cny = g("CNY=X");
  if (!krw) return [];
  const k = 1 + (krw.chg || 0) / 100;
  const rows = [];
  if (jpy) rows.push({ name: "100엔", sub: `엔/달러 ${num(jpy.price)}`, value: `${num((krw.price / jpy.price) * 100)}원`, chg: +((k / (1 + jpy.chg / 100) - 1) * 100).toFixed(2) });
  if (eur) rows.push({ name: "1유로", sub: `유로/달러 ${num(eur.price, 4)}`, value: `${num(krw.price * eur.price)}원`, chg: +((k * (1 + eur.chg / 100) - 1) * 100).toFixed(2) });
  if (cny) rows.push({ name: "1위안", sub: `위안/달러 ${num(cny.price, 4)}`, value: `${num(krw.price / cny.price)}원`, chg: +((k / (1 + cny.chg / 100) - 1) * 100).toFixed(2) });
  return rows;
}
