# Geometric Transformations 출제 운영 사이클 01

상태: **사이클 완료**. V0 생성·내용 자체검수, DSN-01 화면 수정/자체 재검수, 지정 디자인검수 담당의 최종 화면검수를 마쳤고 필수 미해결 결함은 없다. 이 파일은 실행 담당자가 단독으로 갱신하는 통합 기록이다. 다른 담당의 피드백은 직접 메시지로 받아 아래에 버전과 근거를 붙여 기록한다. 최초 문서와 미리보기는 덮어쓰지 않는다.

## 범위와 입력

- run ID: `geometric-cycle-20260928-01`; 루트: `C:/Users/Public/Documents/ESTsoft/CreatorTemp/recaller-integration/tools/problem-authoring-lab/runs/geometric-cycle-20260928-01/`.
- 원본 PDF: `C:/Users/jkh01/OneDrive/바탕 화면/예외폴/02_Geometric Transformations.pdf`, PDF 2~7쪽. 이전 MCP 결과에서 고정된 목표·원문 패킷: `runs/geometric-authoring-prototype/source-packet.json`, SHA-256 `bdc248a43f598d8775758fd73da839121ff4cffce588dbe23558651eb62f5b5c`.
- 목표: 대학 컴퓨터그래픽스 시험 대비, 2D 평행이동·회전·확대축소 및 동차좌표와 3×3 행렬 의미를 좌표·행렬 계산에 적용. 목표/근거를 재설계하지 않는다.
- 새 문항 수: 독립 2 + 실제 공통자료 연결 2 = 총 4. 기존 `geometric-authoring-prototype` 문항 재포장 금지. 형식은 제작 AI 선택. API·클라우드·제품본체 호출·수정 금지.
- 제작 모델·추론: `gpt-6-sol` / `medium`. 별도 critic 세션 없음. 시간은 실제 UTC 시각만 기록하며 대기·준비·검수·수정 시간은 최초 생성 소요와 분리한다.

## 기준 고정

디자인 담당 `01a0e436-dee6-7ce2-aff9-5cd6aa751bce`가 수식·화면 변경 준비 완료와 실행 중 동결을 직접 인계했다. 출제 담당 소유 파일은 수정하지 않는다. 기준 Git HEAD `cd6ec1dfa83926f9cb7338e72eeee48849d2f55c`; 아래 파일의 미커밋 상태까지 **실제 파일 바이트 SHA-256**으로 고정했다. Git 커밋만으로 재현 상태를 주장하지 않는다.

| 파일 (저장소 상대 경로) | SHA-256 |
| --- | --- |
| `tools/problem-authoring-lab/runs/geometric-authoring-prototype/source-packet.json` | `bdc248a43f598d8775758fd73da839121ff4cffce588dbe23558651eb62f5b5c` |
| `tools/problem-authoring-lab/mcp-server.ts` | `046ed174b7acb603a5c94d21b9e164e59e7f3a97deac0097151a327376382f54` |
| `tools/problem-authoring-lab/contract.ts` | `1395c2f1d0f92205e298e6e429da04d817b9375b1e7457132a1f03e0a99fa6a1` |
| `tools/problem-authoring-lab/renderer.ts` | `dac1481e32cc7126760ecae46609c0784cffa46f4443e78b3bf73f6c8eb63050` |
| `tools/problem-authoring-lab/skill/problem-authoring/SKILL.md` | `d0da217a8750014e179b3d3a990cfcf147f5c6c5cd6ec34d5f0a6cd6b67e6873` |
| `tools/problem-authoring-lab/skill/problem-authoring/references/multiple-choice.md` | `eed7ad6f955cb75d55e604bee0a7afec47c201d185201f2fc6335649a29419cd` |
| `tools/problem-authoring-lab/skill/problem-authoring/references/fill-blank.md` | `5cbae0bc5c8237ddfd494f035bf17f3f6ab220a71475b6924821ba9a02ddac39` |
| `tools/problem-authoring-lab/skill/problem-authoring/references/relationship-structure.md` | `4b4c9b5ea0313ea6b7f9d34b1347e0eb50a00742e4f823eb0c517d8a5b9ca7ee` |
| `tools/problem-authoring-lab/skill/problem-authoring/references/graph-geometry.md` | `5cc300a2cd8a7c2324bacdd868d9b5d36b01aea7d8ba8e9ab4ef1de2625da116` |
| `tools/problem-authoring-lab/runs/geometric-authoring-prototype/design-preview/document.json` | `1e25d576952d2cb3169a5ba4875efb502ecd6f078216278ba345fb684d8fd4f2` |
| `tools/problem-authoring-lab/problem-authoring-lab.test.ts` | `fc2b4c0d8e931fc757ed15cd73fafd4781a4d4629233b47419ba58b8b250be0d` |
| `package-lock.json` | `82332618bfe05b2b47b18bdf593c7905badf42dc8b8952cd0cbaa1c46b8ef8e8` |

검수 기준: [출제 방법론 조사](</C:/Users/Public/Documents/ESTsoft/CreatorTemp/recaller-integration/docs/research/EXAM_ITEM_DESIGN_RESEARCH.md>), [공개 시험문항 27개 적용 분석](</C:/Users/Public/Documents/ESTsoft/CreatorTemp/recaller-integration/eval/local/official-item-methodology-review-20260928.md>). 내용 검수는 목표 일치, 원문·수학적 정확성, 정답 유일성/허용답, 오답의 이유, 답 노출, 공통자료 활용·문항 의존성, 채점 적절성으로 구분한다. 인간 학습효과·난도는 입증하지 않는다.

## 시간·도구 기록

| 사건 | UTC 시각 | 근거/비고 |
| --- | --- | --- |
| 디자인 준비 완료 인계 | 생성 전 | 담당 메시지 수신. 실제 수신 UTC는 기록되지 않아 추정하지 않음 |
| 입력 준비 완료 후 생성 시작 | `2026-09-27 19:49:35 UTC` | MCP `load_source_packet`과 `get_authoring_instructions` 성공 및 기준 해시 기록 뒤 시작 |
| 최초 `document.json` 완료 | `2026-09-27 19:51:37 UTC` | `initial-document.json`, SHA-256 `1a720ff34cd3ba70bac16448015e5486b26a6f95637762e76bdcbcad40c46459` |
| 최초 validate/render·공유 준비 | `2026-09-27 19:52:52 UTC` | MCP 검사 `valid=true`, 오류 0; 3상태 HTML 보존, HTTP 200, 브라우저에서 문항 4개·공통자료 1회 표시 확인 |
| 내용·디자인 검수 | 내용 자체검수 및 지정 화면검수 완료 | 합의된 2영역: 실행 담당이 내용, 디자인검수 담당 `01a0e444-9c76-7162-a891-de6dcd9a6e6d`가 화면. 최초 인계는 담당의 실제 검수로 이어지지 않아 복구 요청 후 최종 `design-fix-1`을 별도로 검수함. 공개 시험문항 27개 방법론 분석은 이 V0의 화면검수 판정이 아님 |
| 수정·재검수 | DSN-01 자체·지정 재검수 통과; EDU-01 비차단으로 재분류 | DSN-01 화면 수정·동일 V0 자체 재검수 통과 후 지정 디자인검수도 통과. EDU-01은 수학적으로 유효한 핵심 관계 적용이므로 추가 출제지침·검사 수정이나 새 문항 재생성을 하지 않음 |
| 지정 디자인검수 최종 회신 | `2026-09-27 20:13:50 UTC`까지 수신 | `design-fix-1` 고정 HTML·동일 V0 문서 대상. 실제 HTTP 브라우저에서 조작과 좁은 화면 확인; 새 필수 디자인 결함 0 |

초기 재시도: **0회**. 최초 생성 소요(시작→최초 문서 저장)는 **2분 2초**. 최초 공유 소요(시작→validate/render·URL 공유 준비)는 **3분 17초**. 이 시간에는 문서 작성·도구 실행이 포함되고 준비/대기·검수·수정 시간은 포함하지 않는다. 순수 모델 추론 시간이라고 해석하면 안 된다.

## 고정 검수 대상과 이슈

**검수 버전 V0:** `iteration-0/document.json`, SHA-256 `1a720ff34cd3ba70bac16448015e5486b26a6f95637762e76bdcbcad40c46459`. `initial-document.json`도 같은 바이트다. 미리보기: `iteration-0/before-answer.html`, `iteration-0/after-answer.html`, `iteration-0/interactive.html`. 접근 URL: `http://127.0.0.1:8766/runs/geometric-cycle-20260928-01/iteration-0/interactive.html` (HTTP 200 확인). 이 URL은 로컬 서버가 실행 중일 때만 접근 가능하다. 검수 시작 시 MCP server/contract/renderer/SKILL 해시는 위 기준표와 다시 일치함을 확인했다.

피드백은 `ID / 문항 / 문제 / 근거 / 소유자 / 완료조건 / 수정결과 / 재검수결과`를 빠짐없이 기록한다. 필수 수정이 없으면 변경을 만들지 않는다.

| ID | 문항·문제 | 근거 | 소유자 | 완료조건 | 수정결과 | 재검수결과 |
| --- | --- | --- | --- | --- | --- | --- |
| EDU-01 | `q-homogeneous-reverse`: `(x,y)`와 `h`에서 `(xh,yh)`를 **만드는** 역방향 문제. 정답 `(-12,20)`은 수학적으로 맞지만 고정 패킷의 세부 target은 `h`로 나누어 원래 좌표를 복원·설명하는 것이다. | 패킷 `mcp-learning-4`의 `target`·`successCriteria`; PDF 6쪽 `x=xh/h, y=yh/h`. 역방향 곱셈도 같은 동차좌표 관계를 적용하며 원문 오류가 없다. 기획팀장 추가 기준: 고정 target 일치와 핵심 학습 가치를 구분. | 출제·품질 담당 내용 자체검수 | **비차단 한계로 분류**: 원좌표 복원·`h≠0` 설명을 직접 평가하지는 못하지만, 이 문항은 핵심 관계를 묻는 유효한 연습이다. 고정 target 불일치만으로 시스템 패치/재생성은 하지 않음. | 출제지침·검사 담당에게 선제 패치 보류 요청; V0 보존 | 자체 수학·채점 확인 통과. 교육적 효과·장기기억은 미검증 |
| DSN-01 | `q-scale-two-points`의 `q1-matrix` 수식 블록에 세로 내부 넘침 7px. 화면은 읽히지만 블록 내부 스크롤/하단 잘림 가능성. | V0 `interactive.html`을 로컬 HTTP에서 실제 브라우저로 열어 DOM 실측: 수식 블록 `scrollHeight=94`, `clientHeight=87`; 다른 블록은 넘침 0. 수식 자체는 `math-error=0`. | 디자인 담당 `01a0e436-dee6-7ce2-aff9-5cd6aa751bce` | **동일 V0 문서 재렌더**에서 수식 내부 스크롤 없이 전체 가시, 다음 박스와 겹침·절단 없음, 좁은 화면도 가독. 원본 V0 불변. `scrollHeight<=clientHeight`는 CSS `overflow:visible` 방식에 맞지 않아 기능적 조건으로 정정. | 공통 `.math`에 `min-height:max-content;overflow:visible` 추가. renderer SHA `dac1481e...`→`763d8453...`. `design-fix-1/document.json`은 V0와 SHA `1a720ff3...` 동일; 새 `interactive.html` SHA `9a432dea...`. | **통과**. 자체 재검수 `2026-09-27 20:00:35 UTC`: HTTP 200, overflow=`visible`, `math-error=0`, 수식 하단과 다음 박스 사이 14px, 전체 행렬 표시, 좁은 화면 가로 넘침 없음. 지정 디자인검수 재확인: 375×700 화면에서 잘림·겹침·가로 넘침 없음. |

### V0 자체검수에서 문제 없던 부분

- PDF 렌더 2·3·4·6·7쪽을 다시 육안 확인했다. `q-scale-two-points`: `S=diag(2,3,1)`이므로 A=(1,−1)→(2,−3), B=(3,1)→(6,3), 비균일. 나머지 선택지는 축 교환·균일성 오판·y축 부호 오류를 겨냥하며 정답은 하나다.
- `q-homogeneous-reverse`: 계산 `xh=−12,yh=20`은 맞고 ASCII `-`와 쉼표 공백도 브라우저에서 정답 판정됐다. EDU-01의 **세부 목표 방향 불일치**는 남지만 같은 핵심 관계를 적용하는 수학적으로 유효한 문항이므로, 자체검수에서는 필수 수정으로 보지 않았다. 원좌표 복원과 `h≠0` 설명은 이 문항에서 직접 평가되지 않는다.
- 공통자료는 A=(−2,1), B=(1,1), T=(3,2), 양의 90° 회전을 한 번만 보여 준다. `q-set-translate-a`: A′=(1,3), `q-set-final-b`: B→(4,3)→(−3,4). 서로 다른 점·단계를 묻기 때문에 앞 문항 정답이 뒤 정답을 직접 노출하지 않는다. q4 오답은 회전 부호, 중간결과에서 중단, 변환 순서 역전을 구별한다.
- 실제 로컬 HTTP 브라우저에서 q1 정답 선택→`정답`, 오답 선택→`오답`; q2 `(-12, 20)`→`정답`; q3 `1, 3`→`정답`; q4 정답 선택→`정답`을 확인했다. q4만 답 공개했을 때 q3은 계속 비공개였고 공통자료 DOM은 1개였다. 정적 검사와 구별되는 실제 브라우저 관찰이다.

### 기획 기준 추가 인계

기획팀장이 사용자 기준을 전달했다: 문제 목적은 자료에서 알아야 할 내용을 짚고 오래 기억하게 하는 것. 무지시 기본은 핵심 중심이며, 세부·예외는 명시 지시가 있을 때 확장한다. 이 기준은 다음 파이프라인 입력 변경 지시가 아니고 현재 V0 평가에서 **고정 target 일치 여부와 실질 교육 결함을 구별**하는 데만 사용한다. EDU-01은 최초 필수로 분류해 담당자에게 알렸으나, 추가 기준과 원문을 대조한 뒤 내용 자체검수에서 비차단 한계로 재분류하고 선제 수정을 보류했다. 합의된 검수 책임은 실행 담당의 내용 자체검수와 지정 디자인검수 담당의 화면검수다. 다음 사이클 기획팀 `019ff4f8-2a48-7662-95fe-e6b0fff97092`에 이 기준을 인계할 것.

## 최종 결과와 검수 범위

- **최종 문항은 V0 그대로**: `iteration-0/document.json` 및 `design-fix-1/document.json`, 양쪽 SHA-256 `1a720ff34cd3ba70bac16448015e5486b26a6f95637762e76bdcbcad40c46459`. 수정된 최종 화면은 `design-fix-1/interactive.html`, SHA-256 `9a432dea277b14b266409e7a3c275de98b958c4a9abacaddd944e6fc56c19030`. 로컬 서버가 실행 중이면 `http://127.0.0.1:8766/runs/geometric-cycle-20260928-01/design-fix-1/interactive.html`로 접근한다. 원본 `iteration-0`은 덮어쓰지 않았다.
- 내용은 실행 담당의 PDF 대조·수학/채점·정답 누설·공통자료 독립성 자체검수다. EDU-01은 고정 target의 세부 방향과 다른 **비차단 관찰**이다. 장기기억 효과, 실제 학습자 난도와 교육적 성과는 측정하지 않았다.
- 지정 디자인검수 담당 `01a0e444-9c76-7162-a891-de6dcd9a6e6d`가 최종 화면을 실제 브라우저에서 확인했다. 4문항·공통자료 1회, q1 정답 선택/제출, q2 `(-12, 20)` 입력/제출, q3 `1, 3` 입력/제출, q4 오답 선택/제출, q4만 정답 공개 시 q3 비공개 유지를 확인했다. 기본 화면과 375×700에서 행렬 수식·보기·공통자료 표·입력칸·공개 해설의 잘림/겹침/가로 넘침이 없었고 좁은 화면 문서 수평 넘침은 0px이었다. 수식 블록은 `scrollHeight=94 > clientHeight=87`이지만 `overflow:visible`로 내용 전체가 표시되고 다음 박스와 겹치지 않았다. **DSN-01 통과, 새 필수 디자인 결함 0**.
- 비차단 UI 개선 의견: 제출 뒤 `정답` 피드백이 보여도 `정답을 확인한 뒤 표시됩니다` 안내가 남아 있어 제출 채점과 별도의 정답 공개를 처음 보는 사용자가 혼동할 수 있다. 이번 사이클에 새 변경은 만들지 않았다. 보조기기 접근성·다른 실제 모바일 기기는 실측하지 않았다.
- 운영상 관찰: 공개 시험문항 27개 분석 자료를 만든 담당에게 V0 검수를 인계했으나, 처음 세 차례 인계 메시지는 실제 화면검수로 이어지지 않았다. 담당이 미실시라고 정정한 뒤 기획팀장이 검수 범위와 최종 대상을 다시 지시했고 결과를 받았다. 최초 인계·실제 착수·검수 완료를 구분해 추적할 필요가 있다. 전체 사이클 벽시계 시간에는 이 대기·재인계가 포함되며 최초 생성 2분 2초와 혼동해서는 안 된다.

사이클 완료 후 현재 기획팀장 `01a07564-4486-7910-a986-cbe88231bc50`, 다음 사이클 기획팀 `019ff4f8-2a48-7662-95fe-e6b0fff97092`에 결과를 인계했다. 운영 피드백 담당 `01a0e462-2196-7733-a0dd-91a7ee9d9a51`에도 이 `CYCLE.md` 절대 경로, 최종 버전, 생성·공유시간, 검수/수정/대기 이력, 담당 간 인계 누락 및 비차단 한계를 전달하고 운영 개선안 분석을 요청했다. 다음 사이클 생성은 시작하지 않았다.
