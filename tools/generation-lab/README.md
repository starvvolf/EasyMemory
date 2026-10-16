# Generation Lab

Study Forge production 앱과 분리된 로컬 전용 eval artifact viewer다. 새로운 생성 로직이나 LLM 요약을 사용하지 않고 `eval/runs/`의 기존 artifact를 deterministic renderer로 표시한다.

## 실행

```powershell
npm.cmd run generation-lab
```

기본 주소는 `http://127.0.0.1:4310`이다. 해당 포트가 사용 중이면 4319까지 다음 빈 포트를 선택한다. 고정 포트가 필요하면 `GENERATION_LAB_PORT`를 지정한다.

## v1 범위

- 기존 run 목록 및 manifest 상태 표시
- PDF와 학습 목표를 입력한 전체 pipeline run 실행
- 실제 stage 함수 경계에 따른 진행 상태와 실패 단계 표시
- Analyze, Plan, Recall Design, Prepare/LearningUnits, Cards, Critic, Final Cards 표시
- LU별 카드 수, zero-card LU, multi-card LU 계산
- 원본 JSON과 stage provenance 표시
- 누락되거나 깨진 artifact의 오류 상태 표시

Run 비교와 GUI에서 freeze/부분 재실행은 포함하지 않는다. PDF 전체 실행은 GUI와 다음 CLI가 동일한 `runFullEval` 함수를 사용한다.

```powershell
npm.cmd run eval:full-run -- --pdf "C:\path\to\source.pdf" --goal "학습 목표"
```

## 테스트

```powershell
npm.cmd run generation-lab:test
```
