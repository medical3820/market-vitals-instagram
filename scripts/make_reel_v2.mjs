#!/usr/bin/env node
// 후킹형 릴스: 힉스필드로 미리 만든 '글자 없는 배경 영상' 위에 첫 3초 훅 문구를 얹고,
// 핵심 카드를 천천히 확대하며 넘긴 뒤, 팔로우 안내로 끝낸다. 숫자·한글은 전부 코드로 그린다(AI 영상엔 글자 없음).
//   posts/<ID>_R/ : video.mp4(1080x1920, H.264, AAC), cover.jpg, post.json
// 사용: node scripts/make_reel_v2.mjs MV20261015 [배경영상.mp4]
//   배경을 안 주면 assets/bg/ 에서 그날 시장 방향(data.mood)에 맞는 것을 고르고, 없으면 기존 make_reel.mjs 로 넘긴다.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const id = process.argv[2];
if (!id) { console.error("사용: node scripts/make_reel_v2.mjs <폴더ID> [배경.mp4]"); process.exit(1); }
const src = join(ROOT, "posts", id);
const data = JSON.parse(readFileSync(join(src, "data.json"), "utf8"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");

// 배경 고르기: 인자 > assets/bg/<mood>*.mp4 > assets/bg/neutral*.mp4 > 아무 배경
function pickBg() {
  if (process.argv[3]) return process.argv[3];
  const dir = join(ROOT, "assets", "bg");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".mp4"));
  // 시장 방향: data.mood 가 없으면 미국 3대 지수 평균 등락으로 정한다 (0 이상 up, 아니면 down)
  const us = (data.cards.find((c) => c.label === "미국 증시")?.rows || []).slice(0, 3).filter((r) => r.chg != null);
  const avg = us.length ? us.reduce((t, r) => t + r.chg, 0) / us.length : 0;
  const want = data.mood || (data.mode === "pm" ? "neutral" : avg >= 0 ? "up" : "down");
  const day = Number(data.date.replaceAll("-", ""));
  const pool = files.filter((f) => f.startsWith(want));
  const neutral = files.filter((f) => f.startsWith("neutral"));
  const list = pool.length ? pool : neutral.length ? neutral : files; // 맞는 배경이 없으면 있는 것 중에서
  return list.length ? join(dir, list[day % list.length]) : null;
}
const bg = pickBg();
if (!bg || !existsSync(bg)) { console.error("배경 영상 없음 — 기존 릴스 방식으로 만드세요(make_reel.mjs)."); process.exit(3); }

// 릴스에 넣을 카드 (아침 기준, 있는 것만)
const ORDER = [["news:해외 경제뉴스", 2.4], ["rows:미국 증시", 2.2], ["rows:금리 · 환율 · 원자재", 2.2], ["flows", 2.4], ["schedule", 2.0]];
const picks = [];
for (const [key, sec] of ORDER) {
  const [type, label] = key.split(":");
  const i = data.cards.findIndex((c) => c.type === type && (!label || c.label === label));
  if (i >= 0) picks.push({ file: join(src, `${String(i + 1).padStart(2, "0")}.jpg`), sec });
}
const [, m, d] = data.date.split("-");
const WD = "일월화수목금토"[new Date(data.date + "T12:00:00+09:00").getUTCDay()];
const when = `${+m}/${+d}(${WD}) ${data.mode === "pm" ? "장 마감" : "개장 전"}`;
// 훅 문구: 아침은 '가장 크게 움직인 미국 지수' + '1번 해외 뉴스 제목(쉼표 앞, 16자 이내)', 저녁은 커버 제목
function hookLines() {
  const cover = (data.cards[0].headline || "").split("\n");
  if (data.mode === "pm") return cover;
  const rows = (data.cards.find((c) => c.label === "미국 증시")?.rows || []).filter((r) => r.chg != null);
  const big = rows.slice(0, 3).sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))[0];
  const l1 = big ? `${big.name} ${Math.abs(big.chg).toFixed(2)}% ${big.chg < 0 ? "하락" : "상승"}` : cover[0];
  const news = data.cards.find((c) => c.type === "news" && c.label === "해외 경제뉴스")?.items?.[0]?.h || "";
  const head = news.split(/[,…]/)[0].trim();
  const l2 = head && head.length <= 16 ? head : cover[1] || "";
  return [l1, l2].filter(Boolean);
}
const hook = hookLines();

const work = join(ROOT, "work", `reel2-${id}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@700;900&display=swap">`;
const BASE = `body{margin:0;background:transparent}.f{width:1080px;height:1920px;position:relative;overflow:hidden;font-family:"Gothic A1","Noto Sans CJK KR",sans-serif;word-break:keep-all}`;

// 1) 훅 오버레이(투명 PNG): 브랜드·날짜, 큰 훅 문구, 아래 '30초 정리'
const hookHTML = `<!doctype html><meta charset="utf-8">${FONT}<style>${BASE}
.top{position:absolute;left:80px;top:150px;color:#7ff0bf;font-size:46px;font-weight:900;letter-spacing:-.02em}
.top span{display:block;color:#fff;opacity:.85;font-size:38px;font-weight:700;margin-top:10px}
.mid{position:absolute;left:70px;right:70px;top:640px;display:flex;flex-direction:column;gap:22px}
.mid div{display:inline-block;align-self:flex-start;background:rgba(10,30,24,.78);color:#fff;font-size:84px;font-weight:900;line-height:1.12;letter-spacing:-.05em;padding:14px 26px;border-radius:18px}
.mid div:first-child{color:#7ff0bf}
.bot{position:absolute;left:0;right:0;bottom:330px;text-align:center;color:#fff;font-size:44px;font-weight:900;text-shadow:0 2px 16px rgba(0,0,0,.6)}
</style><div class="f"><div class="top">마켓바이탈<span>${when} 시장 정리</span></div>
<div class="mid">${hook.map((l) => `<div>${l.replace(/[<>&]/g, "")}</div>`).join("")}</div>
<div class="bot">숫자로 15초 정리 ↓</div></div>`;
// 2) 카드 장면: 어두운 배경 + 카드 (확대 효과는 ffmpeg)
const cardHTML = (img, i, n) => `<!doctype html><meta charset="utf-8">${FONT}<style>${BASE}
.f{background:#0b2a21}
.t{position:absolute;left:80px;right:80px;top:140px;display:flex;justify-content:space-between;color:#7ff0bf;font-size:40px;font-weight:900}
.t span{color:#a9d3c2;font-weight:700}
img{position:absolute;left:0;top:285px;width:1080px;height:1350px}
.bar{position:absolute;left:80px;right:80px;bottom:200px;height:10px;background:#185040;border-radius:5px}
.bar i{position:absolute;left:0;top:0;bottom:0;width:${Math.round(((i + 1) / n) * 100)}%;background:#7ff0bf;border-radius:5px}
</style><div class="f"><div class="t">마켓바이탈<span>${when}</span></div><img src="${pathToFileURL(img).href}"><div class="bar"><i></i></div></div>`;
// 3) 마무리 오버레이(투명): 팔로우 안내
const ctaHTML = `<!doctype html><meta charset="utf-8">${FONT}<style>${BASE}
.c{position:absolute;left:80px;right:80px;top:700px;display:flex;flex-direction:column;gap:30px;align-items:center;text-align:center}
.c b{color:#fff;font-size:76px;font-weight:900;letter-spacing:-.04em;line-height:1.2;text-shadow:0 4px 24px rgba(0,0,0,.6)}
.c span{color:#0e3b2e;background:#7ff0bf;font-size:52px;font-weight:900;padding:18px 40px;border-radius:999px}
.c small{color:#fff;font-size:38px;font-weight:700;opacity:.9;text-shadow:0 2px 12px rgba(0,0,0,.6)}
</style><div class="f"><div class="c"><b>전체 카드와 출처는<br>피드 게시물에서</b><span>@market.vitals 팔로우</span><small>평일 아침·저녁, 같은 지표를 같은 순서로</small></div></div>`;

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
async function shot(html, out, transparent) {
  const f = join(work, "frame.html");
  writeFileSync(f, html);
  await page.goto(pathToFileURL(f).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "png", omitBackground: !!transparent });
}
await shot(hookHTML, join(work, "hook.png"), true);
for (let i = 0; i < picks.length; i++) await shot(cardHTML(picks[i].file, i, picks.length), join(work, `c${i}.png`));
await shot(ctaHTML, join(work, "cta.png"), true);
await browser.close();

// 4) 장면 영상 만들기 (모두 1080x1920, 30fps, yuv420p)
const ff = (args) => execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...args]);
const V = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p";
const HOOK = 3.0, CTA = 2.6, XF = 0.35;
// 훅: 배경 앞 3초 + 훅 문구(0.25초부터 페이드 인)
ff(["-i", bg, "-loop", "1", "-i", join(work, "hook.png"), "-filter_complex",
  `[0:v]trim=0:${HOOK},setpts=PTS-STARTPTS,${V}[b];[1:v]format=rgba,fade=t=in:st=0.25:d=0.35:alpha=1[o];[b][o]overlay=0:0:shortest=1,format=yuv420p[v]`,
  "-map", "[v]", "-t", String(HOOK), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19", join(work, "s0.mp4")]);
// 카드: 천천히 확대(최대 6%)
const segs = [join(work, "s0.mp4")];
picks.forEach((p, i) => {
  const n = Math.round(p.sec * 30);
  ff(["-loop", "1", "-i", join(work, `c${i}.png`), "-vf",
    `scale=1188:2112,zoompan=z='min(1+0.06*on/${n},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=1080x1920:fps=30,format=yuv420p`,
    "-frames:v", String(n), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19", join(work, `s${i + 1}.mp4`)]);
  segs.push(join(work, `s${i + 1}.mp4`));
});
// 마무리: 배경 뒷부분을 어둡게 + 팔로우 안내
const bgDur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", bg]).toString().trim()) || 5;
const ctaStart = Math.max(0, Math.min(bgDur - CTA, 2));
const last = join(work, `s${picks.length + 1}.mp4`);
ff(["-i", bg, "-loop", "1", "-i", join(work, "cta.png"), "-filter_complex",
  `[0:v]trim=${ctaStart}:${ctaStart + CTA},setpts=PTS-STARTPTS,${V},eq=brightness=-0.18:saturation=0.8[b];[b][1:v]overlay=0:0:shortest=1,format=yuv420p[v]`,
  "-map", "[v]", "-t", String(CTA), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19", last]);
segs.push(last);

// 5) 장면 사이를 0.35초 페이드로 잇고, 배경음(배경 영상 오디오를 반복)을 깐다
const durs = [HOOK, ...picks.map((p) => Math.round(p.sec * 30) / 30), CTA];
const total = durs.reduce((s, x) => s + x, 0) - XF * (durs.length - 1);
let chain = "", prev = "[0:v]", off = 0;
for (let i = 1; i < segs.length; i++) {
  off += durs[i - 1] - XF;
  const out = i === segs.length - 1 ? "[v]" : `[x${i}]`;
  chain += `${prev}[${i}:v]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}${out};`;
  prev = `[x${i}]`;
}
const hasAudio = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", bg]).toString().trim() !== "";
const audioIn = hasAudio ? ["-stream_loop", "-1", "-i", bg] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
const ai = segs.length;
// 다 만든 뒤에만 posts/<ID>_R 로 옮긴다 — 중간에 실패해도 기본 릴스가 그대로 남도록
const R = join(ROOT, "posts", `${id}_R`);
const OUT = join(work, "out");
mkdirSync(OUT, { recursive: true });
ff([...segs.flatMap((s) => ["-i", s]), ...audioIn, "-filter_complex",
  chain + `[${ai}:a]atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.8,afade=t=in:d=0.3,afade=t=out:st=${(total - 1).toFixed(3)}:d=1,aresample=44100[a]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-t", total.toFixed(3), join(OUT, "video.mp4")]);
// 커버: 훅 장면 1초 지점
ff(["-ss", "1.0", "-i", join(work, "s0.mp4"), "-frames:v", "1", "-q:v", "3", join(OUT, "cover.jpg")]);

const caption = [
  `${+m}월 ${+d}일(${WD}) ${data.mode === "pm" ? "장 마감" : "개장 전"} 시장, ${Math.round(total)}초 정리`,
  "",
  hook.join(" / "),
  "",
  "뉴스·업종 흐름·수급·일정 전체 카드와 출처는 프로필 피드 게시물에서 확인하세요.",
  "",
  "종목 추천을 하지 않습니다. 수치는 카드에 표기된 시점 기준이며, 투자 판단과 책임은 본인에게 있습니다.",
  "운영자는 카드에 언급된 종목을 보유하고 있을 수 있습니다.",
  "",
  "#마켓바이탈 #아침시황 #미국증시 #코스피 #경제뉴스",
].join("\n");
mkdirSync(R, { recursive: true });
for (const f of ["video.mp4", "cover.jpg"]) copyFileSync(join(OUT, f), join(R, f));
writeFileSync(join(R, "post.json"), JSON.stringify({ id: `${id}_R`, format: "R", caption, first_comment: "", video: "video.mp4", cover: "cover.jpg", share_to_feed: false }, null, 2));
console.log(`후킹형 릴스 ${segs.length}장면 ${total.toFixed(1)}초 (배경: ${bg.split(/[\\/]/).pop()}, 배경음 ${hasAudio ? "있음" : "없음"}) → posts/${id}_R/`);
