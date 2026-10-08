# 실제 테스트 입력 PDF

2026-09-22 사용자의 테스트 PDF 업로드 요청에 따라 원본 바이트 그대로 보존했다. 이 파일 추가는 테스트 재실행이나 품질 합격을 의미하지 않는다.

| 원래 자료 | 저장 경로 | 용도 |
| --- | --- | --- |
| 05 DFS BFS.pdf | [dfs-bfs.pdf](dfs-bfs.pdf) | 알고리즘 자료의 문제 생성 비교 |
| 강지완오픽패턴72문장_20260312.pdf | [opic-72-patterns.pdf](opic-72-patterns.pdf) | 표현 암기·인출 방향 테스트 입력 |
| Cornell David Gries, Breadth-first search | [cornell-bfs-2pages.pdf](cornell-bfs-2pages.pdf) | Gemini·NotebookLM·자체 엔진 비교 입력, 2쪽 |
| lecture8.pdf | [technical-deadlocks.pdf](../generation-quality-v1/technical-deadlocks.pdf) | 기존 파일과 바이트가 같아 중복 저장하지 않음 |

Cornell 원문: https://www.cs.cornell.edu/courses/JavaAndDS/dfs/dfs04bfs.pdf

오픽 72문장은 기존 `speaking-opic-person-description.pdf`와 다른 파일이다. 기존 평가 자료 6개는 [generation-quality-v1](../generation-quality-v1/README.md)에 있다. 노트북에서는 위 상대 경로를 사용하고 데스크톱 절대 경로를 재사용하지 않는다.

## SHA-256

```text
dfs-bfs.pdf             7bd68c1e2fbc049167489a90bea1b36cc2a867efd907f11e53fd8ac52a67da31
opic-72-patterns.pdf    4d7cfc7021c68d0db0183436c4961c8a36a271bf30ac4695e7b8b481ee1a655f
cornell-bfs-2pages.pdf  d7b3dc28448e55319baa1868d95bcebb48708f3019b7bc851e197236b34c4e62
technical-deadlocks.pdf fd8032502b90879df82d4727feb1c45ec8f4e27bbef8aa3d920c0ebd0fbdd954
```
