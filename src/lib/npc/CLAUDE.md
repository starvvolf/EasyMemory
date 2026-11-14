# 가상 학습자 (NPC, 11/15)

설계: `docs/가상학습자_설계_v2(+gpt).md`(1~11번). NPC는 **아는 조각만** 가진다. 코드(연출가)가 그 조각으로 갈 수 있는 **풀이 길**을 고르고, 빠진 조각 자리에서 막히게 하고, 배우면 다시 계획한다. AI는 그 길을 코드와 말로 옮기기만 한다. 모범 풀이는 채점할 때만 쓴다(AI에게 안 보냄).
NPC는 사람과 같은 앱 기능(알고리즘 튜터 · 도움 칸 · 제출 · 문제 한 장 · 상황 재현)을 부르고, 결과(정답지)로 앱이 만든 것을 채점한다.

## 돌리기

```
node --experimental-strip-types tools/npc/run.ts --experiment first --dry          # 첫 실험(설계 8번) 다섯 명, AI 0번
node --experimental-strip-types tools/npc/run.ts --with 문법약함-py,버티기 --seed 3   # 한 명(AI: STUDY_FORGE_MODEL_PROVIDER)
node --experimental-strip-types tools/npc/run.ts --replay tools/npc/out/runs/<판>/<npc>   # 빈틈 뽑기 · 장면 · 채점만 다시(튜터는 안 부름)
node --experimental-strip-types tools/npc/run.ts --map                            # 지도 확인 표(사람이 봄)
node --experimental-strip-types tools/npc/run.ts --plant all --dry                # 심기 모드(회귀 시험)
node --experimental-strip-types tools/npc/run.ts --practice --dry --port 4111     # 실습(자기 실습 서버를 4110번대로 띄움)
node --experimental-strip-types tools/npc/make.ts "질문을 못 참는 2학년" --problem 2606   # 옵션 조각을 AI로(--save-last로 저장)
```

- 그 밖: `--mode loose`(느슨: AI가 길을 짬, 새 길은 `map-candidates.json`) · `--remap`(지도를 AI로 다시) · `--max-tokens N`(넘을 것 같으면 새 NPC를 시작 안 함, 실행 전 어림 · 뒤 실제를 적음) · `--suspect-ai`(의심 코드를 싼 AI로 확인) · `--no-scenes` · `--human <층 분포.json>`(사람 기록과 맞춰 보기) · `--plan`(어림만).
- 결과는 `tools/npc/out/`(깃 제외): `runs/<판>/report.md`(묶음 표) · `<npc>/report.md · key.jsonl(정답지) · played.json · record.json · gaps.json · score.json` · `data/<판>/<npc>/`(NPC마다 자기 `STUDY_FORGE_DATA_DIR`) · `maps/<문제>.json`(지도 캐시).
- 대역 모델로 돌리기: `STUDY_FORGE_MODEL_PROVIDER=relay STUDY_FORGE_RELAY_DIR=tools/npc/out/<중계> …` + `tools/harness/relay.mjs`(`tools/harness/README.md`). 실제 ChatGPT가 아니라는 걸 결과에 적는다.

## 파일

| 파일 | 하는 일 (설계 번호) |
|---|---|
| `types.ts` | 명세 · 조각 · 길 · 정답지 사건 모양 |
| `dice.ts` | 이름 붙은 씨앗 주사위(같은 명세 + 문제 + 씨앗 → 같은 길 · 막힘. 명세 id는 안 넣음: 조각만 다른 NPC끼리 같은 눈) |
| `profile.ts` | 1번: 기본값 + 옵션 겹치기(뒤가 이김) · 숫자 자르기 · 항목 이름 검사(`idea.*` 무늬) · 부딪침 · 상태 넷(잘못 앎은 믿음 → 틀린 조각, 애매는 주사위) · 사람 말로 풀기 |
| `map.ts` | 2번: 지도 엮기(걸음 코드 + `{{자리}}`) · **길 판정을 채점기로 잼**(자리의 틀린 조각마다도) · 예시 문법 확인(ast) · AI로 만들기(1번, terra low) + 모양 검사 · 캐시 · 사람 확인 표 |
| `map2606.ts` | 손으로 쓴 2606 지도(길 A BFS · B 재귀 · C 반복해서 훑기 · D 바로 연결만 · E 표시 없이 → 시간 초과, 틀 조각 frame.bfs · frame.dfs) |
| `fixtures/p2606.ts` | 2606 재료: **내 말로 쓴 문제 글**, 손으로 만든 예제 · 테스트 + 씨앗 무작위 입력, JS 모범 풀이, 교육용 문제 모델. 원문은 넣지 않는다 |
| `director.ts` | 3번: 길 고르기(끝까지 갈 길 → 익숙 · 최근 배운 조각 → 조합력 주사위(틀을 알면 안 던짐) → 가장 멀리 → 틀린 조각은 자신 있게, 계획 때 문법은 안 보임) · 막힘 반응(지어 씀 · 틀린 조각으로 메움 · 도움 칸 · 힌트 · 튜터에게 물음 → 배움 판정 → 다시 계획/갈아타기 · 혼자 고침 · 포기) · 실수 · 복붙 · 상한 · 정답지 |
| `voice.ts` | 4번: 코드 쓰기(terra low, 허용 조각만 · 모르는 문법 줄은 예시에서 지움) · 말 쓰기(luna) · 배움 판정(luna, id는 코드가 거름) · 의심 확인 · 장면 답하기. 엄격/느슨. 가짜(--dry) |
| `guard.ts` | 5번: 판정이 길의 잰 판정과 같나(다르면 한 번 다시 → "재현 못 함") · 문법 누수(문법에만) · 의심(길이 · 반복) · 다 배운 뒤 점검 |
| `algo-driver.ts` | 10번: 앱 기능 바로 부르기(경로가 부르는 순서 그대로) · NPC 데이터 폴더 바꾸기(사용자 데이터는 거절) · 문제 재료 넣기 · 뒤 단계(문제 한 장 · 총정리 · `extractGaps`) · 기록 모으기 · 사용량 · 앱 없는 드라이버(시험용) |
| `dry-ai.ts` | 가짜 AI: 가짜 튜터(틀린 조각 흔적 → 맞는 조각, 실수 → 그 줄, 걸음 → 그 걸음 조각, 방법 → 정석 길) · 앱 AI 자리는 스키마 모양의 빈 답 |
| `score.ts` | 7번: (가) 빈틈 맞음 · 놓침 · 헛짚음 · 실수를 모름으로 · 복붙 (나) 기억 (다) 튜터(빠진 것 · 아래층부터 · 통째로 — 튜터 답 코드를 채점) (라) 장면 다시 풀기(배우기 전 · 뒤) · 사람 층 분포와 비교 · 보고서 |
| `plant.ts` | 6번: 심기 모드(맞는 길에 틀린 조각 하나, 틀린 길) → 빈틈 뽑기 · 장면 채점이 잡나 |
| `maker.ts` | 1번: 옵션 조각 AI로 만들기 · 기록에서(나 닮은 NPC) · 한꺼번에(비슷한 것 거름) |
| `practice-map.ts` · `practice-driver.ts` | 4번 실습 · 10번: 공유 카운터 지도(lock · 한 번에 올리기 · 차례로 · ✗안 겹친다) · NPC마다 실습 서버(PC_DATA_DIR · PC_PORT 4110+, PC_FAKE_AI=1) · 도구 셋(읽기 · 고치기 · 명령, 작업 폴더 안 · node/npm test만) · VS Code 확장과 같은 모양으로 알림 |
| `run-npc.ts` | 한 명 한 판(폴더 → 재료 → 풀기 → 뒤 단계 → 채점 → 파일) · 다시 쓰기 |
| `experiment.ts` | 8번 첫 실험 다섯 명 |
| `tools/npc/` | `default.json` · `options/*.json`(아는 것 · 성격 · 배움 + 2606용) · `run.ts`(실행기, NPC마다 프로세스 `one.ts`) · `make.ts` |

## 지켜야 하는 것

- 사용자 데이터 · 3000 · 4100을 쓰지 않는다. NPC 데이터는 `tools/npc/out/data/…`(이름에 npc가 든 폴더만 받음), 실습 서버는 4110번 위.
- B(`src/lib/code/**`, `src/lib/assist/code-ai.ts`) · D(`experiments/project-course/`) · 상황 재현(`src/lib/scene/`)은 고치지 않고 부르기만.
- 공개 저장소: 문제 원문 · 결과 · 중계 폴더는 올리지 않는다(`tools/npc/out/`은 .gitignore).
- 모범 풀이 · 허용 안 된 조각은 NPC 쪽 AI에 보내지 않는다(`voice.ts` codeUser, 시험 있음).

## 한계 (정직하게)

- 지도의 질이 전부다. 엄격 모드는 지도에 없는 길을 안 낸다. AI가 만든 지도는 처음 몇 개를 사람이 `map-review.md`로 확인한다.
- 생각 · 방법의 누수는 완전히 못 막는다(판정 검사 · 의심 검사까지). 코드 몇 개는 사람이 읽는다.
- 빈틈 · 기억 글을 조각에 맞추는 건 낱말(keys) 맞추기다. 보고서에 근거 낱말을 같이 적는다.
- 가짜 AI(--dry)는 빈틈을 뽑지 않는다 → (가)는 "AI 필요". 장면 단계는 정답지로 만든 빈틈(고치기 장면, AI 0번)으로 돌린다. 시간 초과 코드의 장면은 검사 · 채점에 몇 분 걸린다(상황 재현 쪽 실행 시간).
- 실습 서버의 튜터 대화는 OpenCode(Node 24)가 있어야 답한다. 없으면 대화 답이 없고, 가짜 모드는 로컬 가짜 튜터로 이어 간다(보고서 메모). "해 봤어요"는 실습 목표가 있어야 받는다(목표는 튜터가 정함).
- 조합력 · 갈아타기 · 배움 확률은 우리가 정한 값이다. "사람도 그렇다"고 말할 수 없다.
