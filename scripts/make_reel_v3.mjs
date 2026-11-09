#!/usr/bin/env node
// 짧은 릴스(v3, 약 9.5초): 큰 숫자 하나 → '왜?' 한 줄 → 팔로우 안내. 배경 영상은 assets/bg (v2 와 같음), 글자는 전부 코드로 그린다.
//   posts/<ID>_R/ : video.mp4, cover.jpg, post.json (variant: "v3")
// A/B 시험(2026-11-10~): 날짜가 홀수인 날만 만든다. 짝수 날이면 종료 코드 4 → 워크플로가 v2 로 만든다. FORCE_V3=1 이면 항상 만든다.
// 사용: node scripts/make_reel_v3.mjs MV20261111

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const id = process.argv[2];
if (!id) { console.error("사용: node scripts/make_reel_v3.mjs <폴더ID>"); process.exit(1); }
const src = join(ROOT, "posts", id);
const data = JSON.parse(readFileSync(join(src, "data.json"), "utf8"));
if (process.env.FORCE_V3 !== "1" && Number(data.date.slice(8)) % 2 === 0) { console.log("오늘(짝수 날)은 v2 차례입니다."); process.exit(4); }
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const PM = data.mode === "pm";

// ── 문구: 숫자 하나 + 이유 한 줄 ─────────────────────────────────────────
const card = (pred) => data.cards.find(pred);
let kicker, subject, chg, why, whySrc;
if (PM) {
  const fl = card((c) => c.type === "flows");
  const k = fl?.rows?.[0];
  kicker = "오늘 코스피"; subject = "코스피 마감"; chg = k?.chg;
  why = fl?.why?.t; whySrc = fl?.why?.src;
  if (!why) { const n = card((c) => c.type === "news" && c.label === "국내 경제뉴스")?.items?.[0]; why = n?.h; whySrc = n?.src; }
} else {
  const us = card((c) => c.label === "미국 증시");
  const big = (us?.rows || []).slice(0, 3).filter((r) => r.chg != null).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))[0];
  kicker = "밤사이 뉴욕"; subject = big ? big.name : "뉴욕 증시"; chg = big?.chg;
  why = us?.why?.t; whySrc = us?.why?.src;
  if (!why) { const n = card((c) => c.type === "news" && c.label === "해외 경제뉴스")?.items?.[0]; why = n?.h; whySrc = n?.src; }
}
if (chg == null || !why) { console.error("숫자나 이유 문구가 없어 v3 를 만들 수 없습니다."); process.exit(3); }
const up = chg >= 0;
const numText = `${up ? "+" : "-"}${Math.abs(chg).toFixed(2)}%`;
const [, m, d] = data.date.split("-");
const WD = "일월화수목금토"[new Date(data.date + "T12:00:00+09:00").getUTCDay()];
const when = `${+m}/${+d}(${WD}) ${PM ? "장 마감" : "개장 전"}`;
const esc = (t) => String(t).replace(/[<>&]/g, "");

// ── 배경: v2 와 같은 규칙 ───────────────────────────────────────────────
function pickBg() {
  const dir = join(ROOT, "assets", "bg");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".mp4"));
  const want = up ? "up" : "down", day = Number(data.date.replaceAll("-", ""));
  const pool = files.filter((f) => f.startsWith(want));
  const list = pool.length ? pool : files;
  return list.length ? join(dir, list[day % list.length]) : null;
}
const bg = pickBg();
if (!bg) { console.error("배경 영상 없음"); process.exit(3); }

const work = join(ROOT, "work", `reel3-${id}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@700;900&display=swap">`;
const BASE = `body{margin:0;background:transparent}.f{width:1080px;height:1920px;position:relative;overflow:hidden;font-family:"Gothic A1","Noto Sans CJK KR",sans-serif;word-break:keep-all;color:#fff}
.top{position:absolute;left:80px;right:80px;top:150px;display:flex;justify-content:space-between;font-size:40px;font-weight:900;text-shadow:0 2px 14px rgba(0,0,0,.7)}
.top b{color:#ff3d6e}`;
const COLOR = up ? "#ff4d57" : "#4d8bff"; // 한국식: 상승 빨강, 하락 파랑
const top = `<div class="top"><b>마켓바이탈</b><span>${when}</span></div>`;
const frames = {
  // 1) 큰 숫자
  a: `<style>${BASE}.c{position:absolute;left:60px;right:60px;top:560px;text-align:center}
    .k{font-size:58px;font-weight:900;text-shadow:0 3px 18px rgba(0,0,0,.8)}
    .n{margin-top:10px;font-size:250px;font-weight:900;letter-spacing:-.04em;line-height:1;color:${COLOR};text-shadow:0 6px 40px rgba(0,0,0,.85)}
    .s{margin-top:26px;display:inline-block;font-size:60px;font-weight:900;background:rgba(0,0,0,.6);padding:12px 34px;border-radius:18px}</style>
    <div class="f">${top}<div class="c"><div class="k">${esc(kicker)}</div><div class="n">${numText}</div><div class="s">${esc(subject)} ${up ? "상승" : "하락"}</div></div></div>`,
  // 2) 왜?
  b: `<style>${BASE}.c{position:absolute;left:80px;right:80px;top:600px}
    .w{display:inline-block;font-size:64px;font-weight:900;color:#0e0e0e;background:#ffd43b;padding:10px 34px;border-radius:999px}
    .t{margin-top:40px;font-size:84px;font-weight:900;line-height:1.25;letter-spacing:-.04em;text-shadow:0 4px 26px rgba(0,0,0,.85)}
    .src{margin-top:34px;font-size:36px;font-weight:700;opacity:.85}</style>
    <div class="f">${top}<div class="c"><div class="w">왜?</div><div class="t">${esc(why)}</div><div class="src">출처: ${esc(whySrc || "언론 보도")}</div></div></div>`,
  // 3) 팔로우 안내
  c: `<style>${BASE}.c{position:absolute;left:80px;right:80px;top:640px;text-align:center}
    .t{font-size:76px;font-weight:900;line-height:1.25;text-shadow:0 4px 26px rgba(0,0,0,.85)}
    .p{margin-top:44px;display:inline-block;font-size:56px;font-weight:900;color:#fff;background:#ff3d6e;padding:20px 46px;border-radius:999px}
    .s{margin-top:34px;font-size:40px;font-weight:800;text-shadow:0 2px 14px rgba(0,0,0,.8)}</style>
    <div class="f">${top}<div class="c"><div class="t">${PM ? "내일 아침 7시,<br>간밤 뉴욕 정리" : "오늘 숫자 전체는<br>피드 게시물에서"}</div><div class="p">@market.vitals 팔로우</div><div class="s">평일 아침 7시 · 저녁 5시 40분</div></div></div>`,
};

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
for (const [k, body] of Object.entries(frames)) {
  const f = join(work, `${k}.html`);
  writeFileSync(f, `<!doctype html><meta charset="utf-8">${FONT}${body}`);
  await page.goto(pathToFileURL(f).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(work, `${k}.png`), omitBackground: true });
}
await browser.close();

// ── 합치기: 배경(반복·살짝 어둡게) 위에 세 장면을 페이드로 겹친다 ─────────────
const ff = (args) => execFileSync(FFMPEG, ["-nostdin", "-y", "-loglevel", "error", ...args]);
const T = 9.5, A = [0, 3.5], B = [3.5, 7.0], C = [7.0, T], F = 0.3;
const hasAudio = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", bg]).toString().trim() !== "";
const bgm = join(work, "bgm.m4a");
if (hasAudio) ff(["-stream_loop", "-1", "-i", bg, "-vn", "-t", String(T + 0.5), "-c:a", "aac", "-b:a", "160k", bgm]);
const bgv = join(work, "bg.mp4");
ff(["-stream_loop", "-1", "-i", bg, "-an", "-t", String(T), "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,eq=brightness=-0.12:saturation=0.85,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", bgv]);
const ov = (i, [s, e], first) => `[${i}:v]format=rgba,fade=t=in:st=${first ? 0.15 : s}:d=${F}:alpha=1,fade=t=out:st=${(e - F).toFixed(2)}:d=${F}:alpha=1[o${i}]`;
const OUT = join(work, "out"); mkdirSync(OUT, { recursive: true });
ff(["-i", bgv, "-loop", "1", "-t", String(T), "-i", join(work, "a.png"), "-loop", "1", "-t", String(T), "-i", join(work, "b.png"), "-loop", "1", "-t", String(T), "-i", join(work, "c.png"),
  ...(hasAudio ? ["-i", bgm] : ["-f", "lavfi", "-t", String(T), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]),
  "-filter_complex",
  `${ov(1, A, true)};${ov(2, B)};${ov(3, [C[0], T + 1])};` +
  `[0:v][o1]overlay=0:0:enable='between(t,0,${A[1]})'[v1];[v1][o2]overlay=0:0:enable='between(t,${B[0]},${B[1]})'[v2];[v2][o3]overlay=0:0:enable='gte(t,${C[0]})',format=yuv420p[v];` +
  `[4:a]atrim=0:${T},asetpts=PTS-STARTPTS,volume=0.8,afade=t=in:d=0.3,afade=t=out:st=${T - 1}:d=1,aresample=44100[a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-t", String(T), join(OUT, "video.mp4")]);
ff(["-ss", "1.2", "-i", join(OUT, "video.mp4"), "-frames:v", "1", "-q:v", "3", join(OUT, "cover.jpg")]);

const tags = data.reel?.tags || "#마켓바이탈 #주식 #미국주식 #코스피 #경제뉴스";
const caption = [
  `${kicker} ${subject} ${numText}, 이유는?`,
  PM ? "오늘 주식 시황 · 코스피 마감 · 외국인 수급 · 환율" : "오늘 주식 시황 · 미국 증시 마감 · 나스닥 · 코스피 개장 전",
  "",
  `왜? ${why} (출처: ${whySrc || "언론 보도"})`,
  "",
  PM ? "내일 아침 7시, 간밤 뉴욕과 개장 전 숫자를 정리해 올립니다." : "뉴스·환율·수급·일정 전체 카드는 프로필 피드 게시물에서 확인하세요.",
  "평일 아침 7시·저녁 5시 40분 업데이트. 놓치지 않으려면 @market.vitals 팔로우.",
  "",
  "종목 추천을 하지 않습니다. 수치는 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 언급된 종목을 보유하고 있을 수 있습니다.",
  "",
  tags,
].join("\n");
const R = join(ROOT, "posts", `${id}_R`);
mkdirSync(R, { recursive: true });
for (const f of ["video.mp4", "cover.jpg"]) copyFileSync(join(OUT, f), join(R, f));
writeFileSync(join(R, "post.json"), JSON.stringify({ id: `${id}_R`, format: "R", variant: "v3", caption, first_comment: data.reel?.comment || "", video: "video.mp4", cover: "cover.jpg", share_to_feed: PM }, null, 2)); // 저녁은 캐러셀이 없어 릴스를 피드에도
console.log(`짧은 릴스 v3 ${T}초 (${kicker} ${numText}, 배경 ${bg.split(/[\\/]/).pop()}) → posts/${id}_R/`);
