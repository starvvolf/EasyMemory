# 프로젝트 코스 (D)

VS Code에서 작은 서비스를 한 단계씩 만들고, 오른쪽 Recaller 튜터 탭이 돕는 코스. 앱과 따로 도는 코스 서버(127.0.0.1:4100)이고, 앱의 공부 탭 "프로젝트"와 이어진다. 자세히: 이 폴더의 `README.md`, 구조도(`협업/구조도/구조도.html`)의 프로젝트 칸, `docs/DECISIONS.md`의 10/28~10/30 D 항목.

## 구조

- 코스 서버 `server/main.ts`, 화면 `web/`(튜터 탭에 그대로 뜬다), VS Code 확장 `vscode-bridge/`(0.7.3, `recaller-bridge.vsix`. 옛 확장이 붙으면 서버가 새것을 깔고 "다시 불러오기"를 띄운다)
- 튜터 창 `lib/float.ts` + `float/main.cjs`(11/2 사용자 "앱 쪽 화면, VS Code와 같이 움직이고 항상 위, 코드 만질 땐 반투명"): 코스 서버가 앱의 `desktop/node_modules/electron`을 빌려 작은 창을 띄운다. VS Code 창 오른쪽 안쪽에 붙어 따라다니고(PowerShell이 0.2초마다 창 위치), VS Code나 이 창이 앞에 있을 때만 보인다. 타이핑하면(확장 → `/api/bridge/typing`) 2초 동안 한 줄 띠로 접힘(11/2 저녁: 흐리게 → 접기), 📌 고정이면 안 접힘. 크기 셋: 기본 · 펼침(넓게) · 띠. 화면은 `web/app.js` `drawFloat`(지금 걸음 카드 하나 + 지난 걸음 한 줄씩 + 따로 물어본 대화는 위로 올라오는 칸, 메시지의 `beat`·`t` 표시로 나눔), 글꼴 Pretendard 튜터 창을 쓰면 확장은 VS Code 탭을 저절로 열지 않는다. Windows 전용, 끄기 `PC_FLOAT=0`
- 학습 진행 엔진 바탕 `lib/session.ts`(11/3, 사용자 설계안 `docs/코딩학습에이전트_설계안_v0.1.md` · 대응표 `docs/코딩학습에이전트_구현대응.md`): 세션(지금 활동 = 행동 7종 · 임시 학습 스택 · 레벨은 내부 설정) `.data/sessions/<run>.json`, 학습 사건(누가 했는지 actor) `.data/events/<run>.jsonl`. 대본 걸음은 기본 길이고 걸음 종류가 행동으로 대응된다(say → 설명/예제, predict → 확인, fix → 안내, explain → 정리). 질문하면 임시 학습을 쌓고(3겹 넘으면 알림), 하던 거로 돌아가면 닫는다. 튜터 맥락에 [학습 진행] 한 줄
- 엔진 위에 올린 것(11/3, 사용자 "끝까지 구현"): ① 끼어들기 — 같은 확인 3번 연속 실패면 "원인부터 같이 찾기 · 같이 해요 · 만들어 주세요" 제안(`do: diagnose`), 설명 걸음의 "알아요, 넘길게요"(`do: known`, 자기평가로만), 레벨(내부)은 단계 통과 때 판정(해냄 2번 ↑ · 버거움 2번 ↓, L0에서 알아요 3번 → L1)하고 고칠 방식 버튼 순서(L0~1은 같이 해요 먼저)와 튜터 맥락에 씀 ② 재개 요약 — 마지막 사건에서 20분 넘으면 사건에서 사실만 골라 "지난번에는…"(AI 0번, `do: recap_ok`) ③ 지식 연동 `lib/recall.ts` — 질문하면 앱(3000) `/api/knowledge/search`로 관련 지식 3개까지 튜터 맥락에(앱이 꺼져 있으면 생략, 끄기 `PC_RECALL=0`) ④ 작업 지시 — `workOrderText`(목표 · 범위 · 제외 · 검증 · 반환), `AgentIO.scope` 밖 파일은 OpenCode 권한 훅·기본 엔진이 막음, 생성 코스의 "만들어 주세요"는 작업 지시 ⑤ 코스 생성 `lib/generate.ts` — 목표 → 목차(AI) → 1단계(AI) → 관문(시작 실패 · 완성 통과 · 틀린 완성 떨어뜨림 · 앵커 · 돌려 보기) → 못 넘으면 오류 붙여 다시(3번) → 다음 단계는 앞 단계 시작 때 뒤에서. 범위는 설치 없는 Node http API, 뼈대(서버 · 라우터 · HTTP 도우미)는 코드가. `.data/courses/gen-*`, `POST /api/generate` · `GET /api/generate/<id>`, 홈 "만들고 싶은 걸 적어 주세요" ⑥ 평가 `test/scenario.test.ts`(가짜 AI로 생성 → 질문 → 3번 실패 → 원인 찾기 → 통과 → 사건 → 2단계)
- 튜터 지시·맥락(11/3 ChatGPT 비교 뒤, DECISIONS 11/3): 모델 본문은 `shapeRequest`(oc-engine)가 다듬는다 — OpenCode 덧붙임 떼기, verbosity medium. 숨기는 것은 예측 답·완성 코드뿐. 질문 파일은 `questionFiles`(이름이 정의된 파일 + 고칠 파일). AI 호출 기록 `lib/promptlog.ts` → `.data/prompts/`(모델에 실제로 간 본문과 답, 끄기 `PC_PROMPT_LOG=0`). 처음에 언어 경험 묻기(TS → JS → Python) → 세션 배경 · 처음 레벨 · 튜터 맥락
- 학습 상태 · 도구 · 경로(11/3, 구조도 `협업` 아티팩트 "Recaller 코딩 튜터 구조도"): `lib/learner.ts`(개념별 상태는 사건에서 코드가, AI 관찰은 `.data/learner/<run>.json`에 따로), `lib/learning-tools.ts`(튜터 도구 get_course · get_progress · get_step · get_learning_history · record_observation), `lib/planner.ts`(단계 정리에서 course-planner 제안 → 코드 검사 → `.data/path/<run>.json`, `do: plan_go`, "내 말로" 판단 judgeExplain). 대화는 진행 기록 하나에 하나로 이어 쓰고 `session-id` 헤더(캐시, `협업/결과보고/실측_ChatGPT로그인_프롬프트캐시_D_20261103.md`)
- [막혔어요](11/3, DECISIONS "막히면 거꾸로 내려가는 기초 세션"): `lib/stuck.ts` 칸(frame) 스택 `.data/stuck/<run>.json` — 학습자가 고른 막힘으로 처음 칸을 연다. 칸은 세션이 아니라 학습 위치(DECISIONS "칸은 세션이 아니라 학습 위치"): 튜터 대화는 진행 기록 하나에 하나로 이어 쓰고, 칸 스택과 그 칸의 규칙(처음 줄: 짚기 / 아래 칸: 작은 예로 설명)은 그 차례 맥락 끝 [지금 위치 — 막혔어요]에 붙는다. 튜터 도구 stuck_name_gap · stuck_go_deeper(열면 같은 답에서 바로 설명) · stuck_resolved, 아래 칸이 풀리면 튜터를 다시 부르지 않고 `stuckReturned`가 위 칸을 다시 놓는다(처음 줄이면 "한국어로 읽어 볼래요?"). 채팅은 칸 안의 말(`sf` 표시)까지 전부 맥락에 들어간다. 깊이는 `PC_STUCK_MAX`(10)와 같은 칸 반복만 막는다. 기초 칸 목록·기록 `lib/basics.ts`(공통 + 언어별, `.data/basics.json`, `GET /api/basics`). 기본 엔진(OpenCode 없음)에는 막힘 도구가 없어 [이제 알겠어요]로만 닫힌다
- AI 채팅 실험방 `#/lab`(11/3, 사용자 "말투부터 하는 짓까지 맘에 안 들어서"): `lib/lab.ts` — 추가 지시(`.data/control/prompt-extra.json`, 모든 튜터 차례 맥락 끝에 [추가 지시]로 붙음, 실제 코스에도 적용), 실험용 진행 기록(`.data/control/lab.json`, `POST /api/lab/new`), 프롬프트 처리 방식(PIPELINE)과 마지막으로 실제 간 것(`.data/prompts/` 기록, `GET /api/lab`). 화면 글은 `tyText`로 일정한 속도로 흘려 보인다(밀리면 1.5초 안에 따라잡음). 맥락 고치기(11/4 사용자 "대화 내역만 고정, 나머지는 다 수정 가능"): `lib/prompts.ts` — 고정 지시문 · 첫 차례 맥락 틀 · 매 차례 맥락 틀({학습자상태} 같은 자리표시, 자리표시가 모두 빈 줄은 빠짐) · [막혔어요] 규칙 둘 · 파일 붙이기 on/off · 코스 생성 지시 둘을 `.data/control/prompts.json`에 저장, 다음 답부터 쓰임(고정 지시문은 `shapeRequest`가 바꿔 끼움). 대화 내역(앞부분 요약 · 최근 대화 · 지난 질문 뒤 화면)만 코드가 그대로 붙인다
- 포트: 코스 서버 4100, 실습 서버 4101, 검사용 서버 4102, 앱 안 편집기 4103(11/11). D는 이 넷만 쓴다
- 앱 안 편집기(11/11 사용자 "기존 방식 남기고 한번 도입해봐"): `lib/editor-web.ts` + `web/studio.html`(`/studio.html?run=<id>`, 왼쪽 편집기 · 오른쪽 튜터 `?embed=1`). VSCodium 웹 서버판(`vscodium-reh-web-<플랫폼>`, MIT, 확장은 Open VSX)을 학습자가 [받기]를 눌러 처음 한 번 받는다(`%LOCALAPPDATA%\Recaller\editor-web`, sha256 확인). 127.0.0.1 + 켤 때마다 새 토큰(파일), 설정 · 확장은 `.data/editor-web`(사용자 VS Code와 따로), 연결 확장은 `RECALLER_EMBEDDED=1`이면 튜터 탭을 안 띄우고 처음 한 번 어두운 테마 · 안내 끄기 같은 설정을 넣음(0.9.4, 웹 편집기의 사용자 설정은 브라우저 쪽이라 서버 설정 파일이 안 먹음). 남은 예전 편집기는 켤 때 끔(`.data/editor-web/pid`). 버전은 `VERSION`에 고정. 원래 방식(내 VS Code + 튜터 창)은 그대로
- 코스 데이터 `courses/board-api/`(지식 17 · 부품 카드 10 · 단계 7 + 전이 과제 · 검사 33), 단계별 대화형 수업 `lessons/1~4.json`(5~7은 없음). 2단계만 새 형식(화면 아래 "지금 할 일" 줄, 고칠 때 제가 해 볼게요 / 같이 해요(빈칸 + 조각) / 만들어 주세요(백업 뒤 준비된 정답 파일, AI 아님), 껐다 켜기 확인, 질문 뒤 "하던 거로 돌아가기"). 단계 완료는 체험 기준 + 정직한 기록(10/31 사용자). 템플릿의 `<from N>`·`<until N>`·`<swap N>` 표시로 단계마다 시작 코드와 정답이 나온다
- 맛보기 코스 `courses/hello-api/`(11/2, 시험용): 인사 서버 2단계(이름으로 인사 + 400 / 방명록을 배열에 넣고 껐다 켜서 사라지는 것 보기), 단계마다 직접 쓰는 줄 1~2개, 수업 계획서 2개 모두 새 형식. 첫 화면 "인사 서버 맛보기 (10분)" → `POST /api/quickstart`(묻기·확인 문제 없이 1단계부터). 코스·수업 테스트는 모든 코스를 돈다
- 코스 정하기 `lib/intake.ts`: 기본은 정해진 질문, AI 대화는 고를 때만. 시작 단계는 확인 문제 6개로 규칙 코드(`makePlan`)가 정한다. 만들 것은 지금 게시판 하나로 고정
- 수업 `lib/lesson.ts`: 계획서의 걸음(설명·지도·예측·고치기·설명하기)과 튜터 질문. 기록: 직접 → 맞힘(혼자), 같이 → 힌트, 만들어 줌·튜터가 고침 → 메모(앎으로 안 침), 헷갈려요 → 물어봄. 통과하면 실습 서버를 꺼서 다음 요청 때 새 코드로 켠다
- 튜터 맥락(`oc-engine.ts` `promptParts`, 10/31 "캐시가 맞게"): 같은 단계는 OpenCode 대화를 이어 쓰고, 계획서·코스 순서·학습자 목표는 첫 메시지에만, 이어 쓸 때는 지금 순서·마지막 검사·지난 질문 뒤 일만, 파일은 바뀌었을 때만. 20번 넘으면 새 대화. 기본 엔진은 예전처럼 한 번에
- 튜터 엔진 `lib/oc-engine.ts`: OpenCode(`@opencode/sdk` 2.2.1)를 이 프로세스 안에 띄우고 플러그인 훅으로 교육 규칙을 붙인다. 엔진 코드는 고치지 않는다. Node 24가 없으면 `lib/agent.ts`의 기본 루프로 돈다
  - 방식 셋: 보통(도구 사용) / 설명만(도구 없음, 파일+import를 붙여 한 번에, 첫 글자 약 7초) / 흐름 투어(`show_tour`만, 코드 덩어리에 불을 켜며 따라감)
  - 허용: 읽기(read·glob·grep), 고치기(patch·edit·write, 기록되고 "직접 통과 아님"), 우리 도구(open_in_editor·start_server·send_request·run_checks·look_db·show_tour), 10/30에 더한 것(ask_learner 보기 버튼으로 되묻기, run_snippet 코드 조각 실행, look_docs 공식 문서). 명령 실행·아무 웹 검색은 막는다
  - 학습자가 VS Code에서 고치는 중(저장 안 함)인 파일은 못 고친다. 답에 정답 줄이 나오면 "정답 보고 고침"(힌트 3단계)으로 기록
  - 화면: 답이 흘러나옴, 생각 요약 한 줄("💭 …", 모델이 영어로 줄 수 있음), [■ 멈추기]. 답하는 중 새 질문은 막는다
- 코드 조각 실행·문서 `lib/tutor-tools.ts`: 권한 모드 Node(그 파일만 읽기, 하위 프로세스 막음) 4초·64MB / MDN 검색·Node 문서 JSON, 주소는 공식 문서 6곳만
- 자동 검사 `lib/checker.ts`: 검사용 서버(4102)에 실제 HTTP 요청 + SQLite 확인, 이전 단계까지 다시 검사. 결과는 요청 / 기대 / 실제 / 의심 줄
- 프로젝트 노트(학습자 기억) `lib/notes.ts`: 파일별 기록(덩어리 설명·질문·물어본 말·투어·고친 것), 파일 사이 연결(import + 투어 길), 말 나누기(문법 / 도구 / 프로젝트 이름). 튜터가 질문마다 읽는다. 문법·도구 말은 언어 공통 사전 `.data/notes/_lang.json`에도 쌓지만 아직 아무도 읽지 않는다
- AI: 앱과 같은 ChatGPT 로그인(`lib/ai.ts`, 앱의 `chatgpt-auth.ts`를 읽기만), 모델 `gpt-6.1-terra`(10/31, 되돌림 `RECALLER_ASSIST_MODEL`). 호출 한도는 없음(필요하면 `PC_AI_LIMIT`), 호출 수는 `.data/ai-usage.json`

## 앱과 잇는 곳

- 앱의 `/api/project-course/*`(로컬 실험 모드만, `src/app/api/project-course/`)가 코스 서버를 부른다. 4100이 꺼져 있으면 앱이 `프로젝트코스 실험.cmd`를 최소화로 켠다(60초에 한 번, 로컬 4100일 때만, VS Code는 안 염, 끄기 `PROJECT_COURSE_AUTOSTART=0`. 10/31 사용자 "필요할 때 켜기", P5 대신). 화면 `src/app/study/workspace/ProjectStudy.tsx`(이어 하기·노트·새 프로젝트·지식 연결 상태)
- 코스 서버는 앱 데이터에 직접 쓰지 않는다. `GET /api/runs/<id>/sync`(`lib/sync.ts`)가 "아직 안 보낸 것"만 내주고, 앱이 `knowledge/api.ts`의 `saveMany`·`recordEvent`로 넣은 뒤 `POST /api/runs/<id>/sync`로 넣은 열쇠를 돌려준다(`.data/sync/<run>.json`). `knowledge-export`는 옛 미리 보기
- 넣는 것: 코스 개념 → 개념(물어봄·틀림·힌트·맞힘을 사건으로), 학습자가 직접 누르거나 물어본 문법·도구 말 → 어휘. 설명에 나오기만 한 말과 이 프로젝트에서만 쓰는 이름(router, findPost…)은 넣지 않는다. 출처는 `코드` 종류, ref `project:<코스 id>`
- 언제: 앱의 공부 → 프로젝트 화면이 열려 있을 때 열자마자 + 1분마다, 또는 "지금 넣기". 코스 서버가 먼저 보내지는 않는다

## 데이터와 PC 폴더 (10/31)

- 진행·대화·노트·작업 폴더는 이 폴더의 `.data/`(깃에 안 올라감). `.node24/`·`node_modules/`도 깃에 없다
- 예전 PC 폴더 `CreatorTemp\recaller-integration\experiments\project-course\.data`에 지금까지의 진행(게시판 2개)이 있다. 새 폴더(`coding\Recaller`)에서 켜면 비어 있으니, 이어 하려면 `.data`를 복사한다. 처음 켤 때 `프로젝트코스 실험.cmd`가 Node 24와 OpenCode를 다시 받는다
- 테스트·시험은 가짜 AI(`PC_FAKE_AI=1`)와 임시 `PC_DATA_DIR`로. AI 사용량이 드는 실행은 사용자에게 먼저 말한다

## 남은 것 (노션 진행판 P1~P13, 10/30 · 인수인계 `협업/인수인계/파트D.md` 3절, 11/1)

- 진짜 AI로 확인: 캐시 맥락 뒤 질문 2~3번, Windows에서 자동 켜기. 튜터 맥락·프롬프트 다시 짜기(방식별 개입 수준, 학습자 기록, 바뀐 코드만, 코드가 정한 조건에서 먼저 말 걸기: 제안 → 사용자 결정). 막혔을 때 빠져나오는 길, 3단계 이후 새 형식. 코드 리뷰는 보류(10/31 사용자)

- P1·P2 앱 지식·예전 물어본 말을 튜터가 읽기 · P3 힌트 단계를 코드로 지키기 · P4 프로젝트 지식으로 복습 문제
- P5는 "필요할 때 켜기"로 대신함 · P6 화면 없이 지식 넘기기 · P7 튜터 화면 배치(사용자 결정) · P8 5~7단계 수업
- P9 투어를 실제 실행으로 · P10 도구 쓰는 질문 속도(아직 20초 안팎) · P11 어휘 묶는 단위(B와) · P12·P13 다른 코스·코스 고르기
- 10/30 논의(구현 전, 사용자와 더 정할 것): 첫 대화에서 기능 체크 + 기능마다 직접/맡김, 코스 = AI 생성 + 자동 검증 관문(설계도 먼저, 앞 단계부터, 뒤는 천천히), 도움 사다리(개념 → 방향 → 위치 → 의사코드 → 줄 번역 → 코드), 환경 설치는 정해진 길(`env_check`·`install`)로, 알짜 지식 따로 보기

## 켜기·테스트

- 자유 대화 도구 진행(11/4 사용자 요청): `AgentIO.progress`와 OpenCode execute.before/after로 실제 도구의 진행 중·완료·실패·중단을 채팅에 표시한다. 앞 안내문의 저장을 기다린 뒤 도구 행을 넣고, 같은 호출 id의 상태를 갱신한다. 학습 기록과 코드 실행 내부 실패도 실패로 구분하며, 종료된 답변의 늦은 스트리밍은 무시한다. `lib/tool-progress.ts`, `lib/agent-chat-testcases.ts`, `test/agent-chat-tools.test.ts`. 테스트지는 `docs/도구호출_테스트지.md`(7개 도구·학습 조정 5종·관찰 3종, 20문항 + 중단/연속성 확인). 자동 시험은 가짜 모델이 호출을 지정하고 실제 OpenCode 도구를 실행하는 연결 검증이다. 실제 로그인 모델의 도구 선택 품질과는 구분한다.

- 자유 대화 실험의 [입력·프롬프트 보기](11/4): 배치 순서·다음 차례 재료 미리 보기·마지막 답변의 실제 요청 본문(도구 전후 호출 각각)을 보여 준다. 고정 지시문·코스 맥락·매 차례 틀을 `.data/agent-chat/prompts.json`에서 편집한다. 틀의 `{state}`·`{messageId}`는 코드가 채우며 대화 내역은 별도로 유지한다. 프롬프트가 바뀌면 다음 질문에서 새 모델 세션에 최근 대화를 넣고, 기록·학습 상태는 유지한다. 실제 요청은 `.data/agent-chat/inputs/<id>.json`, 이전 호출은 기존 `.data/prompts/`에서 읽는다. 인증 헤더는 화면에 내보내지 않는다. [코스 재시작]은 기존 대화·코드를 남긴 채 초기 상태·새 코드 폴더로 시작하며 편집 프롬프트는 유지한다.

- 자유 대화 튜터 실험(11/4, 사용자 "기존 것 재사용해서 실험용 챗봇"): `http://127.0.0.1:4100/agent-chat.html`. 기존 코스 대본과 별도로 자연스럽게 대화하면서 목표·초점·보충 경로·AI 관찰을 도구로 바꾼다. `lib/agent-chat.ts`(상태·대화·동시성), `lib/agent-chat-policy.ts`(짧은 전용 지시·도구 계약), `web/agent-chat.*`. OpenCode·ChatGPT 로그인·파일 읽기·조각 실행·호출 기록은 기존 것을 재사용한다. 모델 terra low. 기존 실험방 프롬프트 설정은 섞지 않는다. 데이터는 `.data/agent-chat/`에만 저장하고 기존 코스 진도·앱 지식으로 보내지 않는다. 이해도는 AI 관찰(검증 안 됨), 복귀는 실제 답변 인용과 칸 id 검사. Node 24/OpenCode가 없으면 명확하게 오류를 보여 준다. 자동 검사·파일 수정·코스 생성은 이 실험판의 도구에 없다.

- `코스 서버 지킴이.cmd`(11/3, 사용자가 자리에 없을 때 원격 실험용): `tools/keeper.mjs`가 코스 서버를 켜 두고, 꺼지면 다시 켜고, `.data/control/restart` 파일이 바뀌면(원격 세션이 git pull 뒤 글을 써 넣음) 새 코드로 다시 켠다. VS Code는 안 연다. 상태 `.data/control/status.json`, 서버 출력 `.data/control/server.log`

- `프로젝트코스 실험.cmd`: Node 22.13 이상, 처음 한 번 이 폴더에 Node 24와 OpenCode를 받고(창이 보임) 그다음부터는 최소화로 켜진다. 코스 서버만 껐다 켜면 되고 3000번 앱은 건드리지 않는다
- `npm test`(이 폴더). OpenCode까지 보려면 Node 24로: `.node24\node_modules\.bin\node.cmd --test test\*.test.ts`
- 공용 테스트(루트 `CLAUDE.md`)는 앱 쪽 파일(`ProjectStudy.tsx`, `src/app/api/project-course/`)을 고쳤을 때
