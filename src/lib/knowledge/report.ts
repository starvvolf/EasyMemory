// 점검 보고서 (2026-10-28): the whole knowledge store as one markdown text — a summary, checks that should all pass,
// then every item under its 주제, and the 자료 (목표는 2026-10-30에 없앴다). For a person to read and see that the store is sound, or to paste
// to someone. Read-only, no model call: GET /api/knowledge/report (?download=1 for a .md file).
import { dupeStatus } from "./dedupe.ts";
import { vectorStatus } from "./embed.ts";
import { listMaterials } from "./goals.ts";
import { KIND_LABEL, REVIEW_BOXES, STATE_LABEL, normalize, pathOf, readAll, readEvents, dayOf, type Knowledge } from "./store.ts";

const SOURCE = { pdf: "PDF", web: "웹 글", code: "코드 문제", chat: "대화", manual: "직접" } as const;
const one = (text: string, n = 80) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const meaningOf = (i: Knowledge) => i.body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("헷갈림:")) ?? "";

export async function knowledgeReport(now = new Date()) {
  const { folders, items } = await readAll();
  const [events, dupes, materials] = await Promise.all([readEvents(), dupeStatus(), listMaterials()]);
  const vectors = await vectorStatus(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const folderIds = new Set(folders.map((f) => f.id));

  /* ---------- 점검 ---------- */
  type Check = { name: string; bad: string[]; note?: string; warnOnly?: boolean };
  const checks: Check[] = [];
  const add = (name: string, bad: string[], extra: Partial<Check> = {}) => checks.push({ name, bad, ...extra });
  add("고리가 있는 지식을 가리킨다", items.flatMap((i) => i.links.filter((l) => !byId.has(l.to)).map((l) => `${i.title} → (없는 지식 ${l.to})`)));
  add("자기 자신을 잇는 고리가 없다", items.filter((i) => i.links.some((l) => l.to === i.id)).map((i) => i.title));
  add("같은 고리가 두 번 들어 있지 않다", items.filter((i) => new Set(i.links.map((l) => l.to)).size !== i.links.length).map((i) => i.title));
  add("지식의 폴더가 있다", items.filter((i) => i.folderId && !folderIds.has(i.folderId)).map((i) => `${i.title} (폴더 ${i.folderId})`));
  add("폴더의 부모 폴더가 있다", folders.filter((f) => f.parentId && !folderIds.has(f.parentId)).map((f) => f.name));
  const used = (id: string): boolean => items.some((i) => i.folderId === id) || folders.some((f) => f.parentId === id && used(f.id));
  add("빈 자동 폴더가 없다 (손으로 만든 폴더는 비어도 됨)", folders.filter((f) => !f.hand && !used(f.id)).map((f) => pathOf({ folders }, f.id)));
  // Two items one would call by the same name (이름 또는 다른 이름이 겹침) should have been one item.
  const names = new Map<string, Set<string>>();
  for (const i of items) for (const n of new Set([i.title, ...i.aliases].map(normalize).filter(Boolean))) names.set(n, (names.get(n) ?? new Set()).add(i.id));
  const clashes = new Map<string, string>();
  for (const ids of names.values()) if (ids.size > 1) { const key = [...ids].sort().join(","); clashes.set(key, [...ids].map((id) => `${byId.get(id)!.title} (${id})`).join(" = ")); }
  add("이름(다른 이름 포함)이 겹치는 지식이 없다", [...clashes.values()], { note: "지식창에서 합치거나 다른 이름을 고쳐요." });
  add("뜻이 비어 있지 않다", items.filter((i) => !meaningOf(i)).map((i) => i.title), { warnOnly: true, note: "지식창 \"AI로 뜻 채우기\"로 채울 수 있어요." });
  add("출처가 있다", items.filter((i) => !i.sources.length).map((i) => i.title), { warnOnly: true });
  const minuteAgo = now.getTime() - 60_000;
  add("주제 정리가 밀려 있지 않다 (저장 1분 넘게 종류 없음)", items.filter((i) => !i.kind && Date.parse(i.createdAt) < minuteAgo).map((i) => i.title), { note: "저장 4초 뒤 자동으로 돌아요. 남아 있으면 지식창 \"지금 정리\"." });
  add("주제가 있다", items.filter((i) => !i.folderId).map((i) => i.title), { warnOnly: true });
  const checked = new Set(dupes.checked);
  add("같은 지식 찾기를 거쳤다 (주제 정리된 지식)", items.filter((i) => i.kind && !checked.has(i.id)).map((i) => i.title), { warnOnly: true });
  add("복습 날짜가 올바르다", items.filter((i) => i.review && (!Number.isFinite(Date.parse(i.review.dueAt)) || i.review.box < 0 || i.review.box >= REVIEW_BOXES.length)).map((i) => i.title));
  add("졸업한 지식은 앎 상태다", items.filter((i) => i.graduated && i.state !== "known").map((i) => `${i.title} (${STATE_LABEL[i.state]})`));
  add("기록이 있는 지식을 가리킨다", [...new Set(events.filter((e) => !byId.has(e.knowledgeId)).map((e) => e.knowledgeId))].map((id) => `기록 ${events.filter((e) => e.knowledgeId === id).length}개 → (없는 지식 ${id})`),
    { warnOnly: true, note: "지운·합친 지식의 옛 기록일 수 있어요." });
  add("임베딩이 지금 이름·뜻과 맞다", vectors.stale ? [`${vectors.stale}개가 아직 없거나 옛 글자 기준`] : [], { warnOnly: true, note: "다음 \"뜻이 비슷한 지식 찾기\"나 같은 지식 찾기 때 새로 만들어요." });
  add("임베딩에 지운 지식이 남아 있지 않다", vectors.orphan ? [`${vectors.orphan}개`] : [], { warnOnly: true });
  const openPairs = dupes.pairs.filter((p) => p.status === "open" && byId.has(p.newId) && byId.has(p.otherId));
  add("확인 안 한 \"같은 지식일 수 있어요\"가 없다", openPairs.map((p) => `${byId.get(p.otherId)!.title} = ${byId.get(p.newId)!.title}: ${one(p.reason, 60)}`), { warnOnly: true });

  const fails = checks.filter((c) => c.bad.length && !c.warnOnly).length;
  const warns = checks.filter((c) => c.bad.length && c.warnOnly).length;

  /* ---------- 요약 ---------- */
  const count = <K extends string>(keys: K[], f: (i: Knowledge) => K | undefined) => keys.map((k) => `${k} ${items.filter((i) => f(i) === k).length}`).join(" · ");
  const kindName = (i: Knowledge) => (i.kind ? KIND_LABEL[i.kind] : "정리 대기");
  const due = items.filter((i) => i.review && !i.graduated && Date.parse(i.review.dueAt) <= now.getTime()).length;
  const linkCount = items.reduce((n, i) => n + i.links.length, 0);
  const out: string[] = [];
  out.push(`# 지식 저장소 점검 (${dayOf(now.toISOString())} ${now.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour12: false, hour: "2-digit", minute: "2-digit" })})`, "");
  out.push(fails ? `**문제 ${fails}개**${warns ? `, 확인할 것 ${warns}개` : ""} — 아래 "점검"에서 ✗ 줄을 보세요.` : warns ? `**문제 없음.** 확인할 것 ${warns}개(△).` : "**문제 없음.**", "");
  out.push("## 요약", "", "| | |", "|---|---|",
    `| 지식 | ${items.length}개 (고리 ${linkCount}개) |`,
    `| 상태 | ${count(["만남", "몰랐음", "앎"], (i) => STATE_LABEL[i.state] as "만남" | "몰랐음" | "앎")} · 졸업 ${items.filter((i) => i.graduated).length} |`,
    `| 종류 | ${[...Object.values(KIND_LABEL), "정리 대기"].map((k) => `${k} ${items.filter((i) => kindName(i) === k).length}`).filter((s) => !s.endsWith(" 0")).join(" · ") || "-"} |`,
    `| 주제 | 맨 위 ${folders.filter((f) => !f.parentId).map((f) => f.name).join(", ") || "-"} · 폴더 ${folders.length}개 |`,
    `| 지금 복습 차례 | ${due}개 |`,
    `| 기록 | ${events.length}개 (마지막 ${events.at(-1) ? dayOf(events.at(-1)!.at) : "-"}) |`,
    `| 같은 지식 찾기 | 거친 지식 ${items.filter((i) => checked.has(i.id)).length}개 · 같음 의심 ${dupes.pairs.filter((p) => p.verdict === "same").length}쌍(확인 안 함 ${openPairs.length}) · 가까움 ${dupes.pairs.filter((p) => p.status === "near").length}쌍 |`,
    `| 고리 종류 | ${[...new Set(items.flatMap((i) => i.links.map((l) => l.relation)))].map((r) => `${r} ${items.reduce((n, i) => n + i.links.filter((l) => l.relation === r).length, 0)}`).join(" · ") || "-"} |`,
    `| 임베딩 | ${vectors.fresh}/${items.length}개 최신 |`, "");

  out.push("## 점검", "");
  for (const c of checks) {
    const mark = !c.bad.length ? "✓" : c.warnOnly ? "△" : "✗";
    out.push(`- ${mark} ${c.name}${c.bad.length ? ` — ${c.bad.length}개` : ""}`);
    for (const b of c.bad.slice(0, 15)) out.push(`  - ${b}`);
    if (c.bad.length > 15) out.push(`  - … 외 ${c.bad.length - 15}개`);
    if (c.bad.length && c.note) out.push(`  - (${c.note})`);
  }
  out.push("");

  /* ---------- 주제별 지식 ---------- */
  const itemLine = (i: Knowledge) => {
    const parts = [`**${i.title}**`, kindName(i), `${STATE_LABEL[i.state]}${i.graduated ? "·졸업" : ""}`];
    if (i.review) parts.push(`상자 ${i.review.box + 1} (다음 ${dayOf(i.review.dueAt).slice(5)})`);
    const extra: string[] = [];
    const meaning = meaningOf(i);
    extra.push(meaning ? one(meaning) : "(뜻 없음)");
    if (i.aliases.length) extra.push(`다른 이름: ${i.aliases.slice(0, 6).join(", ")}`);
    const links = [...i.links.map((l) => `→${byId.get(l.to)?.title ?? "?"}(${l.relation}${l.note ? `: ${l.note}` : ""})`),
      ...items.filter((o) => o.links.some((l) => l.to === i.id)).map((o) => `←${o.title}(${o.links.find((l) => l.to === i.id)!.relation})`)];
    if (links.length) extra.push(`고리: ${links.slice(0, 6).join(", ")}${links.length > 6 ? " …" : ""}`);
    const srcs = [...new Set(i.sources.map((s) => `${SOURCE[s.kind] ?? s.kind} ${one(s.title, 30)}`))];
    if (srcs.length) extra.push(`출처: ${srcs.slice(0, 3).join(", ")}${srcs.length > 3 ? ` 외 ${srcs.length - 3}` : ""}`);
    if (i.placedByHand) extra.push("손으로 옮김");
    return `- ${parts.join(" · ")} — ${extra.join(" | ")}`;
  };
  out.push("## 주제별 지식", "");
  const paths = folders.map((f) => ({ id: f.id, path: pathOf({ folders }, f.id) })).sort((a, b) => a.path.localeCompare(b.path, "ko"));
  for (const p of paths) {
    const mine = items.filter((i) => i.folderId === p.id).sort((a, b) => a.title.localeCompare(b.title, "ko"));
    if (!mine.length) continue;
    out.push(`### ${p.path} (${mine.length})`, "", ...mine.map(itemLine), "");
  }
  const loose = items.filter((i) => !i.folderId || !folderIds.has(i.folderId));
  if (loose.length) out.push(`### 주제 없음 (${loose.length})`, "", ...loose.map(itemLine), "");

  /* ---------- 자료 ---------- */
  out.push("## 자료", "");
  if (!materials.length) out.push("(없음)");
  for (const m of [...materials].sort((a, b) => b.lastAt.localeCompare(a.lastAt))) {
    out.push(`- ${SOURCE[m.kind] ?? m.kind} **${one(m.title, 50)}** · 지식 ${m.items}`);
  }
  out.push("");
  return { markdown: out.join("\n"), fails, warns };
}
