// 가상 학습자(NPC) — 엄격 모드 연출가 (설계 docs/가상학습자_설계_v2(+gpt).md 3번). 코드가 길과 막히는 자리를 정한다(AI 0번).
// NPC는 가진 조각만으로 길을 고르고, 틀린 조각을 가졌으면 그 조각으로 자신 있게 쓰고, 채점에서 틀리면 튜터에게 묻고 배운다.
// 결과 = 풀이 기록(제출 · 대화, 실제 앱과 같은 모양) + 정답지(어떤 조각이 없어서 어디서 막혔나). 상황 재현 시험의 재료.
import { judge, type TestCase } from "../code/run.ts";
import { FRAGMENTS, ROUTES, type Route } from "./map2606.ts";

export type Npc = { id: string; name: string; holds: string[]; note: string };
export type KeyItem = { fragment: string; how: "missing" | "wrong"; slot?: string; resolved: "taught" | "never" };
export type Played = { npc: Npc; route: string; subs: Array<{ id: string; at: string; code: string; verdict: string; passed: number; total: number }>;
  talk: Array<{ at: string; kind: string; q: string; a: string; verdict?: string }>; key: KeyItem[]; learned: string[] };

const what = (id: string) => FRAGMENTS.find((f) => f.id === id)!;
const rightOf: Record<string, string> = { "wrong.alias-list": "syntax.py.list-of-lists", "wrong.one-way": "idea.undirected", "wrong.no-visited": "idea.mark-visited", "wrong.direct-only": "idea.mark-visited" };

/** 길 고르기: 틀린 조각이 든 길이 먼저(자신 있게), 그다음 가진 조각으로 끝까지 갈 수 있는 길(A → B → C 순). */
export function pickRoute(holds: Set<string>): { route: Route; missing: string[] } {
  // 맞는 조각 대신 그 자리의 틀린 조각을 가졌으면(잘못 앎) 빠졌다고 느끼지 않는다 — 그 조각으로 쓴다
  const has = (r: Route, n: string) => holds.has(n) || Object.values(r.slots).some((s) => s.right === n && s.wrong !== undefined && holds.has(s.wrong));
  const ok = (r: Route) => r.needs.every((n) => has(r, n));
  const confident = ROUTES.find((r) => r.needs.some((n) => n.startsWith("wrong.") && holds.has(n)) && ok(r));
  if (confident) return { route: confident, missing: [] };
  const full = ROUTES.find((r) => !r.needs.some((n) => n.startsWith("wrong.")) && ok(r));
  if (full) return { route: full, missing: [] };
  // 끝까지 갈 길이 없으면 가장 멀리 가는 길(빠진 조각이 가장 적은 맞는 길)
  const best = ROUTES.filter((r) => !r.needs.some((n) => n.startsWith("wrong."))).map((r) => ({ r, miss: r.needs.filter((n) => !has(r, n)) })).sort((a, b) => a.miss.length - b.miss.length)[0];
  return { route: best.r, missing: best.miss };
}

const T0 = Date.parse("2026-11-15T10:00:00.000Z");
export async function play(npc: Npc, tests: TestCase[], timeLimitMs = 1000): Promise<Played> {
  const holds = new Set(npc.holds);
  const key: KeyItem[] = [];
  const talk: Played["talk"] = [];
  const subs: Played["subs"] = [];
  const learned: string[] = [];
  let t = T0;
  const tick = (min = 2) => new Date((t += min * 60_000)).toISOString();
  let { route, missing } = pickRoute(holds);
  // 방법을 못 떠올림 → 튜터에게 묻고, 튜터가 가장 가까운 길의 빠진 조각을 가르친다
  const teachMissing = (q: string) => {
    if (!missing.length) return;
    talk.push({ at: tick(), kind: "질문", q, a: `연결된 컴퓨터를 차례로 따라가며 한 번 본 컴퓨터는 표시해 두는 방법(${route.name})을 써요. ${missing.map((m) => `${what(m).what}: ${what(m).example}`).join(" / ")}` });
    for (const m of missing) { holds.add(m); learned.push(m); key.push({ fragment: m, how: "missing", resolved: "taught" }); }
    missing = [];
  };
  teachMissing("이거 어떻게 풀어요? 1번이랑 이어진 걸 다 찾아야 하는 건 알겠는데 어떻게 따라가야 할지 모르겠어요.");
  // 자리마다: 맞는 조각을 가졌으면 그것, 아니면 그 자리의 틀린 조각(가졌거나, 둘 다 없으면 틀린 쪽으로 지어 씀)
  const choice = (slot: string) => { const s = route.slots[slot]; return holds.has(s.right) ? s.right : s.wrong ?? s.right; };
  for (let n = 1; n <= 5; n++) {
    const code = route.build(choice);
    const j = await judge("python", code, tests, { timeLimitMs, stopAtFirstFail: true });
    const at = tick(4);
    subs.push({ id: `sub_${npc.id}${n}`, at, code, verdict: j.verdict, passed: j.passed, total: tests.length });
    if (j.verdict === "AC") break;
    const r = j.results.find((x) => x.verdict !== "AC");
    // 무엇 때문에 틀렸나는 연출가가 안다(정답지). 학습자는 모르니 판정과 입력만 들고 묻는다.
    const culprit = Object.entries(route.slots).map(([slot, s]) => ({ slot, used: choice(slot), right: s.right })).find((x) => x.used !== x.right)
      ?? (route.needs.find((x) => x.startsWith("wrong.")) ? { slot: "route", used: route.needs.find((x) => x.startsWith("wrong."))!, right: rightOf[route.needs.find((x) => x.startsWith("wrong."))!] } : null);
    if (!culprit) break;
    talk.push({ at: tick(1), kind: "질문", verdict: j.verdict, q: j.verdict === "TLE" ? "시간 초과가 나요. 왜 안 끝나요?" : `틀렸대요. ${r ? `입력 ${JSON.stringify(r.input.slice(0, 60))}에서 ${JSON.stringify(r.expected)}가 나와야 하는데 ${JSON.stringify((r.got || r.stderr).slice(0, 40))}가 나와요.` : ""} 어디가 틀렸어요?`,
      a: `${what(culprit.right).what}. 예를 들면:\n${what(culprit.right).example}` });
    key.push({ fragment: culprit.right, how: culprit.used.startsWith("wrong.") && holds.has(culprit.used) ? "wrong" : "missing", slot: culprit.slot, resolved: "taught" });
    holds.add(culprit.right); holds.delete(culprit.used); learned.push(culprit.right);
    // 틀린 조각으로 고른 길이었으면 배운 뒤 다시 고른다
    if (culprit.slot === "route") {
      ({ route, missing } = pickRoute(new Set([...holds].filter((h) => !h.startsWith("wrong.")))));
      teachMissing("그럼 바로 연결된 것만 세면 안 되면 어떻게 해야 해요? 이어진 걸 끝까지 따라가는 방법을 모르겠어요.");
    }
  }
  return { npc, route: route.id, subs, talk, key, learned };
}

/** 첫 실험(설계 8번)에 맞춘 사람들: 성격 · 나머지는 같고 조각 하나씩만 다르다. */
const BASE = ["syntax.py.list-of-lists", "shape.adj-list", "shape.edge-list", "idea.undirected", "idea.mark-visited", "tool.queue", "tool.recursion", "idea.until-no-change"];
const without = (...ids: string[]) => BASE.filter((x) => !ids.includes(x));
export const NPCS: Npc[] = [
  { id: "n1", name: "① 다 가짐", holds: BASE, note: "BFS로 한 번에" },
  { id: "n2", name: "② 큐 없음", holds: without("tool.queue"), note: "재귀 DFS로" },
  { id: "n3", name: "③ 큐 · 재귀 없음", holds: without("tool.queue", "tool.recursion"), note: "반복해서 훑기로(돌아가는 길)" },
  { id: "n4", name: "④ 표시하기 잘못 앎", holds: [...without("idea.mark-visited"), "wrong.no-visited"], note: "표시 없이 → 시간 초과" },
  { id: "n5", name: "⑤ 빈 목록 N개 문법 잘못 앎", holds: [...without("syntax.py.list-of-lists"), "wrong.alias-list"], note: "[[]]*N → 틀림" },
  { id: "n6", name: "⑥ 양방향을 모름", holds: [...without("idea.undirected"), "wrong.one-way"], note: "한쪽만 넣음 → 틀림" },
  { id: "n7", name: "⑦ 바로 연결된 것만", holds: [...without("idea.mark-visited", "tool.queue", "tool.recursion", "idea.until-no-change"), "wrong.direct-only"], note: "방법 고르기에서 막힘" },
];
