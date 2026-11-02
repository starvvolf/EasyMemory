# 지시문: 파트 C (생성 엔진, PDF·웹 글)

너는 Recaller의 **C 엔진** 담당을 이어받는다. 작업 폴더 `C:\Users\jkh01\coding\Recaller`, 브랜치 `claude/recaller2`.

## 먼저 읽을 것
1. `CLAUDE.md`(루트, 특히 "AI 호출 원칙"), `src/lib/study/gen/CLAUDE.md`
2. `협업/인수인계/공통.md` → `협업/인수인계/파트C.md`
3. `협업/결과보고/실험_요약에서카드_20261031.md`, `기준_요약카드_유니브급_20261031.md`

## 할 일 (순서대로)
1. `git pull --rebase --autostash origin claude/recaller2`(커밋 안 된 파일이 있어도 받음). **C 코드는 전부 커밋 전이다.** `git diff --ignore-cr-at-eol`로 아래 파일만 확인한다.
   - 새: `src/lib/study/gen/digest.ts`, `digest.test.ts`, `summary.ts`, `summary.test.ts`
   - 고침: `prep.ts`, `prep.test.ts`, `recaller.ts`, `runner.ts`, `types.ts`, `cards.ts`
2. 윈도우에서 엔진·계약 테스트와 `npx tsc --noEmit -p .`를 돌린다("빠른 전처리" 1개는 VM에서만 실패했었다).
3. `docs/DECISIONS.md`에 사용자 결정 3건을 덧붙인다(정한 사람: 사용자): prep-2 보강 두 줄, 엔진 기본 모델(rc-author·rc-check terra low, hedgeMs 8000), 요약 → 카드 "1번" 구조.
4. 사용자에게 묻고 위 파일과 결정, 현황판 C 칸을 **같이** 커밋한다. 결과보고 문서 중 추적 안 된 것(`기준_…`, `실측_PDF통째…`)도 커밋할지 묻는다.
5. 데드락 14쪽 실측(약 300원, **먼저 말할 것**): 목표 첫 글자 ≤5초, 카드 다 됨 ≤40초, 전체 ≤60초, 합격 기준 통과. 그다음 그래픽스 44쪽(약 900원).
6. 주제 크기 나누기/합치기, 비유 다양성, 코드 검사 보강(파트C.md 5절).

## 사용자 결정 대기
- 정리 탭 시안(https://claude.ai/artifact/8U3WJ4wWonCGDKjPfuL2Rm)을 이대로 만들지. 큰 화면 변화라 확인 전에 화면 코드를 쓰지 않는다.
- 실측 실행 승인, 공부 화면 기본값을 digest로 바꿀지(실측 뒤).
- 웹 글 카드 입력 줄이기 실험, E1 실험(같은 자료면 이어 붙이기), 웹 기사 비교 실험.

## 지킬 것
- 실험은 3005(`run-lab.mjs --name text --port 3005 --seed`)나 3002에서. 3000 서버는 묻지 않고 재시작하지 않는다. `.env.local`은 안 고친다.
- 통째로 한 번에 보내지 않고 주제별로 동시에. 모델을 바꾸면 `토큰 사용량 보기.cmd`로 전후 비교.
- 강의 자료·유니브 원문·시안 예시 문장은 커밋하지 않는다. 다른 파트 파일을 C 커밋에 섞지 않는다.
- B와 맞출 것: `materialKey`·`attachSameMaterial`·`attachQuestions` 계약, 엔진 연결 84개를 저장소로.
