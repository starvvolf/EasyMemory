# OpenAI API JSON 직접 생성엔진

이 디렉터리는 비교 실행용 독립 엔진이다. OpenAI Responses API의 strict JSON Schema로
Analyze → Plan → Recall → Prepare → Cards 다섯 단계를 실행한다. JSON 문자열 안에
Markdown 목차나 `LEARNING`·`DESIGN`·`CARD` 블록을 넣지 않으며 MCP parser나
`ChatGptParityService`를 호출하지 않는다.

현재 웹앱의 활성 생성 provider와 연결된 경로가 아니다. 실행 결과를 검토하기 위한
`tools/` 진입점이며 UI, IndexedDB, 공용 타입과 프로덕션 provider는 수정하지 않는다.

## 실행

모델과 추론 강도는 구형 비교 조건과 같은 `gpt-5.6-terra` / `medium`으로 고정된다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/api-generation-json/run.ts `
  --pdf "C:\path\material.pdf" `
  --output "C:\path\api-json-run" `
  --goal "이 자료로 할 수 있어야 하는 일" `
  --instruction "추가 조건" `
  --source-expression-mode adapt `
  --env-file "C:\path\.env.local"
```

실패 후 같은 디렉터리를 이어서 실행하려면 `--resume`을 추가한다. 단계별 최대 시도는
기본 3회이며 `--max-attempts`로 줄일 수 있다. 재시도에는 직전 JSON과 전체 항목별
검증 오류가 전달된다.

## 출력

- `input.json`: PDF 해시와 사용자 조건
- `manifest.json`: 엔진·기준 커밋·모델·시도·토큰·상태
- `attempts/<stage>/attempt-NNN.json`: 요청 schema/context, 원본 응답, 사용량, 오류
- `stages/<stage>.json`: 검증을 통과한 모델 JSON 그대로
- `result.json`: `generatedCards`, ID만 추가한 `appCards`, 양쪽 내용 해시

카드 연결에서 추가하는 값은 저장 식별자 `id`뿐이다. 질문, 답, 빈칸, 선택지, 구조,
근거와 원문 필드는 수정하지 않는다. `normalizeClozeText`, 답 치환, 빈칸 추가,
문장 정리와 자동 fallback은 이 경로에 없다.

## 검사

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tools/api-generation-json/pipeline.test.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/api-generation-json/replay-dfs.ts
npm.cmd run lint
npm.cmd run build
```

고정 fixture는 2026-09-06 구형 `150138f` 실제 DFS/BFS Recall·Prepare·Cards raw
응답과 바이트가 같다. SHA-256은 Recall
`bceb152a1853fac7a7b1dda1fcc3009f1082d50a721986d00cd703789c28a110`, Prepare
`bfb55a828a314a4746c9e8e29e63e8919eb715ff47584c32211d4295eaa47593`, Cards
`be7d3ba93b5d395cacc6cb9496bc675c94bbace725d67a1116789c55b7b39838`이다.

구형·최근 정렬·수정 경로의 차이와 남은 한계는 [COMPARISON.md](./COMPARISON.md)에
정리했다.
