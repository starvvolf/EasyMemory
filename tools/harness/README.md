# 자체 시험 하네스 (11/15)

ChatGPT 없이(클라우드 · 노트북 밖) 앱의 AI 흐름을 끝까지 돌려 보는 장치. AI 자리는 **대역 모델 에이전트**가, 학습자 자리는 **학습자 연기 에이전트**나 **가상 학습자(NPC, `src/lib/npc/`)**가 맡는다. 판정 · 검사 · 채점은 앱 코드 그대로다.

| 파일 | 하는 일 |
|---|---|
| `relay.mjs` | 중계: 앱(`STUDY_FORGE_MODEL_PROVIDER=relay`, `STUDY_FORGE_RELAY_DIR=<폴더>`)이 내놓은 AI 요청을 보여 주고, 답을 스키마로 확인해 써 넣음 |
| `agents/model.md` | 대역 모델 에이전트의 지시문(요청 하나에 답 하나, 지시문 · 스키마 그대로, 코드는 돌려 봄) |
| `agents/learner.md` | 학습자 연기 에이전트의 지시문(아는 조각만으로 답함) |

## 쓰는 법

1. 시험할 쪽을 중계 모드로 켠다: `STUDY_FORGE_MODEL_PROVIDER=relay STUDY_FORGE_RELAY_DIR=/tmp/relay STUDY_FORGE_DATA_DIR=<시험 데이터> <명령>`
2. 대역 모델 에이전트를 `agents/model.md` 지시문으로 띄워 같은 중계 폴더를 맡긴다.
3. 학습자가 필요한 시험이면 `agents/learner.md`로 연기 에이전트를 띄우거나 NPC(`node --experimental-strip-types tools/npc/run.ts …`)를 쓴다.

- 실제 ChatGPT로 돌리기 전에 흐름 · 검사 · 채점을 확인하는 용도다. 대역 모델은 실제 모델과 같지 않다(결과 문서에 꼭 적는다).
- 중계 폴더 · 시험 데이터는 git에 올리지 않는다(문제 원문 · 기록이 들어감).
