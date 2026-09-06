# Prepare Terra 간결화 실험 평가 설계

## 한 문장 목표

Prepare가 **선택된 목차를 문제 하나 크기의 학습 단위로 정확히 보존하는 핵심 역할**에 집중하도록 줄이고, Terra가 만든 결과로도 기존 Sol 결과와 동등한 수준의 실제 문제가 나오는지 확인한다.

이 실험의 목적은 Sol 문장을 그대로 흉내 내는 것이 아니다. Sol도 틀릴 수 있으므로, 같은 입력에서 학습 범위·원문·학습 행동·후속 문제 품질을 독립적으로 판정한다.

## 지금 확인된 문제

현재 Prepare 한 번에 다음 일을 모두 요구한다.

1. 선택된 목차와 원문 보존
2. 문제 하나 크기의 학습 단위 확정
3. 재사용 가능한 표현 일반화
4. 학습 대상·행동·성공 기준 결정
5. 자료 종류·지식 종류·추천 전략·선정 이유 작성

Terra는 OPIc 10개, DFS/BFS 9개, 데드락 16개의 범위와 원문을 모두 보존했다. 흔들린 부분은 주로 `operation`이었다. 즉 자료를 못 읽은 것이 아니라, 핵심 판단과 설명용 분류를 한꺼번에 하면서 학습 행동의 수준이 달라졌다.

기존 비교에서 발견된 행동 차이는 다음과 같다.

- OPIc: 2개 (`strategy-grammar`, `strategy-keywords`)
- DFS/BFS: 2개 (`graph-basics`, `graph-representations`)
- 데드락: 3개 (`rag-edge-semantics`, `banker-algorithm-scope`, `detection`)

이 차이는 자동으로 Terra 실패라고 판정하지 않는다. 예를 들어 Sol의 분류가 부적절할 수도 있기 때문이다. 실제 학습 목표와 만들어진 문제를 보고 판정한다.

## 고정 입력

모든 후보는 Analyze와 Plan을 다시 호출하지 않고 아래 결과를 그대로 사용한다. PDF도 다시 보내지 않고 Plan이 보존한 선택 목차와 원문 근거만 사용한다.

| 자료 | 고정 Plan | Sol 기준 | 현재 Terra 기준 |
|---|---|---|---|
| OPIc | `eval/local/plan-prepare-v1/opic-current-outline-attempt-1.json` | `opic-evidence-only-attempt-1.json` | `model-test-prepare-terra-opic-r1.json` |
| DFS/BFS | `eval/local/plan-prepare-v1/dfs-bfs-current-outline-attempt-1.json` | `dfs-bfs-evidence-only-attempt-1.json` | `model-test-prepare-terra-dfs-bfs-r1.json` |
| 데드락 | `eval/local/plan-prepare-v1/deadlocks-current-outline-attempt-2.json` | `model-test-prepare-sol-deadlock-r1.json` | `model-test-prepare-terra-deadlock-r1.json` |

고정 조건:

- Prepare 모델: `gpt-5.6-terra`
- 추론 강도: `medium`
- 선택 목차 ID와 원문 근거: 고정
- 학습 목표와 사용자 지시: 고정 artifact의 값을 그대로 사용
- Critic: 비활성
- 후보마다 새 파일에 저장하고 기존 결과를 덮어쓰지 않음

1차 세 자료가 통과한 뒤에만 범용성 확인용으로 권리장전, 미적분, 달의 위상, 재난 체크리스트, 고등학교 사회, 고등학교 과학을 사용한다.

## 비교할 후보

### V0. 현재 Terra

현재 프롬프트와 스키마를 그대로 사용한다. 이미 만들어진 결과가 비교 기준이다.

### V1. 간결한 한 번 호출 — 첫 번째 추천

핵심 지시는 아래 네 가지로 제한한다.

```text
1. 선택된 최종 목차마다 학습단위 하나를 만든다. 합치거나 다시 나누지 않는다.
2. 그 단위에서 문제의 정답 근거가 될 내용을 원문에 충실하게 보존한다.
3. 무엇을 익혀야 하는지와 무엇을 하면 성공인지 각각 한 문장으로 적는다.
4. 학습 행동 하나를 고른다. 실제 문제는 아직 만들지 않는다.
```

행동 선택 기준도 다음 네 문장만 남긴다.

```text
Recall: 배운 대상 자체를 말하거나 적는다.
Reconstruct: 배운 고정 구조·관계·순서를 원래 구조로 복원한다.
Discriminate: 주어진 조건에서 맞는 것을 판별한다.
Apply: 새로운 입력에 규칙을 사용해 입력에 따라 달라지는 결과를 만든다.
```

기존 출력 계약은 첫 실험에서 바꾸지 않는다. 설명·호환 필드는 짧게 쓰게 하되 핵심 판단을 방해하지 않도록 뒤에 둔다.

### V2. 핵심 출력과 호환용 값 분리 — V1 통과 후 선택 실험

AI가 직접 판단할 핵심:

```text
목차 ID
정답 근거가 될 최종 내용
학습 대상
학습 행동
성공 기준
```

Plan 또는 코드가 그대로 복사할 값:

```text
sourceId / sourcePage / sourceRange
detectedGoal
```

현재 화면·옛 결과와의 호환 때문에 남아 있는 값:

```text
sourceType / keyTopics / recommendedStrategy / extractedMaterial
primaryKnowledgeType / knowledgeType / rationale
fixedPart / variableSlots
```

단, OPIc 같은 패턴의 일반화 결과는 핵심 내용이다. `generalizedForm`을 무조건 제거하지 않고, 장기적으로 이름을 `finalContent`처럼 더 직접적인 값으로 합칠 수 있는지만 실험한다. 이 후보는 공용 계약을 바꾸지 않는 별도 변환 실험으로 먼저 확인한다.

### V3. 내용 확정과 행동 판단을 두 단계로 분리 — V1이 같은 이유로 두 번 실패할 때만

```text
1차: 목차 ID + 원문 근거 + 학습 대상 + 성공 기준
2차: 학습 대상과 성공 기준을 보고 operation만 선택
```

장점은 Terra가 한 번에 판단할 일이 줄어든다는 것이다. 단점은 호출이 늘고 두 결과가 어긋날 수 있다는 것이다. 따라서 처음부터 도입하지 않는다.

## 자동 검사

후보 Prepare 직후, API 추가 호출 없이 다음을 검사한다.

### 즉시 탈락 조건

- 선택된 최종 목차 ID가 하나라도 사라지거나 새 ID가 생김
- ID 중복
- `sourceText`, `target`, `operation`, `successCriterion` 중 하나라도 비어 있음
- 허용되지 않은 operation
- 목차 하나를 다시 합치거나 나누어 LearningUnit 수가 달라짐
- 원문의 고유 수치·공식·영어 패턴·조건이 누락되거나 변경됨
- 자료에 없는 사실을 정답 근거로 추가함

앞의 다섯 조건은 기계 검사한다. 마지막 두 조건은 자료별 고정 핵심 목록과 교사 검사를 함께 사용한다. 문자열 길이 차이는 검토 신호일 뿐 탈락 조건으로 쓰지 않는다.

### 후속 문제 검사

Prepare가 통과한 후보만 기존 Terra Activity Design과 Cards에 연결한다.

- LearningUnit : 설계 : 문제 = 1 : 1 : 1
- 문제 수와 ID 일치
- 기계 검사 오류 0
- 앞면에 정답이 의도치 않게 노출되지 않음
- 정답이 원문 또는 확정된 새 입력 계산으로 검증됨
- 적용 목표가 정의 암기로 낮아지지 않음
- 구조복원이 단순 문장 조각 나열로 변하지 않음
- OPIc 영어 패턴과 변수 자리가 유지됨
- 계산·그래프 정답은 별도 수작업 또는 코드로 재검산

## 교사 검사

모델 이름과 후보 이름을 가리고 각 자료의 Sol 기준, V0 Terra, 새 후보를 섞어서 본다. 각 항목은 0점(실패), 1점(부분 충족), 2점(충족)으로 평가한다.

| 항목 | 교사가 보는 질문 |
|---|---|
| 범위 | 선택한 목차의 배울 내용이 빠짐없이 남았는가? |
| 충실성 | 수치·공식·관계·영어 표현이 원문과 같은가? |
| 단위 크기 | 문제 하나로 묻기에 너무 크거나 잘게 쪼개지지 않았는가? |
| 행동 | 이 자료에서 실제로 시켜야 할 Recall/Reconstruct/Discriminate/Apply인가? |
| 정렬 | target, operation, successCriterion과 실제 문제가 같은 행동을 요구하는가? |
| 문제 품질 | 학생이 손으로 풀 만한 자연스러운 문제이며 정답이 명확한가? |

합격선:

- 각 자료 12점 만점 중 10점 이상
- `범위`, `충실성`, `정렬`은 반드시 2점
- 사실 오류, 정답 오류, 학습 범위 누락은 1건만 있어도 탈락
- Sol보다 문장이 다르다는 이유만으로 감점하지 않음

## 동일 실패 2회 중단

실패를 다음 세 부분으로 기록한다.

```text
자료 + 실패 범주 + 영향을 받은 학습 목표
```

예:

```text
OPIc + operation 하향 + 3인칭 문법을 새 문장에 적용
```

같은 후보에서 위 세 부분이 같은 실패가 두 번 나오면 그 후보 실험을 중단한다. 프롬프트 문구만 바꾸어 같은 오류를 반복해도 두 번째 실패로 계산한다. 이후에는 예외 문구를 추가하지 않고 다음 구조 후보(V2 또는 V3)로 넘어간다.

API 연결 실패, 크레딧 부족, 파일 권한 문제는 품질 실패 횟수에 포함하지 않는다. 다만 원인 확인 없이 같은 호출을 반복하지 않는다.

## 오프라인 수치 결과

`offline-audit.mjs`로 API 0회 검사를 실행했다.

- 비교: OPIc·DFS/BFS·데드락의 Sol/Terra 3쌍
- 범용성 참고: 권리장전·미적분·달의 위상·재난 체크리스트·사회·과학 6종
- 중복을 포함한 전체 결과 파일: 12개
- 고정 ID 보존: 세 비교 모두 통과
- 새 Terra 결과의 중복 ID와 필수값 누락: 0건
- 현재 전체 Analysis JSON에서 Activity에 필요한 핵심 모양만 남겼을 때 크기 감소: 합계 약 62.1%

12개 결과에서 LearningUnit 필드가 차지한 누적 크기 중 큰 항목은 다음과 같다.

| 필드 | 누적 크기 | 판단 |
|---|---:|---|
| `sourceText` | 39,697 bytes | 핵심 원문 근거, 유지 |
| `rationale` | 21,621 bytes | 설명·검토용, 간결화 우선 후보 |
| `successCriterion` | 16,184 bytes | 핵심, 유지 |
| `generalizedForm` | 12,365 bytes | 패턴 자료에서는 핵심, `finalContent`와 통합 검토 |
| `target` | 10,977 bytes | 핵심, 유지 |
| `sourceRange` | 10,946 bytes | 출처 추적, Plan에서 복사 가능 |
| `variableSlots` | 8,991 bytes | 패턴 외 자료에서는 중복 가능성 큼 |
| `fixedPart` | 7,269 bytes | `generalizedForm`과 중복 가능성 큼 |
| `knowledgeType` | 3,373 bytes | 현재 문제 설계 입력에는 쓰이지 않는 호환·표시용 값 |

`rationale + fixedPart + variableSlots + knowledgeType`만 합쳐도 41,254 bytes다. 하지만 현재 덱 상세 화면이 `rationale`, `knowledgeType`, `recommendedStrategy`, `extractedMaterial`을 표시하므로 바로 삭제해서는 안 된다. 먼저 AI 핵심 판단에서 분리하거나 짧게 만드는 실험을 하고, 화면 변경은 별도 제품 결정으로 남긴다.

## 실행 순서

1. V1 프롬프트를 실험용 경로에만 작성한다.
2. OPIc·DFS/BFS·데드락을 같은 고정 입력으로 한 번씩 실행한다.
3. 자동 검사 후 통과한 결과만 Activity/Cards까지 연결한다.
4. 가린 상태의 교사 검사와 정답 재검산을 한다.
5. 세 자료가 모두 합격하면 다양한 6종 중 성격이 다른 자료를 차례로 확인한다.
6. V1이 같은 이유로 두 번 실패할 때만 V2, 그래도 행동 판단이 흔들릴 때만 V3를 시험한다.
7. 모든 기준을 통과하기 전에는 프로덕션 Prepare 모델이나 계약을 바꾸지 않는다.

## 이번 단계에서 하지 않는 것

- OPIc, DFS/BFS, 데드락 전용 예외 규칙 추가
- LearningUnit 계약 변경
- 프로덕션 모델 변경
- UI와 저장 데이터 변경
- Sol 결과를 무조건 정답으로 간주

오프라인 원자료는 `offline-audit.json`, 재실행 도구는 `offline-audit.mjs`에 있다.
