# 지시문: 파트 B (지식 저장소)

너는 Recaller의 **B 지식** 담당을 이어받는다. 작업 폴더 `C:\Users\jkh01\coding\Recaller`, 브랜치 `claude/recaller2`. B 전담 스레드는 없었고, 다른 스레드가 B 파일을 고쳤다.

## 먼저 읽을 것
1. `CLAUDE.md`(루트, 특히 "AI 호출 원칙"), `src/lib/knowledge/CLAUDE.md`
2. `협업/인수인계/공통.md` → `협업/인수인계/파트B.md`
3. `협업/현황.md` B 칸, `docs/DECISIONS.md` 10/31 "AI 호출 기본 모델을 terra로", `git log --oneline -20`

## 할 일 (순서대로)
1. `git pull --rebase --autostash origin claude/recaller2`(커밋 안 된 파일이 있어도 받음). B 쪽 커밋 안 된 변경은 없다.
2. **같은 지식 판정 Decisions가 저장 경로에서 실제로 불리는지 확인**: `토큰 사용량 보기.cmd`에서 gpt-6-luna · decisions 성공 줄이 뜨는지. 안 불리면 `dedupe.ts` `judgeForSave` 조건(`OPENAI_API_KEY`, `RECALLER_DEDUPE_ENGINE`)을 본다. 키는 사용자가 넣는다.
3. `src/lib/knowledge/CLAUDE.md` 34줄("주제 정리·층·쉽게 풀어 보기 gpt-6-sol")을 코드에 맞춘다: `classify.ts`는 이미 terra를 쓴다. terra 품질 실측은 **AI 사용량이 드니 먼저 사용자에게 말할 것**.
4. C·D와 계약 구현: `materialKey`, `attachSameMaterial`, `attachQuestions(지식id, {materialKey, title}, 문제[])`. 같은 PDF를 다시 만들면 지식이 44 → 96으로 느는 문제를 이것으로 푼다. `knowledge/api.ts`의 기존 함수는 바꾸지 않고 새 함수를 더한다.
5. 엔진 연결 84개(지도에만 있음)를 저장소로 넘기는 길을 C와 정한다.
6. 플래시카드 앞면 질문형(개념 → "왜 ~인가?", 비교 → "A와 B는 ○○에서 어떻게 다른가?")을 제안한다.

## 사용자 결정 대기
- 복습 입구 하나로 합치기(지식 복습 + PDF 문제 연습). 시연 흐름에 걸리니 먼저 묻는다.
- FSRS 복습 간격, 졸업 기준: 교수님 미팅 뒤.
- 지식 창 "헷갈림:" 칸을 지도처럼 숨길지.

## 지킬 것
- 다른 영역은 `knowledge/api.ts`로만 부른다. 함수 이름·받는 값을 바꾸지 않는다.
- 3000 서버를 묻지 않고 재시작하지 않는다. `.env.local`은 안 고친다. 실험은 별도 포트(`scripts/run-lab.mjs`), 데이터 폴더를 같이 쓰지 않는다.
- 일 하나 끝내면 `협업/현황.md` B 칸을 고쳐 같이 커밋, 정한 것은 `docs/DECISIONS.md`에 덧붙인다.
