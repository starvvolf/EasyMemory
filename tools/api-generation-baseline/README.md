# OpenAI API 생성엔진 독립 복구 도구

이 디렉터리는 현재 활성 MCP 생성 경로와 분리된 비교 전용 도구다. Git 객체
`150138f73301365b7d07fbfab4b8093c8f4409ca`를 임시 디렉터리에 그대로 풀고,
그 커밋의 `scripts/eval-full-runner.ts`와 pipeline 모듈을 실행한다. 현재
`src/lib/pipeline/**`나 UI 파일은 읽어 실행하지 않으며 수정하지도 않는다.

## 기준 선택

`150138f`와 `115c895`는 같은 부모 `fda889e`에서 생성된 형제 스냅샷이다.
두 후보의 OpenAI Responses API 호출과 핵심 프롬프트는 실질적으로 같지만,
`115c895`에는 MCP 테스트, MCP 덱 route, MCP 사용을 위한 schema export와
`sourceId` 호환 변경이 들어 있다. 독립 API 기준에는 이 결합이 없는 `150138f`를
사용한다.

2026-08-17 스냅샷은 당시 사용한 모델(`gpt-5.6-terra`), 추론 강도(`medium`),
Critic 비활성 조건과 카드 출력 축소의 품질 판정을 확인하는 근거로 사용했다.
후보 코드를 스냅샷 코드와 임의로 혼합하지 않는다.

## 실행

```powershell
node tools/api-generation-baseline/run.mjs `
  --pdf "C:\Users\jkh01\OneDrive\바탕 화면\학교\운영체제시험\lecture8.pdf" `
  --env-file "C:\Users\jkh01\OneDrive\문서\CD0625\.env.local" `
  --node-modules "C:\Users\jkh01\OneDrive\문서\CD0625\node_modules"
```

실행 조건은 전체 문서, 학습 목표 `이 자료의 핵심 내용을 반복학습 문제로
익힌다.`, 1회이며 모델 환경 override는 무시하고 위의 역사적 설정으로 고정한다.
API 인증 헤더와 키는 기록하지 않는다. 각 Responses API 응답 원문, 스키마,
토큰 사용량과 호출 시간은 `raw-openai-responses.json`에 저장한다.

결과는 오직 `eval/runs/provider-comparison/deadlock/api/<run-id>/`에 쓴다.

## 오프라인 검사

```powershell
node --test tools/api-generation-baseline/run.test.mjs
```
