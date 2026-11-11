# 실습 (D)

학습자가 VS Code(또는 앱 안 편집기)에서 직접 만들고, 오른쪽 Recaller 튜터가 대화로 돕는 실습. 앱과 따로 도는 실습 서버(127.0.0.1:4100)이고, 앱의 공부 탭 "실습"과 이어진다. 11/11 사용자 "예전에 정해진 코스용 기능도 빼도 될 듯"으로 정해진 코스(게시판 코스 · 코스 정하기 · 대본 수업 · 코스 생성 · 막혔어요 칸 · 실험방 · 프로젝트 노트)와 먼저 알 것 지도 · 기억의 "진행 방식"을 뺐다. 지금은 자유 대화 실습 하나다. 옛 코스 진행 기록의 데이터는 `.data`에 남아 있지만 목록에 안 보인다(git 기록에서 코드를 되살릴 수 있다).

## 구조

- 서버 `server/main.ts`(실습 경로만), 화면 `web/`(튜터 탭에 그대로 뜬다), VS Code 확장 `vscode-bridge/`(옛 확장이 붙으면 서버가 새것을 깔고 "다시 불러오기")
- 실습 한 판 `lib/practice.ts`: 화면 상태(`practiceView`), 버튼 · 목표 동작(`practiceAct`), 저장할 때 확인(`checkOnSave`), 판정 반영 · 학습 종료 · 목표 기록, 코드 묻기(`askAbout`, `/api/bridge/ask`). 대화는 `lib/agent-chat.ts`(OpenCode, Node 24 필요) 또는 Codex(`lib/codex-chat.ts`)
- 목표 `lib/goals.ts`: 장기 목표 · 로드맵 · 현재 목표 · 보충 · 도움 정도(다이얼: 스스로 · 같이 · 빨리 만들기). 선행은 현재 목표마다 큰 덩어리(name · check)로, 학습자가 스스로 표시(`setPrereqSelf`, 미리 묻지 않음), 모르는 덩어리는 필요한 만큼만 가르치고 "받아 쓴 것"으로 남김. 표시는 `g.chunks`에 남아 다음 목표의 같은 덩어리로 이어진다. [깊이]는 학습자 표시를 세지 않는다
- 학습 기록(11/11) `lib/history.ts`: 사람 하나 · 모든 실습 · 이름 단위 한 줄(`.data/history.jsonl`)을 코드가 쓰고, 튜터는 `search_history`로 찾는다. 컴퓨터끼리는 학습 노트(`learner-note.ts`)
- 기억 `lib/memory.ts`: 학습자 경향만(진행 방식은 뺌, 다이얼이 대신함)
- 막힌 순간(11/11) `lib/moments.ts`: 오류(학습자 명령 실패) · 틀림 판정 · [너무 어려워요]로 열고, 같은 명령 성공 · 맞음 · 보충 마침으로 닫는다([다음으로] · 종료면 "안 풀고 넘어감"). 그 사이 학습자 말 · 튜터 답 횟수 · 코드 받음 · 튜터가 고친 파일을 타임라인 한 칸이 닫힐 때 보탠다. 어떻게 풀렸나(혼자 · 힌트 · 코드 보고 · 튜터가 고쳐 줌)는 코드가, "무엇을 바꿔 풀렸나"는 볼 때 저장본 차이로 계산. `.data/moments/<run>.json`, `GET /api/runs/<id>/moments`, [기록] 화면 맨 위. 튜터가 고친 앞뒤는 자유 대화 실습에서도 `.data/agent-edits/chat-<chatId>/`에 남는다(줄 주인 계산용)
- 포트: 코스 서버 4100, 실습 서버 4101, 검사용 서버 4102, 앱 안 편집기 4103(11/11). D는 이 넷만 쓴다
- 앱 안 편집기(11/11 사용자 "기존 방식 남기고 한번 도입해봐"): `lib/editor-web.ts` + `web/studio.html`(`/studio.html?run=<id>`, 왼쪽 편집기 · 오른쪽 튜터 `?embed=1`). VSCodium 웹 서버판(`vscodium-reh-web-<플랫폼>`, MIT, 확장은 Open VSX)을 학습자가 [받기]를 눌러 처음 한 번 받는다(`%LOCALAPPDATA%\Recaller\editor-web`, sha256 확인). 127.0.0.1 + 켤 때마다 새 토큰(파일), 설정 · 확장은 `.data/editor-web`(사용자 VS Code와 따로), 연결 확장은 `RECALLER_EMBEDDED=1`이면 튜터 탭 · 떠 있는 튜터 창을 안 띄우고(0.9.5 hello에 embedded) 처음 한 번 어두운 테마 · 안내 끄기 같은 설정을 넣음(0.9.4, 웹 편집기의 사용자 설정은 브라우저 쪽이라 서버 설정 파일이 안 먹음). 남은 예전 편집기는 켤 때 끔(`.data/editor-web/pid`). 버전은 `VERSION`에 고정. 원래 방식(내 VS Code + 튜터 창)은 그대로
- 튜터 엔진 `lib/oc-engine.ts`: OpenCode(`@opencode/sdk` 2.2.1)를 이 프로세스 안에 띄우고 플러그인 훅으로 교육 규칙을 붙인다. 엔진 코드는 고치지 않는다. Node 24가 없으면 대화가 안 된다(오류로 알림)
- 코드 조각 실행·문서 `lib/tutor-tools.ts`: 권한 모드 Node(그 파일만 읽기, 하위 프로세스 막음) 4초·64MB / MDN 검색·Node 문서 JSON, 주소는 공식 문서 6곳만
- AI: 앱과 같은 ChatGPT 로그인(`lib/ai.ts`, 앱의 `chatgpt-auth.ts`를 읽기만), 모델 `gpt-6.1-terra`(10/31, 되돌림 `RECALLER_ASSIST_MODEL`). 호출 한도는 없음(필요하면 `PC_AI_LIMIT`), 호출 수는 `.data/ai-usage.json`

## 앱과 잇는 곳

- 앱의 `/api/project-course/*`(로컬 실험 모드만, `src/app/api/project-course/`)가 코스 서버를 부른다. 4100이 꺼져 있으면 앱이 `프로젝트코스 실험.cmd`를 최소화로 켠다(60초에 한 번, 로컬 4100일 때만, VS Code는 안 염, 끄기 `PROJECT_COURSE_AUTOSTART=0`. 10/31 사용자 "필요할 때 켜기", P5 대신). 화면 `src/app/study/workspace/ProjectStudy.tsx`(이어 하기·노트·새 프로젝트·지식 연결 상태)
- 코스 서버는 앱 데이터에 직접 쓰지 않는다. `GET /api/runs/<id>/sync`(`lib/sync.ts`)가 "아직 안 보낸 것"만 내주고, 앱이 `knowledge/api.ts`의 `saveMany`·`recordEvent`로 넣은 뒤 `POST /api/runs/<id>/sync`로 넣은 열쇠를 돌려준다(`.data/sync/<run>.json`).
- 언제: 앱의 공부 → 프로젝트 화면이 열려 있을 때 열자마자 + 1분마다, 또는 "지금 넣기". 코스 서버가 먼저 보내지는 않는다

## 데이터와 PC 폴더 (10/31)

- 진행·대화·노트·작업 폴더는 이 폴더의 `.data/`(깃에 안 올라감). `.node24/`·`node_modules/`도 깃에 없다
- 예전 PC 폴더 `CreatorTemp\recaller-integration\experiments\project-course\.data`에 지금까지의 진행(게시판 2개)이 있다. 새 폴더(`coding\Recaller`)에서 켜면 비어 있으니, 이어 하려면 `.data`를 복사한다. 처음 켤 때 `프로젝트코스 실험.cmd`가 Node 24와 OpenCode를 다시 받는다
- 테스트·시험은 가짜 AI(`PC_FAKE_AI=1`)와 임시 `PC_DATA_DIR`로. AI 사용량이 드는 실행은 사용자에게 먼저 말한다

## 켜기·테스트

- 자유 대화 도구 진행(11/4 사용자 요청): `AgentIO.progress`와 OpenCode execute.before/after로 실제 도구의 진행 중·완료·실패·중단을 채팅에 표시한다. 앞 안내문의 저장을 기다린 뒤 도구 행을 넣고, 같은 호출 id의 상태를 갱신한다. 학습 기록과 코드 실행 내부 실패도 실패로 구분하며, 종료된 답변의 늦은 스트리밍은 무시한다. `lib/tool-progress.ts`, `lib/agent-chat-testcases.ts`, `test/agent-chat-tools.test.ts`. 테스트지는 `docs/도구호출_테스트지.md`(7개 도구·학습 조정 5종·관찰 3종, 20문항 + 중단/연속성 확인). 자동 시험은 가짜 모델이 호출을 지정하고 실제 OpenCode 도구를 실행하는 연결 검증이다. 실제 로그인 모델의 도구 선택 품질과는 구분한다.



- `코스 서버 지킴이.cmd`(11/3, 사용자가 자리에 없을 때 원격 실험용): `tools/keeper.mjs`가 코스 서버를 켜 두고, 꺼지면 다시 켜고, `.data/control/restart` 파일이 바뀌면(원격 세션이 git pull 뒤 글을 써 넣음) 새 코드로 다시 켠다. VS Code는 안 연다. 상태 `.data/control/status.json`, 서버 출력 `.data/control/server.log`

- `프로젝트코스 실험.cmd`: Node 22.13 이상, 처음 한 번 이 폴더에 Node 24와 OpenCode를 받고(창이 보임) 그다음부터는 최소화로 켜진다. 코스 서버만 껐다 켜면 되고 3000번 앱은 건드리지 않는다
- `npm test`(이 폴더). OpenCode까지 보려면 Node 24로: `.node24\node_modules\.bin\node.cmd --test test\*.test.ts`
- 공용 테스트(루트 `CLAUDE.md`)는 앱 쪽 파일(`ProjectStudy.tsx`, `src/app/api/project-course/`)을 고쳤을 때
