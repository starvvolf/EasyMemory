# page.tsx 책임 분리 작업 보고서

## 기준과 범위

- 기준 커밋: `854ad291`
- 변경 범위: 홈 진입점, 앱 화면 연결부, 생성·자료함·기록·학습 화면과 클라이언트 상태
- 변경하지 않은 범위: `src/lib/pipeline/**`, `src/app/api/**`, 생성 프롬프트·모델·응답 계약, `src/lib/types.ts`, IndexedDB 스키마와 버전

## 상태 소유자

- `generation/useGenerationState.ts`: 파일 선택, 분석·계획·학습단위·문제설계·검토 결과와 각 진행 상태를 소유한다. 생성 HTTP 주소와 요청·응답 계약은 기존 연결부가 그대로 사용한다.
- `library/useDeckLibraryController.ts`: 덱, 세션, 응답기록 목록과 상세·이름변경 임시 상태를 소유한다. 이름변경, 보드 이동, 삭제는 이 컨트롤러의 동일한 덱 갱신 경로를 사용한다.
- `study/useStudySessionController.ts`: 선택 덱, 현재 문항, 답 공개 시각, 자동채점 답·결과, 세션 누적치, 완료·재시도 상태를 소유한다. 학습 시작·재개·중단·자기평가·자동채점·다음 문항 이동을 한 모듈에서 처리한다.

학습 결과 저장은 기존 `saveStudyProgress({ deck, session, attempt })` 단위를 그대로 유지한다. 덱·세션·응답기록을 따로 저장하는 경로로 바꾸지 않았다.

## 화면 책임

- `generation/GenerationViews.tsx`: 프로젝트 기반 생성, PDF 분석, 학습 범위·문제 방식 선택, 결과 검토 UI
- `library/DecksView.tsx`: 프로젝트/덱 목록, 검색·필터·보드의 화면 임시 상태
- `manager/LearningManagerView.tsx`: 학습 기록·달력·플래너 표시 상태
- `study/StudyView.tsx`: 학습 카드 표시, 답 입력, 설정·재시도 메뉴의 화면 임시 상태
- `study-forge-shared.tsx`: 기존 공용 버튼·패널·모달과 순수 표시/요청 조립 유틸리티
- `StudyForgeApp.tsx`: 화면 전환, 생성 API 호출과 화면/컨트롤러 연결
- `page.tsx`: Next.js 진입점 재수출만 담당

## 기존 동작과 차이

의도한 기능·화면·저장 계약 차이는 없다. 컴포넌트와 상태 소유 위치만 변경했다. 화면을 이동해도 생성 상태와 학습 재개 상태가 앱 수명 동안 유지되며, 저장된 active 세션 복원은 기존 `restoreStudySessionState`를 사용한다.

## 검증

- `npm.cmd run lint`: 통과, 경고 없음
- `npm.cmd run build`: 통과. 기존 `next.config.ts` 동적 파일 추적 경고 1건은 유지됨
- `npm.cmd run study:test`: 52/52 통과
- `npm.cmd run project:test`: 1/1 통과
- 로컬 브라우저: 오늘 화면, 프로젝트 화면, 기록/달력 화면, 저장된 테스트 세션의 `이어서 하기`(2/12 복원), 학습 창 닫기 후 오늘 화면 복귀 확인
- 브라우저 콘솔 error/warning: 없음

## 확인 한계

새 모델 호출과 외부 PDF 업로드가 금지되어 실제 생성 요청은 실행하지 않았다. 따라서 생성 화면의 서버 왕복은 프로덕션 타입 빌드와 기존 계약 유지 확인으로 검증했고, 유료 호출 성공까지 확인했다고 보지 않는다. 브라우저 확인에서도 채점 버튼을 누르지 않아 테스트 브라우저의 저장 데이터는 변경하지 않았다.
