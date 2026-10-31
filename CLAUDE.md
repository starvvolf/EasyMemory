# Recaller 작업 규칙

이 저장소에서 일하는 모든 세션이 먼저 읽는 문서다. 영역별 자세한 내용은 그 폴더의 `CLAUDE.md`에 있다.

## 시작할 때

1. `git pull --rebase origin claude/recaller2`
2. `협업/현황.md`(네 영역의 지금 상태)와 `git log --oneline -20`을 읽는다.
3. 사용자에게 먼저 답하고, 무엇을 할지 말한 다음 실행한다.

## Recaller는

이론(PDF·웹 글)은 읽어서, 알고리즘은 풀어서, 프로젝트는 만들어서 배운 것을 **지식 하나**로 쌓고, 잊을 때쯤 다시 묻는 PC 학습 앱이다. 흐름은 해 보기 → 쌓기(지식 = 뜻 + 경험) → 다시 묻기. AI는 만들고 돕기만 하고, 판정·기록·복습 날짜는 코드가 한다. 앱은 내 PC의 `127.0.0.1:3000`(Next.js)에서 돌고, AI는 사용자의 ChatGPT 로그인으로 부른다.

작업할 때는 네 가지를 구분한다: 장기 목적 / 이번 학기 목표 / 지금 구현 / 이번에 사용자가 요구한 변경. 코드에 있다고 요구사항이 아니고, 장기 목적에 있다고 지금 만들 것이 아니다.

## AI 호출 원칙

- 기본 모델은 gpt-6.1-terra · low다. 다른 모델·강도는 실측으로 더 낫다고 확인한 곳에만 쓰고, 이유를 코드 주석이나 `docs/DECISIONS.md`에 남긴다(예: 같은 지식 판정은 API 키가 있으면 Decisions, 없거나 실패하면 sol).
- 호출 하나의 시간은 "첫 글자 약 3.4초 + 출력 토큰 ÷ 출력 속도"다. 빠르게 하려면 출력을 줄이고(안 쓰는 칸은 스키마에서 빼고, 바뀐 것만 받기) 일을 나눠 동시에 부른다.
- 통째로 한 번에 보내지 않는다. 앞 호출을 기다리는 단계는 꼭 필요할 때만 더한다.
- 모델이 만든 것은 코드 검사나 다른 호출의 확인을 거친다. 싼 모델(luna)은 그런 검사가 뒤에 있는 곳에만 쓴다.
- 고정 지시문·기준은 요청 앞쪽에, 호출마다 다른 내용은 뒤쪽에 둔다(프롬프트 캐시).
- 코드로 할 수 있는 판정·계산·이름 맞추기는 모델에 맡기지 않는다.
- 모델을 바꾸거나 호출을 늘리는 변경은 호출 기록(시간·토큰)으로 전후를 비교한다(`토큰 사용량 보기.cmd`). 근거는 노션·Claude 문서 "Recaller AI 호출 가이드"에 있다.

## 영역과 주인

| 영역 | 주인 | 폴더 (자세히는 그 폴더의 CLAUDE.md) |
|---|---|---|
| 코드 문제 (PS) | A | `src/lib/code/`, `src/lib/assist/code-ai.ts`, `src/app/api/code/`, `workspace/CodeStudy.tsx`, `scripts/recaller-*.mjs`, `desktop/` |
| 지식 저장소 | B | `src/lib/knowledge/`, `src/lib/assist/knowledge-ai.ts`, `src/app/api/knowledge/`, `workspace/Knowledge*.tsx` |
| 생성 엔진 (PDF) | C | `src/lib/study/gen/`, `src/lib/study/knowledge.ts`, `src/app/lab/`, `src/app/api/lab/` |
| 프로젝트 코스 | D | `experiments/project-course/`, `workspace/ProjectStudy.tsx`, `src/app/api/project-course/` |
| 함께 쓰는 곳 | 모두 | `src/app/study/dejipgi-app.js`·`DejipgiStudy.tsx`(공부 화면, 화면을 크게 바꾸기 전 상의), `src/lib/study/knowledge-contract.ts`(B·C 약속), `src/lib/assist/model.ts`, `src/lib/ai/model.ts`, `src/lib/schedule/`(일정, 주인 미정), `docs/DECISIONS.md`, `협업/현황.md` |

- 자기 영역 밖 파일을 고치면 커밋 첫 줄에 `[경계]`를 붙이고 무엇을 왜 바꿨는지 적는다.
- 다른 영역은 지식 저장소를 `src/lib/knowledge/api.ts`로만 부른다. B는 그 함수 이름과 받는 값을 바꾸지 않는다(바꿔야 하면 새 함수를 더한다).

## 사용자와 일하는 법

- 한국어 존댓말, 짧고 결과 위주. 실행 전에 답과 할 일을 먼저 말한다.
- 결정을 앞질러 가지 않는다: 제안 → 사용자가 고름 → 구현 → `docs/DECISIONS.md`에 덧붙임(남의 항목은 안 고침, "정한 사람" 적기).
- 화면을 크게 바꾸기 전에는 상의한다.
- AI 사용량이 드는 실행(PDF 생성, 문제 만들기 등)은 하기 전에 말한다.
- 비밀번호는 사용자가 직접 넣는다.

## 하지 말 것

- 공개 저장소다: 강의 자료·문제 원문·블로그 글·`.env*`·키·ChatGPT 인증을 커밋하지 않는다.
- 3000번 서버를 묻지 않고 끄거나 재시작하지 않는다. `Recaller 끝내기`를 누르지 않는다(Recaller 앱 창 닫기도 같음). `.env.local`을 바꾸지 않는다.
- 건드리지 않는 것: `codex/engine-astra` 쪽 파일, `.pnpm-store/`, `pnpm-workspace.yaml`, `desktop/package-lock.json`.
- 웹 글을 주소로 가져오는 기능은 만들지 않는다(사용자 결정).
- GitHub Pages 같은 공개 페이지는 사용자가 직접 켠다.

## 커밋

- 브랜치 `claude/recaller2`. push 전에 항상 `git pull --rebase`.
- 일 하나를 끝내면 `협업/현황.md`의 자기 칸을 고쳐 같이 커밋한다.
- PC 작업 폴더는 `C:\Users\jkh01\coding\Recaller`(이 저장소의 `claude/recaller2`, 10/31부터). 앱(3000)도 여기서 켠다. 손으로 복사하지 않고 git으로 주고받는다.
- 예전 작업 폴더 `CreatorTemp\recaller-integration`은 지우지 않는다: 테스트 데이터(`tmp\review-test-data`, `.env.local`이 가리킴)가 아직 그 안에 있다.

## 테스트

- `node --experimental-strip-types --test src/lib/code/*.test.ts src/lib/knowledge/*.test.ts src/lib/schedule/*.test.ts`
- 엔진을 고쳤으면 `src/lib/study/knowledge-contract.test.ts`, `src/lib/study/gen/*.test.ts`도.
- 타입 검사·린트: `npx tsc --noEmit -p .`, `npx eslint <파일>`.

## 문서 지도

- `docs/DECISIONS.md`: 정한 것 (덧붙이기만)
- `docs/*_파이프라인.md`, `docs/지식저장소_동작정의와점검.md`: 동작 설명
- `협업/현황.md`: 지금 상태 · `협업/삽질방지_노트.md`: 자주 막히는 것 · `협업/결과보고/`: 실험 결과 · `협업/구조도/`: 구조도(노션에 임베드됨, 경로를 바꾸지 않는다)
- 노션: "Recaller | 캡스톤디자인(2)"(제품 소개, 진행판, 시장 조사, 관련 연구)

## 보지 않아도 되는 곳

`보관/`(지난 문서), `tools/` 중 `study-forge-*`·`concept-tree-mcp`·`api-generation-*`·`generation-lab`, `src/app`의 옛 Study Forge 화면(`legacy`, `library`, `manager`, `mcp-runs`, `mcp-personalization`, `project-status` 등), `scripts/verification-11-*`, `eval/runs`·`eval/snapshots`. 지우거나 옮기지는 않는다(아직 코드끼리 이어진 곳이 있다).
