// 기초 칸(11/3 사용자 "목록 + 기타", "cpp나 java 같은 다른 언어의 다른 기술을 배우는 경우도 신경 써"):
// [막혔어요]로 내려간 칸이 무엇이었는지 같은 이름으로 쌓는 곳. 코스 개념(course.json knowledge)과 따로, 사람(학습자)에 붙는다.
// - 공통 칸: 언어가 달라도 같은 생각(함수 부르기, 매개변수, 함수를 값으로 넘기기 …). id에 언어를 붙이지 않는다 → JS에서 푼 것이 Java로 넘어가도 남는다.
//   다만 "그 언어에서는 어떻게 생겼는지"는 다를 수 있으니 기록에 언어를 같이 적는다(langs).
// - 언어별 칸: 그 언어에만 있는 모양(js:arrow, cpp:pointer, java:generics …). 코스 언어에 맞는 것만 튜터에게 보인다.
// - 기타: 목록에 맞는 게 없으면 튜터가 제 말로 적는다. 같은 이름(정규화)이 쌓이면 목록 후보(promotable).
// - 라이브러리·프레임워크 단어(Express의 get, Spring의 @GetMapping …)는 기초 칸이 아니다: "남이 만든 도구의 이름" 칸 하나(library-api)에 모으고 무슨 단어였는지는 기록에만.
import path from "node:path";
import { DATA, read, update } from "./store.ts";

export type Lang = "js" | "ts" | "java" | "cpp" | "python" | "other";
export type Basic = { id: string; name: string; langs?: Lang[]; below?: string[]; look?: Partial<Record<Lang, string>> };

const JSLIKE: Lang[] = ["js", "ts"];
export const BASICS: Basic[] = [
  // 값과 이름
  { id: "value", name: "값(숫자·글자·참거짓)", look: { js: `42, "hi", true`, java: `42, "hi", true`, cpp: `42, "hi", true`, python: `42, "hi", True` } },
  { id: "text-vs-name", name: "글자(문자열)와 이름(변수) 구분", below: ["value"], look: { js: `"todos" vs todos`, java: `"todos" vs todos`, cpp: `"todos" vs todos`, python: `"todos" vs todos` } },
  { id: "variable", name: "변수에 담기", below: ["value"], look: { js: "const n = 3", java: "int n = 3;", cpp: "int n = 3;", python: "n = 3" } },
  { id: "type", name: "자료형(값의 종류)", below: ["value"], look: { ts: "let n: number", java: "int, String, List<T>", cpp: "int, std::string, std::vector<T>", python: "int, str, list" } },
  // 함수
  { id: "fn-define", name: "함수 만들기", below: ["variable"], look: { js: "function add(a, b) { … }", java: "int add(int a, int b) { … }", cpp: "int add(int a, int b) { … }", python: "def add(a, b): …" } },
  { id: "fn-call", name: "함수 부르기(만들기와 실행은 다르다)", below: ["fn-define"], look: { js: "add(2, 3)", java: "add(2, 3)", cpp: "add(2, 3)", python: "add(2, 3)" } },
  { id: "param", name: "매개변수와 인자(받을 칸에 값이 들어감)", below: ["fn-call"] },
  { id: "return", name: "돌려주기(return)", below: ["fn-call"] },
  { id: "fn-as-value", name: "함수를 값처럼 넘기기(콜백 — 나중에 남이 부름)", below: ["fn-call", "param"], look: { js: "app.get(\"/\", (req, res) => { … })", java: "list.forEach(x -> …)", cpp: "std::sort(v.begin(), v.end(), [](int a, int b) { … })", python: "sorted(xs, key=lambda x: …)" } },
  // 묶음
  { id: "member", name: "점(.)으로 안에 든 것 꺼내기", below: ["variable"], look: { js: "res.json(…)", java: "list.add(…)", cpp: "v.push_back(…), p->x", python: "xs.append(…)" } },
  { id: "object", name: "객체·구조체(이름 붙은 칸 묶음)", below: ["member"], look: { js: "{ id: 1, text: \"…\" }", java: "new Todo(1, \"…\")", cpp: "struct Todo { int id; };", python: "{\"id\": 1}" } },
  { id: "array", name: "배열·리스트(순서 있는 목록)", below: ["variable"], look: { js: "[1, 2]", java: "List<Integer>", cpp: "std::vector<int>", python: "[1, 2]" } },
  { id: "class", name: "클래스와 객체(설계도와 실물)", below: ["object", "fn-define"] },
  // 흐름
  { id: "condition", name: "조건(if)", below: ["value"] },
  { id: "loop", name: "반복(for · while)", below: ["condition"] },
  { id: "scope", name: "범위({ } 안에서만 보이는 이름)", below: ["variable"] },
  { id: "run-order", name: "실행 순서(위에서 아래 · 이벤트·요청이 올 때마다)", below: ["fn-call"] },
  { id: "async", name: "기다리는 일(비동기)", below: ["fn-as-value"], look: { js: "await fetch(…)", java: "CompletableFuture", cpp: "std::async", python: "await …" } },
  { id: "error", name: "오류 던지고 받기", below: ["fn-call"], look: { js: "throw / try · catch", java: "throw / try · catch", cpp: "throw / try · catch", python: "raise / try · except" } },
  // 프로그램 바깥
  { id: "module", name: "다른 파일·도구 가져오기", look: { js: "import / require", java: "import java.util.List;", cpp: "#include <vector>", python: "import os" } },
  { id: "library-api", name: "남이 만든 도구의 이름(라이브러리 함수)", below: ["fn-call", "member"] },
  { id: "compile", name: "컴파일하고 실행하기", langs: ["java", "cpp", "ts"] },
  // 언어별 모양
  { id: "js:arrow", name: "화살표 함수 (=>)", langs: JSLIKE, below: ["fn-define"] },
  { id: "js:nullish", name: "없으면 대신 (?? · ?.)", langs: JSLIKE, below: ["value"] },
  { id: "js:destructure", name: "꺼내 담기 ({ a } = obj)", langs: JSLIKE, below: ["object"] },
  { id: "js:template", name: "글자 틀 (`${…}`)", langs: JSLIKE, below: ["text-vs-name"] },
  { id: "ts:annotation", name: "타입 표시 (: string)", langs: ["ts"], below: ["type"] },
  { id: "java:main", name: "시작점 public static void main", langs: ["java"], below: ["class"] },
  { id: "java:static", name: "static(객체 없이 쓰는 것)", langs: ["java"], below: ["class"] },
  { id: "java:generics", name: "꺾쇠 타입 (List<String>)", langs: ["java"], below: ["type"] },
  { id: "java:lambda", name: "람다 (x -> …)", langs: ["java"], below: ["fn-as-value"] },
  { id: "java:interface", name: "인터페이스(약속만 적은 틀)", langs: ["java"], below: ["class"] },
  { id: "java:annotation", name: "골뱅이 표시 (@Override, @GetMapping)", langs: ["java"], below: ["class"] },
  { id: "cpp:pointer", name: "포인터 (*, ->)", langs: ["cpp"], below: ["variable"] },
  { id: "cpp:reference", name: "참조 (&)", langs: ["cpp"], below: ["variable"] },
  { id: "cpp:memory", name: "메모리와 수명 (new/delete, 스택/힙)", langs: ["cpp"], below: ["cpp:pointer"] },
  { id: "cpp:header", name: "헤더와 #include", langs: ["cpp"], below: ["module"] },
  { id: "cpp:namespace", name: "이름 앞 붙이기 (std::)", langs: ["cpp"], below: ["module"] },
  { id: "cpp:template", name: "템플릿 (template<T>, vector<int>)", langs: ["cpp"], below: ["type"] },
  { id: "cpp:lambda", name: "람다 ([](…){ … })", langs: ["cpp"], below: ["fn-as-value"] },
  { id: "py:indent", name: "들여쓰기로 묶기", langs: ["python"], below: ["scope"] },
  { id: "py:self", name: "self(자기 자신)", langs: ["python"], below: ["class"] },
];
export const BY_ID = new Map(BASICS.map((b) => [b.id, b]));

/** 코스 언어: course.language가 있으면 그것, 없으면 stack 글에서(TypeScript · Java · C++ · Python · JavaScript) */
export function langOf(course: { language?: string; stack?: string }): Lang {
  const s = `${course.language ?? ""} ${course.stack ?? ""}`.toLowerCase();
  if (/typescript|\bts\b/.test(s)) return "ts";
  if (/c\+\+|\bcpp\b/.test(s)) return "cpp";
  if (/\bjava\b(?!script)/.test(s)) return "java";
  if (/python/.test(s)) return "python";
  if (/javascript|node|\bjs\b/.test(s)) return "js";
  return "other";
}

/** 이 언어에서 보이는 칸(공통 + 그 언어 것) */
export const basicsFor = (lang: Lang) => BASICS.filter((b) => !b.langs || b.langs.includes(lang));
export const basicName = (id: string) => BY_ID.get(id)?.name ?? id;
/** 튜터에게 줄 목록 한 덩어리: id=이름 (이 언어 모양) */
export function catalogText(lang: Lang) {
  return basicsFor(lang).map((b) => `${b.id}=${b.name}${b.look?.[lang] ? ` (${b.look[lang]})` : ""}`).join("\n");
}
/** id나 이름으로 칸 찾기(이 언어에서 쓸 수 있는 것만) */
export function findBasic(lang: Lang, x: string) {
  const k = x.trim().toLowerCase();
  return basicsFor(lang).find((b) => b.id.toLowerCase() === k || b.name.toLowerCase() === k) ?? null;
}
/** 기타 이름 비교용: 공백·기호·대소문자 무시 */
export const normOther = (s: string) => s.toLowerCase().replace(/[\s·.,()'"`]/g, "");

/* ---------- 사람에 붙는 기록(.data/basics.json) ---------- */
type Rec = { stuck: number; resolved: number; langs: Lang[]; last: string; evidence: string[] };
type Other = { name: string; count: number; resolved: number; langs: Lang[]; last: string };
type Store = { concepts: Record<string, Rec>; others: Record<string, Other> };
const FILE = () => path.join(DATA, "basics.json");
const empty = (): Store => ({ concepts: {}, others: {} });
const nowIso = () => new Date().toISOString();
const addLang = (ls: Lang[], l: Lang) => (ls.includes(l) ? ls : [...ls, l]);

/** 막힘을 남긴다(칸 이름이 정해졌을 때 한 번) */
export async function markStuck(gap: { concept?: string; other?: string }, lang: Lang) {
  await update<Store>(FILE(), empty(), (s) => {
    if (gap.concept) { const r = s.concepts[gap.concept] ??= { stuck: 0, resolved: 0, langs: [], last: "", evidence: [] }; r.stuck++; r.langs = addLang(r.langs, lang); r.last = nowIso(); }
    else if (gap.other) { const k = normOther(gap.other); const o = s.others[k] ??= { name: gap.other, count: 0, resolved: 0, langs: [], last: "" }; o.count++; o.langs = addLang(o.langs, lang); o.last = nowIso(); }
  });
}
/** 풀렸다고 남긴다. evidence: 학습자가 실제로 한 것(튜터가 적거나 학습자가 [이제 알겠어요]) */
export async function markResolved(gap: { concept?: string; other?: string }, lang: Lang, evidence: string) {
  await update<Store>(FILE(), empty(), (s) => {
    if (gap.concept) { const r = s.concepts[gap.concept] ??= { stuck: 0, resolved: 0, langs: [], last: "", evidence: [] }; r.resolved++; r.langs = addLang(r.langs, lang); r.last = nowIso(); r.evidence = [...r.evidence, `${lang}: ${evidence.slice(0, 160)}`].slice(-5); }
    else if (gap.other) { const k = normOther(gap.other); const o = s.others[k] ??= { name: gap.other, count: 0, resolved: 0, langs: [], last: "" }; o.resolved++; o.langs = addLang(o.langs, lang); o.last = nowIso(); }
  });
}
export const basicsStore = () => read<Store>(FILE(), empty());

/** 목록에 올릴 후보: 기타에서 3번 넘게 나온 것 */
export async function promotable(min = 3) {
  const s = await basicsStore();
  return Object.values(s.others).filter((o) => o.count >= min).sort((a, b) => b.count - a.count);
}

/** 튜터 맥락 한 줄: 기초에서 막혔던 것 · 푼 것. 이 언어에서 푼 것과 다른 언어에서만 푼 것을 나눈다 */
export async function basicsLine(lang: Lang) {
  const s = await basicsStore();
  const parts = Object.entries(s.concepts).filter(([id]) => basicsFor(lang).some((b) => b.id === id)).map(([id, r]) => {
    const here = r.langs.includes(lang);
    const state = r.resolved ? (here ? `풀림${r.resolved > 1 ? ` ${r.resolved}번` : ""}` : `풀림(${r.langs.join("·")}에서, 이 언어 모양은 아직)`) : "막힘";
    return `${basicName(id)} ${state}${r.stuck > 1 ? `, 막힘 ${r.stuck}번` : ""}`;
  });
  const others = Object.values(s.others).filter((o) => o.langs.includes(lang)).slice(-5).map((o) => `${o.name} ${o.resolved ? "풀림" : "막힘"}`);
  const all = [...parts, ...others];
  return all.length ? `[기초(막혔어요 기록)] ${all.join(" · ")}` : "";
}
