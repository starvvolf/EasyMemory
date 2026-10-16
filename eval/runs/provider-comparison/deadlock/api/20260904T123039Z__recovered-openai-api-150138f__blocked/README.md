# OpenAI API 독립 기준 실행 결과: 호출 전 차단

## 결과

- 상태: `blocked_before_execution`
- OpenAI API 요청 수: 0
- 원본 단계 출력: 없음
- 최종 문제: 없음
- 토큰 사용량: 입력 0, 출력 0, 합계 0
- API 처리 시간: 0ms
- 결과를 손으로 생성하거나 다른 모델/Codex/MCP 결과로 대체하지 않았다.
- MCP 결과 폴더는 읽거나 수정하지 않았다.

실제 실행 명령은 외부 전송 보안 검토에서 프로세스 시작 전에 거부됐다. 고정 PDF
원문을 OpenAI Responses API로 보내는 행위에 대해, 경로와 목적지를 알린 뒤 사용자가
별도로 명시 승인해야 한다는 판정이다. 따라서 API 키 유무나 모델 가용성까지는
검증되지 않았고 네트워크 요청도 발생하지 않았다.

## 선택한 복구 기준

`150138f73301365b7d07fbfab4b8093c8f4409ca`를 선택했다.

- `150138f`와 `115c895`는 동일 부모 `fda889e`의 형제 스냅샷이다.
- 모델 설정, recall, 평가 runner는 두 후보에서 동일하다.
- `115c895`에는 MCP 테스트와 route, schema export, `sourceId` 호환 변경이 추가되어
  있다.
- `150138f`는 해당 MCP 결합이 없어 “Codex/MCP 전환 직전 API 기준”을 더 엄격하게
  격리한다.
- 2026-08-17 기록은 `gpt-5.6-terra / medium`, Critic 비활성 및 카드 출력 계약
  축소가 실제 사회·과학 결과에서 유지됐다는 품질 근거로 사용했다. 후보 코드를
  8월 17일 파일과 혼합하지 않았다.

## 복구되는 단계와 계약

선택 커밋의 전체 평가 runner를 그대로 사용해 다음 순서로 실행한다.

1. Analyze
2. Whole-document core Plan
3. Recall Design
4. Prepare (`LearningUnit`, `OrganizedMaterial`)
5. Cards
6. Critic passthrough (당시 기본값대로 비활성)
7. Final cards

모든 생성 호출은 `gpt-5.6-terra`, reasoning effort `medium`이다. 구조화 출력의
JSON Schema는 선택 커밋의 각 pipeline 파일에서 그대로 읽는다.

## 재현 명령

```powershell
node tools/api-generation-baseline/run.mjs `
  --pdf "C:\Users\jkh01\OneDrive\바탕 화면\학교\운영체제시험\lecture8.pdf" `
  --env-file "C:\Users\jkh01\OneDrive\문서\CD0625\.env.local" `
  --node-modules "C:\Users\jkh01\OneDrive\문서\CD0625\node_modules"
```

외부 전송이 명시 승인된 뒤 이 명령을 정확히 한 번 실행해야 한다. 성공 시 단계별
원본 출력, 최종 문제 전체, 모델 설정, 사용량, 호출별·전체 소요시간이 같은 API
결과 루트의 새 run ID 아래에 기록된다.
