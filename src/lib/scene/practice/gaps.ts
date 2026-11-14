// 실습 원장(실습 서버 .data/gaps, GET /api/scene/gaps) → 바닥의 빈틈(branch "practice"). 범위 · 세기는 바닥과 같은 규칙(ladder.ts scopeOf · doseOf)으로.
// 빈틈 id는 실습 · 원장 칸에서 늘 같게 만든다(다시 가져와도 같은 빈틈). 상태(사다리)는 바닥이 가진 것을 쓰고, 여기서는 처음 상태만 준다.
import { createHash } from "node:crypto";
import { doseOf, firstState, scopeOf } from "../ladder.ts";
import { GAP_KINDS, LAYER, type Gap, type GapKind } from "../types.ts";

/** 실습 서버가 내주는 칸(experiments/project-course/lib/scene-gaps.ts SceneGapItem) */
export type PracticeGapItem = {
  runId: string; id: string; goal: { id: string; title: string; done: string }; title: string; kind: string; target: "ability" | "form"; topic: string;
  missed: string; wrong: string; wrongCode: string; wrongVerified: boolean; lang: string;
  kernel: { lang: string; code: string; needs: string[]; check: string };
  code: { file: string; from: number; to: number; save?: string } | null; evidence: Array<{ at: string; from: string; text: string }>;
  signals: { wrongTries: number; asked: number; helpRung: number; tutorCode: boolean; gaveUp: boolean; repeated: boolean };
  recheck: boolean; status: string; at: string; enriched: boolean;
};
export const practiceGapId = (runId: string, ledgerId: string) => `gap_${createHash("sha1").update(`practice:${runId}:${ledgerId}`).digest("hex").slice(0, 12)}`;
const LANGS = ["python", "javascript", "cpp", "csharp"];

export function toGap(x: PracticeGapItem, now = Date.now()): Gap {
  const kind: GapKind = (GAP_KINDS as readonly string[]).includes(x.kind) ? x.kind as GapKind : "알고리즘 원리";
  const dose = doseOf(x.signals);
  // 알맹이 검사에서 문법이 틀린 것은 보여 주지 않는다(맞는 생각이 담긴 코드여야 함)
  const kernelOk = x.kernel.check !== "failed";
  // 장면을 돌리는 언어(채점기 네 언어). 명령 한 줄 장면은 따로 "shell"
  const lang = LANGS.includes(x.lang) ? x.lang : "javascript";
  return {
    id: practiceGapId(x.runId, x.id), branch: "practice", kind, layer: LAYER[kind], title: x.title, target: x.target === "form" ? "form" : "ability",
    missed: x.missed, wrong: x.wrong, ...(x.wrongCode ? { wrongCode: x.wrongCode } : {}), wrongVerified: x.wrongVerified,
    kernel: { lang: x.kernel.lang || lang, code: kernelOk ? x.kernel.code : "", needs: kernelOk ? x.kernel.needs : [] },
    evidence: x.evidence.map((e) => ({ type: "talk" as const, at: e.at, quote: `${e.from}: ${e.text}`.slice(0, 300) })),
    origin: { problemId: `pr_${x.runId}`, title: x.goal.title, lang, runId: x.runId, goalId: x.goal.id, practiceGapId: x.id, ...(x.code?.file ? { file: x.code.file } : {}) },
    topic: x.topic, scope: scopeOf(kind, x.signals), dose: { level: dose }, state: firstState(dose, now), createdAt: x.at,
  };
}
