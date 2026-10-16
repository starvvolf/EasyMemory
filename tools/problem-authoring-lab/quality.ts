import type { AuthoredQuestion, AuthoringBlock, AuthoringDocument, InspectionIssue, SharedQuestionSet } from "./contract.ts";
import { normalizeExactAnswer } from "./grading.ts";

// 작업지시 02: 출제 하네스가 말로 요구하는 품질 조건을 기계적으로 검사한다.
// 계약 검사(validateDocument)와 분리해 두어, 새 출제는 막되 이미 기록된 문서의 열람 여부는 따로 정할 수 있게 한다.

const loose = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
const tokens = (value: string) => (value.normalize("NFKC").toLocaleLowerCase("ko-KR").match(/[\p{L}\p{N}]{2,}/gu) ?? []);

function visibleBlockText(block: AuthoringBlock, options: { includeBlanks: boolean }): string {
  switch (block.kind) {
    case "text": return block.text;
    case "math": return block.latex;
    case "box": return block.label ?? "";
    case "table": return block.rows.flat().join(" ");
    case "image":
    case "generated-image": return block.alt;
    case "blank": return options.includeBlanks ? `${block.promptBefore} ${block.promptAfter}` : "";
    default: return "";
  }
}

/** Everything a learner can read before revealing answers, except the options themselves. */
function stemText(question: AuthoredQuestion, set: SharedQuestionSet | undefined) {
  return [...(set?.blocks ?? []), ...question.blocks].map((block) => visibleBlockText(block, { includeBlanks: true })).join(" ");
}

// Outside parentheses only, so a coordinate like (x,y,1) stays one element.
function topLevelParts(value: string, separators: RegExp) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && separators.test(char)) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function isCompositeAnswer(answer: string) {
  return topLevelParts(answer, /[;→]/).length >= 2 || topLevelParts(answer, /,/).length >= 3 || answer.trim().length > 25;
}

const CONDITION = /(지만|에 따라|경우|때만|단,|조건|[≠=]\s*0|가능)/;
const ABSOLUTE = /(모두 같|완전히 같|항상|반드시|절대|아무\s*(영향|관계)|전혀)/;
const INVERSE = /([A-Za-z])\s*(?:⁻¹|\^\{?-1\}?)/g;

export function inspectQuality(document: AuthoringDocument): InspectionIssue[] {
  const issues: InspectionIssue[] = [];
  const sets = new Map((document.sharedSets ?? []).map((set) => [set.id, set]));
  const signatures = new Map<string, string>();
  let choiceCount = 0;
  let correctLongest = 0;

  for (const question of document.questions) {
    const set = question.sharedSetId ? sets.get(question.sharedSetId) : undefined;
    const stem = stemText(question, set);
    const stemLoose = loose(stem);
    const numbers = (stem.match(/-?\d+(?:\.\d+)?/g) ?? []).sort().join(",");

    for (const response of question.responses) {
      if (response.kind === "single-choice") {
        const correct = response.options.find((option) => option.id === response.correctOptionId);
        const others = response.options.filter((option) => option.id !== response.correctOptionId);
        const text = (option: { text?: string; latex?: string }) => option.text ?? option.latex ?? "";
        if (correct) {
          const answer = text(correct);
          if (loose(answer).length >= 4 && stemLoose.includes(loose(answer))) {
            issues.push({ severity: "error", code: "answer-leak-before-reveal", message: "정답 보기 문장이 공개 전 문제 본문에 들어 있습니다.", questionId: question.id });
          }
          choiceCount += 1;
          if (others.every((option) => text(option).length < answer.length)) correctLongest += 1;
          const average = others.reduce((sum, option) => sum + text(option).length, 0) / Math.max(1, others.length);
          const conditionOnlyInCorrect = CONDITION.test(answer) && !others.some((option) => CONDITION.test(text(option)));
          if (others.length && (answer.length > average * 1.3 || conditionOnlyInCorrect)) {
            issues.push({ severity: "warning", code: "choice-length-cue", message: conditionOnlyInCorrect
              ? "정답 보기에만 조건이나 단서가 붙어 있습니다. 오답도 같은 수준으로 구체화하세요."
              : `정답 보기(${answer.length}자)가 오답 평균(${average.toFixed(0)}자)보다 1.3배 넘게 깁니다.`, questionId: question.id });
          }
        }
        if (others.some((option) => ABSOLUTE.test(text(option)))) {
          issues.push({ severity: "warning", code: "implausible-distractor", message: "오답에 티 나는 절대 표현(항상, 반드시, 모두 같다, 아무 영향 없다 등)이 있습니다. 흔한 오개념으로 바꾸세요.", questionId: question.id });
        }
        if (correct) signatures.set(`${numbers}|${loose(text(correct))}`, signatures.get(`${numbers}|${loose(text(correct))}`) ?? question.id);
        continue;
      }

      const answers = response.acceptedAnswers;
      const leaked = answers.some((answer) => {
        const normalized = normalizeExactAnswer(answer);
        if (normalized.length >= 3 && normalizeExactAnswer(stem).includes(normalized)) return true;
        const answerTokens = tokens(answer);
        // substring match so Korean particles (소스는 / 소스) still count
        return answerTokens.length >= 3 && answerTokens.filter((token) => stemLoose.includes(token)).length / answerTokens.length >= 0.7;
      });
      if (leaked) issues.push({ severity: "error", code: "answer-leak-before-reveal", message: "정답(또는 정답의 핵심 낱말 대부분)이 공개 전 문제 본문에 들어 있습니다.", questionId: question.id });

      if (response.grading === "exact-normalized" && answers.some(isCompositeAnswer)) {
        issues.push({ severity: "error", code: "composite-short-answer", message: "한 칸에 여러 요소를 쓰게 하는 답입니다. 요소별 빈칸, 순서 배열, 또는 self-check로 바꾸세요.", questionId: question.id });
      }

      const sourceNotations = new Set([...`${question.source.sourceText} ${question.source.knowledgeContent ?? ""}`.matchAll(INVERSE)].map((match) => match[1]));
      if (response.grading === "exact-normalized" && [...sourceNotations].some((letter) =>
        answers.some((answer) => answer.includes(`${letter}(`)) && !answers.some((answer) => new RegExp(`${letter}\\s*(?:⁻¹|\\^\\{?-1\\}?)`).test(answer)))) {
        issues.push({ severity: "warning", code: "source-notation-missing", message: "원문이 쓰는 역변환 표기(예: R⁻¹)가 인정 답안에 없습니다. 원문 표기를 인정 답안에 넣으세요.", questionId: question.id });
      }

      const key = `${numbers}|${answers.map(normalizeExactAnswer).sort().join("/")}`;
      const earlier = signatures.get(key);
      if (earlier && numbers) issues.push({ severity: "warning", code: "duplicate-item", message: `${earlier}와 본문 수치와 정답이 같습니다.`, questionId: question.id });
      else signatures.set(key, question.id);
    }

    const hasFigure = question.blocks.some((block) => block.kind === "image" || block.kind === "generated-image" || block.kind === "table");
    if (!hasFigure) {
      // The answer-reveal box is hidden before reveal, so the gap above it reads as empty space too.
      const ordered = [...question.blocks].sort((a, b) => a.frame.y - b.frame.y);
      const largestGap = ordered.slice(1).reduce((gap, block, index) =>
        Math.max(gap, block.frame.y - (ordered[index].frame.y + ordered[index].frame.height)), 0);
      if (largestGap > question.page.height * 0.3) {
        issues.push({ severity: "warning", code: "absolute-layout", message: "그림 없는 문항에서 블록 사이 빈 공간이 페이지 높이의 30%를 넘습니다. 흐름 배치를 쓰세요.", questionId: question.id });
      }
    }
  }
  // 작업지시 03 기준: 정답이 가장 긴 보기인 비율이 50%를 넘으면 문서 전체의 단서가 된다.
  if (choiceCount >= 4 && correctLongest / choiceCount > 0.5) {
    issues.push({ severity: "warning", code: "choice-longest-ratio", message: `객관식 ${choiceCount}개 중 ${correctLongest}개에서 정답이 가장 긴 보기입니다(기준 50% 이하).`, questionId: "document" });
  }
  return issues;
}
