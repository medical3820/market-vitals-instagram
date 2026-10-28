// 카드 배경색 돌려쓰기: 요일마다 다른 색으로 피드에서 날짜가 구분되게 한다.
// 등락 칩(빨강 상승·파랑 하락)과 겹치지 않도록 빨강·파랑 계열 원색 바탕은 쓰지 않고, 모두 어두운 바탕 + 흰 글자.
// 아침과 저녁은 같은 날에도 다른 색이 되도록 3칸 떨어진 색을 쓴다.

export const THEMES = [
  { name: "딥그린", bg: "#0e3b2e", panel: "#185040", line: "#2b6553", dim: "#a9d3c2", mark: "#7ff0bf" },
  { name: "미드나잇", bg: "#14233f", panel: "#1f3358", line: "#304a75", dim: "#b3c3e0", mark: "#8fd3ff" },
  { name: "딥퍼플", bg: "#2a1d4a", panel: "#3a2b63", line: "#4f3f7e", dim: "#c6badf", mark: "#cdb8ff" },
  { name: "차콜", bg: "#1f2329", panel: "#2c323a", line: "#3d454f", dim: "#b9c0c9", mark: "#ffc76b" },
  { name: "딥틸", bg: "#0b3640", panel: "#134a56", line: "#25616e", dim: "#a7d0d6", mark: "#6fe6e0" },
  { name: "에스프레소", bg: "#33261d", panel: "#46352a", line: "#5d4838", dim: "#d6c3b3", mark: "#ffd28a" },
];

export function pickTheme(date, pm) {
  const wd = new Date(date + "T12:00:00+09:00").getUTCDay(); // 1(월)~5(금), 주말 0·6
  const i = ((wd + 6) % 7 + (pm ? 3 : 0)) % THEMES.length;
  return THEMES[i];
}
