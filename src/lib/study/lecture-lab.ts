// AI 강의 실험 (11/10 사용자 "카드 자체는 딱딱해도 되는데 사람이 이해만 잘되면 … 사람이 공부한다 치면 AI가 어떤 흐름으로 강의할지,
// 어느 타이밍에 얼마나 비용을 써서. 너가 한다고 생각해 보고 해 봐"). 제품 흐름에 넣지 않는다.
// 강사가 하듯 두 겹:
//   1. 여는 말(자료당 1번, 기억이 다 찬 뒤): 강의 전체 이야기 줄기 — 영역마다 "왜 이게 필요한가 → 무엇을 배우나 → 다음으로 넘어가는 다리"
//   2. 영역 수업(영역마다 1번, 학생이 그 영역에 들어갈 때 / 바로 앞 영역을 듣는 동안 미리): 장면 단위 설명 + 중간에 한 번 따져 보기
// 둘 다 terra low. 입력은 이미 만든 기억(요지·식과 조건·헷갈림·그림 설명)과 그 영역 쪽의 원문 글자. 쪽 그림은 다시 보내지 않고 잘라 둔 그림을 가리킨다.
import { withTrace } from "../ai/trace.ts";
import { askJson, S } from "../assist/model.ts";
import type { MapCard } from "./material-map.ts";

type Memo = { line?: string; facts?: string[]; role?: string };
const memoOf = (c: MapCard) => (c as MapCard & { memo?: Memo }).memo ?? {};
const line = (c: MapCard) => {
  const m = memoOf(c);
  return [`[${c.id}] ${c.title}${m.role ? ` (${m.role})` : ""}`, m.line ? `  요지: ${m.line}` : "", ...(m.facts ?? []).map((f) => `  식·조건: ${f}`),
    ...c.mistakes.map((x) => `  헷갈림: ${x}`), c.figure ? `  그림(p.${c.figure.page}): ${c.figure.says}` : ""].filter(Boolean).join("\n");
};

export const OPENING_SYSTEM = `너는 이 강의를 맡은 강사다. 학생이 이 자료를 처음 공부하기 전에 듣는 여는 말을 쓴다.
받는 것: 강의의 영역(차례대로)과 영역마다의 기억(외울 단위: 요지·식과 조건·학생이 헷갈리는 점·역할 메인/바탕/곁).
- 강의 전체를 하나의 이야기로 꿴다: 이 강의가 풀려는 문제가 무엇이고, 영역들이 그 문제를 어떤 순서로 풀어 가는지.
- 영역마다: why(앞에서 무엇이 모자랐기에 이 영역이 필요한지, 첫 영역은 출발 문제), learn(이 영역에서 손에 쥐게 되는 것, 메인 기억 중심), bridge(이 영역으로도 남는 문제나 다음 영역으로 넘어가는 까닭, 마지막은 강의 전체를 묶는 한마디).
- 바탕 기억은 "이미 아는 것"으로만 짚고, 곁 기억은 이야기에 넣지 않는다.
- 자료에 없는 내용을 지어내지 않는다. 처음 보는 학생이 바로 알아듣는 쉬운 말, "~해요" 체. 용어는 "한국어(영어 원어)".`;
const OPENING_SCHEMA = S.obj({ problem: S.str, areas: S.arr(S.obj({ area: S.str, why: S.str, learn: S.str, bridge: S.str })) });

export const LESSON_SYSTEM = `너는 이 강의를 맡은 강사다. 영역 하나를 학생 앞에서 설명하는 수업을 쓴다. 학생은 여는 말을 이미 들었다.
받는 것: 강의 전체 이야기에서 이 영역의 자리(why·learn·bridge), 이 영역의 기억, 이 영역 쪽들의 원문 글자.
- 장면(scenes)을 차례로 쓴다. 장면 하나는 강사가 칠판 앞에서 한 호흡에 하는 말이다: 상황이나 질문으로 시작해서, 학생이 따라오게 한 단계씩.
- 메인 기억은 모두 다룬다. 바탕 기억은 필요한 곳에서 짧게 떠올려 주고, 곁 기억은 빼도 된다. 장면마다 다룬 기억의 id를 cards에 적는다.
- 식은 원문 그대로 보여 주고, 식이 무엇을 말하는지(무엇이 커지면 무엇이 어떻게 되는지)를 말로 풀어 준다. 기호는 처음 나올 때 뜻을 말한다.
- 그림이 있는 기억은 그 그림을 보며 설명하면 좋은 장면에 figure로 그 기억 id를 적는다.
- 학생이 헷갈리는 점은 "여기서 많이들 이렇게 생각하는데"처럼 장면 안에서 바로잡는다.
- 수업 중간, 핵심을 막 배운 뒤에 한 번 학생이 스스로 따져 보게 한다(check): 상황 하나를 주고 묻고, 답과 까닭을 둔다. 답은 기억과 원문으로 정해지는 것이어야 한다.
- 마지막 장면은 이 영역을 한 문장으로 묶고 bridge로 다음 영역에 넘긴다.
- 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
const LESSON_SCHEMA = S.obj({
  scenes: S.arr(S.obj({ say: S.str, cards: S.arr(S.str), figure: S.str })),
  check: S.obj({ after: S.int, question: S.str, answer: S.str, why: S.str }),
});
export const LECTURE_MODEL = { model: "gpt-6.1-terra", effort: "low" };

type Area = { title: string; pages: number[]; cards: MapCard[] };
export async function runLecture(id: string, areas: Area[], texts: Record<string, string>) {
  const t0 = Date.now();
  const opening = await withTrace({ area: "pdf", action: "quiz-lecture", ref: id }, () => askJson<{ problem: string; areas: Array<{ area: string; why: string; learn: string; bridge: string }> }>(
    "map:lecture-open", OPENING_SYSTEM, areas.map((a, i) => `## 영역 ${i + 1}. ${a.title}\n${a.cards.map(line).join("\n")}`).join("\n\n"), OPENING_SCHEMA, LECTURE_MODEL));
  const openMs = Date.now() - t0;
  const lessons = await Promise.all(areas.map(async (a, i) => {
    const t = Date.now();
    const place = opening.areas[i] ?? { area: a.title, why: "", learn: "", bridge: "" };
    const source = a.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n");
    const r = await withTrace({ area: "pdf", action: "quiz-lecture", ref: id }, () => askJson<{ scenes: Array<{ say: string; cards: string[]; figure: string }>; check: { after: number; question: string; answer: string; why: string } }>(
      "map:lecture-lesson", LESSON_SYSTEM,
      `강의가 풀려는 문제: ${opening.problem}\n\n이 영역: ${a.title}\nwhy: ${place.why}\nlearn: ${place.learn}\nbridge: ${place.bridge}\n\n[기억]\n${a.cards.map(line).join("\n")}\n\n[원문]\n${source}`,
      LESSON_SCHEMA, LECTURE_MODEL)).catch((e) => ({ scenes: [], check: { after: 0, question: "", answer: "", why: String(e) } }));
    return { area: a.title, ms: Date.now() - t, ...r };
  }));
  return { openMs, wall: Date.now() - t0, opening, lessons };
}
