// 공통 형식 1 한 줄 쓰기를 실습 빈틈으로: 설계 8번 FPS "lock 쓰는 법 — 표현 · 한 줄. 카운터를 올리는 줄을 잠금으로 감싸기.
// 준비 코드가 읽기와 쓰기 사이에 일부러 쉬어서 잠금이 없으면 늘 어긋나요 + 구조 검사(lock 블록 안에 그 줄이 있나)". AI 0번(은행).
// 프로그램 = setup + 학습자가 쓴 줄 + after (바닥의 write 형식 그대로라 검사 · 채점은 바닥 check.ts · grade.ts가, 구조 검사는 Scene.structure.must를 바닥이 돌린다).
// 출력은 ok / lost 한 단어(언어마다 같은 모양). 입력 = 동시에 올리는 스레드(요청) 수 — 1이면 누구나 맞고(기본), 2 · 3 · 5에서 갈린다.
import type { Gap, Scene } from "../types.ts";

type Bank = { setup: string; after: string; template: string; reference: string; other: string; must: Array<{ pattern: string; why: string }>; alsoRight: string[] };
const BANK: Record<string, Bank> = {
  csharp: {
    setup: ["using System;", "using System.Threading;", "class Program {", "    static int count = 0;", "    static readonly object gate = new object();", "    static void Add() {"].join("\n"),
    template: "        int cur = count;\n        Thread.Sleep(20);\n        count = cur + 1;",
    reference: "        lock (gate) {\n            int cur = count;\n            Thread.Sleep(20);\n            count = cur + 1;\n        }",
    other: "        int cur = count;\n        Thread.Sleep(20);\n        lock (gate) { count = cur + 1; }",
    after: ["    }", "    static void Main() {", "        int k = int.Parse(Console.ReadLine());", "        var ts = new Thread[k];", "        for (int i = 0; i < k; i++) ts[i] = new Thread(Add);",
      "        foreach (var t in ts) t.Start();", "        foreach (var t in ts) t.Join();", "        Console.WriteLine(count == k ? \"ok\" : \"lost\");", "    }", "}"].join("\n"),
    must: [{ pattern: "lock\\s*\\(\\s*gate\\s*\\)\\s*\\{[^}]*=\\s*count\\b[^}]*\\bcount\\s*=", why: "count를 읽는 줄과 쓰는 줄이 둘 다 lock (gate) { } 안에 있어야 해요." }],
    alsoRight: [],
  },
  javascript: {
    setup: ["const sleep = (ms) => new Promise((r) => setTimeout(r, ms));", "class Gate { constructor() { this.tail = Promise.resolve(); } run(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; } }",
      "const gate = new Gate();", "let count = 0;", "async function add() {"].join("\n"),
    template: "  const cur = count;\n  await sleep(2);\n  count = cur + 1;",
    reference: "  await gate.run(async () => {\n    const cur = count;\n    await sleep(2);\n    count = cur + 1;\n  });",
    other: "  const cur = count;\n  await sleep(2);\n  await gate.run(async () => { count = cur + 1; });",
    after: ["}", "async function main() {", "  const k = Number(require(\"fs\").readFileSync(0, \"utf8\").trim());", "  await Promise.all(Array.from({ length: k }, () => add()));",
      "  console.log(count === k ? \"ok\" : \"lost\");", "}", "main();"].join("\n"),
    must: [{ pattern: "gate\\.run\\(\\s*async\\s*\\(\\s*\\)\\s*=>\\s*\\{[^}]*=\\s*count\\b[^}]*\\bcount\\s*=", why: "count를 읽는 줄과 쓰는 줄이 둘 다 gate.run(async () => { }) 안에 있어야 해요." }],
    alsoRight: [],
  },
  python: {
    setup: ["import sys, threading, time", "gate = threading.Lock()", "count = 0", "def add():", "    global count"].join("\n"),
    template: "    cur = count\n    time.sleep(0.02)\n    count = cur + 1",
    reference: "    with gate:\n        cur = count\n        time.sleep(0.02)\n        count = cur + 1",
    other: "    cur = count\n    time.sleep(0.02)\n    with gate:\n        count = cur + 1",
    after: ["k = int(sys.stdin.readline())", "ts = [threading.Thread(target=add) for _ in range(k)]", "for t in ts: t.start()", "for t in ts: t.join()", "print(\"ok\" if count == k else \"lost\")"].join("\n"),
    must: [{ pattern: "with\\s+gate\\s*:\\s*\\n(\\s+)cur\\s*=\\s*count[\\s\\S]*\\n\\1count\\s*=", why: "count를 읽는 줄과 쓰는 줄이 둘 다 with gate: 안에 있어야 해요." }],
    alsoRight: [],
  },
};
export const lockLangs = Object.keys(BANK);
/** 잠금(lock · mutex · Lock) 빈틈인가: 순서 · 동시성이거나, 문법 빈틈의 알맹이 · 주제가 잠금 */
export function isLockGap(gap: Pick<Gap, "kind" | "topic" | "kernel" | "title">) {
  const t = `${gap.topic} ${gap.kernel.code} ${gap.title}`;
  return (gap.kind === "순서 · 동시성" || gap.kind === "문법") && /\block\b|mutex|잠금|threading\.Lock|gate\.run|Interlocked/i.test(t);
}
export function lockWriteScene(gap: Gap, id: string): Scene | null {
  const b = BANK[gap.origin.lang];
  if (!b || !isLockGap(gap)) return null;
  const form = gap.target === "form";
  return { id, gapId: gap.id, format: "write", lang: gap.origin.lang, distance: gap.state.distance, target: gap.target,
    story: "여러 스레드(요청)가 같은 카운터 count를 동시에 1씩 올려요. 읽기와 쓰기 사이에 일부러 쉬어서, 잠금이 없으면 늘 어긋나요. 입력은 동시에 올리는 수, 출력 ok는 count가 맞다는 뜻이에요.",
    ask: form ? "count를 올리는 줄들을 잠금(gate)으로 감싸 보세요." : "count가 맞게 올라가도록 고쳐 보세요.",
    explain: "읽기부터 쓰기까지를 한 잠금 안에 넣어야 다른 스레드가 그 사이에 끼어들지 못해요.",
    setup: b.setup, after: b.after, template: b.template, reference: b.reference, alsoRight: form ? [] : b.alsoRight,
    wrongs: [{ id: "mine", what: "잠금 없이 읽고 씀", code: b.template }, { id: "write-only", what: "쓰기 줄에만 잠금", code: b.other }],
    inputs: ["1", "2", "3", "5"].map((stdin) => ({ role: "basic" as const, stdin })),
    ...(form ? { structure: { must: b.must } } : {}), createdAt: new Date().toISOString(), madeBy: "bank" };
}
/** 바닥이 돌리는 구조 검사와 같은 규칙(시험 · 미리 보기용) */
export const structureOk = (s: Pick<Scene, "structure">, answer: string) => (s.structure?.must ?? []).every((m) => new RegExp(m.pattern).test(answer));
