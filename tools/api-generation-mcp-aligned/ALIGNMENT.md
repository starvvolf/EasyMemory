# MCP 흐름 정렬 대응표

## 보존 기준 확인

2026-09-06 보존본의 `checksums.json`과 실제 파일을 다시 계산했다.

| 파일 | SHA-256 | 결과 |
| --- | --- | --- |
| `api-150138f-source.zip` | `387047560f54c6c292cdc420bbb78b93b0eac62736e14e66c00895840864d8f0` | 일치 |
| `mcp-854ad29-reference.zip` | `85ab679c82dab7f347e18530b9405f6592de600d3968a63865176c9aa759f051` | 일치 |
| `recovery-tool/README.md` | `f69f963c7a87d2ccbf1c724a19f9448b0859885cee3f0c37b2d6a494c167260a` | 일치 |
| `recovery-tool/run.mjs` | `b9bae0922ea9790eb1a0e4cb87f6de6aa2ad26e5f14735c66d6227e3624058a2` | 일치 |
| `recovery-tool/run.test.mjs` | `ea2f360403dff57481c1344c581b61f350b9eefe521082220acf0c0e64aecf44` | 일치 |

보존본과 기존 round-001 결과는 수정하지 않았다. 새 실행기는 과거 API 복구 도구도
수정하거나 호출하지 않는다.

## 단계·계약 대응

| 단계 | MCP에서 직접 재사용 | API 실행기의 역할 | PDF 전송 |
| --- | --- | --- | --- |
| Analyze | `getNextStage`의 title·files, `outlineText` 계약, `submitStage`의 목차 파서·계층 조립·페이지 검사 | API 전용 구조 복원 과제와 최소 형식을 전달하고 submit 객체를 반환 | 동일 원본 바이트 첨부 |
| Concept Tree | 선택 목차 투영, `treeText` 계약, 기존 parser·목차/페이지 연결 검사 | 선택·목차 데이터는 유지하고 의미 관계 판단과 실제 들여쓰기 규칙을 명료화 | 동일 원본 바이트 첨부 |
| Learning Design | 개념 번호·관계·근거 입력, LEARNING 블록 계약, parser, ID·Objective·Knowledge Unit 조립 | 의미 입력을 유지하고 인출 대상·조건·목표로 학습 단위를 판단하며 필요한 원문 구절을 보존 | 근거 구절 확인용 동일 바이트 첨부 |
| Activity Design | 학습 대상·앱 능력 입력, DESIGN 블록 계약, 1~3개 제한, Blueprint·지원 수준·포함 여부 조립 | 의미 입력을 유지하고 인출 과제와 응답·문제방식 일관성을 먼저 판단하게 함 | 미첨부; 이전 단계의 sourceEvidence 사용 |
| Cards | 확정 problemDesigns, CARD 계약, 유형·구조·근거 검사, 앱 카드 조립, 정상 CARD 초안 보존·부분 재제출 | 확정 설계의 실현과 연속 근거 계약만 전달하고 전체 또는 오류 CARD를 submit | 미첨부; 확정 설계와 sourceEvidence 사용 |

관리 ID는 모델이 작성하지 않는다. 모델은 단계별 `outlineText`, `treeText`,
`learningDesignText`, `activityDesignText`, `cardsText`만 작성하고 기존 MCP 서버가 ID,
부모 관계, 참조, 앱 필드와 최종 카드 계약을 조립한다.

## 불가피한 실행 환경 차이

이 경로는 사고 흐름을 맞췄지만 “호출 방식만 다르다”고 볼 수는 없다.

1. **모델과 시스템 지시**: MCP 결과에는 호출 대화 모델 식별값과 숨은 시스템 지시가
   없다. API는 명시한 모델·추론 강도와 한 문장의 단계 실행용 system prompt를 쓴다.
2. **이전 문맥**: MCP 대화 AI는 대화 기록을 이용할 수 있다. API는
   `previous_response_id`를 쓰지 않고 MCP가 만든 단계별 투영 입력만 보낸다. 재시도에는
   직전 출력과 서버 오류를 추가한다.
3. **PDF 접근**: MCP 서버에는 PDF가 없고 대화 AI가 첨부를 읽는다. API는 Analyze,
   Concept Tree, Learning Design 각각에 SHA-256이 같은 PDF 바이트를 보낸다. Activity와
   Cards는 MCP 단계 입력의 확정 근거만 쓴다.
4. **API 전용 프롬프트**: 기존 v1은 MCP의 instructions·format·outputContract를
   user payload에 그대로 넣었다. v3는 선택 목차·개념·학습대상·확정설계 등 의미
   데이터는 유지하되 MCP 도구 사용 설명을 제거하고 단계 목적·판단·완료 조건·최소
   형식으로 다시 작성한다. 공통 학습 원칙은 system prompt 한 곳에만 둔다. 원문 범위,
   파서와 서버 검사는 바꾸지 않는다.
5. **외곽 JSON**: MCP의 submit tool 객체와 같은 한 개 문자열 필드 객체를 Responses
   API strict JSON Schema로 받는다. OpenAI strict schema 호환을 위해 object schema에
   `additionalProperties: false`만 명시한다. 자연어 블록은 동일 MCP parser가 검사한다.
6. **재시도**: 대화에서는 사용자가 도구 오류를 보고 다시 답한다. API runner는 같은
   오류를 모델에 명시하고 단계당 기본 3회에서 중단한다. API 전용 Critic, 누락 보정,
   강화 학습 지시는 추가하지 않는다.
7. **내부 엔진 표기**: 직접 재사용한 서비스 상태와 반환값에는 기존
   `engine: chatgpt-mcp`가 남는다. 이를 API 생성 주체라고 오해하지 않도록 외부 manifest와
   result envelope는 `provider: openai-responses-api`, `materializerEngineLabel:
   chatgpt-mcp`를 함께 기록한다.
8. **프롬프트 버전**: manifest와 모든 attempt에
   `api-mcp-aligned-v3-smart-2026-09-06`을 기록한다. 재개 run의 버전이 현재 코드와
   다르면 API 호출 전에 거부해 한 run 안에 두 프롬프트가 섞이지 않게 한다.

## 입력 조건

round-001 MCP run에 기록된 사용자 조건을 실행 예시에 그대로 사용했다.

- 제목: `운영체제 Chapter 8 - Deadlocks 반복학습`
- PDF: `lecture8.pdf`, 14페이지
- 학습 목표: `이 자료의 핵심 내용을 반복학습 문제로 익힌다.`
- 추가 지시: 전체 문서의 핵심 개념, 조건, 그래프 판정 규칙, 처리 방식 차이와 적용
  판단을 문제로 설계하고 슬라이드 밖 내용을 추가하지 않는다.
- 과목·태그·표현 모드: 운영체제 / `deadlock, chapter-8, 반복학습` / `adapt`

MCP 실행의 모델 식별값이 없으므로 모델 동일성은 주장할 수 없다. 비교 실행 모델과
추론 강도는 API manifest에 기록하고 평가 시 별도 차이로 취급해야 한다.

## 검증과 평가 경계

오프라인 검사는 구조적 동등성과 상태 보존을 확인할 뿐 생성 품질 우열을 판단하지
않는다. 실제 유료 실행 뒤 `result.json`과 단계별 시도 파일을 기존 생성 품질 평가
담당에게 전달하고, 의미 품질·누락·근거 충실성·학습 가치 평가는 그 담당이 수행한다.
