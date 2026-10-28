# Study Forge 공통 Eval Schema v0

## 1. 설계 목표

이 문서는 현재 작성된 두 gold/reference를 비교해 Study Forge 학습 결과를 평가할 공통 구조의 첫 초안을 제안한다.

- OPIc 인물 묘사 패턴 reference
- 운영체제 데드락 reference

목표는 다음 세 층을 분리하는 것이다.

1. 모든 학습자료에 공통으로 적용할 평가 기준
2. 자료 유형이나 학습 목표에 따라 활성화할 기준
3. 개별 gold/reference에서만 정의할 기대 내용과 실패 조건

이 문서는 production schema, 자동 채점 구현 또는 완성된 평가 표준이 아니다. 두 사례만으로 모든 학습자료의 구조를 확정하지 않는다. 이후 단어 암기, 절차 학습과 다른 자료 유형의 gold를 추가하면서 수정하는 `v0` 설계다.

### 핵심 설계 원칙

- exact match보다 의미적 충족 여부를 평가한다.
- 공통 schema는 작고 안정적인 구조만 가진다.
- 과목별 지식과 특수 규칙은 case-specific rubric에 남긴다.
- 학습 목표가 달라지면 같은 자료도 다른 gold가 될 수 있다.
- 대표 카드는 좋은 구현 예시이지 정답 문자열 목록이 아니다.
- 카드 수를 품질 점수로 사용하지 않는다.
- 자동화 가능성과 자동 판정의 신뢰성을 구분한다.

### EvalReference와 EvaluationResult의 경계

이 문서에서는 좋은 결과의 기준 데이터와 실제 평가에서 산출되는 결과 데이터를 명확히 구분한다.

#### EvalReference

EvalReference는 **"무엇이 좋은 결과인가"를 정의하는 기준 데이터**다. 사람이 작성하고 검토하는 gold/reference 파일에 저장된다.

대표적으로 다음 정보를 포함한다.

- `learningGoal`
- `expectedLearningOutcomes`
- `learningUnits`
- `exclusions`
- `criticalFailures`
- `caseSpecificRubric`
- `representativeCards`

EvalReference는 특정 생성 결과가 몇 점인지 기록하지 않는다. 어떤 의미 범위, 학습 행동, 원문 근거와 실패 조건을 기준으로 평가할지를 정의한다.

#### EvaluationResult

EvaluationResult는 **"실제 생성 결과가 EvalReference를 얼마나 만족했는가"를 기록하는 평가 결과**다. 생성된 LearningUnit, Card와 CardSet을 EvalReference에 대조한 뒤 만들어진다.

대표적인 산출 값은 다음과 같다.

- `semanticCoverage`
- `learningIntentAlignment`
- `retrievalAlignment`
- `factualGrounding`
- `atomicity`
- `contextSufficiency`
- `abstractionFit`
- `redundancy`
- `coverageDistribution`
- `detectedCriticalFailures`
- `evidence`
- `evaluatorJudgment`

이 값들은 gold/reference의 정답 데이터가 아니다. 실제 생성 결과를 평가할 때 산출되는 판단과 근거다.

개념적으로는 다음 정도의 경계만 가정한다.

```text
EvaluationResult
- 어떤 EvalReference와 생성 결과를 평가했는가
- 각 평가 차원에서 무엇을 충족하거나 위반했는가
- 판단 근거는 무엇인가
- 어떤 critical failure가 발견됐는가
- 평가자의 종합 판단은 무엇인가
```

v0에서는 EvaluationResult의 production JSON schema, 점수 타입, 집계 방식과 통과 기준을 설계하지 않는다.

## 2. OPIc vs Deadlock 비교

### 공통점

두 사례는 과목과 카드 형식이 다르지만 동일한 품질 문제를 다룬다.

| 관점 | OPIc 인물 묘사 | 운영체제 데드락 | 공통 의미 |
|---|---|---|---|
| 학습 목표 | 의미·의도에서 영어 패턴을 생산 | 개념을 설명하고 조건을 적용해 판단 | 자료가 아니라 사용자가 수행할 행동에서 평가를 시작한다. |
| 핵심 내용 선별 | 7개 공통 발화 기능 | 정의, 조건, 그래프, 전략, 상태 판정 | 문서의 모든 문장이 아니라 목표에 필요한 의미 범위를 골라야 한다. |
| 예시 처리 | 완성 스크립트에서 패턴을 추출 | 특정 그래프에서 일반 판정 규칙을 추출 | 예시 자체와 예시가 증명하거나 적용하는 핵심 지식을 구분한다. |
| 원문 근거 | 패턴과 페이지를 연결 | 정의·규칙·경계조건과 페이지를 연결 | 생성된 학습 내용은 추적 가능한 원문 근거를 가져야 한다. |
| 인출 설계 | 한국어 의미 → 영어 표현 | 정의 설명, 비교, 상황 → 판정 | 실제 목표 행동을 카드 앞면과 뒷면의 관계로 구현해야 한다. |
| 원자성 | 발화 기능 하나를 한 단위로 유지 | 개념·관계·판정 하나를 한 단위로 유지 | 독립적인 대상을 과도하게 합치거나 의미 없이 쪼개지 않는다. |
| 중복 관리 | 인물만 바뀐 스크립트 반복 제거 | 요약·번역·예시 기호의 반복 제거 | 표현이나 사례만 다른 동일 지식의 중복을 줄인다. |
| 카드 묶음 품질 | 7개 기능의 범위와 형식 일관성 | 정의·비교·적용의 범위와 비중 | 개별 카드뿐 아니라 전체 coverage와 중요도 기반 분포를 평가해야 한다. |

### 차이점

| 관점 | OPIc 인물 묘사 | 운영체제 데드락 |
|---|---|---|
| 자료의 핵심 유형 | 반복 예시에서 재사용 패턴을 찾는 생산형 언어 자료 | 정의·조건·관계·상태 판정이 중심인 개념형 자료 |
| 주된 인출 행동 | 말하고 싶은 의미를 보고 영어 표현 생성 | 개념 설명, 조건 비교, 그래프와 상태 판단 |
| 적절한 추상화 | 이름·관계·상황을 변수로 일반화 | 핵심 조건은 보존하고 예시 기호만 일반화 |
| 대표적 위험 | 완성 예문을 전부 카드화하거나 템플릿과 예문을 혼합 | 필요조건·충분조건, 가능성·확정을 혼동하거나 규칙을 과도하게 일반화 |
| 조건부 범위 | 공적 인물일 때 `first saw` 변형 | 자원 인스턴스 수에 따라 그래프 판정과 알고리즘이 달라짐 |
| 핵심 실패 | 반대 인출 방향, 변수 임의 완성 | 사이클이면 항상 데드락, 불안전 상태와 데드락 동일시, 간선 방향 반전 |

가장 중요한 차이는 **추상화의 방향**이다. OPIc에서는 구체 예시를 공통 템플릿으로 일반화하는 것이 핵심이지만, Deadlock에서는 조건과 경계까지 일반화 과정에서 보존해야 한다. 따라서 `patternTemplate`, `graphRule` 같은 특수 필드를 공통 필수 schema에 넣지 않는다.

## 3. 공통 평가 요소

### 3.1 학습 목표 정렬

**평가 질문:** 결과가 사용자가 학습 후 할 수 있어야 하는 행동을 연습하게 하는가?

OPIc에서는 영어 생산, Deadlock에서는 개념 설명과 상태 판정이 목표다. 둘 다 자료의 문장 순서를 복제하는 것만으로는 목표를 달성할 수 없다. 이후 모든 평가의 기준점이므로 공통 필수 항목이다.

### 3.2 학습 가치

**평가 질문:** 선택한 내용이 현재 학습 목표에서 실제로 기억하거나 수행할 가치가 있는가?

쉐도잉 절차, 페이지 번호, 반복 요약처럼 자료에 존재하지만 현재 목표의 핵심이 아닌 내용이 두 사례 모두에 있었다. 존재 여부가 아니라 목표 관련성과 인출 가치로 판단해야 한다.

### 3.3 핵심 내용 coverage

**평가 질문:** gold가 요구하는 필수 의미 범위를 빠뜨리지 않았는가?

OPIc의 7개 발화 기능과 Deadlock의 정의·조건·그래프·처리 전략은 exact string은 아니지만 누락 여부를 평가할 수 있는 의미 범위다. coverage는 카드 수가 아니라 required LearningUnit의 의미 충족으로 측정한다.

### 3.4 LearningUnit 명확성과 원자성

**평가 질문:** 하나의 LearningUnit이 하나의 명확한 지식, 관계 또는 수행을 가지는가?

두 사례 모두 독립적인 내용을 한 단위에 합치면 카드가 과도하게 커지고, 줄바꿈이나 문장 단위로 기계적으로 쪼개면 의미가 불완전해진다. `하나의 대상`은 반드시 한 문장이라는 뜻이 아니라 하나의 판정 가능한 학습 의도라는 뜻이다.

### 3.5 인출 적합성

**평가 질문:** 카드가 학습 목표에 필요한 방향과 난이도로 기억을 꺼내게 하는가?

OPIc은 의미 → 영어 production이 핵심이고, Deadlock은 용어 → 정의뿐 아니라 상황 → 판정과 전략 → 원리를 요구한다. 구체 방향은 다르지만 목표 행동과 카드 인출 행동의 일치 여부는 공통으로 평가할 수 있다.

### 3.6 원문 근거성과 사실성

**평가 질문:** LearningUnit과 카드가 원자료에 근거하며 핵심 의미를 왜곡하지 않는가?

두 사례 모두 페이지 근거를 사용하고, 원문에 없는 사실 추가를 실패로 본다. 표현 정리와 적절한 일반화는 허용하지만 새 사실, 반대 관계 또는 없는 조건을 추가할 수 없다.

### 3.7 필요한 맥락 보존

**평가 질문:** 정답을 판정하고 의미를 보존하는 데 필요한 조건과 범위가 남아 있는가?

OPIc에서는 인물 유형에 따라 `got to know`와 `first saw`의 문맥이 달라진다. Deadlock에서는 인스턴스 수가 사이클 판정에 필수다. 맥락 제거가 의미 변경으로 이어지는지 공통으로 평가한다.

### 3.8 예시와 핵심 학습 대상의 역할 구분

**평가 질문:** 예시를 암기 대상으로 오인하지 않고, 예시가 보여주는 핵심 지식이나 적용 규칙을 식별했는가?

OPIc의 이름·나이·완성 스크립트와 Deadlock의 `Pi`, `Rj` 번호·특정 그래프 배치는 모두 핵심 원리를 보여주는 사례였다. 다만 예시 자체가 목표일 수 있으므로 항상 제거하는 규칙이 아니라 역할 분류 기준으로 둔다.

### 3.9 적절한 추상화 수준

**평가 질문:** 재사용성을 높이면서 학습해야 할 의미와 경계조건을 보존했는가?

OPIc은 변수 자리를 남기는 일반화가 적절했고, Deadlock은 `cycle → deadlock`으로 과도하게 단순화하면 오류가 됐다. 추상화의 구체 규칙은 case-specific이지만, 추상화 전후의 의미 보존 여부는 공통 기준이다.

### 3.10 중복 방지

**평가 질문:** 같은 학습 목표와 방향의 지식을 표현이나 예시만 바꾸어 반복하지 않았는가?

완성 스크립트 반복, 요약 반복, 번역 중복 모두 형태는 다르지만 동일 지식에 과도한 학습 비중을 주는 문제다. 반대 방향 인출처럼 목적이 다른 경우는 중복이 아닐 수 있다.

### 3.11 카드화 적합성

**평가 질문:** 이 LearningUnit을 현재 카드 형식으로 연습하는 것이 적절한가?

두 reference 모두 카드화 가치가 낮은 내용과 향후 다른 학습 방식이 더 적절한 범위를 인정한다. 카드 생성 단계에서 제외할 수 있어야 한다.

### 3.12 CardSet coverage와 coverage distribution

**평가 질문:** 카드 묶음 전체가 필수 범위를 충분히 다루고, 학습 목표와 gold/reference가 요구하는 상대적 중요도에 비해 특정 영역을 부당하게 과대표현하거나 과소표현하지 않았는가?

`coverageDistribution`은 모든 하위 주제의 카드 수를 같게 만드는 균등 분배가 아니다. CardSet의 카드 분포가 학습 목표와 gold/reference의 의미 범위별 상대적 중요도를 합리적으로 반영하는지 평가하는 개념이다.

Deadlock 자료에서 Prevention의 원문 분량이 더 많다면 관련 카드가 더 많은 것은 자연스러울 수 있다. 하지만 Prevention 카드만 20장 만들고 Avoidance와 Detection/Recovery를 거의 누락하면 분포가 왜곡된 것이다. OPIc도 7개 발화 기능마다 카드 수가 같을 필요는 없지만, 특정 완성 스크립트 하나가 CardSet 대부분을 차지하면 문제가 된다.

개별 카드 합격만으로 CardSet의 coverage와 distribution 품질을 보장할 수 없다.

## 4. Case-Specific 평가 요소

공통 schema는 case-specific 규칙을 저장할 자리만 제공하고, 아래 규칙 자체를 모든 사례에 강제하지 않는다.

### 4.1 OPIc 인물 묘사

다음 항목은 `learning-goal-specific rubric`으로 둔다.

- 반복 예시에서 재사용 가능한 스피킹 패턴을 추출했는가
- 의미 또는 발화 의도 → 영어 표현의 production 방향인가
- 템플릿형 선택 시 변수 자리를 유지했는가
- 완성 예문형과 템플릿형을 임의로 혼합하지 않았는가
- 인물 유형에 따라 `got to know`와 `first saw`를 적절히 구분했는가
- 대명사와 3인칭 단수 표현이 일관되는가
- 불필요한 `다음 뜻을 영어로 말하세요` 문구를 반복하지 않는가

이 항목들은 언어 production 및 템플릿 학습 목표에 특화되어 있으므로 공통 필드로 승격하지 않는다.

### 4.2 운영체제 데드락

다음 항목은 `case-specific rubric`으로 둔다.

- 네 조건의 필요조건 관계를 정확히 보존했는가
- 사이클이 뜻하는 가능성과 확정을 인스턴스 수에 따라 구분했는가
- 안전 상태와 불안전 상태의 비대칭을 보존했는가
- 요청·할당 간선 방향을 정확히 해석했는가
- 예방·회피·탐지 및 복구의 전제와 개입 시점을 비교했는가
- 특정 그래프 기호보다 일반 판정 규칙을 학습하게 하는가
- 단일 인스턴스 규칙을 다중 인스턴스에 과도하게 일반화하지 않았는가

이 항목들은 데드락이라는 지식 영역과 그래프 판정 과제에 특화되어 있으므로 공통 schema의 고정 속성으로 만들지 않는다.

### 4.3 공통 schema와 case rubric의 경계

- 공통: `추상화가 의미를 보존했는가`
- OPIc 특화: `인물·상황을 변수 자리로 남겼는가`
- Deadlock 특화: `인스턴스 수 경계조건을 보존했는가`

- 공통: `인출 방향이 학습 목표와 맞는가`
- OPIc 특화: `의미 → 영어 production인가`
- Deadlock 특화: `상황 → 상태 판정 또는 전략 → 원리인가`

공통 schema는 상위 질문을 제공하고, gold/reference가 구체적인 합격 조건을 제공한다.

## 5. EvalReference 공통 구조

### 5.1 필수 필드

| 필드 | 목적 | 필수인 이유 |
|---|---|---|
| `schemaVersion` | reference가 따르는 초안 버전 | 이후 구조 변경과 migration 판단에 필요하다. |
| `caseId` | 사례의 안정적인 식별자 | 결과 비교와 이력 관리에 필요하다. |
| `title` | 사람이 읽는 사례명 | 파일명만으로 의미를 추정하지 않게 한다. |
| `source` | 원자료 식별, 자료 유형, 위치 | 근거 추적과 source type 비교에 필요하다. |
| `learningGoal` | 현재 사례의 목표 행동과 범위 | 같은 자료도 목표에 따라 다른 gold가 되기 때문이다. |
| `expectedLearningOutcomes` | case 전체가 성공했을 때 사용자가 최종적으로 갖게 되어야 할 능력 | 개별 LearningUnit을 넘어 사례 전체의 성공 상태를 정의한다. |
| `learningUnits` | required/recommended/conditional 기대 단위 | coverage와 선택 품질의 기준이다. |
| `exclusions` | 제외할 내용과 이유 | 모든 내용을 카드화하는 오류를 판정한다. |
| `criticalFailures` | 점수와 별개로 막아야 할 실패 | 심각한 사실 오류와 목표 반전을 명시한다. 빈 배열도 명시적으로 허용한다. |

### 5.2 선택 필드

| 필드 | 목적 | 선택인 이유 |
|---|---|---|
| `representativeCards` | 좋은 카드 구현 예시 | 의미 기준만으로 충분한 사례도 있으며 exact match 오해를 피해야 한다. |
| `caseSpecificRubric` | 자료·목표 특화 판정 기준 | 모든 자료가 별도 규칙을 필요로 하지는 않는다. |
| `coverageGroups` | CardSet의 coverage distribution을 검토할 의미 그룹 | 큰 하위 영역별 상대적 분포를 볼 때 유용하며 동일 카드 수를 요구하지 않는다. |
| `evaluationNotes` | 허용 변형, 판정 유의사항 | 구조화하기 어려운 초기 판단을 보존한다. |
| `openQuestions` | 아직 확정하지 않은 쟁점 | v0 gold를 성급히 확정하지 않도록 한다. |

### 5.3 별도 필드로 두지 않는 것

- `sourceType`은 `source.type`에 포함한다.
- `requiredLearningUnits`, `optionalLearningUnits`, `conditionalLearningUnits`를 별도 배열로 나누지 않고 각 LearningUnit의 `status`로 표현한다.
- OPIc 전용 `templateVariables`와 Deadlock 전용 `graphRules`는 공통 필드로 두지 않는다.
- 카드 개수 목표는 필수 필드로 두지 않는다. 필요한 경우 평가 메모에 범위 힌트로만 기록한다.
- 프롬프트, 모델명과 생성 파라미터는 gold/reference의 학습 품질 정의가 아니라 실행 기록에 속하므로 포함하지 않는다.

### 5.4 `expectedLearningOutcomes`의 역할

`expectedLearningOutcomes`는 case 전체가 성공했을 때 사용자가 최종적으로 갖게 되어야 할 능력을 표현한다. 여러 LearningUnit이 함께 기여해 달성하는 상위 성과다.

예를 들어 Deadlock 사례의 expected learning outcome은 다음과 같을 수 있다.

> 자원 할당 상황을 보고 데드락 가능성과 안전성을 판단할 수 있다.

이 결과를 달성하기 위해 사이클 판정, 인스턴스 수의 영향, 안전 상태의 의미와 같은 여러 LearningUnit이 각각 구체적인 연습을 담당한다.

## 6. LearningUnit Reference 구조

### 6.1 필수 필드

| 필드 | 의미 |
|---|---|
| `id` | 사례 안에서 안정적인 LearningUnit 식별자 |
| `status` | `required`, `recommended`, `conditional` 중 하나 |
| `semanticTarget` | 반드시 보존해야 할 지식, 관계 또는 수행의 의미 |
| `learningIntent` | 해당 LearningUnit이 case 전체의 최종 능력에 기여하기 위해 연습시키는 구체적인 행동 |
| `sourceEvidence` | 문서·페이지·구절 또는 도식 등 확인 가능한 근거 |

`semanticTarget`과 `learningIntent`는 구분한다. 예를 들어 Deadlock의 semantic target은 안전 상태의 정의이고, learning intent는 상태가 안전한 이유를 설명하거나 요청 승인 여부를 판단하는 것이다.

`expectedLearningOutcomes`와 `learningIntent`도 중복 데이터가 아니다.

- `expectedLearningOutcomes`: case 전체가 성공했을 때의 최종 능력
- `learningUnits[].learningIntent`: 개별 단위가 그 최종 능력에 기여하기 위해 연습시키는 구체적인 행동

Deadlock 사례에서 두 계층은 다음처럼 연결될 수 있다.

- **expectedLearningOutcome**: 자원 할당 상황을 보고 데드락 가능성과 안전성을 판단할 수 있다.
- **LearningUnit learningIntent**: 그래프의 사이클 존재와 자원 인스턴스 수를 이용해 데드락 여부를 판단한다.

상위 outcome을 LearningUnit마다 반복하지 않고, 각 LearningUnit이 담당하는 구체적 기여를 `learningIntent`에 기록한다.

### 6.2 조건부 필수 필드

| 필드 | 조건 |
|---|---|
| `conditions` | `status = conditional`이면 필수. 어떤 학습 범위나 사용자 선택에서 기대되는지 설명한다. |

### 6.3 선택 필드

| 필드 | 사용 시점 |
|---|---|
| `retrievalExpectation` | 특정 인출 방향이나 과업이 품질에 결정적일 때 |
| `abstractionPolicy` | 예시를 일반화하거나 구체 조건을 보존하는 규칙이 필요할 때 |
| `criticalMisconceptions` | 이 단위에서 발생할 수 있는 치명적 의미 왜곡이 있을 때 |
| `groupId` | CardSet coverage 그룹에 연결할 때 |
| `notes` | 허용 표현, 분할·병합 주의 등 사람이 읽을 보충 설명 |

### 6.4 의도적으로 제외한 필드

- `expectedFront`, `expectedBack`은 LearningUnit 필수 필드로 두지 않는다. 대표 카드는 별도 예시다.
- 모든 단위에 `abstractionPolicy`를 강제하지 않는다. 단순 사실 암기에는 불필요할 수 있다.
- 모든 단위에 `criticalMisconceptions`를 강제하지 않는다. 빈 형식 반복을 피한다.
- `cardCount`와 `wordingPattern`은 의미 품질을 고정할 위험이 있어 두지 않는다.

## 7. Exclusion 구조

두 gold의 세부 category를 그대로 합치면 사례가 늘 때마다 enum이 증가한다. v0에서는 공통 상위 category와 자유로운 case-specific reason을 분리한다.

### 7.1 공통 상위 category

| category | 의미 | 두 사례의 예 |
|---|---|---|
| `out_of_scope` | 내용 자체에는 가치가 있을 수 있지만 현재 학습 목표 밖 | OPIc 쉐도잉 절차·질문 원문 |
| `redundant` | 이미 다른 단위가 같은 의미와 목표를 충분히 다룸 | 반복 스크립트, 반복 요약, 번역 중복 |
| `incidental_example_detail` | 예시를 구성하지만 일반 학습 대상은 아닌 구체 정보 | 인물 이름·나이, 그래프의 특정 `Pi`·`Rj` 배치 |
| `low_learning_value` | 현재 목표에서 인출 가치가 매우 낮음 | 단순 독려 문구, 불완전한 슬라이드 조각 |
| `source_artifact` | 페이지·레이아웃·문서 형식에서 생긴 비학습 요소 | 페이지 번호, 저작권 고지, 줄바꿈 파편 |

### 7.2 Exclusion 항목 필드

필수:

- `category`: 위 공통 상위 category
- `target`: 제외하려는 내용 또는 범위
- `reason`: 현재 사례에서 제외하는 구체적인 이유
- `sourceEvidence`: 확인 가능한 원문 위치

선택:

- `caseReasonCode`: 사람이 반복적으로 사용할 가치가 있을 때만 두는 사례별 짧은 코드
- `allowedUse`: 카드화하지 않더라도 coverage 검증이나 예시 근거로 사용할 수 있는 방법
- `exception`: 다른 학습 목표에서는 포함될 조건

### 7.3 기존 category 매핑

- OPIc `out_of_scope_for_current_goal` → `out_of_scope`
- OPIc `redundant_example` → 문맥에 따라 `redundant` 또는 `incidental_example_detail`
- OPIc `low_learning_value` → `low_learning_value`
- OPIc `metadata` → `source_artifact`
- Deadlock `redundant_summary`, `redundant_translation` → `redundant`
- Deadlock `example_specific_detail` → `incidental_example_detail`
- Deadlock `low_learning_value_fragment` → `low_learning_value` 또는 레이아웃 파편이면 `source_artifact`
- Deadlock `metadata` → `source_artifact`

분류가 애매하면 상위 category를 늘리기보다 `reason`으로 차이를 설명한다.

## 8. Critical Failure 구조

Critical failure는 일반 감점 항목이 아니라, 결과를 그대로 학습할 경우 목표를 반대로 연습하거나 심각한 오개념을 강화하는 실패다.

### 8.1 공통 critical failure

- 학습 목표와 반대되는 인출 방향을 일관되게 적용
- 원문에 없는 사실을 학습 내용으로 추가
- 원문 핵심 관계를 반대로 설명
- 답을 판정할 수 없을 정도로 필수 맥락 제거
- 서로 모순되는 카드를 같은 CardSet에 포함

Required coverage 누락은 중요하지만 v0에서는 공통 critical failure로 두지 않는다. 몇 개 또는 어느 정도의 누락부터 즉시 실패인지 정할 근거가 아직 없기 때문이다. 누락은 EvaluationResult의 `semanticCoverage`, required coverage와 CardSet coverage 판단에서 다룬다.

향후 baseline eval 결과가 쌓여 특정 수준 이상의 coverage 누락을 즉시 실패로 처리할 근거가 생기면 critical failure 승격을 다시 검토할 수 있다.

### 8.2 Case-specific critical failure

OPIc 예:

- 생산 목표인데 영어 → 한국어 인식 카드만 생성
- 템플릿형 목표인데 변수 자리를 임의의 사실로 일관되게 채움

Deadlock 예:

- 사이클이 있으면 인스턴스 수와 관계없이 항상 데드락이라고 설명
- 불안전 상태를 데드락 상태와 동일시
- 요청 간선과 할당 간선 방향을 반대로 설명

### 8.3 필드 구조

| 필드 | 필수 | 의미 |
|---|---|---|
| `id` | 필수 | 실패 규칙 식별자 |
| `scope` | 필수 | `common` 또는 `case_specific` |
| `category` | 필수 | `goal_misalignment`, `grounding_violation`, `semantic_error`, `structural_failure` 중 하나 |
| `description` | 필수 | 사람이 이해할 실패 정의 |
| `trigger` | 필수 | 어떤 결과가 나오면 실패로 판단하는지 |
| `appliesAt` | 필수 | `goal`, `learning_unit`, `card`, `card_set` 중 적용 수준 |
| `relatedUnitIds` | 선택 | 특정 LearningUnit과 연결될 때 |
| `sourceEvidence` | 선택 | case-specific 사실 오류의 원문 근거 |

모든 critical failure는 이미 심각하므로 v0에서는 severity enum을 추가하지 않는다. 향후 실제 사례에서 실패 간 우선순위가 필요하다는 증거가 생길 때 검토한다.

## 9. 평가 레벨

### 9.1 Case/Goal 수준

다음을 평가한다.

- 학습 목표 해석이 적절한가
- 자료 유형과 목표에 맞는 인출 행동을 선택했는가
- in-scope와 out-of-scope 범위를 적절히 구분했는가

이 수준이 필요한 이유는 LearningUnit과 카드가 모두 자연스러워도 처음 해석한 목표가 틀리면 전체 결과가 잘못될 수 있기 때문이다.

### 9.2 LearningUnit 수준

다음을 평가한다.

- 학습 가치와 required coverage
- 의미 명확성·원자성
- 원문 근거성
- 예시와 핵심 대상 구분
- 추상화 수준과 맥락 보존
- 카드화 적합성

### 9.3 Card 수준

다음을 평가한다.

- 앞면이 목표에 맞는 인출 행동을 유도하는가
- 뒷면이 정확하고 판정 가능한가
- LearningUnit 의미를 왜곡하지 않는가
- 불필요한 메타 문구나 답 유출이 없는가
- 하나의 카드가 과도하게 많은 독립 대상을 요구하지 않는가

### 9.4 CardSet 수준

다음을 평가한다.

- required coverage와 conditional 적용
- 의미적 중복
- 학습 목표와 의미 범위의 상대적 중요도에 맞는 coverage distribution
- 인출 방향과 형식의 일관성
- 카드화 부적합 내용의 과잉 포함
- CardSet 내부 모순

여기서 coverage distribution은 하위 주제별 카드 수의 균등성을 뜻하지 않는다. 중요한 영역에 더 많은 카드가 배정될 수 있지만, gold/reference가 요구하는 다른 핵심 영역을 거의 제거할 정도의 과대표현은 허용하지 않는다.

### 9.5 Source Analysis를 별도 평가 레벨로 두지 않는 이유

Source Analysis는 필요하지만 현재는 독립적인 점수 레벨로 만들지 않는다. 자료 구조와 페이지 근거는 gold 작성 과정의 입력이며, 결과 평가는 Case/Goal과 LearningUnit 수준에서 드러난다.

향후 OCR 누락이나 표·도식 추출 실패 자체를 별도로 측정해야 한다면 pipeline 진단 지표로 분리할 수 있다. 이는 학습 품질 점수와 동일하지 않다.

## 10. Exact Match를 사용하지 않는 평가 방식

이 장의 항목은 EvalReference에 저장되는 정답 필드가 아니다. 실제 생성 결과를 EvalReference와 비교한 뒤 EvaluationResult에서 산출하거나 기록할 평가 차원이다.

### 10.1 비교해야 할 것

- `semanticCoverage`: required LearningUnit의 의미가 결과에 존재하는가
- `learningIntentAlignment`: 기대하는 학습 행동을 구현했는가
- `retrievalAlignment`: 앞면과 뒷면의 방향이 목표에 맞는가
- `factualGrounding`: 원문 근거와 의미가 일치하는가
- `atomicity`: 단위와 카드가 판정 가능한 하나의 대상을 가지는가
- `contextSufficiency`: 필요한 조건과 범위가 보존됐는가
- `abstractionFit`: 일반화와 구체화 수준이 목표에 맞는가
- `redundancy`: 같은 의미와 방향의 반복이 없는가
- `coverageDistribution`: CardSet의 카드 분포가 학습 목표와 gold/reference가 요구하는 의미 범위의 상대적 중요도를 합리적으로 반영하는가
- `criticalFailure`: 중대한 목표 반전이나 오개념이 있는가

`coverageDistribution`은 단순 카드 수 균등성을 평가하지 않는다. 자료 분량과 학습 중요도에 따라 하위 영역별 카드 수가 달라도 되며, 특정 영역의 부당한 과대표현 또는 과소표현을 판단한다.

### 10.2 코드로 직접 확인 가능한 항목

다음은 비교적 결정적으로 검사할 수 있다.

- 필수 필드와 데이터 타입 존재
- `caseId`, LearningUnit `id`의 중복
- `status = conditional`인데 `conditions`가 없는 경우
- source evidence와 카드·LearningUnit 연결 필드 존재
- 빈 앞면·뒷면
- 동일 문자열 카드 중복
- 존재하지 않는 LearningUnit id 참조
- 허용되지 않은 status나 상위 exclusion category
- required LearningUnit별 연결 카드 수와 미연결 상태

이 검사는 구조적 이상을 찾을 뿐 의미 품질을 입증하지 않는다.

### 10.3 자동 후보 탐지 후 의미 판단이 필요한 항목

- 임베딩 또는 문자열 유사도로 중복 후보 탐지
- LearningUnit과 카드 간 semantic coverage 후보 매칭
- 원문 구절 검색을 통한 grounding 근거 후보 수집
- 길이·접속사·질문 수를 이용한 복합 카드 후보 탐지
- conditional context와 결과의 포함 여부 후보 탐지

후보 탐지는 자동화할 수 있지만 최종 판정은 문맥을 고려해야 한다.

### 10.4 LLM judge 또는 사람 판단이 필요한 항목

- 학습 목표 해석의 적절성
- 실제 인출 방향과 난이도의 적절성
- 의미적 coverage와 중요 누락
- 원문 의미 왜곡 또는 근거 없는 추가
- 원자성과 필요한 맥락의 균형
- 적절한 추상화 수준
- 예시와 핵심 지식의 역할 구분
- 의미적 중복과 CardSet coverage distribution
- case-specific rubric과 critical failure

LLM judge를 사용하더라도 사람 reference와 원문 근거를 제공해야 한다. 현재 문서는 judge prompt나 신뢰도 보정 방식을 정의하지 않는다.

## 11. EvalReference를 JSON으로 옮길 경우의 예시 Schema 초안

아래 JSON은 EvalReference 구조를 설명하기 위한 축약 예시다. EvaluationResult 예시가 아니다. production schema가 아니며 필드명, enum과 중첩 구조를 확정하지 않는다.

```json
{
  "schemaVersion": "eval-reference-v0",
  "caseId": "opic-person-description-patterns",
  "title": "OPIc 인물 묘사 패턴",
  "source": {
    "id": "opic-person-description-1",
    "type": "pdf",
    "name": "1.pdf",
    "locator": "user-provided-source",
    "pageCount": 5
  },
  "learningGoal": {
    "summary": "인물 묘사에 재사용할 영어 패턴을 생산적으로 인출한다.",
    "desiredCapability": "한국어 의미나 발화 의도를 보고 적절한 영어 템플릿을 말한다.",
    "inScope": [
      "인물 묘사의 일곱 발화 기능",
      "재사용 가능한 템플릿"
    ],
    "outOfScope": [
      "쉐도잉 수행 절차",
      "완성 스크립트의 고유 인물 정보 암기"
    ]
  },
  "expectedLearningOutcomes": [
    "인물 유형이 달라져도 일곱 발화 기능을 영어로 생성한다.",
    "구체 예시에서 공통 패턴을 추출해 재사용한다."
  ],
  "coverageGroups": [
    {
      "id": "core-speaking-functions",
      "label": "필수 인물 묘사 발화 기능"
    }
  ],
  "learningUnits": [
    {
      "id": "LU-01",
      "status": "required",
      "groupId": "core-speaking-functions",
      "semanticTarget": "말할 인물 또는 관계와 이름을 소개한다.",
      "learningIntent": "인물 묘사 답변의 도입 표현을 생산한다.",
      "retrievalExpectation": "한국어 의미 또는 발화 의도에서 영어 표현을 생성한다.",
      "sourceEvidence": [
        {
          "sourceId": "opic-person-description-1",
          "pages": [1],
          "locator": "PATTERN #1"
        }
      ],
      "abstractionPolicy": "인물 관계와 이름은 변수로 유지한다."
    },
    {
      "id": "LU-05A",
      "status": "conditional",
      "semanticTarget": "공적 인물을 처음 본 계기를 설명한다.",
      "learningIntent": "개인적 지인이 아닌 인물에 first saw 표현을 사용한다.",
      "conditions": "배우 또는 공적 인물 영역이 학습 범위에 포함될 때",
      "sourceEvidence": [
        {
          "sourceId": "opic-person-description-1",
          "pages": [4],
          "locator": "배우 완성 스크립트"
        }
      ]
    }
  ],
  "exclusions": [
    {
      "category": "out_of_scope",
      "target": "쉐도잉 목적과 방법",
      "reason": "현재 목표는 인물 묘사 영어 패턴의 생산적 인출이다.",
      "sourceEvidence": [
        {
          "sourceId": "opic-person-description-1",
          "pages": [5]
        }
      ],
      "exception": "발화 전달력 훈련이 별도 목표가 되면 포함할 수 있다."
    }
  ],
  "representativeCards": [
    {
      "relatedUnitIds": ["LU-01"],
      "front": "저는 [인물 또는 관계]에 대해 이야기하려 합니다. 그 사람의 이름은 [이름]입니다.",
      "back": "I'd like to talk about [person or relationship]. His/Her name is [name].",
      "note": "정확한 문구가 아니라 의미와 인출 방향을 보여주는 예시다."
    }
  ],
  "caseSpecificRubric": [
    {
      "id": "preserve-template-variables",
      "description": "템플릿형 목표에서는 이름, 관계와 상황 변수를 임의로 고정하지 않는다.",
      "appliesAt": ["learning_unit", "card", "card_set"]
    }
  ],
  "criticalFailures": [
    {
      "id": "reverse-production-direction",
      "scope": "case_specific",
      "category": "goal_misalignment",
      "description": "영어 생산 목표를 영어에서 한국어를 알아보는 카드로 반전한다.",
      "trigger": "CardSet이 영어 앞면과 한국어 뜻 뒷면으로만 구성된다.",
      "appliesAt": ["goal", "card_set"]
    }
  ],
  "evaluationNotes": [
    "대표 카드의 exact match와 정확한 카드 수를 요구하지 않는다.",
    "독립적인 발화 기능을 부적절하게 합치거나 의미 없이 분할하지 않는다."
  ],
  "openQuestions": [
    "점수 가중치와 통과 임계값은 아직 정의하지 않는다."
  ]
}
```

예시에는 구조 설명에 필요한 일부 LearningUnit만 넣었다. 실제 OPIc gold 전체를 JSON으로 변환한 결과가 아니다.

## 12. 아직 확정하지 않은 항목

### 점수와 통과 기준

- 공통 항목별 0·1·2점 체계를 유지할지
- 항목별 가중치를 둘지
- critical failure가 있으면 총점과 관계없이 실패로 볼지
- required coverage 몇 퍼센트를 통과로 볼지

실제 평가 결과 분포가 없으므로 확정하지 않는다.

### LearningUnit과 카드의 대응 관계

- 하나의 LearningUnit이 반드시 한 카드여야 하는지
- 하나의 LearningUnit에 여러 난이도나 방향의 카드가 허용되는 조건
- 여러 LearningUnit을 의미 있는 비교 카드 하나로 묶을 수 있는 경계

현재는 의미 없는 분할·병합만 금지하고 수량 관계를 고정하지 않는다.

### Conditional 판정 방식

- 사용자 선택과 학습 영역을 어떤 구조로 기록할지
- 조건 충족 여부를 누가 확정할지
- 조건부 단위 누락을 coverage에서 어떻게 계산할지

### Source evidence의 세밀도

- 페이지 번호만으로 충분한지
- 원문 인용, 좌표, 선택 영역 또는 이미지 근거가 필요한지
- 여러 PDF와 OCR 자료의 근거를 어떻게 통합할지

### 평가자와 신뢰도

- 사람, 단일 LLM judge 또는 다중 judge 중 무엇을 사용할지
- 평가자 불일치를 어떻게 기록할지
- judge 확신도와 판단 보류를 점수에 반영할지

### 카드 이외 학습 형태

- 자유 회상, 문제 풀이, 단계별 힌트에 같은 Card 수준을 그대로 사용할지
- 더 일반적인 `Exercise` 구조로 확장할지

현재 1차 목표가 카드이므로 미래 구조를 미리 추가하지 않는다.

### Exclusion 상위 category

제안한 다섯 category가 단어 암기와 절차 학습에도 충분한지 검증 전에는 enum을 확정하지 않는다.

## 13. 다음 Gold 사례에서 검증할 것

### 단어 암기 사례를 추가할 때

- `semanticTarget`과 `learningIntent`만으로 철자, 발음, 뜻, 용례 목표를 구분할 수 있는가
- 양방향 카드가 중복이 아니라 별도 목표가 되는 조건을 표현할 수 있는가
- 예문이 incidental detail인지 핵심 사용 지식인지 구분할 수 있는가
- exact spelling처럼 exact match가 실제로 필요한 평가 항목을 선택적으로 표현할 수 있는가

### 절차 학습 사례를 추가할 때

- 순서 의존성과 분기 조건을 하나의 LearningUnit 구조로 충분히 표현할 수 있는가
- 단계를 원자적으로 나누면서 전체 절차 맥락을 보존할 수 있는가
- 누락, 순서 반전과 안전상 위험을 critical failure로 표현할 수 있는가
- 카드보다 단계별 수행이나 문제 형식이 적합한 경우를 기록할 수 있는가

### 공통 구조 검증 질문

새 gold를 추가할 때마다 다음을 확인한다.

1. 필수 필드만으로 사람이 사례의 목표와 기대 결과를 이해할 수 있는가?
2. 새 자료 때문에 공통 필드를 추가하려는 것인지, case-specific rubric으로 충분한지 구분했는가?
3. LearningUnit의 `required`, `recommended`, `conditional`만으로 기대 수준을 표현할 수 있는가?
4. exclusion을 기존 상위 category와 구체적인 `reason`으로 설명할 수 있는가?
5. critical failure의 공통 구조로 목표 반전과 사례별 오개념을 모두 표현할 수 있는가?
6. Case/Goal, LearningUnit, Card, CardSet 네 평가 수준이 실제 오류 발생 위치를 구분하는가?
7. 대표 카드 없이도 의미적 gold를 이해할 수 있는가?
8. 자동 검사와 의미 판단의 경계가 과도한 자동화 없이 유지되는가?

두세 개의 다른 자료 유형에서도 같은 상위 구조가 반복될 때만 v0 필드를 안정적인 공통 schema 후보로 승격한다.

## 14. 과설계 방지 규칙

- 과목별 개념을 공통 enum으로 만들지 않는다.
- 사례 하나에서만 등장한 필드는 우선 `caseSpecificRubric`이나 `notes`에 둔다.
- 새로운 subtype보다 상위 category와 자연어 `reason`을 우선한다.
- 빈 값만 반복되는 선택 필드는 삭제 후보로 본다.
- 카드 수와 문구를 gold의 정체성으로 사용하지 않는다.
- 자동화하기 쉽다는 이유만으로 학습적으로 약한 지표를 핵심 점수로 삼지 않는다.
- 실제 gold 작성자가 원자료와 학습 목표를 읽고 작성할 수 있는 수준의 복잡도를 유지한다.
- 새 사례에서 반복적으로 필요성이 확인되기 전에는 production schema로 확정하지 않는다.
