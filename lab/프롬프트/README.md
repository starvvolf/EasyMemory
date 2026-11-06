# 생성 엔진 프롬프트 모음 (C)

코드(`src/lib/study/gen/`)에 있는 프롬프트를 그대로 뽑은 것이다. **원본은 코드**이고 이 폴더는 보기용이다. 프롬프트를 고친 뒤 다시 만들기:
`node --experimental-strip-types lab/프롬프트_뽑기.mjs`

실행마다 고쳐 보려면 실험실(`lab/엔진 실험 서버.cmd` → http://127.0.0.1:3002/lab/gen) 실행 → **프롬프트** 탭. 거기서 고친 것은 그 실행에만 쓰인다.

## 앱 기본 흐름(목차 → 바로 카드)에서 쓰이는 순서
1. 목차: `PLAN_COMMON` + `PLAN_TASK_CONCEPTS` (+ 영어 자료면 `SOURCE_EN`)
2. 카드: `ORGANIZE` + `MAP_CARD` + 정리 기준(`출제기준/공통.md`·`정리.md`) (+ `SOURCE_EN`)
3. 같이: 학습 목표 `OBJECTIVES_SYSTEM`, 개요·핵심 정리 `WRAP_SYSTEM`
4. 문제(학습자가 누르면): `Q_PICK_GOALS` → 문항마다 `Q_MATERIAL` → `Q_CHOICE`+`Q_SCORE` / `Q_CLOZE` / `Q_WRITE` (OX는 코드가 재료에서) → `Q_EXPLAIN` + 정답 확인 `VERIFY`(빈칸은 `SAME_ANSWER`)

## 목록
| 프롬프트 | 단계 | 기본 모델 | 쓰이는 때 | 역할 |
|---|---|---|---|---|
| [목차 · 지시문(system)](01_PLAN_COMMON.md) | `rc-digest-plan` | gpt-6.1-terra low | 늘 | 목차 호출의 지시문(system). 자료 전체를 읽고 뒤에 붙는 [작업]만 하라는 틀과 쪽 번호 규칙. |
| [목차 · 작업(항목까지)](02_PLAN_TASK_CONCEPTS.md) | `rc-digest-plan` | gpt-6.1-terra low | 목차 → 바로 카드, 개념 줄 | 목차 + 주제마다 배우는 항목(tN-cK)을 쓰게 하는 작업 지시. 앱 기본(목차 → 바로 카드)의 첫 호출. |
| [목차 · 작업(주제만)](03_PLAN_TASK.md) | `rc-digest-plan` | gpt-6.1-terra low | 목차 → 요약 → 카드 | 목차 + 주제 성격만 쓰는 작업 지시(항목 없음). |
| [목차 · 작업(학습 목표 포함)](04_PLAN_TASK_GOALS.md) | `rc-digest-plan` | gpt-6.1-terra low | goalsInPlan | PLAN_TASK 뒤에 학습 목표까지 쓰게 하는 작업 지시. |
| [영어 자료 규칙](05_SOURCE_EN.md) | `(모든 글 쓰는 호출)` | — | 영어 자료 | 영어 자료일 때 글을 쓰는 모든 호출의 지시문 끝에 붙는 규칙. |
| [카드 · 공통 지시(맨 앞, 쪽당 장수 등)](06_ORGANIZE.md) | `rc-digest-card` | gpt-6.1-terra low | 늘 | 카드 호출 지시문의 맨 앞 공통 부분: 카드 종류와 모양, 근거 인용, 오답 메모, 제목 규칙. 예전 쪽 단위 정리에서 쓰던 그대로다. |
| [카드 · 항목에서 바로](07_MAP_CARD.md) | `rc-digest-card` | gpt-6.1-terra low | 목차 → 바로 카드 | 항목(목차가 고른 이름과 쪽)마다 원문을 읽고 카드를 만들게 하는 지시. 앱 기본의 카드 호출. |
| [카드 · 요약 줄에서](08_DIGEST_CARD.md) | `rc-digest-card` | gpt-6.1-terra low | 목차 → 요약 → 카드 | 주제 요약의 본문 줄을 빠짐없이 카드로 덮게 하는 지시. |
| [카드 · 정리 기준(출제기준 폴더, 맨 끝)](09_GUIDE_ORGANIZE.md) | `rc-digest-card` | gpt-6.1-terra low | 늘 | 카드 호출 지시문 맨 끝의 정리 기준. 출제기준 폴더의 공통.md + 정리.md에서 읽는다(파일이 원본). |
| [흐름 카드 · 카드와 같이](10_FLOW_WITH.md) | `rc-digest-card` | gpt-6.1-terra low | flowCard with |  |
| [흐름 카드 · 카드 다음에](11_FLOW_AFTER.md) | `rc-flow` | gpt-6.1-terra low | flowCard after |  |
| [개요·핵심 정리](12_WRAP_SYSTEM.md) | `rc-wrap` | gpt-6.1-terra low | 늘 | 정리 글의 맨 앞 개요 두 문장과 주제마다 시험 전에 볼 것 한 줄. |
| [학습 목표](13_OBJECTIVES_SYSTEM.md) | `rc-q-goals` | gpt-6.1-sol low | 퀴즈 | 시험이라면 확인할 학습 목표 6~12개. 동사(떠올리기·구별·판정·계산·설명)가 문제 형식을 정한다. |
| [학습 목표 · 주는 것·내는 것(목표형)](14_OBJECTIVES_GIVEN.md) | `rc-q-goals` | gpt-6.1-sol low | goalQuiz |  |
| [출제 고르기 · 목표형 형식](15_Q_PICK_CASE.md) | `rc-q-pick` | gpt-6.1-sol low | goalQuiz |  |
| [상황 판정 객관식(목표형)](16_Q_CASE.md) | `rc-q-case` | gpt-6.1-sol low | goalQuiz |  |
| [서술 · 상황만 주기(목표형)](17_Q_WRITE_CASE.md) | `rc-q-write` | gpt-6.1-sol low | goalQuiz |  |
| [출제할 카드 고르기(목표 있음)](18_Q_PICK_GOALS.md) | `rc-q-pick` | gpt-6.1-sol low | 퀴즈 | 학습 목표 하나에 문항 하나, 목표 동사로 형식을 골라 출제할 카드를 정한다. |
| [출제할 카드 고르기(목표 없음)](19_Q_PICK.md) | `rc-q-pick` | gpt-6.1-sol low | 퀴즈 | 목표 없이 카드와 주제 흐름만 보고 출제할 카드를 고른다. |
| [문제 재료(맞는 진술·오개념 쌍)](20_Q_MATERIAL.md) | `rc-q-material` | gpt-6-luna medium | 퀴즈 | 문제 재료: 맞는 진술 3개와 오개념 쌍 5개(한 단어만 다른 맞는/틀린 문장). OX·객관식·빈칸이 여기서 나온다. |
| [객관식](21_Q_CHOICE.md) | `rc-q-choice` | gpt-6-luna medium | 퀴즈 | 객관식 문제 글, 정답, 오답 후보 6개. 상황형 우선, 판단이 두세 갈래면 "판단: 이유" 꼴. |
| [객관식 보기 채점](22_Q_SCORE.md) | `rc-q-score` | gpt-6-luna medium | 퀴즈 | 오답 후보마다 틀림 확실·그럴듯함·같은 꼴·같은 뜻을 매기고, 정답이 질문에 맞는지(fits)를 본다. |
| [빈칸](23_Q_CLOZE.md) | `rc-q-cloze` | gpt-6-luna medium | 퀴즈 | 빈칸 문제 문장 하나와 비울 말 후보 3개. |
| [서술형](24_Q_WRITE.md) | `rc-q-write` | gpt-6.1-sol low | 퀴즈 | 서술형: 왜·어떻게를 2~3문장으로 설명하게 하는 질문, 모범 답, 채점 요소. |
| [해설·힌트](25_Q_EXPLAIN.md) | `rc-q-explain` | gpt-6-luna low | 퀴즈 | 다 만든 문제에 힌트, 보기별 한 줄 설명, 해설, 빈칸 인정 표기, 목표 한 줄. |
| [정답 확인(따로 풀기)](26_VERIFY.md) | `rc-check` | gpt-6.1-terra low | 퀴즈 | 정답을 모르고 카드 근거 쪽만 보고 문제를 따로 푼다. 답이 하나로 안 정해지거나 다르면 그 문항은 버린다. |
| [빈칸 같은 답 판정](27_SAME_ANSWER.md) | `rc-check` | gpt-6.1-terra low | 퀴즈 | 빈칸에서 따로 푼 답이 인정 답과 뜻이 같은지 판정. |
| [주제 요약(성격별)](28_TOPIC_%EC%A3%BC%EC%A0%9C%EC%9A%94%EC%95%BD.md) | `rc-topic` | gpt-6.1-sol low | 목차 → 요약 → 카드 | 주제 하나의 본문 줄·쉬운 설명·흔한 오해. 성격마다 지시가 다르다. |
