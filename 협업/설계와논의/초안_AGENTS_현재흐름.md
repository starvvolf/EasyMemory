# 초안: AGENTS.md "10. 현재 프로젝트 개발 정보" 갱신

- **상태**: 사용자 확인 전 초안이다. 확인되면 AGENTS.md의 해당 절을 아래로 바꾼다.
- **범위**: 1~9절과 11절(제품 목적·원칙)은 그대로 둔다. 10절의 "현재 구현" 설명만 바꾼다.
- **바꾸는 이유**: 지금 10절은 옛 경로(`/` 메인 앱 → `/api/analyze` → `plan` → `recall-design` → `generate`)를 "현재 실제 생성 흐름"으로 설명한다. 실제 사용자 흐름은 2026-09-29·30 결정으로 바뀌었다. AI가 이 절을 믿고 옛 경로를 고치면 사용자 화면에 아무 효과가 없다.

---

### 주요 화면 (현재)
- `/study` **되짚기**: 사용자 화면은 이것 하나다(`/`는 여기로 보낸다).
  - `src/app/study/DejipgiStudy.tsx`: 앱 쪽 연결. 요청 만들기, 상태 확인, 문서 불러오기, ChatGPT 연결
  - `src/app/study/dejipgi-app.js`: 화면 본체(연습, 읽기, 자료 만들기, 기록)
- `/lab` **생성 실험실**: 작업지시 08로 만드는 중이다. 로컬 실험 모드 전용이다.
- `/legacy`(옛 메인 앱), `/mcp-runs`, `/mcp-personalization`: 개발·실험 도구다. 사용자 흐름이 아니다.

### 현재 실제 생성 흐름
1. 되짚기 **자료 만들기**에서 PDF를 올리고 목적, 할 수 있어야 할 것(`abilities`), 범위를 고른다. 이것이 **생성 요청** 1개가 된다(`src/lib/mcp-experiment-requests.ts`, `.study-forge-data/mcp-experiment-requests/`).
2. 요청은 두 실행자 중 하나가 처리한다.
   - **앱 안 자동 실행기**(기본): `src/lib/study/auto-executor.ts`. 사용자의 ChatGPT 계정으로 모델을 부른다(`src/lib/ai/model.ts`, `chatgpt-provider.ts`).
   - **MCP 대화 실행자**(대안·실험): GPT 대화가 `tools/study-forge-mcp` 도구로 같은 요청을 처리한다.
3. 5단계 엔진: 분석(목차) → 개념 구조 → 학습 설계 → 활동 설계 → 카드. 규칙과 검사, 저장은 `tools/study-forge-mcp/chatgpt-parity.ts`가 맡는다. 실행 기록은 `.study-forge-data/mcp/chatgpt-runs/`에 남는다.
4. 출제: 완료된 요청의 학습 설계로 출제 패킷을 만든다(`tools/study-forge-mcp/authoring-packet.ts`, `tools/problem-authoring-lab/request-packet.ts`). 그다음 문제 문서를 쓰고, 검사하고, 1회 고친 뒤 기록한다(`tools/problem-authoring-lab/authoring-io.ts`, `runs/<실행ID>/iteration-N/`).
5. 되짚기가 기록된 문서를 불러와 쪽마다 문제를 붙인다(`/api/personalization-lab`, `src/lib/study/from-authoring.ts`). 품질 검사 오류 문항은 뺀다.
6. 풀다가 "이 문제 이상해요"로 신고한 목표만 "다시 만들기"로 재생성할 수 있다. 이때 학습 설계는 재사용한다.

### 현재 알려진 구현상 연결 상태
- 출제는 **학습 설계 결과만** 입력으로 쓴다. 활동 설계와 카드 결과는 "완료됐다"는 확인에만 쓰인다. 단계 구성을 바꿀지는 실험실 결과를 보고 정한다.
- 자동 실행기는 단계마다 모델을 한 번 부르고, 검사에 걸리면 이전 답과 오류를 주고 최대 3번까지 다시 시킨다. 사용량 한도, 로그인 필요, 검사 실패는 실패가 아니라 "멈춤"이고 "다시 시작"으로 잇는다.
- 단계 지시문 일부는 MCP 도구가 있다고 가정하고 쓰여 있다("원문 읽기 도구", "MCP가 검사"). 앱 안 실행기는 도구 대신 쪽별 추출 글자를 보낸다(쪽당 3,500자, 합계 60,000자).
- 옛 경로(`/api/analyze`, `plan`, `recall-design`, `generate`)와 `PipelineOperatorModal`은 `/legacy`에서만 쓰인다. 되짚기 흐름을 바꾸려면 이 경로를 고치지 않는다.

### 모델 호출과 프롬프트 위치
- 모델 호출은 `src/lib/ai/model.ts`의 `callModel` 하나로 모인다. 공급자는 `chatgpt`(기본), `codex`, `fake`(테스트)다.
- 5단계 지시문과 계약: `tools/study-forge-mcp/chatgpt-parity.ts`(단계 입력의 `instructions`, `format`)
- 자동 실행기가 덧붙이는 공통 지시문과 출제 문서 형식 요약: `src/lib/study/auto-executor.ts`
- 출제 지침: `tools/problem-authoring-lab/skill/problem-authoring/SKILL.md`와 참고 문서
- 옛 경로 프롬프트는 각 `src/app/api/*/route.ts`에 있다(`/legacy` 전용).

### 저장 방식 (현재 사용자 흐름)
- 서버(로컬): `.study-forge-data/`
  - 등록 PDF: `mcp-sources/`
  - 요청: `mcp-experiment-requests/`
  - 5단계 실행 기록: `mcp/chatgpt-runs/`
  - 자동 실행기 상태: `study-executor/`
  - ChatGPT 연결: `chatgpt-auth/`, 암호화
- 출제 기록: `tools/problem-authoring-lab/runs/`
- 되짚기 학습 기록(진행, 숨긴 목표, 신고, 마지막 쪽, 만드는 중인 자료)은 **브라우저 localStorage**에 둔다. 서버 동기화는 없다.
- 옛 IndexedDB `memory-transformer` 덱 저장은 `/legacy` 전용이다.

### 실행과 검증
- 로컬 실행: `Study Forge 로컬 열기.cmd`(`scripts/run-local-experiment.mjs`). 로컬 실험 모드, 자동 실행기, `chatgpt` 공급자가 켜진다.
- 모델 덮어쓰기(시험용): `.env.local`에 `STUDY_FORGE_EXECUTOR_MODEL`, `STUDY_FORGE_EXECUTOR_EFFORT`
- 테스트: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/lib/study/*.test.ts src/lib/ai/*.test.ts tools/problem-authoring-lab/*.test.ts scripts/study-forge-mcp-chatgpt.test.ts`. 가짜 모델로 처음부터 끝까지 도는 테스트가 들어 있다.
- `npm run lint`, `npm run build`
- 카드 품질 eval 명령은 여전히 없다. 실험실(작업지시 08)이 그 역할의 첫 단계다.
