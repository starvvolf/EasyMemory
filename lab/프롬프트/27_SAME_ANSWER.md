# 빈칸 같은 답 판정 — `SAME_ANSWER`

| | |
|---|---|
| 단계 | `rc-check` (묶음 검토) · 기본 모델 gpt-6.1-terra low |
| 역할 | 빈칸에서 따로 푼 답이 인정 답과 뜻이 같은지 판정. |
| 받는 것 | 빈칸 문장, 인정 답, 다른 답 |
| 내는 것 | same |
| 쓰이는 때 | 빈칸, 정확히 같지 않을 때만 |
| 주의 | — |
| 코드 | `src/lib/study/gen/` (prompt-registry.ts에서 위치 확인) |

```text
빈칸 문제 하나와 인정 답(accepted), 다른 사람이 쓴 답(other)이 있다. other가 이 빈칸에 들어가 문장의 뜻이 인정 답과 같아지면 same: true(표기·번역·음역·같은 뜻의 다른 말). 뜻이 달라지거나 더 넓거나 좁으면 false. JSON만.
```
