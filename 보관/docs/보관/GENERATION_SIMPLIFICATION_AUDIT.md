# 생성엔진 덜어내기 점검

> 목표는 핵심 기능을 줄이는 것이 아니라, 핵심 결과에 기여하지 않으면서 단계·상태·입력·유지보수만 늘리는 부분을 찾는 것이다.  
> 이 문서는 제거 후보를 정리한 것이며 아직 프로덕션 코드를 삭제하지 않는다.

- 점검일: 2026-08-17
- 판단 기준: 실제 앱 호출 경로, 문제 품질 기여, 중복 데이터, 이전 저장 데이터 영향

## 이번 정리에서 완료

- 화면의 Recall Design 상태·호출·대표 예시 패널 제거
- 새 덱에 Recall Design을 다시 저장하던 코드 제거
- `/api/recall-design` 제거
- `/api/generate`의 `sample`, `full` 단계 제거
- 제품 요청의 `recallDesign`, `approvedSample`, `sampleFeedback` 제거
- `cards` 요청에 Activity Design 필수화
- 운영 흐름도를 현재 `Analyze → Plan → Prepare → Activity Design → Cards`에 맞게 수정
- 기본 비활성 Critic을 사용자 흐름도에서 제거하고 내부 평가 코드는 유지

각 묶음 뒤에 생성 계약, 품질 오프라인 검사, 학습 검사, 린트와 프로덕션 빌드를 실행했으며 품질 계약 변화는 없었다.

## 데이터 구조 축소 A/B 결과

축소 전 엔진과 사회·과학 출력은 `eval/snapshots/2026-08-17-pre-data-structure-shrink/`에 체크섬과 함께 보존했다.

### 유지

- Activity Design의 `supportAssessments`와 고정 `policy`는 추천 결과와 Blueprint에서 다시 계산되므로 출력에서 제거했다.
- Activity Design JSON은 기존 결과 기준 사회 16.3%, 과학 14.5% 줄었다.
- 생성 계약과 카드 입력 의미는 유지됐다.

### 되돌림

- Prepare의 `knowledgeType`, `primaryKnowledgeType`, `fixedPart`, `variableSlots`, `rationale` 제거를 실제 사회·과학 전체 경로로 시험했다.
- 비용은 소폭 줄었지만 사회의 GDP 범위와 과학의 스펙트럼 학습 범위가 흔들렸다.
- 정한 중단 조건에 따라 이 축소는 되돌렸고 Prepare 프롬프트와 출력 계약을 기준 버전으로 복원했다.

## 결론

가장 먼저 덜어낼 수 있는 것은 새로운 기능이 아니라 **현재 화면에서 이미 사용하지 않는 이전 생성 흐름 한 묶음**이다.

```text
정리 우선 후보
Recall Design
→ 대표 예시
→ sample
→ 옛 cards/full 생성
```

현재 핵심 흐름은 아래만으로 동작한다.

```text
Analyze → Plan → Prepare → Activity Design → Cards
```

## 1순위: 함께 정리할 이전 흐름

### Recall Design과 대표 예시 선택

정리 전:

- 화면 함수에 `/api/recall-design` 호출과 대표 예시 선택 코드가 남아 있었다.
- 코드 주석상 주 흐름에서 의도적으로 분리된 상태였다.
- 관련 상태인 `recallDesign`, `selectedRecallOption`, `learningSample`, `sampleFeedback`도 남아 있었다.

문제:

- 지금의 Activity Design과 역할이 겹친다.
- 다시 연결되면 PDF와 긴 입력을 한 번 더 보낼 수 있다.
- 개발자가 어느 생성 경로가 진짜인지 혼동하게 한다.

처리:

- 관련 화면 상태·함수·제품 API를 한 묶음으로 제거했다.
- 기존 덱의 선택적 recallDesign 필드는 읽기 호환을 위해 공용 타입에 남겼다.

### sample 단계와 sampleFeedback

현재:

- `/api/generate`에 `sample` 단계와 대표 예시 피드백 계약이 남아 있었다.
- 현재 주 생성 경로에서는 사용하지 않았다.
- 실험 runner 일부는 아직 이 옛 계약을 사용한다.

문제:

- 프로덕션 API가 두 세대의 입력을 동시에 받아야 한다.
- 테스트가 핵심 흐름이 아니라 옛 흐름을 계속 보존하게 만든다.

처리:

- 제품 요청에서는 제거했다. 과거 평가 runner는 재현용으로 남겼다.

### full 생성 단계

현재:

- `full`은 Activity Design을 거치지 않는 별도 생성 경로였다.
- 현재 사용자 성공 경로는 `prepare → activity-design → cards`다.

문제:

- 같은 앱에서 서로 다른 품질 규칙으로 문제가 만들어질 수 있다.
- 새 1:1 문제단위 규칙을 우회할 수 있다.

처리:

- 제품 API에서 제거했고, `cards`는 Activity Design 없이는 실행되지 않게 차단했다.
- 여러 단계를 한 요청으로 숨기는 대체 full 경로는 만들지 않았다.

## 2순위: 없애기보다 먼저 합칠 수 있는지 측정

### LearningObjective

현재:

- LearningUnit 하나마다 Objective 하나를 정확히 만들고 있다.
- target, operation, success criterion 상당 부분이 겹친다.
- Objective의 뚜렷한 추가값은 중요도와 문제 설계용 표현이다.

가능한 단순화:

- Blueprint가 LearningUnit을 직접 참조하고 중요도만 추가하면 Objective 계층을 없앨 수 있다.

지금 바로 안 하는 이유:

- 공용 타입, AI 출력 형식, UI, 압축 입력, 실험 파일을 함께 바꿔야 한다.
- 실제 토큰 절감량을 아직 측정하지 않았다.

판단 조건:

- Objective의 고유 정보가 중요도 외에 거의 없는지 5종 이상 결과로 확인하고, 입력 크기 감소가 의미 있을 때만 합친다.

### SupportAssessment와 ActivityRecommendation

현재:

- Blueprint, 지원 평가, 최종 추천이 문제 방식·지원 수준·포함 여부를 나누어 보관한다.
- 추적에는 좋지만 ID와 이유가 반복된다.

가능한 단순화:

- `Blueprint + 사용자 선택`만 저장하고 지원 수준과 기본 포함 여부는 서버에서 계산한다.

지금 바로 안 하는 이유:

- 자동 흐름과 수동 흐름의 차이를 현재 이 데이터가 설명한다.
- 먼저 실제 중복 크기와 UI 사용 필드를 확인해야 한다.

### knowledgeType과 CardStrategy

현재:

- Prepare가 호환용으로 knowledgeType을 만들지만, 프롬프트도 이를 문제 방식 결정에 쓰지 말라고 명시한다.
- CardStrategy는 생성 결과와 일부 UI 라벨에 남아 있다.

문제:

- `operation`, 문제 형식, strategy, knowledgeType이 비슷해 보이지만 서로 다른 이름으로 존재한다.

판정:

- knowledgeType 제거는 실제 A/B에서 핵심 범위 변동이 확인되어 현재 유지한다.
- CardStrategy는 이번 실험에서 건드리지 않았다. 별도 출력 비교 없이 함께 제거하지 않는다.

## 3순위: 지금은 유지

### OrganizedMaterial

LearningUnit 내용과 일부 중복되지만 사용자가 문제 생성 전에 내용을 수정하고 제외하는 실제 검토층이다. 현재는 없애지 않는다.

### Critic 코드

현재 기본값은 꺼져 있어 API 비용을 발생시키지 않는다. 코드와 프롬프트가 크지만 품질 실험에서 다시 사용할 수 있으므로 당장 삭제하지 않는다. 장기적으로 프로덕션 생성과 분리된 평가 도구로 옮기는 것이 더 단순하다.

### problemDesignAdvice

OPIc와 데드락 실험에서 누락된 핵심을 회복하는 효과가 확인됐다. 자유입력이라는 이유만으로 제거하지 않는다. 자동 추천 품질이 올라가면 접을 수 있는 보조 입력으로 유지한다.

### source 근거와 preflight

정답 정확성, 사용자 검토, 잘못된 문제의 API 호출 전 차단에 직접 기여하므로 유지한다.

## 실제 절감 효과를 과장하면 안 되는 부분

- Recall Design과 sample은 현재 주 흐름에서 호출되지 않으므로 제거해도 **현재 한 번의 생성 토큰 비용이 바로 줄지는 않는다.**
- 이들을 제거하면 코드·상태·테스트·설명 복잡성과 잘못된 경로 재사용 위험이 줄어든다.
- 현재 호출 비용을 줄이려면 Activity Design과 Cards에 반복되는 Objective·Blueprint·지원 평가·원문 데이터를 측정해 줄여야 한다.
- 이미 적용된 공통 원문 페이지 1회 전달은 실제 입력 중복을 줄이는 변경이다.

## 추천 정리 순서

1. 기존 저장 덱을 읽을 때 필요한 Recall 관련 필드와 평가 도구 전용 코드를 구분한다.
2. 과거 결과 재현이 필요 없어진 시점에 `pipeline/recall.ts`와 옛 CardContract 평가 경로를 보관소로 옮긴다.
3. Objective·SupportAssessment 중복 크기를 실제 결과 5종으로 측정한다.
4. 의미 손실 없이 25% 이상 줄어드는 경우에만 계약을 합친다.
5. 같은 사회·과학 자료를 다시 생성해 문제단위·행동·정확성이 유지되는지 확인한다.

## 이번에 일부러 하지 않는 것

- 현재 잘 동작하는 Analyze·Plan·Prepare·Activity Design·Cards 재작성
- 저장 덱 형식의 즉시 마이그레이션
- Objective와 지원 평가의 근거 없는 즉시 삭제
- Critic 재활성화
- 자료 주제별 제거 규칙 추가

## 2026-08-17 문제 생성 전달량 축소

Prepare와 Activity Design의 핵심 판단은 유지하고, Cards 호출에서 AI가 판단할 필요가 없는 반복 데이터만 제거했다.

- 문제 생성 입력에서 objective/blueprint ID, 출처 복사본, 추천 이유를 제거했다.
- 문제 생성 출력은 질문·정답·원문 근거·전략·난이도·짧은 설명만 받는다.
- 출처, ID, 추천 이유, 태그, 빈 호환 필드와 품질 상태는 서버가 기존 데이터에서 복원한다.
- 네 문제 형식은 형식별 출력 구조를 사용해 사용하지 않는 빈 필드를 AI가 반복 출력하지 않는다.

동일한 앞 단계 결과를 고정한 실제 비교:

| 자료 | 기존 Cards 토큰 | 축소 Cards 토큰 | 감소 | 문제 수 | 기계 오류 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 학생용 사회 | 12,480 | 9,347 | 25.1% | 12 → 12 | 0 |
| 학생용 과학 | 12,545 | 9,671 | 22.9% | 10 → 10 | 0 |

질문·정답·형식과 핵심 범위는 비교 결과에서 유지됐다. 과학 실행은 입력 캐시가 적용되어 비용 비교에는 캐시 효과가 섞였으므로, 토큰 수를 주 비교값으로 삼는다.

추가로 JSON 들여쓰기를 제거한 실험은 과학 Cards 토큰을 8,076까지 낮췄지만, 별의 질량과 생성 가능한 원소 질량의 관계가 문제에서 빠졌다. 품질 저하로 판정해 해당 변경은 되돌렸다.
