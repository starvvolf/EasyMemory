import type { AuthoringBlock, AuthoringDocument, AuthoredQuestion, ResponseContract } from "./contract.ts";
import { readFileSync } from "node:fs";
import katex from "katex";
import { normalizeExactAnswer } from "./grading.ts";

const KATEX_CSS = readFileSync(new URL("./assets/katex/katex.min.css", import.meta.url), "utf8")
  .replace(/url\(fonts\/([^)]*\.woff2)\) format\("woff2"\),url\(fonts\/[^)]*\.woff\) format\("woff"\),url\(fonts\/[^)]*\.ttf\) format\("truetype"\)/g,
    (_match, fontName: string) => `url(data:font/woff2;base64,${readFileSync(new URL(`./assets/katex/fonts/${fontName}`, import.meta.url)).toString("base64")}) format("woff2")`);
if (KATEX_CSS.includes("url(fonts/")) throw new Error("KaTeX 폰트를 미리보기에 포함하지 못했습니다.");

export type RenderState = {
  revealAnswers: boolean;
  answers?: Record<string, string>;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function frameStyle(block: AuthoringBlock) {
  const { x, y, width, height } = block.frame;
  return `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
}

function renderMath(latex: string, displayMode = false) {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: true, trust: false });
  } catch {
    return `<span class="math-error" title="수식 문법 오류">${escapeHtml(latex)}</span>`;
  }
}

function answerHtml(response: ResponseContract) {
  if (response.kind === "single-choice") {
    const option = response.options.find((item) => item.id === response.correctOptionId);
    return option?.latex ? renderMath(option.latex) : escapeHtml(option?.text ?? "");
  }
  return response.acceptedAnswers.map((answer) => {
    const wrapped = /^\\\(([\s\S]*)\\\)$/.exec(answer.trim());
    const latex = wrapped?.[1] ?? answer.trim();
    return wrapped || /\\(?:begin|frac|sqrt|left|right|theta|alpha|beta|gamma|pi|sin|cos|tan|cdot|times|mathrm|text)\b/.test(latex)
      ? renderMath(latex) : escapeHtml(answer);
  }).join(" / ");
}

function answerDetailHtml(response: ResponseContract) {
  return `${answerHtml(response)}${response.explanation ? ` — ${escapeHtml(response.explanation)}` : ""}`;
}

function renderBlock(block: AuthoringBlock, question: AuthoredQuestion, state: RenderState) {
  const style = frameStyle(block);
  const responses = new Map(question.responses.map((response) => [response.id, response]));
  if (block.kind === "text") return `<div class="block text ${block.style ?? "body"}" data-block-id="${escapeHtml(block.id)}" style="${style}">${escapeHtml(block.text)}</div>`;
  if (block.kind === "math") return `<div class="block math" data-block-id="${escapeHtml(block.id)}" style="${style}">${renderMath(block.latex, block.displayMode ?? true)}</div>`;
  if (block.kind === "box") return `<div class="block box ${block.tone ?? "plain"}" data-block-id="${escapeHtml(block.id)}" style="${style}">${escapeHtml(block.label ?? "")}</div>`;
  if (block.kind === "image") return `<figure class="block image" data-block-id="${escapeHtml(block.id)}" data-source-asset="${escapeHtml(block.sourceAssetRef.assetId)}" style="${style}"><div class="image-placeholder">원문 그림 · ${escapeHtml(block.alt)}</div></figure>`;
  if (block.kind === "generated-image") return `<figure class="block generated-image" data-block-id="${escapeHtml(block.id)}" data-generated-asset="${escapeHtml(block.generatedAssetRef.assetId)}" style="${style}"><img src="${escapeHtml(block.generatedAssetRef.path)}" alt="${escapeHtml(block.alt)}">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`;
  if (block.kind === "table") return `<table class="block table" data-block-id="${escapeHtml(block.id)}" style="${style}">${block.rows.map((row, rowIndex) => `<tr>${row.map((cell) => `${rowIndex < (block.headerRows ?? 0) ? "<th>" : "<td>"}${escapeHtml(cell)}${rowIndex < (block.headerRows ?? 0) ? "</th>" : "</td>"}`).join("")}</tr>`).join("")}</table>`;
  if (block.kind === "choice-set") {
    const response = responses.get(block.responseId);
    if (!response || response.kind !== "single-choice") return "";
    return `<div class="block choices" data-block-id="${escapeHtml(block.id)}" style="${style};grid-template-columns:repeat(${block.columns ?? 1},minmax(0,1fr))">${block.optionIds.map((id, index) => {
      const option = response.options.find((item) => item.id === id);
      const checked = state.answers?.[response.id] === id ? " checked" : "";
      const correct = state.revealAnswers && response.correctOptionId === id ? " correct" : "";
      const content = option?.latex ? renderMath(option.latex) : escapeHtml(option?.text ?? "연결되지 않은 선지");
      return `<label class="choice${correct}"><input type="radio" name="${escapeHtml(response.id)}" value="${escapeHtml(id)}"${checked}> <b>${index + 1}</b> <span class="choice-content">${content}</span></label>`;
    }).join("")}</div>`;
  }
  if (block.kind === "blank") {
    const answer = state.answers?.[block.responseId] ?? "";
    const label = `${block.promptBefore} ${block.promptAfter}`.trim() || "답 입력";
    const response = responses.get(block.responseId);
    const longAnswer = response?.kind === "short-text" && response.grading === "self-check";
    const field = longAnswer
      ? `<textarea aria-label="${escapeHtml(label)}" data-response-id="${escapeHtml(block.responseId)}" rows="4">${escapeHtml(answer)}</textarea>`
      : `<input aria-label="${escapeHtml(label)}" data-response-id="${escapeHtml(block.responseId)}" value="${escapeHtml(answer)}">`;
    return `<div class="block blank${longAnswer ? " long-answer" : ""}" data-block-id="${escapeHtml(block.id)}" style="${style}"><span>${escapeHtml(block.promptBefore)}</span>${field}<span>${escapeHtml(block.promptAfter)}</span></div>`;
  }
  if (!state.revealAnswers) return `<div class="block reveal hidden-answer" data-block-id="${escapeHtml(block.id)}" data-response-ids="${escapeHtml(block.responseIds.join(","))}" style="${style}">정답을 확인한 뒤 표시됩니다.</div>`;
  return `<div class="block reveal" data-block-id="${escapeHtml(block.id)}" style="${style}"><strong>${escapeHtml(block.title ?? "정답")}</strong>${block.responseIds.map((id) => `<p>${responses.has(id) ? answerDetailHtml(responses.get(id)!) : "연결되지 않은 응답"}</p>`).join("")}</div>`;
}

export function renderDocument(document: AuthoringDocument, state: RenderState & { interactive?: boolean }) {
  const renderQuestion = (question: AuthoredQuestion, index: number) => {
    const pages = [...new Set(question.source.sourcePages?.length ? question.source.sourcePages : [question.source.sourcePage])].join(", ");
    const evidence = state.revealAnswers ? `<span class="source-evidence"> · 근거: ${escapeHtml(question.source.sourceRange)}${question.source.knowledgeContent ? ` · 학습 내용: ${escapeHtml(question.source.knowledgeContent)}` : ""}</span>` : "";
    return `<article class="question-shell" style="width:${question.page.width}px"><section class="question-page" data-question-id="${escapeHtml(question.id)}" style="width:${question.page.width}px;height:${question.page.height}px"><div class="number">${index + 1}</div>${question.blocks.map((block) => renderBlock(block, question, state)).join("")}</section><div class="source-line">원문 ${escapeHtml(pages)}쪽${evidence}</div>${state.interactive ? `<div class="question-actions" data-question-id="${escapeHtml(question.id)}"><button type="button" data-action="submit">제출</button><button type="button" data-action="reveal">정답 공개</button><output aria-live="polite"></output></div>` : ""}</article>`;
  };
  const renderedSets = new Set<string>();
  const sections = document.questions.map((question, index) => {
    if (!question.sharedSetId) return renderQuestion(question, index);
    if (renderedSets.has(question.sharedSetId)) return "";
    renderedSets.add(question.sharedSetId);
    const set = document.sharedSets?.find((item) => item.id === question.sharedSetId);
    if (!set) return renderQuestion(question, index);
    const setQuestion = { ...question, responses: [] };
    const hasSharedHeading = set.blocks.some((block) => block.kind === "text" && block.text.trim().startsWith("공통 자료"));
    const shared = `<section class="question-page shared-page" data-shared-set-id="${escapeHtml(set.id)}" style="width:${set.page.width}px;height:${set.page.height}px">${hasSharedHeading ? "" : '<div class="shared-label">공통 자료</div>'}${set.blocks.map((block) => renderBlock(block, setQuestion, state)).join("")}</section>`;
    const members = document.questions.map((member, memberIndex) => member.sharedSetId === set.id ? renderQuestion(member, memberIndex) : "").join("\n");
    return `<div class="shared-group" data-shared-group-id="${escapeHtml(set.id)}">${shared}${members}</div>`;
  }).join("\n");
  const contract = state.interactive ? `<script type="application/json" id="answer-contract">${JSON.stringify(document.questions.map((question) => ({ id: question.id, responses: question.responses.map((response) => ({ ...response, displayAnswerHtml: answerHtml(response) })) }))).replace(/</g, "\\u003c")}</script><script type="application/octet-stream" id="source-contract">${Buffer.from(JSON.stringify(document.questions.map((question) => ({ id: question.id, sourceRange: question.source.sourceRange, knowledgeContent: question.source.knowledgeContent ?? "" })))).toString("base64")}</script><script>${INTERACTIVE_SCRIPT}</script>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.title)}</title><style>${KATEX_CSS}\n${STYLES}</style></head><body><main><header class="document-header"><h1>${escapeHtml(document.title)}</h1><p class="mode">${state.interactive ? "직접 풀기" : state.revealAnswers ? "정답 공개 화면" : "풀이 화면"}</p></header>${sections}</main>${contract}<script>${LAYOUT_SCRIPT}</script></body></html>`;
}

export function renderInteractiveDocument(document: AuthoringDocument) {
  return renderDocument(document, { revealAnswers: false, interactive: true });
}

const LAYOUT_SCRIPT = `
(() => {
  const pages = [...document.querySelectorAll(".question-page")];
  const mobile = window.matchMedia("(max-width: 820px)");
  const fitAnswers = () => {
    for (const page of pages) {
      if (mobile.matches) {
        page.style.removeProperty("min-height");
        continue;
      }
      const authoredHeight = Number.parseFloat(page.dataset.authoredHeight || page.style.height) || 0;
      page.dataset.authoredHeight = String(authoredHeight);
      const longAnswerBottom = Math.max(0, ...[...page.querySelectorAll(".blank.long-answer")].map(block => block.offsetTop + block.offsetHeight));
      const reveals = [...page.querySelectorAll(".reveal")];
      for (const block of reveals) {
        const authoredTop = Number.parseFloat(block.dataset.authoredTop || block.style.top) || 0;
        block.dataset.authoredTop = String(authoredTop);
        if (longAnswerBottom) block.style.top = Math.max(authoredTop, longAnswerBottom + 16) + "px";
      }
      const answerBottom = Math.max(0, ...reveals.map(block => block.offsetTop + block.offsetHeight + 16));
      page.style.minHeight = Math.max(authoredHeight, longAnswerBottom + 16, answerBottom) + "px";
    }
  };
  new MutationObserver(fitAnswers).observe(document.querySelector("main"), { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  const sizeObserver = new ResizeObserver(fitAnswers);
  document.querySelectorAll(".blank.long-answer textarea").forEach(field => sizeObserver.observe(field));
  window.addEventListener("resize", fitAnswers);
  fitAnswers();
})();`;

const INTERACTIVE_SCRIPT = `
const contracts = new Map(JSON.parse(document.getElementById("answer-contract").textContent).map(item => [item.id, item.responses]));
const sourceContracts = new Map(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById("source-contract").textContent), character => character.charCodeAt(0)))).map(item => [item.id, item]));
const normalize = ${normalizeExactAnswer.toString()};
const eventChannel = (() => {
  if (window.parent === window) return null;
  try {
    const data = JSON.parse(window.name);
    if (data.type !== "study-forge:personalization-channel" || typeof data.channel !== "string" || !data.channel || typeof data.runId !== "string" || typeof data.documentHash !== "string") return null;
    const origin = new URL(data.parentOrigin).origin;
    if (!/^https?:\\/\\//.test(origin)) return null;
    return { origin, channel: data.channel, runId: data.runId, documentHash: data.documentHash };
  } catch { return null; }
})();
const emitProblemEvent = event => {
  if (!eventChannel) return;
  window.parent.postMessage({ type: "study-forge:problem-event", version: 1, channel: eventChannel.channel, runId: eventChannel.runId, documentHash: eventChannel.documentHash, ...event, occurredAt: new Date().toISOString() }, eventChannel.origin);
};
const questionShells = [...document.querySelectorAll(".question-page[data-question-id]")]
  .map(page => ({ questionId: page.dataset.questionId, shell: page.closest(".question-shell") }))
  .filter(item => item.questionId && item.shell);
let viewedQuestionId = "";
const emitQuestionView = (questionId, force = false) => {
  if (!eventChannel || (!force && viewedQuestionId === questionId)) return;
  viewedQuestionId = questionId;
  window.parent.postMessage({ type: "study-forge:question-view", version: 1, channel: eventChannel.channel, runId: eventChannel.runId, documentHash: eventChannel.documentHash, questionId, occurredAt: new Date().toISOString() }, eventChannel.origin);
};
if (eventChannel) {
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== eventChannel.origin) return;
    const data = event.data;
    if (!data || data.type !== "study-forge:navigate-question" || data.version !== 1 ||
        data.channel !== eventChannel.channel || data.runId !== eventChannel.runId ||
        data.documentHash !== eventChannel.documentHash || typeof data.questionId !== "string" ||
        data.parentOrigin !== eventChannel.origin) return;
    const target = questionShells.find(item => item.questionId === data.questionId);
    if (!target) return;
    target.shell.setAttribute("tabindex", "-1");
    target.shell.scrollIntoView({ block: "start" });
    target.shell.focus({ preventScroll: true });
    emitQuestionView(target.questionId, true);
  });
  let viewFrame = 0;
  const reportVisibleQuestion = () => {
    viewFrame = 0;
    const anchor = window.innerHeight * 0.35;
    const current = questionShells.reduce((best, item) => {
      const bounds = item.shell.getBoundingClientRect();
      const distance = bounds.top <= anchor && bounds.bottom >= anchor ? 0 : Math.min(Math.abs(bounds.top - anchor), Math.abs(bounds.bottom - anchor));
      return !best || distance < best.distance ? { questionId: item.questionId, distance } : best;
    }, null);
    if (current) emitQuestionView(current.questionId);
  };
  window.addEventListener("scroll", () => { if (!viewFrame) viewFrame = window.requestAnimationFrame(reportVisibleQuestion); }, { passive: true });
  window.addEventListener("resize", reportVisibleQuestion);
  window.requestAnimationFrame(reportVisibleQuestion);
}
document.querySelectorAll(".question-actions").forEach(actions => {
  const questionId = actions.dataset.questionId;
  const page = document.querySelector('.question-page[data-question-id="' + CSS.escape(questionId) + '"]');
  const responses = contracts.get(questionId) || [];
  const output = actions.querySelector("output");
  page.querySelectorAll('.choice input').forEach(input => input.addEventListener("change", () => emitProblemEvent({ action: "select", questionId, responseId: input.name })));
  page.querySelectorAll('input[data-response-id],textarea[data-response-id]').forEach(input => input.addEventListener("input", () => emitProblemEvent({ action: "input", questionId, responseId: input.dataset.responseId })));
  actions.querySelector('[data-action="submit"]').addEventListener("click", () => {
    const results = responses.map(response => {
      const selected = response.kind === "single-choice" ? page.querySelector('input[name="' + CSS.escape(response.id) + '"]:checked')?.value : page.querySelector('[data-response-id="' + CSS.escape(response.id) + '"]')?.value;
      if (!selected?.trim()) {
        emitProblemEvent({ action: "submit", questionId, responseId: response.id, correct: null });
        return "미입력";
      }
      if (response.kind === "short-text" && response.grading === "self-check") {
        emitProblemEvent({ action: "submit", questionId, responseId: response.id, correct: null });
        return "직접 확인";
      }
      const correct = response.kind === "single-choice" ? selected === response.correctOptionId : response.acceptedAnswers.some(expected => normalize(expected) === normalize(selected));
      emitProblemEvent({ action: "submit", questionId, responseId: response.id, correct });
      return correct ? "정답" : "오답";
    });
    output.textContent = revealed ? "정답 공개 후 제출(독립 풀이 기록 제외)" : results.join(" · ");
  });
  let revealed = false;
  actions.querySelector('[data-action="reveal"]').addEventListener("click", () => {
    if (revealed) return;
    emitProblemEvent({ action: "reveal", questionId });
    revealed = true;
    const evidence = sourceContracts.get(questionId);
    if (evidence) {
      const sourceLine = actions.closest(".question-shell").querySelector(".source-line");
      const detail = document.createElement("span");
      detail.className = "source-evidence";
      detail.textContent = " · 근거: " + evidence.sourceRange + (evidence.knowledgeContent ? " · 학습 내용: " + evidence.knowledgeContent : "");
      sourceLine.append(detail);
    }
    page.querySelectorAll(".hidden-answer").forEach(block => {
      block.classList.remove("hidden-answer");
      const responseIds = (block.dataset.responseIds || "").split(",");
      const authored = responses.filter(response => responseIds.includes(response.id));
      block.replaceChildren();
      authored.forEach((response, index) => {
        if (index) block.append(document.createTextNode(" / "));
        if (response.kind === "single-choice") {
          const correct = [...page.querySelectorAll('.choice input')].find(input => input.name === response.id && input.value === response.correctOptionId);
          const content = correct?.closest('.choice')?.querySelector('.choice-content');
          if (content) block.append(content.cloneNode(true));
        } else {
          const answer = document.createElement("span");
          answer.innerHTML = response.displayAnswerHtml;
          block.append(answer);
        }
        if (response.explanation) block.append(document.createTextNode(" — " + response.explanation));
      });
    });
    page.querySelectorAll(".choice").forEach(label => {
      const input = label.querySelector("input");
      if (responses.some(response => response.kind === "single-choice" && response.id === input?.name && response.correctOptionId === input.value)) label.classList.add("correct");
    });
  });
});`;

const STYLES = `
@font-face{font-family:"Pretendard Variable";src:url("../../../assets/fonts/pretendard-1.3.9/PretendardVariable.woff2") format("woff2");font-style:normal;font-weight:45 920;font-display:swap}
*{box-sizing:border-box}
:root{--canvas:#f4f6f9;--surface:#fff;--surface-soft:#f8fafc;--text:#182230;--muted:#667085;--line:#dfe4ea;--accent:#4f46e5;--accent-soft:#eef2ff;--success:#14804a;--success-soft:#ecfdf3;--warning:#b54708;--warning-soft:#fff7ed;--radius:14px;--shadow:0 8px 24px rgba(16,24,40,.07)}
html{background:var(--canvas)}
body{margin:0;background:var(--canvas);color:var(--text);font:400 15px/1.65 "Pretendard Variable",system-ui,-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif;letter-spacing:-.01em;-webkit-font-smoothing:antialiased}
main{width:min(100%,820px);margin:0 auto;padding:34px 30px 52px}
.document-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 4px 22px;padding:0 2px 18px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:26px;line-height:1.3;letter-spacing:-.035em;font-weight:700}
.mode{margin:0;color:var(--muted);font-size:13px;font-weight:600;white-space:nowrap}
.question-shell{width:760px;max-width:100%;margin:22px auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
.question-page{position:relative;max-width:100%;margin:0 auto;background:var(--surface);overflow:hidden}
.shared-page{margin:14px auto;border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.number{position:absolute;left:18px;top:14px;color:var(--accent);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.block{position:absolute;overflow:auto;overflow-wrap:anywhere}
.text.body{font-size:19px;line-height:1.55;font-weight:700;letter-spacing:-.025em;white-space:pre-line}
.text.heading{font-size:21px;line-height:1.45;font-weight:700;letter-spacing:-.03em;white-space:pre-line}
.text.caption{font-size:12px;color:var(--muted)}
.math{font-size:20px;display:flex;align-items:center;justify-content:center;min-height:max-content;overflow:visible}
.math .katex-display{margin:0}
.math-error{color:#b42318;white-space:pre-wrap}
.box{padding:14px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-soft);white-space:pre-line;color:#344054}
.box.accent{background:var(--accent-soft);border-color:#c7d2fe;color:#3730a3}
.box.warning{background:var(--warning-soft);border-color:#fed7aa;color:var(--warning)}
.image-placeholder{height:100%;border:1px dashed #98a2b3;border-radius:var(--radius);background:var(--surface-soft);display:grid;place-items:center;text-align:center;padding:14px;color:var(--muted)}
.generated-image{margin:0;padding:12px;border:1px solid var(--line);border-radius:var(--radius);background:#fff;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:6px;overflow:hidden}
.generated-image img{display:block;width:100%;height:100%;object-fit:contain}
.generated-image figcaption{color:var(--muted);font-size:12px;line-height:1.4;text-align:center}
.table{border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--surface)}
.table td,.table th{border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:middle}
.table th{background:var(--surface-soft);color:#344054;font-weight:700}
.table tr:last-child>*{border-bottom:0}
.table tr>*:last-child{border-right:0}
.choices{display:grid;gap:10px}
.choice{display:flex;align-items:flex-start;gap:9px;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:11px 14px;background:var(--surface);line-height:1.5;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
.choice:hover{border-color:#a5b4fc;background:#fafaff}
.choice:focus-within{outline:3px solid rgba(79,70,229,.16);border-color:var(--accent)}
.choice:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.choice input{flex:0 0 auto;margin:4px 1px 0 0;accent-color:var(--accent)}
.choice b{flex:0 0 20px;color:var(--accent);font-variant-numeric:tabular-nums}
.choice-content{min-width:0;flex:1;display:flex;align-items:center;overflow:visible}
.choice-content .katex{font-size:1.15em}
.choice.correct{border-color:#86d5a8;background:var(--success-soft)}
.choice.correct b{color:var(--success)}
.blank{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:16px;line-height:1.7}
.blank input,.blank textarea{border:1px solid #cbd5e1;border-radius:11px;padding:8px 12px;background:var(--surface);color:var(--text);font:inherit;outline:none}
.blank input{width:min(100%,360px);min-width:150px;height:42px}
.blank.long-answer{height:auto!important;min-height:140px;flex-direction:column;align-items:stretch;overflow:visible}
.blank textarea{width:100%;min-height:104px;resize:vertical;line-height:1.5}
.blank input:focus,.blank textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.14)}
.reveal{height:auto!important;min-height:50px;padding:13px 15px;border-radius:var(--radius);background:var(--success-soft);border:1px solid #a6e7c1;color:#166534;overflow:visible}
.reveal strong{display:block;margin-bottom:4px;font-weight:700}
.reveal p{margin:3px 0;overflow-x:auto}
.hidden-answer{background:var(--surface-soft);border-color:var(--line);color:var(--muted)}
.shared-label{position:absolute;left:18px;top:14px;color:var(--accent);font-size:14px;font-weight:800}
.shared-group{margin-top:24px;padding:1px 0 12px;border-radius:18px;background:#eef2ff}
.shared-group .shared-page{margin-top:14px}
.question-actions{margin:0;padding:12px 18px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.question-actions button{min-height:44px;border:1px solid #c7d2fe;background:#fff;color:#3730a3;border-radius:11px;padding:9px 15px;font:inherit;cursor:pointer}
.question-actions button[data-action="submit"]{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700}
.question-actions button:focus-visible{outline:3px solid rgba(79,70,229,.25);outline-offset:2px}
.question-actions output:not(:empty){flex-basis:100%;padding:10px 14px;border-radius:11px;background:var(--surface);border:1px solid var(--line);font-weight:700;color:var(--text)}
.source-line{margin:0;padding:0 18px 8px;color:var(--muted);font-size:12px}
@media(max-width:820px){
  main{padding:24px 14px 42px}
  .document-header{align-items:flex-start;flex-direction:column;gap:4px}
  h1{font-size:23px}
  .question-shell{width:100%!important;margin:18px auto;overflow:visible}
  .question-page{width:100%!important;height:auto!important;min-height:0!important;margin:0;padding:20px 18px;display:flex;flex-direction:column;gap:14px;overflow:visible}
  .shared-page{margin:18px auto}
  .number,.shared-label{position:static}
  .block{position:static!important;width:100%!important;height:auto!important;overflow:visible!important}
  .text.heading{font-size:20px}
  .choices{grid-template-columns:1fr!important}
  .choice{min-height:52px}
  .blank input{max-width:100%}
  .shared-group{padding:1px 10px 10px}
  .shared-group .question-page{width:100%!important}
}
@media print{html,body{background:#fff}.document-header{margin-top:0}.question-page{break-inside:avoid;box-shadow:none}}
`;
