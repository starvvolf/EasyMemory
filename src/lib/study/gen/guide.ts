// Reads the editable criteria folder (출제기준/, see its README) for the design and author calls.
// Only rule lines ("- [ID] …") of the chosen sections go to the model; headings and notes stay for people.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { purposeLabel, type ObjectiveKind, type Purpose } from "./types.ts";

export const DEFAULT_GUIDE_DIR = "출제기준";
/** The main folder or a candidate copy beside it (출제기준-후보) for before/after comparison. */
export const guideDirPattern = /^출제기준(-[0-9A-Za-z가-힣_]{1,30})?$/;
/** Per-call size budget (characters of rule text); the README asks editors to merge before growing past it. */
export const GUIDE_BUDGET = { design: 3000, author: 6000 } as const;

export type LoadedGuide = { dir: string; files: string[]; version: string; text: string };

const root = () => process.env.STUDY_FORGE_GUIDE_ROOT?.trim() || process.cwd();

async function read(dir: string, file: string) {
  try { return await readFile(path.join(root(), dir, ...file.split("/")), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`출제기준 파일이 없습니다: ${dir}/${file}`);
    throw error;
  }
}

/** Rule lines of the whole file, or of the named `## ` sections only. A named section that is missing is an error. */
export function ruleLines(markdown: string, sections?: string[], where = "") {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (!sections) return lines.filter((line) => /^- \[[^\]]+\]/.test(line));
  const out: string[] = [];
  for (const name of sections) {
    const start = lines.findIndex((line) => line.trim() === `## ${name}`);
    if (start < 0) throw new Error(`출제기준 ${where}에 '## ${name}' 절이 없습니다.`);
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("## ")) break;
      if (/^- \[[^\]]+\]/.test(line)) out.push(line);
    }
  }
  return out;
}

export async function loadGuide(step: "design" | "author", options: { purpose: Purpose; kinds?: readonly ObjectiveKind[]; dir?: string }): Promise<LoadedGuide> {
  const dir = options.dir ?? DEFAULT_GUIDE_DIR;
  if (!guideDirPattern.test(dir)) throw new Error("출제기준 폴더 이름이 올바르지 않습니다.");
  if (options.purpose === "read") throw new Error("그냥 읽기는 출제기준을 쓰지 않습니다.");
  const purpose = `목적: ${purposeLabel[options.purpose]}`;
  const parts: Array<{ title: string; file: string; sections?: string[] }> = step === "design"
    ? [
        { title: "공통", file: "공통.md" },
        { title: "목표 설계", file: "목표설계.md", sections: ["원칙", purpose] },
      ]
    : [
        { title: "공통", file: "공통.md" },
        { title: "출제 원칙", file: "출제/원칙.md" },
        { title: "형식별", file: "출제/형식.md" },
        { title: "이번 목적", file: "출제/목적.md", sections: [purpose] },
        { title: "목표 종류별", file: "출제/종류.md", sections: [...new Set(options.kinds ?? [])].map((kind) => `종류: ${kind}`) },
        { title: "좋은 예", file: "예시/좋은예.md" },
        { title: "나쁜 예", file: "예시/나쁜예.md" },
      ];
  const blocks: string[] = [];
  for (const part of parts) {
    if (part.sections && !part.sections.length) continue;
    let rules: string[];
    try { rules = ruleLines(await read(dir, part.file), part.sections, `${dir}/${part.file}`); }
    catch (error) {
      // A kind without its own section just gets no extra rules; every other gap is a broken folder.
      if (part.file !== "출제/종류.md" || !/절이 없습니다/.test(String(error))) throw error;
      const markdown = await read(dir, part.file);
      rules = part.sections!.flatMap((name) => { try { return ruleLines(markdown, [name]); } catch { return []; } });
    }
    if (rules.length) blocks.push(`[${part.title}]\n${rules.join("\n")}`);
  }
  const text = blocks.join("\n\n");
  return { dir, files: parts.map((part) => part.file), version: createHash("sha256").update(text).digest("hex").slice(0, 12), text };
}
