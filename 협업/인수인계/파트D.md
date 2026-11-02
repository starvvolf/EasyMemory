# 인수인계 파트 D: 프로젝트 코스

먼저 `공통.md`. 원본: `스레드별/프로젝트 공부 ↔ 지식쌓기 루트 설계.md`, `스레드별/AI 호출 비용·속도·품질 리서치.md`(D 항목).
기간 10/31~11/1, 브랜치 `claude/recaller2`. 커밋 `8fef009`, `2ca8b1a`, `c9f0a2b`(push됨).

## 1. 한 일

### 조사·설계 (Claude 문서)
- 초보~중수가 구현을 배울 때 막히는 점: https://claude.ai/artifact/79xucPY7kKndtvf7GQAD7B
- 코드 리뷰 설계(**보류**): https://claude.ai/artifact/RU8TXj1HQ5HAyKc3yKcdfN
- 프로젝트 ↔ 지식 상호작용 예시·구현 방법: https://claude.ai/artifact/P6HmwDQSP1rHMJfq4BvP3f
- 2단계 새 형식 명세: https://claude.ai/artifact/AV14Hh2w8F9AJEhbG37Uiq
- **튜터 에이전트 동작(지금 코드 기준)**, 구멍 4개: https://claude.ai/artifact/Q215SNPS1ZjvsYULX1L3Tj
- C와 합의한 계약 `materialKey`, `attachSameMaterial`, `attachQuestions` (코드 없음, 파트B·C 참고)

### 2단계 새 형식 (`8fef009`)
- 화면 아래 "지금 할 일" 줄. 고칠 때 세 방식: 제가 해 볼게요 / 같이 해요(빈칸 + 3조각) / 만들어 주세요(백업 후 준비된 정답 파일, AI 아님)
- 껐다 켜기 확인 단계(영속성), 질문 뒤 "하던 거로 돌아가기", 설명 카드 "아직 헷갈려요 / 건너뛸게요"
- 기록: 직접 → correct(independent), 같이 → hint, 만들어 줌 → note(앎으로 안 침), 헷갈려요 → asked
- 통과하면 실습 서버를 꺼서 다음 요청 때 새 코드로 켜지게
- 파일: `experiments/project-course/lib/lesson.ts`, `lib/learn.ts`, `courses/board-api/lessons/2.json`, `web/app.js`, `web/style.css`

### 코스 서버를 필요할 때 자동으로 켜기 (`8fef009`) — 진행판 P5 "코스 서버를 앱 안으로"의 대안
- 앱에서 프로젝트 공부를 열었는데 4100이 꺼져 있으면 앱 라우트가 켠다(60초에 한 번까지, Windows는 `프로젝트코스 실험.cmd`를 최소화로, `PC_NO_OPEN=1`이라 VS Code는 안 염). 끄기 `PROJECT_COURSE_AUTOSTART=0`
- 켜지는 동안 "프로젝트 코스를 켜는 중이에요" 카드, 2초마다 확인. 임베드 화면 아래 줄이 스크롤에 사라지던 것 고침(`overflow-x: clip`)
- 파일: `src/app/api/project-course/[[...path]]/route.ts`, `workspace/ProjectStudy.tsx`, `experiments/project-course/프로젝트코스 실험.cmd`. 기본 주소(로컬 4100)일 때만, 3000은 안 건드림

### 튜터 맥락을 캐시가 맞게 나눔 (`2ca8b1a`)
- 같은 단계 안에서 OpenCode 대화를 이어 쓰는데, 질문마다 계획서·파일 전체·최근 대화를 다시 붙여 중복이 쌓였다
- 이제 계획서·코스 순서·학습자 목표는 첫 메시지에만, 이어 쓸 때는 지금 순서·마지막 검사·지난 질문 뒤 일만, 파일은 바뀌었을 때만. 20번 넘게 주고받으면 새 대화. 기본 엔진(OpenCode 없을 때)은 예전처럼 한 번에
- 파일: `lib/oc-engine.ts`(`promptParts`), `lib/lesson.ts`, `lib/agent.ts`(`CtxFile`, `parts`), `test/oc-prompt.test.ts`

### 튜터 모델 (리서치 스레드, `f85a1c2`)
- `experiments/project-course/lib/oc-engine.ts` 프로젝트 튜터(OpenCode) → gpt-6.1-terra. 되돌림 `RECALLER_ASSIST_MODEL`

## 2. 결정된 것 (모두 건희. **DECISIONS.md에 아직 안 적음**, 넘겨받는 쪽이 덧붙일 것)
- 단계 완료는 **체험 기준 + 정직한 기록**: 해 보면 끝난 걸로 치고, 누가 고쳤는지는 그대로 기록
- 코스 서버는 **필요할 때 켜기**(앱이 대신 켬)
- 코드 리뷰 기능 **보류**
- 튜터 맥락은 **캐시가 맞게**: 안 변하는 것 앞, 바뀌는 것 뒤, 단계 바뀌면 새 대화

## 3. 남은 일
1. **진짜 AI로 확인**: 캐시 맥락 바꾼 뒤 한 단계에서 질문 2~3번(VM에서는 OpenCode를 못 띄워 가짜 AI·단위 테스트로만 확인)
2. **Windows에서 자동 켜기 확인**: 실험 파일 안 누르고 앱에서 프로젝트 공부 열기 → "켜는 중" 뒤 코스가 뜨는지(건희 "봤어", 자세한 결과는 못 들음)
3. **버그**: 채팅에서 "고쳐 줘"로 튜터가 고치면 진도 기록은 힌트 3단계로 맞게 남지만 수업 화면 상태(`State.hints`/`mode`)는 그대로라 통과 문구·프로젝트 노트에 "직접 고침"으로 찍힘(`lesson.ts` `runCheck`, `oc-engine.ts` `recordEdit`)
4. **튜터 맥락·프롬프트 다시 짜기**(건희: "가장 어려운 문제"). 정리한 안:
   - 고정 규칙에 방식별 개입 수준(직접 = 짚기까지 / 같이 = 지금 조각만 / 만들어 줌 = 고친 이유 설명)
   - 학습자 기록 넣기: Recaller 지식(안다/헷갈림/물어봄) + 이번 단계 신호(같은 검사 실패 횟수, 마지막 저장 뒤 시간, 힌트 단계, 질문 수). 진행판 P1·P2(앱 지식·예전 질문 읽기)와 같은 일
   - 코드는 파일 통째보다 단계 시작 뒤 바뀐 부분
   - "왜 불렸나": 코드가 정한 조건(예: 같은 검사 3번 실패)에서 튜터가 먼저 말 걸기. AI는 한두 문장과 선택지만
5. 막혔을 때 빠져나오는 길: 활동 하나만 되돌리기, 실패 종류별 안내, 3번 실패 규칙
6. 3단계 이후도 새 형식으로 옮기기(지금은 2단계만)
7. (진행판) P4 프로젝트 지식으로 복습 문제(1일), P3 힌트 단계를 코드로 지키기

## 4. 주의점
- 같은 작업 폴더를 여러 세션이 같이 쓴다. 자기 파일만 골라 add. `experiments/project-course/CLAUDE.md`는 다른 세션이 고치던 중이라 안 건드렸다
- "만들어 주세요"는 VS Code에 저장 안 한 변경이 있으면 거절하고, 덮어쓰기 전에 `DATA/backups/<run>-<n>-<시각>`에 백업
- 시험: `cd experiments/project-course && npm test`(24개 통과). 끝까지 흐름은 `PC_FAKE_AI=1 PC_DATA_DIR=/tmp/...`
