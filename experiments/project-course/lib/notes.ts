// 학습자 기억 — 프로젝트 중심 "프로젝트 노트" (2026-10-30 사용자 결정: "학습자 기억은 프로젝트 중심으로,
// 물어본 것을 프로젝트 폴더의 server.ts, app.ts처럼 파일별로 나누고, 어떻게 동작하는지 유기적으로 연결").
//
// 무엇을 기억하나 (AI를 더 부르지 않고, 이미 오간 것에서 뽑는다)
// - 파일별 기록: 덩어리 설명, 물어본 질문, 단어 이어 묻기, 흐름 투어 걸음, 직접 고친 것/튜터가 고친 것
// - 파일 사이 연결: import(코드에서 바로 읽음) + 흐름 투어에서 실제로 넘어간 길("server.ts 18줄 → router.ts 22줄: 담당자 찾기")
// - 만난 말: 문법(언어 공통) / 도구(Node.js 등) / 이 프로젝트의 이름(router.match 같은 것)을 나눠서
//
// 문법·코드 해석을 어떻게 나누나
// - 문법(=>, ??, await, if, const …)은 어느 프로젝트에서나 뜻이 같다 → 언어 공통 사전(.data/notes/_lang.json)에도 쌓고,
//   지식 저장소에는 어휘(vocab, 주제 "프로그래밍 언어/TypeScript/문법")로 넘길 후보를 남긴다.
// - 도구(createServer, JSON.parse, scryptSync …)도 프로젝트 밖에서 같은 뜻 → 어휘(주제 "…/Node.js/도구").
// - 프로젝트 이름(router.match, found.handler, requireUser …)은 이 프로젝트에서만 뜻이 있다 → 그 이름이 정의된 파일의 노트에만.
//   지식 저장소에는 넘기지 않고, 그 이름이 보여 준 원리(라우팅·세션 같은 코스 지식)를 개념으로 넘긴다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA, read, update } from "./store.ts";

export type NoteKind = "block" | "asked" | "word" | "tour" | "fixed" | "edited" | "what";
export type NoteEntry = { id: string; at: string; stage: number; kind: NoteKind; from?: number; to?: number; title: string; summary: string; msgId?: number; terms?: string[] };
export type NoteLink = { from: { file: string; line: number }; to: { file: string; line: number }; label: string; via: "tour" };
export type TermScope = "문법" | "도구" | "프로젝트";
export type NoteTerm = { name: string; scope: TermScope; files: string[]; asked: number; lastAt: string; meaning?: string };
export type Notes = { runId: string; files: Record<string, NoteEntry[]>; links: NoteLink[]; terms: Record<string, NoteTerm> };

const file = (runId: string) => path.join(DATA, "notes", `${runId}.json`);
const LANG = () => path.join(DATA, "notes", "_lang.json");
const empty = (runId: string): Notes => ({ runId, files: {}, links: [], terms: {} });
const id = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ---------- 말 나누기: 문법 / 도구 / 프로젝트 이름 ---------- */
const SYNTAX = new Set(["const", "let", "var", "function", "async", "await", "return", "if", "else", "for", "of", "in", "while", "try", "catch", "finally", "throw",
  "new", "class", "extends", "import", "export", "from", "default", "type", "interface", "typeof", "instanceof", "this", "null", "undefined", "true", "false",
  "=>", "??", "?.", "&&", "||", "!", "===", "!==", "==", "...", "${}", "`", "{}", "[]", "()", ":", "?", "as", "void", "Promise", "string", "number", "boolean", "Record"]);
const TOOLS = /^(JSON\.\w+|Number|String|Boolean|Object\.\w+|Array\.\w+|Math\.\w+|Date|console\.\w+|process\.\w+|Buffer(\.\w+)?|URL|createServer|readFile\w*|writeFile\w*|mkdir\w*|randomBytes|scryptSync|timingSafeEqual|DatabaseSync|setTimeout|encodeURIComponent|decodeURIComponent|\w+\.(trim|split|join|slice|map|filter|find|includes|startsWith|endsWith|toString|push|length|prepare|run|get|all|exec|writeHead|end|setHeader)\b.*)$/;
/** 프로젝트 파일에서 정의된 이름들(함수·변수·클래스·내보낸 것) */
export async function projectSymbols(ws: string) {
  const names = new Map<string, string>(); // 이름 → 정의된 파일
  for (const f of await codeFiles(ws)) {
    const t = await readFile(path.join(ws, f), "utf8").catch(() => "");
    for (const m of t.matchAll(/\b(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)|^\s{2}(?:async\s+)?([a-z]\w*)\s*\([^)]*\)\s*[:{]/gm)) {
      const n = m[1] ?? m[2];
      if (n && !names.has(n)) names.set(n, f);
    }
  }
  return names;
}
export function scopeOf(term: string, symbols: Map<string, string>): { scope: TermScope; home?: string } {
  const t = term.trim().replace(/\(.*$/, "");
  if (SYNTAX.has(t) || /^[^\w$]+$/.test(t)) return { scope: "문법" };
  const head = t.split(".")[0], tail = t.split(".").pop()!;
  if (symbols.has(head)) return { scope: "프로젝트", home: symbols.get(head) };
  if (symbols.has(tail) && !TOOLS.test(t)) return { scope: "프로젝트", home: symbols.get(tail) };
  if (TOOLS.test(t)) return { scope: "도구" };
  return { scope: /^[a-z]/.test(t) ? "프로젝트" : "도구" };
}

/* ---------- 파일 목록·import 연결(코드에서 바로) ---------- */
export async function codeFiles(ws: string) {
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    for (const e of await readdir(path.join(ws, dir), { withFileTypes: true }).catch(() => [])) {
      if ([".recaller", "node_modules", "data", ".git", "public"].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (/\.(ts|js|mjs)$/.test(e.name)) out.push(r);
    }
  }
  await walk("", "");
  return out.sort();
}
export async function importLinks(ws: string) {
  const links: { from: string; to: string; names: string[] }[] = [];
  for (const f of await codeFiles(ws)) {
    const t = await readFile(path.join(ws, f), "utf8").catch(() => "");
    for (const m of t.matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+["'](\.\.?\/[^"']+)["']/g)) {
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[4]));
      const names = (m[1] ?? m[2] ?? m[3] ?? "").split(",").map((x) => x.replace(/\btype\b/, "").trim()).filter(Boolean);
      links.push({ from: f, to, names });
    }
  }
  return links;
}

/* ---------- 기록하기 ---------- */
/** 답 글의 첫 문단을 한 줄 요약으로(마크다운 기호 빼고) */
export function firstLine(md: string, max = 90) {
  const p = md.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^(#|```|[-*] |\d+\.)/.test(x)) ?? md;
  const t = p.replace(/\[\[([^\]:]+):(\d+)\]\]/g, "$1 $2줄").replace(/[*`#>]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
/** 답 글에서 `코드` 이름들(설명 속 말) */
export const codeTerms = (md: string) => [...new Set([...md.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]{1,40})`/g)].map((m) => normTerm(m[1])))]
  .filter(isTerm).slice(0, 20);
/** readJson(req) → readJson, ...post → post 처럼 같은 말로 모은다(…은 문법이라 따로) */
export const normTerm = (t: string) => { const x = t.trim(); return /^[\w$.]+\(.*\)$/.test(x) ? x.replace(/\(.*\)$/, "") : /^\.\.\.\w/.test(x) ? x.slice(3) : x; };
/** 코드에 적히는 말만(한글·띄어쓰기·주소·글자값·숫자는 빼고) */
export const isTerm = (t: string) => !!t && !/[\uac00-\ud7a3]/.test(t) && !/\s/.test(t) && !/^["'\/]/.test(t) && !/^\d+$/.test(t) && t.length <= 30 && !/\.(ts|js|mjs|json|db|html)$/.test(t);

export async function addEntry(runId: string, ws: string, rel: string, e: Omit<NoteEntry, "id" | "at">) {
  const f = rel.replace(/\\/g, "/");
  const symbols = e.terms?.length ? await projectSymbols(ws) : new Map<string, string>();
  const now = new Date().toISOString();
  const lang: { name: string; scope: TermScope }[] = [];
  await update<Notes>(file(runId), empty(runId), (n) => {
    const list = (n.files[f] ??= []);
    const same = list.findLast((x) => x.kind === e.kind && x.title === e.title && x.from === e.from);
    if (same && Date.now() - Date.parse(same.at) < 6 * 3600_000) { same.at = now; same.summary = e.summary || same.summary; } // 같은 것을 다시 보면 새로 쌓지 않고 시각만
    else list.push({ id: id(), at: now, ...e });
    e = { ...e, terms: (e.terms ?? []).filter(isTerm) };
    if (n.files[f].length > 200) n.files[f].splice(0, n.files[f].length - 200);
    for (const t of e.terms ?? []) {
      const { scope, home } = scopeOf(t, symbols);
      const key = `${scope}:${t}`;
      const cur = (n.terms[key] ??= { name: t, scope, files: [], asked: 0, lastAt: now });
      const where = scope === "프로젝트" && home ? home : f;
      if (!cur.files.includes(where)) cur.files.push(where);
      if (e.kind === "word" || e.kind === "what") { cur.asked += 1; if ((e.terms ?? []).length === 1 && e.summary) cur.meaning = e.summary; }
      cur.lastAt = now;
      if (scope !== "프로젝트") lang.push({ name: t, scope });
    }
  });
  // 문법·도구는 프로젝트 밖에서도 같은 뜻: 언어 공통 사전에도
  if (lang.length) await update<{ terms: Record<string, { name: string; scope: TermScope; seen: { runId: string; file: string }[]; asked: number }> }>(LANG(), { terms: {} }, (L) => {
    for (const t of lang) {
      const cur = (L.terms[`${t.scope}:${t.name}`] ??= { name: t.name, scope: t.scope, seen: [], asked: 0 });
      if (!cur.seen.some((s) => s.runId === runId && s.file === f)) cur.seen.push({ runId, file: f });
      if (e.kind === "word" || e.kind === "what") cur.asked += 1;
    }
  });
}
export async function addTour(runId: string, ws: string, stage: number, title: string, steps: { file: string; from: number; to: number; title: string; text: string }[], msgId?: number) {
  for (const [i, s] of steps.entries()) await addEntry(runId, ws, s.file, { stage, kind: "tour", from: s.from, to: s.to, title: `${title} · ${i + 1}. ${s.title}`, summary: firstLine(s.text), msgId, terms: codeTerms(s.text) });
  await update<Notes>(file(runId), empty(runId), (n) => {
    for (let i = 0; i + 1 < steps.length; i++) {
      const a = steps[i], b = steps[i + 1];
      if (a.file === b.file) continue;
      if (!n.links.some((l) => l.from.file === a.file && l.from.line === a.from && l.to.file === b.file && l.to.line === b.from))
        n.links.push({ from: { file: a.file, line: a.from }, to: { file: b.file, line: b.from }, label: b.title, via: "tour" });
    }
  });
}
export const notesOf = (runId: string) => read<Notes>(file(runId), empty(runId));

/* ---------- 튜터에게 줄 것: "이 사람이 이 프로젝트에서 이미 본 것" ---------- */
export async function notesContext(runId: string, focusFile: string | null) {
  const n = await notesOf(runId);
  const lines: string[] = [];
  const show = (f: string, k = 6) => {
    const es = (n.files[f] ?? []).slice(-k);
    if (es.length) lines.push(`- ${f}: ${es.map((e) => `${e.kind === "block" ? "덩어리 설명" : e.kind === "tour" ? "투어" : e.kind === "word" || e.kind === "what" ? "물음" : e.kind === "fixed" ? "직접 고침" : e.kind === "edited" ? "튜터가 고침" : "질문"}(${e.from ? `${e.from}~${e.to}줄 ` : ""}${e.title})`).join(", ")}`);
  };
  if (focusFile) show(focusFile, 8);
  for (const f of Object.keys(n.files)) if (f !== focusFile) show(f, 3);
  const asked = Object.values(n.terms).filter((t) => t.asked > 0).sort((a, b) => b.asked - a.asked).slice(0, 12);
  if (!lines.length && !asked.length) return "";
  return [`[이 학습자가 이 프로젝트에서 이미 본 것 — 같은 설명을 처음부터 반복하지 말고 "아까 …에서 본 것처럼" 이어서 말한다]`, ...lines,
    asked.length ? `- 물어봤던 말: ${asked.map((t) => `${t.name}(${t.scope}${t.asked > 1 ? `, ${t.asked}번` : ""})`).join(", ")}` : ""].filter(Boolean).join("\n");
}

/* ---------- 화면용: 파일 트리 + 연결 + 말 ---------- */
export async function notesView(runId: string, ws: string) {
  const n = await notesOf(runId);
  const files = await codeFiles(ws);
  const imports = await importLinks(ws);
  const all = [...new Set([...files, ...Object.keys(n.files)])].sort();
  return {
    files: all.map((f) => ({
      file: f, exists: files.includes(f), entries: (n.files[f] ?? []).slice().reverse(),
      uses: imports.filter((l) => l.from === f).map((l) => ({ file: l.to, names: l.names })),
      usedBy: imports.filter((l) => l.to === f).map((l) => ({ file: l.from, names: l.names })),
      flowOut: n.links.filter((l) => l.from.file === f), flowIn: n.links.filter((l) => l.to.file === f),
      terms: Object.values(n.terms).filter((t) => t.files.includes(f)).sort((a, b) => b.asked - a.asked || a.name.localeCompare(b.name)),
    })),
    links: n.links,
    terms: { 문법: Object.values(n.terms).filter((t) => t.scope === "문법"), 도구: Object.values(n.terms).filter((t) => t.scope === "도구"), 프로젝트: Object.values(n.terms).filter((t) => t.scope === "프로젝트") },
  };
}

/* ---------- 지식 저장소로 보낼 것(미리 보기) ----------
 * 앱의 지식 저장소(src/lib/knowledge/api.ts의 saveMany·recordEvent)에 그대로 넣을 수 있는 꼴로 만든다.
 * 이 실험은 앱 데이터에 쓰지 않는다(인계 규칙) — 붙일 때 이 목록을 saveMany에 넘기면 된다.
 * - 문법·도구 = 어휘(vocab). 물어본 적 있으면 "몰랐음", 만나기만 했으면 "만남".
 * - 프로젝트 이름은 넘기지 않는다(이 프로젝트에서만 뜻이 있음). 대신 코스 지식(개념)은 기록 후보(records)로 따로 넘긴다. */
export async function knowledgeExport(runId: string, courseTitle: string) {
  const n = await notesOf(runId);
  const items = Object.values(n.terms).filter((t) => t.scope !== "프로젝트").map((t) => ({
    save: {
      title: t.name, kind: "vocab" as const, state: (t.asked > 0 ? "unknown" : "met") as "unknown" | "met",
      topicHint: t.scope === "문법" ? "프로그래밍 언어/TypeScript/문법" : "프로그래밍 언어/Node.js/도구",
      body: t.meaning ?? "", source: { kind: "code" as const, title: `프로젝트 코스: ${courseTitle}`, ref: t.files.join(", ") },
    },
    events: t.asked > 0 ? [{ kind: "asked" as const, detail: `${t.files[0] ?? ""}에서 물어봄${t.asked > 1 ? ` (${t.asked}번)` : ""}` }] : [{ kind: "met" as const, detail: `${t.files[0] ?? ""}에서 만남` }],
  }));
  return { runId, note: "앱 지식 저장소의 saveMany(save 목록) → 돌려받은 id로 recordEvent(events)", items };
}
