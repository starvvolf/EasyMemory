// 카드에 그림 붙이기 (2026-11-08, cards.ts의 CardFigure): 코드가 잘라 둔다(AI 호출 없음).
//   카드 AI가 그림 위치를 줬으면 → 그 근처 그림 덩어리에 맞춰 자름(근처에 그림이 없으면 안 자름)
//   아니면 원문 인용이 있는 카드 → 인용 둘레에 그림이 있을 때만 자름(글만이면 안 자름)
// 주제 카드가 나오는 대로 그 주제 것을 자른다(11/8: 맨 끝에 몰아 하던 것이 그래픽스 04에서 61초). PDF는 한 번 열고 쪽마다 한 번 그린다.
// 같은 쪽·거의 같은 상자는 한 파일을 같이 쓴다. 잘린 그림은 study-gen/<id>/figures/<카드 id>.jpg.
import { openCropper } from "./quote-crop.ts";
import type { Card } from "./cards.ts";

export function figureCropper(pdf: Uint8Array, pages: number[], save: (name: string, jpeg: Buffer) => Promise<void>) {
  const t0 = Date.now();
  const cropper = openCropper(pdf, pages);
  const done = new Map<string, { file: string; mode: "figure" | "block" }>();
  const keyOf = (page: number, box: number[]) => `${page}:${box.map((v) => Math.round(v / 4)).join(",")}`;
  const fileOf = (id: string) => `${id.replace(/[^\w.-]/g, "_")}.jpg`;
  let hinted = 0, quoted = 0, work: Promise<unknown> = Promise.resolve();
  const one = async (c: Card) => {
    const cr = await cropper;
    if (c.figure?.from === "quote") delete c.figure; // 다시 자르기: 인용으로 찾은 것은 새로
    if (c.figure?.box) {
      const r = await cr.hint(c.figure.page, c.figure.box);
      if (!r) { delete c.figure; return; } // 쪽 전체·너무 가늚·근처에 그림 없음
      const key = keyOf(c.figure.page, r.box);
      let d = done.get(key);
      if (!d) { d = { file: fileOf(c.id), mode: r.mode === "block" ? "block" : "figure" }; await save(d.file, r.jpeg); done.set(key, d); }
      c.figure = { ...c.figure, file: d.file, mode: d.mode, from: "hint" }; hinted++;
      return;
    }
    if (c.title.startsWith("흐름: ")) return;
    const e = c.evidence.find((x) => x.quote.trim());
    if (!e) return;
    const r = await cr.quote(e.page, e.quote);
    if (!r) return;
    const key = keyOf(e.page, r.box);
    let d = done.get(key);
    if (!d) { d = { file: fileOf(c.id), mode: r.mode === "block" ? "block" : "figure" }; await save(d.file, r.jpeg); done.set(key, d); }
    c.figure = { page: e.page, box: r.box, role: "근거", says: "", file: d.file, mode: d.mode, from: "quote" }; quoted++;
  };
  // 그림 둘째부터(11/13): 위치를 준 것만 같은 방법으로 자른다. 못 자른 것·첫 그림과 같은 파일은 뺀다.
  const more = async (c: Card) => {
    if (!c.moreFigures?.length) return;
    const cr = await cropper, kept: NonNullable<Card["moreFigures"]> = [];
    for (const [i, f] of c.moreFigures.entries()) {
      if (!f.box) continue;
      try {
        const r = await cr.hint(f.page, f.box);
        if (!r) continue;
        const key = keyOf(f.page, r.box);
        let d = done.get(key);
        if (!d) { d = { file: fileOf(`${c.id}_${i + 2}`), mode: r.mode === "block" ? "block" : "figure" }; await save(d.file, r.jpeg); done.set(key, d); }
        if (d.file === c.figure?.file || kept.some((k) => k.file === d!.file)) continue;
        kept.push({ ...f, file: d.file, mode: d.mode, from: "hint" }); hinted++;
      } catch { /* 이 그림만 뺀다 */ }
    }
    if (kept.length) c.moreFigures = kept; else delete c.moreFigures;
  };
  return {
    /** 카드 몇 장(한 주제)을 자르는 일을 줄 세운다. 실패한 카드는 그림 없이 둔다. */
    add(cards: Card[]) { const run = work.then(async () => { for (const c of cards) { try { await one(c); } catch { delete c.figure; } await more(c); } }); work = run.catch(() => undefined); return run; },
    async finish() { await work; await (await cropper).close(); return { ms: Date.now() - t0, hinted, quoted, files: done.size }; },
  };
}

/** 한 번에 (다시 자르기) */
export async function attachFigures(pdf: Uint8Array, pages: number[], cards: Card[], save: (name: string, jpeg: Buffer) => Promise<void>) {
  const f = figureCropper(pdf, pages, save);
  await f.add(cards);
  return f.finish();
}
