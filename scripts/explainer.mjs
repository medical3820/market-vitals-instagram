#!/usr/bin/env node
// '1분 경제 공부' 설명 캐러셀 (화·목). content/explainers.json 에서 아직 안 올린 다음 편을 골라 카드·캡션을 만든다.
// 시황이 아니라 오래 두고 볼 설명이라 저장·공유를 노린다. 원칙은 같다: 일반적인 원리만, 매수·매도 권유 없음.
// 출력: posts/MVE<날짜YYYYMMDD>/data.json, post.json
// 환경변수: DATE(기본 오늘 KST), INDEX(0부터, 비우면 published.txt 의 MVE 발행 수 = 다음 편)

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "./themes.mjs";
import { coverCard } from "./cover.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATE = (process.env.DATE || "").trim() || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const ID = "MVE" + DATE.replaceAll("-", "");
const fail = (m) => { console.error("중단: " + m); process.exit(2); };
const list = JSON.parse(readFileSync(join(ROOT, "content", "explainers.json"), "utf8"));
const published = existsSync(join(ROOT, "published.txt")) ? readFileSync(join(ROOT, "published.txt"), "utf8") : "";
const done = new Set([...published.matchAll(/^MVE\d{8}\s.*?explainer=(\d+)/gm)].map((m) => m[1]));
// 다음 편: INDEX 가 있으면 그것, 없으면 이미 올린 편(posts/MVE*/data.json 의 explainer)을 빼고 첫 번째
const usedIds = new Set(done);
for (const l of published.split("\n")) {
  const m = l.match(/^(MVE\d{8})\s/); if (!m) continue;
  try { usedIds.add(JSON.parse(readFileSync(join(ROOT, "posts", m[1], "data.json"), "utf8")).explainer); } catch { /* 없으면 넘어감 */ }
}
const idx = process.env.INDEX ? Number(process.env.INDEX) : list.findIndex((x) => !usedIds.has(x.id));
if (idx < 0 || !list[idx]) fail("올릴 설명 편이 남아 있지 않습니다. content/explainers.json 에 새 편을 추가하세요.");
const ex = list[idx], next = list[idx + 1];
const warnings = [];

const cards = [];
const cover = coverCard({ root: ROOT, date: DATE, pm: false, inboxCover: { ...ex.cover, topic: ex.topic }, warnings, mood: "up",
  fallback: { context: ex.cover.context, hook: ex.cover.hook, sub: ex.cover.sub } });
cover.topSub = "1분 경제 공부"; cover.label = "마켓바이탈 경제 공부";
cards.push(cover);
for (const c of ex.cards) cards.push({ type: "explain", label: "1분 경제 공부", title: c.title, items: c.items, box: c.box, asof: "일반적인 원리 설명 · 투자 권유가 아닙니다" });
cards.push({ type: "sum", label: "1분 경제 공부", text: ex.summary, next: next ? next.cover.hook.join(" ") : "", asof: "저장해 두고 필요할 때 다시 보세요" });
cards.push({ type: "outro", label: "마켓바이탈", lead: "매주 화·목\n1분 경제 공부를\n올립니다.", rules: ["종목 추천을 하지 않습니다", "일반적인 원리를 설명합니다", "투자 판단과 책임은 본인에게 있습니다"],
  cta: { t: "평일 아침 7시엔 개장 전 시장 정리", s: "놓치지 않으려면 @market.vitals 팔로우" } });
if (cards.length > 10) fail(`카드가 ${cards.length}장입니다 (최대 10장).`);
if (warnings.length) fail("표지 문구가 규칙에 맞지 않습니다: " + warnings.join(" / "));

const TOPIC_TAG = { fed_rates: "#금리", dollar_fx: "#환율", kospi_up: "#코스피", us_up: "#미국주식", us_down: "#미국주식", bonds: "#금리", oil: "#유가" };
const caption = [
  `${ex.cover.hook.join(" ")} | 1분 경제 공부`,
  ex.keywords,
  "",
  ex.summary.replace(/\n/g, " "),
  "",
  "저장해 두고 필요할 때 다시 보세요. 주식·경제 공부하는 친구에게 공유해 주세요.",
  next ? `다음 편: ${next.cover.hook.join(" ")}` : null,
  "매주 화·목 1분 경제 공부, 평일 아침 7시 개장 전 정리를 올립니다. @market.vitals 팔로우.",
  "",
  "일반적인 원리 설명이며 특정 종목·상품의 매수·매도 권유가 아닙니다. 투자 판단과 책임은 본인에게 있습니다.",
  "",
  ["#마켓바이탈", "#경제공부", "#주식공부", "#재테크", TOPIC_TAG[ex.topic] || "#경제"].join(" "),
].filter((x) => x !== null).join("\n");

const total = cards.length;
cards.forEach((c, i) => { c.page = `${i + 1} / ${total}`; });
const data = { id: ID, date: DATE, mode: "edu", explainer: ex.id, dateLabel: "1분 경제 공부", handle: "@market.vitals", cards, theme: THEMES[4] };
const post = { id: ID, caption, first_comment: "다음에 알고 싶은 경제 용어가 있나요? 댓글로 남겨 주시면 다음 편으로 만들어 보겠습니다.",
  slides: cards.map((c, i) => ({ file: `${String(i + 1).padStart(2, "0")}.jpg`,
    alt_text: `${i + 1}/${total}장. ${i === 0 ? `1분 경제 공부: ${ex.cover.hook.join(" ")}. ` : ""}${(c.title || c.text || c.lead || "").replace(/\n/g, " ")}` })) };
const out = join(ROOT, "posts", ID);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "data.json"), JSON.stringify(data, null, 2));
writeFileSync(join(out, "post.json"), JSON.stringify(post, null, 2));
console.log(`1분 경제 공부 ${ex.id}편 카드 ${total}장 → posts/${ID}/`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `folder=${ID}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${ID} — 1분 경제 공부 ${ex.id}편\n\n\`\`\`\n${caption}\n\`\`\`\n`);
