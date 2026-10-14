// The same "오늘 할 것" the study screen shows, computed on the server for agents (GET /api/study-plan).
// It reads the generated materials, the mirrored records (study-records), notes, memory files and 학습규칙.
// Materials from the old request flow are left out (all exam materials go through engine v2).
import { inspectQuality } from "../../../tools/problem-authoring-lab/quality.ts";
import type { AuthoringDocument } from "../../../tools/problem-authoring-lab/contract.ts";
import { toStudyDeck } from "./from-authoring.ts";
import { listGens, studyDocument } from "./gen/runner.ts";
import { listMemories } from "./memory.ts";
import { listNotes } from "./notes.ts";
import { planDeckFrom, planSettingsFrom, planToday, recordFor, subjectOfDeck, type PlanDeck, type PlanNote, type PlanRecord } from "./plan.ts";
import { loadRecords } from "./records.ts";
import { loadAgentRules, loadStudyRules } from "./rules.ts";

const pendingLabel: Record<string, string> = { "awaiting-confirm": "목표 확인 필요", queued: "시작 대기", running: "만드는 중", interrupted: "멈춤", "paused-usage-limit": "사용량 한도로 멈춤", "paused-login": "ChatGPT 로그인 필요", "paused-invalid": "멈춤", failed: "실패" };

export async function serverPlan(uid: string, now = Date.now()) {
  const [gens, stored, { rules, warnings }, agentRules, memories] = await Promise.all([
    listGens(), loadRecords(uid), loadStudyRules(), loadAgentRules(), listMemories()]);
  const records = (stored?.records ?? {}) as Record<string, unknown>;
  const settings = planSettingsFrom(records.__plan);
  const study = gens.filter((gen) => (gen.input.origin ?? "lab") === "study");
  const decks: PlanDeck[] = [];
  const shas = new Map<string, string>();
  for (const gen of study) {
    if (gen.status === "failed" || !gen.sections.some((section) => (section.author?.questionCount ?? 0) > 0)) continue;
    const built = await studyDocument(gen.id).catch(() => null);
    if (!built) continue;
    const excluded = new Map(inspectQuality(built.document as AuthoringDocument).filter((issue) => issue.severity === "error").map((issue) => [issue.questionId, issue.message] as const));
    decks.push(planDeckFrom({ ...toStudyDeck(built.meta, built.document as AuthoringDocument, decks.length, excluded), outline: built.outline }));
    shas.set(gen.id, built.meta.artifactSha256);
  }
  decks.sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true }));
  const recordMap: Record<string, PlanRecord> = Object.fromEntries(decks.map((deck) => [deck.id, recordFor(records, deck.id, shas.get(deck.id))]));
  const notes: Record<string, PlanNote[]> = {};
  for (const source of new Set(decks.map((deck) => deck.sourceCatalogId))) {
    notes[source] = (await listNotes(source).catch(() => [])).map((note) => ({ page: note.page, quote: note.quote, askedAt: note.askedAt, kind: note.kind }));
  }
  const plan = planToday({ decks, records: recordMap, settings, rules, notes, now });
  return {
    plan,
    settings,
    materials: decks.map((deck) => ({ id: deck.id, title: deck.title, subject: subjectOfDeck(settings, deck), questions: deck.items.length, objectives: deck.objectives.length })),
    pending: study.filter((gen) => gen.status !== "done" && gen.status !== "failed").map((gen) => ({ id: gen.id, fileName: gen.input.fileName, status: gen.status, label: pendingLabel[gen.status] ?? gen.status, calls: gen.calls })),
    memories,
    rules: { values: rules, warnings, agent: agentRules },
    recordsUpdatedAt: stored?.updatedAt ?? null,
  };
}
