// 기존 지식 자동 검색(설계안 10장 · 진행판 P1·P2, 11/3): 학습자가 물으면 앱(3000)의 지식 저장소에서
// 관련 지식 몇 개만 찾아 튜터 맥락에 한 줄로 넣는다. 검색은 앱이(글자 + 비슷한 말, 모델 없음), 넣는 건 3개까지.
// 앱이 꺼져 있거나 막히면 조용히 넘어간다(수업은 멈추지 않음).
const APP = () => (process.env.PROJECT_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const STATE: Record<string, string> = { known: "앎", unknown: "몰랐음", met: "만남" };
type Hit = { id: string; title: string; state: string; graduated?: boolean; line?: string; score?: number };
const cache = new Map<string, { at: number; hits: Hit[] }>();

export async function relatedKnowledge(query: string, limit = 3): Promise<Hit[]> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2 || process.env.PC_RECALL === "0") return [];
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.hits;
  try {
    const r = await fetch(`${APP()}/api/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const hits = ((await r.json()) as { hits?: Hit[] }).hits?.slice(0, limit) ?? [];
    if (cache.size > 200) cache.clear();
    cache.set(q, { at: Date.now(), hits });
    return hits;
  } catch { return []; }
}

/** 튜터 맥락 한 줄. 이미 아는 건 다시 길게 가르치지 말고 연결만(설계안 6.2) */
export async function recallLine(query: string) {
  const hits = await relatedKnowledge(query);
  if (!hits.length) return "";
  return `[이 학습자가 앱에 이미 쌓은 관련 지식] ${hits.map((h) => `${h.title}(${h.graduated ? "졸업" : STATE[h.state] ?? h.state})${h.line ? ` — ${h.line.slice(0, 60)}` : ""}`).join(" / ")} — "앎"이면 다시 길게 설명하지 말고 지금 코드와 연결만, "몰랐음"이면 그때 헷갈렸던 걸 짚어 줄 것`;
}
