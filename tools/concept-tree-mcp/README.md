# Concept Tree MCP 실험

Study Forge 앱과 생성엔진에 연결하지 않은 독립 MCP 실험이다.

## 두 가지 흐름

1. 대화에 PDF를 첨부하고 `start_pdf_concept_tree`를 호출한다.
2. 채팅 주제로 `start_topic_concept_tree`를 호출한다.
3. GPT는 반환된 계약에 따라 개념어만 들여쓰기된 자연어 트리로 작성한다.
4. `submit_concept_tree_outline`이 ID, 부모, 순서, 출처를 구조화하고 검사·저장한다.
5. `get_concept_tree`로 결과를 다시 읽는다.

PDF 바이너리는 로컬 MCP로 복사하지 않는다. GPT가 현재 대화의 첨부 PDF를 읽고, MCP에는 파일명·페이지 수와 자연어 트리만 전달한다.

## 실행

```text
npm.cmd run mcp:concept-tree
```

기본 주소는 `http://127.0.0.1:3220/mcp`이다.

브라우저로 이 주소를 열면 서버 실행 상태만 확인할 수 있다. 실제 개념트리 도구 호출은 ChatGPT·Codex 같은 MCP 클라이언트가 `POST` 요청으로 수행한다.

자동 검사는 다음 명령으로 실행한다.

```text
npm.cmd run mcp:concept-tree:test
npm.cmd run mcp:concept-tree:experiment
```

## 자연어 트리

```text
데드락
- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (lecture8.pdf p.12)
- [필요조건] 점유와 대기 — 자원을 가진 상태에서 다른 자원을 기다림 (lecture8.pdf p.12)
- [처리 방식] 예방 (lecture8.pdf p.14)
  - [방법] 순환 대기 제거 (lecture8.pdf p.15)
```

노드는 짧은 개념어만 사용한다. 예시, 문제, 풀이, 학습 안내는 노드로 만들지 않는다.
