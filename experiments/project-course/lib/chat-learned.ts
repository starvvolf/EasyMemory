// 대화에서 배운 것 뽑기(11/4 사용자 "일단 한번 해 봐. 근거 문장 오류 날 수 있으니 기록도 잘").
// 단위는 "개념 하나에 대해 학습자가 한 일(사건)" — Recaller의 지식 = 뜻 + 경험과 같은 모양:
//   concept(교과서 이름) · meaning(이 대화에서 설명된 뜻) · kind(물어봄 · 헷갈림 · 틀리게 앎 · 자기 말로 설명 · 직접 써 봄) · evidence(학습자 말 id + 그대로 옮긴 구절) · context(무엇을 하다가)
// 질문 하나가 끝날 때마다 지난번 이후 새 대화만 한 번 부른다. 근거는 코드가 실제 학습자 말과 대조하고, 받은 것 · 버린 것(이유) · 원문 답을 모두 남긴다.
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { DATA, read, update } from "./store.ts";
import { aiJson, S } from "./ai.ts";

export const KINDS = { asked: "물어봄", confused: "헷갈림", misconception: "틀리게 앎", explained: "자기 말로 설명", applied: "직접 써 봄" } as const;
type Kind = keyof typeof KINDS;
export type Learned = { concept: string; meaning: string; kind: Kind; messageId: number; quote: string; context: string; at: string };
type Store = { upTo: number; items: Learned[]; rejected: { item: unknown; reason: string; at: string }[] };
type Msg = { id: number; role: string; text: string };

const dir = () => path.join(DATA, "agent-chat", "learned");
const fileOf = (chatId: string) => path.join(dir(), `${chatId}.json`);
const logFile = () => path.join(dir(), "log.jsonl");
const empty = (): Store => ({ upTo: 0, items: [], rejected: [] });
export const learnedOf = (chatId: string) => read<Store>(fileOf(chatId), empty());

export const SYSTEM_LEARNED = `학습 대화를 읽고, 학습자가 이 대화에서 개념과 만난 순간을 사건으로 정리한다.
사건 하나는 개념 하나에 대해 학습자가 한 일이다.
- asked: 뜻이나 쓰임을 물었다
- confused: 헷갈린다고 했거나, 질문에서 헷갈림이 드러났다
- misconception: 틀린 생각을 말했다
- explained: 자기 말로 맞게 설명했다
- applied: 그 개념을 직접 코드에 써 봤다(학습자가 코드를 붙였거나 저장했다고 말한 경우)
concept는 다른 곳에서도 통하는 일반 이름으로 쓴다(예: requestAnimationFrame, 이벤트 리스너, 게임 루프, 중력 가속도). meaning은 이 대화에서 튜터가 설명한 뜻을 한 문장으로, context는 무엇을 하다가 나왔는지 한 구절로 쓴다.
evidence는 그 사건이 드러난 학습자 메시지의 id와, 그 메시지에서 글자 그대로 옮긴 구절이다.
사건은 학습자의 말에서 드러난 것만 담는다. 드러난 게 없으면 빈 목록을 낸다.`;

const SCHEMA = S.obj({ events: S.arr(S.obj({ concept: S.str, meaning: S.str, kind: S.oneOf(...Object.keys(KINDS)), messageId: S.int, quote: S.str, context: S.str })) });
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** 받은 사건을 코드로 검사한다: 학습자 말 id인지 · 구절이 그 말에 그대로 있는지 · 칸이 비지 않았는지 · 이미 있는지 */
export function checkEvents(raw: unknown[], learner: Map<number, string>, have: Learned[]) {
  const ok: Learned[] = []; const bad: { item: unknown; reason: string }[] = [];
  const seen = new Set(have.map((x) => `${norm(x.concept)}|${x.kind}|${x.messageId}`));
  for (const r of raw) {
    const e = r as Partial<Learned>;
    const concept = String(e.concept ?? "").trim().slice(0, 80), quote = String(e.quote ?? "").trim();
    const msg = learner.get(Number(e.messageId));
    let reason = "";
    if (!concept) reason = "개념 이름이 비었어요";
    else if (!(String(e.kind) in KINDS)) reason = "모르는 종류";
    else if (msg === undefined) reason = `학습자 말 id가 아니에요(${e.messageId})`;
    else if (quote.length < 2) reason = "근거 구절이 비었어요";
    else if (!norm(msg).includes(norm(quote))) reason = "근거 구절이 그 학습자 말에 없어요";
    const key = `${norm(concept)}|${e.kind}|${e.messageId}`;
    if (!reason && seen.has(key)) reason = "이미 있는 사건";
    if (reason) { bad.push({ item: r, reason }); continue; }
    seen.add(key);
    ok.push({ concept, meaning: String(e.meaning ?? "").trim().slice(0, 300), kind: e.kind as Kind, messageId: Number(e.messageId), quote: quote.slice(0, 200), context: String(e.context ?? "").trim().slice(0, 120), at: new Date().toISOString() });
  }
  return { ok, bad };
}

const running = new Set<string>();
/** 질문 하나가 끝난 뒤 부른다. 지난번 이후 새 학습자 말이 없으면 부르지 않는다 */
export async function extractLearned(chatId: string, messages: Msg[]) {
  if (running.has(chatId)) return null;
  running.add(chatId);
  const t0 = Date.now();
  let log: Record<string, unknown> = { at: new Date().toISOString(), chatId };
  try {
    const st = await learnedOf(chatId);
    const fresh = messages.filter((m) => m.id > st.upTo && (m.role === "user" || m.role === "assistant"));
    if (!fresh.some((m) => m.role === "user")) return null;
    // 앞 맥락으로 직전 몇 개를 같이 준다(대명사 · "그거"가 무엇인지 알게). 사건은 새 학습자 말에서만 받는다
    const before = messages.filter((m) => m.id <= st.upTo && (m.role === "user" || m.role === "assistant")).slice(-4);
    const show = (m: Msg) => `[${m.role === "user" ? "학습자" : "튜터"} #${m.id}] ${m.text.slice(0, 2500)}`;
    const user = [before.length ? `[앞 대화 — 참고만]\n${before.map(show).join("\n\n")}` : "", `[새 대화 — 여기서 사건을 뽑는다]\n${fresh.map(show).join("\n\n")}`].filter(Boolean).join("\n\n");
    const learner = new Map(fresh.filter((m) => m.role === "user").map((m) => [m.id, m.text] as const));
    const upTo = Math.max(st.upTo, ...fresh.map((m) => m.id));
    log = { ...log, range: [fresh[0].id, upTo], learnerIds: [...learner.keys()] };
    const out = await aiJson<{ events: unknown[] }>("chat-learned", SYSTEM_LEARNED, user, SCHEMA);
    const { ok, bad } = checkEvents(Array.isArray(out?.events) ? out.events : [], learner, st.items);
    const now = new Date().toISOString();
    await update<Store>(fileOf(chatId), empty(), (s) => { s.upTo = upTo; s.items.push(...ok); s.rejected.push(...bad.map((b) => ({ ...b, at: now }))); });
    log = { ...log, ms: Date.now() - t0, raw: out?.events ?? null, accepted: ok.length, rejected: bad };
    return { ok, bad };
  } catch (e) {
    // 실패하면 upTo를 올리지 않는다 → 다음 질문 뒤에 이번 것까지 다시 본다
    log = { ...log, ms: Date.now() - t0, error: (e as Error).message };
    return null;
  } finally {
    running.delete(chatId);
    await mkdir(dir(), { recursive: true }).catch(() => {});
    await appendFile(logFile(), JSON.stringify(log) + "\n").catch(() => {});
  }
}
