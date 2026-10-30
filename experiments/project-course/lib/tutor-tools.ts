// 튜터 도구 2개 (2026-10-30, 사용자 "45까지 해봐": GPT 앱처럼 에이전트 넓히기 4·5번)
// - runSnippet: 작은 코드 조각을 따로 떼어 돌려 본다("이 줄만 돌려 보기"). 학습자 파일·폴더는 못 본다.
// - lookDocs: 공식 문서만 찾아본다(MDN·Node.js + 허용한 몇 곳). 아무 블로그나 보면 틀린 걸 가르칠 수 있어서.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA } from "./store.ts";

/* ---------- 코드 조각 실행 ---------- */
export type SnippetResult = { ok: boolean; output: string; ms: number; timedOut: boolean; code: string };

/** 마지막 줄이 값(식)이면 console.log로 감싼다: `String(5)`만 적어도 결과가 보이게 */
export function printLast(code: string) {
  if (/console\.\w+\s*\(/.test(code)) return code;
  const lines = code.replace(/\s+$/, "").split("\n");
  // 한 줄에 여러 문장이면 마지막 문장만 본다: `const a = 1; a + 1`
  const lastLine = lines.at(-1) ?? "";
  const cut = lastLine.replace(/;\s*$/, "").lastIndexOf(";");
  if (cut >= 0 && !/["'`]/.test(lastLine.slice(cut))) { lines[lines.length - 1] = lastLine.slice(0, cut + 1); lines.push(lastLine.slice(cut + 1).trim()); }
  const i = lines.length - 1;
  const last = lines[i]?.trim() ?? "";
  if (!last || /^(const|let|var|function|class|if|for|while|do|return|import|export|type|interface|throw|try|switch|\}|\/\/)/.test(last) || /[{}]$/.test(last) || /^\w+\s*=[^=]/.test(last)) return code;
  lines[i] = lines[i].replace(last, `console.log(${last.replace(/;$/, "")});`);
  return lines.join("\n");
}

/** 오류는 학습자에게 필요한 줄만: Node 안쪽 코드 조각과 "at node:..." 줄을 뺀다 */
export function tidyError(text: string) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^(node:|<anonymous_script>|snippet\.ts:)/.test(l));
  const err = lines.findIndex((l) => /^\w*(Error|Exception)\b.*:/.test(l));
  const body = start >= 0 && err > start ? [...lines.slice(0, start), ...lines.slice(err)] : lines;
  return body.filter((l) => !/^\s+at (?!.*snippet\.ts)/.test(l) && !/^Node\.js v\d/.test(l)).join("\n").trim();
}

const nodeMajor = () => Number(process.versions.node.split(".")[0]);

export async function runSnippet(code: string, timeoutMs = 4000): Promise<SnippetResult> {
  const src = printLast(String(code).slice(0, 4000));
  const base = path.join(DATA, "snippets");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, "s-"));
  const file = path.join(dir, "snippet.ts");
  await writeFile(file, src);
  // 권한 모드: 이 파일만 읽을 수 있고, 다른 파일 쓰기·하위 프로세스·워커는 막힌다
  const args = [
    ...(nodeMajor() >= 23 ? ["--permission"] : ["--experimental-permission"]),
    `--allow-fs-read=${file}`,
    ...(nodeMajor() < 24 ? ["--experimental-strip-types"] : []),
    "--disable-warning=ExperimentalWarning", "--max-old-space-size=64", file,
  ];
  const t0 = Date.now();
  const out = await new Promise<{ ok: boolean; text: string; timedOut: boolean }>((resolve) => {
    execFile(process.execPath, args, { cwd: dir, timeout: timeoutMs, maxBuffer: 64 * 1024, env: { NODE_NO_WARNINGS: "1" }, windowsHide: true }, (err, stdout, stderr) => {
      const timedOut = !!err && ((err as { killed?: boolean }).killed === true || (err as { signal?: string }).signal === "SIGTERM");
      const text = `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;
      resolve({ ok: !err, text, timedOut });
    });
  });
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  // 임시 경로는 학습자에게 의미가 없으니 지운다
  const clean = tidyError(out.text.split(file).join("snippet.ts").split(dir).join(".").replace(/\r\n/g, "\n").replace(/file:\/\/snippet\.ts/g, "snippet.ts"));
  const output = out.timedOut ? `${clean}\n(${timeoutMs / 1000}초 안에 끝나지 않아서 멈췄어요)`.trim() : clean;
  return { ok: out.ok, output: output.length > 3000 ? `${output.slice(0, 3000)}\n…(더 있음)` : output || "(출력 없음)", ms: Date.now() - t0, timedOut: out.timedOut, code: src };
}

/* ---------- 공식 문서 ---------- */
export const DOC_HOSTS = ["developer.mozilla.org", "nodejs.org", "www.typescriptlang.org", "redis.io", "kafka.apache.org", "sqlite.org", "www.sqlite.org"];
const MDN = () => (process.env.PC_DOCS_MDN || "https://developer.mozilla.org").replace(/\/$/, "");
const NODE = () => (process.env.PC_DOCS_NODE || "https://nodejs.org").replace(/\/$/, "");
const NODE_MODULES = ["fs", "http", "https", "crypto", "path", "url", "buffer", "events", "timers", "process", "console", "stream", "util", "os", "child_process", "querystring", "net", "sqlite", "zlib", "assert", "test", "readline", "worker_threads"];

export type DocResult = { ok: boolean; site: string; title: string; url: string; text: string; others: Array<{ title: string; url: string }> };

export function htmlText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|li|h\d|pre|tr|dt|dd)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const cache = new Map<string, DocResult>();
async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** Node 문서: "fs.readFile", "crypto.scryptSync", "scryptSync" → 그 모듈 JSON에서 이름으로 찾는다 */
async function nodeDoc(query: string): Promise<DocResult | null> {
  const q = query.trim().replace(/\(\)$/, "");
  const [head, ...rest] = q.split(".");
  const name = rest.length ? rest.join(".") : head;
  const mods = NODE_MODULES.includes(head) ? [head] : ["crypto", "fs", "http", "buffer", "path", "url", "process", "util", "sqlite"];
  for (const mod of mods.slice(0, 4)) {
    const json = await getJson(`${NODE()}/docs/latest/api/${mod}.json`).catch(() => null);
    if (!json) continue;
    let hit: any = null;
    const walk = (n: any) => {
      if (hit || !n || typeof n !== "object") return;
      if (typeof n.name === "string" && (n.name === name || n.name === `${head}.${name}` || n.textRaw?.startsWith?.(`${mod}.${name}(`) || n.textRaw?.startsWith?.(`\`${mod}.${name}(`))) { hit = n; return; }
      for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v);
    };
    walk(json);
    if (hit) {
      const title = String(hit.textRaw ?? hit.name).replace(/`/g, "");
      // Node 문서 주소의 # 부분: 글자·숫자·빈칸만 남기고 빈칸을 -로 ("crypto.scryptSync(password, salt…)" → "cryptoscryptsyncpassword-salt…")
      const anchor = String(hit.textRaw ?? hit.name).toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
      return { ok: true, site: "Node.js", title, url: `https://nodejs.org/docs/latest/api/${mod}.html#${anchor}`, text: htmlText(String(hit.desc ?? "")).slice(0, 3500), others: [] };
    }
    if (NODE_MODULES.includes(head)) break;
  }
  return null;
}

async function mdnDoc(query: string): Promise<DocResult | null> {
  const s = await getJson(`${MDN()}/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US&size=4`);
  const docs: Array<{ mdn_url: string; title: string }> = s?.documents ?? [];
  if (!docs.length) return null;
  const top = docs[0];
  const page = await getJson(`${MDN()}${top.mdn_url}/index.json`).catch(() => null);
  const body: any[] = page?.doc?.body ?? [];
  const text = body.filter((b) => b?.type === "prose").slice(0, 4)
    .map((b) => `${b.value?.title ? `## ${b.value.title}\n` : ""}${htmlText(String(b.value?.content ?? ""))}`).join("\n\n");
  return { ok: true, site: "MDN", title: top.title, url: `https://developer.mozilla.org${top.mdn_url}`, text: (text || htmlText(String(page?.doc?.summary ?? ""))).slice(0, 3500),
    others: docs.slice(1).map((d) => ({ title: d.title, url: `https://developer.mozilla.org${d.mdn_url}` })) };
}

/** 허용한 곳의 문서 주소 하나를 글로 읽는다 */
async function urlDoc(url: string): Promise<DocResult> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("주소가 올바르지 않아요."); }
  if (u.protocol !== "https:" || !DOC_HOSTS.includes(u.hostname)) throw new Error(`공식 문서(${DOC_HOSTS.join(", ")})만 볼 수 있어요.`);
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`문서를 열지 못했어요 (${r.status})`);
  const html = await r.text();
  const title = htmlText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? u.pathname);
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  return { ok: true, site: u.hostname, title, url: u.href, text: htmlText(main).slice(0, 3500), others: [] };
}

export const looksNode = (q: string) => /^(fs|http|https|crypto|path|url|buffer|process|stream|util|os|child_process|sqlite|events|zlib)\b/.test(q) || /Sync$|^(createServer|randomBytes|scrypt|timingSafeEqual|DatabaseSync|readFile|writeFile)/.test(q);

export async function lookDocs(input: { query?: string; site?: string; url?: string }): Promise<DocResult> {
  const key = JSON.stringify(input);
  const hit = cache.get(key); if (hit) return hit;
  let out: DocResult | null = null;
  if (input.url) out = await urlDoc(input.url);
  else {
    const q = String(input.query ?? "").trim().slice(0, 120);
    if (!q) throw new Error("무엇을 찾을지(query) 적어 주세요.");
    const site = input.site === "node" || input.site === "mdn" ? input.site : looksNode(q) ? "node" : "mdn";
    out = site === "node" ? (await nodeDoc(q)) ?? (await mdnDoc(q)) : (await mdnDoc(q)) ?? (await nodeDoc(q));
    if (!out) out = { ok: false, site, title: q, url: "", text: "공식 문서에서 찾지 못했어요.", others: [] };
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}
