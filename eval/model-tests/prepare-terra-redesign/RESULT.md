# Prepare Terra 간결화 결과

## 적용 결정

- Prepare 기본 모델: `gpt-5.6-sol` → `gpt-5.6-terra`
- 선택 목차가 있는 제품 경로: 간결 프롬프트를 기본 사용
- 기존 긴 프롬프트: 평가용 `preparePromptMode=current`로 보존
- 호출 수: 그대로 1회
- LearningUnit 계약: 변경 없음

## 유지한 핵심

1. 선택 목차 하나 → LearningUnit 하나
2. 원문·수치·공식·관계 보존
3. target·operation·successCriterion의 행동 일치
4. 패턴의 fixedPart·variableSlots·generalizedForm 보존
5. Prepare에서는 문제를 만들지 않음

## 제거·분리한 판단

- 선택 목차를 Prepare가 다시 쪼개거나 합치게 하던 상충 지시 제거
- 원문 내용 정리를 먼저, 학습 행동 판단을 다음으로 배치
- 지식유형과 화면 호환 메타데이터는 유지하되 operation 판단에서 분리
- 실제 2호출 분리는 도입하지 않음

## 실제 결과

| 자료 | LearningUnit | 최종 문제 | 기계 오류 | 판단 |
| --- | ---: | ---: | ---: | --- |
| OPIc | 10 | 10 | 0 | 패턴 1~7과 문법 적용 유지. placeholder 정답 방지 후 정상 |
| DFS/BFS | 9 | 9 | 0 | 교사 9.2/10, 연결영역 3·최단거리 6 재검산 |
| Deadlock | 16 | 16 | 0 | r2에서 사이클·안전상태·탐지 적용 행동 회복 |

Prepare 입력 토큰은 기존 Terra 대비 OPIc 19.4%, DFS/BFS 14.2%, Deadlock 13.7% 감소했다. 출력 토큰은 각각 10.8%, 8.8%, 26.5% 감소했다.

## 일반 보완

- 구체 입력에 실행할 판정·계산 규칙이 원문에 있으면 apply를 유지한다.
- 단순 주의사항이나 위치 확인 팁은 apply로 올리지 않는다.
- 자리표시자 이름 자체를 최종 문제 정답으로 쓰지 않는다.
