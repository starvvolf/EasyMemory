# PDF 학습 화면 개선 보고

## 구현 범위

- PDF 파일을 `sourceId` 또는 정규화한 전체 파일명의 정확 일치로만 선택한다.
- 같은 파일명이 둘 이상이면 명시적 `sourceId` 없이는 어느 파일도 선택하지 않는다.
- 출처가 일치하지 않는 학습 항목을 첫 번째 PDF로 보내던 폴백을 제거했다.
- 학습 카드에서 연결된 원본 PDF와 `sourcePage`를 직접 연다.
- 문장 좌표 정보가 없으므로 카드 화면에 페이지 단위 이동임을 명시한다.
- 모바일·태블릿 페이지 탐색에 44px 이상 터치 영역과 직접 페이지 입력을 추가했다.
- Firebase 담당자의 `getPdfReadingPosition` / `savePdfReadingPosition` 계약을 연결해 source ID별 마지막 페이지를 불러오고 600ms 지연 저장한다.
- 카드 출처 열기는 마지막 페이지보다 카드의 `sourcePage`를 우선한다.

## 수정 파일

- `src/app/PdfReviewViewer.tsx`
- `src/app/pdf-source-navigation.ts`
- `src/app/study/StudyCardSourceReader.tsx`
- `src/app/study/usePdfReadingPosition.ts`
- `src/app/study/StudyView.tsx`
- `src/app/StudyProjectLibrary.tsx`
- `scripts/pdf-source-navigation.test.ts`

Firebase 기반은 담당자 커밋 `3b47d015`를 병합했으며, 해당 커밋의 storage/API 파일은 이 화면 작업에서 수정하지 않았다.

## 검증

- ESLint 통과
- PDF source/navigation 단위 테스트 4개 통과
- 인증 정책 포함 관련 단위 테스트 9개 통과
- 학습 테스트 56개 통과(새 PDF source/navigation 4개 포함)
- 프로젝트 테스트 1개 통과
- Next.js 16.3.4 production build 통과

빌드에는 기존 `src/lib/codex-app-server.ts`의 동적 프로세스 실행 때문에 프로젝트 전체 추적 가능성을 알리는 Turbopack 경고가 남아 있다.

## 남은 통합 경계

현재 Firebase의 읽기 위치 저장은 `users/{uid}/sources/{sourceId}`가 이미 존재해야 한다. 기존 프로젝트 자료함 API가 로컬 project store에만 저장한 PDF는 cloud source 동기화 전까지 읽기 위치 PUT이 실패하며, 화면은 이 오류를 숨기지 않고 표시한다. source 존재 검사를 우회하거나 별도 로컬 위치 저장소를 만들지 않았다. 프로젝트 source를 cloud source로 동기화하는 책임은 Firebase 저장 계층에 남아 있다.
