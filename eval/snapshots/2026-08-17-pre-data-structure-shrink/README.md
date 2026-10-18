# 데이터 구조 축소 전 기준 버전

- 고정일: 2026-08-17
- 목적: 생성 데이터 구조를 줄이기 전 엔진과 실제 사회·과학 출력물을 보존한다.
- 복원 범위: 생성엔진, 문제 설계 규칙, 압축 입력, 공용 타입

## 보존 파일

| 파일 | SHA-256 |
| --- | --- |
| `generate.ts.txt` | `E4F675793411CF7424356198474ECC9DB7196B7CA1A38EA6CCC9EC3B2832FA17` |
| `practice-blueprint.ts.txt` | `DCA33AE7084B7E980F0607821ABDEBEC03822C8488908BB5F2CC5147C96EE557` |
| `compact-input.ts.txt` | `BBE20855AB6C6EB0AA786ACF95655BA38C64DA08001BEA755E16E817D92C99EE` |
| `types.ts.txt` | `484050F07869C04D1EBF9D25D6D33DA789D18964BA56F0E4F6CAFDC496393648` |
| `social-baseline.json` | `F54C841F0E3C4B24DA58D1171AC3CD530CFA214F677E1BB15D5B93AC672C9D9C` |
| `science-baseline.json` | `B963B36F2E35578610F9AFCA9DBD4C2C22C7EF5E00784AB1441E2DD1A306E8C8` |

## 기준 출력

- 사회: 12 LearningUnit → 12문제, 기계 오류 0
- 과학: 10 LearningUnit → 10문제, 기계 오류 0

## 축소 실험 결과

### 유지한 축소

Activity Design 결과에서 다음 중복을 저장·전송하지 않는다.

- `supportAssessments`: Blueprint와 추천 결과로 다시 계산 가능
- `policy`: 현재 고정 정책이므로 서버 기본값으로 다시 적용 가능

기존 결과를 기준으로 Activity Design JSON 크기는 다음처럼 감소한다.

- 사회: 23,351자 → 19,539자, 16.3% 감소
- 과학: 19,078자 → 16,321자, 14.5% 감소

### 되돌린 축소

Prepare AI 출력에서 다음 필드를 제거하는 실험은 실제 A/B 결과의 핵심 범위가 흔들려 되돌렸다.

- `knowledgeType`, `primaryKnowledgeType`
- `fixedPart`, `variableSlots`
- `rationale`

실험 결과 파일:

- `eval/local/actual-engine-student-smoke/social-game-economy-student-2026-08-16T162440292Z.json`
- `eval/local/actual-engine-student-smoke/science-stars-spectrum-student-2026-08-16T162440292Z.json`

중단 이유:

- 사회에서 GDP의 최종 생산물·중간재 구분 범위가 약해졌다.
- 과학에서 스펙트럼으로 원소의 종류와 양을 알아내는 핵심 단위가 빠졌다.
- 일부 문항은 좋아졌지만 핵심 범위 안정성이 낮아졌으므로 비용 절감보다 품질 보존을 우선했다.
