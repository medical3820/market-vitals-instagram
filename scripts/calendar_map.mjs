// 경제 캘린더(ForexFactory 내보내기) 지표 이름 → 한국어. 매일 카드(fetch_market)와 주간 카드(weekly)가 같이 쓴다.
export const REGION = { USD: "미국", CNY: "중국", JPY: "일본", EUR: "유럽" };
export const KO = {
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
export const koTitle = (t) => {
  const base = t.replace(/\s+(m\/m|y\/y|q\/q)$/, "");
  if (KO[base]) return KO[base];
  const sp = base.match(/^(Fed Chair(?:man)?|FOMC Member|ECB President|BOJ Gov) (.+) Speaks$/);
  if (sp) return { "Fed Chair": "연준 의장", "Fed Chairman": "연준 의장", "FOMC Member": "연준 위원", "ECB President": "ECB 총재", "BOJ Gov": "일본은행 총재" }[sp[1]] + ` ${sp[2]} 발언`;
  return null;
};
export const keepEvent = (e) => REGION[e.country] && (e.impact === "High" || (e.country === "USD" && e.impact === "Medium"));
