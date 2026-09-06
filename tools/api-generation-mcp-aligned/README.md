# OpenAI API · MCP 흐름 정렬 실행기

OpenAI Responses API가 Study Forge 최신 MCP와 같은 생성 흐름을 실행하는 독립 비교
도구다. 프로덕션 UI나 활성 생성 공급자를 바꾸지 않는다.

```text
Analyze(목차만)
→ Concept Tree
→ Learning Design
→ Activity Design
→ Cards
→ 기존 MCP 서버 파서·조립·검증
```

`ChatGptParityService`의 공개 `startRun → getNextStage → submitStage → getResult`
경로를 직접 사용한다. 단계 순서, 의미 입력, 자연어 블록 계약, 관리 ID 조립, 지원
수준 판정, 근거 구절 검사와 오류 CARD 부분 재제출은 MCP 구현을 재사용한다. API
모델에는 중복된 MCP 도구 설명 대신 단계 목적·판단·완료 조건·최소 형식을 정리한
`api-mcp-aligned-v2-smart-2026-09-06` 프롬프트를 보낸다. 과거
Plan·Recall·대표 예시·Critic 경로는 호출하지 않는다.

## 실제 비교 실행

이번 구현 검증에서는 유료 API 호출을 하지 않았다. 기획팀2가 새 비교 round를 확정한
뒤 평가 담당이 다음처럼 실행한다. `--output`은 존재하지 않는 새 디렉터리여야 한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/api-generation-mcp-aligned/run.ts `
  --pdf "C:\Users\jkh01\OneDrive\바탕 화면\학교\운영체제시험\lecture8.pdf" `
  --output "eval\generation-quality\lecture8-deadlock\round-002\api-mcp-aligned" `
  --title "운영체제 Chapter 8 - Deadlocks 반복학습" `
  --goal "이 자료의 핵심 내용을 반복학습 문제로 익힌다." `
  --instruction "전체 문서를 범위로 하며 핵심 개념, 조건, 그래프 판정 규칙, 처리 방식의 차이와 적용 판단을 반복학습 문제로 설계한다. 슬라이드에 없는 내용은 추가하지 않는다." `
  --subject "운영체제" `
  --tags "deadlock,chapter-8,반복학습" `
  --source-expression-mode adapt `
  --model gpt-5.6-terra `
  --reasoning medium `
  --max-attempts 3 `
  --env-file ".env.local"
```

중단된 run은 동일 PDF와 출력 경로로 재개한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/api-generation-mcp-aligned/run.ts `
  --resume `
  --pdf "C:\Users\jkh01\OneDrive\바탕 화면\학교\운영체제시험\lecture8.pdf" `
  --output "eval\generation-quality\lecture8-deadlock\round-002\api-mcp-aligned" `
  --goal "이 자료의 핵심 내용을 반복학습 문제로 익힌다." `
  --env-file ".env.local"
```

`--stop-after analyze|concept-tree|learning-design|activity-design|cards`로 정상 단계
경계에서 의도적으로 멈출 수 있다. 재개 시 저장된 설정이 권위값이며 새 CLI의 모델이나
지시로 바뀌지 않는다. PDF SHA-256이 다르면 재개를 거부한다.

## 산출물

- `manifest.json`: 공급자, 모델, 추론 강도, 프롬프트 버전, 단계 상태, 재시도 수,
  총토큰·API 시간, MCP 대비 환경 차이, 재사용 소스 체크섬
- `input.json`: PDF 경로·해시·크기·페이지 수와 고정 사용자 조건
- `attempts/<stage>/attempt-NNN.json`: 변환된 단계 입력, strict JSON Schema, 모델의
  원본 응답, 자연어 submit 객체, 사용량, API·검증 시간과 오류
- `server-state/runs/<run-id>/run.json`: 기존 MCP 서비스가 저장한 단계별 원문·조립
  산출물, 서버 시도·검증 실패와 Cards 초안
- `result.json`: OpenAI 공급자 표기와 최종 학습 설계·문제 전체

인증 헤더와 API 키는 산출물에 쓰지 않는다. 발행 API는 호출하지 않으며
`published-disabled` 경로에도 파일을 만들지 않는다.

## 오프라인 검증

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test `
  tools/api-generation-mcp-aligned/pipeline.test.ts
```

가짜 API 응답만 사용해 전체 흐름, 계약 거부, 유한 재시도, Cards 부분 수정,
중단·재개, 출력 디렉터리 원본 보존과 실제 Responses 요청 형태를 검사한다.

세부 대응과 불가피한 차이는 [ALIGNMENT.md](./ALIGNMENT.md), 변경 전후 전체 프롬프트는
[PROMPTS_V2.md](./PROMPTS_V2.md)에 기록했다.
