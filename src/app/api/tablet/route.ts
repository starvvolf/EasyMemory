// 태블릿 모드 (scripts/tablet-proxy.mjs): the computer makes a 6-digit pairing code and shows the address to open.
// Loopback only; the tablet gate never forwards this path.
import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { isLocalExperimentRequest, isSameOriginExperimentMutation } from "@/lib/local-experiment-mode";

const PORT = 3001;
const dir = () => path.join(process.cwd(), ".study-forge-data", "tablet");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function readJson<T>(name: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path.join(dir(), name), "utf8")) as T; } catch { return fallback; }
}
async function writeJson(name: string, value: unknown) {
  await mkdir(dir(), { recursive: true });
  const file = path.join(dir(), name), tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 1)); await rename(tmp, file);
}
/** Home-network addresses of this computer, most likely first (Wi-Fi/LAN 192.168.x before others). */
function addresses() {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const net of list ?? []) {
    if (net.family !== "IPv4" || net.internal) continue;
    if (/^(192\.168|10)\./.test(net.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(net.address)) out.push(net.address);
  }
  return out.sort((a, b) => Number(!a.startsWith("192.168")) - Number(!b.startsWith("192.168"))).map((ip) => `http://${ip}:${PORT}`);
}
const guard = (request: Request) => isLocalExperimentRequest(request) && isSameOriginExperimentMutation(request);
const deny = () => NextResponse.json({ message: "컴퓨터에서만 할 수 있어요." }, { status: 403 });

export async function GET(request: Request) {
  if (!guard(request)) return deny();
  const devices = await readJson<Array<{ name: string; at: string }>>("devices.json", []);
  return NextResponse.json({ urls: addresses(), devices: devices.map(({ name, at }) => ({ name, at })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!guard(request)) return deny();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = Date.now() + 10 * 60_000;
  await writeJson("code.json", { hash: hash(code), expires, tries: 0 });
  return NextResponse.json({ code, expires, urls: addresses() });
}

export async function DELETE(request: Request) {
  if (!guard(request)) return deny();
  await writeJson("devices.json", []);
  await writeJson("code.json", { hash: "", expires: 0, tries: 0 });
  return NextResponse.json({ ok: true });
}
