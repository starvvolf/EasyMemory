import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
const assetRoot = path.join(process.cwd(), "tools/problem-authoring-lab/assets");

export async function GET(_request: Request, context: { params: Promise<{ asset: string[] }> }) {
  const { asset } = await context.params;
  let relative: string | null = null;
  let contentType = "application/octet-stream";
  if (asset.length === 2 && asset[0] === "katex" && asset[1] === "katex.min.css") {
    relative = "katex/katex.min.css";
    contentType = "text/css; charset=utf-8";
  } else if (asset.length === 3 && asset[0] === "katex" && asset[1] === "fonts" && /^KaTeX_[A-Za-z0-9-]+\.(woff2|woff|ttf)$/.test(asset[2])) {
    relative = `katex/fonts/${asset[2]}`;
    contentType = asset[2].endsWith(".woff2") ? "font/woff2" : asset[2].endsWith(".woff") ? "font/woff" : "font/ttf";
  } else if (asset.length === 3 && asset[0] === "fonts" && asset[1] === "pretendard-1.3.9" && asset[2] === "PretendardVariable.woff2") {
    relative = "fonts/pretendard-1.3.9/PretendardVariable.woff2";
    contentType = "font/woff2";
  }
  if (!relative) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(path.join(assetRoot, relative));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
