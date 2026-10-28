// 단계별 시작 상태 만들기. 기준 프로젝트 하나에 단 표식으로 "N단계를 시작할 때의 코드"를 만든다.
//
// 표식 (줄 하나에 주석으로만):
//   첫 줄 `// @from N`          이 파일은 N단계부터 있다.
//   `// <from N>` … `// </from>`   N단계부터 있는 줄.
//   `// <until N>` … `// </until>` N단계까지만 있는 줄.
//   `// <swap N>` 완성 코드 `// <start>` 시작 코드 `// </swap>`
//        N단계보다 뒤(또는 N단계를 푼 상태)면 완성 코드, N단계까지는 시작 코드.
//        N단계의 시작 코드가 곧 학습자가 고칠 곳(없애 본 상태·준비된 버그)이다.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Build = { stage: number; solved?: boolean };

const OPEN = /^\s*\/\/ <(from|until|swap) (\d+)>\s*$/;
const START = /^\s*\/\/ <start>\s*$/;
const CLOSE = /^\s*\/\/ <\/(from|until|swap)>\s*$/;
const FILE_FROM = /^\/\/ @from (\d+)\s*$/;

type Frame = { kind: string; n: number; on: boolean; inStart: boolean };

/** 한 파일을 단계에 맞게 바꾼다. 그 단계에 없는 파일이면 null. */
export function renderSource(text: string, build: Build, file = "?"): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const head = FILE_FROM.exec(lines[0] ?? "");
  if (head) {
    if (build.stage < Number(head[1])) return null;
    lines.shift();
  }
  const out: string[] = [];
  const stack: Frame[] = [];
  const final = (n: number) => build.stage > n || (!!build.solved && build.stage === n);
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    if ((m = OPEN.exec(line))) {
      const n = Number(m[2]);
      const on = m[1] === "from" ? build.stage >= n : m[1] === "until" ? build.stage <= n : final(n);
      stack.push({ kind: m[1], n, on, inStart: false });
      return;
    }
    if (START.test(line)) {
      const top = stack.at(-1);
      if (!top || top.kind !== "swap" || top.inStart) throw new Error(`${file}:${i + 1} <start>가 <swap> 밖에 있어요.`);
      top.inStart = true;
      top.on = !final(top.n);
      return;
    }
    if ((m = CLOSE.exec(line))) {
      const top = stack.pop();
      if (!top || top.kind !== m[1]) throw new Error(`${file}:${i + 1} 닫는 표식이 짝이 안 맞아요.`);
      return;
    }
    if (stack.every((f) => f.on)) out.push(line);
  });
  if (stack.length) throw new Error(`${file}: 닫히지 않은 표식이 있어요.`);
  return out.join("\n");
}

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, r)));
    else out.push(r);
  }
  return out;
}

const TEXT = /\.(ts|js|mjs|json|html|css|md|txt|http)$/;

/** 템플릿 폴더를 단계에 맞게 읽어 {상대 경로: 내용}으로. */
export async function renderTemplate(dir: string, build: Build) {
  const files = new Map<string, string>();
  for (const rel of await walk(dir)) {
    const raw = await readFile(path.join(dir, rel), "utf8");
    const text = TEXT.test(rel) ? renderSource(raw, build, rel) : raw;
    if (text !== null) files.set(rel, text);
  }
  return files;
}

export type TemplateSpec = { dir: string; base?: { dir: string; stage: number; drop: string[] } };

/** 단계의 템플릿 사양(기본 프로젝트 위에 덧씌우기)을 따라 파일 묶음을 만든다. */
export async function buildFiles(spec: TemplateSpec, build: Build) {
  const files = new Map<string, string>();
  if (spec.base) {
    for (const [rel, text] of await renderTemplate(spec.base.dir, { stage: spec.base.stage, solved: true })) {
      if (!spec.base.drop.includes(rel)) files.set(rel, text);
    }
  }
  for (const [rel, text] of await renderTemplate(spec.dir, build)) files.set(rel, text);
  return files;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/**
 * 작업 폴더에 파일 묶음을 쓴다. 학습자 파일은 지우기 전에 `.recaller/backup/<시각>/`에 남긴다.
 * data/ (학습자가 만든 개발용 DB)는 단계가 바뀌면 표 모양이 달라질 수 있어 함께 백업하고 비운다.
 */
export async function writeWorkspace(dir: string, files: Map<string, string>, extra: { typesFrom?: string } = {}) {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, ".recaller", "backup", stamp);
  let backedUp = false;
  for (const name of ["src", "public", "data", "package.json", "tsconfig.json", "README.md"]) {
    const p = path.join(dir, name);
    if (await exists(p)) {
      await mkdir(backup, { recursive: true });
      await cp(p, path.join(backup, name), { recursive: true });
      await rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      backedUp = true;
    }
  }
  for (const [rel, text] of files) {
    const p = path.join(dir, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, text.replace(/\r?\n/g, process.platform === "win32" ? "\r\n" : "\n"));
  }
  // VS Code가 node:http 등을 알아보게: 앱 쪽 node_modules의 @types/node를 복사(설치 없이).
  if (extra.typesFrom) {
    for (const pkg of ["@types/node", "undici-types"]) {
      const from = path.join(extra.typesFrom, pkg);
      const to = path.join(dir, "node_modules", pkg);
      if ((await exists(from)) && !(await exists(to))) await cp(from, to, { recursive: true });
    }
  }
  return { backup: backedUp ? backup : null };
}
