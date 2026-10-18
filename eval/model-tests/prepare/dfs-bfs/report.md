# DFS/BFS Prepare model test report

## 2026-08-17 재시험

- Terra medium Prepare 성공: `model-test-prepare-terra-dfs-bfs-r1.json`
- 9개 선택 leaf를 같은 9개 LearningUnit ID로 보존했고 모든 source evidence를 유지했다.
- operation 차이: `graph-basics`는 `recall→reconstruct`, `graph-representations`는 `apply→reconstruct`; 나머지 7개는 동일하다.
- Sol: 14,188 tokens / $0.226440
- Terra: 12,484 tokens / $0.070128
- 판정: DFS/BFS 절차와 두 적용 단위는 보존됐다. 그래프 기초·표현 비교가 실제 문제에서 과도한 구조복원으로 바뀌는지 후속 확인이 필요하다.

아래 내용은 크레딧 부족 전의 최초 실패 기록이다.

## 결론

`gpt-5.6-terra` medium 후보 Prepare는 실행되지 않았다. 격리 환경 안의 첫 실행은 `학습 자료 분석에 실패했습니다.`로 종료되었고 결과 파일과 사용량 레코드를 남기지 않았다. 동일 실행을 외부 API에 허용해 달라는 승격 요청도 승인되지 않았다. 실패 후 반복 호출하지 말라는 조건에 따라 더 시도하지 않았다.

따라서 Terra Prepare가 기준선의 9개 ID, operation, PDF 근거를 보존하는지 판정할 수 없으며, 통과 조건이 충족되지 않았으므로 `scripts/prepared-activity-smoke.ts`도 실행하지 않았다. 모델 하향의 채택 여부는 **판정 보류**다.

## 고정 입력과 실행 상태

- PDF: `eval/local/sources/7bd68c1e2fbc049167489a90bea1b36cc2a867efd907f11e53fd8ac52a67da31.pdf`
- SHA-256: `7bd68c1e2fbc049167489a90bea1b36cc2a867efd907f11e53fd8ac52a67da31`
- frozen Analyze/Plan: `eval/local/plan-prepare-v1/dfs-bfs-current-outline-attempt-1.json`
- 후보 label: `model-test-prepare-terra-dfs-bfs-r1`
- 후보 설정: `gpt-5.6-terra`, reasoning `medium`
- 후보 출력 예정 경로: `eval/local/plan-prepare-v1/model-test-prepare-terra-dfs-bfs-r1.json`
- 후보 출력: 생성되지 않음
- API 한도 3회 중 기록된 성공 호출: 0회
- 후보 토큰/비용: 사용량 레코드가 없어 0으로 간주할 수 없으며, 측정 불가

## Prepare 기준선

기준선은 `eval/local/plan-prepare-v1/dfs-bfs-evidence-only-attempt-1.json`의 Sol medium Prepare다.

| 항목 | 기준선 | Terra 후보 |
|---|---:|---:|
| 학습단위 수 | 9 | 측정 불가 |
| 입력 tokens | 7,968 | 측정 불가 |
| 출력 tokens | 6,220 | 측정 불가 |
| reasoning tokens | 856 | 측정 불가 |
| 총 tokens | 14,188 | 측정 불가 |
| 추정 비용 | $0.226440 | 측정 불가 |

기준선 unit IDs:

1. `graph-basics` — `recall`
2. `graph-representations` — `apply`
3. `grid-as-graph` — `apply`
4. `dfs-procedure` — `reconstruct`
5. `dfs-recursion` — `reconstruct`
6. `bfs-procedure` — `reconstruct`
7. `bfs-deque` — `reconstruct`
8. `components-dfs` — `apply`
9. `shortest-path-bfs` — `apply`

기준선에는 각 unit마다 `sourceId`, `sourcePage`, `sourceRange`, `sourceText`가 존재한다. 특히 적용 문제인 `components-dfs`는 p.16~18의 연결 영역 DFS 규칙을, `shortest-path-bfs`는 p.19~21의 첫 방문 거리 갱신 규칙을 근거로 유지한다. 후보 파일이 없으므로 9 IDs 유지 및 graph/DFS/BFS/격자 operation·근거 손실 0 조건은 검증하지 못했다.

## 기준 최종 9문제

기준 최종 결과는 `eval/local/current-app-prepared-smoke/dfs-bfs-evidence-only-attempt-1-2026-08-16T184959962Z.json`이다.

1. `graph-basics`: 노드의 다른 이름과 간선으로 연결된 두 노드의 관계를 묻는다. 답: 노드(정점), 간선, 인접.
2. `graph-representations`: 희소 그래프에서 메모리 절약이 우선일 때 표현 방식을 묻는다. 답: 인접 리스트.
3. `grid-as-graph`: 격자의 칸과 허용 이동을 그래프 요소에 대응시킨다. 답: 칸은 노드, 이동 관계는 간선.
4. `dfs-procedure`: 스택 DFS의 시작, 반복, 최상단 확인, 미방문 이웃 진행, 되돌아감 순서를 배열한다.
5. `dfs-recursion`: 현재 노드 방문 처리 후 인접 목록을 순회하고 미방문 노드에 재귀 호출하는 골격을 회상한다.
6. `bfs-procedure`: 큐 BFS의 시작, 반복, 앞 노드 제거, 미방문 이웃 삽입, 삽입 즉시 방문 처리 순서를 배열한다.
7. `bfs-deque`: `append`, `popleft`, 삽입 즉시 방문 처리라는 deque 구현 골격을 회상한다.
8. `components-dfs`: `11000 / 10010 / 00110 / 00001` 격자의 상하좌우 연결 영역 수를 구한다. 답: 3.
9. `shortest-path-bfs`: `S110 / 0101 / 0111 / 000G` 격자의 최소 이동 횟수를 구한다. 답: 6.

기준 최종 사용량은 Activity Design 7,498 tokens/$0.056106, Cards 7,685 tokens/$0.034870으로 합계 15,183 tokens/$0.090976이다. Prepare까지 합친 기준 전체는 29,371 tokens/$0.317416이다. 자동 검사 결과는 9 units, 9 recommendations, 9 cards, `machineIssues: []`다.

## 숫자 정답 직접 재검산

### 연결 영역

격자의 1은 다음 세 묶음으로 분리된다.

- 좌상단: `(0,0), (0,1), (1,0)`
- 중앙·우측: `(1,3), (2,3), (2,2)`
- 우하단: `(3,4)`

상하좌우 연결 영역 수는 **3**이며 카드 답과 일치한다.

### 최단 거리

유효한 최단 경로 한 개는 다음과 같다.

`S(0,0) → (0,1) → (1,1) → (2,1) → (2,2) → (2,3) → G(3,3)`

간선 수, 즉 시작 거리를 0으로 둔 이동 횟수는 **6**이며 카드 답과 일치한다.

다만 기준 Activity blueprint의 hidden 정답 설명에는 `(0,2) → (1,2)`를 지나는 경로가 적혀 있는데 `(1,2)`는 `0101`의 세 번째 값인 벽(0)이다. 숫자 6은 맞지만 예시 경로는 잘못되었다. 이 오류는 최종 카드의 앞·뒤에는 노출되지 않았고 기존 기계 검사도 잡지 못했다. 따라서 기준선의 실제 수동 검토 결과는 `machineIssues: []`와 별개로 **hidden 해설 오류 1건**이다.

## 비교 판정

- ID 보존: 후보 없음 — 판정 불가
- graph/DFS/BFS/격자 operation 보존: 후보 없음 — 판정 불가
- PDF 근거 손실: 후보 없음 — 판정 불가
- Activity/Cards 9문제 유지: 후보 Prepare 미통과 — 미실행
- 토큰/비용 절감: 후보 사용량 없음 — 판정 불가
- 기준선 자체 오류: 숫자 정답은 모두 맞지만 최단 경로 hidden 예시 1건이 벽을 통과함

후속 실험은 외부 API 실행이 명시적으로 허용된 환경에서 같은 label 또는 충돌 없는 새 label로 Prepare 1회만 실행한 뒤, 9 IDs와 근거·operation을 먼저 확인해야 한다. 그 조건을 통과할 때만 Activity/Cards를 실행해야 한다.
