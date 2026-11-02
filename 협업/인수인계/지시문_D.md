# 지시문: 파트 D (프로젝트 코스)

너는 Recaller의 **D 프로젝트** 담당을 이어받는다. 작업 폴더 `C:\Users\jkh01\coding\Recaller`, 브랜치 `claude/recaller2`.

## 먼저 읽을 것
1. `CLAUDE.md`(루트, 특히 "AI 호출 원칙"), `experiments/project-course/CLAUDE.md`
2. `협업/인수인계/공통.md` → `협업/인수인계/파트D.md`
3. Claude 문서 "튜터 에이전트 동작": https://claude.ai/artifact/Q215SNPS1ZjvsYULX1L3Tj

## 할 일 (순서대로)
1. `git pull --rebase --autostash origin claude/recaller2`(커밋 안 된 파일이 있어도 받음). D 커밋(`8fef009`, `2ca8b1a`, `c9f0a2b`)은 모두 올라가 있다.
2. `docs/DECISIONS.md`에 건희 결정 4건을 덧붙인다: 단계 완료는 체험 기준 + 정직한 기록, 코스 서버는 필요할 때 켜기, 코드 리뷰 보류, 튜터 맥락은 캐시가 맞게.
3. 사용자 PC에서 확인: 실험 파일 없이 앱에서 프로젝트 공부를 열면 "켜는 중" 뒤 코스가 뜨는지, 캐시 맥락 변경 뒤 한 단계에서 질문 2~3번 해서 답이 괜찮은지(**AI 사용량이 드니 먼저 말할 것**).
4. 버그 고치기: 채팅 "고쳐 줘"로 튜터가 고치면 화면 상태(`State.hints`/`mode`)가 안 바뀌어 "직접 고침"으로 찍힘(`lesson.ts` `runCheck`, `oc-engine.ts` `recordEdit`).
5. 튜터 맥락·프롬프트 다시 짜기(파트D.md 3절 4번 안). 학습자 기록에 Recaller 지식(안다/헷갈림/물어봄)을 넣는 일은 진행판 P1·P2와 같다. B의 `knowledge/api.ts`로만 읽는다.
6. 그다음: 막혔을 때 빠져나오는 길, 3단계 이후 새 형식, P4 프로젝트 지식으로 복습 문제.

## 사용자 결정 대기
- 튜터 프롬프트 새 안(방식별 개입 수준, "왜 불렸나" 먼저 말 걸기 조건)은 제안 → 건희가 고름 → 구현.
- 튜터 화면 배치(P7).

## 지킬 것
- 3000 서버는 묻지 않고 재시작하지 않는다. 자동 켜기는 4100만. `.env.local`은 안 고친다.
- 같은 작업 폴더를 여러 세션이 쓴다. 자기 파일만 골라 add하고, 영역 밖을 고치면 커밋 첫 줄에 `[경계]`.
- 시험: `cd experiments/project-course && npm test`(24개), 흐름 시험은 `PC_FAKE_AI=1`.
- 일 하나 끝내면 `협업/현황.md` D 칸을 고쳐 같이 커밋.
