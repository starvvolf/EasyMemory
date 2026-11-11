# Recaller 작업 규칙

이 저장소에서 일하는 모든 세션이 먼저 읽는 문서다. 영역별 자세한 내용은 그 폴더의 `CLAUDE.md`에 있다.

## 시작할 때

1. `git pull --rebase origin claude/recaller2`
2. `협업/현황.md` 맨 위 세 칸(📢 모두가 알 것 · 지금 판 · 일정)과 `협업/지금_유효한_결정.md`, `git log --oneline -20`을 읽는다.
   사용자 피드백은 고칠 것 보드(`협업/고칠것보드.md`)로 온다: 자기 갈래 것을 확인한다.
3. 사용자에게 먼저 답하고, 무엇을 할지 말한 다음 실행한다.

## Recaller는

이론(PDF·웹 글)은 읽어서, 알고리즘은 풀어서, 실습에서는 만들어서 배운 것을 **지식 하나**로 쌓고, 잊을 때쯤 다시 묻는 PC 학습 앱이다. 흐름은 해 보기 → 쌓기(지식 = 뜻 + 경험) → 다시 묻기. AI는 만들고 돕기만 하고, 판정·기록·복습 날짜는 코드가 한다. 앱은 내 PC의 `127.0.0.1:3000`(Next.js)에서 돌고, AI는 사용자의 ChatGPT 로그인으로 부른다. 켜고 끄기는 Recaller 앱(`Recaller 앱.cmd`, Electron) 하나로 한다: 켤 때 코드·데이터 받기 → 앱 서버 → 실습 코스 서버(4100), 끌 때 확인 → 서버 끄기 → 데이터 올리기(`desktop/README.md`). 실험 서버는 `lab/`에 따로 있다.

작업할 때는 네 가지를 구분한다: 장기 목적 / 이번 학기 목표 / 지금 구현 / 이번에 사용자가 요구한 변경. 코드에 있다고 요구사항이 아니고, 장기 목적에 있다고 지금 만들 것이 아니다.

## AI 호출 원칙

- 기본 모델은 gpt-6.1-terra · low다. 다른 모델·강도는 실측으로 더 낫다고 확인한 곳에만 쓰고, 이유를 코드 주석이나 `docs/DECISIONS.md`에 남긴다(예: 같은 지식 판정은 API 키가 있으면 Decisions, 없거나 실패하면 sol).
- 호출 하나의 시간은 "첫 글자 약 3.4초 + 출력 토큰 ÷ 출력 속도"다. 빠르게 하려면 출력을 줄이고(안 쓰는 칸은 스키마에서 빼고, 바뀐 것만 받기) 일을 나눠 동시에 부른다.
- 통째로 한 번에 보내지 않는다. 앞 호출을 기다리는 단계는 꼭 필요할 때만 더한다.
- 모델이 만든 것은 코드 검사나 다른 호출의 확인을 거친다. 싼 모델(luna)은 그런 검사가 뒤에 있는 곳에만 쓴다.
- 고정 지시문·기준은 요청 앞쪽에, 호출마다 다른 내용은 뒤쪽에 둔다(프롬프트 캐시).
- 코드로 할 수 있는 판정·계산·이름 맞추기는 모델에 맡기지 않는다.
- 모델을 바꾸거나 호출을 늘리는 변경은 호출 기록(시간·토큰)으로 전후를 비교한다(`tools/토큰 사용량 보기.cmd`). 근거는 노션·Claude 문서 "Recaller AI 호출 가이드"에 있다.

## 영역과 주인

| 영역 | 주인 | 폴더 (자세히는 그 폴더의 CLAUDE.md) |
|---|---|---|
| 알고리즘 (PS, 예전 이름 코드 문제) | A | `src/lib/code/`, `src/lib/assist/code-ai.ts`, `src/app/api/code/`, `workspace/CodeStudy.tsx`, 켜고 끄기(`scripts/`, `desktop/`), `tools/` |
| 지식 저장소 | B | `src/lib/knowledge/`, `src/lib/assist/knowledge-ai.ts`, `src/app/api/knowledge/`, `workspace/Knowledge*.tsx` |
| 생성 엔진 (PDF) | C | `src/lib/study/gen/`, `src/lib/study/knowledge.ts`, `src/app/lab/`, `src/app/api/lab/`, `lab/run-engine-lab.mjs` |
| 실습 (예전 이름 프로젝트 코스) | D | `experiments/project-course/`, `workspace/ProjectStudy.tsx`, `src/app/api/project-course/` |
| 함께 쓰는 곳 | 모두 | `src/app/study/dejipgi-app.js`·`DejipgiStudy.tsx`(공부 화면, 화면을 크게 바꾸기 전 상의), `src/lib/study/knowledge-contract.ts`(B·C 약속), `src/lib/assist/model.ts`, `src/lib/ai/model.ts`, `src/lib/schedule/`(일정, 주인 미정), `docs/DECISIONS.md`, `협업/현황.md` |

- 화면 이름과 안쪽 이름 (2026-11-05): 화면에 보이는 "알고리즘"은 안쪽에서 `code`(`src/lib/code/`, `/api/code`, 화면 `code`, 지식 출처 `code`), "실습"은 `project`(`experiments/project-course/`, `/api/project-course`, 화면 `project`)다. 안쪽 이름은 바꾸지 않았다. 새 화면 글에는 알고리즘·실습을 쓴다.
- 자기 영역 밖 파일을 고치면 커밋 첫 줄에 `[경계]`를 붙이고 무엇을 왜 바꿨는지 적는다.
- 다른 영역은 지식 저장소를 `src/lib/knowledge/api.ts`로만 부른다. B는 그 함수 이름과 받는 값을 바꾸지 않는다(바꿔야 하면 새 함수를 더한다).

## 사용자와 일하는 법

- 한국어 존댓말, 짧고 결과 위주. 실행 전에 답과 할 일을 먼저 말한다.
- 항상 사람이 바로 이해하기 쉽게 (사용자 11/10). 화면 글·기억·AI가 쓰는 글은 용어보다 상황으로, 쉬운 말로. 사용자에게 하는 설명도 장면·예시로.
- 결정을 앞질러 가지 않는다: 제안 → 사용자가 고름 → 구현 → `docs/DECISIONS.md`에 덧붙임(남의 항목은 안 고침, "정한 사람" 적기).
- 화면을 크게 바꾸기 전에는 상의한다.
- AI 사용량이 드는 실행(PDF 생성, 문제 만들기 등)은 하기 전에 말한다.
- 비밀번호는 사용자가 직접 넣는다.

## 하지 말 것

- 공개 저장소다: 강의 자료·문제 원문·블로그 글·`.env*`·키·ChatGPT 인증을 커밋하지 않는다.
- 3000번 서버를 묻지 않고 끄거나 재시작하지 않는다. Recaller 앱 창을 닫지 않는다(닫으면 서버가 꺼지고 데이터가 올라간다). `.env.local`을 바꾸지 않는다.
- 데이터 폴더를 지우지 않는다. 비울 때는 `scripts/recaller-data.mjs archive`(보관 후 비우기)로 하고, 사용자에게 먼저 묻는다.
- 건드리지 않는 것: `codex/engine-astra` 쪽 파일, `.pnpm-store/`, `pnpm-workspace.yaml`, `desktop/package-lock.json`.
- 웹 글을 주소로 가져오는 기능은 만들지 않는다(사용자 결정).
- GitHub Pages 같은 공개 페이지는 사용자가 직접 켠다.

## 커밋

- 브랜치 `claude/recaller2`. push 전에 항상 `git pull --rebase`.
- 일 하나를 끝내면 `협업/현황.md`의 자기 칸과 "지금 판" 자기 줄을 고쳐 같이 커밋한다. 자기 영역 밖까지 영향을 주는 변경(구조·규칙·공용 파일·문서 체계)이면 "📢 모두가 알 것"에 한 줄 더한다. 새 결정은 `docs/DECISIONS.md`에 덧붙이고 `협업/지금_유효한_결정.md`의 해당 줄도 고친다.
- 지금 누가 어느 파일을 고치는지는 `tools/작업 현황 보기.cmd`(127.0.0.1:3091 [작업 현황] 탭, 구조도 위)에서 본다. Claude Code 세션은 고친 파일이 저절로 남는다. Codex·다른 도구는 고치기 전에 `node tools/work/claim.mjs <영역> <파일…>`, 끝나면 `node tools/work/claim.mjs <영역> --done`. 겹침(빨강)이 보이면 그 파일은 먼저 고치던 쪽과 정하고 고친다.
- PC 작업 폴더는 `C:\Users\jkh01\coding\Recaller`(이 저장소의 `claude/recaller2`, 10/31부터). 앱(3000)도 여기서 켠다. 손으로 복사하지 않고 git으로 주고받는다.
- 앱 데이터는 `.env.local`의 `STUDY_FORGE_DATA_DIR`(보통 `..\RecallerData`, 비공개 저장소)다. 예전 작업 폴더 `CreatorTemp\recaller-integration`의 `tmp\review-test-data`는 11/4 RecallerData에 올렸다. 그 폴더는 사용자가 정리하기 전까지 지우지 않는다.

## 테스트

- 전부: `npm test` (2026-11-05 기준 529개, 실패 15개는 정리 전부터 실패하던 옛 실험실·MCP 시험).
- 영역만: `node --experimental-strip-types --test src/lib/code/*.test.ts src/lib/knowledge/*.test.ts src/lib/schedule/*.test.ts`
- 엔진을 고쳤으면 `src/lib/study/knowledge-contract.test.ts`, `src/lib/study/gen/*.test.ts`도.
- 타입 검사·린트: `npx tsc --noEmit -p .`, `npx eslint <파일>`.

## 문서 지도

- `docs/DECISIONS.md`: 정한 것 (덧붙이기만)
- `docs/*_파이프라인.md`, `docs/지식저장소_동작정의와점검.md`: 동작 설명
- `협업/현황.md`: 지금 상태(맨 위 📢 모두가 알 것 · 지금 판) · `협업/지금_유효한_결정.md`: 유효한 결정 한 장 · `협업/발표준비_체크리스트.md`: 발표까지 할 일 · `협업/삽질방지_노트.md`: 자주 막히는 것 · `협업/결과보고/`: 실험 결과 · `협업/구조도/`: 구조도(노션에 임베드됨, 경로를 바꾸지 않는다)
- 노션: "Recaller | 캡스톤디자인(2)"(제품 소개, 진행판, 시장 조사, 관련 연구)

## 폴더

- `src/app/study`(화면), `src/app/api`(API), `src/lib`(기능), `desktop/`(Electron 앱), `scripts/`(켜기·끄기·데이터 동기화·데이터 보관), `experiments/project-course/`(실습 코스 서버·VS Code 확장), `extension/`(크롬 확장).
- `lab/`: 실험실(엔진·PS 실험 서버, 문제 만들기·프롬프트 점검 실험, 실험 코드). 제품 흐름에 넣지 않는다. 새 실험도 여기에.
- `tools/`: 개발 도구(토큰 사용량·작업 현황, `space.mjs` 용량 보기, 데이터 보관하고 새로 시작, 에이전트 MCP).
- 2026-11-05 정리로 옛 Study Forge 화면·API·도구·스크립트·`eval/`·`보관/`을 지웠다(`협업/결과보고/계획_리팩토링_A_20261105.md`). git 기록에서 되살릴 수 있다. 아직 남은 옛 이름(`mcp-*`, `study-executor`, `personalization-lab`, `tools/problem-authoring-lab`, `tools/study-forge-mcp`의 5개 파일)은 지금 공부 화면이 쓰는 것이다.
