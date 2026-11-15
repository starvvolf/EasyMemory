// 붙여 넣은 글 → 자료 (11/15 사용자 "그냥 글 되는지 … 입력창 하나 만들고"): POST {title, text, note?, lecture?}
// 글을 쪽으로 나눠 글 자료(txt_)로 두고 PDF와 같은 길(줄기 → 기억 채우기)로 기억을 만든다. 같은 글이면 그 자료를 다시 연다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard } from "@/lib/assist/http";
import { saveTextSource } from "@/lib/study/text-sources";

export const runtime = "nodejs";
const input = z.object({ title: z.string().max(200).default(""), text: z.string().min(20, "글이 너무 짧아요(20자 이상).").max(300_000, "글이 너무 길어요(30만 자까지)."),
  note: z.string().max(2000).default(""), lecture: z.boolean().optional() });

export async function POST(request: Request) {
  try {
    await guard(request);
    const b = input.parse(await boundedJson(request));
    const title = b.title.trim() || b.text.trim().split("\n")[0].slice(0, 40) || "붙여 넣은 글";
    const source = await saveTextSource({ title, kind: "text", text: b.text });
    const { createGen, enqueueGen, listGens } = await import("@/lib/study/gen/runner");
    const same = (await listGens()).find((g) => g.input.sourceId === source.id && g.status !== "failed");
    if (same) {
      if (same.status !== "done") await enqueueGen(same.id, { uid: "local-experiment" }, { confirmedRealCalls: true }).catch(() => undefined);
      return NextResponse.json({ gen: { id: same.id }, pages: Object.keys(source.pages).length, again: true });
    }
    const pages = Object.keys(source.pages).map(Number).sort((x, y) => x - y);
    const gen = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: pages.length ? pages : [1], note: b.note, origin: "study", ...(b.lecture ? { lecture: true } : {}) });
    await enqueueGen(gen.id, { uid: "local-experiment" }, { confirmedRealCalls: true });
    return NextResponse.json({ gen: { id: gen.id }, pages: pages.length, again: false });
  } catch (error) { return fail(error); }
}
