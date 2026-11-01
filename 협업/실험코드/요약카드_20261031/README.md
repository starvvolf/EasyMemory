# 실험 코드: 유니브 비교 → 요약→카드 설계 (2026-10-31)

"유니브 AI와 속도·품질 비교" 스레드에서 돌린 일회용 실험 스크립트 모음이다. 앱 코드가 아니다(앱에서 부르지 않음). 결과와 해석은 `협업/결과보고/`의 문서에 있고, 인수인계는 `협업/인수인계/스레드별/유니브 AI와 속도·품질 비교.md`.

원래 위치는 PC 임시 폴더(Claude 세션 스크래치)였고, 코드만 옮겼다. 강의 PDF·생성 결과(요약 글, 카드, 쪽 이미지, 점수 JSON)는 공개 저장소라 옮기지 않았다.

## 돌리는 법

- **저장소 맨 위에서** 실행한다. 스크립트가 `process.cwd()` 기준으로 `src/lib/...`, `node_modules/...`를 불러온다.
- `node --experimental-strip-types <스크립트> <인자…>` (`.cjs`·`.mjs`는 그냥 `node`).
- AI를 부르는 스크립트(표에 "AI"라고 적힌 것)는 ChatGPT 로그인이 필요하다. 토큰 암호화 키는 환경 변수 `STUDY_FORGE_CHATGPT_ENCRYPTION_KEY`가 없으면 `~/.study-forge/chatgpt-token-key`에서 읽는다(키 값은 코드에 없다). **돌리기 전에 사용자에게 AI 사용량을 말한다.**
- 기본 입력: 데드락 14쪽 `Downloads\유니브비교\deadlocks.pdf`, 그래픽스 03 44쪽 `Downloads\유니브비교\graphics03.pdf`. 웹 글은 엔진 데이터의 web-trial 본문 JSON.

## 폴더

### 1_통째요약 — PDF를 한 번에 넣은 요약 (AI)

| 파일 | 하는 일 | 인자 | 결과 문서 |
|---|---|---|---|
| `whole-pdf-summary.mts` | PDF 파일 전체를 `input_file`로 한 번 보내 유니브식 요약 1편. 첫 글자·완성 시간·토큰·쪽 표시 수 | `<pdf> <out.md> [모델] [강도]` → `out.md`, `out.md.json` | `실측_PDF통째요약_terra_20261031.md` (terra/sol × low/medium) |
| `variant-summary.mts` | 같은 요약을 (a) 쪽 이미지만, (b) 우리 전처리(prep-2) 결과로 보내 비교 | `<images\|prep> <pdf> <out.md> [모델] [강도]` | 같은 문서 "이미지만 입력", "전처리 입력 한 번에" 절 |

### 2_전처리점검 — prep-2가 그림·수식을 놓치는 쪽 찾기 (AI 없음)

| 파일 | 하는 일 |
|---|---|
| `prepscan.mts` | `preparePdf`(prep-2)로 쪽마다 route·reasons·chars·pictureCover·pathOps 표를 JSON으로 (`<pdf> <out.json>`) |
| `pics.mts` | 쪽마다 그림(이미지 객체) 위치·크기 뽑기 (`<pdf> <out.json>`) |
| `garble.mts` | 수학 글꼴이 깨지는 글자 수 세기 (`<pdf…>`) |
| `rules.cjs` | 후보 규칙(R1 고정·R2 상대·R3 그림 작게)별로 바뀌는 쪽 세기 (`<scan 폴더>`) |
| `lost.cjs` | 글자 층만 가는 쪽에서 그림 상자가 글과 겹치는지(빠지는 그림) 판정 (`<pages.json> <scan.json> [가로세로비]`) |
| `txt.mts` | 지정한 쪽의 prep-2 글자 층 출력 (`<pdf> '[쪽…]'`) |
| `crops.mts`, `dump.mts` | 그림 잘라내기 / 쪽 이미지로 저장(눈으로 확인용) |
| `count.mjs` | PDF 쪽 수 |

결과: `점검_prep2_벡터도식_20261031.md`. 여기서 나온 규칙 두 줄(글 300자 미만 && pathOps ≥ 20 → page / pictureCover ≥ 0.02 → figures)이 `prep.ts`에 들어갔다(글·PDF 스레드, 커밋 전).

### 3_요약에서카드 — 요약을 먼저 쓰고 요약에서 카드 만들기 (AI)

| 파일 | 실험 | 구조 | 인자 |
|---|---|---|---|
| `sum2cards.mts` | 1차 | sol 한 번에 요약 전체 → `###`가 닫힐 때마다 그 주제 카드(terra, covers 칸) | `<pdf> <outDir>` |
| `s2c-v2.mts` | 2차 | 뼈대(terra, gist·related 포함) → 주제별 sol 동시 → `<<<EASY>>>`에서 카드 → 마무리 | `<pdf> <outDir>` |
| `s2c-v3.mts` | **3차 (채택 구조)** | 2차 + 뼈대 출력 최소화 + 넘어서기(줄마다 다른 비유·안 맞는 점, 그림 풀이, 직접 해 보기, 이어지는 개념, 스스로 확인, `<<<EXTRA>>>`) + 카드에 비유·오해 붙이기(코드) | `<pdf> <outDir>` |
| `s2c-v4.mts` | 4차 | sol **한 호출**: 뼈대(`<<<OUTLINE_END>>>`) → 개요 → 모든 주제 본문(`<<<BODY_END tN>>>`) → 쉬운 설명 → 더 해 보기 → 핵심 정리. BODY_END마다 줄 2~3개씩 terra 카드 | `<pdf> <outDir>` |
| `v4-body.mts` | 4차 조각 | `s2c-v4.mts`를 만들 때 붙여 넣은 지시문·스트림 처리 부분(단독 실행 안 됨) | - |
| `score.mts` | 채점 | 1차 결과를 기준표 S1~S8·C1~C5로 채점(`checkCards` 사용) | `<outDir>` |
| `inputpages.cjs` | 확인 | 3차에서 요약 줄이 그 호출 입력에 없던 쪽을 인용했는지 세기(결과 0) | `<outDir>` |
| `dry.mts` | 확인 | 카드 스키마에 `covers`를 더한 JSON Schema 크기 확인 | - |

주의: `s2c-v3.mts`·`s2c-v4.mts`의 첫 줄 주석은 2차 것을 복사해 와서 "2차"라고 적혀 있다. 실제 구조는 위 표대로다. 2~4차 스크립트는 각자 채점(S·C·B, 겹침)까지 한다.
기준: `기준_요약카드_유니브급_20261031.md`. 결과(1~4차 숫자·요약 전문·카드): `실험_요약에서카드_20261031.md`.

### 4_웹글 — 같은 구조를 웹 글에 (AI)

| 파일 | 하는 일 | 인자 |
|---|---|---|
| `web-s2c.mts` | 소제목(h2/h3)으로 코드가 주제 나눔 → 주제별 sol 동시 → 줄 2~3개씩 terra 카드 → 마무리. 그림 규칙으로 장식 그림 거름. mode `onefirst`는 캐시 비교(첫 호출 먼저) | `<article.json> <outDir> [full\|onefirst]` |
| `web-one.mts` | 웹 글판 4차: sol 한 호출로 목차 → 본문(`<<<BODY_END>>>`) → 쉬운 설명…, BODY_END마다 카드 | `<article.json> <outDir> [mode]` |
| `web-one-body.mts` | `web-one.mts` 조각(단독 실행 안 됨) | - |
| `colors.mts`, `sheet.mts` | 글 속 그림을 색·크기로 훑고, 한 장짜리 그림 목록 이미지로(그림 거르기 규칙 만들 때 눈으로 확인) | `<article.json> [outDir]` |

결과: `실험_웹글_요약에서카드_20261031.md`. `web-one.mts` 결과는 이 스레드 보고에 숫자로 정리되지 않았다(PC 테스트 세션이 추가로 돌린 것, 보고서 확인 필요).

### 5_유니브분석

| 파일 | 하는 일 |
|---|---|
| `checkquotes.mjs` | 유니브 퀴즈 문항의 원문 인용이 PDF 해당 쪽 글자 층에 있는지 대조(`<pdf> <quotes.json> <pdfjs 경로>`). 인용 목록(quotes.json)은 강의 원문 조각이라 옮기지 않았다. 실제 대조는 유니브 화면 안의 pdf.js로 했다(17개 중 쪽 일치 17, 글자 그대로 11) |

## 손대지 말 것

- 이 폴더 스크립트는 기록용이다. 엔진에 넣을 때는 `src/lib/study/gen/`에 새로 짠다(글·PDF 스레드의 `summary.ts`가 시작점).
- 출력 폴더(`outDir`)를 이 저장소 안으로 잡지 않는다. 요약 글·카드에 강의 내용이 들어간다.
