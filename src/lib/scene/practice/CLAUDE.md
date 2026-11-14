# 상황 재현 · 실습 갈래 (D, 11/15)

설계: `docs/상황재현_설계_v2(+gpt).md`의 실습 칸(1 · 3 · 4 · 5 · 7 · 8번). 바닥(`src/lib/scene/`, A)은 `index.ts`의 함수만 부른다. 이 폴더 밖 바닥 파일은 고치지 않는다(읽기 · 가져다 쓰기만: `check.ts` · `grade.ts` · `exec.ts` · `ladder.ts` · `store.ts newId` · `types.ts`).

## 흐름

1. **빈틈**: 실습 서버의 목표 정리 글(`# 기록용` 카드)이 같은 호출에서 종류 · 확인할 것 · 주제 · 알맹이(코드 블록) · 가정을 같이 쓴다(AI 호출 안 늘림). 실습 서버가 원장(`.data/gaps`)의 `scene` 칸에 넣고 알맹이를 코드로 검사(자바스크립트 = 문법 + 권한 모드로 돌려 봄, 파이썬 = 문법, C# · C++ · 명령 = 괄호 모양). `practiceGaps()`가 `GET /api/scene/gaps`(실습 서버)를 읽어 바닥의 `Gap`으로(`gaps.ts toGap`: id는 늘 같음 `gap_` + sha1(runId:원장 id), 범위 · 세기는 `ladder.ts scopeOf · doseOf`, 처음 상태 `firstState`). 실습 서버가 꺼져 있으면 빈 목록.
   - 그때 생각이 틀렸다는 증거(wrongVerified): 판정이 틀림 · 다시 확인에서 또 틀림 · 학습자 코드가 틀렸다 고쳐짐 · (표현) "문법으로 못 옮김"을 고름. 없으면 같은 실수를 내지 않는다.
   - 알맹이 문법이 틀린 칸은 알맹이를 비워서 보낸다.
2. **고르기** `practiceFormats(gap, {siblings, projectTried})` (`formats.ts`): 똑같이 + 저장본 위치 → 17 먼저. 순서 · 동시성 → 14 · 13 (응용 확인 준비되면 16 맨 앞). 실행 · 도구 → 15 · 1 · 11. 문법 → 1 · 2. 그 밖은 4번 표 공통 줄. 맨 끝은 늘 12(why).
   - 16 준비 규칙 `projectReady`: 응용 거리 · passes ≥ 2 · 같은 주제의 다른 실습 빈틈 모두 한 번 이상 통과 · 이 빈틈에서 아직 안 냄(한 번만).
3. **만들기** `makePracticeScene(gap, format, {ask})` — 검사까지 끝난 장면(저장은 바닥이), 못 만들면 null.
   - 14 `timeline.ts`: AI 0번(상황 은행: 체력 · 탄약 · 재고 · 잔액 · 점수 · 조회수). 비슷하게 = 그 실습 코드의 이름과 같은 상황, 응용 = 다른 상황.
   - 13 `where.ts`: AI 1번(`prompts.ts WHERE_SYSTEM`), 떨어지면 한 번 더, 또 떨어지면 은행(8번 탄약 예, js · python · csharp).
   - 15 `command.ts`: AI 1번(`COMMAND_SYSTEM`), 물러나면 은행("서버만 실행하기").
   - 1 `lock.ts`: 잠금 빈틈만 은행(8번 C# lock 예 + js · python). 나머지 한 줄 쓰기 · 결과 맞히기 · 오류 읽기는 바닥 AI 장면 — 재료는 `practiceMaterial(gap)`(목표 · 그때 파일과 줄 · 그때 기록 · 언어).
   - 16 · 17: 실습 서버 `POST /api/scene/project` · `POST /api/scene/origin`(폴더 `<실습 데이터>/scenes/<id>/`, 아래 실습 서버 문서).
   - 12: 실습 "다시 확인" 문항(`GET /api/rechecks?all=1`). `practiceWhy(gap)`로 다른 형식 통과 뒤 덧붙이는 질문에도.
4. **검사 · 채점**(`checkPracticeScene` · `gradePracticeScene`): 정답 · 오답 모양은 돌려서.
   - 14: 그 순서대로 흉내 내기(진짜 스레드 없음, 매번 같음). ①값 · ②사라지는 순서 둘 다 맞으면 통과, 하나라도 "하나씩 처리한 값"이면 같은 실수, 규칙 어김은 미확정.
   - 13: 고른 범위에 감싸 넣고(`insertGuard`, 한 칸 더 들여 씀) 채점기로 돌림(`../exec.ts runAll` = 알고리즘 채점기, C#은 사용자 PC의 dotnet · csc). 준비 코드는 읽기와 쓰기 사이에 일부러 쉬어서 안 넣으면 늘 어긋남(두 번 돌려 같은지 봄). 능력 확인이면 고를 수 있는 줄 전체를 바꾼 코드(예: Interlocked)도 통과. 같은 실수 = 범위 모양(빈 줄 · 괄호 줄 뺌)이 그때 범위와 같음.
   - 15: 모양 비교(프로그램 이름 · 옵션 순서 · 별칭 · `--a=b` · 경로 · `cd X &&`). 예제 폴더가 있고 node · python · dotnet이면 임시 폴더에서 셸 없이 돌려 출력 비교.
   - 1(잠금): 바닥 `gradeScene` + 구조 검사(`structure.must`) — 출력이 맞아도 그 표현이 아니면 미확정.
   - 16 · 17: 실습 서버 `POST /api/scene/<id>/grade`. 12: 실습 서버 `POST /api/rechecks/<run>/<gap>`(기존 채점 · 원장 상태 갱신 그대로).
5. **화면**: `practicePublic(scene)` → `src/app/study/workspace/scene/PracticeScene.tsx` `PracticeBody`. 답은 글 하나: where `{"from","to"}` 또는 `{"code"}` · timeline `{"final","order"}` · command 명령 · project/origin `{"done":true}` · why 글. 16 · 17의 [편집기 열기]는 앱 `/api/project-course/scene/<id>/open` → 실습 서버 `studio.html?scene=<id>`(앱 안 편집기, 원래 실습 폴더는 안 엶). 기억 탭 실습 정리용 `PracticeGapList({runId})`(앱 `/api/project-course/scene-gaps?run=`, 바닥 저장소를 읽기만).

## 시험

`practice.test.ts`(루트 `npm test`): 흉내 내기 · 넣고 돌리기(js · python 실제 실행) · 잠금 한 줄 쓰기 · 명령 모양 · 실제 실행 · 고르기 · 빈틈 옮기기. 실습 서버 쪽은 `experiments/project-course/test/scene.test.ts`. C#은 이 컨테이너에 dotnet이 없어 구조 · 프로그램 모양만 본다(사용자 PC에서는 같은 길로 실제로 돈다).

## 지켜야 하는 것

- AI가 정답 · 오답 값을 쓰지 않는다. 동시성은 진짜 스레드로 채점하지 않는다(14는 흉내, 13 · 1 · 16은 일부러 쉬는 준비 코드로 늘 어긋나게, 두 번 돌려 같아야 통과).
- 화면에 보낼 것(`practicePublic`)에 모범 범위 · 그때 범위 · 정답 값 · 모범 고침을 넣지 않는다.
- 16 · 17 폴더는 실습 서버 데이터 아래 `scenes/<id>/`에만. 원래 실습 작업 폴더는 읽기만.
