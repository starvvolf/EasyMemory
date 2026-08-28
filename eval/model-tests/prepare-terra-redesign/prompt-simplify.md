# Prepare Terra 전환안 A: 단일 호출 프롬프트 간결화

## 한 줄 결론

Prepare가 새 학습 설계를 다시 하지 않게 하고, **Plan에서 확정한 최종 목차 하나를 근거가 보존된 LearningUnit 하나로 옮기는 일**에 집중시킨다.

이 안은 프로덕션 코드를 바꾸지 않은 설계 초안이다. 실제 적용 전에는 같은 고정 Plan으로 Sol 기준 결과와 Terra 결과를 비교해야 한다.

## 현재

`runAnalysis`는 다음 순서로 동작한다.

1. `studyGuideline`에서 선택된 최종 목차 ID를 구한다.
2. 선택 목차마다 `sourceEvidence`가 있고 `sourceText`도 있으면 PDF를 다시 보내지 않는다.
3. OpenAI에 자료, 사전 분석, 학습 가이드와 40개가 넘는 세부 지시를 함께 보낸다.
4. `LearningUnit`을 포함한 분석 JSON을 받는다.
5. 코드에서 선택 목차 ID와 LearningUnit ID가 정확히 일치하는지 검사한다.

현재 좋은 핵심은 이미 코드에 있다.

- 선택된 최종 목차 하나 → LearningUnit 하나
- PDF 대신 Plan이 보존한 근거를 재사용할 수 있음
- 반환 ID가 다르면 즉시 실패
- 출력 개수가 안전선을 넘으면 즉시 실패

## 문제

현재 프롬프트에는 서로 다른 시기의 역할이 한꺼번에 남아 있다.

- 최종 목차를 다시 합치거나 쪼개지 말라는 지시
- 독립적으로 평가할 수 있으면 LearningUnit을 나누라는 지시
- 최소 학습 단위를 새로 추출하라는 지시
- 이미 확정된 목차마다 정확히 하나를 만들라는 지시
- `operation`을 정하라는 핵심 지시
- 자료 유형, 지식 유형, 일반화, 추천 전략, 선정 이유를 함께 정하라는 부수 지시

특히 선택 목차가 있는 현재 제품 흐름에서는 아래 두 지시가 정면으로 충돌한다.

```text
선택된 최종 목차를 다시 쪼개거나 합치지 않는다.
vs
독립적으로 성공·실패할 수 있으면 별도 LearningUnit으로 나눈다.
```

목차 크기는 이미 Plan이 정했다. Prepare가 다시 크기를 판단할 이유가 없다. 이 판단을 남겨두면 Terra는 `target`을 새로 설계하면서 목차가 의도한 행동까지 더 어렵거나 더 쉽게 바꿀 수 있다.

실험에서 보인 흔들림도 같은 원인으로 설명된다.

- 개념 여러 개가 관계를 이룬다는 이유만으로 단순 설명을 `reconstruct`로 올림
- 비교 자료라는 이유만으로 자료에 없던 새 상황 선택 과제를 만들어 `apply`로 올림
- 실제 사용 목표가 있어도 근거 문장이 규칙 설명형이면 `recall`로 낮춤
- 조건과 결과가 적혀 있다는 이유만으로 단순 적용 범위 지식을 `apply`로 올림

이는 특정 과목의 문제가 아니다. **근거 문장의 겉모양을 보고 행동을 새로 발명하고, Plan이 정한 학습 의도를 덮어쓴 문제**다.

## 변경

### 1. 입력을 하나의 확정 정보 묶음으로 정리한다

현재 호출에서 이미 얻을 수 있는 정보만 사용한다. 새 데이터 계층은 만들지 않는다.

필수 입력:

```text
자료 제목·과목
전체 학습 목표
사용자 추가 지시
선택된 최종 목차[]
  - id
  - title
  - summary
  - sourceRefs
  - sourceEvidence
```

선택 목차의 근거가 완전할 때는 다음 중복을 보내지 않는 것이 이상적이다.

- 전체 `analysisContext`
- 선택되지 않은 목차와 부모 목차 전체
- `areas`, `exclusions`, soft budget 설명 전체
- 같은 근거가 반복된 `sourceText`
- PDF 원본

단, 이것은 프롬프트 실험이 통과한 뒤 입력 구성 코드에서 별도로 확인할 사항이다. 첫 프롬프트 비교에서는 기존 입력을 그대로 두고 지시문만 줄여 원인을 격리해도 된다.

선택 목차 근거가 불완전한 경우에만 기존처럼 PDF 또는 원문을 함께 보내고, 그 범위의 근거를 보강한다.

### 2. 한 호출 안에서 핵심 판단과 호환용 메타데이터를 순서상 분리한다

API 호출을 두 번으로 늘리지 않는다. 모델이 생각할 우선순위만 나눈다.

```text
먼저: 원문 근거 → target → operation → successCriterion
나중: 기존 저장 형식 때문에 필요한 sourceType, knowledgeType, 일반화 필드
```

`sourceType`, `knowledgeType`, `recommendedStrategy`, `rationale`은 출력 스키마 호환을 위해 유지하되 학습 행동을 결정하는 근거로 쓰지 않는다.

### 3. operation은 새로 설계하지 않고 확정된 의도에서 상속한다

판단 우선순위는 다음 하나로 고정한다.

```text
전체 학습 목표
→ 선택 목차의 title·summary
→ sourceEvidence
```

앞 단계가 정한 과제를 뒤의 근거 문장 모양만 보고 더 어렵거나 더 쉬운 과제로 바꾸지 않는다.

operation 판단은 아래 네 문장만 사용한다.

- `recall`: 배운 대상 자체를 자료 없이 말하거나 적는다.
- `reconstruct`: 배운 고정 구조·관계·순서 전체를 같은 구조로 복원한다.
- `discriminate`: 주어진 항목이나 조건에서 맞는 것·해당하는 것을 고르거나 판별한다.
- `apply`: 새로운 입력을 계산·변환·구성하여 입력에 따라 달라지는 새 결과를 만든다.

추가 안전 기준:

- 여러 사실을 함께 설명한다고 자동으로 `reconstruct`가 되지 않는다.
- 조건문이 들어 있다고 자동으로 `discriminate`나 `apply`가 되지 않는다.
- `apply`는 새 입력과 그 입력에 따라 달라지는 결과가 **학습 목표 또는 선택 목차에 이미 요구되어 있을 때만** 쓴다.
- 원문에 없는 새 상황, 계산, 선택 과제를 만들어 operation을 높이지 않는다.
- target, operation, successCriterion은 같은 행동을 가리켜야 한다.

## 최소 프롬프트 초안

### System

```text
당신은 Plan에서 확정된 최종 목차를 문제 생성 전의 LearningUnit으로 옮깁니다.
학습 범위나 문제를 새로 설계하지 말고, 확정된 의도와 원문 근거를 보존한 한국어 JSON만 반환하세요.
```

### User

```text
[자료]
제목: {title}
과목: {subject}
전체 학습 목표: {learningGoal}
사용자 추가 지시: {instruction_or_none}

[선택된 최종 목차]
{selected_leaf_nodes_with_id_title_summary_source_refs_source_evidence}

[해야 할 일]
1. 선택된 최종 목차마다 LearningUnit을 정확히 하나 만드세요.
   - id는 목차 id를 그대로 사용합니다.
   - 합치거나 쪼개거나 부모 목차를 추가하지 않습니다.

2. sourceText에는 sourceEvidence의 문장, 수치, 공식, 관계와 원문 표현을 바꾸지 말고 보존하세요.
   sourceId, sourcePage, sourceRange는 sourceRefs와 근거 위치로 채우세요.
   근거가 불완전해 원문/PDF가 제공된 경우에만 같은 범위 안에서 보강하세요.

3. 각 LearningUnit의 핵심 세 필드를 먼저 정하세요.
   - target: 이 목차에서 학습자가 익힐 대상을 구체적인 한 문장으로 씁니다.
   - operation: 전체 학습 목표와 목차 title·summary가 실제로 요구한 주 행동 하나를 고릅니다.
   - successCriterion: target을 배웠는지 관찰할 수 있는 같은 행동 한 문장으로 씁니다.

4. operation 기준:
   - recall: 배운 대상 자체를 자료 없이 말하거나 적기
   - reconstruct: 배운 고정 구조·관계·순서 전체를 같은 구조로 복원하기
   - discriminate: 주어진 항목·조건에서 맞는 것 또는 해당 대상을 고르거나 판별하기
   - apply: 새로운 입력을 계산·변환·구성하여 입력에 따라 달라지는 새 결과 만들기

   여러 사실을 설명한다고 reconstruct가 되는 것은 아닙니다.
   조건문이 있다고 discriminate나 apply가 되는 것도 아닙니다.
   apply는 새 입력과 달라지는 결과가 학습 목표 또는 목차에 이미 요구된 경우에만 사용하세요.
   원문에 없는 더 어려운 과제나 더 쉬운 암기 과제로 바꾸지 마세요.

5. 기존 출력 호환 필드를 채우세요.
   - 반복 사용 가능한 표현만 fixedPart, variableSlots, generalizedForm으로 일반화합니다.
   - 일반화가 필요 없으면 fixedPart와 generalizedForm은 빈 문자열, variableSlots는 빈 배열입니다.
   - sourceType, knowledgeType, primaryKnowledgeType은 내용 설명용 분류일 뿐 operation 결정에 사용하지 않습니다.
   - rationale은 이 목차의 target과 operation을 정한 근거를 짧게 씁니다.
   - extractedMaterial은 LearningUnit별 sourceText를 확인하기 위한 짧은 목록입니다.
   - recommendedStrategy는 전체 학습 목표와 operation을 요약한 한 문장입니다.

6. 이 단계에서는 질문, 정답, 보기, 카드, 빈칸을 만들지 마세요.
   근거에 없는 사실을 추가하지 마세요.

반환 JSON은 제공된 스키마를 정확히 따르세요.
```

## 출력 계약

기존 `runAnalysis`의 JSON Schema와 `analysisSchema`를 그대로 유지한다.

전체 출력:

```text
detectedGoal
sourceType
keyTopics[]
recommendedStrategy
extractedMaterial
primaryKnowledgeType
learningUnits[]
```

LearningUnit 출력:

```text
id
sourceId
sourcePage
sourceRange
sourceText
knowledgeType
fixedPart
variableSlots[]
generalizedForm
target
operation
successCriterion
rationale
```

핵심 품질 필드는 다음 여섯 개다.

```text
id
sourceText
target
operation
successCriterion
source 위치
```

나머지는 이번 Terra 전환에서 품질 합격을 결정하는 주 기준이 아니라 기존 저장·화면 호환 필드로 본다.

## 삭제하거나 합칠 지시

선택 목차가 있는 현재 제품 경로에서는 다음 지시를 제거한다.

- 최소하고 독립적인 LearningUnit을 새로 추출하라는 지시
- 따로 맞고 틀릴 수 있으면 LearningUnit을 나누라는 반복 지시
- 긴 장을 한 번에 재현하지 말고 다시 분할하라는 지시
- 단위 개수와 soft budget을 조절하라는 지시
- selectedGroup의 itemCount를 참고하라는 지시
- 대표 예시와 인출 방식을 후속 단계에서 처리한다는 중복 설명
- 문제·카드·Cue·Target을 만들지 말라는 여러 중복 문장
- 자료 유형 및 지식 유형에 관한 여러 경고 문장

다음 지시는 한 번만 남긴다.

- 선택 목차 1개 → LearningUnit 1개
- 원문·수치·공식·관계 보존
- target, operation, successCriterion의 행동 일치
- 일반화가 필요한 패턴만 일반화
- 문제를 만들지 않음
- 추측하지 않음

선택 목차가 없는 과거 자유 추출 경로가 계속 필요하다면 같은 프롬프트에 분할 규칙을 섞지 말고 별도 조건 분기로 기존 규칙을 유지한다. 현재 제품 성공 경로의 프롬프트와 자유 추출 경로의 프롬프트를 논리적으로 분리해야 한다.

## 흔들림을 잡는 일반 규칙과 확인 예시

아래 항목은 프롬프트에 과목별 예외로 넣지 않는다. 일반 규칙이 제대로 작동하는지 확인하는 회귀 표본으로만 쓴다.

| 표본 | 흔들린 이유 | 일반 규칙으로 기대하는 판단 |
|---|---|---|
| OPIc 문법 규칙 | 근거 문장이 설명형이라 실제 사용 목표를 무시하고 recall로 낮춤 | 학습 목표와 목차가 새 발화에서 올바른 형태를 **사용**하라고 하면 apply |
| OPIc 핵심어 찾기 | ‘실제 새 문장’이라는 표현만으로 apply로 올림 | 주어진 표현에서 해당 부분을 **찾고 구별**하는 결과면 discriminate |
| 그래프 기본 개념 | 여러 구성요소의 관계를 설명한다는 이유로 reconstruct로 올림 | 배운 정의와 관계를 설명하는 과제면 recall. 구조 자체를 원형대로 복원할 때만 reconstruct |
| 그래프 표현 비교 | 비교 자료를 새 저장 상황의 선택 문제로 임의 확장 | 목차가 특성 비교만 요구하면 그 비교를 보존. 새 조건에서 선택하라는 목표가 명시된 경우에만 discriminate/apply 후보 |
| 알고리즘 적용 범위 | ‘조건이면 알고리즘’ 문장을 새 수행 과제로 과대 해석하거나 단순 사실로만 축소 | 목차가 조건에 맞는 대상을 **구분**하라고 하면 discriminate. 계산·실행 결과를 만들라는 요구가 있을 때만 apply |
| 탐지 절차 | 절차라는 이유로 무조건 apply로 올림 | 배운 절차 자체를 말하면 recall, 고정 순서를 복원하면 reconstruct, 새 그래프에 실제로 실행해 결과를 내면 apply |

## 예상 위험

### 1. Plan의 목차 행동이 애매하면 Prepare도 애매하다

이 안은 Prepare가 Plan의 의도를 보존하게 한다. 따라서 목차 title·summary가 서로 다른 행동을 가리키면 Prepare 혼자 올바르게 복구하기 어렵다.

대응: 프롬프트를 다시 늘리지 말고 실패가 반복되는지 기록한 뒤 Plan의 목차 품질 문제로 분리한다.

### 2. 호환용 메타데이터가 모델의 주의를 계속 분산할 수 있다

스키마가 요구하므로 당장은 남긴다. 간결화만으로도 핵심 세 필드가 안정되는지 먼저 본다.

대응: 실패가 반복될 때만 두 번째 안으로 핵심 LearningUnit과 부수 메타데이터의 호출 분리를 실험한다. 처음부터 호출을 늘리지 않는다.

### 3. 선택 목차 자체가 한 문제 크기로 잘못 확정됐을 수 있다

Prepare에서 고치면 ID 1:1 계약과 충돌한다.

대응: Prepare가 임의 수정하지 않고 그대로 드러내게 한 뒤, 목차 깊이 조절 단계의 문제로 돌려보낸다.

### 4. 패턴 일반화 정보가 축소될 수 있다

일반화 규칙을 한 문장으로 줄였기 때문에 패턴 자료에서 `fixedPart`와 `variableSlots` 품질을 별도로 확인해야 한다.

대응: OPIc 패턴 1~7의 고정 문장과 변수 자리가 원문 그대로 유지되는지 평가한다. 실패하면 일반화 규칙 한 줄만 보강하고 다른 지시를 되돌리지 않는다.

## 평가 기준

### 기계 검사

1. 선택 목차 ID와 LearningUnit ID가 순서와 개수까지 100% 일치한다.
2. `sourceText`에 근거의 고유 표현, 수치, 공식, 대응 관계가 빠지거나 바뀌지 않는다.
3. 필수 출력 스키마를 통과한다.
4. 질문, 정답, 보기, 빈칸 같은 실제 문제 요소가 출력되지 않는다.
5. 기존 Activity Design 입력 검사와 카드 생성 전 검사를 통과한다.

### 의미 검사

1. `target`, `operation`, `successCriterion`이 같은 행동을 가리킨다.
2. Plan이 설명만 요구한 단위를 새 상황 적용 문제로 확장하지 않는다.
3. Plan이 실제 사용을 요구한 단위를 규칙 암기로 낮추지 않는다.
4. `apply`에는 학습 목표·목차가 이미 요구한 새 입력과 달라지는 결과가 있다.
5. `reconstruct`에는 복원해야 할 고정 구조·관계·순서가 있다.
6. `discriminate`에는 실제 선택·판별 대상이 있다.
7. 기존 Sol 결과보다 문제 생성 단계의 학습 수준이 낮아지거나 원문 범위를 넘지 않는다.

### 최소 회귀 자료

- OPIc: 전략 3개와 패턴 1~7
- DFS/BFS: 그래프 기초·표현 비교·탐색 절차·격자 적용
- 데드락: 정의·필요조건·자원 할당 그래프·회피·탐지·복구

각 자료는 같은 고정 Plan, 같은 선택 목차, 같은 후속 Activity/Cards 설정으로 비교한다. Prepare 문장 자체가 Sol과 같은지는 합격 기준이 아니다. **학습 범위와 요구 행동이 보존되고 실제 문제 품질이 유지되는지**가 합격 기준이다.

## 지금 안 하는 것

- 프로덕션 모델을 Terra로 변경하지 않는다.
- 출력 타입이나 저장 구조를 바꾸지 않는다.
- operation을 과목별 하드코딩하지 않는다.
- OPIc, 그래프, 데드락 전용 문장을 실제 프롬프트에 넣지 않는다.
- Prepare 안에서 문제 형식이나 카드 문구를 고르지 않는다.
- Plan의 목차 크기 문제를 Prepare가 다시 해결하게 하지 않는다.

## 추천 실험 순서

1. 현재 입력과 출력 스키마는 고정하고 지시문만 이 최소안으로 바꾼 실험용 경로를 만든다.
2. 세 자료를 Terra `medium`으로 한 번씩 실행한다.
3. 위 기계·의미 검사를 하고 후속 Activity/Cards까지 연결한다.
4. 동일한 실패가 두 번 나오면 프롬프트 문장을 계속 덧붙이지 않고, 실패가 Plan·핵심 필드·호환 메타데이터 중 어디서 시작됐는지 분리해 보고한다.
5. 세 자료가 통과한 뒤에만 프로덕션 Prepare 모델 전환을 판단한다.
