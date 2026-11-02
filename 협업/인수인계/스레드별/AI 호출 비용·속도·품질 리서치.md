# 인수인계: AI 호출 비용·속도·품질 리서치

- **대상 파트: 공통 (항목별로 A·B·C·D 표기)**. 협업/현황.md의 "AI 호출 비용 (리서치 스레드)" 칸에 해당합니다.
  - B (지식): 같은 지식 판정 Decisions — 가장 큰 덩어리
  - A (코드): 코드 문제 출제 effort·독립 풀이 모델
  - D (프로젝트): 튜터 모델
  - C (엔진): 참고만(엔진 기본값은 이 스레드가 바꾸지 않음)
  - 모두: 도우미 기본 모델(`src/lib/assist/model.ts`), 질문 창(`src/lib/study/notes.ts`), 사용량 보기 도구, ChatGPT 로그인 칩
- 기간: 2026-10-30 ~ 10-31. 브랜치: `claude/recaller2`
- 이 스레드에서 직접 한 일만 적었습니다. 코드와 다른 내용은 코드 기준으로 고쳐 적었습니다(11/1 확인).

## 1. 리서치 결론

자세한 근거: Claude 문서 https://claude.ai/artifact/QWHRHZdd2NBQBTH6D9xivT , 노션 "Recaller AI 호출 가이드".

- 앱은 사용자의 ChatGPT 로그인(플랜 사용량)으로 Responses API를 부릅니다. 이 경로에는 Batch·Flex가 없고, Fast는 사용량이 2.5배입니다.
- 가격 (10/31, 100만 토큰당 입력 / 캐시 입력 / 출력)

  | 모델 | 입력 | 캐시 | 출력 |
  |---|---|---|---|
  | gpt-6.1-terra | $1 | $0.05 | $5 |
  | gpt-6.1-sol | $2 | $0.10 | $10 |
  | gpt-6-luna | $0.10 | $0.01 | $0.50 |
  | gpt-6-astra | $10 | $1 | $50 |

  입력이 272K를 넘으면 입력 2배, 출력 1.5배입니다.
- 캐시: 읽기는 0.05배, 쓰기는 1.25배(30분 유지), 최소 1,024토큰부터. 고정 지시문은 앞에, 바뀌는 내용은 뒤에 둡니다.
- 속도: 호출 하나 = 첫 글자까지 약 3.4초 + 출력 토큰 ÷ 출력 속도(terra 117, sol 63, luna 125 tok/s). **출력을 줄이는 것이 제일 큽니다.**
- 결론
  - 기본 모델은 gpt-6.1-terra · low.
  - 같은 지식 판정은 Decisions 우선, 안 되면 sol low.
  - 코드 독립 풀이는 출제(terra)와 다른 모델(gpt-6.1-sol).
  - 짧은 제목은 luna.
- 이 원칙은 루트 `CLAUDE.md` "AI 호출 원칙"과 `docs/DECISIONS.md` 10/31에 적어 두었습니다.

## 2. 바꾼 기본값

환경변수를 넣으면 예전 값으로 되돌릴 수 있습니다. 변수는 왼쪽부터 먼저 봅니다.

| 파트 | 파일 | 호출 | 기본값 | 되돌리는 변수 |
|---|---|---|---|---|
| 모두 | `src/lib/assist/model.ts` | 도우미 전체(askText·askJson) | gpt-6.1-terra · low (heavy는 medium) | `RECALLER_ASSIST_MODEL` → `STUDY_FORGE_NOTE_MODEL` → `STUDY_FORGE_EXECUTOR_MODEL`, 강도 `RECALLER_ASSIST_EFFORT` / `RECALLER_ASSIST_HEAVY_EFFORT` |
| 모두 | `src/lib/study/notes.ts` | 질문 창 `note:ask`·`note:follow`·`note:chat`·`note:compose` | gpt-6.1-terra · low | `STUDY_FORGE_NOTE_MODEL` → `STUDY_FORGE_EXECUTOR_MODEL`, 강도 `STUDY_FORGE_NOTE_EFFORT` |
| 모두 | `src/lib/study/notes.ts` | 대화 제목 `note:title` | gpt-6-luna · low | `STUDY_FORGE_NOTE_TITLE_MODEL` |
| A | `src/lib/assist/code-ai.ts` | 독립 풀이 `code:solve` (`SOLVE_MODEL`) | gpt-6.1-sol | `RECALLER_CODE_SOLVE_MODEL` |
| A | `src/lib/assist/code-ai.ts` | 문제 세팅 `code:make` (`MAKE_EFFORT`) | low (모델은 원래대로 gpt-6.1-terra) | `RECALLER_CODE_MAKE_EFFORT`, 모델 `RECALLER_CODE_MAKE_MODEL` |
| D | `experiments/project-course/lib/oc-engine.ts` | 프로젝트 튜터(OpenCode) | gpt-6.1-terra | `RECALLER_ASSIST_MODEL` |
| B | `src/lib/knowledge/dedupe.ts` | 같은 지식 판정(아래 3절) | 키 있으면 Decisions(gpt-6-luna), 아니면 **gpt-6-sol** · low | `RECALLER_DEDUPE_ENGINE=sol`, `RECALLER_DEDUPE_MODEL` / `RECALLER_DEDUPE_EFFORT` |

- 코드 확인: 같은 지식 판정의 sol은 `gpt-6.1-sol`이 아니라 **`gpt-6-sol`** 입니다(`dedupe.ts` 116줄).
- C 참고만: 엔진의 `rc-author`·`rc-check` terra low(`src/lib/study/gen/types.ts`), `hedgeMs: 8000`(`runner.ts`)은 글·PDF 스레드가 한 것입니다. 11/1 기준 아직 커밋 안 된 변경입니다. 엔진 기본 모델(`DEFAULT_GEN_MODELS`)은 이 스레드가 손대지 않았습니다.

## 3. 같은 지식 판정 Decisions (B)

- 파일
  - `src/lib/knowledge/dedupe-decisions.ts`: `judgeBatchDecisions`. 후보 쌍마다 "choice" 질문 하나(관계 11가지), 같음은 확률이 문턱 이상일 때만 받습니다. 요청마다 `assist-log.jsonl`에 한 줄(model gpt-6-luna · effort "decisions").
  - `src/lib/knowledge/dedupe.ts` `judgeForSave`: 저장 경로. `OPENAI_API_KEY`가 있고 `RECALLER_DEDUPE_ENGINE`이 `sol`이 아니면 Decisions(API 키만, 20초 제한), 실패하면 같은 일을 sol low로 다시.
  - `src/lib/knowledge/dedupe-eval.ts`: 시험 모델 이름에 `decisions[:모델][@문턱]`(예 `decisions:gpt-6-luna@0.8`).
- 시험 (10/31)

  | | 같음 찾음 | 잘못 합침 | 관계 | 시간 |
  |---|---|---|---|---|
  | Decisions 문턱 0.5 | 19/21 | 0 | 44/46 | 2.9초 |
  | sol low | 17/21 | 0 | 45/46 | 90초 |

  같은 쌍의 p(같음) 최저 0.66, 같지 않은 쌍은 모두 0.1 미만이었습니다.
- API 키(`OPENAI_API_KEY`)일 때만 됩니다. ChatGPT 토큰은 401입니다. 비용은 지식 하나에 약 0.4원.
- 끄기 `RECALLER_DEDUPE_ENGINE=sol`, 문턱 `RECALLER_DEDUPE_SAME_MIN`(기본 0.5).
- 약점: 연결 문장(note)을 만들지 않고, 방향 검사도 못 합니다(어휘 규칙만). 고리 미리보기는 그대로 sol입니다.

## 4. 토큰 사용량 보기 도구 (모두)

- 위치: `tools/usage-report/`(`build.mjs`, `view.html`, `README.md`), 저장소 맨 위 `토큰 사용량 보기.cmd`. 모델 호출 없음.
- 읽는 것(데이터 폴더마다): `study-gen/gen_*/calls/*.json`(PDF 엔진), `study-gen/web-trials/wt_*.json`(웹 글 실험), `assist-log.jsonl`(지식·코드·프로젝트 도우미). 폴더는 `.env.local`의 `STUDY_FORGE_DATA_DIR`, 그 옆 `engine-data`, 저장소 `.study-forge-data`, `experiments/project-course/.study-forge-data`. 다른 폴더는 인자로 넘깁니다.
- 자동 갱신: `127.0.0.1:3091`(`RECALLER_USAGE_PORT`, 3000~3003은 건너뜀). 화면이 10초마다 바뀐 것만 다시 받고, 필터·펼친 줄·스크롤을 유지합니다. cmd 창을 닫으면 멈춥니다("연결 끊김").
- 한 번만 만들기: `node tools/usage-report/build.mjs --open` → `tmp/usage-report.html`(자료 이름이 들어 있어 커밋하지 않음).
- 단가는 `view.html`의 `PRICES` 표(`PRICES_AS_OF = "2026-10-31"`)입니다. 가격이 바뀌면 여기만 고칩니다.
- 옛 "decisions" 실패 4줄은 10/31 오전 시험이 "decisions"를 모델 이름 그대로 ChatGPT에 보낸 것입니다(Decisions API 호출 아님). 화면에 "옛 시험·Decisions 아님"으로 표시됩니다.

## 5. UI (모두)

- 머리말 타이머 칩 대신 ChatGPT 로그인 칩(`src/app/study/workspace/AccountChip.tsx`, `DejipgiStudy.tsx`에서 씀).
- 코드 문제(`CodeStudy.tsx`)의 "타이머 켜고 풀기" 버튼을 뺐습니다.
- 더보기 메뉴(`MoreMenu.tsx`) 항목 이름 "학습 기록".

## 6. 커밋 (`claude/recaller2`)

- `f85a1c2` [경계] AI 호출 비용 정리: 기본 모델 terra, 같은 지식 판정 Decisions 우선, 사용량 보기 도구, ChatGPT 로그인 칩
- `3721e45` [경계] 같은 지식 판정 Decisions 기록이 실패로 보이던 것 고침 (기록을 요청마다로 옮김)
- `6ccf91a` 토큰 사용량 보기 자동 갱신 (`--serve`, 3091)

## 7. 남은 일

- **B**: 저장 경로에서 Decisions가 실제로 불리는지 확인(10/31까지 안 불림) → 사용량 보기에 gpt-6-luna · decisions 성공 줄이 뜨는지. 11/1 상태는 확인 못 했습니다(이 인수인계 작업에서는 데이터 폴더 읽기 권한이 없었음).
- **모두**: 이 커밋 상태만 따로 `tsc`를 돌리지 못했습니다(다른 스레드 변경이 작업 폴더에 섞여 있음).
- **B**: sol로 남은 호출 정리. 코드를 보면 `knowledge:classify`(`classify.ts`)는 모델을 따로 주지 않아 이미 도우미 기본값 terra를 씁니다. 그래서 `src/lib/knowledge/CLAUDE.md` 34줄의 "주제 정리·층·쉽게 풀어 보기 gpt-6-sol·low(기본)"는 지금 코드와 다릅니다. terra로 품질이 괜찮은지 실측하고 문서를 맞춰 주세요. 지식 쪽에서 sol로 고정된 것은 같은 지식 판정의 대체 경로(gpt-6-sol)뿐입니다.
- **A**: 독립 풀이 gpt-6.1-sol은 5문제 비교 실측 전입니다. 첫 시도 통과·독립 풀이 일치가 떨어지면 되돌립니다.
- **B**: 후보 5개 밖이라 못 잡는 같은 쌍(DFS ↔ 깊이 우선 탐색, 데드락 ↔ 교착 상태)은 판정 모델이 아니라 임베딩·별칭 쪽 문제입니다.

## 8. 주의점

- `.env.local`은 직접 고치지 않습니다. 키는 사용자가 넣습니다.
- 3000번 서버 재시작은 먼저 묻습니다.
- 공개 저장소입니다. 키·강의 자료를 커밋하지 않습니다.
- AI를 쓰는 시험은 하기 전에 알립니다.
- ChatGPT 로그인 정보는 `coding\Recaller\.study-forge-data\chatgpt-auth`에 저장됩니다. 다른 폴더에서 서버를 띄우면 로그인이 안 보입니다(10/31에 이것 때문에 헤맸음).
- 모델을 바꾸거나 호출을 늘리면 `토큰 사용량 보기.cmd`로 전후를 비교합니다.
