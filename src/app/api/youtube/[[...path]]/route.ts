// 유튜브 입구 (src/lib/youtube/ingest.ts):
//   POST /api/youtube            정리 패널(Tampermonkey)이 영상을 보낸다 → { genId, sourceId, open }
//   GET  /api/youtube/<sourceId>  [정리] 탭 · 원문 보기가 읽는 정리 글과 쪽
// 패널은 다른 출처(youtube.com의 확장)에서 오므로 proxy.ts가 X-Recaller-Client 머리글이 있을 때만 같은 출처 검사를 건너뛴다.
// 사용자 지정 머리글은 웹 페이지가 보내려면 사전 요청(CORS)을 거쳐야 하고 이 서버는 허락하지 않으니, 다른 사이트가 몰래 부를 수 없다.
import { NextResponse } from "next/server";
import { boundedJson, responseError } from "@/lib/http";
import { startYoutube, youtubeView } from "@/lib/youtube/ingest";

export const runtime = "nodejs";
type Context = { params: Promise<{ path?: string[] }> };

export async function POST(request: Request, context: Context) {
  try {
    if ((await context.params).path?.length) return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
    const body = await boundedJson(request);
    const result = await startYoutube(body, true);
    const origin = new URL(request.url).origin.replace("localhost", "127.0.0.1");
    return NextResponse.json({ ...result, open: `${origin}/study?gen=${result.genId}` });
  } catch (error) { return responseError(error); }
}
export async function GET(_request: Request, context: Context) {
  try {
    const [id] = (await context.params).path ?? [];
    const view = id ? await youtubeView(id) : null;
    if (!view) return NextResponse.json({ message: "유튜브 자료를 찾을 수 없어요." }, { status: 404 });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
