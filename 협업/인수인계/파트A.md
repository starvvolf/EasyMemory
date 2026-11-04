# 인수인계 파트 A: 코드 문제 (PS)

먼저 `공통.md`. 원본: `스레드별/코드 공부 ↔ 지식쌓기 루트 설계.md`, `스레드별/AI 호출 비용·속도·품질 리서치.md`(A 항목).
기간 10/31~11/1, 브랜치 `claude/recaller2`.

## 1. 한 일

1. **설계**: PS ↔ 지식 저장소 양방향 루트. 지금 기능으로 되는 것과 새로 필요한 것을 나눴고, 루트별 실험 서버(`공통.md`)를 설계·구현했다.
2. **지켜보기**: 학습자가 멈추거나 막히거나 같은 곳을 계속 고치면 지금 코드를 예제와 가장 큰 숨은 테스트로 돌린다. 실행 결과에 문제가 없으면 모델에게 방향을 묻고, 문제가 있을 때만 편집기 위에 한 줄로 알린다. 문제당 최대 6번, 최소 3분 간격.
3. **모드 두 개**: 기본(그대로) / 훈련(7단계: 이해 → 추상화 → 탐색 → 정당성 → 복잡도 → 구현 → 복기).
4. **실험 서버** `lab/run-lab.mjs`, `lab/PS 실험 서버.cmd`(3003). 3003 로그인 칩 문제는 `STUDY_FORGE_AUTO_EXECUTOR=1`이 없어서였다(로그인 자체는 정상 저장).
5. **사용자 피드백 반영 (10/31 오후, 커밋 안 함)**
   - 훈련 단계는 오른쪽 칸 위, AI는 그 아래. 문제는 왼쪽 그대로.
   - 칸에서 다른 곳을 누르면 그 칸만 채점(✓ / "✗ 틀렸어요").
     - 앱이 확인: N의 최대, 시간 제한, 손으로 구한 답, 복잡도, 정당성 입력, 구현 경계 입력
     - AI가 확인: 출력 한 줄, 추상화, 탐색 ①②③, "왜 항상 맞나". 바뀐 칸만, 칸 하나에 호출 1번.
   - 구현 단계 전 AI 칸은 "훈련 코치": 힌트·반례 버튼 대신 예시 질문 3개를 입력창 위에. 답·코드는 주지 않음. 구현 단계부터 원래 버튼.
   - 훈련 모드는 단계마다 채팅이 따로(화면에만, 새로고침하면 사라짐).
6. **모델 기본값 (리서치 스레드)**: `src/lib/assist/code-ai.ts`
   - 독립 풀이 `code:solve`(`SOLVE_MODEL`) → gpt-6.1-sol (출제 terra와 다른 모델). 되돌림 `RECALLER_CODE_SOLVE_MODEL`
   - 문제 세팅 `code:make`(`MAKE_EFFORT`) → low (모델 terra 그대로). 되돌림 `RECALLER_CODE_MAKE_EFFORT`, 모델 `RECALLER_CODE_MAKE_MODEL`

## 2. 결정된 것 (`docs/DECISIONS.md` 10/31 "코드 문제: 훈련 모드 · 지켜보기 · 루트별 실험 서버"에 기록됨)

- 훈련 모드·지켜보기는 **실험 서버에서만** 켜진다(`RECALLER_PS_TRAIN=1`, `RECALLER_PS_WATCH=1`). 스위치가 꺼져 있으면 API 404. 3000 코드 화면은 그대로.
- 지식의 "앎"은 힌트 없이 통과했을 때만. 훈련 모드 통과 → note "훈련 모드로 통과", 지켜보기 경고 뒤 통과 → note "지켜보기 조언 n번 받고 통과", 복기 저장 → knowledgeIds마다 note "[복기] 핵심 발상 · 막힌 이유 · 다른 문제에도".
- 코치 AI는 모범 풀이를 보고 판단하되, 답에 모범 풀이의 18자 이상 줄이 들어 있으면 중립 질문으로 바꾼다(`leaks()`).

## 3. 파일과 커밋

| 파일 | 내용 |
|---|---|
| `src/lib/code/train.ts` (새) | psLab 스위치, 단계 저장(`<data>/code/train/<id>.json`), numbersIn, checkUnderstand, 복잡도(1e8회/초 기준 넉넉·아슬·안 됨), tryInputs, quickCheck(숨은 테스트 비공개) |
| `src/lib/code/train.test.ts` (새) | 테스트 8개 |
| `src/lib/assist/code-ai.ts` | COACH·leaks, trainCheck(`field`), trainAsk, watchAdvice, trainReview |
| `src/lib/code/service.ts` | submitAndRecord에 advice·note 규칙, saveReview |
| `src/app/api/code/[[...path]]/route.ts` | `GET lab`, `problem/:id/watch/*`, `problem/:id/train/*`(mode·understand·complexity·inputs·check·ask·step·review-draft·review) |
| `src/app/study/workspace/CodeTrain.tsx` (새) | ModeSwitch, TrainPanel, useFieldCheck·useOneInput, useWatch·WatchStrip, STEP_LABEL·COACH_ASKS |
| `CodeStudy.tsx`, `workspace.css` | 연결·배치·코치 모드·단계별 채팅, cs-train·cs-tr-*·cs-watch·cs-ai.training |
| `lab/run-lab.mjs`, `lab/PS 실험 서버.cmd`(CRLF) (새) | 실험 서버 |
| `next.config.ts` [경계], `.gitignore` | `tsconfigPath: RECALLER_NEXT_TSCONFIG` 우선, `/.next-lab-*/`·`/tsconfig.lab-*.json` |

커밋(push됨): `8aa4734` 훈련 모드·지켜보기·루트별 실험 서버 [경계], `b4567d3` 실험 서버 STUDY_FORGE_AUTO_EXECUTOR=1. 모델 기본값은 공통 커밋 `f85a1c2`.

## 4. 남은 일

1. **커밋 안 된 피드백 반영분**: `route.ts`(code), `CodeStudy.tsx`, `CodeTrain.tsx`, `workspace.css`, `code-ai.ts`. eslint·tsc·테스트 8개 통과, 화면은 직접 못 띄움. 사용자가 3003에서 써 보고 괜찮다고 하면 커밋.
2. 3003에서 실제로 풀어 보며 조정(근거 `tmp\lab-ps.log`, 사용자 피드백).
3. 독립 풀이 gpt-6.1-sol은 5문제 비교 실측 전. 첫 시도 통과·독립 풀이 일치가 떨어지면 되돌린다.
4. 다음 단계(사용자 결정 필요, 시작 안 함): N4 지식에서 문제 고르기(지식 → PS), N3 실수 유형 지식, N5·N6 화면 영향 항목. B가 `attachQuestions`를 더하면 연동.
5. 본 앱 합치기는 실험 뒤 사용자가 결정(합치면 3000에서도 스위치 켜기).
6. (우선순위 정리) 문제 만드는 중 진행 단계 보이기(2시간, 지금은 2~5분 "만드는 중"만), 실패한 단계만 다시 하기(3시간).

## 5. 주의점

- 칸별 AI 채점·코치 채팅은 칸·질문마다 ChatGPT 1번. 같은 내용은 다시 보내지 않는다.
- 다른 스레드 파일(`experiments/project-course/*`, `ProjectStudy.tsx`, `src/lib/study/gen/*`)은 A 커밋에 섞지 않는다.
- B에 알림: "동적 계획법 / 다이나믹 프로그래밍" 같은 기존 중복은 "같은 지식 의심"에 쌓여 있다(현황판).
