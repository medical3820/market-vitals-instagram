#!/usr/bin/env node
// 예약 작업이 쓴 inbox/<날짜>.json 이 규칙에 맞는지 push 전에 확인한다.
// 사용: node scripts/check_inbox.mjs inbox/2026-10-13.json   (문제 있으면 이유를 출력하고 종료 코드 1)

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("사용: node scripts/check_inbox.mjs inbox/<날짜>.json"); process.exit(1); }
const problems = [];
let j;
try { j = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error("JSON 형식 오류: " + e.message); process.exit(1); }

const BANNED = ["추천", "수혜", "목표가", "목표주가", "매수 의견", "매도 의견", "팔아라", "급등주", "대장주", "테마주", "관련주", "유망", "호재", "악재", "특징주"];
const news = (key, label) => {
  const list = j[key];
  if (!Array.isArray(list) || list.length < 2 || list.length > 3) { problems.push(`${label}: 2~3건이어야 합니다 (현재 ${Array.isArray(list) ? list.length : 0}건)`); return; }
  list.forEach((n, i) => {
    const at = `${label} ${i + 1}번`;
    for (const k of ["h", "d", "src"]) if (!n[k] || typeof n[k] !== "string") problems.push(`${at}: ${k} 없음`);
    if ((n.h || "").length > 28) problems.push(`${at}: 제목 ${n.h.length}자 (28자 이내)`);
    if ((n.d || "").length > 90) problems.push(`${at}: 요약 ${n.d.length}자 (90자 이내)`);
    if (!/[·,]/.test(n.src || "")) problems.push(`${at}: 출처가 두 곳 이상이어야 합니다 (예: 연합뉴스·한국경제)`);
    const bad = BANNED.filter((w) => ((n.h || "") + (n.d || "")).includes(w));
    if (bad.length) problems.push(`${at}: 쓰면 안 되는 표현 (${bad.join(", ")})`);
  });
};
if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date || "")) problems.push("date 가 YYYY-MM-DD 형식이 아닙니다");
news("global", "해외 뉴스");
news("domestic", "국내 뉴스");
if (j.schedule_kr != null) {
  if (!Array.isArray(j.schedule_kr)) problems.push("schedule_kr 는 배열이어야 합니다");
  else j.schedule_kr.forEach((x, i) => {
    if (!/^\d{2}:\d{2}$/.test(x.time || "")) problems.push(`국내 일정 ${i + 1}번: time 은 HH:MM (한국 시간)`);
    if (!x.item || x.item.length > 30) problems.push(`국내 일정 ${i + 1}번: item 은 1~30자`);
  });
}

if (problems.length) { console.error("고칠 점:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("통과: " + file);
