// A free stand-in for the model: builds valid replies from the prompt text itself, so the whole flow
// (including quote checks against the real page text) runs without a model. Used by tests and the lab's fake provider.
import type { GenStep } from "./types.ts";

function pagesIn(user: string) {
  const pages = new Map<number, string>();
  const body = user.split(/\[원문: [^\]]*쪽별 추출 글자\]\n/)[1] ?? "";
  for (const match of body.matchAll(/\[p\.(\d+)\]\n([\s\S]*?)(?=\n\n\[p\.\d+\]\n|\n\n\[길이 제한\]|$)/g)) pages.set(Number(match[1]), match[2]);
  return pages;
}

/** The first one or two sentence-like pieces of a page, long enough to quote. */
function quotesFrom(text: string) {
  return text.split(/(?<=[.!?。])\s+|\n/).map((part) => part.trim()).filter((part) => part.length >= 12).slice(0, 2).map((part) => part.slice(0, 120));
}

/** v3 fakes: a map with one concept per page, a plan with one item per concept, an author reply from the plan, a clean gate. */
function v3Fake(step: GenStep, user: string): string | null {
  if (step === "read") {
    const chosen = (/\[고른 쪽\] ([\d, ]+)/.exec(user)?.[1] ?? "1").split(",").map((value) => Number(value.trim())).filter(Boolean);
    const texts = pagesIn(user);
    const concepts = chosen.flatMap((page, index) => quotesFrom(texts.get(page) ?? "").slice(0, 1).map((quote) => ({
      id: `c${index + 1}`, name: `${page}쪽 개념`, kind: "사실", content: quote, conditions: [], steps: [], pages: [page], quotes: [{ page, text: quote }], importance: "상", why: "본문 핵심",
    })));
    return JSON.stringify({ sections: chosen.map((page) => ({ title: `${page}쪽 내용`, startText: "", pageStart: page, pageEnd: page, parts: [] })),
      concepts, relations: concepts.length > 1 ? [{ id: "r1", kind: "순서", between: [concepts[0].id, concepts[1].id], statement: "앞 개념 다음에 뒤 개념", pages: [chosen[0]], quotes: [] }] : [],
      materials: [], skips: [], pageNotes: [] });
  }
  if (step === "plan") {
    const map = JSON.parse(user.split("[지식 지도]\n")[1] ?? "{\"concepts\":[]}") as { concepts: Array<{ id: string; sectionId: string; name: string; content: string; conditions: string[] }> };
    return JSON.stringify({ items: map.concepts.map((concept) => ({ sectionId: concept.sectionId, type: "사실", statement: `${concept.name}을 떠올릴 수 있다`,
      given: `${concept.name}에 대해 묻는 상황`, mustRecall: concept.content, conditions: concept.conditions, concepts: [concept.id], relations: [], importance: "core" })) });
  }
  if (step === "gate") {
    return JSON.stringify({ questions: [...user.matchAll(/^### (Q\d+)$/gm)].map((match) => ({ questionId: match[1], derivable: false, derivableEvidence: "", misreading: false, misreadingDetail: "" })) });
  }
  if (step === "author" && user.includes("[문항 계획]")) {
    const questions = [...user.matchAll(/^- id: (\S+) \[.+?\]\n  목표: .+\n  주는 것: (.+)\n  꺼낼 것: (.+)$/gm)].map((match) => ({
      objectiveId: match[1],
      stem: [{ kind: "text", text: `다음 물음에 답하세요. ${match[2]}`, latex: null, rows: null }],
      answer: { kind: "self-check", options: null, correctIndex: null, accepted: [match[3]], before: "", after: "", explanation: "원문 근거와 비교해 보세요." },
    }));
    return JSON.stringify({ questions });
  }
  return null;
}

export function genFakeReply(step: GenStep, user: string): string {
  const v3 = v3Fake(step, user);
  if (v3 !== null) return v3;
  // Reading a page image: the fake has no eyes, so it returns the text layer it was given.
  if (step === "transcribe") return (user.split("[글자 층]\n")[1] ?? "").trim() || "(그림만 있는 쪽)";
  if (step === "outline") {
    const chosen = (/\[고른 쪽\] ([\d, ]+)/.exec(user)?.[1] ?? "1").split(",").map((value) => Number(value.trim())).filter(Boolean);
    return JSON.stringify({ sections: chosen.map((page) => ({ title: `${page}쪽 내용`, startText: "", pageStart: page, pageEnd: page, parts: [] })) });
  }
  if (step === "classify") {
    const items = [...pagesIn(user)].flatMap(([page, text]) => quotesFrom(text).map((quote, index) => ({
      kind: index === 0 ? "핵심 지식" : "예시", content: `p.${page}의 ${index === 0 ? "핵심" : "예시"}`, quote, page,
    })));
    return JSON.stringify({ items });
  }
  if (step === "design") {
    const objectives = [...user.matchAll(/^(\d+)\. \[(.+?)\] (.+?) \(p\.(\d+)\) 「/gm)]
      .filter((match) => !["예시", "연습문제", "부가 정보"].includes(match[2]))
      .map((match) => ({
        statement: `p.${match[4]}의 내용을 떠올릴 수 있다`, cue: `${match[4]}쪽에서 다룬 것`, recall: `${match[3]} 요지`,
        kind: "개념", importance: "core", itemNumbers: [Number(match[1])], materialNumbers: [],
      }));
    return JSON.stringify({ objectives });
  }
  const questions = [...user.matchAll(/^- id: (\S+) \[.+?\]\n  목표: .+\n  보고\(cue\): (.+)\n  떠올릴 것\(recall\): (.+)$/gm)].map((match) => ({
    objectiveId: match[1],
    stem: [{ kind: "text", text: `다음을 떠올려 보세요. ${match[2]}`, latex: null, rows: null }],
    answer: { kind: "self-check", options: null, correctIndex: null, accepted: [match[3]], before: "", after: "", explanation: "원문 근거와 비교해 보세요." },
  }));
  return JSON.stringify({ questions });
}
