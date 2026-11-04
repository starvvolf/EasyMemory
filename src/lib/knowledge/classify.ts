// 주제 정리 (2026-10-28 결정 "4개 축"). New items are sorted a few seconds after they are saved, in batches, with one
// model call per batch: each item gets a place in the one topic tree (주제: "CS/알고리즘/탐색") and a 종류. Items the
// learner moved by hand stay where they are; an item is sorted once (it has a 종류 afterwards). 자료마다 목표를 추천하던
// 것은 목표를 없애며 뺐다(2026-10-30 사용자 "목표 없애").
import { askJson, S } from "../assist/model.ts";
import { KIND_LABEL, pathOf, readAll, sortItems, type KKind, type Knowledge } from "./store.ts";

const BATCH = 30, BATCHES_PER_RUN = 4;
const KINDS = Object.keys(KIND_LABEL) as KKind[];

const SYSTEM = `학습자의 지식 저장소를 정리한다.

items: 지식마다 topic(주제 경로)과 kind(종류)를 정한다.
- topic은 "무엇에 관한 지식인가"만 나타내는 경로다. "/"로 2~4단계. 첫 단계는 큰 분야(예: CS, 수학, 경제, 어학, 교양), 그다음은 점점 좁게("CS/알고리즘/탐색", "CS/그래픽스/투영", "경제/주식/가치평가", "어학/영어/어휘", "교양/기업윤리").
- 학습자 주제 목록에 맞는 경로가 있으면 글자 그대로 그 경로를 쓴다. 비슷한 경로를 새로 만들지 않는다.
- 자료 이름, 파일 이름, 주차·회차·장 번호, 출처 이름(바킹독, 블로그 이름)은 주제가 아니다. 그런 것은 "만난 곳"일 뿐이니 경로에 넣지 않는다. "지금 위치"나 "힌트"가 그런 이름이면 무시하고 내용으로 정한다.
- 같은 묶음 안에서 같은 분야는 같은 경로를 쓴다. 지식 하나마다 폴더를 만들지 않는다(한 폴더에 여러 지식이 모이게).
- kind: 이 지식이 무엇을 아는 것인지로 하나만 고른다(2026-11-05 유형 6가지).
  concept(개념: 무엇인가. 용어·정의·사실·값도 여기), principle(원리: 왜 그런가·어떻게 작동하나. 예 "금리가 오르면 채권 가격이 내리는 이유"),
  procedure(절차: 정해진 순서대로 하는 일. 예 "임의의 점을 중심으로 회전하는 순서", 알고리즘의 단계), rule(규칙: 언제 성립하는 규정·조건·공식. 예 "정렬된 배열이어야 이분 탐색을 쓸 수 있다", 계산 공식),
  method(방법: 문제를 해결하는 방법·기법들. 예 "교착 상태를 막는 방법"), compare(비교: 둘 이상의 차이. 예 "TCP와 UDP의 차이"),
  vocab(어휘: 개념 중 외국어 단어·표현처럼 단어 자체를 외우는 것. 전문 용어는 vocab이 아니라 concept).
- n은 받은 번호 그대로.`;
type Sorted = { items: Array<{ n: number; topic: string; kind: string }> };
const SCHEMA = S.obj({ items: S.arr(S.obj({ n: S.int, topic: S.str, kind: S.oneOf(...KINDS, "vocab") })) });

/** Items still to sort: no 종류 yet. */
const pending = (items: Knowledge[]) => items.filter((i) => !i.kind);
/** Folder paths that are topics (not left over from file names), for the model to reuse. */
function topicPaths(folders: Awaited<ReturnType<typeof readAll>>["folders"], items: Knowledge[]) {
  const materials = new Set(items.flatMap((i) => i.sources.map((s) => s.title.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim())));
  const used = new Set(items.filter((i) => i.kind && i.folderId).map((i) => i.folderId!));
  return [...new Set(folders.filter((f) => used.has(f.id)).map((f) => pathOf({ folders }, f.id)).filter((p) => !materials.has(p.split(" / ")[0])))]
    .map((p) => p.split(" / ").join("/")).sort().slice(0, 120);
}

const state = globalThis as unknown as { __classifyRunning?: Promise<unknown> };
/** One run: up to a few batches of items. Returns what it did and how many items are left (suggested is always 0, kept for callers). */
export async function runClassify(options: { batches?: number; model?: string; effort?: string } = {}) {
  if (state.__classifyRunning) return state.__classifyRunning as Promise<{ sorted: number; suggested: number; left: number; calls: number }>;
  const run = (async () => {
    let sorted = 0, calls = 0;
    const suggested = 0;
    for (let b = 0; b < (options.batches ?? BATCHES_PER_RUN); b++) {
      const { folders, items } = await readAll();
      const todo = pending(items).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, BATCH);
      if (!todo.length) break;
      const lines = todo.map((i, n) => {
        const where = i.folderId ? pathOf({ folders }, i.folderId) : "";
        const meaning = i.body.split("\n").find((l) => l.trim() && !l.startsWith("헷갈림:"))?.slice(0, 140) ?? "";
        return `${n}. ${i.title}${i.aliases.length ? ` (다른 이름: ${i.aliases.slice(0, 4).join(", ")})` : ""}${meaning ? ` — ${meaning}` : ""}`
          + ` | 지금 위치: ${where || "없음"}${i.topicHint ? ` | 힌트: ${i.topicHint}` : ""} | 만난 곳: ${[...new Set(i.sources.map((s) => s.title))].slice(0, 3).join(", ") || "없음"}`;
      });
      const user = [`[학습자 주제 목록]\n${topicPaths(folders, items).join("\n") || "(없음)"}`, `[정리할 지식]\n${lines.join("\n") || "(없음)"}`].join("\n\n");
      const data = await askJson<Sorted>("knowledge:classify", SYSTEM, user, SCHEMA, { model: options.model, effort: options.effort });
      calls++;
      // Items the learner placed by hand keep their folder; they only get a 종류.
      const entries: Array<{ id: string; kind: KKind | "vocab"; topic?: string }> = (data.items ?? []).flatMap((x) => {
        const item = todo[x.n];
        if (!item || !(KINDS.includes(x.kind as KKind) || x.kind === "vocab")) return [];
        const topic = x.topic.split("/").map((p) => p.trim()).filter(Boolean).slice(0, 5).join("/");
        return [{ id: item.id, kind: x.kind as KKind | "vocab", ...(item.placedByHand || !topic ? {} : { topic }) }];
      });
      // An item the model left out still gets a 종류, so one bad answer does not ask about it forever.
      for (const item of todo) if (!entries.some((e) => e.id === item.id)) entries.push({ id: item.id, kind: "concept" });
      await sortItems(entries);
      sorted += entries.length;
    }
    // Empty folders made on the way (old file-name and source folders) go, even when nothing was sorted this run.
    const { folders, items } = await readAll();
    if (folders.some((f) => !f.hand && !items.some((i) => i.folderId === f.id) && !folders.some((g) => g.parentId === f.id))) await sortItems([]);
    const left = pending((await readAll()).items).length;
    return { sorted, suggested, left, calls };
  })();
  state.__classifyRunning = run.finally(() => { state.__classifyRunning = undefined; });
  return run;
}
