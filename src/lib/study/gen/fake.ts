// A free stand-in for the model: builds valid replies from the prompt text itself, so the whole flow
// (including quote checks against the real page text) runs without a model. Used by tests and the lab's fake provider.
import type { GenStep } from "./types.ts";

function pagesIn(user: string) {
  const pages = new Map<number, string>();
  const body = user.split("[원문: 쪽별 추출 글자]\n")[1] ?? "";
  for (const match of body.matchAll(/\[p\.(\d+)\]\n([\s\S]*?)(?=\n\n\[p\.\d+\]\n|\n\n\[길이 제한\]|$)/g)) pages.set(Number(match[1]), match[2]);
  return pages;
}

/** The first one or two sentence-like pieces of a page, long enough to quote. */
function quotesFrom(text: string) {
  return text.split(/(?<=[.!?。])\s+|\n/).map((part) => part.trim()).filter((part) => part.length >= 12).slice(0, 2).map((part) => part.slice(0, 120));
}

export function genFakeReply(step: GenStep, user: string): string {
  if (step === "outline") {
    const chosen = (/\[고른 쪽\] ([\d, ]+)/.exec(user)?.[1] ?? "1").split(",").map((value) => Number(value.trim())).filter(Boolean);
    return JSON.stringify({ sections: chosen.map((page) => ({ title: `${page}쪽 내용`, pageStart: page, pageEnd: page })) });
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
