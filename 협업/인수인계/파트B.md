# 인수인계 파트 B: 지식 저장소

먼저 `공통.md`. B만 맡은 스레드는 없었다. 원본: `스레드별/AI 호출 비용·속도·품질 리서치.md`(B 항목, 가장 큰 덩어리), `스레드별/유니브 AI와 속도·품질 비교.md`(B 항목). 10/29~10/30 B 채팅의 일은 `협업/현황.md` B 칸에 있다.

## 1. 같은 지식 판정 Decisions (리서치 스레드, 10/30~10/31)

- `src/lib/knowledge/dedupe-decisions.ts` `judgeBatchDecisions`: 후보 쌍마다 "choice" 질문 하나(관계 11가지), 같음은 확률이 문턱 이상일 때만. 요청마다 `assist-log.jsonl`에 한 줄(model gpt-6-luna · effort "decisions").
- `src/lib/knowledge/dedupe.ts` `judgeForSave`: 저장 경로. `OPENAI_API_KEY`가 있고 `RECALLER_DEDUPE_ENGINE`이 `sol`이 아니면 Decisions(20초 제한), 실패하면 같은 일을 **gpt-6-sol** low로(116줄, gpt-6.1-sol 아님).
- `src/lib/knowledge/dedupe-eval.ts`: 시험 모델 이름 `decisions[:모델][@문턱]`(예 `decisions:gpt-6-luna@0.8`).
- 시험(10/31)

  | | 같음 찾음 | 잘못 합침 | 관계 | 시간 |
  |---|---|---|---|---|
  | Decisions 문턱 0.5 | 19/21 | 0 | 44/46 | 2.9초 |
  | sol low | 17/21 | 0 | 45/46 | 90초 |

  같은 쌍 p(같음) 최저 0.66, 같지 않은 쌍은 모두 0.1 미만.
- API 키일 때만 된다(ChatGPT 토큰은 401). 지식 하나에 약 0.4원. 끄기 `RECALLER_DEDUPE_ENGINE=sol`, 문턱 `RECALLER_DEDUPE_SAME_MIN`(기본 0.5), 대체 경로 `RECALLER_DEDUPE_MODEL`/`RECALLER_DEDUPE_EFFORT`.
- 약점: 연결 문장(note)을 안 만들고 방향 검사도 못 한다(어휘 규칙만). 고리 미리보기는 그대로 sol.
- 커밋: `f85a1c2` [경계] AI 호출 비용 정리, `3721e45` [경계] Decisions 기록이 실패로 보이던 것 고침(기록을 요청마다로). DECISIONS 10/31 "AI 호출 기본 모델을 terra로, 같은 지식 판정만 sol".

## 2. 남은 일

1. **Decisions가 저장 경로에서 실제로 불리는지 확인**(10/31까지 안 불림). 사용량 보기에 gpt-6-luna · decisions 성공 줄이 뜨는지. 11/1 상태는 확인 못 함.
2. **sol로 남은 호출 정리**: `knowledge:classify`(`classify.ts`)는 모델을 따로 안 줘 이미 도우미 기본값 terra를 쓴다. `src/lib/knowledge/CLAUDE.md` 34줄 "주제 정리·층·쉽게 풀어 보기 gpt-6-sol·low(기본)"는 코드와 다르다. terra 품질을 실측하고 문서를 맞출 것. 지식 쪽 sol 고정은 같은 지식 판정 대체 경로뿐.
3. 후보 5개 밖이라 못 잡는 같은 쌍(DFS ↔ 깊이 우선 탐색, 데드락 ↔ 교착 상태)은 판정 모델이 아니라 임베딩·별칭 쪽 문제.
4. **플래시카드 앞면 질문형**(유니브 비교 제안): 개념 → "왜 ~인가?", 비교 → "A와 B는 ○○에서 어떻게 다른가?".
5. **다른 파트와 맞출 것**
   - C: 같은 PDF를 다시 만들면 지식이 44 → 96으로 는다. C·D와 합의한 계약 `materialKey`, `attachSameMaterial`, `attachQuestions(지식id, {materialKey, title}, 문제[])`는 코드가 아직 없다. A도 `attachQuestions`를 기다린다.
   - C: 엔진 연결 84개가 지도에만 있다 → 저장소로 넘기기.
   - C: 웹 글은 소제목 덩어리 + 그 덩어리 그림이 가장 좋았다. 확장이 본문을 읽을 때 그림(주소·대체 글·캡션)도 순서대로 담아 주면 엔진이 붙일 수 있다.
   - D: 프로젝트 evidence(예측 맞힘 ≠ 혼자 통과). D 튜터가 Recaller 지식(안다/헷갈림/물어봄)을 읽게 할 계획.
6. 미팅 뒤 결정: FSRS 복습 간격, 졸업 기준. 결정 대기: 복습 입구 하나로 합치기.
