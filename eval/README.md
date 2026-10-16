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

## 기존 run 기반 headless 재실행

Eval Runner는 기존 run의 앞 단계 artifact를 그대로 고정하고, 지정한 단계부터 production과 동일한 pipeline 함수로 다시 실행한다. 지원 시작 단계는 `recall`, `prepare`, `cards`, `critic`이다.

실행 전 검증만 수행하는 예:

```powershell
npm.cmd run eval:run -- --case operating-system-deadlock --source-run 20260810T152136Z__whole-document-core-soft-budget__baseline__r01 --from-stage cards --label eval-runner-smoke-test --dry-run
```

실제 실행에서는 `--dry-run`을 제거한다. `recall` 또는 `prepare`부터 실행하려면 legacy run에 원자료 본문이 없으므로 `--override-file`의 `sourceContext.text` 또는 `sourceContext.files`로 원자료를 명시해야 한다.

Override 파일은 source run을 수정하지 않으며 해당 실행에만 적용된다. 허용 범위는 recall option/variant/대표 예시, 단계별 model/reasoning effort, 단계별 추가 instruction, 명시적 source context다. 정의되지 않은 필드는 거부된다.

```json
{
  "artifactType": "study-forge-eval-run-override",
  "artifactVersion": "v0",
  "recall": {
    "optionId": "option-1",
    "variantId": "option-1-template"
  },
  "models": {
    "cards": {
      "model": "gpt-5.4",
      "reasoningEffort": "medium"
    }
  },
  "stageInstructions": {
    "cards": "이번 실험에만 적용할 추가 지시"
  }
}
```

Runner 단위 테스트:

```powershell
npm.cmd run eval:run:test
```
