#!/usr/bin/env node
// 토큰이 살아 있고, 그 토큰의 계정이 마켓바이탈(EXPECT_USERNAME)이며, IG_USER_ID 와 맞는지 확인한다.
// 게시물은 올리지 않는다. 다른 계정 토큰(예: Dr. Kevin)이 잘못 들어가 엉뚱한 계정에 발행되는 사고를 막는다.
// 토큰 값은 어떤 경우에도 출력하지 않는다 (공개 저장소의 로그는 공개).

const TOKEN = (process.env.IG_ACCESS_TOKEN || "").trim();
const USER_ID = (process.env.IG_USER_ID || "").trim();
const EXPECT = (process.env.EXPECT_USERNAME || "").trim().replace(/^@/, "");
const fail = (m) => { console.error("중단: " + m); process.exit(2); };

if (!TOKEN) fail("IG_ACCESS_TOKEN secret 이 비어 있습니다.");
if (!USER_ID) fail("IG_USER_ID secret 이 비어 있습니다.");

const url = `https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=${encodeURIComponent(TOKEN)}`;
let j;
try {
  const r = await fetch(url);
  const text = (await r.text()).split(TOKEN).join("***TOKEN***");
  if (!r.ok) fail(`토큰 확인 실패 (HTTP ${r.status}). 토큰이 만료됐거나 잘못 들어갔을 수 있습니다.\n${text.slice(0, 300)}`);
  j = JSON.parse(text);
} catch (e) {
  fail("토큰 확인 요청 오류: " + String(e.message || e).split(TOKEN).join("***TOKEN***"));
}

console.log(`토큰 계정: @${j.username} (user_id ${j.user_id})`);
if (EXPECT && j.username !== EXPECT) fail(`토큰의 계정이 @${EXPECT} 가 아닙니다. 다른 계정 토큰이 들어간 것 같습니다.`);
if (String(j.user_id) !== USER_ID) fail("IG_USER_ID secret 이 토큰의 계정 ID 와 다릅니다.");
console.log("통과: 토큰과 계정이 맞습니다.");
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n- 토큰 계정 확인: @${j.username} ✓\n`);
}
