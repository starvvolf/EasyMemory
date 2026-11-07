// 카드에 그림 붙이기 (2026-11-08, cards.ts의 CardFigure): 카드가 다 나온 뒤 코드가 한 번에 잘라 둔다(AI 호출 없음).
//   카드 AI가 그림 위치를 줬으면 → 그 근처 그림 덩어리에 맞춰 자름(cropHints)
//   아니면 원문 인용이 있는 카드 → 인용 둘레에 그림이 있을 때만 자름(cropQuotes, 글만이면 안 자름)
// 같은 쪽·거의 같은 상자는 한 파일을 같이 쓴다. 잘린 그림은 study-gen/<id>/figures/<카드 id>.jpg.
import { cropHints, cropQuotes, frameOf } from "./quote-crop.ts";
import type { Card, CardFigure } from "./cards.ts";

export async function attachFigures(pdf: Uint8Array, pages: number[], cards: Card[], save: (name: string, jpeg: Buffer) => Promise<void>) {
  const t0 = Date.now();
  // 다시 자르기(코드를 고친 뒤): 인용으로 찾은 것은 지우고 다시, AI 위치는 그대로 두고 파일만 다시
  for (const c of cards) if (c.figure?.from === "quote") delete c.figure;
  const frame = await frameOf(pdf, pages);
  const done = new Map<string, { file: string; mode: "figure" | "block" }>();
  const keyOf = (page: number, box: number[]) => `${page}:${box.map((v) => Math.round(v / 4)).join(",")}`;
  let hinted = 0, quoted = 0;
  // 1) AI 위치가 있는 카드: 쪽마다 한 번 그린다
  const byPage = new Map<number, Card[]>();
  for (const c of cards) if (c.figure?.box) byPage.set(c.figure.page, [...(byPage.get(c.figure.page) ?? []), c]);
  for (const [page, list] of byPage) {
    const fresh = list.filter((c) => !done.has(keyOf(page, c.figure!.box)));
    const cut = fresh.length ? await cropHints(pdf, page, fresh.map((c) => c.figure!.box as [number, number, number, number]), { frame }) : [];
    const none = new Set<string>();
    for (const [i, c] of fresh.entries()) {
      const r = cut[i];
      if (!("image" in r) || !r.image) { none.add(keyOf(page, c.figure!.box)); continue; } // 힌트를 믿을 수 없음(쪽 전체·너무 가늚)
      const file = `${c.id.replace(/[^\w.-]/g, "_")}.jpg`;
      await save(file, Buffer.from(r.image.split(",")[1], "base64"));
      done.set(keyOf(page, c.figure!.box), { file, mode: r.mode === "block" ? "block" : "figure" });
    }
    for (const c of list) {
      const d = done.get(keyOf(page, c.figure!.box));
      if (!d) { delete c.figure; continue; }
      c.figure = { ...c.figure!, file: d.file, mode: d.mode, from: "hint" }; hinted++;
    }
  }
  // 2) 위치가 없고 인용이 있는 카드: 인용 둘레에 그림이 있을 때만
  const quotes = new Map<number, Array<{ card: Card; quote: string }>>();
  for (const c of cards) if (!c.figure && !c.title.startsWith("흐름: ")) for (const e of c.evidence) if (e.quote.trim()) { quotes.set(e.page, [...(quotes.get(e.page) ?? []), { card: c, quote: e.quote }]); break; }
  for (const [page, list] of quotes) {
    const res = await cropQuotes(pdf, page, list.map((x) => x.quote), { frame });
    for (const [i, r] of res.entries()) {
      if (!("image" in r) || !r.image || !r.box) continue;
      const box = r.box.map((v) => v * 100);
      const key = keyOf(page, box);
      let d = done.get(key);
      if (!d) { d = { file: `${list[i].card.id.replace(/[^\w.-]/g, "_")}.jpg`, mode: r.mode === "block" ? "block" : "figure" }; await save(d.file, Buffer.from(r.image.split(",")[1], "base64")); done.set(key, d); }
      const f: CardFigure = { page, box, role: "근거", says: "", file: d.file, mode: d.mode, from: "quote" };
      list[i].card.figure = f; quoted++;
    }
  }
  return { ms: Date.now() - t0, hinted, quoted, files: done.size };
}
