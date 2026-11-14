// 실습 갈래 상황 재현 (설계 3 · 4 · 5번의 실습 칸, 형식 13~17 + 공통 1 · 3 · 11 · 12 · 15). 주인: 실습(D) 영역과 맞물림 — 실습 서버(4100)가 재료를 낸다.
// 바닥(src/lib/scene/)은 이 파일의 함수만 부른다: 실습 빈틈 가져오기 · 실습 장면 만들기 · 검사 · 채점 · 화면에 보낼 모양.
// 공통 형식(write · predict · error 등)도 실습 빈틈이면 여기 재료(practiceMaterial)로 AI 장면 지시문을 채운다.
//   13 어디에 넣을까 where.ts · 14 시간 순서 표 timeline.ts · 15 명령 한 줄 command.ts · 1 한 줄 쓰기(잠금, 8번 예) lock.ts
//   16 작은 재현 프로젝트 · 17 원래 자리로는 실습 서버(experiments/project-course/lib/scene-folders.ts)가 폴더 · 검사를 맡고 여기서는 부르기만.
//   12 왜인지 한 줄 = 실습 "다시 확인" 문항(실습 서버 /api/rechecks) 그대로.
import type { Ask } from "../extract.ts";
import { checkScene } from "../check.ts";
import type { Graded } from "../grade.ts";
import { newId } from "../store.ts";
import type { Format, Gap, Scene } from "../types.ts";
import { checkCommand, commandBankScene, commandFromReply, commandPublic, gradeCommand, type CommandReply } from "./command.ts";
import { course, offline } from "./course.ts";
import { practiceFormats as formatsOf, projectReady, originReady } from "./formats.ts";
import { toGap, type PracticeGapItem } from "./gaps.ts";
import { lockWriteScene, structureOk } from "./lock.ts";
import { COMMAND_SCHEMA, COMMAND_SYSTEM, WHERE_SCHEMA, WHERE_SYSTEM } from "./prompts.ts";
import { checkTimeline, gradeTimeline, makeTimelineScene, timelinePublic } from "./timeline.ts";
import { checkWhere, gradeWhere, previewWhere, whereBankScene, whereFromReply, wherePublic, type WhereReply } from "./where.ts";

export { projectReady, originReady };
export type PracticeOpts = { ask?: Ask; siblings?: Gap[]; projectTried?: boolean };
// 장면 만들기 강도는 바닥 make.ts(알고리즘 장면)와 같게(terra medium): 돌아가는 코드를 내야 하는 호출이라
const defaultAsk: Ask = async (purpose, system, user, schema) => (await import("../../assist/model.ts")).askJson(purpose, system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });

/** 실습 원장(실습 서버 .data/gaps)의 부족함 → 바닥의 빈틈(branch "practice"). 종류 · 확인할 것 · 알맹이 · 범위 · 세기를 채워 돌려준다. 실습 서버가 꺼져 있으면 빈 목록. */
export async function practiceGaps(): Promise<Gap[]> {
  try { return (await course<{ items: PracticeGapItem[] }>("scene/gaps", { timeout: 15000 })).items.map((x) => toGap(x)); }
  catch (e) { if (offline(e)) return []; throw e; }
}

/** 실습 빈틈에 맞는 형식 순서(설계 4번 표의 실습 줄). 앞이 기본, 재료가 없으면 다음. ctx를 주면 16(응용 확인)의 준비 규칙까지 본다. */
export function practiceFormats(gap: Gap, ctx: Pick<PracticeOpts, "siblings" | "projectTried"> = {}): Format[] { return formatsOf(gap, ctx); }

/** AI 장면 지시문에 넣을 실습 재료(목표 · 그때 파일과 줄 · 그때 한 말 · 언어). 공통 형식을 실습 빈틈으로 만들 때 쓴다. */
export async function practiceMaterial(gap: Gap): Promise<{ title: string; statement: string; lang: string; file?: string; from?: number; to?: number; code?: string; said?: string[] }> {
  const fallback = { title: gap.origin.title, statement: [gap.missed, gap.wrong ? `그때: ${gap.wrong}` : "", gap.wrongCode ? `그때 코드:\n${gap.wrongCode}` : ""].filter(Boolean).join("\n\n"), lang: gap.origin.lang };
  if (!gap.origin.runId || !gap.origin.practiceGapId) return fallback;
  try {
    const m = await course<{ title: string; statement: string; lang: string; file: string; from: number; to: number; code: string; said: string[] }>(`scene/material/${gap.origin.runId}/${gap.origin.practiceGapId}`);
    // 장면은 채점기 네 언어로 돈다(빈틈 언어와 같게)
    return { ...m, lang: gap.origin.lang };
  } catch (e) { if (offline(e) || (e as { upstream?: number }).upstream === 404) return fallback; throw e; }
}

/** 실습 장면 지시문의 사용자 글: 빈틈 · 형식 · 거리 + 실습 재료 */
async function userOf(gap: Gap, format: Format) {
  const m = await practiceMaterial(gap);
  return [`[빈틈] ${gap.title} (종류 ${gap.kind}, 확인할 것 ${gap.target === "form" ? "표현(form)" : "능력(ability)"})`, `떠올렸어야 할 생각: ${gap.missed}`,
    gap.wrong ? `그때 생각(mine): ${gap.wrong}` : "그때 생각: 아무것도 못 떠올림 (mine은 가장 그럴듯한 빠뜨림으로)",
    gap.kernel.code ? `맞는 생각이 담긴 코드:\n${gap.kernel.code}${gap.kernel.needs.length ? `\n(가정: ${gap.kernel.needs.join(", ")})` : ""}` : "",
    `[원래 실습] ${m.title}\n${m.statement.slice(0, 1800)}`, `[만들 장면] format=${format}, distance=${gap.state.distance}, lang=${gap.origin.lang}`].filter(Boolean).join("\n\n");
}
/** AI 1번(검사에서 떨어지면 걸린 것을 붙여 한 번 더) */
async function withAi<R>(gap: Gap, format: Format, ask: Ask, system: string, schema: Record<string, unknown>, build: (r: R) => Scene, check: (s: Scene) => Promise<Scene>) {
  let problems: string[] = [];
  const base = await userOf(gap, format);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = base + (problems.length ? `\n\n[앞 장면 검사에서 걸린 것 — 고쳐서 다시]\n- ${problems.join("\n- ")}` : "");
    const reply = await ask<R>(`scene:practice-${format}`, system, user, schema).catch(() => null);
    if (!reply) continue;
    const s = await check(build(reply));
    if (s.check?.ok) return s;
    problems = s.check?.problems ?? ["검사 실패"];
  }
  return null;
}

/** 실습 전용 형식(13~17) · 실습이 맡는 공통 형식(1 잠금 은행 · 12) 장면 하나 만들기. 검사까지 끝난 것을 돌려준다(저장은 바닥이). 못 만들면 null(바닥이 다음 형식으로 물러남). */
export async function makePracticeScene(gap: Gap, format: Format, opts: PracticeOpts = {}): Promise<Scene | null> {
  const id = newId("sc");
  const ask = opts.ask ?? defaultAsk;
  switch (format) {
    case "timeline": { const s = makeTimelineScene(gap, id); return s.check?.ok ? s : null; }
    case "where": {
      const s = await withAi<WhereReply>(gap, format, ask, WHERE_SYSTEM, WHERE_SCHEMA, (r) => whereFromReply(gap, id, r), checkWhere);
      if (s) return s;
      // 물러나기: 은행(설계 8번 탄약 예, 그 언어가 있을 때)
      const b = whereBankScene(gap, id);
      const c = b ? await checkWhere(b) : null;
      return c?.check?.ok ? c : null;
    }
    case "command": {
      const s = await withAi<CommandReply>(gap, format, ask, COMMAND_SYSTEM, COMMAND_SCHEMA, (r) => commandFromReply(gap, id, r), checkCommand);
      if (s) return s;
      const b = commandBankScene(gap, id);
      const c = b ? await checkCommand(b) : null;
      return c?.check?.ok ? c : null;
    }
    case "write": {
      // 잠금 빈틈만 은행(8번 C# lock 예). 그 밖의 한 줄 쓰기는 바닥의 AI 장면(practiceMaterial로)
      const b = lockWriteScene(gap, id);
      if (!b) return null;
      const c = await checkScene(b);
      return c.check?.ok && structurePasses(c) ? c : null;
    }
    case "project": {
      if (!projectReady(gap, opts)) return null;
      const m = await practiceMaterial(gap);
      const r = await course<{ ok: boolean; problems?: string[]; story?: string; ask?: string; files?: string[]; run?: string; lang?: string }>("scene/project", { method: "POST", timeout: 600_000,
        body: { sceneId: id, gap: { title: gap.title, kind: gap.kind, missed: gap.missed, wrong: gap.wrong, lang: gap.origin.lang, topic: gap.topic, kernel: gap.kernel.code, origin: `${m.title}` } } }).catch(() => null);
      if (!r?.ok) return null;
      return { ...base(gap, id, "project"), story: r.story ?? "", ask: r.ask ?? "검사가 통과하게 고쳐 보세요.", practice: { kind: "project", files: r.files ?? [], run: r.run ?? "", check: "check.mjs" }, check: { ok: true, problems: [] } };
    }
    case "origin": {
      if (!originReady(gap)) return null;
      const r = await course<{ ok: boolean; problems?: string[]; goal?: string; done?: string; file?: string; from?: number; to?: number; files?: string[]; saveAt?: string }>("scene/origin", { method: "POST", timeout: 60_000,
        body: { sceneId: id, runId: gap.origin.runId, gapId: gap.origin.practiceGapId } }).catch(() => null);
      if (!r?.ok) return null;
      return { ...base(gap, id, "origin"), distance: "same", story: `"${r.goal}"을(를) 하던 그때의 파일을 새 폴더에 되살렸어요(원래 실습 폴더는 그대로예요).`,
        ask: `${r.file} ${r.from}~${r.to}줄 근처를 다시 고쳐 목표의 완료 조건을 채워 보세요. 완료 조건: ${r.done}`,
        practice: { kind: "origin", files: r.files ?? [], file: r.file, from: r.from, to: r.to, saveAt: r.saveAt }, check: { ok: true, problems: [] } };
    }
    case "why": {
      const w = await practiceWhy(gap);
      if (!w) return null;
      return { ...base(gap, id, "why"), story: "", ask: w.question, why: { question: w.question, answer: "" }, practice: { kind: "why" }, check: { ok: true, problems: [] } };
    }
    default: return null;
  }
}
const base = (gap: Gap, id: string, format: Format): Scene => ({ id, gapId: gap.id, format, lang: gap.origin.lang, distance: gap.state.distance, target: gap.target, story: "", ask: "", explain: gap.missed,
  setup: "", after: "", reference: "", alsoRight: [], wrongs: [{ id: "mine", what: gap.wrong || gap.title, code: "" }], inputs: [], computed: { expected: [], shapes: {} }, createdAt: new Date().toISOString(), madeBy: "record" });
const structurePasses = (s: Scene) => !s.structure || (structureOk(s, s.reference) && !s.wrongs.some((w) => w.id === "mine" && structureOk(s, w.code)));

/** 12 왜인지 한 줄: 이 빈틈의 실습 "다시 확인" 문항(있으면). 다른 형식을 통과한 뒤 덧붙이는 질문으로도 쓴다(바닥이 Scene.why로). */
export async function practiceWhy(gap: Gap): Promise<{ question: string } | null> {
  if (!gap.origin.runId || !gap.origin.practiceGapId) return null;
  const r = await course<{ items: Array<{ runId: string; id: string; q: string }> }>("rechecks?all=1").catch(() => ({ items: [] }));
  const it = r.items.find((x) => x.runId === gap.origin.runId && x.id === gap.origin.practiceGapId);
  return it?.q ? { question: it.q } : null;
}

/** 실습 형식 검사(다시 불러도 같음). 16 · 17은 실습 서버가 만들 때 확인했고, 여기서는 폴더가 있는지만. */
export async function checkPracticeScene(scene: Scene): Promise<Scene> {
  switch (scene.format) {
    case "timeline": return checkTimeline(scene);
    case "where": return checkWhere(scene);
    case "command": return checkCommand(scene);
    case "write": return checkScene(scene);
    case "project": case "origin": {
      const r = await course<{ missing?: boolean }>(`scene/${scene.id}`).catch(() => ({ missing: true }));
      return { ...scene, check: r.missing ? { ok: false, problems: ["장면 폴더가 없어요(실습 서버가 꺼져 있거나 지워짐)."] } : { ok: true, problems: [] } };
    }
    case "why": return { ...scene, check: scene.why?.question ? { ok: true, problems: [] } : { ok: false, problems: ["다시 확인 문항이 없어요."] } };
    default: return { ...scene, check: { ok: false, problems: [`실습 쪽에서 다루지 않는 형식이에요: ${scene.format}`] } };
  }
}

/** 실습 형식 채점. 답은 글 하나: where = JSON {from,to} 또는 {code}, timeline = JSON {final, order}, command = 명령 그대로, project · origin = JSON {done:true}, why = 글. */
export async function gradePracticeScene(scene: Scene, gap: Pick<Gap, "wrongVerified"> & Partial<Pick<Gap, "origin">>, answer: string): Promise<Graded> {
  switch (scene.format) {
    case "timeline": return gradeTimeline(scene, gap, answer);
    case "where": return gradeWhere(scene, gap, answer);
    case "command": return gradeCommand(scene, gap, answer);
    case "write": {
      const g = await (await import("../grade.ts")).gradeScene(scene, gap, answer);
      // 표현 확인: 출력이 맞아도 그 표현(구조)을 안 썼으면 통과가 아니다
      if (g.verdict === "pass" && !structureOk(scene, answer)) return { verdict: "unclear", outputs: g.outputs, errors: (scene.structure?.must ?? []).filter((m) => !new RegExp(m.pattern).test(answer)).map((m) => m.why) };
      return g;
    }
    case "project": case "origin": {
      const r = await course<{ verdict: Graded["verdict"]; matched?: string; outputs?: string[]; errors?: string[]; note?: string }>(`scene/${scene.id}/grade`, { method: "POST", timeout: 300_000, body: { wrongVerified: gap.wrongVerified !== false } });
      return { verdict: r.verdict, ...(r.matched ? { matched: r.matched } : {}), outputs: [...(r.outputs ?? []), ...(r.note ? [r.note] : [])], ...(r.errors ? { errors: r.errors } : {}) };
    }
    case "why": {
      const runId = gap.origin?.runId, gid = gap.origin?.practiceGapId;
      if (!runId || !gid) return { verdict: "unclear", errors: ["실습 빈틈이 아니에요."] };
      if (!answer.trim()) return { verdict: "unclear", errors: ["답이 비어 있어요."] };
      const r = await course<{ verdict: string; sameMistake: boolean; note: string; answer: string }>(`rechecks/${runId}/${gid}`, { method: "POST", timeout: 120_000, body: { answer } });
      const outputs = [r.note, r.answer ? `모범답: ${r.answer}` : ""].filter(Boolean);
      if (r.verdict === "correct") return { verdict: "pass", outputs };
      if (r.sameMistake && gap.wrongVerified !== false) return { verdict: "same", matched: "mine", outputs };
      return { verdict: "unclear", outputs };
    }
    default: return { verdict: "unclear", errors: [`실습 쪽에서 다루지 않는 형식이에요: ${scene.format}`] };
  }
}

/** 미리 실행(보이는 입력만, 채점 없음): where · write(잠금 은행) */
export async function previewPracticeScene(scene: Scene, answer: string) {
  if (scene.format === "where") return previewWhere(scene, answer);
  if (scene.format === "project") return course<{ ok: boolean | null; out: string }>(`scene/${scene.id}/try`, { method: "POST", timeout: 300_000, body: {} });
  throw new Error("미리 실행할 수 없는 장면이에요.");
}

/** 화면에 보낼 실습 장면의 몸통(정답 · 오답 모양 없이). PracticeScene.tsx PracticeBody가 그린다. */
export function practicePublic(scene: Scene): Record<string, unknown> {
  switch (scene.format) {
    case "timeline": return timelinePublic(scene);
    case "where": return wherePublic(scene);
    case "command": return commandPublic(scene);
    case "project": case "origin": { const p = (scene.practice ?? {}) as Record<string, unknown>; return { kind: scene.format, editor: true, files: p.files ?? [], run: p.run ?? "", file: p.file ?? "", from: p.from ?? 0, to: p.to ?? 0 }; }
    case "why": return { kind: "why", question: scene.why?.question ?? scene.ask };
    case "write": return scene.structure ? { kind: "write", structure: scene.structure.must.map((m) => m.why) } : {};
    default: return {};
  }
}
