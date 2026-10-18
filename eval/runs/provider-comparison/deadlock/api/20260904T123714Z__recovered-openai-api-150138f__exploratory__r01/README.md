# OpenAI API 독립 기준 실행 보고서

## 실행 결과

- 상태: 완료
- 복구 기준: `150138f73301365b7d07fbfab4b8093c8f4409ca`
- 실행 횟수: 실제 OpenAI 전체 파이프라인 1회
- PDF SHA-256: `fd8032502b90879df82d4727feb1c45ec8f4e27bbef8aa3d920c0ebd0fbdd954`
- 범위: 전체 문서
- 학습 목표: `이 자료의 핵심 내용을 반복학습 문제로 익힌다.`
- 현재 MCP 결과 참조: 없음
- 모델: 모든 생성 호출 `gpt-5.6-terra`
- 추론 강도: 모든 생성 호출 `medium`
- Critic: 당시 기본 설정대로 비활성
- 전체 경과 시간: 190,894ms
- OpenAI 호출 누적 시간: 190,523ms
- 입력 토큰: 90,189
- 출력 토큰: 20,418
- 총 토큰: 110,607
- LearningUnit: 18개
- 최종 카드: 26개

실제 API 실행 전에 한 차례 Windows `tar`가 선택 커밋 안의 실행과 무관한 한글
산출물 파일명을 풀지 못해 중단됐다. 이 사전 시도에서는 API 요청이 0건이었다.
복구 도구를 실행 필수 경로(`src`, `scripts`, 설정 파일)만 추출하도록 수정한 뒤
위 전체 파이프라인을 한 번 실행했다.

## 호출별 사용량과 시간

| 단계 | 상태 | 입력 | 출력 | 합계 | 시간 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Analyze | 200 | 14,084 | 4,064 | 18,148 | 34,732ms |
| Plan | 200 | 19,618 | 1,550 | 21,168 | 19,084ms |
| Recall | 200 | 22,026 | 2,246 | 24,272 | 28,096ms |
| Prepare | 200 | 20,810 | 5,600 | 26,410 | 55,309ms |
| Cards | 200 | 13,651 | 6,958 | 20,609 | 53,302ms |

Critic 단계 파일은 생성됐지만 Critic API 호출은 없다. 카드 생성 결과가 그대로
Critic passthrough와 final cards가 됐다.

## 결과 파일

- `raw-openai-responses.json`: OpenAI Responses API 응답 원문, 출력 JSON Schema,
  호출별 모델·사용량·소요시간. 인증 헤더와 API 키는 기록하지 않았다.
- `stages/10-analyze.json`: Analyze 입출력
- `stages/20-plan.json`: 전체 문서 Plan 입출력
- `stages/30-recall.json`: Recall Design 입출력
- `stages/40-prepare.json`: LearningUnit과 OrganizedMaterial 입출력
- `stages/50-cards.json`: 카드 생성 원본 출력
- `stages/60-critic.json`: Critic 비활성 passthrough 출력
- `stages/70-final-cards.json`: 최종 문제 26개 전체
- `recovery-metadata.json`: 복구 커밋, 소스 체크섬, 고정 조건, 모델 및 총사용량
- `checksums.json`: 역사적 runner가 작성한 핵심 산출물 10개의 체크섬

`run.json`의 `code.gitCommit`은 임시 복구 디렉터리가 이 작업 트리 아래에 있어 부모
Git 저장소의 당시 HEAD를 감지한 값이다. 실제 복구 소스는
`recovery-metadata.json`의 `recoveryCommit`과 `restoredSourceChecksums`로 판별한다.
생성 결과를 손으로 수정하지 않기 위해 원본 `run.json`은 그대로 보존했다.

## 기계 검사와 품질 주의점

- `checksums.json`의 산출물 10개를 다시 계산했고 불일치는 0개였다.
- JSON 파일 13개에서 `Bearer` 및 API 키 형태를 검사했고 검출은 0개였다.
- 18개 LearningUnit 모두 적어도 한 카드가 있다.
- `LU07`, `LU08`, `LU09`, `LU13`, `LU16`, `LU18`은 카드가 2~3개다.
- Critic이 비활성이라 최종 카드 26개 모두 `qualityPassed: false`인 초안 상태다.
- 의미 품질 평가는 수행하지 않았다. `observations.json`도 기계적 파생 결과임을
  명시한다.

## 기준 선택 이유

`150138f`와 `115c895`는 같은 부모 `fda889e`의 형제 스냅샷이며 핵심 API 호출과
프롬프트는 실질적으로 같다. `115c895`에는 MCP 테스트·route와 MCP 호환 schema
export 및 `sourceId` 변경이 추가돼 있다. 따라서 현재 MCP 구현과 독립된 전환 직전
API 기준에는 `150138f`가 더 엄격하다. 2026-08-17 스냅샷은 모델·추론 강도,
Critic 비활성 조건과 당시 카드 출력 품질 판단의 근거로만 사용했고 코드를 섞지 않았다.

## 재현 명령

```powershell
node tools/api-generation-baseline/run.mjs `
  --pdf "C:\Users\jkh01\OneDrive\바탕 화면\학교\운영체제시험\lecture8.pdf" `
  --env-file "C:\Users\jkh01\OneDrive\문서\CD0625\.env.local" `
  --node-modules "C:\Users\jkh01\OneDrive\문서\CD0625\node_modules"
```
