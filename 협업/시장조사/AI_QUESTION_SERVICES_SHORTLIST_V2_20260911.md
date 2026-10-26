# 1차 선별 수정안 v2 — 이용 규모 근거 반영

2026-09-11. 기존 65개 rough 조사본과 v1은 기록으로 보존한다. **v1의 '기능이 겹치니 특정 제품을 대신 남긴다'는 결정을 수정한다.** 현재 기준은 이 문서다.

**우선 생성 검증 22개(규모 근거 9개·별도 역할 13개), 코드 참고 3개.** 22개는 인기 순위가 아니며 계정/유료 생성 테스트를 마친 목록도 아니다. 나머지는 규모 미정 14개, 범위 후순위 14개, 핵심 경로 보류 9개, 현재 생성 비교 제외 3개다. 전부 합해 65개다.

## 적용 규칙

1. 먼저 같은 사용 장면으로 묶는다: 개인 자료 학습, 문항 저작/수업, 한국 시험, 범용 AI, 공개 코드.
2. 기능이 겹치면 **같은 기간·집계 대상의 활성 사용자 → 누적 사용자 → 같은 조건의 방문/다운로드 → 검색 관심도** 순서로 대표성 근거를 본다. 기업 공개 숫자는 독립 검증된 실측값으로 취급하지 않는다.
3. 같은 조건의 수치가 없으면 'A보다 작은 제품'으로 확정하지 않는다. 공개 이용 규모는 우선 검증에 포함할 근거로 쓰되 현재 규모 순위를 만들지 않는다.
4. 규모가 작아도 원문 연결·한국 시험·검사 구조 등 별도 비교 역할이 있으면 유지한다. 표에 그 예외 사유를 적는다.
5. 숫자가 없거나 검색 지수가 0이면 **규모 미정**이다. 기능 겹침만으로 최종 탈락시키지 않고 짧은 실생성 검증 후보로 남긴다.
6. 기업 전체 사용자, 교사, 학생, 학습자료 수, 생성 문제 수, 앱 다운로드는 섞지 않는다. 이번에는 동기간 웹 방문/앱 다운로드를 추가 확보하지 않았고 없는 지표를 추정하지 않았다.

현재 확보한 자료만으로 중복 제품의 대규모 '확정 탈락'은 어렵다. **먼저 검증할 후보를 선별한 것이며, 나머지가 모두 품질 탈락한 것은 아니다.** 예산·시간 상한은 사용자와 확정되지 않았으므로 기존 16개 숫자에 맞춰 억지로 자르지 않았다.

## A. 공개 규모 근거로 우선 검증 — 9개

아래 순서는 순위가 아니다. 집계 정의가 달라 숫자 크기만으로 정렬하지 않았다.

| 제품 | 공개 수치 | 지표·한계 | 변경 |
|---|---|---|---|
| [Quizlet](https://quizlet.com/ads/media-kit) | 6,000만+ 월간 활성 사용자 | 공식 광고 자료; 수치 기준 연도 미기재, 주변 자료는 2022년. 2026년 새 측정치로 단정하지 않음. | 유지 |
| [StudySmarter](https://www.studysmarter.co.uk/) | 4,000만+ 학습자 | 공식 홈페이지 현재 표시; 활성 기간·집계 범위 미기재. | 대기 → 복원 |
| [Gizmo](https://www.prnewswire.com/news-releases/gizmo-raises-22-million-series-a-to-make-learning-addictive-for-13-million-learners-worldwide-302741943.html) | 1,300만+ 사용자/학습자 | 2026-04-15 운영사 보도자료; 월간 활성 수 아님. | 대기 → 복원 |
| [Turbo AI (구 TurboLearn)](https://www.turbo.ai/) | 1,000만+ 학습자 | 공식 홈페이지 현재 표시; 활성 기간 미기재. | 대기 → 복원 |
| [StudyFetch](https://www.studyfetch.com/) | 800만+ 사용자 | 공식 홈페이지 현재 표시; 활성 기간 미기재. | 유지 |
| [Knowt](https://knowt.com/) | 약 830만 사용자 | 공식 페이지 추출 8,326,480; 다른 페이지 8,309,435 및 FAQ 500만 병존. 표시값이며 정밀 실시간 사용자 수로 인증하지 않음. | 유지 |
| [Quizgecko](https://quizgecko.com/plans) | 200만+ 학생 | 공식 플랜 페이지 현재 표시; 활성 기간 미기재. | 대기 → 복원 |
| [Jungle](https://jungleai.com/mobile) | 100만+ 학생 | 공식 모바일 페이지 현재 표시; 활성 기간 미기재. | 대기 → 복원 |
| [Kahoot!](https://kahoot.com/company/) | 1,000만+ 연간 이용 교육자 | 공식 회사 소개는 annually로 명시. 학생/전체 사용자 수와 비교 금지. | 대기 → 복원 |

Quizlet의 6,000만 MAU는 공식 자료에 있는 지표지만 기준 연도가 불명확해 2026년 현재 정확한 값으로 확정하지 않는다. StudySmarter·Turbo·StudyFetch 등의 홈페이지 숫자도 AI 생성 기능 사용자만을 뜻하지 않는다. Knowt는 약 830만 표시값과 과거 문구가 병존하므로 StudyFetch보다 현재 더 크다는 결론을 내리지 않는다.

Jungle도 100만+ 학생 근거가 있어 복원했다. Gizmo의 1,300만과 Jungle의 100만+만으로 정확한 활성 사용자 비율을 계산하지 않는다. Kahoot의 연간 교육자는 개인 학습 앱의 학생·사용자와 다른 집단이다.

## B. 규모와 별개로 비교할 역할이 있어 유지 — 13개

| 제품 | 유지 이유 | 규모 처리 |
|---|---|---|
| [NotebookLM](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/) | 자료 기반 Studio 퀴즈·카드; 기존 실생성 기록과 대중 인지도 | Google Trends·기존 실제 생성 근거. 사용자 수로 환산하지 않음 |
| [RemNote](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai) | PDF 읽기·노트·카드·반복학습의 연결 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [NODI (노디)](https://nodilearn.com/) | 원문 근거·오답 개념 변형·숙달 확인을 명시한 국내 직접 비교 후보 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [Wayground (구 Quizizz)](https://help.wayground.com/support/solutions/articles/158000405091-wayground-ai-generate-assessments-from-prompts-documents-videos-more) | 자료 출제→편집→풀이·재시도·리포트 연결 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [QuestionWell](https://questionwell.org/product) | 학습목표 기반 출제·문항 선택·외부 내보내기 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [Questgen](https://www.questgen.ai/) | 순서·짝맞추기 등 다양한 문항 형식의 생성 범위 비교 | 공식 15만+ 사용자. 활성 기간 미기재; Quizgecko보다 우월하다는 근거 없음 |
| [문제G](https://www.moonjeg.com/) | 국어 중심 지문·문항·시험지 제작 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [PlanA AI](https://plana-ai.com/) | 영어 내신·수능 변형문제 비교; 파일 변환과 문제 생성을 분리 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [문항공방](https://munhang.co.kr/english) | 한국 시험 문항 생성과 오답·정답 검토 기능 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [페듀](https://www.pedu.co.kr/) | 영어 지문 출제→학생 응답→채점·복습 연결 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [ChatGPT](https://learn.chatgpt.com/) | 그냥 ChatGPT에 자료를 주고 부탁하는 방식과 비교 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [Gemini](https://support.google.com/gemini/answer/16275879?hl=en) | 사용자가 비교를 요청한 범용 AI이며 기존 생성 결과가 있음 | 동기간 비교 가능한 사용자 수 미확보; 해당 역할을 이유로 유지 |
| [Studley](https://www.studley.ai/flashcard-maker) | 객관식·빈칸·서술시험과 답안 피드백 비교 | 기존 조사 300만 학생 주장; 이번 재조회 본문 확보 실패. 숫자로 선별하지 않음 |

한국 시험형은 해당 국어·영어 지문으로 비교한다. 4개 사이의 사용자 규모 우열은 아직 미정이다. 규모 자료가 없다는 이유로 아무 제품이나 대표 하나로 줄이지 않았다. QuestionWell의 웹 추출 수치가 0 K로 보이는 부분은 정상 이용 규모로 해석하지 않았다.

## C. 코드 구조 참고 — 3개

OpenTutor, Studium, Quizzer. 생성·검사/수정·학습 반영 구조를 비교하는 별도 참고군이다. GitHub 별 수나 사용자 규모를 새로 검증한 결과가 아니며, 상용 웹 서비스 품질 순위에 섞지 않는다.

## D. 남은 후보와 처리 이유

'규모 우열 미정'은 탈락이 아니다. 동기간 규모 자료 또는 작은 공통 생성 테스트로 대표를 정할 대상이다. '범위 후순위'는 이번 PDF 문제 생성과 사용 장면이 다른 이유이며 작은 서비스라는 판정이 아니다.

| 제품 | 처리 | 이유 |
|---|---|---|
| [Raena AI](https://helpcenter.raena.ai/articles/4277621-how-does-the-ai-quiz-generator-work) | 규모 우열 미정 | 과거 100만 이정표는 있으나 현재 동기간 지표 미확보. 선정 제품보다 작다고 확정하지 않고 짧은 생성 검증 후보로 유지. |
| [Brainscape](https://www.brainscape.com/) | 규모 우열 미정 | 2023년 1,000만 사용자 자료는 현재 활성 규모가 아님. 최신 수치/직접 자료 생성 경로를 확인하기 전 규모 탈락 철회. |
| [Mindgrasp](https://www.mindgrasp.ai/quiz-maker) | 규모 우열 미정 | 비교 가능한 활성/누적 사용자 수 미확보. 기능 중복만으로 탈락시키지 않음. |
| [Revisely](https://www.revisely.com/quiz-generator) | 규모 우열 미정 | 생성 문제 수는 사람 수가 아님. 규모 우열 미정; 생성 검증 후보. |
| [Study-Genie (study-genie.ai)](https://www.study-genie.ai/en/quiz-generator) | 규모 우열 미정 | 검색 지수 0과 사용자 수 부재를 규모 열세로 취급하지 않음. |
| [QuizWhiz](https://www.quizwhiz.ai/) | 규모 우열 미정 | 공식 시나리오/학습 추적 안내가 있어 후보 유지. 규모·실제 생성 기능의 짧은 검증 필요. |
| [MagicSchool](https://www.magicschool.ai/) | 범위 후순위 | 교사 업무 전반이라는 범위 차이로 후순위. 기존 교육자 규모 자료가 있어도 개인 자료 출제 이용량을 뜻하지 않음. 사용자 수가 작아서 뺀 것이 아님. |
| [Formative](https://help.formative.com/en/articles/7054157-use-ai-to-generate-questions) | 규모 우열 미정 | 실시간 채점/Practice Sets가 있으므로 단순히 Wayground보다 낮게 두지 않음. 같은 기간 규모 또는 실험으로 결정. |
| [Edcafe](https://www.edcafe.ai/) | 규모 우열 미정 | 학생 응답/피드백 기능 있음. 비교 가능한 이용 규모 미확보; 탈락 미확정. |
| [Conker](https://www.conker.ai/) | 핵심 경로 확인 보류 | 이번 자료 기반 비교의 핵심인 직접 PDF 입력·최신 이용 경로 확인이 부족. |
| [Diffit](https://web.diffit.me/home) | 범위 후순위 | 읽기자료 재작성·수업 활동지 쪽을 별도 검토할 때 재편입. 규모 탈락 아님. |
| [Wooclap](https://docs.wooclap.com/en/articles/8774298-question-builder) | 범위 후순위 | 실시간 참여·그림 라벨 평가 회차로 분리. Google 관심도는 크지만 개인 자료 출제 사용자 수로 환산하지 않음. |
| [Quizalize](https://www.quizalize.com/) | 핵심 경로 확인 보류 | 학급 게임·mastery가 Wayground와 겹치며 자료 입력 범위 확인 부족. |
| [ClassPoint AI](https://www.classpoint.io/ai-quiz-generator) | 범위 후순위 | PowerPoint 확장 경로이므로 이번 웹 직접 생성 회차와 분리. 낮은 규모를 이유로 한 제외 아님. |
| [Quillionz](https://quillionz.com/) | 핵심 경로 확인 보류 | 기존 조사상 영어 중심·현재 제공 조건 미확정. 영어 자료 전용 비교 때 재검토. |
| [PrepAI](https://www.prepai.io/blog/getting-started-with-prepai-a-beginners-guide/) | 핵심 경로 확인 보류 | 접속 문제로 현재 입력·결과 확인 경로를 확보하지 못함. 품질 탈락 아님. |
| [OpExams](https://opexams.com/ai-quiz-generator/) | 규모 우열 미정 | 1,000만 생성 문제는 사용자 수가 아님. Questgen보다 작다는 근거 없음; 생성 검증 후보. |
| [Quizbot.ai](https://quizbot.ai/) | 규모 우열 미정 | Quizgecko/Questgen보다 규모가 작다는 자료 없음. 계산·다유형 생성 짧은 검증 후보. |
| [QuizRise](https://www.quizrise.com/) | 규모 우열 미정 | 규모 우열 미정. 무료 입력/풀이 경로 확인 후 같은 역할 후보와 비교. |
| [Smallpdf](https://smallpdf.com/question-generator) | 범위 후순위 | PDF 편집 도구 전체 브랜드 규모를 AI 출제 이용 규모로 쓰지 않음. 간단 PDF 질문 생성 기준이 필요할 때 추가. |
| [Jotform AI Quiz Generator](https://www.jotform.com/ai/quiz-generator/) | 범위 후순위 | 폼·응답 수집 중심의 별도 사용 장면. 플랫폼 전체 사용자를 AI 학습 출제 사용자로 비교하지 않음. |
| [Eduaide](https://www.eduaide.ai/) | 범위 후순위 | 수업 설계 전반 참고 회차로 분리. QuestionWell보다 작다고 판정한 것은 아님. |
| [똑스 (DOKDOK)](https://www.dokdok.co/teacher) | 핵심 경로 확인 보류 | 교사 첨부자료→출제·기록 연결 및 QGen/Pullim과의 경계를 추가 확인해야 함. |
| [Exameow](https://github.com/heshengtao/exameow) | 범위 후순위 | 생성 코드가 아니라 문제은행·모의시험 UX 비교에서 우선 재검토. 사용자/별점 규모로 코드 우열을 매기지 않음. |
| [MK-QuizFlow](https://github.com/mk-knight23/MK-QuizFlow) | 범위 후순위 | 경량 구현·규칙/AI 혼합 흐름을 참고할 때 재검토. 이용 규모 미확인. |
| [Slay School](https://www.slayschool.com/) | 규모 우열 미정 | Studley보다 작거나 열등하다는 근거 없음. 카드·피드백·내보내기 역할의 대체 후보 유지. |
| [Shiken](https://shiken.ai/how-to-learn/best-ai-quiz-generator-effortlessly-create-custom-quizzes-online) | 핵심 경로 확인 보류 | 현재 자료 입력과 AI 생성 유형의 공식 근거가 충분하지 않음. |
| [Penseum](https://www.penseum.com/) | 범위 후순위 | 튜터·캔버스 상호작용 회차로 분리. 과거 160만 주장만으로 현재 사용자 규모를 확정하지 않음. |
| [Coursebox](https://www.coursebox.ai/ai-quiz-generator) | 범위 후순위 | 코스·LMS 운영 회차로 분리. 생성 코스 수와 사용자 수는 다름. |
| [HyNote](https://hynote.ai/pdf-quiz) | 규모 우열 미정 | 과거 100만+ 전문가·학생 혼합 주장을 개인 학습 사용자와 직접 비교하지 않음. 미정으로 유지. |
| [Quiz-Maker](https://www.quiz-maker.com/AI-Quiz-Generator) | 규모 우열 미정 | 규모 미확정. 수학 검사 주장과 무료 제한을 실제 확인할 때 재선별. |
| [Reinforz](https://www.reinforz.ai/) | 핵심 경로 확인 보류 | 현재 서비스·유료 기능 운영 상태 확인이 부족. |
| [easy-quiz.ai](https://easy-quiz.ai/) | 범위 후순위 | 실시간 다인 풀이·이미지 매칭 회차로 분리. 규모 열세로 판정한 것이 아님. |
| [Scholarcy](https://www.scholarcy.com/) | 현재 생성 비교 제외 | 주로 구조화 요약 카드여서 이번 질문·정답 기반 문제 생성 비교 범위 밖. |
| [Curea QGen / Pullim](https://curea.co/) | 핵심 경로 확인 보류 | B2B/API 문의와 출시/제공 상태 확인이 필요한 별도 경로. 직접 웹 실험군에서 보류. |
| [Claude](https://www.anthropic.com/news/introducing-claude-for-education) | 범위 후순위 | 사용자가 지명하고 기존 자료가 있는 ChatGPT·Gemini로 범용 기준 실험을 시작. Claude 이용 규모 열세라는 의미 없음. |
| [Anki](https://docs.ankiweb.net/) | 현재 생성 비교 제외 | 본체를 AI 자동 출제 제품으로 볼 수 없음. 복습 기능 비교 자료로는 보존. |
| [Monic.ai](https://monic.ai/) | 현재 생성 비교 제외 | 기존 조사에서 공식 종료 공지 확인. 현재 생성 테스트에서 제외. |
| [YouLearn](https://www.youlearn.ai/) | 핵심 경로 확인 보류 | 현재 퀴즈/시험 생성 경로에 대한 근거가 부족. |
| [Algor Education](https://www.algoreducation.com/en) | 범위 후순위 | 개념도·구조 시각화 회차로 분리. 퀴즈 생성 후보 기록은 유지하며 규모 미확인. |

## v1에서 달라진 판단

- **StudySmarter·Gizmo·Turbo AI·Quizgecko·Jungle·Kahoot! 6개 복원.** 기능 중복만으로 대기시킨 근거를 철회했다.
- Knowt는 기존 500만 설명 대신 현재 공식 페이지의 약 830만 표시와 서로 다른 과거 문구를 함께 기록했다.
- Questgen 15만+와 Quizgecko 200만+를 확인했다. 동일 활성 기간이 아니므로 현재 점유율은 비교하지 않지만, Quizgecko를 빼고 Questgen만 남길 근거는 없다. 둘 다 유지한다.
- Formative·OpExams·Quizbot·Slay School 등은 규모 우열 미정으로 변경했다. 선정군보다 작거나 낮은 품질로 표현하지 않는다.
- Brainscape의 오래된 규모 자료, Studley의 이번 재조회 제한, 교사/학생 혼합 수치도 명시했다.

## 다음 검증

22개는 우선 접속·입력·생성 결과 확인 대상으로 둔다. 겹치는 후보를 최종적으로 줄이려면 같은 짧은 자료와 목적에서 생성 성공, 정답 오류, 필요한 사용자 수정 시간을 비교한다. 14개 규모 미정 후보는 그 비교로 대체·추가 여부를 결정한다. 새로운 결제·가입·대량 생성·공유는 이번 재분류에서 수행하지 않았다.

