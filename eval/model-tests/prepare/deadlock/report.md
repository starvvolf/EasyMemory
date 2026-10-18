# 운영체제 데드락 Prepare 모델 하향 실험

## 2026-08-17 재시험

- Terra medium Prepare 성공: `model-test-prepare-terra-deadlock-r1.json`
- 공정 비교용 Sol evidence-only Prepare도 성공: `model-test-prepare-sol-deadlock-r1.json`
- 두 모델 모두 16개 ID와 source evidence를 정확히 보존했다.
- Terra의 주요 operation 차이: 자원 할당 간선 `reconstruct→discriminate`, 은행원 알고리즘 `discriminate→recall`, 탐지 `discriminate→apply`.
- Sol: 14,179 tokens / $0.217870
- Terra: 13,959 tokens / $0.084508
- 판정: 전체 범위는 통과했고 일부 목표 행동은 Terra가 더 직접적이다. 은행원 알고리즘이 단순 명칭 회상으로 낮아진 부분은 실제 문제 비교가 필요하다.

아래 내용은 크레딧 부족 전의 최초 실패 기록이다.

## 결론

이번 실행에서는 Sol baseline과 Terra candidate가 모두 Prepare API 단계의 동일한 기계 오류(`학습 자료 분석에 실패했습니다.`)로 종료되었다. 두 실행 모두 결과 artifact를 만들지 못했으므로 Terra candidate의 품질·동등성은 **판정 불가**이며, 통과로 취급하지 않는다. 지침에 따라 같은 모델을 재호출하지 않았고, candidate 통과 후에만 허용되는 Activity/Cards smoke도 실행하지 않았다.

## 고정 입력

- Frozen Plan: `eval/local/plan-prepare-v1/deadlocks-current-outline-attempt-2.json`
- PDF: frozen artifact의 `source.pdfPath`인 `eval/corpus/generation-quality-v1/technical-deadlocks.pdf`
- PDF SHA-256: `fd8032502b90879df82d4727feb1c45ec8f4e27bbef8aa3d920c0ebd0fbdd954`
- 두 실행 모두 위 artifact를 `--reuse-plan`으로 사용했다. 따라서 analyze와 plan을 새로 호출하지 않고 동일한 analyze/plan, 동일한 16개 outline leaf를 Prepare 입력으로 사용했다.
- 학습 목표와 추가 지시는 frozen artifact와 동일하게 빈 문자열이다.

## 실행 결과

| 구분 | label | Prepare 모델 / 추론 | API 시도 | 결과 artifact | 토큰 / 비용 | 판정 |
|---|---|---|---:|---|---|---|
| Sol baseline | `model-test-prepare-sol-deadlock-r1` | 기본값 `gpt-5.6-sol` / `medium` | 1회 | 없음 | 기록 불가 | 실패 |
| Terra candidate | `model-test-prepare-terra-deadlock-r1` | `gpt-5.6-terra` / `medium` | 1회 | 없음 | 기록 불가 | 실패 |

두 명령 모두 exit code 1과 `학습 자료 분석에 실패했습니다.`만 반환했다. 현재 smoke runner는 실패 응답의 세부 내용과 호출 중 수집된 usage를 파일로 보존하지 않기 때문에, 실패 호출의 토큰 수와 비용을 0으로 간주할 수 없으며 **알 수 없음**으로 기록한다. 실행 결과 파일이 없는 것도 확인했다.

API 호출은 총 2회 시도했다. 허용 상한 4회를 넘지 않았다.

## 동등성 검사

새 artifact가 없으므로 다음 candidate 조건은 모두 검사할 수 없다.

- 동일한 16 LearningUnit ID 보존
- definition / conditions / graph / prevention / avoidance / detection / recovery 범위 보존
- 각 LearningUnit의 `operation` 보존 및 적절성
- `sourceId`, `sourcePage`, `sourceRange`, `sourceText` 근거 보존

따라서 candidate는 이 실험에서 통과하지 않았다. 이것은 Terra의 품질 실패를 의미하는 것이 아니라, 비교 가능한 응답을 얻지 못했다는 의미다.

참고로 frozen 입력 자체에는 아래 16 IDs가 있고 모든 항목에 source 위치 정보가 있다.

`deadlock-definition`, `system-model`, `four-conditions`, `rag-edge-semantics`, `cycle-criterion`, `handling-framework`, `prevention-hold-wait`, `prevention-no-preemption`, `prevention-circular-wait`, `prevention-mutual-exclusion-limit`, `safe-state`, `avoidance-prior-information`, `claim-edge-transitions`, `banker-algorithm-scope`, `detection`, `recovery`

이 기준은 정의, 네 조건, 자원 할당 그래프와 사이클 판정, 예방, 회피와 안전 상태, 탐지, 복구를 모두 포함한다.

## 기존 최종 기준 확인

비교 기준 파일은 `eval/local/current-app-prepared-smoke/deadlocks-current-outline-attempt-2-2026-08-16T180554060Z.json`이다.

- 모델: Activity Design과 Cards 모두 `gpt-5.6-terra` / `medium`
- LearningUnit 16, recommendation 16, card 16
- 기계 검사 오류: 0
- 총 input 12,771 tokens, output 10,862 tokens, reasoning 1,060 tokens, total 23,633 tokens
- 추정 비용: $0.155886 (artifact의 pricingAsOf `2026-08-13` 기준)

기존 기준의 실제 판단 문제는 수작업으로 다시 검산했다.

1. **단일 인스턴스 사이클 판단:** `R1→P1→R2→P2→R1` 사이클이 있고 R1·R2가 각각 단일 인스턴스이므로 데드락이라는 정답은 맞다.
2. **안전 상태 판단:** P3에 `(1,1)`을 가상 할당하면 P3의 남은 필요량은 `(0,0)`이다. P3 완료 후 가용량이 `(1,1)`, P1 완료 후 `(2,1)`이 되어 P2도 완료할 수 있다. 따라서 요청을 허용하며 안전 순서 `P3→P1→P2`가 존재한다는 정답은 맞다.

이 검산은 기존 최종 기준의 정확성 확인일 뿐, 이번 Terra Prepare candidate의 통과 근거로 사용하지 않았다.

## 기계 오류와 후속 조건

- 공통 오류: Prepare 단계에서 `PipelineError`의 사용자용 메시지인 `학습 자료 분석에 실패했습니다.`가 발생했다.
- 응답 세부 정보가 smoke runner 출력에 노출되지 않아 모델 접근 오류, API 응답 형식 오류, 구조화 출력 검증 오류 중 어느 원인인지는 이번 기록만으로 구분할 수 없다.
- 실패 시 반복 호출 금지 지침 때문에 원인 확인을 위한 API 재시도는 하지 않았다.
- Terra candidate가 Prepare 비교를 통과하지 못했으므로 `scripts/prepared-activity-smoke.ts`는 실행하지 않았다.
