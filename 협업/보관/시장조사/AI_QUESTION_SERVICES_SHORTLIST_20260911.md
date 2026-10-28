# AI 문제 생성 서비스 1차 선별안

> 이전 v1 기록. 현재 기준은 [규모 근거 반영 v2](AI_QUESTION_SERVICES_SHORTLIST_V2_20260911.md)다. 아래는 변경 전 기록으로 보존한다.

2026-09-11 · 기존 65개 조사는 rough 조사본으로 유지한다. 이 문서는 그 근거로 테스트 범위를 줄인 **기획 판단**이다. 실제 품질 순위나 검증 완료 목록이 아니다.

**생성 비교 16개 + 코드 구조 참고 3개를 남긴다.** Recaller는 이 외에 비교 대상인 자체 제품으로 별도 둔다. 나머지는 대기·확인 보류·범위 제외로 구분하며 조사 기록은 지우지 않는다.

## 선별 기준

1. **직접성:** 사용자가 가져온 자료로 새 질문·정답을 만드는가. 요약만 하는 도구, 문제은행 검색만 하는 도구는 이번 생성 비교에서 제외한다.
2. **목적 적합성:** 개인 인출학습, 자료 기반 시험 출제, 한국 시험 문항 중 한 축에 직접 기여하는가. 교사 행정·실시간 수업·코스 운영 전반은 후순위다.
3. **검증 경로:** 공식 자료에서 입력→생성→결과 확인 경로를 확인할 수 있는가. 종료는 제외, 제공 상태·핵심 경로 미확정은 보류다. 실제 계정 사용 성공을 뜻하지는 않는다.
4. **비교에서 추가로 알 수 있는 것:** 원문 연결, 학습 루프, 서술 답안, 다양한 형식, 목표 기반 출제, 한국 시험 검토 등 구별되는 비교 질문이 있는가. 비슷한 후보는 대표를 먼저 보고 대기시킨다.
5. **필수 기준군:** '그냥 AI에 부탁하는 방식'인 ChatGPT·Gemini, 내부 구조를 볼 공개 코드 3개는 별도로 유지한다. 제품 UI 점수와 코드 구현 점수를 합치지 않는다.

검색량·가입자 수·가격만으로 탈락시키지 않는다. 기능 미확인은 기능 없음으로 처리하지 않는다. 겹침 때문에 대기시킨 제품이 선정 제품보다 열등하다는 뜻도 아니다.

대표 선정은 이번 조사에서 확인한 기능의 구체성·사용자와의 관련성·이미 확보한 실험 기록을 따른다. 정량 점수로 순위를 확정할 근거는 아직 부족하다. 16이라는 상한을 먼저 정한 것이 아니라 비교 역할을 채운 결과다.

## 1차 생성 비교 후보

| 구분 | 제품 | 남긴 이유 |
|---|---|---|
| 개인 학습 | [NotebookLM](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/) | 자료 기반 Studio 퀴즈·카드; 기존 실생성 기록과 대중 인지도 |
| 개인 학습 | [RemNote](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai) | PDF 읽기·노트·카드·반복학습의 연결 비교 |
| 개인 학습 | [NODI (노디)](https://nodilearn.com/) | 원문 근거·오답 개념 변형·숙달 확인을 명시한 국내 직접 비교 후보 |
| 출제·풀이 | [Wayground (구 Quizizz)](https://help.wayground.com/support/solutions/articles/158000405091-wayground-ai-generate-assessments-from-prompts-documents-videos-more) | 자료 출제→편집→풀이·재시도·리포트 연결 비교 |
| 출제·풀이 | [QuestionWell](https://questionwell.org/product) | 학습목표 기반 출제·문항 선택·외부 내보내기 비교 |
| 출제·풀이 | [Questgen](https://www.questgen.ai/) | 순서·짝맞추기 등 다양한 문항 형식의 생성 범위 비교 |
| 한국 시험 | [문제G](https://www.moonjeg.com/) | 국어 중심 지문·문항·시험지 제작 비교 |
| 한국 시험 | [PlanA AI](https://plana-ai.com/) | 영어 내신·수능 변형문제 비교; 파일 변환과 문제 생성을 분리 |
| 한국 시험 | [문항공방](https://munhang.co.kr/english) | 한국 시험 문항 생성과 오답·정답 검토 기능 비교 |
| 한국 시험 | [페듀](https://www.pedu.co.kr/) | 영어 지문 출제→학생 응답→채점·복습 연결 비교 |
| 범용 AI 기준 | [ChatGPT](https://learn.chatgpt.com/) | 그냥 ChatGPT에 자료를 주고 부탁하는 방식과 비교 |
| 범용 AI 기준 | [Gemini](https://support.google.com/gemini/answer/16275879?hl=en) | 사용자가 비교를 요청한 범용 AI이며 기존 생성 결과가 있음 |
| 개인 학습 | [Studley](https://www.studley.ai/flashcard-maker) | 객관식·빈칸·서술시험과 답안 피드백 비교 |
| 개인 학습 | [Quizlet](https://quizlet.com/features/ai-flashcard-generator) | 카드 암기·Learn/Test의 기준 제품 |
| 개인 학습 | [StudyFetch](https://www.studyfetch.com/practice-test-maker) | 강의자료→연습시험→약점 확인 비교 |
| 개인 학습 | [Knowt](https://knowt.com/flashcards) | 자료→카드→테스트 연결과 카드에서 파생한 문제 비교 |

국어·영어 지문 특화 제품은 해당 과목에서만 비교한다. 모든 제품에 운영체제 PDF를 강제로 넣어 동일 점수를 매기지 않는다. PlanA AI의 문서 변환 기능을 문제 생성 입력 기능으로 간주하지 않는다. 입력 방식이 지문 붙여넣기라면 동일 원문을 붙여넣고 그 수고를 별도로 기록한다.

## 코드 구조 참고

| 프로젝트 | 남긴 이유 |
|---|---|
| [OpenTutor (zijinz456)](https://github.com/zijinz456/OpenTutor) | 내용 트리·다양한 문항·검사/수정·FSRS 구조 |
| [Studium (EmaadAkhter)](https://github.com/EmaadAkhter/Studium) | 생성 후 critic·필터·중복 제거 구조와 검증 누락 사례 |
| [Quizzer (suncloudsmoon)](https://github.com/suncloudsmoon/quizzer) | 페이지 분석·다양한 인출 유형·학습 상태 반영 구조 |

이 3개는 설치·실행 완료가 아니다. 기존 코드 조사 근거를 활용한 구조 참고군이며 16개 웹 서비스와 같은 사용성/품질 순위에 넣지 않는다.

## 나머지 46개 처리 내역

대기는 이번 회차의 중복·범위 조정, 보류는 핵심 사실 확인 부족, 제외는 현재 생성 실험의 범위 밖 또는 종료다.

| 제품 | 처리 | 이유 |
|---|---|---|
| [StudySmarter](https://www.studysmarter.co.uk/) | 대기 후보 | 자료→카드·시험 준비가 StudyFetch·Knowt와 겹침. 학습 계획 검토 시 재편입. |
| [Gizmo](https://gizmo.ai/) | 대기 후보 | 회상·반복학습이 Quizlet·RemNote와 겹침. 모바일 인출 경험을 비교할 때 우선 대체 후보. |
| [Turbo AI (구 TurboLearn)](https://www.turbo.ai/) | 대기 후보 | 녹음·영상 노트까지 넓은 서비스. 이번 PDF 문제 비교는 StudyFetch로 우선 대표. |
| [Quizgecko](https://quizgecko.com/pdf-to-quiz) | 대기 후보 | 자료→여러 퀴즈 생성이 Questgen 및 개인 학습군과 겹침. 대표 후보의 사용 불가·형식 부족 시 우선 대체. |
| [Jungle](https://jungleai.com/mobile) | 대기 후보 | 자료→카드·객관식이 개인 학습군과 겹침. 모바일 사용성 검토 시 재편입. |
| [Raena AI](https://helpcenter.raena.ai/articles/4277621-how-does-the-ai-quiz-generator-work) | 대기 후보 | 다양한 입력·퀴즈가 선정군과 겹침. 표 계산자료 등 입력 확대 시 재편입. |
| [Brainscape](https://www.brainscape.com/) | 대기 후보 | 자신감 기반 카드 복습은 유용하나 이번에는 Quizlet·RemNote로 카드/복습 기준 확보. |
| [Mindgrasp](https://www.mindgrasp.ai/quiz-maker) | 대기 후보 | 자료 대화·노트·퀴즈가 선정 개인 학습군과 겹침. |
| [Revisely](https://www.revisely.com/quiz-generator) | 대기 후보 | 자료→퀴즈·편집·답안 평가가 Studley·Questgen과 겹침. 이미지 입력 문제 발생 시 대체 후보. |
| [Study-Genie (study-genie.ai)](https://www.study-genie.ai/en/quiz-generator) | 대기 후보 | 카드·퀴즈·Anki 내보내기가 선정군과 겹침. Anki 연동 검토 때 재편입. |
| [QuizWhiz](https://www.quizwhiz.ai/) | 대기 후보 | 시나리오·역량 추적이 흥미롭지만 실제 동작 근거가 제한적. 복합 문항 또는 코칭 평가 때 재편입. |
| [Kahoot!](https://kahoot.com/ai-tools/) | 대기 후보 | 실시간 게임·과제 비교는 Wayground로 우선 대표. 대중성만으로 중복 슬롯을 추가하지 않음. |
| [MagicSchool](https://www.magicschool.ai/) | 대기 후보 | 교사 업무 전반 도구라 이번 개인 자료 출제보다 범위가 넓음. |
| [Formative](https://help.formative.com/en/articles/7054157-use-ai-to-generate-questions) | 대기 후보 | 교사의 실시간 피드백·학급 평가가 중심. 이번 출제·풀이 연결은 Wayground로 대표. |
| [Edcafe](https://www.edcafe.ai/) | 대기 후보 | 교사 활동·학생 피드백이 Wayground와 겹침. |
| [Conker](https://www.conker.ai/) | 확인 보류 | 이번 자료 기반 비교의 핵심인 직접 PDF 입력·최신 이용 경로 확인이 부족. |
| [Diffit](https://web.diffit.me/home) | 대기 후보 | 읽기 자료 조정·활동지 중심. 원문을 유지한 인출 문제 비교와 목적 차이. |
| [Wooclap](https://docs.wooclap.com/en/articles/8774298-question-builder) | 대기 후보 | 실시간 수업 참여 중심. 그림 라벨 문제를 집중 검토할 때 별도 재편입. |
| [Quizalize](https://www.quizalize.com/) | 확인 보류 | 학급 게임·mastery가 Wayground와 겹치며 자료 입력 범위 확인 부족. |
| [ClassPoint AI](https://www.classpoint.io/ai-quiz-generator) | 대기 후보 | PowerPoint 확장이어서 이번 웹 기반 자료 입력 실험과 경로 차이. |
| [Quillionz](https://quillionz.com/) | 확인 보류 | 기존 조사상 영어 중심·현재 제공 조건 미확정. 영어 자료 전용 비교 때 재검토. |
| [PrepAI](https://www.prepai.io/blog/getting-started-with-prepai-a-beginners-guide/) | 확인 보류 | 접속 문제로 현재 입력·결과 확인 경로를 확보하지 못함. 품질 탈락 아님. |
| [OpExams](https://opexams.com/ai-quiz-generator/) | 대기 후보 | 다유형 출제는 Questgen으로 대표. PDF 권한·요금 조건 확인 후 대체 가능. |
| [Quizbot.ai](https://quizbot.ai/) | 대기 후보 | 다유형 출제가 Questgen과 겹침. 계산·수학 문항 전용 비교 시 우선 재편입. |
| [QuizRise](https://www.quizrise.com/) | 대기 후보 | 카드·퀴즈·공유·복습이 선정군과 겹침. 저비용 테스트 대체 후보. |
| [Smallpdf](https://smallpdf.com/question-generator) | 대기 후보 | PDF 처리 도구의 질문 생성 기능. 전용 출제·학습 제품을 우선 비교. |
| [Jotform AI Quiz Generator](https://www.jotform.com/ai/quiz-generator/) | 대기 후보 | 폼·응답 수집 중심. 학습 흐름보다 설문/배포 구조 참고에 가까움. |
| [Eduaide](https://www.eduaide.ai/) | 대기 후보 | 수업 설계 전반 보조. 학습목표 기반 출제는 QuestionWell로 우선 대표. |
| [똑스 (DOKDOK)](https://www.dokdok.co/teacher) | 확인 보류 | 교사 첨부자료→출제·기록 연결 및 QGen/Pullim과의 경계를 추가 확인해야 함. |
| [Exameow](https://github.com/heshengtao/exameow) | 대기 후보 | 문제은행·모의시험·오답 UX는 유용하지만 이번 코드 조사 초점은 생성·검증·학습 반영. UX 단계 재편입. |
| [MK-QuizFlow](https://github.com/mk-knight23/MK-QuizFlow) | 대기 후보 | 경량 구현 참고. 이번에는 생성 품질 구조가 더 구체적으로 조사된 3개 코드로 제한. |
| [Slay School](https://www.slayschool.com/) | 대기 후보 | 카드·퀴즈·피드백이 Studley·RemNote와 겹침. 내보내기/반복학습 대체 후보. |
| [Shiken](https://shiken.ai/how-to-learn/best-ai-quiz-generator-effortlessly-create-custom-quizzes-online) | 확인 보류 | 현재 자료 입력과 AI 생성 유형의 공식 근거가 충분하지 않음. |
| [Penseum](https://www.penseum.com/) | 대기 후보 | 튜터·캔버스 중심의 상호작용 학습. 코딩 튜터·도식 설명 단계 재편입. |
| [Coursebox](https://www.coursebox.ai/ai-quiz-generator) | 대기 후보 | 코스 제작·LMS 운영 중심. 개인 자료 출제 실험보다 기업/교육 운영에 가까움. |
| [HyNote](https://hynote.ai/pdf-quiz) | 대기 후보 | 노트·PDF 퀴즈가 선정군과 겹침. 가벼운 무료 진입 비교 시 재편입. |
| [Quiz-Maker](https://www.quiz-maker.com/AI-Quiz-Generator) | 대기 후보 | 다유형·수학 검사 주장이 있으나 검증 범위 미확인. 수학 문항 단계 우선 대체 후보. |
| [Reinforz](https://www.reinforz.ai/) | 확인 보류 | 현재 서비스·유료 기능 운영 상태 확인이 부족. |
| [easy-quiz.ai](https://easy-quiz.ai/) | 대기 후보 | 다인 게임·공유 방은 이번 핵심과 거리. 이미지 퀴즈도 수학 그래프 생성과 구분 필요. |
| [Scholarcy](https://www.scholarcy.com/) | 이번 생성 비교 제외 | 주로 구조화 요약 카드여서 이번 질문·정답 기반 문제 생성 비교 범위 밖. |
| [Curea QGen / Pullim](https://curea.co/) | 확인 보류 | B2B/API 문의와 출시/제공 상태 확인이 필요한 별도 경로. 직접 웹 실험군에서 보류. |
| [Claude](https://www.anthropic.com/news/introducing-claude-for-education) | 대기 후보 | 범용 AI 기준을 우선 ChatGPT·Gemini 두 경로로 확보. 모델/프롬프트 민감도 확장 시 추가. |
| [Anki](https://docs.ankiweb.net/) | 이번 생성 비교 제외 | 본체를 AI 자동 출제 제품으로 볼 수 없음. 복습 기능 비교 자료로는 보존. |
| [Monic.ai](https://monic.ai/) | 이번 생성 비교 제외 | 기존 조사에서 공식 종료 공지 확인. 현재 생성 테스트에서 제외. |
| [YouLearn](https://www.youlearn.ai/) | 확인 보류 | 현재 퀴즈/시험 생성 경로에 대한 근거가 부족. |
| [Algor Education](https://www.algoreducation.com/en) | 대기 후보 | 개념도·시각 구조 학습이 중심 차이. 구조 시각화 평가 단계 재편입. |

## 다음 비교에 적용

16개 전부 유료 결제하거나 대량 생성한 상태가 아니다. 먼저 계정별 실제 입력·생성·결과 확인 가능 여부를 확인하고, 실패·비용 조건은 기록한다. 사용 불가가 확인되면 같은 비교 역할의 대기 후보로 교체한다.

일반 PDF·전공 학습은 개인 학습/출제/범용 AI 군, 한국 시험 문항은 한국 시험 군과 범용 AI 군, 카드 암기는 카드 지원 제품에 적용한다. 모든 제품이 모든 실험에 참여해야 하는 것은 아니다. 첫 결과·수정 결과를 분리하고, 원문 왜곡·정답 오류·사용자 수정 시간·복습 연결을 따로 평가한다.

기존 65개 상세 조사와 Google Trends는 근거 자료로 유지한다. Recaller 차별점은 이번 문서에서 작성하지 않는다.
