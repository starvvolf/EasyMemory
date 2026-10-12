import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GUIDE_BUDGET, loadGuide, ruleLines } from "./guide.ts";
import { objectiveKinds, type Purpose } from "./types.ts";

const purposes: Purpose[] = ["understand", "core", "all"];

test("학습 설계 기준은 공통·원칙과 고른 목적의 절만 담고 예산 안이다", async () => {
  for (const purpose of purposes) {
    const guide = await loadGuide("design", { purpose });
    assert.match(guide.text, /\[공통-1\]/);
    assert.match(guide.text, /\[설계-1\]/);
    const own = { understand: "목적-이해", core: "목적-핵심", all: "목적-통암기" }[purpose as "understand" | "core" | "all"];
    assert.match(guide.text, new RegExp(`\\[${own}-1\\]`));
    for (const other of ["목적-이해", "목적-핵심", "목적-통암기"].filter((name) => name !== own)) assert.ok(!guide.text.includes(`[${other}-`), `${purpose}에 ${other}가 섞임`);
    assert.ok(!/\[(출제|객관식|단답)-/.test(guide.text), "출제 규칙은 설계에 들어가지 않는다");
    assert.ok(guide.text.length <= GUIDE_BUDGET.design, `${purpose} 설계 기준 ${guide.text.length}자`);
  }
});

test("출제 기준은 목표 종류의 절만 고르고, 종류가 전부여도 예산 안이며, 사람용 설명은 넣지 않는다", async () => {
  const one = await loadGuide("author", { purpose: "core", kinds: ["공식"] });
  assert.match(one.text, /\[종류-공식-1\]/);
  assert.ok(!one.text.includes("[종류-용어-"));
  assert.match(one.text, /\[객관식-3\][\s\S]*\[단답-2\][\s\S]*\[자기확인-1\]/);
  assert.match(one.text, /\[좋은예-1\][\s\S]*\[나쁜예-1\]/);
  assert.ok(!/출제 단계에 항상 들어간다|개선 회차|README/.test(one.text));
  for (const purpose of purposes) {
    const all = await loadGuide("author", { purpose, kinds: [...objectiveKinds] });
    assert.ok(all.text.length <= GUIDE_BUDGET.author, `${purpose} 출제 기준 ${all.text.length}자`);
  }
});

test("평가 자료(Cornell)의 문제는 기준·예시에 들어 있지 않다", async () => {
  const all = await loadGuide("author", { purpose: "all", kinds: [...objectiveKinds] });
  const design = await loadGuide("design", { purpose: "all" });
  assert.ok(!/cornell|BFS 1번|A → C/i.test(all.text + design.text));
});

test("후보 폴더로 기준을 바꿔 돌릴 수 있고, 내용이 바뀌면 기준 버전이 바뀐다. 절이 빠지면 알려 준다", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "guide-"));
  const previous = process.env.STUDY_FORGE_GUIDE_ROOT;
  try {
    await cp(path.join(process.cwd(), "출제기준"), path.join(root, "출제기준"), { recursive: true });
    await cp(path.join(process.cwd(), "출제기준"), path.join(root, "출제기준-후보"), { recursive: true });
    process.env.STUDY_FORGE_GUIDE_ROOT = root;
    const base = await loadGuide("author", { purpose: "core", kinds: ["개념"] });
    const file = path.join(root, "출제기준-후보", "출제", "원칙.md");
    await writeFile(file, `${await readFile(file, "utf8")}- [출제-10] 시험용 새 규칙.\n`);
    const candidate = await loadGuide("author", { purpose: "core", kinds: ["개념"], dir: "출제기준-후보" });
    assert.notEqual(candidate.version, base.version);
    assert.match(candidate.text, /\[출제-10\] 시험용 새 규칙/);
    assert.equal(candidate.dir, "출제기준-후보");
    await assert.rejects(loadGuide("author", { purpose: "core", dir: "../etc" }), /폴더 이름/);
    const design = path.join(root, "출제기준-후보", "목표설계.md");
    await writeFile(design, (await readFile(design, "utf8")).replace("## 목적: 핵심 암기", "## 핵심"));
    await assert.rejects(loadGuide("design", { purpose: "core", dir: "출제기준-후보" }), /'## 목적: 핵심 암기' 절이 없습니다/);
  } finally {
    if (previous === undefined) delete process.env.STUDY_FORGE_GUIDE_ROOT; else process.env.STUDY_FORGE_GUIDE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("규칙 줄만 고른다", () => {
  const markdown = "# 제목\n설명\n## A\n- [a-1] 하나\n메모\n- [a-2] 둘\n## B\n- [b-1] 셋\n";
  assert.deepEqual(ruleLines(markdown), ["- [a-1] 하나", "- [a-2] 둘", "- [b-1] 셋"]);
  assert.deepEqual(ruleLines(markdown, ["B"]), ["- [b-1] 셋"]);
});

test("저장소에 있는 후보 폴더(출제기준-…)도 절이 다 있고 예산 안이다", async () => {
  const { readdir } = await import("node:fs/promises");
  const { guideDirPattern } = await import("./guide.ts");
  const dirs = (await readdir(process.cwd())).filter((name) => name !== "출제기준" && guideDirPattern.test(name));
  for (const dir of dirs) {
    for (const purpose of purposes) {
      const design = await loadGuide("design", { purpose, dir });
      const author = await loadGuide("author", { purpose, kinds: [...objectiveKinds], dir });
      assert.ok(design.text.length <= GUIDE_BUDGET.design, `${dir} ${purpose} 설계 ${design.text.length}자`);
      assert.ok(author.text.length <= GUIDE_BUDGET.author, `${dir} ${purpose} 출제 ${author.text.length}자`);
    }
  }
});
