# 모델 단계별 하향 실험 종합

## 최종 결론

| 단계 | 현재 | 후보 | 판정 |
| --- | --- | --- | --- |
| Analyze | Terra medium | Luna medium | 이번 실험에서 미실행. 원본 PDF 재전송이 필요한 별도 비교다. |
| Plan | Terra medium | Luna medium | 이번 실험에서 미실행. 현재 전체 문서 Plan은 원본 PDF를 다시 첨부한다. |
| Prepare | Sol medium | Terra medium | 통과 가능성이 높음. 3자료 모두 범위·근거 보존. 실제 문제 검증 전 제품 변경은 보류. |
| Activity Design | Terra medium | Luna medium | 거절. DFS/BFS와 데드락에서 계산·판단 오류 발생. |
| Cards | Terra medium | Luna medium | 조건부 통과. DFS/BFS·데드락은 품질 유지, OPIc는 공통 누출 검사 충돌로 미판정. |
| Critic | 비활성 | - | 계속 비활성 유지. |

## 자료별 결과

### OPIc

- Prepare Terra: 10/10 학습단위와 패턴 1~7 보존.
- Activity+Cards Terra/Luna: 둘 다 `strategy-keywords`의 3번 문제에서 같은 정답 노출 검사로 중단.
- 모델 차이가 아니라 학습단위의 적용 목표를 보조 플래시카드로 낮추는 설계와 누출 검사의 충돌이다.
- 동일 실패 2회 기준에 따라 추가 호출하지 않았다.

### DFS/BFS

- Prepare Terra: 9/9 학습단위와 근거 보존.
- Activity Luna: 거절. 새 BFS 문제 정답을 7로 만들었으나 실제 정답은 8.
- Activity Terra에도 별도 연결 영역 정답 오류가 있어 계산형 정답 검산은 모델과 별개의 공통 약점이다.
- Cards Luna: 고정된 정확한 Terra Activity를 사용했을 때 9/9, 숫자 정답, 구조 순서, 누출 검사를 모두 통과.

### Deadlock

- Prepare Terra: 16/16 학습단위와 근거 보존.
- Activity Luna: 거절. 적용/판단 목표 두 개를 회상으로 낮추고 다중 인스턴스 사이클을 데드락으로 단정하는 오류 발생.
- Cards Luna: 첫 실행은 구조복원 ID 형식 오류, 두 번째는 16/16 정확성과 커버리지 통과.

## 제품 적용 판단

지금 바로 바꿀 수 있는 확정 설정은 없다.

1. Prepare의 Terra 전환은 비용과 범위 측면에서 유리하지만, 현재 세 자료의 downstream 결과가 동일한 고정 조건으로 모두 성공한 것은 아니므로 아직 프로덕션 설정을 바꾸지 않는다.
2. Activity Design은 Terra를 유지한다. Luna는 계산·판단이 필요한 문제 설계에서 의미 있는 품질 저하가 확인됐다.
3. Cards는 Luna 후보 가치가 높다. 다만 OPIc 미판정과 데드락 1회 형식 오류가 있으므로 한 종류 이상의 언어 자료를 추가로 통과한 뒤 전환한다.
4. 계산형 문제는 모델 선택보다 먼저 정답을 코드로 재검산하거나 검증 가능한 입력만 만들도록 하는 공통 보완이 필요하다.

## 상세 보고서

- `eval/model-tests/prepare/SUMMARY.md`
- `eval/model-tests/full/opic/report.md`
- `eval/model-tests/prepare/dfs-bfs/full-model-test-report.md`
- `eval/model-tests/prepare/deadlock/stage-model-report.md`
