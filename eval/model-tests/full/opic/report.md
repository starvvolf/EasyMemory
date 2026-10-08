# OPIc Activity Design·문제 생성 모델 하향 실험

## 결론

모델 하향 여부를 판정할 수 없었다. 현재 Terra 기준 실행과 Terra보다 한 단계 낮춘 Luna 실행이 모두 카드 생성 단계에서 똑같이 차단됐다. 동일 실패 2회 중단 규칙에 따라 추가 호출을 멈췄다.

이 결과는 Luna의 품질 저하를 뜻하지 않는다. Terra도 같은 자리에서 실패했으므로, 현재 Terra Prepare 결과의 세 번째 학습단위(`strategy-keywords`)와 카드 누출 검사 사이의 충돌이 먼저 해결되어야 한다.

## 비교 조건

| 항목 | 기준 실행 | 하향 후보 |
|---|---|---|
| Prepare | 고정된 Terra 결과 재사용 | 동일 |
| Activity Design | Terra medium | Luna medium |
| Cards | Terra medium | Luna medium |
| PDF 원본 전송 | 없음 | 없음 |
| 결과 | Cards 단계 실패 | Cards 단계 실패 |

기존 실행 도구로는 Activity Design과 Cards의 모델을 서로 다르게 지정할 수 없다. 따라서 이번에는 두 단계를 함께 Terra에서 Luna로 낮춘 묶음 후보로 비교했다. 공용 실행 도구와 프로덕션 설정은 바꾸지 않았다.

## 동일 실패

두 실행 모두 다음 이유로 최종 결과 파일 생성 전에 중단됐다.

> 3번 문제: 문제 앞면에 회상해야 할 정답이 그대로 노출되었습니다.

세 번째 학습단위는 `strategy-keywords`다. 목표는 새 표현에서 `about` 또는 `that` 뒤의 핵심 의미 단위를 실제로 찾아내는 것이다. 그런데 이 단위를 플래시카드 보조 훈련으로 바꾸는 과정에서, 앞면 질문이 찾아내야 할 규칙 자체를 말해 버리기 쉽다. Terra와 Luna 모두 같은 검사를 통과하지 못한 것은 모델 수준보다 이 학습단위의 설계와 누출 판정 경계가 원인일 가능성이 높다.

## 기존 성공 결과의 교사 관점 점검

비교 가능한 기존 성공 결과는 `opic-evidence-only-attempt-1-2026-08-16T185222205Z.json`이다. 이 결과는 Terra Activity Design과 Terra Cards로 10문제를 만들었고 기계 검사를 통과했다.

- 정확성: 7개 패턴의 영어 틀과 대명사 방향은 대체로 보존됐다.
- 목표 직접성: 패턴 1~7은 새 인물 정보를 영어 문장에 넣게 하므로 목표를 직접 연습한다.
- 패턴 보존: `I’d like to talk about`, `I especially like ... because`, `I first got to know ... when`, `Since then ... has become`, `I think ... is`가 유지됐다.
- 정답 누출: 패턴 문제의 앞면에는 변수 정보만 있고 완성 영어 문장은 뒷면에 있어 뚜렷한 누출은 없다.
- 한 문제 한 대상: 7개 패턴은 각각 한 문제로 분리됐다. 흐름 문제도 하나의 순서 구조만 묻는다.
- 남은 약점: `strategy-keywords` 문제는 새 문장에서 핵심어를 고르는 적용 문제가 아니라 “집중할 두 단어”를 외우는 보조 플래시카드다. 원래 목표보다 낮은 수준이다.

## 판정

- Activity Design·Cards의 Luna 전환: **보류**
- Terra 유지가 입증됨: **아님**
- Luna 실패가 입증됨: **아님**
- 다음 선행 작업: `strategy-keywords`처럼 직접 적용이 어려운 단위를 보조 플래시카드로 바꿀 때, 앞면이 원리를 말하더라도 실제 정답까지 노출한 것인지 구분하도록 설계와 검사를 맞춘 뒤 같은 고정 입력으로 재시험

실패 기록은 `2026-08-17-activity-cards-model-downshift-failure.json`에 저장했다.
