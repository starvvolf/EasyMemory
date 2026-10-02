# Prepare Terra 전환: 간결화와 역할 분리 설계

## 결론

Prepare를 새 계층으로 쪼개기보다, **현재 한 호출 안에서 생각 순서만 두 단계로 분리**하는 것이 첫 실험에 가장 적합하다.

```text
Plan에서 확정한 목차·원문 근거
  ↓
[AI 판단 1] 이 목차에서 무엇을 익힐지 정리
  ↓
[AI 판단 2] 학습자가 무엇을 하면 성공인지 정함
  ↓
[서버 조립] 원문·출처·화면용 요약처럼 이미 아는 값 결합
  ↓
기존 LearningUnit
```

핵심 생성 로직인 **최종 목차 1개 → LearningUnit 1개 → 설계도 1개 → 문제 1개**는 바꾸지 않는다. 프로덕션 코드는 이번 조사에서 수정하지 않았다.

## 현재 문제

현재 Prepare는 한 호출에서 서로 성격이 다른 일을 모두 한다.

1. 선택된 목차의 원문을 다시 복사한다.
2. 무엇을 익힐지 정한다.
3. 재사용 가능한 패턴이면 일반화한다.
4. 학습 행동과 성공 기준을 정한다.
5. 자료 유형·핵심 주제·추천 전략·전체 추출본을 다시 쓴다.
6. 출처 파일과 페이지도 다시 출력한다.

Sol은 긴 지시 속에서도 비교적 안정적이었지만 Terra는 학습 내용 자체보다 `operation` 판단이 흔들렸다. OPIc 문법은 `apply → recall`, DFS/BFS 그래프 기초는 `recall → reconstruct`, 데드락 은행원 알고리즘은 `discriminate → recall`로 달라졌다. 이는 내용 추출과 행동 판단을 한꺼번에 시킨 영향일 가능성이 있다.

현재 프롬프트에도 같은 뜻의 규칙이 반복된다.

- 한 번에 연습 가능한 하나의 목표로 만들기
- 따로 맞고 틀릴 수 있으면 나누기
- 관계 자체가 목표면 함께 유지하기
- 개수를 맞추려고 합치거나 쪼개지 않기

선택 목차가 이미 문제 하나 크기로 확정된 주 흐름에서는 이 분할 규칙 대부분이 Prepare의 일이 아니다. Prepare는 확정된 경계를 다시 나누지 않는다고 한 번만 말하면 된다.

## 현재 출력과 실제 사용처

### LearningUnit

| 필드 | 실제 사용 | 누가 만드는 것이 맞는가 | 판단 |
| --- | --- | --- | --- |
| `id` | 목차·설계도·문제를 1:1로 연결 | 서버가 선택 목차 ID를 강제하되 AI 응답에도 연결 키로 유지 | 값은 이미 입력에 있다. 출력 누락·변경은 서버가 차단 중이다. |
| `sourceId` | PDF 이동, 하이라이트, 카드 출처 복원 | 서버 | Plan의 `sourceRefs.fileName`에 이미 있다. |
| `sourcePage` | PDF 해당 페이지 이동, 마스크 활동 | 서버 | Plan의 `sourceRefs.pageNumbers`에 이미 있다. |
| `sourceRange` | 출처 표시와 PDF 텍스트 위치 확인 | 서버 우선 | 목차 제목과 페이지 범위로 만들 수 있다. 여러 출처인 경우 현재 단일 출처 필드의 한계는 그대로 명시한다. |
| `sourceText` | 원문 대조, 하이라이트, 문제 근거 | 서버 | Plan leaf의 `sourceEvidence`가 문제·정답에 필요한 최소 원문을 보존하도록 이미 검증된다. AI가 다시 바꾸어 쓰게 하면 오히려 손실 위험이 있다. |
| `knowledgeType` | 저장 덱 상세 화면에 표시 | 당장은 AI 유지 | 다음 AI 호출의 압축 입력에는 들어가지 않지만, 과거 축소 A/B에서 이 필드를 다른 의미 필드와 함께 뺐을 때 핵심 범위가 흔들렸다. 개별 영향이 분리되지 않았으므로 바로 제거할 근거가 없다. |
| `fixedPart` | 직접 downstream 사용 없음 | 당장은 AI 유지 | 패턴 일반화 과정의 중간 판단이다. 과거 축소 실험에서 함께 제거한 뒤 품질이 흔들렸다. |
| `variableSlots` | 직접 downstream 사용 없음 | 당장은 AI 유지 | OPIc 같은 재사용 패턴의 변하는 자리를 보존하는 사고 보조다. 개별 제거 실험 전에는 유지한다. |
| `generalizedForm` | 검토 화면의 기본 내용이자 Activity 입력의 `finalContent` 우선값 | AI | 실제 문제 내용에 직접 영향을 준다. 단순 사실은 빈 값, 재사용 규칙은 일반화된 값이어야 한다. |
| `target` | 검토 화면, Activity Design 목표 | AI | 이 단계의 핵심 판단인 “무엇을 익힐지”다. |
| `operation` | Activity Design의 행동을 고정하고 서버 검증에 사용 | AI | 핵심 판단이지만 내용 판단 뒤 별도 순서로 정해야 한다. 서버 규칙으로 주제별 판정하면 하드코딩이 된다. |
| `successCriterion` | Activity Design의 한 개 채점 기준 | AI | `target`과 같은 행동을 관찰 가능한 문장으로 바꾸는 의미 판단이다. |
| `rationale` | 저장 덱 상세 화면에 표시 | 당장은 AI 유지 | 생성 downstream에는 안 들어가지만, 과거 축소 실험에서 함께 제거되어 개별 안전성이 입증되지 않았다. 첫 Terra 전환에서는 짧게 제한하고 이후 단독 제거 실험 대상으로 둔다. |
| `reviewedText` | 사용자가 수정한 최종 내용 | 사용자/서버 | Prepare 출력 필드가 아니다. 검토 뒤 서버가 붙인다. |

실제 Activity Design 압축 입력은 `learningUnitId`, `target`, `operation`, `successCriterion`, `finalContent`, `pageRefs`만 사용한다. `knowledgeType`, `fixedPart`, `variableSlots`, `rationale`는 다음 AI 호출로 전달되지 않는다. 반면 `generalizedForm`은 `sourceText`보다 먼저 `finalContent`로 채택되므로 품질 핵심이다.

### AnalysisResult 상단 정보

| 필드 | 실제 사용 | 서버 복원 가능성 | 제안 |
| --- | --- | --- | --- |
| `detectedGoal` | Activity·Cards의 공통 학습 목표, 저장 화면 | 높음 | Plan의 확정 `learningGoal`을 그대로 사용한다. AI 재작성 제거. |
| `sourceType` | Cards 입력과 저장 화면 | 낮음 | 현재 AI 판단 유지. 단 다섯 선택지 중 하나만 고르게 한다. |
| `keyTopics` | 덱 제목 fallback, 카드 태그, 저장 화면 | 높음 | 선택 leaf 제목에서 서버가 만든다. |
| `recommendedStrategy` | 저장 화면 표시만 | 높음 | Plan의 `selectionRationale` 또는 확정 학습 목표로 서버가 채운다. 문제 생성에는 쓰이지 않는다. |
| `extractedMaterial` | 입력 폼 fallback과 저장 화면 | 높음 | 확정 leaf의 `sourceEvidence`를 순서대로 합친다. |
| `primaryKnowledgeType` | 저장 화면, 사용자가 수동 추가한 단위의 기본값 | 높음 | AI가 만든 unit `knowledgeType`의 최빈값으로 서버가 계산한다. 동률이면 `other`로 두는 단순 규칙이면 충분하다. |

## 과거 축소 실패를 어떻게 반영할 것인가

2026-08-17 A/B에서는 Prepare 출력에서 아래를 한 번에 제거했다.

```text
knowledgeType + primaryKnowledgeType
fixedPart + variableSlots
rationale
```

그 결과:

- 사회 자료에서 GDP의 최종 생산물·중간재 구분 범위가 약해졌다.
- 과학 자료에서 스펙트럼으로 원소의 종류와 양을 알아내는 핵심 단위가 빠졌다.

따라서 “downstream이 직접 읽지 않는다”는 이유만으로 AI 사고에 도움을 주는 필드까지 한꺼번에 없애면 안 된다. 다만 이 실험은 여러 필드를 동시에 뺐기 때문에 **어느 필드가 실제 원인이었는지는 모른다.**

이번 Terra 전환의 1차 변경은 다음처럼 제한한다.

- 이미 입력에 있는 원문·출처와 상단 요약의 재출력만 서버로 옮긴다.
- `knowledgeType`, 패턴 일반화 묶음, 짧은 `rationale`는 그대로 둔다.
- Terra 품질이 안정된 뒤 `rationale` → `fixedPart/variableSlots` → `knowledgeType` 순서로 한 묶음씩만 제거 비교한다.
- 같은 실패가 두 번 나오면 해당 축소는 중단한다.

## 추천 프롬프트 구조

현재 40개 안팎의 세부 규칙을 다음 논리적 두 단계로 줄인다. 실제 API 호출은 한 번이다.

```text
역할:
확정된 최종 목차를 문제 하나로 연습할 LearningUnit으로 정리한다.
문제 문장과 문제 형식은 만들지 않는다.

입력:
- 전체 학습 목표
- 선택된 최종 목차 목록
- 각 목차의 제목, 원문 근거, 출처

1단계 — 학습 내용 정리
- 최종 목차 하나마다 LearningUnit 하나를 만든다. 합치거나 쪼개지 않는다.
- 원문 근거에서 학습자가 가져갈 핵심을 target 한 문장으로 적는다.
- 재사용 가능한 틀일 때만 fixedPart, variableSlots, generalizedForm을 만든다.
- 일반화하면 의미가 달라지면 generalizedForm은 비운다.
- knowledgeType은 내용 설명용으로만 고르고 문제 방식 결정에 쓰지 않는다.

2단계 — 성공 행동 정리
- target을 실제로 달성했을 때 학생이 보여야 할 행동 하나를 고른다.
- recall: 배운 대상 자체를 말하거나 적는다.
- reconstruct: 배운 고정 구조·관계·순서를 같은 구조로 복원한다.
- discriminate: 주어진 조건에서 맞는 것을 판별한다.
- apply: 새로운 입력에 지식을 사용해 입력에 따라 달라지는 결과를 만든다.
- apply는 새로운 입력과 달라지는 결과가 successCriterion에 모두 드러날 때만 고른다.
- successCriterion은 target과 같은 동사를 사용해 한 문장으로 적는다.

출력:
- 목차 연결 ID
- sourceType
- 각 단위의 knowledgeType, fixedPart, variableSlots, generalizedForm,
  target, operation, successCriterion, 짧은 rationale
```

이 구조에서 서버는 AI 출력과 입력을 결합해 기존 `AnalysisResult`와 `LearningUnit` 형태를 그대로 만든다. 따라서 학습 화면·저장 덱·Activity Design·Cards 계약을 새로 만들 필요가 없다.

## 대안 비교

### A안: 한 호출 안에서 논리적으로 두 단계 처리

```text
내용 정리 → 행동 정리 → 기존 형태로 서버 조립
```

장점:

- API 호출 수가 늘지 않는다.
- 두 판단이 같은 원문과 학습 목표를 공유한다.
- 기존 1:1 계약과 화면을 유지한다.
- 입력 재전송과 두 번째 호출의 추론 토큰이 없다.
- Terra 실패가 프롬프트 복잡성 때문인지 가장 작게 검증할 수 있다.

단점:

- Terra가 두 판단을 여전히 섞을 가능성이 있다.
- 행동 판단만 따로 재시도할 수 없다.

예상 토큰 영향:

- 입력: 반복 규칙과 이미 확정된 원문/PDF 재전송을 줄일 수 있다.
- 출력: 원문·출처·상단 요약 재출력을 제거하므로 특히 긴 `sourceText`에서 크게 줄어든다.
- 호출 고정비: 현재와 동일하게 1회다.

### B안: 실제 두 호출로 분리

```text
호출 1: 내용·일반화 확정
호출 2: target을 보고 operation·successCriterion만 확정
```

장점:

- 두 번째 모델은 매우 작은 선택 문제에만 집중한다.
- operation만 실패하면 두 번째 호출만 다시 실행할 수 있다.
- 어느 단계에서 품질이 흔들렸는지 명확하다.

단점:

- 호출이 2회가 되어 지연과 실패 지점이 늘어난다.
- 두 번째 호출에도 학습 목표·target·최종 내용을 다시 보내야 한다.
- 별도 중간 결과와 재사용 규칙이 생겨 현재 단계에는 구조가 커진다.
- 행동 판단이 원문 전체 맥락에서 떨어지면 오히려 단순 회상으로 낮아질 수 있다.

예상 토큰 영향:

- 두 번째 입력은 압축할 수 있지만 시스템 지시·스키마·추론 토큰이 한 번 더 든다.
- 전체 비용은 A안보다 높을 가능성이 크다.
- 대신 operation 실패 시 전체 Prepare를 다시 돌리지 않는 장기 절감은 가능하다.

### C안: operation을 Prepare에서 없애고 Activity Design이 추론

장점:

- Prepare는 가장 단순해진다.
- 현재 코드도 operation이 없으면 Activity 단계가 추론할 수 있다.

단점:

- 핵심 로직에서 Prepare가 정한 학습 행동을 Activity가 보존한다는 기준이 사라진다.
- 문제 방식 설계 단계가 학습 목표까지 다시 해석하게 되어 역할이 커진다.
- 사용자가 Prepare 검토 화면에서 “무엇을 해야 하는지” 확인할 수 없다.

판정: 지금은 채택하지 않는다.

## 추천

**A안부터 시험한다.**

이유는 현재 실패가 학습 범위 누락보다 행동 분류의 흔들림이고, 이를 해결하기 위해 새 API 단계를 만드는 것은 아직 과하다. 먼저 한 호출에서 다음 두 가지만 바꿔도 충분히 원인을 검증할 수 있다.

1. AI가 이미 입력으로 받은 원문·출처·상단 요약을 다시 쓰지 않게 한다.
2. 내용 판단을 끝낸 다음 행동을 정하라고 순서를 명확히 한다.

A안이 동일한 operation 실패를 두 번 반복할 때만 B안으로 넘어간다. B안도 실패하면 자료별 규칙을 덧붙이지 말고 Prepare에서 operation을 맡기는 구조 자체를 다시 검토한다.

## 실험 범위

첫 실험은 현재 주 흐름인 **선택된 learningOutline leaf와 완전한 sourceEvidence가 있는 경우**에만 적용한다.

선택 목차가 없는 과거 `focused_area` 경로는 Prepare가 직접 학습단위 경계와 출처까지 찾아야 하므로 기존 프롬프트·출력 계약을 유지한다. 이는 자료 주제별 예외가 아니라 입력 준비 수준에 따른 명확한 분기다.

비교 순서:

1. OPIc, DFS/BFS, 데드락의 기존 Plan 결과를 고정한다.
2. Sol 현재 Prepare, Terra 현재 Prepare, Terra 간결 Prepare를 비교한다.
3. ID·원문·일반화·target·operation·successCriterion을 각각 비교한다.
4. 같은 결과로 Activity Design과 Cards까지 실행한다.
5. 학습 범위 누락, 행동 수준 하락, 정답 노출, 문제 정확성을 검사한다.
6. Terra 간결안이 3자료를 통과하면 사회·과학으로 범위를 넓힌다.

합격 기준:

- 선택 leaf ID 100% 유지
- Plan의 sourceEvidence 손실 0
- 재사용 패턴·공식·수치 관계 손실 0
- `target`과 `successCriterion`의 행동 불일치 0
- 새 입력 없는 잘못된 `apply` 0
- LearningUnit 1개당 Activity·문제 1개 유지
- 기존 Sol 결과보다 핵심 훈련 수준이 낮아진 항목 0

## 지금 하지 않는 것

- 프로덕션 모델 변경
- 공용 `LearningUnit` 타입 변경
- Activity Design에 Prepare 역할 이전
- 지식 유형 전체 제거
- 자료별 operation 규칙 추가
- 새로운 중간 계층이나 범용 Registry 추가

## 근거 위치

- 현재 Prepare 스키마·프롬프트: `src/lib/pipeline/generate.ts`의 `runAnalysis`, `buildAnalysisPrompt`
- 다음 단계 실제 압축 입력: `src/lib/pipeline/compact-input.ts`의 `createCompactActivityDesignInput`
- 사용자 검토본 구성: `src/lib/pipeline/generate.ts`의 `buildReviewMaterial`
- PDF 이동·하이라이트 사용: `src/app/PdfReviewViewer.tsx`, `src/lib/pdf-mask.ts`
- 출처 복원과 카드 태그: `src/lib/pipeline/compact-card-output.ts`
- 과거 Prepare 축소 실패 기록: `eval/snapshots/2026-08-17-pre-data-structure-shrink/README.md`
- 고정 핵심 로직: `docs/CORE_GENERATION_LOGIC.md`
