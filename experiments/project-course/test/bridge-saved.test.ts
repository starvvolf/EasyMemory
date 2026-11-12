import { test } from "node:test";
import assert from "node:assert/strict";
const B = await import("../lib/bridge.ts");

test("저장 알림(11/12): 0.9.6 확장의 saved는 바로 저장으로 보고, 옛 확장은 '고친 상태 → 저장됨'으로 본다", () => {
  const seen: string[] = [];
  B.onBridgeSaved((_id, f) => seen.push(f));
  // 고치고 바로 저장: 고친 상태(dirty)가 한 번도 안 왔어도 saved로 안다
  B.setState("r", { file: "Server/Program.cs", dirty: false, saved: "Server/Program.cs" });
  // 같은 상태를 다시 받아도 saved가 없으면 저장이 아니다
  B.setState("r", { file: "Server/Program.cs", dirty: false });
  // 옛 확장: dirty → 깨끗
  B.setState("r", { file: "Client/Program.cs", dirty: true });
  B.setState("r", { file: "Client/Program.cs", dirty: false });
  assert.deepEqual(seen, ["Server/Program.cs", "Client/Program.cs"]);
});
