// 실습 갈래 상황 재현 (설계 3 · 4 · 5번의 실습 칸, 형식 13~17 + 공통 1 · 3 · 11 · 15). 주인: 실습(D) 영역과 맞물림 — 실습 서버(4100)가 재료를 낸다.
// 바닥(src/lib/scene/)은 이 파일의 함수만 부른다: 실습 빈틈 가져오기 · 실습 장면 만들기 · 검사 · 채점 · 화면에 보낼 모양.
// 공통 형식(write · predict · error · command 등)도 실습 빈틈이면 여기 재료(practiceMaterial)로 AI 장면 지시문을 채운다.
import type { Graded } from "../grade.ts";
import type { Format, Gap, Scene } from "../types.ts";

/** 실습 원장(실습 서버 .data/gaps)의 부족함 → 바닥의 빈틈(branch "practice"). 종류 · 확인할 것 · 알맹이 · 범위 · 세기를 채워 돌려준다. */
export async function practiceGaps(): Promise<Gap[]> { return []; }

/** 실습 빈틈에 맞는 형식 순서(설계 4번 표의 실습 줄). 앞이 기본, 재료가 없으면 다음. */
export function practiceFormats(gap: Gap): Format[] { void gap; return ["why"]; }

/** AI 장면 지시문에 넣을 실습 재료(목표 · 그때 파일과 줄 · 그때 한 말 · 언어). 공통 형식을 실습 빈틈으로 만들 때 쓴다. */
export async function practiceMaterial(gap: Gap): Promise<{ title: string; statement: string; lang: string }> {
  return { title: gap.origin.title, statement: gap.missed, lang: gap.origin.lang };
}

/** 실습 전용 형식(13~17) 장면 하나 만들기. 못 만들면 null(바닥이 다음 형식으로 물러남). */
export async function makePracticeScene(gap: Gap, format: Format): Promise<Scene | null> { void gap; void format; return null; }

/** 실습 전용 형식 검사 · 채점. */
export async function checkPracticeScene(scene: Scene): Promise<Scene> { return { ...scene, check: { ok: false, problems: ["실습 형식은 아직 준비 중이에요."] } }; }
export async function gradePracticeScene(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string): Promise<Graded> { void scene; void gap; void answer; return { verdict: "unclear" }; }

/** 화면에 보낼 실습 장면의 몸통(정답 · 오답 모양 없이). */
export function practicePublic(scene: Scene): Record<string, unknown> { void scene; return {}; }
