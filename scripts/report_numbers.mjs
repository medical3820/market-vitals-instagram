#!/usr/bin/env node
// 주간 리포트용 숫자를 코드로 계산해 마크다운 표로 출력한다. 리포트 작성(예약 작업)은 이 출력의 숫자를 그대로 옮긴다.
// 2026-11-23: 리포트가 history.csv 열을 잘못 읽어 '게시물 수'를 '팔로워'로 보고한 일이 있어, 열은 반드시 머리글 이름으로 찾는다.
// 사용: node scripts/report_numbers.mjs [YYYY-MM-DD 리포트 날짜(월요일), 기본 오늘 KST]  → 직전 월~일 7일을 집계

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const today = process.argv[2] || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const START = addDays(today, -7), END = addDays(today, -1), PREV = addDays(today, -8);
const WD = "일월화수목금토";
const md = (ymd) => `${ymd.slice(5)}(${WD[new Date(ymd + "T12:00:00Z").getUTCDay()]})`;

function csv(file) {
  const p = join(ROOT, "metrics", file);
  if (!existsSync(p)) return [];
  const [head, ...lines] = readFileSync(p, "utf8").trim().split("\n");
  const cols = head.split(",");
  return lines.filter(Boolean).map((l) => { const v = l.split(","); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])); });
}
const num = (v) => (v === "" || v == null ? null : Number(v));
const avg = (rows, k) => { const xs = rows.map((r) => num(r[k])).filter((x) => x != null && !isNaN(x)); return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
const f1 = (x) => (x == null ? "-" : (Math.round(x * 10) / 10).toString());

// 1) 팔로워 — 머리글 이름(followers·follows·media)으로 읽는다
const hist = csv("history.csv");
const byDate = new Map(hist.map((r) => [r.date, r]));
const base = byDate.get(PREV) || [...hist].reverse().find((r) => r.date < START);
const week = hist.filter((r) => r.date >= START && r.date <= END);
const last = week[week.length - 1];
const out = [];
out.push(`## 숫자 (코드 계산: scripts/report_numbers.mjs, 기간 ${START} ~ ${END})`);
out.push("");
out.push(`- **팔로워 ${base ? base.followers : "?"} → ${last ? last.followers : "?"}** (${base && last ? (last.followers - base.followers >= 0 ? "+" : "") + (last.followers - base.followers) : "?"}) · 팔로잉 ${last ? last.follows : "?"} · 계정 게시물 수 ${last ? last.media : "?"}`);
out.push("");
out.push("| 날짜 | 팔로워 | 팔로잉 | 계정 게시물 수 |");
out.push("| --- | --- | --- | --- |");
for (const r of week) out.push(`| ${md(r.date)} | ${r.followers} | ${r.follows} | ${r.media} |`);

// 2) 게시물 — posts_log.csv (첫 댓글 1개는 빼고 계산)
const posts = csv("posts_log.csv").filter((r) => r.date >= START && r.date <= END);
const kind = (r) => r.folder?.startsWith("MVE") ? "1분 경제 공부" : r.folder?.startsWith("MVN") ? "일요일 주간 뉴스" : r.folder?.startsWith("MVW") ? "토요일 주간 정리" : r.type === "VIDEO" ? `릴스(${r.variant || "?"})` : "평일 캐러셀";
for (const r of posts) { const c = num(r.comments); r.comments_real = c == null ? "" : String(Math.max(0, c - 1)); }
out.push("");
out.push(`- 게시물 ${posts.length}개`);
out.push("");
out.push("| 구분 | 개수 | 도달 | 조회 | 좋아요 | 댓글(첫 댓글 제외) | 저장 | 공유 | 평균 시청(초) |");
out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const groups = new Map();
for (const r of posts) { const k = kind(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
for (const [k, rs] of groups) out.push(`| ${k} | ${rs.length} | ${f1(avg(rs, "reach"))} | ${f1(avg(rs, "views"))} | ${f1(avg(rs, "likes"))} | ${f1(avg(rs, "comments_real"))} | ${f1(avg(rs, "saved"))} | ${f1(avg(rs, "shares"))} | ${f1(avg(rs, "watch_s"))} |`);

// 3) 릴스 A/B 누적 (2026-11-11~)
const ab = csv("posts_log.csv").filter((r) => r.type === "VIDEO" && r.date >= "2026-11-11" && (r.variant === "v2" || r.variant === "v3"));
if (ab.length) {
  out.push("");
  out.push("릴스 A/B 누적 (2026-11-11부터, v3 9.5초 · v2 약 15초)");
  out.push("");
  out.push("| 형식 | 개수 | 도달 | 조회 | 평균 시청(초) | 영상 길이 대비 | 좋아요 | 저장 | 공유 |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [v, len] of [["v3", 9.5], ["v2", 15]]) {
    const rs = ab.filter((r) => r.variant === v); const w = avg(rs, "watch_s");
    out.push(`| ${v} | ${rs.length} | ${f1(avg(rs, "reach"))} | ${f1(avg(rs, "views"))} | ${f1(w)} | ${w == null ? "-" : Math.round((w / len) * 100) + "%"} | ${f1(avg(rs, "likes"))} | ${f1(avg(rs, "saved"))} | ${f1(avg(rs, "shares"))} |`);
  }
}

// 4) 발행 누락: 기간 안 평일마다 아침 캐러셀(MV<날짜>)·저녁 릴스(MV<날짜>P_R) 기록이 있는지
const pub = existsSync(join(ROOT, "published.txt")) ? readFileSync(join(ROOT, "published.txt"), "utf8") : "";
const missing = [];
for (let d = START; d <= END; d = addDays(d, 1)) {
  const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w === 0 || w === 6) continue;
  const id = "MV" + d.replaceAll("-", "");
  if (!new RegExp(`^${id} `, "m").test(pub)) missing.push(`${md(d)} 아침 캐러셀`);
  if (!new RegExp(`^${id}P_R `, "m").test(pub)) missing.push(`${md(d)} 저녁 릴스`);
}
out.push("");
out.push(missing.length ? `- 발행 기록이 없는 것: ${missing.join(", ")} (휴장일이면 정상)` : "- 평일 아침 캐러셀·저녁 릴스 발행 누락 없음");
console.log(out.join("\n"));
