# 현재 엔진 다자료 실행 중단 기록

## 목적

사회·과학 외에 기존 품질 평가에 사용한 자료를 현재 `Activity Design → Cards` 경로로 다시 실행한다.

대상:

1. OPIc 인물 묘사
2. 운영체제 데드락
3. 권리장전
4. 달의 위상
5. 재난 체크리스트
6. 미적분 문제집
7. DFS/BFS
8. 프로그래밍 언어 입문

## 실행 조건

- 기존 Analyze·Plan·Prepare 결과를 고정한다.
- 현재 Activity Design과 축소된 Cards 출력을 실행한다.
- 모델은 `gpt-5.6-terra`, 추론 강도는 `medium`이다.
- Critic은 비활성화한다.
- 같은 실패가 2회 이상 반복되면 중단한다.

## 결과

| 자료 | 결과 | 실패 지점 |
| --- | --- | --- |
| OPIc | 중단 | Activity Design이 Prepare의 요구 행동을 변경함: `person-response-flow` |
| 데드락 | 중단 | Activity Design이 Prepare의 요구 행동을 변경함: `LU1` |
| 권리장전 | 중단 | Activity Design이 Prepare의 요구 행동을 변경함: `LU1` |
| 달의 위상 | 중단 | Activity Design이 Prepare의 요구 행동을 변경함: `LU1-달의-밝은면과-밤쪽` |
| 재난 체크리스트 | 미실행 | 동일 실패 반복으로 비용 차단 |
| 미적분 문제집 | 미실행 | 동일 실패 반복으로 비용 차단 |
| DFS/BFS | 미실행 | 동일 실패 반복으로 비용 차단 |
| 프로그래밍 언어 입문 | 미실행 | 동일 실패 반복으로 비용 차단 |

Cards 호출 전 검증에서 멈췄으므로 잘못된 문제는 생성되지 않았다. 실패한 Activity Design 호출의 usage는 현재 batch runner가 실패 결과 파일에 보존하지 않아 정확한 토큰은 이 폴더에 기록할 수 없다.

## 공통 원인

Prepare가 이미 LearningUnit의 `operation`을 확정했는데 Activity Design AI에게 같은 의미의 `terminalOperation`을 다시 작성시킨다. 프롬프트는 그대로 복사하라고 지시하지만 모델이 다른 행동으로 쓰면 `validateOneProblemBoundaries`가 전체 설계를 거부한다.

```text
Prepare
LearningUnit.operation 확정

Activity Design
같은 값을 terminalOperation으로 다시 AI 출력

검증
두 값이 다르면 전체 중단
```

이것은 자료별 특수 문제가 아니라 같은 확정값을 AI에게 중복 결정시키는 공통 구조 문제다.

## 다음 최소 수정 후보

`terminalOperation`을 Activity Design AI가 다시 결정하지 않고 서버가 LearningUnit의 `operation`에서 그대로 채운다. AI는 문제의 given·hidden·expectedResponse와 형식 설계에만 집중한다.

이 변경은 행동 기준을 완화하는 것이 아니라, 앞 단계에서 이미 확정한 기준을 뒤 단계가 바꾸지 못하게 하는 것이다. 수정 후에는 먼저 오프라인 계약 검사를 통과시키고, 실패했던 OPIc와 데드락 두 자료만 재실행한다. 두 자료가 통과한 경우에만 나머지를 순차 실행한다.

## 1차 수정과 재검증

적용한 수정:

- Activity Design의 `terminalOperation`은 AI 출력 대신 LearningUnit의 `operation`으로 고정했다.
- 한 학습단위에서 원래 설계와 통암기 보완 설계가 동시에 생기지 않도록, 직접 지원이 어려운 설계는 보완 플래시카드 하나로 교체했다.
- 한 LearningUnit → 한 Objective → 한 Blueprint → 한 문제 경계를 유지했다.

오프라인 결과:

- 생성 계약 14/14 통과
- 품질 오프라인 검사 32/32 통과
- 학습 검사 42/42 통과
- 린트와 프로덕션 빌드 통과

실제 재검증 결과:

| 자료 | 결과 | 새 실패 |
| --- | --- | --- |
| OPIc | 중단 | 직접 문제로 표시했지만 실제 요구 행동이 학습목표보다 낮음: `bp-profile-and-appearance-patterns` |
| 데드락 | 중단 | 직접 문제로 표시했지만 실제 요구 행동이 학습목표보다 낮음: `BP-LU1` |

결과 파일:

- `eval/local/generation-quality-v1/batch-activity-2026-08-16T171925725Z-summary.json`

첫 중복 결정 문제는 해결됐다. 다음 공통 문제는 AI가 `relationToObjective=direct`를 선택하면서 `elicitedOperation`은 다른 행동으로 작성한다는 것이다. 이는 실제 문제 내용을 버릴 이유라기보다 지원 관계 라벨이 잘못된 경우에 가깝다.

다음 최소 수정 후보:

```text
elicitedOperation == terminalOperation
→ direct 유지

elicitedOperation != terminalOperation
→ direct를 scaffold로 정정
```

이렇게 하면 보조 문제를 직접 훈련이라고 과장하지 않으면서 문제 설계를 버리지 않는다. 이번에도 같은 실패가 OPIc와 데드락에서 두 번 반복되어, 정해둔 중단 조건에 따라 나머지 API 실행은 하지 않았다.
