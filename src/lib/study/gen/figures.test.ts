import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanFigure } from "./cards.ts";

test("그림 칸 다듬기: 호출 밖 쪽·뒤집힌 상자는 버리고 0~100 밖 값(588)은 고친다", () => {
  assert.deepEqual(cleanFigure({ page: 29, box: [588, 53, 83, 89], role: "장면", says: " 격자 셋 " }, [28, 29, 30])?.box, [58.8, 53, 83, 89]);
  assert.equal(cleanFigure({ page: 31, box: [10, 10, 50, 50], role: "근거", says: "" }, [28, 29, 30]), undefined);
  assert.equal(cleanFigure({ page: 29, box: [50, 50, 10, 10], role: "근거", says: "" }, [29]), undefined);
  assert.equal(cleanFigure(null, [29]), undefined);
  assert.equal(cleanFigure({ page: 29, box: [1, 2, 3], role: "근거", says: "" }, [29]), undefined);
});

test("그림 칸: 픽셀 좌표(1024×576 쪽 이미지)는 이미지 크기로 나눈다, 크기를 모르면 버린다", () => {
  const box = cleanFigure({ page: 29, box: [162, 328, 346, 509], role: "그림풀이", says: "" }, [29], () => ({ width: 1024, height: 576 }))?.box.map((v) => Math.round(v));
  assert.deepEqual(box, [16, 57, 34, 88]);
  assert.equal(cleanFigure({ page: 29, box: [162, 328, 346, 509], role: "그림풀이", says: "" }, [29]), undefined);
});

test("이미지 크기 읽기: PNG·JPEG 머리", async () => {
  const { imageSize } = await import("./image-size.ts");
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(1024, 576);
  assert.deepEqual(imageSize(`data:image/jpeg;base64,${c.toBuffer("image/jpeg").toString("base64")}`), { width: 1024, height: 576 });
  assert.deepEqual(imageSize(`data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`), { width: 1024, height: 576 });
});
