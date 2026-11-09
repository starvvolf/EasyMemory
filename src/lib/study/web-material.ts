// 웹 글 → 자료 (11/9 사용자 "자료로 합쳐", "글인데 이미지 포함 선택하는 경우만 [페이지를 PDF로] 그렇게 가자").
// 글만: 저장한 웹 글(knowledge/sources, 확장 프로그램이 읽어 둔 본문)을 깔끔한 HTML로 만들고 Recaller 앱(desktop/main.js의
// 인쇄 창)이 PDF로 인쇄한다. 그 PDF를 강의 PDF처럼 자료 만들기에 넣는다(목차·카드·구조·출제가 그대로). 인터넷에 나가지 않는다.
// 이미지 포함: 확장 프로그램이 그 페이지를 PDF로 뽑는다(확장, B 영역 — 아직).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSource, listSources } from "../knowledge/sources.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
/** 저장한 본문은 줄 단위다. 짧고 문장부호로 끝나지 않는 줄은 소제목으로 본다(위키 "개요", "투자지표"). */
export function isHeading(line: string) {
  const t = line.trim();
  return t.length > 0 && t.length <= 30 && !/[.。!?:;,)\]」』"”'’]$/.test(t) && !/^[-•*·\d]+[.)]?\s/.test(t) && !/\d{2,}/.test(t);
}
export function articleHtml(s: { title: string; url: string; text: string; readAt?: string }) {
  const body: string[] = [];
  const lines = s.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    if (raw === s.title.trim()) continue;
    // 위키 원문 표기 "== 개요 ==", "=== 채권 ETF ===" 는 소제목(= 수가 많을수록 아래 단계)
    const wiki = /^(={2,})\s*(.+?)\s*\1$/.exec(raw);
    if (wiki) { body.push(wiki[1].length > 2 ? `<h3>${esc(wiki[2])}</h3>` : `<h2>${esc(wiki[2])}</h2>`); continue; }
    const l = raw;
    if (isHeading(l)) body.push(`<h2>${esc(l)}</h2>`);
    else if (/^[-•*·]\s/.test(l)) body.push(`<p class="li">${esc(l)}</p>`);
    else body.push(`<p>${esc(l)}</p>`);
  }
  const host = (() => { try { return new URL(s.url).host; } catch { return ""; } })();
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(s.title)}</title><style>
@page{size:A4;margin:18mm 16mm}
body{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:11pt;line-height:1.65;color:#111}
h1{font-size:18pt;margin:0 0 4pt}
.src{color:#666;font-size:9pt;margin:0 0 14pt;word-break:break-all}
h2{font-size:13pt;margin:16pt 0 6pt;break-after:avoid}
h3{font-size:11.5pt;margin:12pt 0 4pt;break-after:avoid}
p{margin:0 0 7pt;word-break:keep-all;overflow-wrap:anywhere}
p.li{margin-left:10pt}
</style></head><body><h1>${esc(s.title)}</h1><p class="src">${esc(host ? `${host} · ` : "")}${esc(s.url)}${s.readAt ? ` · 읽은 날 ${esc(s.readAt.slice(0, 10))}` : ""}</p>
${body.join("\n")}
</body></html>`;
}

/** Recaller 앱의 인쇄 창으로 PDF를 만든다. 앱(Electron) 없이 서버만 켠 때는 안 된다. */
export async function printPdf(html: string): Promise<Uint8Array> {
  let conf: { port: number; token: string };
  try { conf = JSON.parse(await readFile(path.join(process.cwd(), "tmp", "print-port"), "utf8")); }
  catch { throw Object.assign(new Error("글을 PDF로 바꾸는 것은 Recaller 앱에서만 돼요(앱을 껐다 켜 주세요)."), { status: 409 }); }
  const r = await fetch(`http://127.0.0.1:${conf.port}/pdf`, { method: "POST", headers: { "x-print-token": conf.token, "content-type": "text/html; charset=utf-8" }, body: html, signal: AbortSignal.timeout(60_000) })
    .catch(() => { throw Object.assign(new Error("Recaller 앱의 인쇄 창에 닿지 못했어요(앱을 껐다 켜 주세요)."), { status: 409 }); });
  if (!r.ok) throw Object.assign(new Error(`PDF로 바꾸지 못했어요: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  return new Uint8Array(await r.arrayBuffer());
}

export async function webSources() {
  return (await listSources()).filter((s) => s.kind === "web").map((s) => ({ id: s.id, title: s.title, url: s.url, readAt: s.readAt }))
    .sort((a, b) => (b.readAt ?? "").localeCompare(a.readAt ?? ""));
}
export async function webSourcePdf(id: string) {
  const s = await getSource(id);
  if (!s || s.kind !== "web") throw Object.assign(new Error("그 웹 글을 찾지 못했어요."), { status: 404 });
  if (!s.text.trim()) throw Object.assign(new Error("이 웹 글은 본문이 비어 있어요."), { status: 422 });
  const pdf = await printPdf(articleHtml(s));
  const name = `${s.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 80) || "웹 글"}.pdf`;
  return { pdf, name };
}
