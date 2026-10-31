# 지식 저장소 (B)

PDF·웹 글·코드 문제·프로젝트가 같이 쓰는 저장소. 같은 지식은 어디서 만나도 하나이고, 일어난 일(기록)을 쌓아 상태와 복습 날짜를 정한다. 동작 정의와 점검: `docs/지식저장소_동작정의와점검.md`, 흐름: `docs/지식저장소_파이프라인.md`.

## 바깥 입구

- 다른 영역은 `api.ts`로만 부른다. 함수 이름과 받는 값은 바꾸지 않는다. 바꿔야 하면 새 함수를 더하고 옛 것은 남긴다.
- 저장 형식을 바꾸면 예전 파일을 처음 읽을 때 자동으로 바꾸는 코드를 같이 넣는다.
- 엔진 → 저장소 약속: `src/lib/study/knowledge-contract.ts`(B·C 공동, 고칠 때 `[경계]` + 상대에게 알림).

## 파일

- `store.ts`: 저장·이름 합치기·기록·상태·복습 · `questions.ts`: AI 없이 만드는 복습 문제 · `sources.ts`: 출처
- 저장 뒤 처리 `after-save.ts` → `classify.ts`(주제·종류), `dedupe.ts`(같은 지식 판정), `layer.ts`(층 나누기)
- `embed.ts`: EmbeddingGemma로 같은 뜻 후보 찾기 · `report.ts`: 점검 보고서 · `materials.ts`: 자료 폴더
- AI 쪽 `../assist/knowledge-ai.ts`, 웹 글 지도 `../assist/article-map.ts`
- 화면 `workspace/KnowledgeWindow.tsx`·`KnowledgeSidebar.tsx`, API `src/app/api/knowledge/`

## 규칙 요약

- 상태: 만남 → 몰랐음(틀림·힌트·물어봄) → 앎(힌트 없이 맞힘) → 졸업(마지막 틀림 뒤 서로 다른 3일에 맞힘). 상태는 내려가지 않는다.
- 복습 간격(상자): 10분 → 1 → 3 → 7 → 16 → 35일. 날짜가 된 것만, 몰랐음 먼저.
- 저장 4초 뒤(화면을 막지 않음): 주제·종류 → 같은 지식 찾기(이름 → 임베딩 후보 5 → AI 판정, "같음"은 학습자에게 묻고 포함·씀·조건·먼저는 고리) → 층 나누기.
- 목표 축은 10/30에 뺐다. 지식은 주제·종류·출처로 본다. `goals.ts`와 목표 API는 예전 데이터 때문에 남겨 두었다.

## 남은 문제 (10/30)

- 같은 지식 의심이 학습자 확인을 기다리며 쌓인다(예: 동적 계획법 / 다이나믹 프로그래밍).
- PDF 문제 연습(덱, 따로 날짜 계산)과 지식 복습이 따로 돈다. 하나로 합칠지 사용자 결정 전.
- 엔진의 중요도(핵심/보조)·연결이 저장소로 안 넘어온다.

## 테스트

`node --experimental-strip-types --test src/lib/knowledge/*.test.ts src/lib/code/*.test.ts src/lib/schedule/*.test.ts`
