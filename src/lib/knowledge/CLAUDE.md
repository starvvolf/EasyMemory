# 지식 저장소 (B)

PDF·웹 글·코드 문제·프로젝트가 같이 쓰는 저장소. 같은 지식은 어디서 만나도 하나이고, 일어난 일(기록)을 쌓아 상태와 복습 날짜를 정한다. 동작 정의와 점검: `docs/지식저장소_동작정의와점검.md`, 흐름: `docs/지식저장소_파이프라인.md`, 구조도 지식 칸: `협업/구조도/구조도.html#knowledge`.

## 바깥 입구

- 다른 영역은 `api.ts`로만 부른다. 함수 이름과 받는 값은 바꾸지 않는다(`api.test.ts`가 지킨다). 바꿔야 하면 새 함수를 더하고 옛 것은 남긴다.
- 저장 형식을 바꾸면 예전 파일을 처음 읽을 때 자동으로 바꾸는 코드를 같이 넣는다.
- 엔진 → 저장소 약속: `src/lib/study/knowledge-contract.ts`(B·C 공동, 고칠 때 `[경계]` + 상대에게 알림). 가져오기를 고치면 `src/lib/study/knowledge-contract.test.ts`, `src/lib/study/material-map.test.ts`도 돌린다.
- 프로젝트 → 저장소: `src/app/api/project-course/`(D)가 `saveMany`·`recordEvent`만 부른다. 코드 문제 → 저장소: `src/lib/code/service.ts`(A)가 풀이가 끝날 때 한꺼번에 기록한다.

## 파일

- `store.ts`: 저장 · 이름 합치기 · 기록 → 상태 · 복습 상자 · PDF 포인트 가져오기(`importPoints`, 핵심만) · 기다리는 보조 카드(`pickWaiting`, `waiting-points.json`)
- `questions.ts`: AI 없이 만드는 복습 문제 · `sources.ts`: 읽은 글(글 지도 포함)
- 저장 뒤 처리 `after-save.ts`(마지막 저장 4초 뒤, 실패하면 15·30·60·120초 뒤 다시) → `classify.ts`(주제·종류) → `dedupe.ts`(같은 지식 판정·고리) → `layer.ts`(층 나누기 + 쉽게 풀어 보기 `explainKnowledge`)
- `embed.ts`: EmbeddingGemma(서버에서)로 뜻이 가까운 후보 · `report.ts`: 점검 보고서(.md, 점검 17가지)
- `materials.ts`: 지식 창 왼쪽 "자료" 보기(PDF·웹 글 / 프로젝트 / 코드 문제 한 줄씩, 지도 열쇠, 프로젝트 단계) + 자료 폴더(`material-folders.json`)
- `goals.ts`: 목표(10/30에 화면에서 뺌). `listMaterials`·`sourceKey`가 여기 있어서 파일은 남긴다. `dedupe-eval*.ts`: 판정 모델 비교 시험지(실험용)
- AI 쪽 `../assist/knowledge-ai.ts`(웹 글 → 지식, 개념어 고르기, 드래그해서 묻기), 글 지도 `../assist/article-map.ts`
- 화면 `src/app/study/workspace/KnowledgeWindow.tsx`·`KnowledgeSidebar.tsx`·`ArticleStudy.tsx`(글 지도), API `src/app/api/knowledge/[[...path]]/route.ts`

데이터(`STUDY_FORGE_DATA_DIR/knowledge/`): `store.json`(지식·주제 폴더), `events.jsonl`(기록, 덧붙이기만), `vectors.json`, `dupes.json`, `sources/`, `material-folders.json`, `waiting-points.json`, `goals.json`(예전). PC 테스트 데이터는 예전 폴더의 `tmp\review-test-data`(`.env.local`이 가리킴).

## 규칙 요약

- 저장할 때 이름으로 먼저 합친다(띄어쓰기·대소문자·기호 무시, 다른 이름 겹침, 4글자 이상은 글자 닮음 0.88 이상). 학습자가 쓴 뜻은 덮지 않는다. 다른 출처면 "다른 자료에서 다시 만남".
- 상태: 만남(보기만, 복습 안 함) → 몰랐음(틀림·힌트·물어봄) → 앎(맞힘) → 졸업(마지막 틀림 뒤 서로 다른 3일에 맞힘). 다시 만나기만 해서는 상태가 내려가지 않지만, 틀리면 앎·졸업도 몰랐음으로 돌아간다.
- 복습 상자: 10분 → 1 → 3 → 7 → 16 → 35일, 틀리면 1일 뒤부터. 날짜가 된 것만, 몰랐음 먼저. "내 답도 맞아요"는 6시간 안의 틀림을 되돌린다.
- 도움을 받으면 앎으로 치지 않는다: 코드 힌트 받고 통과·프로젝트 정답 줄 보고 통과·지식 창에서 설명 보기는 메모만. 복습 중 답 전에 설명을 열면 물어봄.
- 무엇이 지식이 되나: PDF는 핵심(★) 카드만(보조는 풀거나 "모름"을 누를 때), 웹 글은 핵심 3~5개 + 학습자가 "모름"을 누른 개념어, 코드 문제는 쓰이는 개념, 프로젝트는 코스 개념 + 물어본 문법·도구 말.
- 같은 지식 찾기: 이름 → 같은 주제 안 임베딩 후보 5 → AI 25개씩 판정. "같음"은 자동으로 합치지 않고 지식 창 "정리할 것"에서 학습자가 확인. 포함·씀·조건·먼저는 방향을 맞춰 고리, 비슷한 말은 고리 없이 "가까운 지식". 이유는 "같음"일 때만 쓰게 한다(`RECALLER_DEDUPE_REASONS=all`이면 전부).
- 지식은 주제·종류·출처로 본다(목표 축은 10/30에 뺌). 지식 창은 자료가 먼저, PDF를 누르면 목차(`/api/study-map`), 웹 글은 글 지도.
- 모델: 글 지도 gpt-6.1-terra·low, 주제 정리·판정·층·쉽게 풀어 보기 gpt-6-sol·low(기본). 끄기: `RECALLER_AFTER_SAVE=off`, `RECALLER_DEDUPE=off`, `RECALLER_LAYER=off`.

## 남은 문제 (10/31)

- 같은 PDF를 다시 만들면 엔진이 이름을 다르게 붙여 지식이 는다(44쪽: 44개 → 96개). 같은 자료면 예전 생성에 이어 붙일지 C와 정할 것.
- "같음" 의심이 학습자 확인을 기다리며 쌓인다(예: 동적 계획법 / 다이나믹 프로그래밍). 판정이 가끔 틀림(projection coordinates ↔ Orthogonal Projections).
- 코드 문제 기록이 그 문제의 개념 전부에 똑같이 들어간다(어느 개념에서 막혔는지 안 가름).
- 프로젝트: 객관식 예측을 찍어 맞힌 것도 "맞힘"(코스의 evidence가 안 넘어옴). 처음 만난 개념은 단계 정보가 없어 단계별 보기가 듬성듬성. 빈 어휘 7개(const 등)가 테스트 데이터에 남음(지울지 사용자 결정 대기). 어휘 묶는 단위(async/await)는 D와.
- 글 지도 전 방식이 만든 자유 문구 고리 18개(예전 데이터, 지울지 결정 전).
- PDF 문제 연습(덱, 따로 날짜 계산)과 지식 복습이 따로 돈다. 하나로 합칠지 사용자 결정 전.
- 엔진의 자료 전체 정리 "연결"(의미 고리)은 아직 저장소로 안 넘어온다(카드끼리 냄 → 받음만 고리가 됨).
- 웹 글 그림: C 실험 결과 소제목 덩어리 + 그 덩어리 그림이 가장 좋았다. 확장이 본문을 읽을 때 그림도 순서대로 담기(C와 같이).

## 테스트

`node --experimental-strip-types --test src/lib/knowledge/*.test.ts src/lib/assist/article-map.test.ts src/lib/code/*.test.ts src/lib/schedule/*.test.ts`
가져오기·계약을 건드렸으면 `src/lib/study/knowledge-contract.test.ts src/lib/study/material-map.test.ts`도.
