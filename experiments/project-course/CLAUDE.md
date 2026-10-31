# 프로젝트 코스 (D)

VS Code에서 작은 서비스를 한 단계씩 만들고, 오른쪽 Recaller 튜터 탭이 돕는 코스. 앱과 따로 도는 코스 서버(127.0.0.1:4100)이고, 앱의 공부 탭 "프로젝트"와 이어진다. 자세히: 이 폴더의 `README.md`, 구조도의 프로젝트 칸.

## 구조

- 코스 서버 `server/main.ts`, 화면 `web/`, VS Code 확장 `vscode-bridge/`
- 코스 데이터 `courses/board-api/`(지식 17 · 부품 카드 10 · 단계 7 · 검사 33). 새 코스는 `courses/<id>/`에 `course.json`과 템플릿만 두면 된다
- 튜터 엔진 `lib/oc-engine.ts`: OpenCode(`@opencode/sdk` 2.2.1) + 교육 규칙(읽기·우리 도구만, 명령 실행·웹 막음, 고친 것은 기록). 엔진 코드는 고치지 않는다
- 자동 검사 `lib/checker.ts`: 검사용 포트(4102)·DB로 실제 HTTP 요청 + SQLite 확인. 실습 서버는 4101
- 학습자 기억(프로젝트 노트): 파일별 덩어리 설명·질문·투어·고친 것, 파일 사이 연결

## 앱과 잇는 곳

- 앱의 `/api/project-course/*`(로컬 실험 모드만)가 코스 서버를 부른다. 화면 `src/app/study/workspace/ProjectStudy.tsx`
- 코스 서버는 앱 데이터에 직접 쓰지 않는다. `GET /api/runs/<id>/knowledge-export`로 "아직 안 보낸 것"만 내주고, 앱이 `knowledge/api.ts`의 `saveMany`·`recordEvent`로 넣는다
- 넣는 것: 코스 개념 → 개념, 물어본 문법·도구 말(await, JSON.parse…) → 어휘. 이 프로젝트에서만 쓰는 이름(router, findPost…)은 넣지 않는다
- 튜터가 정답 줄을 보여 주고 고쳤으면 "정답 보고 고침"으로, 앎으로 치지 않는다

## 남은 것 (10/30)

- 5~7단계 대화형 수업, 투어를 실제 실행 흐름으로, 힌트 단계를 코드로 지키기, 어휘 묶는 단위, 프로젝트 지식으로 복습 문제

## 켜기·테스트

- `프로젝트코스 실험.cmd` (Node 22.13+, OpenCode는 Node 24+)
- `npm test` (이 폴더)
