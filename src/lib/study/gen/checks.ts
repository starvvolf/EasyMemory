// Checks, in the three tiers of the 2026-10-12 decision.
// Tier 1 (format) is the schema's job and is only re-verified with zod in the runner.
// Tier 2 (not in the source, broken links, unsolvable) returns per-item problems: only those items are asked again.
// Tier 3 (quality) becomes warnings and never triggers a call.
import { containsQuote } from "../../../../tools/study-forge-mcp/source-evidence.ts";
import type { classifyReply, designReply, outlineReply } from "./schemas.ts";
import type { z } from "zod";
import { materialKinds, type ClassItem, type Issue, type Objective, type Section } from "./types.ts";

const loose = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");

/**
 * Outline problems are fixed in code, not by asking again: clamp to the chosen pages, keep source order,
 * hand uncovered pages to the neighbouring section. Only an outline with no usable section is an error.
 */
export function normalizeOutline(reply: { sections: Array<Omit<z.infer<typeof outlineReply>["sections"][number], "startText"> & { startText?: string }> }, chosen: number[]): { sections: Section[]; warnings: Issue[] } {
  const pages = [...new Set(chosen)].sort((a, b) => a - b);
  const warnings: Issue[] = [];
  const drafts = reply.sections
    .map((section) => {
      const start = Math.min(section.pageStart, section.pageEnd), end = Math.max(section.pageStart, section.pageEnd);
      return { title: section.title.trim(), startText: (section.startText ?? "").trim(), pages: pages.filter((page) => page >= start && page <= end) };
    })
    .filter((section) => section.title && section.pages.length)
    .sort((a, b) => a.pages[0] - b.pages[0]);
  if (drafts.length < reply.sections.length) warnings.push({ severity: "warning", code: "outline-out-of-range", message: "고른 쪽 밖을 가리킨 목차 항목을 뺐어요." });
  if (!drafts.length) return { sections: [], warnings };
  const covered = new Set(drafts.flatMap((section) => section.pages));
  const missing = pages.filter((page) => !covered.has(page));
  for (const page of missing) {
    // The last section that starts at or before the page takes it; leading pages go to the first section.
    const owner = [...drafts].reverse().find((section) => section.pages[0] <= page) ?? drafts[0];
    owner.pages = [...new Set([...owner.pages, page])].sort((a, b) => a - b);
  }
  if (missing.length) warnings.push({ severity: "warning", code: "outline-gap", message: `목차가 덮지 않은 p.${missing.join(", ")}를 앞 항목에 붙였어요.` });
  // Study units, not slide titles: a page-by-page outline (리허설 2026-10-12: 52쪽 → 52목차) is merged in code,
  // smallest unit into its smaller neighbour, until there are at most one unit per SECTION_PAGES pages.
  const limit = Math.max(MIN_SECTIONS, Math.ceil(pages.length / SECTION_PAGES));
  const before = drafts.length;
  while (drafts.length > limit) {
    const size = (index: number) => drafts[index].pages.length;
    let index = 0;
    for (let i = 1; i < drafts.length; i += 1) if (size(i) < size(index)) index = i;
    const neighbour = index === 0 ? 1 : index === drafts.length - 1 ? index - 1 : size(index - 1) <= size(index + 1) ? index - 1 : index + 1;
    const [first, second] = neighbour < index ? [neighbour, index] : [index, neighbour];
    const merged = { title: mergeTitles(drafts[first].title, drafts[second].title), startText: drafts[first].startText,
      pages: [...new Set([...drafts[first].pages, ...drafts[second].pages])].sort((a, b) => a - b) };
    drafts.splice(first, 2, merged);
  }
  if (drafts.length < before) warnings.push({ severity: "warning", code: "outline-merged", message: `목차 ${before}개가 너무 잘아서 ${drafts.length}개로 묶었어요.` });
  return { sections: drafts.map((section, index) => ({ id: `s${index + 1}`, title: section.title, pages: section.pages,
    ...(section.startText ? { startText: section.startText } : {}) })), warnings };
}

/** At most one section per this many chosen pages (but small selections may keep up to MIN_SECTIONS). */
export const SECTION_PAGES = 4, MIN_SECTIONS = 3;
function mergeTitles(a: string, b: string) {
  const parts = [...new Set([...a.split(" · "), ...b.split(" · ")])];
  return parts.length > 3 ? `${parts[0]} 외 ${parts.length - 1}` : parts.join(" · ");
}

/** Where `needle` starts in `text`, ignoring spacing and case; -1 when absent. */
export function locate(text: string, needle: string) {
  const chars = [...needle.normalize("NFKC")].filter((char) => !/\s/.test(char));
  if (chars.length < 2) return -1;
  const pattern = new RegExp(chars.map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"), "iu");
  return text.normalize("NFKC").search(pattern);
}

/**
 * The text a section owns. Pages are shared when a section starts mid-page; there the page is cut at the
 * section's own start and at the start of the next section on that page, so one passage is not studied twice.
 * A start that cannot be found keeps the whole page (and is reported).
 */
export function sectionPageTexts(section: Section, sections: Section[], texts: Map<number, string>) {
  const own = new Map<number, string>();
  const warnings: Issue[] = [];
  const startOf = (candidate: Section, page: number) => {
    if (candidate.pages[0] !== page) return -1;
    const text = texts.get(page) ?? "";
    const at = candidate.startText ? locate(text, candidate.startText) : -1;
    return at >= 0 ? at : locate(text, candidate.title);
  };
  const order = sections.findIndex((candidate) => candidate.id === section.id);
  for (const page of section.pages) {
    const text = (texts.get(page) ?? "").normalize("NFKC");
    let from = 0;
    if (page === section.pages[0] && sections.some((other, index) => index < order && other.pages.includes(page))) {
      const at = startOf(section, page);
      if (at >= 0) from = at;
      else warnings.push({ severity: "warning", code: "section-start-not-found", message: `p.${page}에서 '${section.title}'의 시작 위치를 찾지 못해 쪽 전체를 썼어요.` });
    }
    const ends = sections.slice(order + 1).map((next) => startOf(next, page)).filter((at) => at > from);
    own.set(page, text.slice(from, ends.length ? Math.min(...ends) : undefined));
  }
  return { texts: own, warnings };
}

/** The same thing to recall in two sections is studied once: the later copy is merged into the earlier one. */
export function mergeAcrossSections(sections: Array<{ design?: { objectives: Objective[]; warnings: Issue[] } }>) {
  const seen = new Map<string, string>();
  for (const section of sections) {
    if (!section.design) continue;
    section.design.objectives = section.design.objectives.filter((objective) => {
      const key = loose(objective.recall);
      const earlier = seen.get(key);
      if (earlier && earlier.split("-")[0] !== objective.sectionId) {
        section.design!.warnings.push({ severity: "warning", code: "duplicate-objective", message: `앞 목차의 ${earlier}와 떠올릴 것이 같아 합쳤어요: ${objective.recall.slice(0, 60)}`, ref: earlier });
        return false;
      }
      seen.set(key, objective.id);
      return true;
    });
  }
}

export type ItemProblem = { index: number; message: string };

/** Each item's quote must be in the section's text. A quote found on another page of the section just moves the page. */
export function checkClassify(reply: z.infer<typeof classifyReply>, section: Section, texts: Map<number, string>) {
  const items: ClassItem[] = [];
  const problems: ItemProblem[] = [];
  reply.items.forEach((item, index) => {
    const pageOrder = [item.page, ...section.pages.filter((page) => page !== item.page)];
    const page = pageOrder.find((candidate) => section.pages.includes(candidate) && containsQuote(texts.get(candidate) ?? "", item.quote));
    if (page === undefined) {
      problems.push({ index, message: `${index + 1}번 항목의 quote "${item.quote.slice(0, 80)}"이(가) 원문(p.${section.pages.join(", ")})에 글자 그대로 없습니다. 원문 구절을 그대로 복사하세요.` });
      return;
    }
    items.push({ n: 0, kind: item.kind, content: item.content, quote: item.quote, page });
  });
  items.forEach((item, index) => { item.n = index + 1; });
  return { items, problems };
}

/** Objectives must point at real, non-material items; their evidence and pages come from those items, never from the model. */
export function checkDesign(reply: z.infer<typeof designReply>, section: Section, items: ClassItem[]) {
  const byNumber = new Map(items.map((item) => [item.n, item]));
  const objectives: Objective[] = [];
  const problems: ItemProblem[] = [];
  const warnings: Issue[] = [];
  const seen = new Map<string, string>();
  reply.objectives.forEach((draft, index) => {
    const unknown = draft.itemNumbers.filter((n) => !byNumber.has(n));
    const evidence = draft.itemNumbers.map((n) => byNumber.get(n)).filter((item): item is ClassItem => Boolean(item));
    const targets = evidence.filter((item) => !materialKinds.includes(item.kind));
    // Course administration (objectives lists, class procedure, grading) is never studied: drop without asking again.
    if (!unknown.length && evidence.length && evidence.every((item) => item.kind === "학습 지시")) {
      warnings.push({ severity: "warning", code: "course-admin-dropped", message: `강의 안내를 외우는 목표라 뺐어요: ${draft.statement.slice(0, 60)}` });
      return;
    }
    if (unknown.length || !targets.length) {
      problems.push({ index, message: unknown.length
        ? `${index + 1}번 목표가 없는 항목 번호 ${unknown.join(", ")}를 가리킵니다.`
        : `${index + 1}번 목표의 근거가 예시·연습문제·부가 정보·학습 지시뿐입니다. 핵심 지식·패턴·설명 항목 번호를 근거로 넣거나 목표를 빼세요.` });
      return;
    }
    const key = loose(draft.recall);
    const earlier = seen.get(key);
    if (earlier) {
      warnings.push({ severity: "warning", code: "duplicate-objective", message: `떠올릴 것이 ${earlier}와 같아 합쳤어요: ${draft.recall.slice(0, 60)}`, ref: earlier });
      return;
    }
    const id = `${section.id}-o${objectives.length + 1}`;
    seen.set(key, id);
    if (key.length >= 4 && (loose(draft.statement).includes(key) || loose(draft.cue).includes(key))) {
      warnings.push({ severity: "warning", code: "objective-leaks-recall", message: "목표 문장이나 실마리에 떠올릴 것이 그대로 들어 있어요.", ref: id });
    }
    const material = draft.materialNumbers.filter((n) => byNumber.has(n) && !draft.itemNumbers.includes(n));
    objectives.push({
      id, sectionId: section.id, statement: draft.statement, cue: draft.cue, recall: draft.recall, kind: draft.kind, importance: draft.importance,
      itemNumbers: targets.map((item) => item.n), materialNumbers: material,
      pages: [...new Set(targets.map((item) => item.page))].sort((a, b) => a - b),
      quotes: [...new Set(targets.map((item) => item.quote))],
    });
  });
  return { objectives, problems, warnings };
}

/**
 * Fixes glyphs some slide fonts map wrongly in the PDF text layer, so quotes and terms match what the page shows.
 * Seen in 컴퓨터 그래픽스 slides: the hyphen comes out as ㎿ (U+33BF), e.g. "Two㎿Dimensional".
 */
export function cleanPageText(text: string) {
  return text.replace(/(?<=[\p{L}\p{N}])\s*\u33BF\s*(?=[\p{L}\p{N}])/gu, "-").replace(/\u33BF/g, "-");
}
