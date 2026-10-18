# Geometric Transformations 원문 하위목차 출제 사이클 02

상태: **사이클 완료**. 원문 하위목차 8/8을 별도 질문으로 다루고 내용 자체검수·MCP 검사·실제 브라우저 조작·지정 디자인검수를 마쳤다. 필수 미해결 결함은 없다. 이 파일은 생성/내용검수 담당 단독 갱신. 이전 01 사이클 산출물과 고정 원본은 덮어쓰지 않는다.

## 범위·기준

- run ID: `geometric-outline-cycle-20260928-02`; 선택 범위는 원본 `02_Geometric Transformations.pdf`의 PDF 2~7쪽이다. 32쪽 전체로 확대하지 않는다.
- 사용자 기준: 선택한 원문 하위목차마다 별도 질문 최소 1개. 해당 항목 핵심을 한 질문으로 확인하기 어려울 때만 추가. 단순히 숫자만 바꾼 반복 계산은 실패. 기본은 자료 핵심과 오래 기억할 가치에 집중하고 세부·예외는 명시 지시 때 확장한다.
- 같은 원본 MCP Analyze의 선택 말단 8개를 기준으로 한다. 6개 학습목표와 8개 목차는 1:1이 아니다. p7 회전/확대축소는 p3/p4와 같은 고정 학습목표에 연결하지만 **별도 p7 행렬 문항**으로 다룬다. 목표나 원문 근거를 새로 만들지 않는다.
- 출제 모델·추론: `gpt-6-sol` / `medium`. 별도 critic 세션 없음. 생성·공유 준비 UTC와 재시도 횟수는 실제 발생 뒤 기록한다.
- 디자인 담당 `01a0e436-dee6-7ce2-aff9-5cd6aa751bce`가 renderer 동결 준비를 인계했다. 생성 중 renderer·화면 파일 수정 없음. 수정 필요 시 근거/완료조건을 주고 같은 문서 재렌더한다.

## 재현 입력

기준 Git HEAD `cd6ec1dfa83926f9cb7338e72eeee48849d2f55c` (기준 시점). 해당 파일에는 미커밋 변경이 있으므로 아래 실제 바이트 SHA-256을 사용한다.

| 파일 | SHA-256 |
| --- | --- |
| 원본 PDF `C:/Users/jkh01/OneDrive/바탕 화면/예외폴/02_Geometric Transformations.pdf` | `73beb50cced41ee5da481f375fc21dff3b40d12054743767d6ad334d88fb7dca` |
| MCP Analyze `eval/local/product-flow-20260928-geometric/data/mcp/chatgpt-runs/chatgpt-request-cb0b90cecfffa5c231ffe1e6d7b63f8d/run.json` | `088a5d9dd03a31001db9c9321e71a649724fed5e60a3eb88ddc3ba1bf343d731` |
| 선택 ID `eval/local/product-flow-20260928-geometric/configure-input.json` | `1c4761e8d3260f3368515dbd10acdd73d80114ce24c6c140090960ce0b5c3cd6` |
| 패킷 `tools/problem-authoring-lab/runs/geometric-authoring-prototype/source-packet.json` | `bdc248a43f598d8775758fd73da839121ff4cffce588dbe23558651eb62f5b5c` |
| `tools/problem-authoring-lab/mcp-server.ts` | `92b6b7a258ef5ced582e8dd421d24300e74e438e45e466104a310ba6874f62ff` |
| `tools/problem-authoring-lab/contract.ts` | `1395c2f1d0f92205e298e6e429da04d817b9375b1e7457132a1f03e0a99fa6a1` |
| `tools/problem-authoring-lab/renderer.ts` | `763d84538f62f14f41bbab189cd3a9f960510106636606e8bc4adbed20b1da37` |
| `tools/problem-authoring-lab/skill/problem-authoring/SKILL.md` | `d0da217a8750014e179b3d3a990cfcf147f5c6c5cd6ec34d5f0a6cd6b67e6873` |
| 선택형 reference | `eed7ad6f955cb75d55e604bee0a7afec47c201d185201f2fc6335649a29419cd` |
| 빈칸 reference | `5cbae0bc5c8237ddfd494f035bf17f3f6ab220a71475b6924821ba9a02ddac39` |
| 관계 reference | `4b4c9b5ea0313ea6b7f9d34b1347e0eb50a00742e4f823eb0c517d8a5b9ca7ee` |
| `tools/problem-authoring-lab/problem-authoring-lab.test.ts` | `49682d6de5bf8e71a09648171671a04b888e438c20dcbe5922160feb72c39fdc` |
| `package-lock.json` | `82332618bfe05b2b47b18bdf593c7905badf42dc8b8952cd0cbaa1c46b8ef8e8` |

목차 ID·제목·쪽은 위 MCP Analyze `artifacts.analyze.sourceOutline.nodes`와 `configure-input.json`을 직접 읽어 확인했다. 원본 PDF의 2~7쪽 렌더를 직접 대조하며 출제한다. 입력 패킷은 별도 저장 파일 바이트 해시로 고정하고 읽기만 한다.

## 8개 하위목차 커버리지 계획

| 목차 ID | 원문 제목 | PDF 쪽 | 고정 패킷 항목 | 별도 질문/판정 |
| --- | --- | ---: | --- | --- |
| `source-1:outline-3` | Two-Dimensional Translation | 2 | `mcp-learning-1` | `q-outline-3-translation`: 점/변위→새 좌표, 별도 질문 |
| `source-1:outline-4` | Two-Dimensional Rotation | 3 | `mcp-learning-2` | `q-outline-4-rotation`: 양의 90° 회전 결과, 별도 질문 |
| `source-1:outline-5` | Two-Dimensional Scaling | 4 | `mcp-learning-3` | `q-outline-5-scaling`: 축별 결과와 균일성, 별도 질문 |
| `source-1:outline-7` | Matrix Representations and Homogeneous Coordinates | 5 | `mcp-learning-6` | `q-outline-7-general-matrix`: M1/M2 역할, 별도 질문 |
| `source-1:outline-8` | Homogeneous Coordinates | 6 | `mcp-learning-4` | `q-outline-8-homogeneous`: h로 원좌표 복원 및 0 불가 이유, 별도 질문 |
| `source-1:outline-9` | Two-Dimensional Translation Matrix | 7 | `mcp-learning-5` | `q-outline-9-translation-matrix`: 변위 항의 행렬 위치, 별도 질문 |
| `source-1:outline-10` | Two-Dimensional Rotation Matrix | 7 | `mcp-learning-2` (p3+7) | `q-outline-10-rotation-matrix`: p7의 3×3 회전 행렬, p3 좌표회전과 별도 질문 |
| `source-1:outline-11` | Two-Dimensional Scaling Matrix | 7 | `mcp-learning-3` (p4+7) | `q-outline-11-scaling-matrix`: p7의 3×3 확대축소 행렬 의미, p4 점 계산과 별도 질문 |

## 실행·검수 기록

| 사건 | UTC 시각 | 근거 |
| --- | --- | --- |
| 입력 확인 후 생성 시작 | `2026-09-27 20:23:40 UTC` | MCP `load_source_packet` 6개, 입력 SHA `bdc248a4...`; `get_authoring_instructions` skill/reference 해시 기준 일치 |
| 최초 문서 완료 | `2026-09-27 20:25:53 UTC` | `initial-document.json`에 8개 별도 질문 저장 |
| V0 검사·렌더·공유 준비 | `2026-09-27 20:26:54 UTC` | MCP validate `valid=true`, issues 0; render 3상태; `record_problem_iteration`의 `iteration-0` 보존; 로컬 HTTP 200 |
| 지정 디자인검수 착수 수락 | `2026-09-27 20:27:57 UTC` | 담당 `01a0e444-9c76-7162-a891-de6dcd9a6e6d`가 문서/HTML 해시와 URL을 대조하고 실제 화면검수를 착수한다고 직접 회신 |
| 지정 디자인검수 완료 | `2026-09-27 20:30:25 UTC` | 같은 V0 문서·HTML 해시로 실제 브라우저 검수. 8개 모두 정답 제출, 개별 공개 독립성, 기본/375×700 화면 확인. 필수 디자인 결함 0 |

초기 생성 재시도 **0회**. 최초 문서 생성 **2분 13초**, 공유 준비 **3분 14초**. 이 수치는 문서 작성·도구 실행을 포함하며, 준비·대기·검수·수정과 순수 모델 추론 시간을 혼동하지 않는다.

**고정 V0** `iteration-0/document.json` SHA-256 `da004f02e570f61b9c60f9102058e082a07ab667d9af0c83ef2ed55c14ea07b3`; `initial-document.json`은 같은 내용을 record용 직렬화 전 보존. `iteration-0/interactive.html` SHA-256 `8f6efaf9253917f9c2faf1b9f4ca78d81b1432f280fb98d778a93d7f62cfd4c2`. 공유 URL: `http://127.0.0.1:8766/runs/geometric-outline-cycle-20260928-02/iteration-0/interactive.html` (서버가 실행 중일 때만 접근 가능). before/after HTML도 같은 iteration에 있다.

출처 표기 주의: 패킷 `mcp-learning-2,3`은 `sourcePage=3,4`이면서 `sourcePages=[3,7],[4,7]`인 고정 객체다. p7 행렬 문항의 source 객체를 임의로 p7 단일 출처로 바꾸면 패킷 일치 검사에서 오류가 나므로 그대로 둔다. 각 질문 ID/위 표와 문항 해설은 p7의 별도 행렬 근거를 명시하고 실제 PDF 7쪽과 대조한다. 이 표현상의 중복/대표쪽 한계는 출처 부족을 뜻하지 않는다.

### V0 내용·브라우저 자체검수

- 내용: p2의 두 좌표에 변위 더하기 `(−4,2)+(7,−5)=(3,−3)`; p3 양의 90° `(3,−2)→(2,3)`; p4 `(−2,4)`에 `(2,1/2)` 적용→`(−4,2)`, 비균일; p5 `M1` 곱셈 계수/`M2` 평행이동 항; p6 `(18,−12,6)→(3,−2)`와 `h=0`으로 나눌 수 없음; p7 변위 `(−3,4)`는 첫째/둘째 행 셋째 열; p7 양의 90° 회전 행렬 왼쪽 위 `[0,−1;1,0]`; p7 확대축소 대각 `(1/2,2,1)`은 x절반/y두배·비균일이다. PDF 2~7쪽 화면과 대조해 8개 서로 다른 과제를 확인했다. 정답은 선택지 중 하나 또는 단답 허용값으로 유일하다.
- 오답은 회전 방향/부호, 확대축소 축 교환·균일성 오판, `M1/M2` 역할 교환, 동차좌표 복원에서 곱셈·부호 착오, 평행이동 열/부호/대각 혼동, 회전 부호·180°·불필요한 이동, 확대축소 축·균일성·평행이동 혼동을 구별한다. 다만 실제 학습자의 오답 빈도·장기기억 효과는 검증하지 않았다.
- 로컬 HTTP 실제 브라우저에서 8개 문항이 별도로 보이고 q1 좌표 `'(3,-3)'`와 q2~q8의 정답 선택을 각각 제출하면 8개 모두 `정답`으로 판정됐다. q7만 정답 공개했을 때 나머지 7개의 비공개 안내가 유지됐다. 수식 렌더 오류 0, 기본 화면 문서 가로 넘침 0px. 출처 UI는 p7 회전 `PDF 3, 7쪽`, p7 확대축소 `PDF 4, 7쪽`으로 표시되어 p7 근거가 노출된다.
- 지정 디자인검수 담당은 `2026-09-27 20:30:25 UTC`에 같은 V0의 화면검수 완료를 회신했다. 8개 제출/정답공개 버튼, q1 단답과 q2~q8 선택 제출 모두 `정답`, q4만 공개할 때 q3·q5 비공개 유지, 기본 및 375×700 화면의 q1 입력·q4 수식·q6~q7 행렬 보기·q8 분수 행렬/해설을 확인했다. 좁은 화면 수평 넘침 0px, math-error 0, 수식 잘림·겹침 없음. **필수 디자인 결함 0**이며 파일 수정은 없었다.

### 최종 판정과 비차단 한계

- **최종 버전은 `iteration-0` V0 그대로**다. 문서 SHA-256 `da004f02e570f61b9c60f9102058e082a07ab667d9af0c83ef2ed55c14ea07b3`, interactive HTML SHA-256 `8f6efaf9253917f9c2faf1b9f4ca78d81b1432f280fb98d778a93d7f62cfd4c2`. 최초 생성 재시도 0, 수정 iteration 0개. 8개 원문 하위목차별 별도 질문 8/8, 총 8문항이다.
- 디자인 담당의 비차단 제안: (1) 375px 제목의 마지막 `인` 한 글자가 다음 줄에 홀로 떨어짐. (2) 제출 뒤 `정답` 판정이 보일 때도 `정답을 확인한 뒤 표시됩니다` 안내가 남아 채점과 정답 공개의 차이가 모호함. 둘 다 이번 사이클 완료를 막지 않으며 별도 수정은 하지 않았다.
- 패킷의 p3+7/p4+7 공동 출처 때문에 p7 행렬 문항의 단일 `sourcePage` 대표값은 p3/p4다. 그러나 `sourcePages`와 실제 화면 근거에 p7이 포함되고 문항 내용/해설은 실제 PDF 7쪽 행렬에 직접 대응한다. 이 표기 한계를 숨기지 않고 다음 파이프라인 설계 판단으로 남긴다.
- 내용은 담당의 자체검수이며, 학습자 장기기억 효과·난도, 별도 수학 내용 검수, 보조기기·다른 실제 단말/브라우저 실측은 하지 않았다. 이 한계를 실제 검증 성과로 주장하지 않는다.

이번 02 사이클 완료 결과와 최종 URL/해시, 시간, 착수·완료 회신, 비차단 한계를 다음 기획팀 `019ff4f8-2a48-7662-95fe-e6b0fff97092`에 직접 보고했다. 여기서 멈춘다. 새 프롬프트 단계나 공용 계약은 변경하지 않았다.
