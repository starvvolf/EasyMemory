# C → B → A 프롬프트 비교 실험 (2026-11-04)

제품 소스나 학습 데이터를 바꾸지 않는다. 기존 모델 입구·출력 스키마·프롬프트 조립 함수를 재사용한다.

1. `node --experimental-strip-types lab/prompt-review/run.ts prepare`
2. `node --experimental-strip-types --test lab/prompt-review/run.test.ts`
3. 사용자에게 실제 호출 묶음 승인을 받은 뒤 `node --experimental-strip-types lab/prompt-review/run.ts live tmp/prompt-review-20261104 C --approved-36`
4. C 결과를 직접 읽고 같은 명령의 C를 B, A로 바꿔 순차 진행한다.

각 영역 3입력 × 기존/개선 × 2회 = 12회, 전체 최대 36회. 각 입력의 2회째는 개선안을 먼저 실행한다. 호출은 순차적이고 자동 재시도하지 않는다. 오류 시 즉시 멈춘다. 재개에는 오류 원인을 보고하고 사용자의 지시를 받는다. 성공한 비교는 다시 부르지 않는다.

- C: 기록에 남은 데드락·그래픽스·기업윤리 객관식 생성 입력, 현재 Q_CHOICE와 짧은 후보안 비교. luna medium 유지.
- B: 실제 makeExplanation 조립으로 조건 누락·관례 보존·삽입 명령 사례. terra low 유지.
- A: 실제 trainCheck 조립으로 다른 유효 풀이·틀린 모델·삽입 명령 사례. terra low 유지. 모범 풀이 일치 지시를 문제 조건 충족 지시로 바꾸는 후보이며 system과 단계 지시를 함께 비교한다.

결과는 git에 안 올리는 `tmp/prompt-review-20261104/`의 `trials.json`(실제 입력·기존/후보 지시·rubric), `results.jsonl`(답·시간·토큰·오류), `offline.json`(코드 재현)에 남는다. C 입력에는 강의 원문이 포함되므로 이 폴더를 공개 저장소에 올리지 않는다. 키는 기존 question-gen과 같은 로딩 방식으로 메모리에서만 사용한다.

품질은 rubric별 원문 대조로 직접 판단한다. JSON 파싱이나 길이 통과를 품질 통과로 세지 않는다. 비용은 토큰을 우선 비교하고 실제 청구액과 구분한다. 첫 글자는 onText 첫 콜백, 완료는 전체 요청 시간이다. 단일 호출 비교이므로 전체 PDF 생성 시간·품질 개선으로 일반화하지 않는다. 반복 2회는 탐색용이며 통계적 유의성을 주장하지 않는다.
