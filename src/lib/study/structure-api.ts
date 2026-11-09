// /api/study-map/<id>/structure-v2 의 몸 (11/9 줄기 기반 구조): GET 저장된 구조와 stale · POST 만들기.
// 줄기(compact.json)가 있으면 기억을 묶고(makeStemStructure), 없으면 예전처럼 카드를 묶는다(makeStructure).
// 예전 라우트 /structure는 그대로 둔다(개발 서버가 라우트 고침을 다시 읽지 않는 일이 있어 새 길로).
import { NextResponse } from "next/server";
import { loadGen } from "./gen/runner.ts";
import { materialMap } from "./material-map.ts";
import { loadCompact } from "./compact.ts";
import { cardSig, loadStructure, makeStemStructure, makeStructure } from "./structure.ts";

async function mapOf(id: string) {
  if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!map) throw Object.assign(new Error("이 자료는 아직 카드가 없어 구조를 만들 수 없어요."), { status: 422 });
  return map;
}
export async function structureApi(request: Request, id: string) {
  const [map, structure, compact] = await Promise.all([mapOf(id), loadStructure(id), loadCompact(id)]);
  if (request.method === "GET") {
    // 줄기가 있는데 구조가 카드 기반이거나 다른 줄기로 만든 것이면 다시 만들라고 띄운다.
    const stale = Boolean(structure && (compact ? structure.sig !== `stem:${compact.at}` : structure.unit !== "memory" && structure.sig !== cardSig(map)));
    return NextResponse.json({ structure, stale, stem: Boolean(compact) });
  }
  if (map.status === "queued" || map.status === "running") return NextResponse.json({ message: "자료를 다 만든 뒤에 구조를 만들 수 있어요." }, { status: 409 });
  return NextResponse.json({ structure: compact ? await makeStemStructure(id, map, compact) : await makeStructure(id, map), stale: false, stem: Boolean(compact) });
}
