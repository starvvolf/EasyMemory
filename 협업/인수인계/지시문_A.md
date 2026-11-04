# 지시문: 파트 A (코드 문제, PS)

너는 Recaller의 **A 코드** 담당을 이어받는다. 작업 폴더 `C:\Users\jkh01\coding\Recaller`, 브랜치 `claude/recaller2`.

## 먼저 읽을 것
1. `CLAUDE.md`(루트, 특히 "AI 호출 원칙"), `src/lib/code/CLAUDE.md`
2. `협업/인수인계/공통.md` → `협업/인수인계/파트A.md`
3. `협업/현황.md` A 칸, `git log --oneline -20`

## 할 일 (순서대로)
1. `git pull --rebase --autostash origin claude/recaller2`(커밋 안 된 파일이 있어도 받음). `git status`로 커밋 안 된 A 파일 5개(`src/app/api/code/[[...path]]/route.ts`, `CodeStudy.tsx`, `CodeTrain.tsx`, `workspace.css`, `code-ai.ts`)를 `git diff --ignore-cr-at-eol`로 확인한다.
2. 사용자에게 3003(`lab/PS 실험 서버.cmd`)에서 훈련 모드·칸별 채점·코치 채팅을 써 봐 달라고 하고, 괜찮다면 **그 5개 파일만** 골라 커밋한다.
3. 3003 사용 피드백(`tmp\lab-ps.log`)으로 조정한다.
4. 시연 전 할 일: 문제 만드는 중 진행 단계 보이기(약 2시간, 지금은 2~5분 "만드는 중"만).
5. 독립 풀이 gpt-6.1-sol을 5문제로 비교 실측한다(**AI 사용량이 드니 먼저 사용자에게 말할 것**). 첫 시도 통과·독립 풀이 일치가 떨어지면 `RECALLER_CODE_SOLVE_MODEL`로 되돌린다.

## 사용자 결정 대기
- 다음 단계 N4(지식에서 문제 고르기), N3(실수 유형 지식), N5·N6(화면 영향). 제안하고 고르게 한다.
- 훈련 모드·지켜보기를 3000 본 앱에 합칠지.

## 지킬 것
- 3000 서버는 묻지 않고 끄거나 재시작하지 않는다. 실험은 3003에서만. `.env.local`은 안 고친다.
- 다른 파트 파일(`experiments/project-course/*`, `ProjectStudy.tsx`, `src/lib/study/gen/*`)을 A 커밋에 섞지 않는다. 영역 밖을 고치면 커밋 첫 줄에 `[경계]`.
- 문제 원문·모범 풀이·숨은 테스트·키는 커밋하지 않는다(공개 저장소).
- 일 하나 끝내면 `협업/현황.md` A 칸을 고쳐 같이 커밋하고, 정한 것은 `docs/DECISIONS.md`에 덧붙인다(정한 사람 적기).
