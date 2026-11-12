# Recaller 배포판 작업 규칙

이 브랜치(`release`)는 `claude/recaller2`에서 실험용 · 개발용을 뺀 가벼운 판이다. 기능 개발은 `claude/recaller2`에서 하고,
이 판은 거기서 다시 떠 온다(무엇을 뺐는지는 `README.md`). 영역별 자세한 규칙은 각 폴더의 `CLAUDE.md`(개발판 기준)를 본다.

## 하지 말 것

- 공개 저장소다: 강의 자료·문제 원문·블로그 글·`.env*`·키·ChatGPT 인증을 커밋하지 않는다.
- 3000번 서버를 묻지 않고 끄거나 재시작하지 않는다. Recaller 앱 창을 닫지 않는다(닫으면 서버가 꺼지고 데이터가 올라간다). `.env.local`을 바꾸지 않는다.
- 데이터 폴더를 지우지 않는다. 비울 때는 `scripts/recaller-data.mjs archive`(보관 후 비우기)로 하고, 사용자에게 먼저 묻는다.
- 비밀번호는 사용자가 직접 넣는다.

## 테스트

- 전부: `npm test` (2026-11-13 배포판 509개, 모두 통과)
- 타입 검사·린트: `npx tsc --noEmit -p .`, `npx eslint`
- 빌드: `npx next build`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
