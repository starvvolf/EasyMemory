# 통합 결과 — 2026-09-22

기준 브랜치는 **codex/recaller-integration**이다. 기존 작업 공간을 삭제하거나 변경하지 않고 별도 작업 공간에서 합쳤다. main 변경·서비스 배포는 하지 않았다.

## 포함한 작업

| 원본 | 포함 범위 | 판단 |
|---|---|---|
| ddb3b204 | 노트북 인수인계·출제 방법론 | 문서 기준점 |
| 385cea28 | 화면 역할 분리, Firebase 인증·개인 데이터, PDF 원문 이동, 학습자 기억, VS Code 연동 | 기존에 통합된 최신 계열 |
| 367cc6ea | JSON 직접 출력 생성 경로, 문제작성 실험 틀, 그래프, Learning Design 연결 | 최신 생성·작성 계열 |

50fb의 c6d6d691은 385cea28의 조상이다. 2d7b의 ebca250d 및 1263의 fc60d28e의 개별 변경은 git patch 비교상 385cea28에 모두 동등하게 적용되어 중복 병합하지 않았다.

5942/b1951151과 a675/185c5001은 평가 기록 계열이므로 이번 실행 코드 통합에서 제외했다. 5b65/fda889ea의 미커밋 구형 생성 코드와 모든 원본 작업 공간의 미커밋 문서·자료는 그대로 보존했다. 새 개인 PDF, 화면 캡처, 인증 파일, 로컬 데이터, 미추적 평가 원자료는 추가하지 않았다. 기존 커밋에 포함된 실험 결과·폰트 및 라이선스는 보존했다.

## 통합 중 수정한 실제 연결 문제

- 직접 JSON 출력으로 변경하면서 없어진 compact 카드 스키마를 MCP가 계속 가져와 MCP 서버가 로딩되지 않았다. MCP 전용 compact-generation.ts에 기존 자연어 출력 계약·변환을 보존하고 contracts.ts와 chatgpt-parity.ts가 이를 사용하게 했다. API 생성 코드와 프롬프트는 변경하지 않았다.
- 그래프 해시가 체크아웃의 줄바꿈 변환으로 달라졌다. 원래 해시를 만든 spec LF와 SVG CRLF를 .gitattributes로 고정했다. 해시나 검사를 완화하지 않았다.
- 오래된 Firebase setup 설명을 현재 계정별 저장 구현에 맞췄다. 실제 클라우드 구축 완료를 뜻하지 않는다.

## 검증

Node.js 24.16.0, 잠금파일 기준 npm ci를 사용했다. lint는 최종 코드 수정 후 통과했다. 프로덕션 build/TypeScript는 병합 후 통과했다. 이후 production 소스 수정은 없으며 MCP tools 연결만 수정했다. tsconfig는 tools/scripts를 제외하므로 빌드 성공만으로 MCP 정상을 판정하지 않았다.

| 검증 | 통과 | 실패 | 건너뜀 |
|---|---:|---:|---:|
| auth:test | 6 | 0 | 0 |
| vscode-link:test | 5 | 0 | 0 |
| study:test | 56 | 0 | 0 |
| quality:offline:test | 35 | 0 | 0 |
| mcp:study-forge:test (복구 후) | 14 | 0 | 0 |
| mcp:concept-tree:test | 4 | 0 | 0 |
| project:test | 1 | 0 | 0 |
| vscode:study-forge:test | 1 | 0 | 0 |
| learner-memory + authoring lab | 30 | 0 | 0 |
| VS Code 확장 자체 테스트 | 44 | 0 | 9 |
| direct-json-generation.test.ts (기획 담당 독립 검수) | 3 | 0 | 0 |
| 위 검증 소계 | **199** | **0** | **9** |
| 구형 generation:contract:test | 9 | 12 | 0 |

기억+작성 검사 실행: node --experimental-transform-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/lib/learner-memory/*.test.ts tools/problem-authoring-lab/problem-authoring-lab.test.ts. 기억 어댑터의 TypeScript 문법 때문에 transform-types가 필요하다.

VS Code 건너뜀은 설치된 언어 도구·실행 환경 제약이다. C#은 .NET SDK가 없어 실행 검증하지 못했다.

### 남은 생성 검사 실패

구형 generation:contract:test는 HTTP fetch를 모킹하지만 현재 제품 생성 함수는 Codex provider를 호출한다. 최초 실행이 그 경계 밖으로 나가 실패하는 것을 확인하고 중단했다. 재검증은 CODEX_EXECUTABLE을 존재하지 않는 로컬 경로로 지정하여 실제 Codex 실행을 차단했고 21개 중 9개 통과, 12개 실패했다. 실패에는 provider 경계 불일치와 구조복원 답 목록 제거 같은 옛 후처리 기대값이 섞여 있다.

이 테스트를 통과시키려고 현재 직접 JSON 출력에 후처리를 되넣지 않았다. 테스트 fixture/provider 경계의 최신화가 남아 있으며, 이 실패만으로 실제 생성 기능의 정상·비정상을 확정할 수 없다. **모든 검사가 통과한 상태는 아니다.** 기존 명령을 안전한 완전 오프라인 검사로 간주하지 말 것.

### 미검증 및 제한

실 계정 로그인, Firebase 배포·규칙 에뮬레이터·클라우드 동기화, 실제 AI 문제 생성, 노트북 실행, 통합 화면의 브라우저 조작은 이번에 검증하지 않았다. 유료 API 키를 제공하거나 유료 생성 테스트를 실행하지 않았다.

빌드에 기존 Codex 실행파일의 동적 경로 때문에 전체 프로젝트를 서버 출력에 추적할 수 있다는 경고가 1개 남는다. 배포 크기는 별도 확인이 필요하다. 새 문제작성 틀과 기존 학습 화면의 제품 수준 통합은 아직 별도 작업이다.

공개 전 신규 범위 45개 커밋의 변경에서 API 키·GitHub 토큰·개인키 패턴을 검사했고 일치한 항목은 없었다. 이는 모든 종류의 비밀정보 부재를 보증하는 검사는 아니다.
