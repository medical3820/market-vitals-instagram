# 마켓바이탈 (@marketvitals.kr) 자동 발행

평일 아침, 국내외 시장 흐름을 카드뉴스 캐러셀(최대 10장)로 만들어 인스타그램에 올린다. PC가 꺼져 있어도 돈다.

## 흐름

| 시각(KST) | 어디서 | 하는 일 |
|---|---|---|
| 07:00 | Claude 클라우드 예약 작업 | 언론사 RSS에서 주요 경제뉴스 해외 3·국내 3을 골라 요약 → `inbox/<날짜>.json` push → 카톡 보고 |
| push 직후 | GitHub Actions `daily.yml` | 숫자·경제 일정 수집 → 카드 데이터 조립·검사 → 1080×1350 JPG 렌더링 → 저장소에 올림 → 인스타 발행 |

GitHub 예약(cron)은 2~5시간 늦게 돌아서 쓰지 않는다. 예약 작업의 push가 시작 신호다.

## 카드 구성 (빠지는 카드가 있으면 장수가 줄어든다)

1. 커버: 뉴욕 3대 지수·코스피 한 줄, S&P 500·코스피·원/달러·VIX
2. 해외 경제뉴스 3
3. 미국 증시: S&P 500·나스닥·다우·SOX·VIX
4. 미국 업종 흐름: 업종 ETF 8개 등락 (미국은 투자자별 매매가 공개되지 않아 대체 지표)
5. 금리·환율·원자재: 미 10년물·달러인덱스·원/달러·WTI·금·비트코인
6. 지수선물·아시아: S&P·나스닥 선물, 닛케이·항셍·상하이
7. 국내 경제뉴스 3
8. 국내 증시·투자자별 순매수: 코스피·코스닥, 개인·외국인·기관, 외국인 연속 순매수/순매도 일수
9. 경제 일정 (한국 시간)
10. 마무리: 운영 원칙

## 데이터 출처

- 숫자는 코드가 원자료에서 직접 받는다 (`scripts/fetch_market.mjs`). 기사나 요약 모델을 거치지 않는다.
  - 야후 파이낸스: 미국 지수, 선물, 아시아, 금리, 달러, 환율, 원자재, 비트코인, 업종 ETF. 등락률은 전일 종가·정산가(`previousClose`) 대비.
  - 다음 금융: 코스피·코스닥 종가와 개인·외국인·기관 순매수(원). 장중 값이 섞이지 않도록 16:00 전에는 전 거래일까지만 쓴다.
  - 공개 경제 캘린더(ForexFactory 내보내기): 미국·중국·일본·유럽 주요 지표 발표 시각.
- 뉴스 요약만 Claude가 쓴다. 규칙은 `ROUTINE_PROMPT.md`.

## 발행 전 검사 (하나라도 걸리면 발행하지 않거나 그 카드만 뺀다)

- `BLOCKLIST` secret의 단어(원장님 보유 종목 이름·코드)가 카드나 캡션에 있으면 **발행 중단**. 단어는 공개 로그에 출력하지 않는다.
- 미국·국내 지수 데이터가 없거나 오래됐으면 발행 중단.
- 뉴스에 금지 표현(추천, 수혜, 목표가, 호재·악재 등)이 있거나 너무 길면 그 뉴스만 뺀다. 2건 미만이면 카드를 뺀다.
- 글꼴이 안 불러와졌거나 글이 카드 밖으로 넘치면 렌더링 실패.
- `published.txt`에 이미 있는 날짜는 다시 올리지 않는다. 같은 캡션이 계정에 이미 있어도 올리지 않는다(`publish.py`).

## 처음 설정 (원장님이 직접)

1. 인스타 @marketvitals.kr를 **프로페셔널 계정**(비즈니스 또는 크리에이터)으로 전환.
2. Dr. Kevin 때와 같은 방법으로 이 계정의 **Instagram 사용자 ID와 액세스 토큰** 발급.
3. 이 저장소 Settings → Secrets and variables → Actions 에 secret 3개:
   - `IG_USER_ID`, `IG_ACCESS_TOKEN`
   - `BLOCKLIST`: 보유 종목 이름과 코드를 쉼표로. 예: `종목A,000000,종목B,TICKER`. 보유 종목이 바뀌면 같이 고친다.
4. Actions 탭 → 마켓바이탈 발행 → Run workflow (publish=false)로 카드만 만들어 보고, 결과 이미지(Artifacts)를 확인.
5. 이상 없으면 Claude 클라우드 예약 작업을 켠다.

## 손으로 돌리기

- 카드만 만들어 보기: Actions → 마켓바이탈 발행 → Run workflow (publish=false)
- 특정 날짜를 실제로 올리기: date 입력 + publish=true (그 날짜의 `inbox/<날짜>.json`이 있어야 뉴스 카드가 들어감)

## 로컬에서 시험 (윈도, 엣지 사용)

```
npm install
node scripts/fetch_market.mjs work/market.json
copy examples\inbox-2026-10-12.json inbox\2026-10-12.json   (시험 후 지울 것 — push하면 발행된다)
set DATE=2026-10-12 && node scripts/build.mjs
set PW_CHANNEL=msedge && node scripts/render.mjs MV20261012
```

## 주의

- 저장소와 Actions 로그는 공개다. 보유 종목, 토큰, 개인 자료를 커밋하거나 출력하지 않는다.
- `scripts/publish.py`는 Dr. Kevin 저장소에서 검증된 것을 그대로 가져왔다. 고칠 때는 `npx -y pyright@1 scripts/publish.py`로 확인(이 PC엔 파이썬이 없다).
- 인스타 토큰은 60일마다 갱신해야 한다.
