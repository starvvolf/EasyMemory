# Study Forge Eval Artifact 구조 설계 v0

## 1. 목적과 범위

이 문서는 Study Forge의 production pipeline 실행 결과를 repository 안에 지속적으로 보관하고, Work와 Codex가 같은 실행 artifact를 읽고 비교하기 위한 파일 구조를 정의한다.

현재 baseline export는 브라우저가 하나의 JSON 파일을 다운로드하는 방식이다. 이 파일에는 분석, 학습 영역 계획, recall design, LearningUnit, 카드와 Critic 결과가 들어 있지만 repository에 저장되지 않으므로 다음 문제가 있다.

- 실행 결과와 진단 문서가 분리된다.
- 다른 작업 주체가 원본 실행 결과를 독립적으로 확인할 수 없다.
- control과 experiment의 실제 입력 차이를 다시 검증하기 어렵다.
- 중간 단계가 바뀐 실험에서 최초 품질 변화가 어디서 발생했는지 추적하기 어렵다.

이 설계는 저장 규약만 정의한다. 다음 항목은 이번 범위가 아니다.

- 자동 evaluator 구현
- production prompt 변경
- production API 또는 UI 변경
- 기존 reference의 JSON schema 확정
- 기존 baseline 결과의 복원 또는 재실행

## 2. 설계 원칙

1. **reference와 run을 분리한다.** reference는 좋은 결과의 기준이고 run은 실제 production 실행 기록이다.
2. **baseline과 experiment run에 같은 구조를 사용한다.** baseline을 별도 포맷으로 만들지 않고 `runKind`로 역할만 구분한다.
3. **단계별 원본 출력을 동결한다.** 후속 단계 결과로 앞 단계 파일을 덮어쓰거나 재구성하지 않는다.
4. **관찰값과 원본 artifact를 분리한다.** 개수와 coverage 같은 파생값은 `observations.json`에 두고, 단계 출력은 `stages/`에 둔다.
5. **control과 experiment를 복사하지 않는다.** experiment manifest가 각 run ID를 참조한다.
6. **재현에 필요한 실행 맥락을 기록한다.** 모델 설정, 코드 상태, 입력 선택, source hash와 단계별 artifact hash를 남긴다.
7. **비밀정보와 불필요한 운영 로그는 저장하지 않는다.** API key, 인증 header, 전체 환경 변수와 내부 로그는 artifact가 아니다.
8. **선언된 실험과 임시 실행을 구분한다.** 비교 근거로 사용할 run만 Git에 커밋하고 scratch run은 로컬 전용 경로에 둔다.

## 3. 권장 directory 구조

```text
eval/
├─ README.md
├─ cases/
│  ├─ operating-system-deadlock/
│  │  ├─ case.json
│  │  ├─ reference.md
│  │  └─ sources/
│  │     └─ source-manifest.json
│  └─ opic-person-description/
│     ├─ case.json
│     ├─ reference.md
│     └─ sources/
│        └─ source-manifest.json
├─ experiments/
│  └─ exp-20260810-count-policy-soft-budget-v1/
│     ├─ manifest.json
│     └─ notes.md
├─ runs/
│  └─ operating-system-deadlock/
│     ├─ 20260810T072047Z__whole-document-core__baseline__r01/
│     │  ├─ run.json
│     │  ├─ inputs.json
│     │  ├─ stages/
│     │  │  ├─ 10-analyze.json
│     │  │  ├─ 20-plan.json
│     │  │  ├─ 30-recall.json
│     │  │  ├─ 40-prepare.json
│     │  │  ├─ 50-cards.json
│     │  │  ├─ 60-critic.json
│     │  │  └─ 70-final-cards.json
│     │  ├─ observations.json
│     │  └─ checksums.json
│     ├─ 20260810T091500Z__count-policy-soft-budget__control__r01/
│     │  └─ ...
│     └─ 20260810T093200Z__count-policy-soft-budget__soft-budget__r01/
│        └─ ...
├─ local/
│  ├─ runs/
│  └─ sources/
└─ schemas/
   └─ README.md
```

`eval/local/`은 Git에서 제외하는 scratch 및 비공개 source 경로다. `eval/schemas/`는 이후 JSON Schema 또는 validator를 추가할 위치만 예약한다. 이번 단계에서는 자동 검증 코드를 만들지 않는다.

## 4. Case와 reference/gold 저장 위치

### 4.1 canonical 위치

각 평가 사례의 기준은 다음 위치를 canonical source로 사용한다.

```text
eval/cases/<case-id>/case.json
eval/cases/<case-id>/reference.md
eval/cases/<case-id>/sources/source-manifest.json
```

- `case.json`: 안정적인 case ID, 제목, 학습 목표, reference 위치, source ID를 연결한다.
- `reference.md`: 사람이 검토하는 gold/reference다. 현재 `docs/references/*.md`의 역할을 이어받는다.
- `source-manifest.json`: 원자료의 파일명, 크기, MIME type, SHA-256, 페이지 수와 저장 정책을 기록한다.

현재의 다음 문서는 향후 명시적인 migration 작업에서 옮긴다. 이 설계 작업에서는 이동하거나 중복 생성하지 않는다.

- `docs/references/OPERATING_SYSTEM_DEADLOCK.md`
- `docs/references/OPIC_PERSON_DESCRIPTION.md`

이동 전까지는 `case.json`이 기존 문서 경로를 참조해도 된다. migration 후에는 기존 경로에 복사본을 남기지 않고 링크 문서만 남겨 canonical reference가 둘이 되는 것을 방지한다.

### 4.2 `case.json` 최소 예시

```json
{
  "artifactType": "study-forge-eval-case",
  "artifactVersion": "v0",
  "caseId": "operating-system-deadlock",
  "title": "Operating System Deadlock",
  "referencePath": "docs/references/OPERATING_SYSTEM_DEADLOCK.md",
  "sourceManifestPath": "eval/cases/operating-system-deadlock/sources/source-manifest.json",
  "status": "active"
}
```

reference는 특정 run, 모델, prompt 또는 카드 수를 정답으로 기록하지 않는다. 실행 설정은 run artifact에만 둔다.

## 5. Run artifact 저장 위치와 naming convention

### 5.1 저장 위치

모든 공유 가능한 baseline과 experiment run은 다음 위치에 저장한다.

```text
eval/runs/<case-id>/<run-id>/
```

baseline도 여기에 저장한다. 별도의 `baselines/` directory를 두면 같은 run을 복사하거나 두 위치에서 관리할 위험이 있으므로 사용하지 않는다.

### 5.2 run ID

```text
<UTC timestamp>__<run-label>__<arm-id>__r<replicate>
```

예시:

```text
20260810T072047Z__whole-document-core__baseline__r01
20260810T091500Z__count-policy-soft-budget__control__r01
20260810T093200Z__count-policy-soft-budget__soft-budget__r01
```

규칙:

- timestamp는 UTC의 `YYYYMMDDTHHMMSSZ`를 사용한다.
- `run-label`과 `arm-id`는 소문자 kebab-case를 사용한다.
- 반복 실행은 `r01`, `r02`처럼 표시한다.
- 생성된 run ID는 디렉터리 생성 후 바꾸지 않는다.
- 모델명, 카드 수, 성공 여부는 이름에 넣지 않는다. 이 값은 manifest의 데이터이며 나중에 달라질 수 있다.
- 같은 초에 충돌하면 timestamp 뒤가 아니라 replicate를 증가시킨다.

## 6. Experiment manifest와 control 연결

### 6.1 저장 위치

```text
eval/experiments/<experiment-id>/manifest.json
eval/experiments/<experiment-id>/notes.md
```

experiment ID는 다음 형식을 권장한다.

```text
exp-<YYYYMMDD>-<independent-variable>-v<revision>
```

예시:

```text
exp-20260810-count-policy-soft-budget-v1
```

날짜는 실험을 처음 선언한 날짜다. manifest 문구 수정 때문에 ID를 바꾸지 않는다. 독립 변수나 비교 설계가 달라지면 새 experiment ID를 만든다.

### 6.2 `manifest.json` 최소 구조

```json
{
  "artifactType": "study-forge-experiment-manifest",
  "artifactVersion": "v0",
  "experimentId": "exp-20260810-count-policy-soft-budget-v1",
  "caseId": "operating-system-deadlock",
  "status": "completed",
  "question": "hard exact count를 soft budget으로 바꾸면 semantic coverage 손실이 줄어드는가?",
  "hypothesis": "soft budget은 LearningUnit별 카드 coverage를 보존할 가능성이 높다.",
  "independentVariable": {
    "name": "countPolicy",
    "control": "exact",
    "experiment": "soft_budget"
  },
  "controlledVariables": [
    "source",
    "runMode",
    "modelConfiguration",
    "recallDesign",
    "cardMode"
  ],
  "arms": [
    {
      "armId": "control",
      "role": "control",
      "runIds": [
        "20260810T091500Z__count-policy-soft-budget__control__r01"
      ]
    },
    {
      "armId": "soft-budget",
      "role": "experiment",
      "runIds": [
        "20260810T093200Z__count-policy-soft-budget__soft-budget__r01"
      ]
    }
  ],
  "knownConfounds": [
    "실제 두 run에서 recall design이 동일하지 않았음"
  ],
  "referencePath": "eval/cases/operating-system-deadlock/reference.md"
}
```

control과 experiment의 연결은 다음 두 방향으로 명시한다.

- experiment manifest는 `arms[].runIds`로 run을 가리킨다.
- 각 `run.json`은 `experimentId`, `armId`, `role`을 기록한다.

run 내부에 control artifact를 복사하지 않는다. experiment arm이 특정 control 하나에 직접 의존할 필요가 있으면 `run.json`에 `comparisonRunIds`를 추가한다.

## 7. Run 내부 파일

### 7.1 `run.json`

run의 identity와 재현 맥락을 기록한다.

```json
{
  "artifactType": "study-forge-eval-run",
  "artifactVersion": "v0",
  "runId": "20260810T093200Z__count-policy-soft-budget__soft-budget__r01",
  "caseId": "operating-system-deadlock",
  "runKind": "experiment",
  "experimentId": "exp-20260810-count-policy-soft-budget-v1",
  "armId": "soft-budget",
  "role": "experiment",
  "status": "completed",
  "startedAt": "2026-08-10T09:32:00.000Z",
  "completedAt": "2026-08-10T09:35:10.000Z",
  "code": {
    "gitCommit": "<commit-sha-or-null>",
    "gitDirty": true,
    "runtimePromptFiles": [
      "src/app/api/analyze/route.ts",
      "src/app/api/plan/route.ts",
      "src/app/api/recall-design/route.ts",
      "src/app/api/generate/route.ts"
    ]
  },
  "modelConfiguration": {
    "analyze": { "model": "...", "reasoningEffort": "..." },
    "plan": { "model": "...", "reasoningEffort": "..." },
    "recall": { "model": "...", "reasoningEffort": "..." },
    "prepare": { "model": "...", "reasoningEffort": "..." },
    "cards": { "model": "...", "reasoningEffort": "..." },
    "critic": { "model": "...", "reasoningEffort": "..." }
  },
  "sourceIds": ["lecture8-pdf-sha256-<short-hash>"],
  "stageFiles": {
    "analyze": "stages/10-analyze.json",
    "plan": "stages/20-plan.json",
    "recall": "stages/30-recall.json",
    "prepare": "stages/40-prepare.json",
    "cards": "stages/50-cards.json",
    "critic": "stages/60-critic.json",
    "finalCards": "stages/70-final-cards.json"
  }
}
```

`runKind`는 `baseline`, `control`, `experiment`, `exploratory` 중 하나를 사용한다. Git에 커밋되는 비교 run은 보통 `baseline`, `control` 또는 `experiment`다.

작업 트리가 dirty인 상태의 run도 금지하지 않는다. 다만 `gitDirty: true`를 반드시 기록하고, `checksums.json`에 실제 runtime prompt 파일 hash를 남겨 commit SHA만으로 재현 가능한 것처럼 보이지 않게 한다.

### 7.2 `inputs.json`

사용자가 선택했거나 실행 전에 확정된 입력만 기록한다.

- source file metadata와 source ID
- run mode
- 사용자의 추가 instruction
- count policy와 soft budget
- 선택한 학습 영역 또는 whole-document-core plan 사용 여부
- 선택한 recall option과 variant
- representative example
- card mode와 variable handling

단계 출력에서 역으로 추정한 값을 입력처럼 기록하지 않는다. API key, request header, 브라우저 경로와 전체 환경 변수는 기록하지 않는다.

현재 browser baseline의 `userSelections`는 이 파일로 옮길 수 있다.

### 7.3 `observations.json`

원본 stage artifact에서 기계적으로 계산 가능한 관찰값과 사람이 남긴 짧은 주석을 기록한다.

```json
{
  "artifactType": "study-forge-run-observations",
  "artifactVersion": "v0",
  "runId": "...",
  "counts": {
    "learningUnits": 26,
    "generatedCards": 27,
    "criticCards": 27,
    "finalCards": 27
  },
  "learningUnitCardCoverageBasis": "finalCards",
  "learningUnitCardCoverage": {
    "LU-01": 1,
    "LU-26": 2
  },
  "zeroCardLearningUnitIds": [],
  "multipleCardLearningUnitIds": ["LU-26"],
  "notes": []
}
```

이 파일은 evaluator 결과가 아니다. `semanticCoverage: good`처럼 의미 판단이 필요한 결론을 자동 관찰값과 섞지 않는다. 이후 evaluator가 생기면 `evaluation/` 아래에 별도 결과를 둔다.

### 7.4 `checksums.json`

다음을 SHA-256으로 기록한다.

- source file 또는 승인된 source fixture
- `inputs.json`
- 모든 `stages/*.json`
- runtime prompt가 들어 있는 실제 route 파일
- `src/lib/model-config.ts`

checksum은 파일이 동결된 뒤 만들어야 한다. checksum 생성 후 stage 파일을 수정하면 해당 run은 새 run으로 다시 저장해야 한다.

## 8. Frozen intermediate artifact 저장 방식

각 stage 파일은 공통 envelope를 사용한다.

```json
{
  "artifactType": "study-forge-stage-artifact",
  "artifactVersion": "v0",
  "runId": "...",
  "stage": "prepare",
  "capturedAt": "2026-08-10T09:34:00.000Z",
  "modelConfiguration": {
    "model": "...",
    "reasoningEffort": "..."
  },
  "inputRefs": [
    "inputs.json",
    "stages/30-recall.json"
  ],
  "request": {},
  "response": {}
}
```

`request`와 `response`에는 해당 단계가 실제 사용하고 반환한 JSON payload를 저장한다. 사람이 읽기 좋게 정렬할 수는 있지만 필드 삭제, 요약, 의미 변경 또는 후처리 보정은 하지 않는다. raw provider response 전체, chain-of-thought, 인증 header와 운영 telemetry는 저장 대상이 아니다.

단계별 내용은 다음과 같다.

| 파일 | 저장 내용 | 현재 baseline 대응 |
|---|---|---|
| `10-analyze.json` | PDF별 구조 분석 요청과 `PdfAnalysisResponse` | `stages.analyze` |
| `20-plan.json` | focused plan 및 whole-document-core plan의 실제 요청과 응답, 최종 선택 전 draft | `stages.plan`, `stages.wholeDocumentCorePlan` |
| `30-recall.json` | recall design draft와 사용자가 확정한 option/variant | `stages.recallDesign`, `stages.selectedRecallDesign` |
| `40-prepare.json` | prepare 요청, `LearningUnit[]`, `OrganizedMaterial` | `stages.prepare` |
| `50-cards.json` | Critic 전 생성 카드 | `stages.cards` |
| `60-critic.json` | Critic 입력과 Critic이 반환한 카드 및 품질 필드 | `stages.critic` |
| `70-final-cards.json` | Critic 이후 실제 최종 CardSet | `stages.finalCards` |

### 단계 경계 규칙

- `plan`에는 focused plan과 whole-document-core plan이 모두 존재할 수 있다. 실행되지 않은 분기는 `null`로 명시한다.
- `recall`은 추천 draft와 최종 사용자 선택을 모두 보존한다. 선택 결과만 남기면 추천이 달라졌는지 분석할 수 없다.
- `prepare`는 LearningUnit뿐 아니라 그 시점의 `OrganizedMaterial`도 보존한다.
- `cards`는 Critic 전 결과다. Critic 후 결과로 덮어쓰지 않는다.
- `critic`은 Critic 자체의 반환값이다. UI에서 사용자가 이후 수정한 카드와 구분한다.
- `final-cards`는 production pipeline이 완료된 직후의 CardSet이다. 사용자가 수동 수정한 결과를 저장하려면 나중에 `80-user-edited-cards.json`을 별도로 추가하고 기존 파일을 덮어쓰지 않는다.
- 중간에 실패한 run도 삭제하지 않는다. `run.json.status`를 `failed`로 두고 완료된 stage 파일과 `error.json`을 남긴다.

현재 하나의 browser baseline JSON은 위 파일들을 만들 수 있는 정보를 상당 부분 포함한다. 다만 실제 단계별 request payload, 정확한 시작/종료 시각, source content hash와 dirty source file hash는 포함하지 않으므로 기존 다운로드 파일을 완전 재현 가능한 run으로 과장해서 변환하면 안 된다. 이식할 경우 `runKind: "baseline"`, `provenance: "legacy-browser-export"`와 누락 필드를 명시한다.

## 9. Work가 읽어야 할 최소 파일

프로젝트 전체 방향을 처음 복원할 때는 다음 파일을 읽는다.

1. `AGENTS.md`
2. `docs/PRODUCT.md`
3. `docs/LEARNING_PRINCIPLES.md`
4. `docs/EVAL_SCHEMA_V0.md`
5. `eval/README.md`

특정 실험을 분석할 때의 최소 입력은 다음과 같다.

1. `eval/experiments/<experiment-id>/manifest.json`
2. `eval/cases/<case-id>/case.json`
3. 해당 case의 `reference.md`
4. 비교 대상 각 run의 `run.json`
5. 비교 대상 각 run의 `inputs.json`
6. 비교 대상 각 run의 `observations.json`
7. 실험 변수와 관련된 stage 파일

예를 들어 count policy 실험에서는 최소한 `40-prepare.json`, `50-cards.json`, `60-critic.json`, `70-final-cards.json`을 읽어야 한다. recall design 실험에서는 `30-recall.json`부터 읽어야 한다. Work가 최종 카드만 보고 최초 오류 단계를 추측하지 않도록 experiment manifest에 `requiredStageFiles`를 둘 수 있다.

`checksums.json`은 artifact 무결성을 확인할 때 읽는다. reference에 근거한 원문 충실성 판단이 필요하면 source fixture 또는 source manifest가 가리키는 접근 가능한 원자료도 필요하다.

## 10. Codex가 실행 후 반드시 남겨야 할 최소 artifact

선언된 baseline, control 또는 experiment run을 수행한 Codex는 성공 여부와 관계없이 다음을 남긴다.

1. `run.json`
2. `inputs.json`
3. 실행 완료된 모든 `stages/*.json`
4. 성공한 run의 `70-final-cards.json`
5. `observations.json`
6. `checksums.json`
7. 실패한 run의 `error.json`
8. experiment manifest의 해당 arm에 새 `runId`

완료 보고에는 카드 수만 쓰지 않고 다음을 포함한다.

- run ID와 저장 경로
- experiment ID와 arm ID
- code commit 및 dirty 여부
- 완료 또는 실패한 단계
- zero-card 및 multi-card LearningUnit
- 알려진 confound 또는 재현성 제한

Codex는 artifact를 남기기 위해 production 결과를 수정해서는 안 된다. 저장 과정은 관찰된 payload를 보존하는 역할만 해야 한다.

## 11. Git에 커밋할 것과 제외할 것

### 11.1 기본적으로 커밋할 것

- `eval/README.md`
- `eval/cases/**/case.json`
- 사람이 검토한 reference/gold 문서
- source manifest와 source checksum
- experiment manifest와 실험 notes
- 선언된 baseline/control/experiment의 `run.json`
- 해당 run의 정규화된 stage JSON
- `inputs.json`, `observations.json`, `checksums.json`
- 이후 생성되는 evaluator 결과와 사람 판정 중 공유 기준으로 채택된 것
- 작고 재배포가 허용된 source fixture

AI 결과가 생성물이라는 이유만으로 Git에서 제외하지 않는다. 이 결과가 바로 비교할 실험 증거이므로, 선언된 실험의 artifact는 코드와 함께 versioning해야 한다.

### 11.2 기본적으로 제외할 것

```gitignore
eval/local/
eval/**/tmp/
eval/**/logs/
eval/**/*.partial.json
eval/**/*.secret.*
```

또한 다음은 저장하거나 커밋하지 않는다.

- `.env*`, API key, 인증 header와 session 정보
- provider의 전체 raw trace, chain-of-thought와 불필요한 telemetry
- 개발 서버 로그와 임시 다운로드
- 중간 저장 중인 partial JSON
- 권리 또는 개인정보 문제로 공유할 수 없는 원본 PDF
- 단순 UI 디버깅용 scratch run
- 동일 artifact의 zip 또는 복사본

원본 PDF는 다음 정책을 사용한다.

- 재배포 가능하고 크기가 작은 eval fixture: `eval/cases/<case-id>/sources/`에 커밋할 수 있다.
- 비공개, 저작권 제한 또는 큰 파일: `eval/local/sources/`에 두고 Git에서 제외한다.
- 어느 경우든 `source-manifest.json`에는 SHA-256과 metadata를 커밋한다.

원자료를 커밋하지 않으면 Work와 Codex는 동결된 stage 결과를 비교할 수 있지만, 원자료에서 analyze를 다시 실행하거나 source grounding을 완전히 독립 검증할 수는 없다. 이 제한은 `case.json`과 run의 `reproducibilityNotes`에 명시해야 한다.

### 11.3 모든 run을 커밋하지 않는 기준

- experiment manifest에 등록된 run은 커밋한다.
- 장기 비교 기준으로 지정된 baseline은 커밋한다.
- prompt 디버깅 중 생긴 임시 run은 `eval/local/runs/`에 둔다.
- 임시 run을 근거로 의사결정하면 먼저 정식 run ID로 승격하거나 다시 실행하고 manifest에 등록한다.

## 12. 현재 browser baseline과의 대응

현재 `handleExportBaseline`이 만드는 단일 JSON은 다음처럼 분리한다.

| 현재 필드 | 새 위치 |
|---|---|
| `artifactType`, `artifactVersion`, `runMode`, `capturedAt` | `run.json` |
| `sourceFiles` | `inputs.json` 및 case의 `source-manifest.json` |
| `modelConfiguration` | `run.json`과 각 stage envelope |
| `userSelections` | `inputs.json` |
| `stages.analyze` | `stages/10-analyze.json` |
| `stages.plan`, `stages.wholeDocumentCorePlan` | `stages/20-plan.json` |
| `stages.recallDesign`, `stages.selectedRecallDesign` | `stages/30-recall.json` |
| `stages.prepare` | `stages/40-prepare.json` |
| `stages.cards` | `stages/50-cards.json` |
| `stages.critic` | `stages/60-critic.json` |
| `stages.finalCards` | `stages/70-final-cards.json` |
| `observations` | `observations.json` |

기존 export를 repository에 넣을 때 원본 단일 JSON도 보존하려면 run directory의 `legacy-export.json`으로 둘 수 있다. 분리본과 원본이 모두 있으면 `checksums.json`에 둘 다 기록하고 `run.json`에서 원본 provenance를 명시한다. 새 실행에서는 중복 원본을 만들지 않고 처음부터 표준 구조로 저장하는 편이 낫다.

## 13. 도입 순서

이 문서는 구조만 설계한다. 이후 구현은 다음과 같이 작은 작업으로 나눌 수 있다.

1. `eval/README.md`, `.gitignore`와 빈 directory 대신 필요한 manifest 파일을 추가한다.
2. 기존 reference를 `eval/cases/`로 migration하고 링크를 정리한다.
3. 보유 중인 기존 browser baseline JSON을 `legacy-browser-export` run으로 import한다.
4. production UI와 분리된 개발용 capture/import 도구를 설계한다.
5. artifact 생성과 checksum 검증을 자동화한다.
6. 충분한 run이 쌓인 뒤 evaluator를 별도 설계한다.

각 단계는 별도 변경으로 수행한다. 특히 4번 이후에도 production prompt와 생성 정책 변경을 같은 변경에 섞지 않는다.

## 14. 이 구조가 생긴 뒤 사용자에게 남는 수동 작업

정식 실행 capture가 구현되면 사용자는 더 이상 baseline JSON을 ChatGPT, Work 또는 Codex에 업로드하거나 내용을 복사할 필요가 없다. Work와 Codex는 experiment ID 또는 run ID만 받아 repository의 동일 artifact를 읽을 수 있다.

사용자에게 남겨야 하는 수동 작업은 다음뿐이다.

1. 어떤 학습 목표와 실험 질문을 검증할지 승인한다.
2. 필요한 경우 production UI에서 학습 영역, recall option 등 실험에 포함된 사용자 선택을 수행한다.
3. 비공개 원자료를 repository에 공유할 수 있는지 결정한다.
4. 자동 평가로 확정하기 어려운 카드 품질과 학습 적합성을 최종 판단한다.
5. 실험 결과를 production 정책으로 채택할지 승인한다.

실행 결과 저장, control 연결, 단계별 JSON 정리, 비교 대상 전달과 파일 복사는 자동화 대상이다.
