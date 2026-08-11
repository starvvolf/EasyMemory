# Study Forge eval artifacts

이 디렉터리는 Study Forge의 평가 사례, 실행 결과와 향후 평가 schema를 production 코드와 분리해 관리한다.

## 기본 구조

- `cases/`: 안정적인 case ID, canonical reference와 source manifest
- `experiments/`: 선언된 실험의 manifest와 비교 관계
- `runs/`: 공유 가능한 baseline, control, experiment run
- `local/`: Git에 포함하지 않는 임시 run과 비공개 source. 도구가 필요할 때 생성한다.
- `schemas/`: 향후 validator 또는 JSON Schema를 둘 위치

reference는 좋은 결과의 기준이고 run은 실제 pipeline이 생성한 결과다. 두 artifact를 합치거나 run에 reference의 정답을 복사하지 않는다.

## 기존 browser baseline import

```powershell
npm.cmd run eval:import -- "C:\path\to\study-forge-baseline.json" --case operating-system-deadlock
```

결과는 `eval/runs/<case-id>/<run-id>/`에 생성된다. importer는 기존 browser export에 없는 request payload, 단계별 실행 시각, source content hash 또는 코드 revision을 추정하지 않는다. 이런 값은 `null`과 availability 설명으로 남긴다.

기본 importer test:

```powershell
npm.cmd run eval:import:test
```

## 관리 원칙

- 선언된 비교에 사용하는 run만 Git에 포함한다.
- scratch 결과와 비공개 source는 `eval/local/`에 둔다.
- stage JSON을 수정해 결과를 개선하지 않는다. 다른 결과는 새 run으로 저장한다.
- `observations.json`에는 개수와 ID 대응처럼 기계적으로 계산 가능한 값만 둔다.
- API key, 인증 정보, 전체 환경 변수와 provider 내부 trace를 저장하지 않는다.

세부 규약은 `docs/EVAL_ARTIFACT_STRUCTURE.md`를 따른다.
