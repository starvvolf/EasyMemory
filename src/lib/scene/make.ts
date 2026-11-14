// 장면 만들기 (설계 5번): 똑같이 = 기록에서 잘라 옴(AI 0번) · 비슷하게 · 응용 = AI 1번. 만든 뒤 코드가 검사하고(check.ts),
// 떨어지면 한 번 다시, 또 떨어지면 똑같이(고치기)로 물러난다. 검사를 통과하지 못한 장면은 안 보인다.
import { judge, normalizeOutput, type TestCase } from "../code/run.ts";
import { checkScene } from "./check.ts";
import { langOf } from "./exec.ts";
import { defaultAsk, recordOf, type Ask, type Record_ } from "./extract.ts";
import { formatOf } from "./ladder.ts";
import { SCENE_SCHEMA, SCENE_SYSTEM, type SceneReply } from "./prompts.ts";
import { newId, saveScene } from "./store.ts";
import { DISTANCE_LABEL, FORMAT_LABEL, type Format, type Gap, type Scene } from "./types.ts";

const wrongSubOf = (gap: Gap, rec: Record_) => {
  const ids = gap.evidence.flatMap((e) => (e.type === "submission" && e.verdict && e.verdict !== "AC" ? [e.id] : []));
  return rec.subs.filter((s) => ids.includes(s.id) && s.verdict !== "CE").at(-1) ?? null;
};

/** 똑같이: 그때 틀린 제출 코드에서 시작해 고치기. 입력은 원래 테스트 중 작은 것 — 그 코드가 맞히는 기본 2개, 틀리는 가르는 3개. */
export async function sameScene(gap: Gap, rec: Record_): Promise<Scene | null> {
  const sub = wrongSubOf(gap, rec);
  if (!sub) return null;
  const tests: TestCase[] = [...rec.tests].sort((a, b) => a.input.length - b.input.length).slice(0, 80);
  const j = await judge(langOf(sub.lang), sub.code, tests, { timeLimitMs: rec.timeLimitMs });
  const basic = j.results.filter((r) => r.verdict === "AC").slice(0, 2).map((r) => tests[r.index]);
  const split = j.results.filter((r) => r.verdict !== "AC").slice(0, 3).map((r) => tests[r.index]);
  if (!split.length) return null;
  const ac = rec.subs.filter((s) => s.verdict === "AC" && s.lang === sub.lang).at(-1);
  const picked = [...basic, ...split];
  const scene: Scene = { id: newId("sc"), gapId: gap.id, format: "fix", lang: sub.lang, distance: "same", target: gap.target,
    story: `${rec.title}에서 그때 낸 코드예요. 이 코드는 아래 입력에서 틀려요.`, ask: "틀린 곳을 고쳐 보세요.", explain: gap.missed,
    setup: "", after: "", template: sub.code, reference: ac?.code ?? "", alsoRight: [], wrongs: [{ id: "mine", what: gap.wrong || gap.title, code: sub.code }],
    inputs: picked.map((t) => ({ role: "basic" as const, stdin: t.input })), origin: { problemId: rec.problemId, code: sub.code, failIndex: basic.length },
    computed: { expected: picked.map((t) => normalizeOutput(t.output)), shapes: {} },
    createdAt: new Date().toISOString(), madeBy: "record" };
  return checkScene(scene);
}

export function sceneUser(gap: Gap, format: Format, rec: Pick<Record_, "title" | "statement">) {
  return [
    `[빈틈] ${gap.title} (종류 ${gap.kind}, 확인할 것 ${gap.target === "form" ? "표현(form)" : "능력(ability)"})`,
    `떠올렸어야 할 생각: ${gap.missed}`,
    gap.wrong ? `그때 생각(mine): ${gap.wrong}` : "그때 생각: 아무것도 못 떠올림 (mine은 가장 그럴듯한 빠뜨림으로)",
    gap.kernel.code ? `맞는 생각이 담긴 코드:\n${gap.kernel.code}${gap.kernel.needs.length ? `\n(가정: ${gap.kernel.needs.join(", ")})` : ""}` : "",
    `[원래 문제] ${rec.title}: ${rec.statement.slice(0, 500)}`,
    `[만들 장면] format=${format} (${FORMAT_LABEL[format]}), distance=${gap.state.distance} (${DISTANCE_LABEL[gap.state.distance]}), scope=${gap.scope}, lang=${gap.origin.lang}`,
  ].filter(Boolean).join("\n\n");
}

function fromReply(gap: Gap, format: Format, r: SceneReply): Scene {
  return { id: newId("sc"), gapId: gap.id, format, lang: gap.origin.lang, distance: gap.state.distance, target: gap.target,
    story: r.story, ask: r.ask, explain: r.explain || gap.missed, setup: r.setup ?? "", after: r.after ?? "", ...(r.template ? { template: r.template } : {}),
    reference: r.reference ?? "", alsoRight: gap.target === "form" ? [] : (r.alsoRight ?? []).filter((x) => x.trim()),
    wrongs: (r.wrongs ?? []).filter((w) => w.id).map((w, i) => ({ id: i === 0 ? "mine" : w.id === "mine" ? `w${i}` : w.id, what: w.what, code: w.code })),
    inputs: format === "choice" ? [] : (r.inputs ?? []).map((x) => ({ role: "basic" as const, stdin: x.stdin, ...(x.label ? { label: x.label } : {}) })),
    ...(format === "choice" ? { choices: (r.choices ?? []).map((c) => ({ text: c.text, thought: c.thought })) } : {}),
    createdAt: new Date().toISOString(), madeBy: "ai" };
}

/** 빈틈의 지금 거리에 맞는 장면 하나. */
export async function makeScene(gap: Gap, opts: { ask?: Ask; rec?: Record_ } = {}): Promise<Scene | null> {
  const rec = opts.rec ?? await recordOf(gap.origin.problemId);
  const hasWrong = Boolean(wrongSubOf(gap, rec));
  const format = formatOf(gap, hasWrong);
  if (format === "fix") {
    const s = await sameScene(gap, rec);
    if (s?.check?.ok) { await saveScene(s); return s; }
  }
  const aiFormat: Format = format === "fix" ? (gap.target === "form" ? "blank" : "write") : format;
  const ask = opts.ask ?? defaultAsk;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = sceneUser(gap, aiFormat, rec) + (problems.length ? `\n\n[앞 장면 검사에서 걸린 것 — 고쳐서 다시]\n- ${problems.join("\n- ")}` : "");
    const reply = await ask<SceneReply>("scene:make", SCENE_SYSTEM, user, SCENE_SCHEMA).catch(() => null);
    if (!reply) continue;
    const scene = await checkScene(fromReply(gap, aiFormat, reply));
    if (scene.check?.ok) { await saveScene(scene); return scene; }
    problems = scene.check?.problems ?? ["검사 실패"];
  }
  // 물러나기: 그때 코드로 고치기
  if (format !== "fix" && hasWrong) { const s = await sameScene(gap, rec); if (s?.check?.ok) { await saveScene(s); return s; } }
  return null;
}
