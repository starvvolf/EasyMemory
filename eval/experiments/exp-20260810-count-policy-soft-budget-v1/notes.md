# Count policy soft-budget retrospective comparison

## 비교 목적

이 비교는 다음 질문을 사후 검토한다.

> hard exact count를 soft budget으로 완화했을 때 LearningUnit/CardSet coverage 손실이 줄어드는가?

두 run은 기존 production browser export를 import한 artifact다. 새 실행이 아니며 자동 평가나 gold 비교 점수를 포함하지 않는다. Recall Design이 서로 다르므로 완전한 통제 실험이 아니고, soft budget이 모든 차이의 단독 원인이라고 해석하지 않는다.

## Artifact 비교

| 항목 | Exact-count control | Soft-budget experiment |
|---|---|---|
| Run ID | `20260810T072047Z__whole-document-core__baseline__r01` | `20260810T152136Z__whole-document-core-soft-budget__baseline__r01` |
| Run mode | `whole_document_core` | `whole_document_core_soft_budget` |
| Count policy | `exact` (legacy export에 명시 필드는 없으며 hard-count 경로로 확인) | `soft_budget` |
| LearningUnit count | 22 | 26 |
| Generated Card count | 22 | 27 |
| Final Card count | 22 | 27 |
| Zero-card LU | `LU-20`, `LU-21`, `LU-22` | 없음 |
| Multi-card LU | `LU-09`: 3장, `LU-11`: 2장 | `LU26`: 2장 |
| Detection/recovery final-card coverage | `LU-20~22`: 0/3 LU, 0장 | `LU25~26`: 2/2 LU, 3장 |
| Recall Design option | `option-2` - 판정·비교 질문 → 근거를 포함한 결론 인출 | `option-1` - 핵심 용어·상황 단서 → 정의·조건·판별 규칙 재생산 |
| Recall variant | `option-2-template` - 템플릿 예시 | `option-1-template` - 일반화 템플릿 |

Count policy 표기의 `exact`는 원본 legacy export의 `countPolicy` 필드 값이 아니다. Exact run에는 해당 필드가 없으며, `whole_document_core` hard-count 경로, 22개 목표와 실제 22개 LearningUnit/Card 결과를 함께 근거로 control 정책을 식별했다. Soft run은 `inputs.json`에 `countPolicy: "soft_budget"`이 명시되어 있다.

## LearningUnit별 coverage

### Exact-count control

- `LU-09`: 3장. 사이클 없음, 단일 인스턴스 사이클, 다중 인스턴스 사이클 판정으로 분기됐다.
- `LU-11`: 2장. 예방의 기본 원리와 상호 배제 제거 한계가 각각 카드화됐다.
- `LU-20`: 0장. 데드락 발생 후 주기적 탐지 전략과 적용 범위가 최종 CardSet에서 누락됐다.
- `LU-21`: 0장. 프로세스 종료를 이용한 복구 방법 비교가 누락됐다.
- `LU-22`: 0장. 자원 선점을 통한 복구 원리가 누락됐다.

나머지 `LU-01~08`, `LU-10`, `LU-12~19`는 각각 1장이다. 총 카드 수 22장은 충족했지만 detection/recovery 세 단위의 coverage가 사라졌다.

### Soft-budget experiment

- `LU01~LU25`: 각각 1장이다.
- `LU26`: 2장. 프로세스 종료 복구와 자원 선점 복구가 별도 카드로 분리됐다.
- zero-card LearningUnit은 없다.
- Detection/recovery는 `LU25`의 탐지 카드 1장과 `LU26`의 복구 카드 2장으로 모두 카드화됐다.

LearningUnit 26개와 최종 카드 27개가 자연스럽게 달라졌으며, 1:N 변환이 다른 LearningUnit의 zero-card 누락으로 이어지지 않았다.

## Recall Design confound

Exact-count control은 `option-2`의 판정·비교형 cue-target 구조를 사용했다. Soft-budget experiment는 `option-1`의 핵심 용어·상황 단서에서 정의·조건·판별 규칙을 재생산하는 구조를 사용했다. variant도 각각 `option-2-template`, `option-1-template`으로 다르다.

따라서 Recall Design은 controlled variable이 아니다. 대표 예시도 선택된 Recall Design에 따라 달라졌다. 두 WholeDocumentCorePlan은 의미 범위와 `5·4·5·5·3` 예상 분포는 같지만 독립 생성 결과라 문구와 일부 area ID가 동일하지 않다.

## 현재 강하게 말할 수 있는 것

- Exact-count run에서는 `LU-20~22`가 최종 카드 0장이 되어 실제 CardSet coverage 손실이 발생했다.
- Soft-budget run에서는 zero-card LearningUnit이 없고 detection/recovery가 최종 카드에 남았다.
- Soft-budget run에서는 LearningUnit 26개와 최종 카드 27개가 달라져, LU 수와 Card 수의 1:1 강제가 적용되지 않았다.
- Exact-count run의 22장과 soft-budget run의 27장은 각각 실제 stage artifact와 observations가 일치한다.

## 현재 확정하면 안 되는 것

- 현재 soft budget의 `min/max` 범위가 최적이라는 결론
- 모든 카드 품질 개선이 count policy 변경 때문이라는 인과 주장
- soft budget이 모든 자료 유형과 학습 목표에서 항상 우수하다는 일반화
- Recall Design을 동일하게 고정한 재실행에서도 같은 차이가 재현된다는 주장

다음 인과 검증에는 동일 Recall Design, 동일 plan artifact 또는 동등한 고정 입력과 반복 run이 필요하다. 이번 문서는 기존 두 run의 관찰 결과를 연결할 뿐 새로운 실험을 실행하지 않는다.
