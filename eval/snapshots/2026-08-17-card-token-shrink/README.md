# Cards 토큰 축소 전후 기록

이 폴더는 2026-08-17에 진행한 `Activity Design → Cards` 전달량 축소의 변경 전·후 결과를 고정한다.

## 비교 조건

- Prepare와 Activity Design 결과는 변경하지 않았다.
- 같은 사회·과학 학습단위와 문제 설계를 Cards 단계에 입력했다.
- 비교 대상은 Cards 호출의 입력·출력·총토큰과 최종 문제다.
- Critic은 비활성화 상태다.
- 모델은 `gpt-5.6-terra`, 추론 강도는 `medium`이다.

## 폴더 구성

### `before/`

- `social.json`: 축소 전 학생용 사회 전체 엔진 결과
- `science.json`: 축소 전 학생용 과학 전체 엔진 결과

두 파일의 `usage` 배열에서 `stage=cards`인 항목이 축소 전 기준이다.

### `after/`

- `social.json`: 같은 사회 Activity Design으로 축소된 Cards 단계만 재실행한 결과
- `science.json`: 같은 과학 Activity Design으로 축소된 Cards 단계만 재실행한 결과

### `rejected/`

- `science-minified-json.json`: JSON 들여쓰기까지 제거한 추가 축소 결과

이 결과는 토큰이 더 줄었지만, 별의 질량과 생성 가능한 원소 질량의 관계가 문제에서 빠졌다. 품질 저하로 판정해 제품 코드에는 반영하지 않았다.

### `code-before/`, `code-after/`

- `generate.ts.txt`: 문제 생성 스키마·호출·후처리
- `compact-input.ts.txt`: Activity Design에서 Cards로 보내는 입력 구성
- `compact-card-output.ts.txt`: 축소 출력에서 기존 Card 형식으로 복원하는 코드. 변경 전에는 별도 적용 코드가 없었으므로 `code-after`에만 존재한다.

`code-before`는 직전 데이터 구조 축소 스냅샷에서 복사했다. Cards 관련 경로는 이번 변경 전 기준과 같지만, `generate.ts.txt`에는 이번 작업과 무관한 Activity Design 반환 필드가 이후 한 차례 정리된 차이가 포함된다. 따라서 Cards 전후 비교에는 아래 실제 출력 파일과 Cards 관련 코드 차이를 기준으로 삼는다.

## 실측 결과

| 자료 | 상태 | 입력 토큰 | 출력 토큰 | 총토큰 | 문제 수 | 기계 오류 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 사회 | 축소 전 | 8,069 | 4,411 | 12,480 | 12 | 0 |
| 사회 | 축소 후 | 6,675 | 2,672 | 9,347 | 12 | 0 |
| 과학 | 축소 전 | 7,836 | 4,709 | 12,545 | 10 | 0 |
| 과학 | 축소 후 | 6,779 | 2,892 | 9,671 | 10 | 0 |
| 과학 | 과도한 축소·폐기 | 5,621 | 2,455 | 8,076 | 10 | 0이지만 의미 누락 |

- 사회 총토큰 감소: 25.1%
- 과학 총토큰 감소: 22.9%
- 과학 축소 후 실행에는 입력 캐시가 적용됐으므로 비용보다 토큰 수를 기준으로 비교한다.

## 유지한 변경

- AI가 판단할 필요가 없는 출처, objective/blueprint ID, 추천 이유는 입력에서 반복하지 않는다.
- 문제 출력은 질문, 정답, 원문 근거, 전략, 난이도와 짧은 설명만 받는다.
- 출처, ID, 추천 이유, 태그, 빈 호환 필드와 품질 상태는 서버가 기존 데이터에서 복원한다.
- 네 문제 형식은 각자 필요한 필드만 출력한다.

## 파일 무결성

| 파일 | SHA-256 |
| --- | --- |
| `before/social.json` | `F54C841F0E3C4B24DA58D1171AC3CD530CFA214F677E1BB15D5B93AC672C9D9C` |
| `before/science.json` | `B963B36F2E35578610F9AFCA9DBD4C2C22C7EF5E00784AB1441E2DD1A306E8C8` |
| `after/social.json` | `3C0C69D96159B807593493CA69D9DEE1AE04D1C8412913F651A33543576DA18F` |
| `after/science.json` | `47C706FD9AE3377C391E68CDF51679B739549CED2CDD3BDB6C1C181C4B40FB1B` |
| `rejected/science-minified-json.json` | `805CD93342ED7F1943A551C6B2779F26D20A00489FA67AE2532AF753CB7880C3` |
| `code-before/generate.ts.txt` | `E4F675793411CF7424356198474ECC9DB7196B7CA1A38EA6CCC9EC3B2832FA17` |
| `code-before/compact-input.ts.txt` | `BBE20855AB6C6EB0AA786ACF95655BA38C64DA08001BEA755E16E817D92C99EE` |
| `code-after/generate.ts.txt` | `D07B929D8C4AEC1588DFA9619880ACDF466584E587ADB3B9683117F232989CD7` |
| `code-after/compact-input.ts.txt` | `0BC32D36D358BAC945C3BD54CE8964E76F41BADC110E86DE839E05CDFD170892` |
| `code-after/compact-card-output.ts.txt` | `DAA9F792920F406CC922AFC40037753FD30AA720FC7259C676A40D941E08C4A8` |
