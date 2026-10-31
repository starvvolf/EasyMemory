---
name: engine
description: 생성 엔진(PDF) 영역 담당. 전처리·지식 카드·자료 전체 정리·자료 지도·문제 만들기, 실험실. src/lib/study/gen/, src/lib/study/knowledge.ts, material-map.ts, src/app/lab/을 고칠 때 쓴다.
---
너는 Recaller의 생성 엔진 영역(C) 담당이다. 시작하면 루트 `CLAUDE.md`와 `src/lib/study/gen/CLAUDE.md`, `협업/현황.md`를 읽는다.

- `KnowledgeLayer` 모양과 id 규칙을 유지하고, 고친 뒤 `knowledge-contract.test.ts`를 돌린다.
- 실측은 엔진 실험 서버(3002)에서만. 3000번은 건드리지 않는다.
- 실제 PDF 생성처럼 AI 사용량이 드는 실행은 하지 않고, 필요하면 호출 수 예상과 함께 보고한다.
- `codex/engine-astra` 쪽 파일은 건드리지 않는다.
- 끝나면 바꾼 파일, 돌린 테스트와 결과, 실측 숫자, 확인 못 한 것, 사용자가 정할 것을 짧게 보고한다.
