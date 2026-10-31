# 코드 문제 (A)

백준 번호·주소·주제로 문제를 열고, AI가 만든 채점 테스트를 코드로 검증한 뒤, 학습자 PC에서 4개 언어로 채점한다. 결과는 문제에 걸린 지식의 기록으로 남는다. 자세한 흐름: `docs/코드문제_파이프라인.md`.

## 파일

- `source.ts`·`archive.ts`: 원문 가져오기 (백준은 2026-04 서비스 종료, 인터넷 아카이브 사본에서 가져온다. AI 없음)
- `../assist/code-ai.ts`: 문제 만들기. 원문이 있으면 4개 호출을 동시에(세팅·테스트 생성기·틀린 풀이·다른 모델의 독립 풀이)
- `testgen/`: 숨은 테스트 만들기·검증. AI가 쓴 생성기·검사기·풀이를 빈 환경의 별도 Node 프로세스에서 돌린다
- `run.ts`: 실행·채점 (Windows 작업 개체로 시간·메모리, `calibrate.ts`로 PC 속도 보정)
- `problems.ts`: 문제 파일·제출 기록 · `service.ts`: 풀이 기록을 지식 저장소로 (`knowledge/api.ts`만 부른다)
- 화면 `src/app/study/workspace/CodeStudy.tsx`, API `src/app/api/code/[[...path]]/route.ts`

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
