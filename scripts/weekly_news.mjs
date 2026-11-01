#!/usr/bin/env node
// 일요일 '이번 주 경제뉴스 정리' 캐러셀. 예약 작업이 그 주(월~금) 아침·저녁에 이미 교차 확인해 올린 뉴스 중에서 골라
// inbox/<일요일>-weekly.json 으로 넣으면, 이 스크립트가 카드·캡션을 만든다. 새 사실은 더하지 않는다.
// 출력: posts/MVN<일요일YYYYMMDD>/data.json, post.json
// 환경변수: DATE=YYYY-MM-DD (기본 오늘 KST), BLOCKLIST(선택)

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "./themes.mjs";
import { coverCard } from "./cover.mjs";
import { koTitle, keepEvent, REGION, nextWeekRaw } from "./calendar_map.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATE = (process.env.DATE || "").trim() || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const ID = "MVN" + DATE.replaceAll("-", "");
const fail = (m) => { console.error("중단: " + m); process.exit(2); };
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const md = (ymd) => `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`;
let FRI = addDays(DATE, -1); while (new Date(FRI + "T12:00:00Z").getUTCDay() !== 5) FRI = addDays(FRI, -1);
const MON = addDays(FRI, -4), range = `${md(MON)}~${md(FRI)}`;

const file = join(ROOT, "inbox", `${DATE}-weekly.json`);
if (!existsSync(file)) fail(`${file} 이 없습니다.`);
const inbox = JSON.parse(readFileSync(file, "utf8"));
const warnings = [];
const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const twoSrc = (s) => typeof s === "string" && /[·,]/.test(s);

const cleanNews = (label, list) => (list || []).filter((n) => {
  const ok = n && n.h && n.d && twoSrc(n.src) && n.h.length <= 28 && n.d.length <= 90 && !BANNED.find((w) => (n.h + n.d).includes(w));
  if (!ok) warnings.push(`${label}: 규칙 미달 뉴스 1건 제외`);
  return ok;
}).slice(0, 5);
const g = cleanNews("해외", inbox.global), d = cleanNews("국내", inbox.domestic);
const top = (inbox.top3 || []).filter((x) => x && x.t && x.t.length <= 34 && twoSrc(x.src) && !BANNED.find((w) => x.t.includes(w))).slice(0, 3);
if (g.length + d.length < 4) fail("뉴스가 4건 미만입니다.");

// 다음 주 경제 일정 (경제 캘린더)
async function nextWeek() {
  try {
    const list = await nextWeekRaw(FRI), seen = new Map();
    for (const e of list) {
      if (!keepEvent(e)) continue;
      const name = koTitle(e.title); if (!name) continue;
      const at = new Date(e.date); if (isNaN(at)) continue;
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
      const v = (t) => p.find((x) => x.type === t).value;
      const key = at.toISOString() + e.country;
      if (!seen.has(key)) seen.set(key, { at: at.toISOString(), time: `${+v("month")}/${+v("day")} ${v("hour")}:${v("minute")}`, region: REGION[e.country], items: [] });
      const s = seen.get(key); if (!s.items.includes(name)) s.items.push(name);
    }
    return [...seen.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6).map((s) => {
      const it = [...s.items].sort((a, b) => a.startsWith("근원") - b.startsWith("근원"));
      return { time: s.time, region: s.region, item: it.slice(0, 2).join(" · ") + (it.length > 2 ? ` 외 ${it.length - 2}건` : "") };
    });
  } catch (e) { warnings.push(`다음 주 일정 수집 실패 (${e.message})`); return []; }
}
const events = await nextWeek();

const cards = [];
const cover = coverCard({ root: ROOT, date: DATE, pm: false, inboxCover: inbox.cover, warnings, mood: "up",
  fallback: { context: `${range} 한 주 정리`, hook: ["이번 주 꼭 알아야 할", "경제뉴스 정리"], sub: "해외·국내 핵심 뉴스와 다음 주 일정 · 옆으로 넘겨보세요" } });
cover.topSub = "이번 주 경제뉴스 정리"; cover.label = "마켓바이탈 주간 뉴스";
cards.push(cover);
if (top.length >= 2) cards.push({ type: "countries", label: "이번 주 핵심", title: "이번 주\n꼭 알아야 할 3가지", items: top.map((x, i) => ({ region: String(i + 1).padStart(2, "0"), t: x.t, src: x.src })), asof: `${range} 언론 보도 기준` });
const newsCards = (label, title, list) => {
  if (!list.length) return;
  cards.push({ type: "news", label, title, items: list.slice(0, 3), asof: `${range} 언론 보도 기준` });
  if (list.length > 3) cards.push({ type: "news", label: label + " (계속)", title, items: list.slice(3), start: 3, asof: `${range} 언론 보도 기준` });
};
newsCards("이번 주 해외 경제뉴스", "이번 주 세계 시장을\n움직인 뉴스", g);
newsCards("이번 주 국내 경제뉴스", "이번 주 국내 시장을\n움직인 뉴스", d);
if (events.length) cards.push({ type: "schedule", label: "다음 주 일정", title: "다음 주\n챙겨 볼 경제 일정", items: events, asof: "한국 시간 · 경제 캘린더 기준, 일정은 바뀔 수 있습니다" });
cards.push({ type: "outro", label: "마켓바이탈", lead: "평일엔 아침·저녁 시황,\n주말엔 한 주 정리를\n기록합니다.", rules: ["종목 추천을 하지 않습니다", "모든 수치는 표기된 시점 기준입니다", "투자 판단과 책임은 본인에게 있습니다"],
  cta: { t: "내일(월) 아침 7시, 간밤 뉴욕 정리가 올라갑니다", s: "놓치지 않으려면 @market.vitals 팔로우" } });
if (cards.length > 10) fail(`카드가 ${cards.length}장입니다 (최대 10장).`);

const caption = [
  `${range} 이번 주 꼭 알아야 할 경제뉴스`,
  "이번 주 경제뉴스 정리 · 미국 증시 · 코스피 · 환율 · 금리 · 다음 주 경제 일정",
  "",
  ...(top.length ? ["이번 주 핵심", ...top.map((x, i) => `${i + 1}. ${x.t}`), ""] : []),
  "해외·국내 주요 뉴스와 다음 주 일정을 카드로 정리했습니다. 저장해 두고 다음 주 시장 전에 다시 보세요.",
  "평일 아침 7시·저녁 5시 40분 시황, 토요일 주간 숫자, 일요일 주간 뉴스를 올립니다. @market.vitals 팔로우해 두면 피드에서 바로 받아 보실 수 있어요.",
  "",
  "종목 추천을 하지 않습니다. 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 카드에 언급된 종목을 보유하고 있을 수 있습니다.",
  "자료: 각 언론 보도(뉴스 요약, 두 곳 이상 확인), 경제 캘린더(일정)",
  "",
  "#마켓바이탈 #경제뉴스 #주식 #미국주식 #재테크",
].join("\n");

const block = (process.env.BLOCKLIST || "").split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length >= 2);
if (block.filter((w) => (JSON.stringify(cards) + caption).toLowerCase().includes(w.toLowerCase())).length) fail("차단 목록 단어가 발견되어 발행하지 않습니다. (단어는 공개 로그에 출력하지 않음)");

const total = cards.length;
cards.forEach((c, i) => { c.page = `${i + 1} / ${total}`; });
const data = { id: ID, date: DATE, mode: "weekly", dateLabel: `${range} 주간 뉴스`, handle: "@market.vitals", cards, theme: THEMES[1] }; // 일요일은 미드나잇
const post = { id: ID, caption, first_comment: "이번 주 뉴스 중 가장 크게 와닿은 건 몇 번인가요? 번호로 남겨 주세요.",
  slides: cards.map((c, i) => ({ file: `${String(i + 1).padStart(2, "0")}.jpg`,
    alt_text: `${i + 1}/${total}장. ${i === 0 ? `${range} 이번 주 경제뉴스 정리, 미국 증시와 코스피. ` : c.label + ". "}${(c.headline || c.title || c.lead || "").replace(/\n/g, " ")}` })) };
const out = join(ROOT, "posts", ID);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "data.json"), JSON.stringify(data, null, 2));
writeFileSync(join(out, "post.json"), JSON.stringify(post, null, 2));
console.log(`주간 뉴스 카드 ${total}장 → posts/${ID}/ (${range})`);
for (const w of warnings) console.log("  주의: " + w);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `folder=${ID}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${ID} — 주간 뉴스 카드 ${total}장\n\n` + warnings.map((w) => `- 주의: ${w}\n`).join("") + "\n```\n" + caption + "\n```\n");
