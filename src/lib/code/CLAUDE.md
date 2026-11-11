# 코드 문제 (A)

백준 번호·주소·주제로 문제를 열고, AI가 만든 채점 테스트를 코드로 검증한 뒤, 학습자 PC에서 4개 언어로 채점한다. 결과는 문제에 걸린 지식의 기록으로 남는다. 자세한 흐름: `docs/코드문제_파이프라인.md`.

## 파일

- `source.ts`·`archive.ts`: 원문 가져오기 (백준은 2026-04 서비스 종료, 인터넷 아카이브 사본에서 가져온다. AI 없음)
- `../assist/code-ai.ts`: 문제 만들기. 원문이 있으면 4개 호출을 동시에(세팅·테스트 생성기·틀린 풀이·다른 모델의 독립 풀이)
- `testgen/`: 숨은 테스트 만들기·검증. AI가 쓴 생성기·검사기·풀이를 빈 환경의 별도 Node 프로세스에서 돌린다
- `run.ts`: 실행·채점 (Windows 작업 개체로 시간·메모리, `calibrate.ts`로 PC 속도 보정)
- `problems.ts`: 문제 파일·제출 기록(큰 숨은 입력은 생성기·시드로 다시 만듦, 11/9) · `service.ts`: 이번 풀이 모으기 (11/8부터 지식 저장소에 쓰지 않는다. 기억은 `tutor/`가 몰랐다가 배운 것만)
- 화면 `src/app/study/workspace/CodeStudy.tsx`, API `src/app/api/code/[[...path]]/route.ts`
- `grade.ts`: 필요한 능력 6단계 사다리 · `../assist/code-level.ts`: 난이도(AI가 알면 바로, 모르면 웹 검색) + 자체 판단 (11/8)
- `bakingdog.ts`: 튜터 문제 채우기(11/9부터 강의 풀이 없이 원문 → makeProblem, 바로 열기, 틀린 풀이에 교육용 모델의 틀린 접근)
- `tutor/`: PS 튜터 (11/8). `patterns.ts` 패턴 44개 · `profile.ts` 설문(모름/알아요/잘해요)·빠른 확인·분야 집중(11/11, `code/tutor/profile.json`) · `help.ts` 도움 네 칸(1 눈여겨볼 곳·2 방법 이름·3 계획은 모델에서, 4 뼈대 코드는 AI 1번 + 채점 검증, `code/tutor/skeletons.json`)과 연 칸 기록(11/11) · `problem-model.ts` 교육용 문제 모델(문제당 AI 1번, 코드 검사, 데이터 폴더 `code/tutor/models.json`, 11/10부터 필요할 때 조금씩·유저가 넣은 백준 문제도) · `state.ts` 사건 기록 → 인식·설계·실행 상태(E0~E4, 상자, 도움 수준) · `policy.ts` 다음 할 일 규칙 · `service.ts` · `lessons.ts` 배운 것 카드(정제) · `review.ts` PS 기억 복습 질문 · `journal.ts` 학습 관찰일지 + 풀이 일지(문제마다 한 장, 이번 주 한 줄) · `sheets.ts` 문제 한 장(끝날 때 코드 태그 + AI 1번, `code/tutor/sheets.jsonl`) · `memory.ts` 학습자 기억(태그 한 줄씩, 코드 계산) · `../find.ts` 문제 찾아오기(AI 웹 검색) · `simulate.test.ts` 가상 학습자 실험. 화면 `PsTutor.tsx`, API `src/app/api/code/tutor/`. 설계: DECISIONS 11/8

## 지켜야 하는 것

- 저장 조건: 원문 예제(없으면 단순 풀이와 작은 입력 30개 이상) + 독립 풀이가 모든 테스트에서 같은 답. 어긋나면 이유를 붙여 다시(최대 3번).
- 검사기(`check`)는 원문 예제를 통과해야 한다. 최대 크기 테스트가 모두 거부되면 실패.
- 정답 판정은 실행 결과 비교만. AI가 채점하지 않는다.
- 지식 이름: 이미 있는 이름(지식 검색 + 기존 코드 문제의 지식)을 넘겨 같은 뜻은 같은 이름으로.
- 답이 여러 개이거나 실수 오차를 허용하는 문제는 아직 채점하지 않아서 만들지 않는다.

## 실측 (10/30)

- 바로 열기 약 2초. 제출이 열리기까지: 쉬운 문제 15~23초, 복잡한 문제 45~50초 (테스트 생성기·틀린 풀이 출력이 길어서).
- 기록: 데이터 폴더 `code/make-log.jsonl`(단계별 시간), `assist-log.jsonl`(호출별 시간·토큰).

## 테스트

`node --experimental-strip-types --test src/lib/code/*.test.ts` (가짜 모델: `STUDY_FORGE_MODEL_PROVIDER=fake` + `setFakeModelResponder`, `make.test.ts`의 `withFake`)
