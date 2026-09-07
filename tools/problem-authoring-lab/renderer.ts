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

function renderBlock(block: AuthoringBlock, question: AuthoredQuestion, state: RenderState) {
  const style = frameStyle(block);
  const responses = new Map(question.responses.map((response) => [response.id, response]));
  if (block.kind === "text") return `<div class="block text ${block.style ?? "body"}" data-block-id="${escapeHtml(block.id)}" style="${style}">${escapeHtml(block.text)}</div>`;
  if (block.kind === "box") return `<div class="block box ${block.tone ?? "plain"}" data-block-id="${escapeHtml(block.id)}" style="${style}">${escapeHtml(block.label ?? "")}</div>`;
  if (block.kind === "image") return `<figure class="block image" data-block-id="${escapeHtml(block.id)}" data-source-asset="${escapeHtml(block.sourceAssetRef.assetId)}" style="${style}"><div class="image-placeholder">원문 그림 · ${escapeHtml(block.alt)}</div></figure>`;
  if (block.kind === "table") return `<table class="block table" data-block-id="${escapeHtml(block.id)}" style="${style}">${block.rows.map((row, rowIndex) => `<tr>${row.map((cell) => `${rowIndex < (block.headerRows ?? 0) ? "<th>" : "<td>"}${escapeHtml(cell)}${rowIndex < (block.headerRows ?? 0) ? "</th>" : "</td>"}`).join("")}</tr>`).join("")}</table>`;
  if (block.kind === "choice-set") {
    const response = responses.get(block.responseId);
    if (!response || response.kind !== "single-choice") return "";
    return `<div class="block choices" data-block-id="${escapeHtml(block.id)}" style="${style};grid-template-columns:repeat(${block.columns ?? 1},minmax(0,1fr))">${block.optionIds.map((id, index) => {
      const option = response.options.find((item) => item.id === id)!;
      const checked = state.answers?.[response.id] === id ? " checked" : "";
      const correct = state.revealAnswers && response.correctOptionId === id ? " correct" : "";
      return `<label class="choice${correct}"><input type="radio" name="${escapeHtml(response.id)}" value="${escapeHtml(id)}"${checked}> <b>${index + 1}</b> ${escapeHtml(option.text)}</label>`;
    }).join("")}</div>`;
  }
  if (block.kind === "blank") {
    const answer = state.answers?.[block.responseId] ?? "";
    return `<div class="block blank" data-block-id="${escapeHtml(block.id)}" style="${style}"><span>${escapeHtml(block.promptBefore)}</span><input data-response-id="${escapeHtml(block.responseId)}" value="${escapeHtml(answer)}"><span>${escapeHtml(block.promptAfter)}</span></div>`;
  }
  if (!state.revealAnswers) return `<div class="block reveal hidden-answer" data-block-id="${escapeHtml(block.id)}" style="${style}">정답을 확인한 뒤 표시됩니다.</div>`;
  return `<div class="block reveal" data-block-id="${escapeHtml(block.id)}" style="${style}"><strong>${escapeHtml(block.title ?? "정답")}</strong>${block.responseIds.map((id) => `<p>${escapeHtml(answerText(responses.get(id)!) || "-")}</p>`).join("")}</div>`;
}

export function renderDocument(document: AuthoringDocument, state: RenderState) {
  const questions = document.questions.map((question, index) => `<section class="question-page" data-question-id="${escapeHtml(question.id)}" style="width:${question.page.width}px;height:${question.page.height}px"><div class="number">${index + 1}</div>${question.blocks.map((block) => renderBlock(block, question, state)).join("")}</section>`).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(document.title)}</title><style>${STYLES}</style></head><body><main><h1>${escapeHtml(document.title)}</h1><p class="mode">${state.revealAnswers ? "정답 공개 화면" : "풀이 화면"}</p>${questions}</main></body></html>`;
}

const STYLES = `
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#172033;font:15px/1.5 Arial,"Noto Sans KR",sans-serif}main{max-width:920px;margin:0 auto;padding:28px}h1{margin:0}.mode{color:#566176}.question-page{position:relative;margin:24px auto;background:white;border:1px solid #c8ced8;border-radius:12px;box-shadow:0 5px 18px #1c26351a;overflow:hidden}.number{position:absolute;left:18px;top:14px;font-weight:800}.block{position:absolute;overflow:auto}.text.heading{font-size:20px;font-weight:750}.text.caption{font-size:12px;color:#616b7d}.box{border:1.5px solid #6e7788;border-radius:7px;padding:10px}.box.accent{background:#eef5ff;border-color:#4878c7}.box.warning{background:#fff7df;border-color:#bd8b26}.image-placeholder{height:100%;border:1px dashed #738097;background:#f7f8fa;display:grid;place-items:center;text-align:center;padding:12px}.table{border-collapse:collapse}.table td,.table th{border:1px solid #7d8797;padding:7px}.choices{display:grid;gap:8px}.choice{border:1px solid #bbc3cf;border-radius:7px;padding:9px;background:#fff}.choice.correct{border-color:#218a55;background:#eaf8f0}.blank{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.blank input{min-width:130px;border:0;border-bottom:2px solid #1f2a3d;padding:5px;background:#f7f8fb}.reveal{padding:10px;border-radius:7px;background:#eaf8f0;border:1px solid #73b98f}.hidden-answer{background:#f4f5f7;border-color:#d5d9df;color:#697386}
`;
