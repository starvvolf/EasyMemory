# 구현 검증 기록

검증일: 2026-09-06

## 실행하지 않은 작업

- OpenAI Responses API 유료 생성: 실행하지 않음
- MCP/덱 발행: 실행하지 않음
- 배포: 실행하지 않음
- 기존 round-001 결과 변경: 없음

## 기준 보존

`C:/Users/jkh01/OneDrive/문서/CD0625/eval/generation-quality/baselines/pre-mcp-alignment/`
의 ZIP 2개와 recovery tool 3개를 SHA-256으로 다시 계산했다. 모두
`checksums.json`과 일치했다. 상세 값은 `ALIGNMENT.md`에 있다.

## 새 API 경로 오프라인 테스트

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test `
  tools/api-generation-mcp-aligned/pipeline.test.ts
```

결과: 3 passed, 0 failed.

- 가짜 API 응답으로 Analyze → Concept Tree → Learning Design → Activity Design →
  Cards 전체 흐름 완료
- Learning Design 뒤 중단 후 같은 run 재개
- 잘못된 OX CARD를 서버가 거부하고 정상 CARD 초안을 보존한 뒤 오류 CARD만 재제출
- 잘못된 Analyze 계약이 최대 2회 뒤 중단되고 두 원본 시도 파일이 남음
- 이미 존재하는 출력 디렉터리에 새 run을 시작하지 못함
- PDF 첨부 단계와 미첨부 단계 구분
- Responses API 요청의 strict JSON Schema와 인증값 결과 미포함 확인

## 기존 MCP 회귀

```powershell
npm.cmd run mcp:study-forge:test
```

결과: 14 passed, 0 failed. 기존 MCP 파일은 수정하지 않았다.

## lint

```powershell
npm.cmd run lint
```

결과: 성공, 오류·경고 출력 없음.

## 프로덕션 빌드

```powershell
npm.cmd run build
```

최종 결과: 성공. TypeScript 검사와 13개 정적 페이지 생성을 완료했다.

기존 설치본을 작업 트리 밖에서 junction으로 연결한 첫 시도는 Turbopack이 프로젝트
루트 밖 symlink를 거부해 실패했다. 이는 코드 오류가 아니다. 현재 작업 트리에
`npm.cmd ci --ignore-scripts`로 실제 의존성을 설치한 뒤 같은 빌드를 다시 실행해
성공했다. `node_modules`와 `.next`는 Git 비추적 대상이다.

최종 빌드에는 `next.config.ts → src/lib/codex-app-server.ts →
src/app/api/codex/models/route.ts`의 동적 파일 추적으로 프로젝트 전체가 추적될 수 있다는
기존 Turbopack 경고 1건이 남았다. 새 도구는 해당 import trace에 없다.
