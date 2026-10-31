# 프로젝트 코스 (D)

VS Code에서 작은 서비스를 한 단계씩 만들고, 오른쪽 Recaller 튜터 탭이 돕는 코스. 앱과 따로 도는 코스 서버(127.0.0.1:4100)이고, 앱의 공부 탭 "프로젝트"와 이어진다. 자세히: 이 폴더의 `README.md`, 구조도(`협업/구조도/구조도.html`)의 프로젝트 칸, `docs/DECISIONS.md`의 10/28~10/30 D 항목.

## 구조

- 코스 서버 `server/main.ts`, 화면 `web/`(튜터 탭에 그대로 뜬다), VS Code 확장 `vscode-bridge/`(0.7.0, `recaller-bridge.vsix`. 옛 확장이 붙으면 서버가 새것을 깔고 "다시 불러오기"를 띄운다)
- 포트: 코스 서버 4100, 실습 서버 4101, 검사용 서버 4102. D는 이 셋만 쓴다
- 코스 데이터 `courses/board-api/`(지식 17 · 부품 카드 10 · 단계 7 + 전이 과제 · 검사 33), 단계별 대화형 수업 `lessons/1~4.json`(5~7은 없음). 템플릿의 `<from N>`·`<until N>`·`<swap N>` 표시로 단계마다 시작 코드와 정답이 나온다
- 코스 정하기 `lib/intake.ts`: 기본은 정해진 질문, AI 대화는 고를 때만. 시작 단계는 확인 문제 6개로 규칙 코드(`makePlan`)가 정한다. 만들 것은 지금 게시판 하나로 고정
- 수업 `lib/lesson.ts`: 계획서의 걸음(설명·지도·예측·고치기·설명하기)과 튜터 질문. 질문마다 수업 계획·코스 순서·다음에 배울 것·지난 검사·프로젝트 노트·파일을 붙인다
- 튜터 엔진 `lib/oc-engine.ts`: OpenCode(`@opencode/sdk` 2.2.1)를 이 프로세스 안에 띄우고 플러그인 훅으로 교육 규칙을 붙인다. 엔진 코드는 고치지 않는다. Node 24가 없으면 `lib/agent.ts`의 기본 루프로 돈다
  - 방식 셋: 보통(도구 사용) / 설명만(도구 없음, 파일+import를 붙여 한 번에, 첫 글자 약 7초) / 흐름 투어(`show_tour`만, 코드 덩어리에 불을 켜며 따라감)
  - 허용: 읽기(read·glob·grep), 고치기(patch·edit·write, 기록되고 "직접 통과 아님"), 우리 도구(open_in_editor·start_server·send_request·run_checks·look_db·show_tour), 10/30에 더한 것(ask_learner 보기 버튼으로 되묻기, run_snippet 코드 조각 실행, look_docs 공식 문서). 명령 실행·아무 웹 검색은 막는다
  - 학습자가 VS Code에서 고치는 중(저장 안 함)인 파일은 못 고친다. 답에 정답 줄이 나오면 "정답 보고 고침"(힌트 3단계)으로 기록
  - 화면: 답이 흘러나옴, 생각 요약 한 줄("💭 …", 모델이 영어로 줄 수 있음), [■ 멈추기]. 답하는 중 새 질문은 막는다
- 코드 조각 실행·문서 `lib/tutor-tools.ts`: 권한 모드 Node(그 파일만 읽기, 하위 프로세스 막음) 4초·64MB / MDN 검색·Node 문서 JSON, 주소는 공식 문서 6곳만
- 자동 검사 `lib/checker.ts`: 검사용 서버(4102)에 실제 HTTP 요청 + SQLite 확인, 이전 단계까지 다시 검사. 결과는 요청 / 기대 / 실제 / 의심 줄
- 프로젝트 노트(학습자 기억) `lib/notes.ts`: 파일별 기록(덩어리 설명·질문·물어본 말·투어·고친 것), 파일 사이 연결(import + 투어 길), 말 나누기(문법 / 도구 / 프로젝트 이름). 튜터가 질문마다 읽는다. 문법·도구 말은 언어 공통 사전 `.data/notes/_lang.json`에도 쌓지만 아직 아무도 읽지 않는다
- AI: 앱과 같은 ChatGPT 로그인(`lib/ai.ts`, 앱의 `chatgpt-auth.ts`를 읽기만), 모델 `gpt-6-sol`. 호출 한도는 없음(필요하면 `PC_AI_LIMIT`), 호출 수는 `.data/ai-usage.json`

## 앱과 잇는 곳

- 앱의 `/api/project-course/*`(로컬 실험 모드만, `src/app/api/project-course/`)가 코스 서버를 부른다. 화면 `src/app/study/workspace/ProjectStudy.tsx`(이어 하기·노트·새 프로젝트·지식 연결 상태)
- 코스 서버는 앱 데이터에 직접 쓰지 않는다. `GET /api/runs/<id>/sync`(`lib/sync.ts`)가 "아직 안 보낸 것"만 내주고, 앱이 `knowledge/api.ts`의 `saveMany`·`recordEvent`로 넣은 뒤 `POST /api/runs/<id>/sync`로 넣은 열쇠를 돌려준다(`.data/sync/<run>.json`). `knowledge-export`는 옛 미리 보기
- 넣는 것: 코스 개념 → 개념(물어봄·틀림·힌트·맞힘을 사건으로), 학습자가 직접 누르거나 물어본 문법·도구 말 → 어휘. 설명에 나오기만 한 말과 이 프로젝트에서만 쓰는 이름(router, findPost…)은 넣지 않는다. 출처는 `코드` 종류, ref `project:<코스 id>`
- 언제: 앱의 공부 → 프로젝트 화면이 열려 있을 때 열자마자 + 1분마다, 또는 "지금 넣기". 코스 서버가 먼저 보내지는 않는다

## 데이터와 PC 폴더 (10/31)

- 진행·대화·노트·작업 폴더는 이 폴더의 `.data/`(깃에 안 올라감). `.node24/`·`node_modules/`도 깃에 없다
- 예전 PC 폴더 `CreatorTemp\recaller-integration\experiments\project-course\.data`에 지금까지의 진행(게시판 2개)이 있다. 새 폴더(`coding\Recaller`)에서 켜면 비어 있으니, 이어 하려면 `.data`를 복사한다. 처음 켤 때 `프로젝트코스 실험.cmd`가 Node 24와 OpenCode를 다시 받는다
- 테스트·시험은 가짜 AI(`PC_FAKE_AI=1`)와 임시 `PC_DATA_DIR`로. AI 사용량이 드는 실행은 사용자에게 먼저 말한다

## 남은 것 (노션 진행판 P1~P13, 10/30)

- P1·P2 앱 지식·예전 물어본 말을 튜터가 읽기 · P3 힌트 단계를 코드로 지키기 · P4 프로젝트 지식으로 복습 문제
- P5·P6 코스 서버를 앱 안으로, 화면 없이 지식 넘기기 · P7 튜터 화면 배치(사용자 결정) · P8 5~7단계 수업
- P9 투어를 실제 실행으로 · P10 도구 쓰는 질문 속도(아직 20초 안팎) · P11 어휘 묶는 단위(B와) · P12·P13 다른 코스·코스 고르기
- 10/30 논의(구현 전, 사용자와 더 정할 것): 첫 대화에서 기능 체크 + 기능마다 직접/맡김, 코스 = AI 생성 + 자동 검증 관문(설계도 먼저, 앞 단계부터, 뒤는 천천히), 도움 사다리(개념 → 방향 → 위치 → 의사코드 → 줄 번역 → 코드), 환경 설치는 정해진 길(`env_check`·`install`)로, 알짜 지식 따로 보기

## 켜기·테스트

- `프로젝트코스 실험.cmd`: Node 22.13 이상, 처음 한 번 이 폴더에 Node 24와 OpenCode를 받고(창이 보임) 그다음부터는 최소화로 켜진다. 코스 서버만 껐다 켜면 되고 3000번 앱은 건드리지 않는다
- `npm test`(이 폴더). OpenCode까지 보려면 Node 24로: `.node24\node_modules\.bin\node.cmd --test test\*.test.ts`
- 공용 테스트(루트 `CLAUDE.md`)는 앱 쪽 파일(`ProjectStudy.tsx`, `src/app/api/project-course/`)을 고쳤을 때
