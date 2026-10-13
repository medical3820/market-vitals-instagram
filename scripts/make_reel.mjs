#!/usr/bin/env node
// 캐러셀 카드(posts/<ID>/NN.jpg)로 세로 9:16 릴스 영상과 스토리 이미지를 만든다.
//   posts/<ID>_R/ : video.mp4(1080x1920, H.264, 무음 AAC), cover.jpg, post.json  → 릴스
//   posts/<ID>_S/ : story.jpg(1080x1920), post.json                              → 스토리
// 사용: node scripts/make_reel.mjs MV20261013
// ffmpeg 가 PATH 에 있어야 한다 (액션: apt ffmpeg, 로컬: FFMPEG=경로). 로컬 렌더링은 PW_CHANNEL=msedge.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const id = process.argv[2];
if (!id) { console.error("사용: node scripts/make_reel.mjs <폴더ID>"); process.exit(1); }
const src = join(ROOT, "posts", id);
const data = JSON.parse(readFileSync(join(src, "data.json"), "utf8"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const STORY_ONLY = process.env.STORY_ONLY === "1" || data.mode === "pm"; // 저녁은 스토리만 (릴스는 하루 한 번, 아침)

// 릴스에 넣을 카드: 커버 → 해외뉴스 → 미국 → 금리·환율 → 국내 수급 → 일정 → 마무리 (있는 것만)
const ORDER = [["cover", 3.2], ["news:해외 경제뉴스", 2.8], ["rows:미국 증시", 2.6], ["rows:금리 · 환율 · 원자재", 2.6], ["flows", 2.8], ["schedule", 2.4], ["outro", 1.8]];
const picks = [];
for (const [key, sec] of ORDER) {
  const [type, label] = key.split(":");
  const i = data.cards.findIndex((c) => c.type === type && (!label || c.label === label));
  if (i >= 0) picks.push({ file: join(src, `${String(i + 1).padStart(2, "0")}.jpg`), sec });
}
if (STORY_ONLY) { picks.length = 0; picks.push({ file: join(src, "01.jpg"), sec: 3 }); }
else if (picks.length < 3) { console.error("릴스로 만들 카드가 부족합니다."); process.exit(2); }

const [y, m, d] = data.date.split("-");
const WD = "일월화수목금토"[new Date(data.date + "T12:00:00+09:00").getUTCDay()];
const head = `${+m}/${+d}(${WD}) ${data.mode === "pm" ? "장 마감 정리" : "개장 전 시장 요약"}`;

const frameHTML = (img, foot) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@700;900&display=swap">
<style>
body{margin:0}
.f{width:1080px;height:1920px;background:#0e3b2e;position:relative;overflow:hidden;font-family:"Gothic A1","Noto Sans CJK KR",sans-serif;word-break:keep-all}
.h{position:absolute;left:72px;right:72px;top:120px;display:flex;flex-direction:column;gap:14px}
.h b{color:#7ff0bf;font-size:44px;font-weight:900;letter-spacing:-.02em}
.h span{color:#fff;font-size:54px;font-weight:900;letter-spacing:-.04em}
.c{position:absolute;left:0;top:300px;width:1080px;height:1350px;display:block}
.b{position:absolute;left:72px;right:72px;bottom:150px;color:#a9d3c2;font-size:36px;font-weight:700;text-align:center}
</style>
<div class="f"><div class="h"><b>마켓바이탈</b><span>${head}</span></div>
<img class="c" src="${pathToFileURL(img).href}"><div class="b">${foot}</div></div>`;

const work = join(ROOT, "work", `reel-${id}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
async function shot(img, foot, out) {
  const f = join(work, "frame.html");
  writeFileSync(f, frameHTML(img, foot));
  await page.goto(pathToFileURL(f).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "png" });
}
const frames = [];
if (STORY_ONLY) {
  const S0 = join(ROOT, "posts", `${id}_S`); mkdirSync(S0, { recursive: true });
  const p = join(work, "story.png");
  await shot(picks[0].file, data.mode === "pm" ? "오늘 장 마감 카드 전체는 프로필 피드에서" : "오늘 아침 카드 전체는 프로필 피드에서", p);
  await browser.close();
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", p, "-q:v", "3", join(S0, "story.jpg")]);
  writeFileSync(join(S0, "post.json"), JSON.stringify({ id: `${id}_S`, story: true, image: "story.jpg" }, null, 2));
  console.log(`스토리만 → posts/${id}_S/`);
  process.exit(0);
}
for (let i = 0; i < picks.length; i++) {
  const out = join(work, `f${i}.png`);
  await shot(picks[i].file, i === 0 ? "카드 전체와 출처는 피드 게시물에서" : `${i + 1} / ${picks.length}`, out);
  frames.push({ out, sec: picks[i].sec });
}
const storyPng = join(work, "story.png");
await shot(picks[0].file, "오늘 아침 카드 전체는 프로필 피드에서", storyPng);
await browser.close();

// 영상: 장면 전환은 하드컷, 30fps, 무음 오디오 트랙 포함 (인스타 업로드 호환)
const list = frames.map((f) => `file '${f.out.replace(/\\/g, "/")}'\nduration ${f.sec}`).join("\n") + `\nfile '${frames[frames.length - 1].out.replace(/\\/g, "/")}'\n`;
const listFile = join(work, "list.txt");
writeFileSync(listFile, list);
const total = frames.reduce((s, f) => s + f.sec, 0);

const R = join(ROOT, "posts", `${id}_R`), S = join(ROOT, "posts", `${id}_S`);
mkdirSync(R, { recursive: true }); mkdirSync(S, { recursive: true });
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
  "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20",
  "-c:a", "aac", "-b:a", "128k", "-shortest", "-t", String(total), "-movflags", "+faststart", join(R, "video.mp4")]);
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", frames[0].out, "-q:v", "3", join(R, "cover.jpg")]);
execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", storyPng, "-q:v", "3", join(S, "story.jpg")]);

// 캡션은 캐러셀과 달라야 한다 (publish.py 가 같은 캡션이면 중복으로 보고 건너뜀)
const caption = [
  `${+m}월 ${+d}일(${WD}) 개장 전 시장, ${Math.round(total)}초 요약`,
  "",
  "뉴스·업종 흐름·수급·일정 전체 카드와 출처는 프로필 피드 게시물에서 확인하세요.",
  "",
  "종목 추천을 하지 않습니다. 수치는 카드에 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 카드에 언급된 종목을 보유하고 있을 수 있습니다.",
  "",
  "#마켓바이탈 #아침시황 #미국증시 #코스피 #경제뉴스",
].join("\n");
writeFileSync(join(R, "post.json"), JSON.stringify({ id: `${id}_R`, format: "R", caption, first_comment: "", video: "video.mp4", cover: "cover.jpg", share_to_feed: false }, null, 2));
writeFileSync(join(S, "post.json"), JSON.stringify({ id: `${id}_S`, story: true, image: "story.jpg" }, null, 2));
console.log(`릴스 ${frames.length}장면 ${total.toFixed(1)}초 → posts/${id}_R/, 스토리 → posts/${id}_S/`);
