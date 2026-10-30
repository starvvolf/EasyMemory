// 자료 보기: 같은 코드 문제·같은 프로젝트 코스는 한 줄, PDF는 가장 최근 생성으로 지도를 열고, 프로젝트는 단계별, 자료 폴더는 보기만 바꾼다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMaterialFolder, deleteMaterialFolder, materialView, placeMaterials } from "./materials.ts";
import { recordEvent, saveMany } from "./store.ts";

test("자료 보기: 한 줄씩, 지도 열쇠, 단계, 자료 폴더", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "materials-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try {
    await saveMany([{ title: "원근 투영", source: { kind: "pdf", title: "그래픽스 03", ref: "gen_old:c1", at: "2026-10-28T00:00:00Z" } }]);
    await saveMany([{ title: "투영 행렬", source: { kind: "pdf", title: "그래픽스 03", ref: "gen_new:c2", at: "2026-10-30T00:00:00Z" } }]);
    await saveMany([{ title: "피보나치 수", source: { kind: "code", title: "BOJ 1003번: 피보나치 함수", ref: "code:cp_a" } }]);
    await saveMany([{ title: "DP", source: { kind: "code", title: "피보나치 함수", ref: "code:cp_b" } }]);
    const proj = { kind: "code" as const, title: "프로젝트 코스: 게시판 API", ref: "project:board" };
    const [route, crud] = await saveMany([{ title: "라우팅", source: proj }, { title: "CRUD", source: proj }]);
    await recordEvent(route.item.id, "correct", "1단계 · 검사 통과", { kind: "code", title: proj.title, ref: proj.ref });
    await recordEvent(crud.item.id, "hint", "2단계 · 힌트", { kind: "code", title: proj.title, ref: proj.ref });

    let v = await materialView();
    const pdf = v.materials.find((m) => m.kind === "pdf")!;
    assert.equal(pdf.items, 2);
    assert.equal(pdf.genId, "gen_new", "the newest engine material opens the map");
    const codes = v.materials.filter((m) => m.group === "code");
    assert.equal(codes.length, 1, "the same problem opened twice is one row");
    assert.equal(codes[0].title, "피보나치 함수");
    const project = v.materials.find((m) => m.group === "project")!;
    assert.equal(project.title, "게시판 API");
    assert.deepEqual(project.stages!.map((s) => [s.name, s.itemIds.length]), [["1단계", 1], ["2단계", 1]]);

    const f = await createMaterialFolder("그래픽스 수업");
    await placeMaterials([pdf.key], f.id);
    v = await materialView();
    assert.equal(v.materials.find((m) => m.key === pdf.key)!.folderId, f.id);
    assert.equal(v.folders[0].name, "그래픽스 수업");
    await deleteMaterialFolder(f.id);
    v = await materialView();
    assert.equal(v.materials.find((m) => m.key === pdf.key)!.folderId, null, "deleting a folder puts its 자료 back outside");
  } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
