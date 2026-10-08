# 기하변환 문제 출제 하네스 실험 결과

2026-09-28. 대상 체크아웃 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/recaller-integration`, 브랜치 `codex/recaller-integration`, 구현 커밋 `d7d479a3`. 제작 담당 모델 GPT-6 Sol / medium, 작업 세션 `01a06c91-acf6-76c1-93e6-41d40849d215`. 세션별 토큰 사용량은 이 평가 환경에서 노출되지 않아 `execution.json`에 미확인으로 기록했다. 별도 AI 검토 세션과 API 호출은 없었다.

## 실제 출제 결과

고정 입력은 `source-packet.json`이며, 실제 이전 MCP Learning Design 제출·출력·게시 파일의 해시가 들어 있다. MCP `load_source_packet`이 반환한 입력 해시는 `bdc248a43f598d8775758fd73da839121ff4cffce588dbe23558651eb62f5b5c`다. `get_authoring_instructions`의 `problem-authoring-method-v2` 지침 해시는 `f6b479783c30f9e2b6b2ee40dc1635a01649f36e0780648efc8ba61ba061f5e0`이며 선택형·빈칸형 참조만 요청했다. 학습 목표와 PDF 2~7쪽 원문은 바꾸지 않았다. 이전 카드 6개의 문항·숫자·선지를 복제하지 않았다.

| 번호 | 형태 | 새 문항 | 정답·검수 |
| --- | --- | --- | --- |
| 1 독립 | 객관식 | `P=(1,2)`, `M1=diag(2,3)`, `M2=(−4,1)`일 때 두 항의 역할과 `P′` 판단 | `M1P=(2,6)`, `M2`는 평행이동, `P′=(−2,7)`; PDF 5쪽 |
| 2 독립 | 단답형 | 동차좌표 `(−12,18,3)`의 평면 좌표 복원 | `(−4,6)`; PDF 6쪽 |
| 3 공통 세트 | 단답형 | 공통 점 `P=(4,1)`을 양의 90° 회전한 직후 좌표 | `(−1,4)`; PDF 3·7쪽 |
| 4 공통 세트 | 객관식 | 그 회전 직후 점을 최종 `Q=(−4,6)`으로 옮기는 3×3 평행이동 행렬 | `[1 0 −3; 0 1 2; 0 0 1]`; PDF 7쪽 |

3·4번은 한 번 제시되는 같은 자료의 `P→회전→평행이동→Q` 과정에 연결되어 있다. 응답 ID는 각각 독립이다. 1·2번은 독립 문항이다. 기본 형식은 제작 AI가 선택했고, 별도 형식 지정 검사에서 1번 `single-choice`, 2번 `short-text`를 강제해도 통과했다.

## 도구 실행과 확인

실제 stdio MCP 서버 `study-forge-problem-authoring-lab`에 `load_source_packet` → `get_authoring_instructions` → `validate_problem_document` → `render_problem_preview` → `record_problem_iteration`을 호출했다. 원본 0차 문서와 렌더는 `iteration-0/`에 있다. 4개 보기를 한 열로 두면 블록 높이가 부족할 수 있어 `apply_problem_patch`로 1·4번의 선택지 블록만 2열로 바꿨다. 1회 수정 후 다시 검증·렌더·기록한 최종본은 `iteration-1/`에 있다. 두 번의 계약 검사 모두 오류 0개이고, 패킷 목표·출처 불일치 0개다. 문항·응답·선지의 안정 ID와 정답은 수정 전후 동일하다.

`verification.json`에는 최종 문서의 정적·함수 단위 검사 24개 통과, 실패 0개가 기록됐다. 확인 범위는 네 문항 존재, 독립 2+공통 2, 공통 자료 HTML 표시 1회, 문항별 제출·정답 공개 컨트롤 4개씩, 풀이 HTML의 정답 해설 비노출, 공개 HTML의 두 객관식 정답 표시, 문항별 정답·오답 채점, 공통 응답 ID 분리다. 단답 입력의 일반 하이픈/유니코드 마이너스 및 공백 변형도 `gradeResponse`에서 정답으로 판정됐다. 제작 산출물과 도구 입출력은 이 디렉터리의 `*.json` 및 `iteration-0/`, `iteration-1/`에 보존했다.

## 미검증 및 결함

실제 브라우저로 로컬 `preview-before.html`을 열어 시각·클릭 검수를 시도했지만 Browser Use URL 정책이 `file:///C:/Users/Public/...` 경로 접근을 차단했다. 정책 메시지는 다른 브라우저 표면·우회 경로도 금지했다. 그래서 **화면의 실제 줄바꿈·겹침·스크롤, 입력란을 직접 클릭해 제출하는 흐름, 정답 공개의 실제 화면 동작은 확인하지 못했다.** 정적 HTML 및 채점 함수 검사 통과를 브라우저 사용 성공으로 대체하지 않는다. 특히 1번 선택지의 2열 너비가 글꼴 환경에 따라 충분한지는 사용자가 파일을 열어 확인해야 한다.

현재 하네스는 제품 학습 앱·Firebase·기록/복습 기능과 연결되지 않은 격리된 시제품이다. `interactive.html`에서 문항별 판정은 로컬 브라우저 내에서만 이뤄지며 사용자 학습 기록에 저장되지 않는다. 4문항의 교육적 품질은 제작 모델의 자체 검수와 코드 계약 통과까지만 확인했고 독립 평가자 검수는 없었다.

사용자가 직접 열어 볼 최종 파일: `iteration-1/before-answer.html`, `iteration-1/after-answer.html`, `iteration-1/interactive.html`. 마지막 파일에서 각 문항을 선택/입력 후 개별 `제출`·`정답 공개`를 눌러 확인할 수 있다. 로컬 파일 접근이 제한된 환경이면 파일 자체를 검토하는 별도 허용 경로가 필요하다.
