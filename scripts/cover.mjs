// 첫 장 '잡지형' 표지: 주제 사진 꽉 채움 + 가운데 날짜(분홍 박스) + 아래 왼쪽 맥락 줄 / 두 줄 제목 / 보조 줄.
// 문구는 예약 작업이 inbox.cover 로 쓰고(기사로 확인된 사실만), 규칙에 안 맞거나 없으면 숫자로 만든 문구를 쓴다.
// 사진은 assets/photo/<주제>_NN.jpg (사람 얼굴·로고 없는 AI 생성 장면). 주제 사진이 없으면 그날 방향의 market_up/down.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const TOPICS = ["semis", "bigtech_ai", "fed_rates", "bonds", "dollar_fx", "yen_japan", "china", "europe", "oil", "gold", "trade_tariff", "crypto", "kospi_up", "kospi_down", "us_up", "us_down"];
const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "사라", "사야", "팔아야", "기회", "대박", "확실", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const WD = ["일", "월", "화", "수", "목", "금", "토"];

function pickPhoto(root, topics, mood, date) {
  const dir = join(root, "assets", "photo");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jpg"));
  const day = Number(date.replaceAll("-", ""));
  for (const prefix of [...topics, `market_${mood}`, "market_"]) {
    if (!prefix) continue;
    const list = files.filter((f) => f.startsWith(prefix + (prefix.endsWith("_") ? "" : "_")));
    if (list.length) return `../assets/photo/${list[day % list.length]}`; // render.html 이 work/ 에 있으므로 한 단계 위
  }
  return null;
}

// inbox.cover = { context, hook: ["줄1", "줄2"], sub, topic }
function checkCover(c, warnings) {
  if (!c) return null;
  const hook = Array.isArray(c.hook) ? c.hook.filter(Boolean) : String(c.hook || "").split("\n").filter(Boolean);
  const all = [c.context || "", ...hook, c.sub || ""].join(" ");
  const bad = BANNED.find((b) => all.includes(b));
  if (!c.context || c.context.length > 20 || !hook.length || hook.length > 2 || hook.some((l) => l.length > 13) || (c.sub || "").length > 30 || bad) {
    warnings.push("표지 문구 규칙 미달 — 숫자 문구로 대신 (맥락 20자·제목 2줄 각 13자·보조 30자, 금지 표현 없음)");
    return null;
  }
  return { context: c.context, hook: hook.join("\n"), sub: c.sub || "", topic: TOPICS.includes(c.topic) ? c.topic : "" };
}

export function coverCard({ root, date, pm, inboxCover, fallback, mood, warnings }) {
  const ok = checkCover(inboxCover, warnings);
  const c = ok || { ...fallback, hook: fallback.hook.filter(Boolean).join("\n"), topic: "" };
  const [, m, d] = date.split("-");
  return {
    type: "mag", style: "boxed", label: pm ? "마켓바이탈 마감" : "마켓바이탈",
    top: `${m}.${d} ${WD[new Date(date + "T12:00:00+09:00").getUTCDay()]}`,
    topSub: pm ? "장 마감 시장 브리핑" : "개장 전 시장 브리핑",
    context: c.context, hook: c.hook, sub: c.sub,
    // 주제가 없으면 아침은 뉴욕(us_up/down), 저녁은 서울(kospi_up/down) 사진
    photo: pickPhoto(root, [c.topic, `${pm ? "kospi" : "us"}_${mood}`], mood, date),
    headline: c.hook, // 대체 텍스트·릴스 예비 문구용
  };
}
