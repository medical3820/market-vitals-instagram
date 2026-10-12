#!/usr/bin/env node
// 계정·게시물 수치 기록. GitHub Actions(metrics.yml)가 매일 밤 돌린다.
//  - metrics/history.csv : 날짜별 팔로워·팔로잉·게시물 수 (한 줄씩 누적, 같은 날짜는 덮어씀)
//  - metrics/posts.csv   : 최근 게시물별 좋아요·댓글 (+ 권한이 있으면 도달·저장·공유·조회)
// 팔로워 수·좋아요·댓글은 프로필에서 누구나 보는 공개 수치다. 토큰 값은 출력하지 않는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOKEN = (process.env.IG_ACCESS_TOKEN || "").trim();
const USER = (process.env.IG_USER_ID || "").trim();
const G = "https://graph.instagram.com/v23.0";
if (!TOKEN || !USER) { console.error("IG_ACCESS_TOKEN / IG_USER_ID 가 비어 있습니다."); process.exit(2); }

const mask = (s) => String(s).split(TOKEN).join("***TOKEN***");
async function api(path, params = {}) {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`${G}/${path}?${q}`);
  const text = await r.text();
  if (!r.ok) { const e = new Error(mask(text).slice(0, 300)); e.status = r.status; throw e; }
  return JSON.parse(text);
}

const kst = (d) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
};
const now = kst(new Date());
const dir = join(ROOT, "metrics");
mkdirSync(dir, { recursive: true });

// 1) 계정
const me = await api("me", { fields: "user_id,username,followers_count,follows_count,media_count" });
const hist = join(dir, "history.csv");
const header = "date,time,followers,follows,media";
const lines = existsSync(hist) ? readFileSync(hist, "utf8").trim().split("\n").filter(Boolean) : [header];
const rows = lines.slice(1).filter((l) => !l.startsWith(now.date + ","));
rows.push([now.date, now.time, me.followers_count ?? "", me.follows_count ?? "", me.media_count ?? ""].join(","));
writeFileSync(hist, [header, ...rows].join("\n") + "\n");

// 2) 게시물
const media = (await api(`${USER}/media`, { fields: "id,timestamp,media_type,like_count,comments_count,permalink", limit: "30" })).data || [];
let insightsOk = true;
const METRICS = "reach,saved,shares,views";
const posts = [];
for (const m of media) {
  const row = { date: kst(new Date(m.timestamp)).date, id: m.id, type: m.media_type, likes: m.like_count ?? "", comments: m.comments_count ?? "", reach: "", saved: "", shares: "", views: "", link: m.permalink };
  if (insightsOk && posts.length < 14) {
    try {
      const ins = await api(`${m.id}/insights`, { metric: METRICS });
      for (const x of ins.data || []) row[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? "";
    } catch (e) {
      insightsOk = false; // 권한(instagram_business_manage_insights)이 없으면 공개 수치만 기록
      console.log("인사이트(도달·저장) 조회 불가 — 공개 수치만 기록합니다: " + e.message.slice(0, 120));
    }
  }
  posts.push(row);
}
const pcols = ["date", "id", "type", "likes", "comments", "reach", "saved", "shares", "views", "link"];
writeFileSync(join(dir, "posts.csv"), [pcols.join(","), ...posts.map((r) => pcols.map((c) => r[c]).join(","))].join("\n") + "\n");

// 3) 요약
const prev = rows.length > 1 ? rows[rows.length - 2].split(",") : null;
const diff = prev && prev[2] !== "" ? me.followers_count - Number(prev[2]) : null;
const recent = posts.slice(0, 7);
const avg = (k) => (recent.length ? (recent.reduce((s, r) => s + (Number(r[k]) || 0), 0) / recent.length).toFixed(1) : "-");
const summary = [
  `@${me.username} ${now.date} ${now.time} KST`,
  `팔로워 ${me.followers_count}${diff == null ? "" : ` (전일 대비 ${diff >= 0 ? "+" : ""}${diff})`} · 게시물 ${me.media_count}`,
  `최근 ${recent.length}개 게시물 평균: 좋아요 ${avg("likes")}, 댓글 ${avg("comments")}` + (insightsOk ? `, 도달 ${avg("reach")}, 저장 ${avg("saved")}` : " (도달·저장은 권한 없음)"),
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### 계정 수치\n\n```\n" + summary + "\n```\n");
