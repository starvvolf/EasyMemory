// 심기 모드 (설계 6번, v1 방식 · 보조): 모범 풀이(지도의 맞는 길 코드)에 정한 실수 하나를 심어 낸다.
//   쓸 곳: 리뷰어 · 빈틈 뽑기 · 장면 채점이 **특정 실수**를 잡는지 되풀이해 보는 회귀 시험(지시문을 고친 뒤 깨진 게 없는지).
//   말할 수 있는 것: "이 실수가 들어오면 잡는다 / 못 잡는다"까지. 우리가 심은 걸 우리가 찾는 것이라 두 시스템이 맞물리는지만 확인된다.
//   기록: 심은 코드 제출(틀림) → 묻고 답함(짧은 틀) → 고친 코드 제출(맞음). 그다음 빈틈 뽑기(AI) · 장면(고치기는 AI 0번) · 채점.
import { verdictOf } from "./guard.ts";
import { allTests, fragmentOf, program, rightPicks, type ProblemPack } from "./map.ts";
import { fragmentsIn } from "./score.ts";
import type { ProblemMap } from "./types.ts";
import type { Gap } from "../scene/types.ts";

export type Plant = { id: string; route: string; wrong: string; right: string; what: string; planted: string; fixed: string; verdict?: string };
/** 심을 수 있는 실수: 맞는 길(AC)마다 자리의 틀린 조각 하나씩 + 틀린 길(그 길 자체가 틀린 생각)을 정석 길 대신 */
export function plants(map: ProblemMap): Plant[] {
  const out: Plant[] = [];
  const good = map.routes.filter((r) => r.measured?.verdict === "AC");
  for (const r of good) for (const [name, s] of Object.entries(r.slots)) for (const alt of Object.keys(s.alts).filter((a) => a !== s.right && a !== "?" && fragmentOf(map, a)?.wrong)) {
    out.push({ id: `${r.id}.${name}=${alt}`, route: r.id, wrong: alt, right: s.right, what: fragmentOf(map, alt)!.what, planted: program(r, { ...rightPicks(r), [name]: alt }), fixed: program(r, rightPicks(r)) });
  }
  const best = [...good].sort((a, b) => (b.prior ?? 0) - (a.prior ?? 0))[0];
  for (const r of map.routes.filter((x) => x.measured?.verdict !== "AC" && best)) {
    const w = r.needs.find((n) => fragmentOf(map, n)?.wrong);
    if (!w) continue;
    out.push({ id: `${r.id}(${w})`, route: r.id, wrong: w, right: fragmentOf(map, w)!.right ?? w, what: fragmentOf(map, w)!.what, planted: program(r, rightPicks(r)), fixed: program(best!, rightPicks(best!)) });
  }
  return out;
}
/** 심은 코드가 정말 틀리나(채점기) */
export async function measurePlants(ps: Plant[], pack: ProblemPack) {
  for (const p of ps) p.verdict = (await verdictOf(p.planted, allTests(pack), pack.timeLimitMs)).verdict;
  return ps;
}

export type PlantRun = { plant: Plant; gaps: Array<{ title: string; kind: string; fragments: string[] }>; caught: boolean; scene?: { format: string; planted: string; fixed: string } | null; why?: string };
/** 데이터 폴더(이미 switchDataDir로 바꾼 곳)에 심은 기록을 남기고 빈틈 뽑기 · 장면까지. ask를 주면 그 AI로 뽑는다(없으면 앱 기본). */
export async function runPlant(map: ProblemMap, pack: ProblemPack, plant: Plant, opts: { extract?: boolean; /** 뽑은 빈틈이 없으면 심은 것으로 빈틈을 만들어 장면 · 채점만 본다(가짜 AI) */ keyGap?: boolean } = {}): Promise<PlantRun> {
  const { setupProblem } = await import("./algo-driver.ts");
  const { submitAndRecord } = await import("../code/service.ts");
  const { appendTalk } = await import("../code/tutor/talk.ts");
  await setupProblem(pack);
  const bad = await submitAndRecord(pack.id, "python", plant.planted, "submit", 0);
  const right = fragmentOf(map, plant.right);
  await appendTalk({ problemId: pack.id, kind: "질문", q: "틀렸대요. 어디가 틀렸어요?", a: right ? `${right.what}. 예:\n${right.example}` : "다시 보세요.", code: plant.planted, verdict: bad.verdict });
  await submitAndRecord(pack.id, "python", plant.fixed, "submit", 0);
  const run: PlantRun = { plant, gaps: [], caught: false };
  let gaps: Gap[] = [];
  if (opts.extract !== false) {
    const { extractGaps } = await import("../scene/extract.ts");
    gaps = await extractGaps(pack.id, { force: true }).catch((e) => { run.why = `빈틈 뽑기 실패: ${(e as Error).message}`; return []; });
  }
  run.gaps = gaps.map((g) => ({ title: g.title, kind: g.kind, fragments: fragmentsIn(map, `${g.title}\n${g.missed}\n${g.wrong}\n${g.topic}`).map((x) => x.id) }));
  run.caught = run.gaps.some((g) => g.fragments.includes(plant.right));
  let target = gaps.find((g, i) => run.gaps[i].fragments.includes(plant.right));
  if (!target && opts.keyGap && right) {
    const { newId } = await import("../scene/store.ts");
    const { firstState } = await import("../scene/ladder.ts");
    target = { id: newId("gap"), branch: "algo", kind: right.layer === 1 ? "문법" : right.layer === 2 ? "자료 담기" : right.layer >= 6 ? "알고리즘 고르기" : right.layer === 5 ? "알고리즘 원리" : "알고리즘 구현", layer: right.layer,
      title: `(심은 것) ${plant.what.slice(0, 40)}`, target: "ability", missed: right.what, wrong: plant.what, wrongCode: plant.planted, wrongVerified: true, wrongVerdict: bad.verdict,
      kernel: { lang: "python", code: right.example, needs: [] }, evidence: [{ type: "submission", id: bad.submission.id, verdict: bad.verdict }],
      origin: { problemId: pack.id, title: pack.title, lang: "python" }, topic: `plant.${plant.right}`, scope: "piece", dose: { level: 3 }, state: firstState(3), createdAt: new Date().toISOString() };
    run.why = [run.why, "뽑은 빈틈에 없어 심은 것으로 빈틈을 만들어 장면만 봄"].filter(Boolean).join(" · ");
  }
  if (target) {
    const { makeScene } = await import("../scene/make.ts");
    const { gradeScene } = await import("../scene/grade.ts");
    const scene = await makeScene(target).catch(() => null);
    if (scene) {
      const ans = (fix: boolean) => scene.format === "fix" ? (fix ? plant.fixed : plant.planted) : null;
      const a = ans(false), b = ans(true);
      run.scene = { format: scene.format, planted: a ? (await gradeScene(scene, target, a)).verdict : "AI 필요", fixed: b ? (await gradeScene(scene, target, b)).verdict : "AI 필요" };
    } else run.scene = null;
  }
  return run;
}
