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
