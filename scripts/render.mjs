#!/usr/bin/env node
// 카드 이미지 렌더링: template/card.html 에 posts/<ID>/data.json 을 넣고 카드마다 1080x1350 JPG 로 찍는다.
// 사용: node scripts/render.mjs MV20261012
// 로컬(윈도)에서는 PW_CHANNEL=msedge 로 설치된 엣지를 쓴다. 액션에서는 playwright 크로미움.
// 글꼴이 안 불러와졌거나 글이 카드 밖으로 넘치면 실패한다 — 깨진 카드를 공개 계정에 올리지 않기 위해서다.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const id = process.argv[2];
if (!id) { console.error("사용: node scripts/render.mjs <폴더ID>"); process.exit(1); }
const dir = join(ROOT, "posts", id);
const data = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));

const html = readFileSync(join(ROOT, "template", "card.html"), "utf8")
  .replace("/*DATA*/", JSON.stringify(data).replace(/</g, "\\u003c"));
mkdirSync(join(ROOT, "work"), { recursive: true });
const tmp = join(ROOT, "work", "render.html");
writeFileSync(tmp, html);

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.classList.add("render");
    document.documentElement.style.setProperty("--card-w", "1080px");
  });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  await page.evaluate(() => document.fonts.ready);

  const fontOk = await page.evaluate(() => document.fonts.check('900 40px "Gothic A1"') &&
    [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Gothic A1" && f.status === "loaded"));
  if (!fontOk) throw new Error("Gothic A1 글꼴을 불러오지 못했습니다 (Google Fonts 연결 확인).");

  const over = () => page.$$eval(".card .in", (els) => els.map((el, i) => (el.scrollHeight > el.clientHeight + 2 ? i + 1 : 0)).filter(Boolean));
  // 넘치는 카드는 1) 한 단계 촘촘하게(squeeze), 2) 그래도 넘치면 '왜?' 한 줄을 빼고 다시 확인한다 — 카드 한 장 때문에 발행 전체가 멈추지 않게
  let overflow = await over();
  if (overflow.length) {
    await page.evaluate((ns) => ns.forEach((n) => document.querySelectorAll(".card")[n - 1].classList.add("squeeze")), overflow);
    overflow = await over();
    if (overflow.length) {
      await page.evaluate((ns) => ns.forEach((n) => document.querySelectorAll(".card")[n - 1].querySelector(".why")?.remove()), overflow);
      console.warn(`주의: ${overflow.join(", ")}번 카드는 공간이 모자라 '왜?' 한 줄을 뺐습니다.`);
      overflow = await over();
    }
  }
  if (overflow.length) {
    const msg = `글이 카드 밖으로 넘칩니다: ${overflow.join(", ")}번 카드`;
    if (process.env.ALLOW_OVERFLOW !== "1") throw new Error(msg); // 디자인 점검용 예외
    console.warn("경고: " + msg);
  }

  const cards = await page.$$(".card");
  for (let i = 0; i < cards.length; i++) {
    const file = join(dir, `${String(i + 1).padStart(2, "0")}.jpg`);
    await cards[i].screenshot({ path: file, type: "jpeg", quality: 92 });
  }
  console.log(`렌더링 완료: posts/${id}/ ${cards.length}장`);
} finally {
  await browser.close();
}
