import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { link, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RegisteredMcpSource = {
  id: string;
  fileName: string;
  pageCount: number;
  sha256: string;
  createdAt: string;
};

export class McpSourceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const legacyMcpSources = {
  "geometric-transformations": { pageCount: 32, sha256: "73beb50cced41ee5da481f375fc21dff3b40d12054743767d6ad334d88fb7dca", fileName: "02_Geometric Transformations.pdf" },
  semiconductor: { pageCount: 44, sha256: "bfa671735178c61957ce5d78edd1746a4c585bdde2907d9b4c35f16483705254", fileName: "ilovepdf_merged.pdf" },
} as const;

export async function resolveMcpSource(id: string): Promise<{ id: string; fileName: string; pageCount: number; sha256: string } | null> {
  const legacy = legacyMcpSources[id as keyof typeof legacyMcpSources];
  if (legacy) {
    try {
      const bytes = await readFile(/* turbopackIgnore: true */ path.join(os.homedir(), "OneDrive", "바탕 화면", "예외폴", legacy.fileName));
      if (createHash("sha256").update(bytes).digest("hex") !== legacy.sha256) return null;
      return { id, ...legacy };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return getRegisteredMcpSource(id);
}

const maxPdfBytes = 50 * 1024 * 1024;
const sourceIdPattern = /^src_[a-f0-9]{64}$/;

function root() {
  return path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "mcp-sources");
}

function paths(id: string) {
  if (!sourceIdPattern.test(id)) throw new Error("잘못된 자료 ID입니다.");
  return { metadata: path.join(root(), `${id}.json`), pdf: path.join(root(), `${id}.pdf`) };
}

function isPdf(bytes: Uint8Array) {
  return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
}

async function actualPageCount(bytes: Uint8Array): Promise<number> {
  // PDF.js' fake-worker import is rewritten to a non-existent chunk by the Next
  // server bundler. Run the existing parser in an isolated Node process instead.
  const script = path.join(process.cwd(), "tools", "study-forge-mcp", "pdf-page-count.mjs");
  const child = spawn(/* turbopackIgnore: true */ process.execPath, [script], {
    cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk.slice(0, 16); });
  child.stdin.on("error", () => { /* A rejected PDF may close stdin before all bytes are sent. */ });
  child.stdin.end(Buffer.from(bytes));
  const timer = setTimeout(() => child.kill(), 30_000);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  const count = Number(output);
  if (exitCode !== 0 || !Number.isInteger(count) || count < 1 || count > 500) {
    throw new McpSourceError(400, "PDF 내용을 읽을 수 없거나 500쪽을 초과합니다.");
  }
  return count;
}

export async function registerMcpSource(fileName: string, bytes: Uint8Array): Promise<RegisteredMcpSource> {
  const cleanName = path.basename(fileName.trim());
  if (!cleanName || cleanName !== fileName.trim() || !/\.pdf$/i.test(cleanName) || cleanName.length > 255) {
    throw new McpSourceError(400, "PDF 파일명이 올바르지 않습니다.");
  }
  if (!isPdf(bytes) || bytes.length > maxPdfBytes) throw new McpSourceError(bytes.length > maxPdfBytes ? 413 : 400, "올바른 50MB 이하 PDF가 필요합니다.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = `src_${sha256}`;
  const existing = await getRegisteredMcpSource(id);
  if (existing) return existing;
  const pageCount = await actualPageCount(bytes);
  const source: RegisteredMcpSource = { id, fileName: cleanName, pageCount, sha256, createdAt: new Date().toISOString() };
  await mkdir(root(), { recursive: true });
  const target = paths(id);
  try {
    await writeFile(target.pdf, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const temporary = path.join(root(), `${id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(source), { flag: "wx" });
    try { await link(temporary, target.metadata); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true });
  }
  const verified = await getRegisteredMcpSource(id);
  if (!verified) throw new McpSourceError(409, "등록 저장소의 PDF를 검증하지 못했습니다. 기존 파일은 변경하지 않았습니다.");
  return verified;
}

export async function getRegisteredMcpSource(id: string): Promise<RegisteredMcpSource | null> {
  if (!sourceIdPattern.test(id)) return null;
  try {
    const source = JSON.parse(await readFile(/* turbopackIgnore: true */ paths(id).metadata, "utf8")) as RegisteredMcpSource;
    if (source.id !== id || source.sha256 !== id.slice(4) || !Number.isInteger(source.pageCount) || source.pageCount < 1) return null;
    const bytes = await readFile(/* turbopackIgnore: true */ paths(id).pdf);
    if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) return null;
    return source;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readRegisteredMcpSourcePdf(id: string): Promise<Uint8Array | null> {
  const source = await getRegisteredMcpSource(id);
  if (!source) return null;
  const bytes = await readFile(/* turbopackIgnore: true */ paths(id).pdf);
  return createHash("sha256").update(bytes).digest("hex") === source.sha256 ? bytes : null;
}

export async function listRegisteredMcpSources(): Promise<RegisteredMcpSource[]> {
  try {
    const names = (await readdir(root())).filter((name) => /^src_[a-f0-9]{64}\.json$/.test(name));
    const sources = await Promise.all(names.map((name) => getRegisteredMcpSource(name.slice(0, -5))));
    return sources.filter((source): source is RegisteredMcpSource => source !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
