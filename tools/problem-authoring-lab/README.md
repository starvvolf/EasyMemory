# Problem Authoring Lab

확정된 학습 목표와 원문 근거를 받아 AI가 문제를 제작하는 MCP 하네스다. AI는 목표와 출처를 다시 정하지 않지만, 그 범위 안에서 문제 유형·상황·수치·질문·보기·정답·해설·블록 배치를 판단한다. 객관식이나 빈칸은 예시이지 닫힌 유형 목록이 아니다. 사용자가 문제 형식을 지정했다면 그 선택을 따른다.

## 위치와 실행

- MCP 서버: [`mcp-server.ts`](mcp-server.ts)
- 문서·검증·채점 계약: [`contract.ts`](contract.ts)
- 정답 전·후·대화형 HTML: [`renderer.ts`](renderer.ts)
- 출제 지침: [`skill/problem-authoring/SKILL.md`](skill/problem-authoring/SKILL.md)
- 입력과 기록: `runs/<run-id>/source-packet.json`, `runs/<run-id>/iteration-<0|1>/`

MCP 클라이언트에 아래 stdio 서버를 연결한다. 서버 실행만으로 AI 출제가 시작되지는 않는다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/mcp-server.ts
```

## 현재 도구 흐름

1. `load_source_packet`으로 고정 fixture 또는 `runs/<run-id>/source-packet.json`을 읽는다.
2. `get_authoring_instructions`로 공통 지침과 필요한 방법 참고문서를 읽는다. `methods`는 `selection`, `recall-blank`, `relationship-structure`, `graph-geometry` 중 선택하며, 생략하면 앞의 두 방법이 반환된다.
3. AI가 원문·목표 범위 안에서 `problem-authoring-v1` 블록 문서를 작성한다. 문제 방식과 블록 조합은 참고문서의 예시에만 묶이지 않는다.
4. `validate_problem_document`로 출처·ID·응답·수식 등을 확인하고, `render_problem_preview`의 정답 전·후·대화형 HTML을 살펴본다. 원문 패킷이 있다면 검증과 후속 도구에도 같은 `packetPath`를 전달한다.
5. 문제가 있으면 `apply_problem_patch`로 해당 블록 또는 응답만 고친 뒤 다시 검증·미리보기한다. `formatOverride`는 사용자가 문항별 객관식·단답형을 지정했을 때만 쓴다.
6. `record_problem_iteration`으로 문서·검사·실행 정보와 유효한 HTML을 `runs/`에 남긴다. 이 도구의 `iteration`은 0 또는 1이며, 자체 검증 통과가 독립적인 문제 품질 합격을 뜻하지는 않는다.

행렬을 포함한 수식은 문자열 구분자 대신 `math` 블록이나 선지의 `latex` 필드에 적는다. 원문 그림과 새로 만든 SVG는 서로 다른 자산 계약으로 구분한다.

## 앱과의 연결 상태

`record_problem_iteration`은 하네스 산출물을 저장한다. 앱의 [`/mcp-personalization`](../../src/app/mcp-personalization/page.tsx)은 [`artifacts.ts`](../../src/lib/personalization-lab/artifacts.ts)에서 출처·문서 계약을 확인한 산출물을 읽어 이 렌더러의 대화형 HTML로 보여준다. 따라서 `runs/`에 파일이 생겼다는 이유만으로 모든 실행이 학습 화면에 자동 등록되지는 않는다. 출제부터 앱 등록까지의 일반 자동 연결은 아직 미완료다.

오프라인 계약 검사는 다음 명령으로 실행한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tools/problem-authoring-lab/problem-authoring-lab.test.ts
```

초기 실험과 이전 실행 절차는 [과거 기록](archive/README-history.md)에 보관했다. 현재 실행 절차로 사용하지 않는다.
