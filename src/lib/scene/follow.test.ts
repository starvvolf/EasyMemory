// 생각 따라가기로 빈틈 뽑기: 대역 답으로 따라가기 → 빈틈 → 기본기 묶음 · 발상 문제 장면(파이썬을 실제로 돌려 검사).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.STUDY_FORGE_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "follow-"));
const { followGaps, momentsOf, followUser, readFollow } = await import("./follow.ts");
const { readScene, unusedScene } = await import("./store.ts");

const rec = {
  problemId: "cp_v", title: "바이러스", statement: "1번에서 퍼지는 컴퓨터 수", tests: [], timeLimitMs: 1000, tags: [],
  talk: [
    { at: "2026-11-11T17:51:19Z", kind: "질문", q: "linked[1]부터 끝까지 탐색하면 되네", a: "반대쪽도 넣어요", code: "linked[a].append(b)" },
    { at: "2026-11-11T18:02:47Z", kind: "질문", q: "이건가?", a: "이웃을 대기줄에 넣어요", code: "for nb in g[cur]:\n    seen[nb]=True" },
  ],
  subs: [{ id: "s1", at: "2026-11-11T18:17:05Z", lang: "python", mode: "submit", verdict: "AC", code: "print(1)" }],
} as never;

const FOLLOW = {
  toc: [{ part: "기본기", subs: [{ name: "", items: ["+= 증가"] }] }, { part: "연결 저장", subs: [{ name: "양쪽에 담기", items: ["양방향 인접 리스트"] }] }],
  segments: [{ moments: [1], thinking: "t", stuckAt: 1, stuck: "양방향", kind: "발상", level: "애매하게 앎", missing: "양쪽에", hint: "반대쪽도", after: "a", basics: [] }],
  orderCheck: [], flow: "f",
  items: [
    { item: "양방향 인접 리스트", kind: "발상", level: "애매하게 앎", moments: [1], missing: "양쪽 목록에 서로를 넣기", why: "", end: "튜터 코드 옮김", basicPart: "", ideaPart: "", wrote: "linked[a].append(b)" },
    { item: "+= 증가", kind: "기본기", level: "애매하게 앎", moments: [2], missing: "1을 더해 저장하기", why: "", end: "튜터 코드 옮김", basicPart: "", ideaPart: "", wrote: "x=+1" },
    { item: "앱 입력 칸", kind: "애매", level: "모름", moments: [2], missing: "", why: "", end: "남음", basicPart: "", ideaPart: "", wrote: "" }, // 두 쪽 다 비면 빈틈 없음
  ],
};
const IDEA = {
  story: "친구 관계가 주어진다.", ask: "친구 목록을 채우는 코드를 쓰세요.", explain: "연결은 양쪽 목록에 넣는다.",
  setup: "n,m=map(int,input().split())\nf=[[] for _ in range(n+1)]\npairs=[tuple(map(int,input().split())) for _ in range(m)]",
  after: "for i in range(1,n+1):\n    print(*sorted(f[i]))",
  reference: "for a,b in pairs:\n    f[a].append(b)\n    f[b].append(a)", mine: "for a,b in pairs:\n    f[a].append(b)",
  inputs: ["3 1\n1 2", "3 2\n3 1\n2 3", "2 1\n2 1", "4 2\n1 2\n3 4"],
};
const BASIC = { problems: [{ target: "+= 증가", format: "choice", ask: "x에 1을 더해 저장하는 것은?", right: "x += 1", mine: "x =+ 1", reference: "", mineCode: "", inputs: [], explain: "=+는 +1을 대입" }] };

test("따라가기 결과로 빈틈과 첫 장면(발상 · 기본기)을 만들고, 장면 검사를 통과하면 그때 생각을 확인된 것으로 둔다", async () => {
  const asked: string[] = [];
  const ask = (async (purpose: string) => { asked.push(purpose); return purpose === "scene:follow" ? FOLLOW : purpose === "scene:basics" ? BASIC : IDEA; }) as never;
  const gaps = await followGaps("cp_v", rec, ask);
  assert.deepEqual(asked.sort(), ["scene:basics", "scene:follow", "scene:idea-problem"]);
  assert.equal(gaps.length, 2, "두 쪽이 다 빈 애매 항목은 빈틈이 아니다");
  const idea = gaps.find((g) => g.kind === "알고리즘 구현")!, basic = gaps.find((g) => g.kind === "문법")!;
  assert.equal(idea.state.distance, "near");
  assert.deepEqual(idea.unit, { part: "연결 저장", sub: "양쪽에 담기", order: 2 });
  assert.deepEqual(basic.unit, { part: "기본기", sub: "", order: 1 });
  assert.ok(idea.wrongVerified && basic.wrongVerified);
  assert.equal(idea.evidence[0].type, "talk");
  const s1 = await unusedScene(idea.id, "near"), s2 = await unusedScene(basic.id, "near");
  assert.equal(s1?.format, "write"); assert.ok(s1?.check?.ok);
  assert.ok((s1?.inputs.filter((x) => x.role === "split").length ?? 0) >= 2, "한쪽만 넣으면 틀리는 입력이 둘 이상");
  assert.equal(s2?.format, "choice"); assert.ok(await readScene(s2!.id));
  assert.equal((await readFollow("cp_v"))?.reply.flow, "f");
});

test("검사에 걸린 발상 문제는 이유를 붙여 한 번 더 만들고, 그래도 안 되면 장면 없이 빈틈만 남긴다", async () => {
  const users: string[] = [];
  const bad = { ...IDEA, mine: IDEA.reference }; // 그때 쓴 모양이 맞아 버림 → 검사 실패
  // 다른 이름(같은 생각이면 앞 시험의 빈틈과 합쳐지므로)
  const follow = { ...FOLLOW, items: FOLLOW.items.map((x) => ({ ...x, item: `${x.item} 2` })) };
  const ask = (async (purpose: string, _s: string, user: string) => { if (purpose === "scene:idea-problem") users.push(user); return purpose === "scene:follow" ? follow : purpose === "scene:basics" ? { problems: BASIC.problems.map((p) => ({ ...p, target: `${p.target} 2` })) } : bad; }) as never;
  const gaps = await followGaps("cp_w", { ...(rec as object), problemId: "cp_w" } as never, ask);
  assert.equal(users.length, 2);
  assert.match(users[1], /지난번 검사에서 걸린 것/);
  const idea = gaps.find((g) => g.kind === "알고리즘 구현")!;
  assert.equal(idea.wrongVerified, false);
  assert.equal(await unusedScene(idea.id, "near"), null);
});

test("기록 순간: 질문 · 제출을 시간 순으로, 코드가 바뀐 줄을 붙인다", () => {
  const ms = momentsOf(rec);
  assert.deepEqual(ms.map((m) => m.n), [1, 2, 3]);
  const u = followUser(rec, ms);
  assert.match(u, /바로 앞 순간과 달라진 줄:\n\+ for nb in g\[cur\]:/);
  assert.match(u, /#3 03:17:05 제출 → AC/);
});
