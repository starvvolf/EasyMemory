import type { AuthoringBlock, AuthoringDocument, AuthoredQuestion, ResponseContract } from "./contract.ts";

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

function answerText(response: ResponseContract) {
  if (response.kind === "single-choice") {
    return response.options.find((option) => option.id === response.correctOptionId)?.text ?? "";
  }
  return response.acceptedAnswers.join(" / ");
}

function answerDetail(response: ResponseContract) {
  const answer = answerText(response);
  return `${answer}${response.explanation ? ` — ${response.explanation}` : ""}`;
}

function renderBlock(block: AuthoringBlock, question: AuthoredQuestion, state: RenderState) {
  const style = frameStyle(block);
  const responses = new Map(question.responses.map((response) => [response.id, response]));
  if (block.kind === "text") return `<div class="block text ${block.style ?? "body"}" data-block-id="${escapeHtml(block.id)}" style="${style}">${escapeHtml(block.text)}</div>`;
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
      return `<label class="choice${correct}"><input type="radio" name="${escapeHtml(response.id)}" value="${escapeHtml(id)}"${checked}> <b>${index + 1}</b> ${escapeHtml(option?.text ?? "연결되지 않은 선지")}</label>`;
    }).join("")}</div>`;
  }
  if (block.kind === "blank") {
    const answer = state.answers?.[block.responseId] ?? "";
    return `<div class="block blank" data-block-id="${escapeHtml(block.id)}" style="${style}"><span>${escapeHtml(block.promptBefore)}</span><input data-response-id="${escapeHtml(block.responseId)}" value="${escapeHtml(answer)}"><span>${escapeHtml(block.promptAfter)}</span></div>`;
  }
  if (!state.revealAnswers) return `<div class="block reveal hidden-answer" data-block-id="${escapeHtml(block.id)}" data-response-ids="${escapeHtml(block.responseIds.join(","))}" style="${style}">정답을 확인한 뒤 표시됩니다.</div>`;
  return `<div class="block reveal" data-block-id="${escapeHtml(block.id)}" style="${style}"><strong>${escapeHtml(block.title ?? "정답")}</strong>${block.responseIds.map((id) => `<p>${escapeHtml(responses.has(id) ? answerDetail(responses.get(id)!) : "연결되지 않은 응답")}</p>`).join("")}</div>`;
}

export function renderDocument(document: AuthoringDocument, state: RenderState & { interactive?: boolean }) {
  const renderQuestion = (question: AuthoredQuestion, index: number) => `<section class="question-page" data-question-id="${escapeHtml(question.id)}" style="width:${question.page.width}px;height:${question.page.height}px"><div class="number">${index + 1}</div>${question.blocks.map((block) => renderBlock(block, question, state)).join("")}</section><div class="source-line">근거: ${escapeHtml(question.source.sourceRange)}</div>${state.interactive ? `<div class="question-actions" data-question-id="${escapeHtml(question.id)}"><button type="button" data-action="submit">제출</button><button type="button" data-action="reveal">정답 공개</button><output aria-live="polite"></output></div>` : ""}`;
  const renderedSets = new Set<string>();
  const sections = document.questions.map((question, index) => {
    if (!question.sharedSetId) return renderQuestion(question, index);
    if (renderedSets.has(question.sharedSetId)) return "";
    renderedSets.add(question.sharedSetId);
    const set = document.sharedSets?.find((item) => item.id === question.sharedSetId);
    if (!set) return renderQuestion(question, index);
    const setQuestion = { ...question, responses: [] };
    const shared = `<section class="question-page shared-page" data-shared-set-id="${escapeHtml(set.id)}" style="width:${set.page.width}px;height:${set.page.height}px"><div class="shared-label">공통 자료</div>${set.blocks.map((block) => renderBlock(block, setQuestion, state)).join("")}</section>`;
    const members = document.questions.map((member, memberIndex) => member.sharedSetId === set.id ? renderQuestion(member, memberIndex) : "").join("\n");
    return `<div class="shared-group" data-shared-group-id="${escapeHtml(set.id)}">${shared}${members}</div>`;
  }).join("\n");
  const contract = state.interactive ? `<script type="application/json" id="answer-contract">${JSON.stringify(document.questions.map((question) => ({ id: question.id, responses: question.responses }))).replace(/</g, "\\u003c")}</script><script>${INTERACTIVE_SCRIPT}</script>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=820"><title>${escapeHtml(document.title)}</title><style>${STYLES}</style></head><body><main><header class="document-header"><h1>${escapeHtml(document.title)}</h1><p class="mode">${state.interactive ? "직접 풀기" : state.revealAnswers ? "정답 공개 화면" : "풀이 화면"}</p></header>${sections}</main>${contract}</body></html>`;
}

export function renderInteractiveDocument(document: AuthoringDocument) {
  return renderDocument(document, { revealAnswers: false, interactive: true });
}

const INTERACTIVE_SCRIPT = `
const contracts = new Map(JSON.parse(document.getElementById("answer-contract").textContent).map(item => [item.id, item.responses]));
const normalize = value => value.normalize("NFKC").replace(/[\\u2212\\u2010-\\u2015]/g, "-").replace(/\\s+/g, "").toLocaleLowerCase("ko-KR");
document.querySelectorAll(".question-actions").forEach(actions => {
  const questionId = actions.dataset.questionId;
  const page = document.querySelector('.question-page[data-question-id="' + CSS.escape(questionId) + '"]');
  const responses = contracts.get(questionId) || [];
  const output = actions.querySelector("output");
  const answer = response => response.kind === "single-choice" ? (response.options.find(option => option.id === response.correctOptionId)?.text || "") : response.acceptedAnswers.join(" / ");
  actions.querySelector('[data-action="submit"]').addEventListener("click", () => {
    const results = responses.map(response => {
      const selected = response.kind === "single-choice" ? page.querySelector('input[name="' + CSS.escape(response.id) + '"]:checked')?.value : page.querySelector('input[data-response-id="' + CSS.escape(response.id) + '"]')?.value;
      if (!selected?.trim()) return "미입력";
      if (response.kind === "short-text" && response.grading === "self-check") return "직접 확인";
      const correct = response.kind === "single-choice" ? selected === response.correctOptionId : response.acceptedAnswers.some(expected => normalize(expected) === normalize(selected));
      return correct ? "정답" : "오답";
    });
    output.textContent = results.join(" · ");
  });
  actions.querySelector('[data-action="reveal"]').addEventListener("click", () => {
    page.querySelectorAll(".hidden-answer").forEach(block => {
      block.classList.remove("hidden-answer");
      const responseIds = (block.dataset.responseIds || "").split(",");
      const authored = responses.filter(response => responseIds.includes(response.id));
      block.textContent = authored.map(response => answer(response) + (response.explanation ? " — " + response.explanation : "")).join(" / ");
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
main{width:820px;margin:0 auto;padding:34px 30px 52px}
.document-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 4px 22px;padding:0 2px 18px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:26px;line-height:1.3;letter-spacing:-.035em;font-weight:700}
.mode{margin:0;color:var(--muted);font-size:13px;font-weight:600;white-space:nowrap}
.question-page{position:relative;margin:22px auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
.number{position:absolute;left:18px;top:14px;color:var(--accent);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.block{position:absolute;overflow:auto;overflow-wrap:anywhere}
.text.body{font-size:19px;line-height:1.55;font-weight:700;letter-spacing:-.025em;white-space:pre-line}
.text.heading{font-size:21px;line-height:1.45;font-weight:700;letter-spacing:-.03em;white-space:pre-line}
.text.caption{font-size:12px;color:var(--muted)}
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
.choice input{flex:0 0 auto;margin:4px 1px 0 0;accent-color:var(--accent)}
.choice b{flex:0 0 20px;color:var(--accent);font-variant-numeric:tabular-nums}
.choice.correct{border-color:#86d5a8;background:var(--success-soft)}
.choice.correct b{color:var(--success)}
.blank{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:16px;line-height:1.7}
.blank input{min-width:150px;height:42px;border:1px solid #cbd5e1;border-radius:11px;padding:8px 12px;background:var(--surface);color:var(--text);font:inherit;outline:none}
.blank input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.14)}
.reveal{padding:13px 15px;border-radius:var(--radius);background:var(--success-soft);border:1px solid #a6e7c1;color:#166534}
.reveal strong{display:block;margin-bottom:4px;font-weight:700}
.reveal p{margin:3px 0}
.hidden-answer{background:var(--surface-soft);border-color:var(--line);color:var(--muted)}
.shared-label{position:absolute;left:18px;top:14px;color:var(--accent);font-size:14px;font-weight:800}
.shared-group{margin-top:24px;padding:1px 0 12px;border-radius:18px;background:#eef2ff}
.shared-group .question-page{margin-top:14px}
.question-actions{width:760px;margin:-8px auto 22px;display:flex;align-items:center;gap:10px}
.question-actions button{border:1px solid #c7d2fe;background:#fff;color:#3730a3;border-radius:9px;padding:7px 13px;font:inherit;cursor:pointer}
.question-actions output{margin-left:auto;font-weight:700;color:var(--text)}
.source-line{width:760px;margin:-8px auto 13px;color:var(--muted);font-size:12px}
@media print{html,body{background:#fff}.document-header{margin-top:0}.question-page{break-inside:avoid;box-shadow:none}}
`;
