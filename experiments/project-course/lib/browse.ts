// 튜터 브라우저 도구 look_page(11/8 결정 8 "브라우저 오케이" + 사용자 결정 "웹 글을 주소로 가져오는 기능은 만들지 않는다"):
// 학습자가 만든 웹 페이지(내 컴퓨터 안 localhost)만 연다. 앱(3000) · 코스 서버(4100) 같은 Recaller 자신의 주소는 막는다.
// 새로 깔 것 없이 앱 데스크톱 폴더의 Electron을 빌려 보이지 않는 창으로 연다(browse/main.cjs). 두 엔진 공통(GOAL_TOOLS 길).
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { electronPath } from "./float.ts";
import { DATA } from "./store.ts";
import { ROOT } from "./course.ts";

export const BROWSE_TOOL = {
  name: "look_page",
  description: "학습자 컴퓨터에서 돌고 있는 웹 페이지(http://localhost:포트/… 또는 127.0.0.1)를 보이지 않는 브라우저로 열어 제목 · 응답 상태 · 화면 글 · 눌러 볼 것들(버튼 · 입력 칸 · 링크) · 콘솔 메시지(오류 포함)를 본다. 학습자가 만든 페이지가 실제로 어떻게 보이는지, 콘솔에 무슨 오류가 나는지 확인할 때 쓴다. 인터넷 주소는 열 수 없다. 서버가 안 켜져 있으면 먼저 run_command로 켜게 하거나 학습자에게 켜 달라고 한다. wait_ms는 연 뒤 기다릴 시간(기본 1200).",
  properties: { url: { type: "string" }, wait_ms: { type: "integer" } }, required: ["url", "wait_ms"],
} as const;

const OWN_PORTS = new Set(["3000", "3091", "4100", "4102"]);
/** 열어도 되는 주소인가: 내 컴퓨터 안 + Recaller 자신의 포트가 아님 */
export function allowedUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { return { ok: false, why: "주소 꼴이 아니에요(예: http://localhost:5173/)" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, why: "http(s) 주소만 열 수 있어요" };
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return { ok: false, why: "내 컴퓨터 안 주소(localhost · 127.0.0.1)만 열 수 있어요. 인터넷 페이지는 열지 않아요" };
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  if (OWN_PORTS.has(port)) return { ok: false, why: `${port}번은 Recaller 자신의 주소라 열지 않아요` };
  return { ok: true, url: u.href };
}

export async function lookPageTool(runId: string, input: Record<string, unknown>): Promise<string> {
  const a = allowedUrl(String(input.url ?? ""));
  if (!a.ok) return a.why;
  const exe = electronPath();
  if (!exe) return "이 컴퓨터에는 페이지를 열 브라우저(Recaller 앱의 Electron)가 없어요. 학습자에게 브라우저로 열어 보고 무엇이 보이는지 알려 달라고 하세요.";
  const dir = path.join(DATA, "browse"); await mkdir(dir, { recursive: true });
  const shot = path.join(dir, `${runId}-${Date.now()}.png`);
  const env: Record<string, string | undefined> = { ...process.env, PC_BROWSE_URL: a.url, PC_BROWSE_WAIT: String(Number(input.wait_ms) || 1200), PC_BROWSE_SHOT: shot };
  delete env.ELECTRON_RUN_AS_NODE;
  const out = await new Promise<string>((resolve) => {
    let s = "";
    const ch = spawn(exe, [path.join(ROOT, "browse", "main.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    ch.stdout.on("data", (b: Buffer) => { s += b.toString("utf8"); });
    const t = setTimeout(() => ch.kill(), 30_000);
    ch.on("close", () => { clearTimeout(t); resolve(s); });
    ch.on("error", (e) => { clearTimeout(t); resolve(JSON.stringify({ error: `브라우저를 띄우지 못했어요: ${e.message}` })); });
  });
  const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).at(-1);
  if (!line) return "브라우저가 답을 주지 않았어요.";
  const j = JSON.parse(line) as { error?: string; status?: number; title?: string; url?: string; text?: string; controls?: string[]; console?: string[] };
  if (j.error) return `${j.error}${j.console?.length ? `\n콘솔:\n${j.console.join("\n")}` : ""}`;
  return [`${j.url} — 응답 ${j.status ?? "?"} · 제목 "${j.title ?? ""}"`,
    `[화면 글]\n${(j.text ?? "").trim().slice(0, 3000) || "(글 없음)"}`,
    j.controls?.length ? `[눌러 볼 것]\n${j.controls.join("\n")}` : "",
    `[콘솔]\n${j.console?.length ? j.console.join("\n") : "(메시지 없음)"}`].filter(Boolean).join("\n\n");
}
