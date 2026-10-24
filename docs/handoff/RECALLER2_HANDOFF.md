# Recaller 2 인계 (2026-10-24, Claude → 다음 작업자)

이 문서는 `claude/recaller2` 브랜치에서 이어 작업할 사람을 위한 안내다. 먼저 `AGENTS.md`, `docs/PLANNING_RULES.md`를 읽고, 생성 엔진을 건드릴 때는 `docs/GENERATION_ENGINE_BOUNDARY.md`도 읽는다.

## 0. 꼭 지킬 것

- 사용자와는 한국어로 이야기한다. 화면(UI) 배치를 바꾸기 전에는 먼저 상의한다.
- 이 저장소(EasyMemory)는 **공개**다. 학습 데이터·기출·시험 원문은 저장소 옆의 비공개 폴더 `RecallerData`에만 둔다. `.env`, API 키, `chatgpt-auth`는 출력하거나 커밋하지 않는다.
- 유료 실제 모델 호출(엔진 비교, 품질 테스트 등)은 사용자 확인을 받고 돌린다. 사용자가 화면에서 직접 누르는 실행은 예외다.
- 엔진 비교는 3100 서버에서만 한다. 사용자의 3000 학습 서버와 데이터는 사용자가 요청할 때만 건드린다.
- `codex/engine-astra` 브랜치는 GPT 쪽 작업이다. 다른 사람이 동시에 고치는 파일은 건드리지 않는다.
- 테스트는 적게, 의미 있는 것만 둔다.

## 1. 실행

- 노트북 기준 폴더 배치: `projects/EasyMemory`(이 저장소, `claude/recaller2` 체크아웃) 옆에 `RecallerData`(비공개 데이터).
- 사용자가 켜는 방법:
  - `Recaller 앱.cmd`: Electron 창. 처음 실행 때 `desktop/`에 Electron을 설치하고 바탕화면 바로가기를 만든다.
  - `Recaller 시작.cmd` / `Recaller 끝내기.cmd`: 브라우저로 쓰는 방식.
- 시작 스크립트 `scripts/recaller-start.mjs`가 하는 일: git pull(ff-only) → 필요하면 npm install → 데이터 받기(`recaller-sync.mjs`) → 로컬 서버(3000) → `/study`. 앱 창에서는 `--no-open`으로 실행한다.
- 끝내기 스크립트 `scripts/recaller-stop.mjs`: 서버를 끄고 이 컴퓨터의 데이터를 올린다. 앱 창을 닫을 때 자동으로 실행된다.
- 개발 검사:
  - 타입 검사: `node node_modules/typescript/bin/tsc --noEmit -p .`
  - 테스트: `node --test --experimental-strip-types <파일>`
  - 가짜 모델로 서버 띄우기:
    ```
    AI_OWNER_EMAIL=local@example.com STUDY_FORGE_DATA_DIR=<임시폴더> STUDY_FORGE_TABLET=0 STUDY_FORGE_AUTO_EXECUTOR=0 STUDY_FORGE_MODEL_PROVIDER=fake node scripts/run-local-experiment.mjs
    ```

## 2. 구조

### 화면 `/study` (Recaller)

| 파일 | 역할 |
|---|---|
| `src/app/study/DejipgiStudy.tsx` | React 껍데기. 탭 마크업과 `env` 제공: 서버 API, `notes.compose`, `mountFlow`, `archive` 등 |
| `src/app/study/dejipgi-app.js` | 화면 본체(바닐라 JS, 약 4,200줄). `render()`가 `S.view`에 따라 그린다. 탭은 home·knowledge·read·practice·create·records·bench·archive |
| `src/app/study/dejipgi.css` | 스타일. 모든 선택자는 `.dejipgi` 아래에 둔다. 날짜 주석으로 구역을 나눠 놨다 |
| `src/app/study/FlowBench.tsx` | 작업대 흐름 캔버스(React Flow). 바닐라 앱이 계속 유지하는 host에 한 번만 마운트한다 |
| `src/app/dejipgi/` | 예전 "되짚기" 화면을 그대로 얼려 둔 것. 고치지 않는다 |

### 서버와 라이브러리

| 파일 | 역할 |
|---|---|
| `src/app/api/study-notes/route.ts` | 질문창·노트·`compose`(system+user 한 번 호출). compose는 박스별 `model`, `effort`, `json`, `schema`를 받는다 |
| `src/lib/study/notes.ts` | `composeReply`, `chatReply`. 기본 모델은 `STUDY_FORGE_NOTE_MODEL`, 없으면 gpt-6-sol / low |
| `src/lib/ai/model.ts` | 모든 모델 호출의 입구 `callModel`(ChatGPT 로그인 / codex / fake). JSON 스키마(Structured Outputs)를 지원한다 |
| `src/lib/study/gen/` | 생성 엔진 v2~v5와 alpha. `astra.ts`, `runner.ts`, `types.ts`(`v5Family`) |
| `src/lib/study/knowledge.ts` | 지식 레이어. 계획의 concepts를 지식 포인트로 바꾸고(근거 쪽 = span), objective와 연결한다 |
| `src/lib/study/archive.ts`, `src/app/api/study-archive/` | 보관함(`RecallerData/study-archive.json`). 보관한 덱은 불러오지 않는다 |
| `src/lib/local-experiment-mode.ts` | 로컬 모드에서 허용하는 API 목록. 새 `/api/study-*` 라우트를 만들면 여기에 추가해야 한다. 안 하면 `proxy.ts`가 막는다 |

### 데스크톱 창

| 파일 | 역할 |
|---|---|
| `desktop/main.js` | Electron. 제목 표시줄을 숨기고 윈도우 기본 버튼(titleBarOverlay)만 남긴다. `<html data-shell="desktop">`을 붙이면 앱 상단이 제목 표시줄 역할을 한다(CSS는 dejipgi.css의 2026-10-24 구역) |
| `desktop/package.json` | Electron을 이 폴더에만 설치하므로 메인 앱 의존성과 분리된다 |

화면 코드를 바꾸면 창에서 Ctrl+R로 바로 반영된다. `main.js`를 바꿨을 때만 앱을 다시 켜야 한다.

### 설계 문서 (claude.ai 문서, 사용자 계정)

- "Recaller 2 설계"
  - 3층 구조: 도구(고정 코드) / MD(방법, 자라는 부분) / 개선 고리(피드백 → 반성 → MD 수정안 → 스몰샘플 A/B → 사람 승인)
  - 데이터 모델: Source › Section › Span, Course › Topic › KnowledgePoint, Scenario › Item › Attempt
- "Recaller 학습 에이전트": 의도, 현재 기능, 생성 엔진 구조, 한계

## 3. 최근에 한 일 (claude/recaller2)

1. Recaller 이름으로 바꾸고 첫 화면을 홈(코치, 오늘 할 것)으로 했다. 지식 탭(지식 포인트 지도)을 추가했고, 예전 화면은 `/dejipgi`에 보존했다.
2. 보관함을 만들었다. 실험용 중복 세트와 그래픽스 자료는 보관함으로 옮겼고, 지우지 않았다.
3. Electron 창을 만들고, 앱 상단과 제목 표시줄을 합쳤다.
4. 전체화면 읽기에서 아래가 검게 보이던 문제를 고쳤다(body 배경).
5. 작업대를 "흐름" 캔버스로 바꿨다.
   - 입력 박스(글 + 자료 1~3쪽)와 모델 박스(이름·모델·추론 강도·지시·출력 형식)를 화살표로 잇는다.
   - 한 방향 실행만 된다. 입력이 준비된 박스는 동시에 돌고, 루프는 연결 단계에서 막는다.
   - 박스마다 상태, 시간, 출력 미리보기가 보인다. 옆 패널에서 편집하고 전체 입력/출력을 본다.
   - 흐름 저장/불러오기와 예시 흐름("다듬고 실행 (원본 비교)")이 있다.
   - 새 모델 박스 기본값은 Responses API 틀(`[역할]/[원칙]/[출력]`)로 시작하고, "이 박스를 기본값으로"로 바꿀 수 있다.
   - JSON 출력과 선택 스키마(Structured Outputs)를 지원한다.
   - 저장 위치는 브라우저 localStorage: `recaller:flow:draft:v1`, `recaller:flow:saved:v1`, `recaller:flow:default-model:v1`.
   - 실제 ChatGPT로는 아직 한 번도 돌려 보지 않았다. 클라우드에서 응답을 가짜로 바꿔 끼워 화면과 전달값만 확인했다.

## 4. 안건 (위가 먼저)

1. ~~흐름: 루프~~ (2026-10-24 구현, 실제 모델로는 아직 안 돌림)
   - 실행 순서는 `src/app/study/flow-run.ts`(순수 함수, 테스트 `flow-run.test.ts`). 앞 박스로 되돌아가는 화살표는 점선 "↺ 다시"(edge `data.loop`).
   - 멈춤 조건은 화살표가 나가는 박스의 `stop`(최대 횟수 1~10, JSON 필드 값 / 출력에 낱말 / 횟수만). 기본 최대 3회, `pass = true`.
   - 다시 도는 박스는 `[검토 · 앞 회차]`와 `[자기 이름 · 앞 회차 출력]`을 받는다. 루프 뒤 박스는 끝나고 한 번만 돈다. 실행 중 "■ 멈추기".
   - 회차별 출력은 옆 패널에서 1회/2회… 칩과 "앞 회차와 비교"로 본다. 예시 흐름 "쓰고 검토해서 고치기 (반복)".
2. **흐름: 대화 이어가기·스트리밍**
   - 박스 옵션으로 이전 실행을 이어서 묻기(대화 상태)를 넣는다.
   - 출력이 생성되는 대로 보이게 한다. `callModel`에 `onText`가 있지만 compose 라우트는 아직 한 번에 돌려준다.
3. **흐름 결과 평가 → MD 하네스**
   - 박스 출력에 좋음/별로 같은 태그를 붙인다.
   - 지시 수정안을 만들고, 같은 입력으로 전후 결과를 가린 채 비교한 뒤 승인한다.
   - MD를 둘 위치는 미결정이다. 비공개 RecallerData를 추천해 둔 상태다.
4. **어려운 문제 생성**
   - 여러 과정이 "까리하게 섞인" 상황 문제다. 예: 지구·달 공전 좌표, 추적 카메라 uvn.
   - 정답은 시뮬레이션 코드로 검증하고, 오답 보기는 특정 실수를 코드로 재현해 만든다.
5. **v5 vs Alpha 스몰샘플 품질 비교**: PDF 1~2쪽으로 돌린다. 유료라서 사용자 확인이 필요하다.
6. **코드 공부**: Piston(자체 호스팅)으로 코드를 실행·채점한다. 화면 시안은 claude.ai 디자인 "Recaller 2 코드 공부 화면"에 있다.
7. **"같이 짜기"**: 자유 지시를 AI와 문답해 학습 계획서로 만들고 그대로 학습한다. 미결정 2가지: 질문을 카드로 할지 채팅으로 할지, 과목 계획을 자동 적용할지.
8. 작은 것들
   - 읽기 화면이 창 높이를 다 채우게 하기(제안만 한 상태).
   - 폴더 여러 개 선택해서 옮기기.
   - 과목 자동 지정.

## 5. 노트북 반영 방식 (참고)

노트북 폴더에서는 파일 삭제가 막혀 있어서 `git pull`이 lock 파일을 남긴다. 그래서 지금까지는 이렇게 반영했다.

1. `git fetch`
2. 바뀐 파일을 `git show <커밋>:<파일> > <파일>`로 덮어쓰기
3. `git update-ref`로 브랜치 이동
4. `git reset --mixed`
5. 남은 `.lock` 파일은 `.git/stale-*`로 옮기기

사용자가 직접 켤 때는 시작 스크립트의 `git pull --ff-only`가 이 브랜치를 따라간다.
