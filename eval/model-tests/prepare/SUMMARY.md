# Prepare Sol→Terra 1차 병렬 실험 결과

## 2026-08-17 재시험 결론

크레딧 충전 후 동일한 고정 입력으로 재시험했으며 세 Terra Prepare가 모두 성공했다. PDF 원본은 보내지 않았고 Analyze·Plan에서 고정한 선택 근거만 입력했다.

| 자료 | Sol 기준 총 토큰 | Terra 총 토큰 | Sol 추정 비용 | Terra 추정 비용 | 범위 보존 |
| --- | ---: | ---: | ---: | ---: | --- |
| OPIc | 9,806 | 9,301 | $0.148080 | $0.053172 | 10/10 ID |
| DFS/BFS | 14,188 | 12,484 | $0.226440 | $0.070128 | 9/9 ID |
| Deadlock | 14,179 | 13,959 | $0.217870 | $0.084508 | 16/16 ID |

세 후보 모두 학습단위 ID와 원문 근거를 보존했다. Terra의 비용 감소는 OPIc 64.1%, DFS/BFS 69.0%, Deadlock 61.2%다. 총 토큰 감소는 각각 5.2%, 12.0%, 1.6%로 작거나 중간 수준이며, 비용 절감의 대부분은 모델 단가 차이에서 온다.

품질상 즉시 탈락할 누락은 없지만 operation 분류가 일부 달라졌다. OPIc의 문법 규칙은 `apply→recall`, DFS/BFS의 그래프 기초는 `recall→reconstruct`, 인접 표현 비교는 `apply→reconstruct`, Deadlock의 은행원 알고리즘은 `discriminate→recall`로 바뀌었다. 반대로 자원 할당 간선은 `reconstruct→discriminate`, 탐지는 `discriminate→apply`로 더 직접적인 행동이 됐다. 이 차이는 Prepare 단독 결과만으로 우열을 확정하기 어려우므로 다음 단계에서 실제 문제를 만들고 비교해야 한다.

**현재 판정: Prepare의 기본 후보로 Terra를 채택할 가능성이 높다. 다만 프로덕션 모델 전환은 보류하고, 동일 세 자료의 Activity/Cards 결과가 기준선보다 나빠지지 않는지 먼저 확인한다.**

생성 결과:

- `eval/local/plan-prepare-v1/model-test-prepare-terra-opic-r1.json`
- `eval/local/plan-prepare-v1/model-test-prepare-terra-dfs-bfs-r1.json`
- `eval/local/plan-prepare-v1/model-test-prepare-terra-deadlock-r1.json`
- `eval/local/plan-prepare-v1/model-test-prepare-sol-deadlock-r1.json`

## 이전 차단 기록

## 판정

모델 품질 비교는 완료되지 않았다. `gpt-5.6-terra` 후보뿐 아니라 공정 비교용 `gpt-5.6-sol` 제어 실행도 같은 `학습 자료 분석에 실패했습니다.` 오류로 종료됐다. 따라서 Terra의 품질 실패로 분류하지 않고 공통 실행/API 차단으로 기록한다.

## 실행 결과

| 실행 | 모델 | 결과 파일 | 결과 |
| --- | --- | --- | --- |
| OPIc candidate | Terra medium | 없음 | 동일 오류 |
| DFS/BFS candidate | Terra medium | 없음 | 동일 오류 |
| Deadlock baseline | Sol medium | 없음 | 동일 오류 |
| Deadlock candidate | Terra medium | 없음 | 동일 오류 |

- 네 실행 모두 약 1초 안에 종료됐다.
- 성공 응답과 usage가 없어 실제 토큰·비용은 측정할 수 없다. 0으로 간주하지 않는다.
- 기존 기준 결과는 덮어쓰지 않았다.
- 같은 실패가 2회를 넘었으므로 추가 API 호출을 중단했다.
- Activity Design·Cards 후보 실행도 시작하지 않았다.

## 병렬 점검에서 얻은 별도 품질 발견

기존 DFS/BFS 기준 카드의 최단거리 정답 `6`은 맞다. 그러나 Activity Blueprint의 hidden 설명에 `(0,2) → (1,2)`를 통과하는 예시 경로가 있고 `(1,2)`는 벽이다. 최종 카드에는 이 잘못된 경로가 노출되지 않았지만, 기존 기계 검사는 내부 정답 설명의 경로 유효성을 확인하지 못했다.

## 다음 재개 조건

이번 묶음은 중단 상태다. 재개한다면 모델 비교보다 먼저 실패 응답의 상세 상태를 결과 파일에 보존하도록 평가 실행기를 보완하고, 사용자 지시가 있을 때 API 동시 실행 수를 1~2로 낮춰 공통 실행 실패인지 확인해야 한다. 같은 입력을 현재 상태에서 단순 재호출하지 않는다.
