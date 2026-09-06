const stageOrder = ["analyze", "plan", "recall", "prepare", "cards", "critic", "finalCards"];
const state = { runs: [], selected: null, run: null, stage: "analyze", activeJobId: null, selectedPdf: null };

const elements = {
  runList: document.querySelector("#run-list"),
  runHeader: document.querySelector("#run-header"),
  tabs: document.querySelector("#stage-tabs"),
  content: document.querySelector("#stage-content"),
  developerToggle: document.querySelector("#developer-toggle"),
  developerPanel: document.querySelector("#developer-panel"),
  refresh: document.querySelector("#refresh-runs"),
  newExperiment: document.querySelector("#new-experiment"),
  dialog: document.querySelector("#experiment-dialog"),
  form: document.querySelector("#experiment-form"),
  pdfInput: document.querySelector("#pdf-input"),
  pdfStatus: document.querySelector("#pdf-status"),
  learningGoal: document.querySelector("#learning-goal"),
  runExperiment: document.querySelector("#run-experiment"),
  inputs: document.querySelector("#experiment-inputs"),
  progress: document.querySelector("#experiment-progress"),
  experimentError: document.querySelector("#experiment-error"),
  cancelExperiment: document.querySelector("#cancel-experiment"),
  closeExperiment: document.querySelector("#close-experiment"),
};

const progressLabels = { analyze: "자료 이해", plan: "학습 계획", recall: "인출 방식 설계", prepare: "학습 단위", cards: "카드 생성", critic: "결과 검사", finalCards: "최종 결과" };
const statusLabels = { waiting: "대기", running: "실행 중", completed: "완료", failed: "실패" };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "시간 정보 없음";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `요청 실패: ${response.status}`);
  return value;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateExperimentButton() {
  elements.runExperiment.disabled = !state.selectedPdf || Boolean(state.activeJobId);
}

function openExperiment() {
  elements.inputs.hidden = false;
  elements.progress.hidden = true;
  elements.experimentError.hidden = true;
  elements.runExperiment.textContent = "실행";
  updateExperimentButton();
  elements.dialog.showModal();
}

function closeExperiment() {
  if (state.activeJobId) return;
  elements.dialog.close();
}

function renderProgress(job) {
  elements.progress.hidden = false;
  elements.progress.innerHTML = Object.entries(progressLabels).map(([stage, label]) => {
    const status = job.stages?.[stage]?.status ?? "waiting";
    return `<div class="progress-row ${escapeHtml(status)}"><span>${escapeHtml(label)}</span><span>${escapeHtml(statusLabels[status] ?? status)}</span></div>`;
  }).join("");
}

async function pollJob(jobId) {
  while (state.activeJobId === jobId) {
    const job = await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    renderProgress(job);
    if (job.status === "completed") {
      state.activeJobId = null;
      elements.runExperiment.textContent = "완료";
      elements.cancelExperiment.disabled = false;
      elements.closeExperiment.disabled = false;
      await loadRuns(false);
      elements.dialog.close();
      await selectRun(job.caseId, job.runId);
      return;
    }
    if (job.status === "failed") {
      state.activeJobId = null;
      elements.runExperiment.textContent = "실패";
      elements.experimentError.hidden = false;
      elements.experimentError.innerHTML = `<strong>${escapeHtml(progressLabels[job.activeStage] ?? job.activeStage ?? "실행")} 단계 실패</strong><p>${escapeHtml(job.error ?? "알 수 없는 오류")}</p>`;
      elements.cancelExperiment.disabled = false;
      elements.closeExperiment.disabled = false;
      await loadRuns(false);
      updateExperimentButton();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function submitExperiment(event) {
  event.preventDefault();
  if (!state.selectedPdf || state.activeJobId) return;
  const goal = elements.learningGoal.value.trim();
  if (!goal) { elements.experimentError.hidden = false; elements.experimentError.textContent = "학습 목표를 입력하세요."; return; }
  elements.experimentError.hidden = true;
  elements.inputs.hidden = true;
  elements.runExperiment.disabled = true;
  elements.runExperiment.textContent = "실행 중";
  elements.cancelExperiment.disabled = true;
  elements.closeExperiment.disabled = true;
  renderProgress({ stages: {} });
  try {
    const query = new URLSearchParams({ fileName: state.selectedPdf.name, learningGoal: goal });
    const response = await fetch(`/api/experiments?${query}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: state.selectedPdf });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `실행 요청 실패: ${response.status}`);
    state.activeJobId = value.jobId;
    await pollJob(value.jobId);
  } catch (error) {
    state.activeJobId = null;
    elements.experimentError.hidden = false;
    elements.experimentError.textContent = error.message;
    elements.cancelExperiment.disabled = false;
    elements.closeExperiment.disabled = false;
    updateExperimentButton();
  }
}

function renderRunList() {
  if (!state.runs.length) {
    elements.runList.innerHTML = '<div class="empty-state"><span>저장된 run이 없습니다.</span></div>';
    return;
  }
  elements.runList.innerHTML = state.runs.map((run) => `
    <button class="run-item ${state.selected === `${run.caseId}/${run.runId}` ? "active" : ""} ${run.status === "invalid" ? "invalid" : ""}"
      data-case="${escapeHtml(run.caseId)}" data-run="${escapeHtml(run.runId)}" ${run.status === "invalid" ? "title=\"깨진 run manifest\"" : ""}>
      <span class="run-title">${escapeHtml(run.label)}</span>
      <span class="run-meta"><span>${escapeHtml(run.caseTitle)}</span><span>${escapeHtml(formatDate(run.timestamp))}</span></span>
      <span class="run-meta"><span class="pill">${escapeHtml(run.kind)}</span>${run.variant ? `<span class="pill">${escapeHtml(run.variant)}</span>` : ""}${run.sourceRunId ? '<span class="pill">rerun</span>' : ""}</span>
      ${run.error ? `<span class="run-meta">${escapeHtml(run.error)}</span>` : ""}
    </button>`).join("");
  elements.runList.querySelectorAll(".run-item:not(.invalid)").forEach((button) => button.addEventListener("click", () => selectRun(button.dataset.case, button.dataset.run)));
}

function renderHeader() {
  const run = state.run;
  if (!run) return;
  const manifest = run.manifest;
  const label = run.identity.runId.split("__")[1] ?? run.identity.runId;
  elements.runHeader.innerHTML = `
    <div><p class="eyebrow">${escapeHtml(run.identity.caseId)}</p><h1>${escapeHtml(label)}</h1>
    <p>${escapeHtml(run.identity.runId)} · ${escapeHtml(manifest.runKind ?? "unknown")} · ${escapeHtml(formatDate(manifest.completedAt ?? manifest.capturedAt))}</p></div>
    <button id="developer-toggle" class="command-button">실행 정보</button>`;
  elements.developerToggle = document.querySelector("#developer-toggle");
  elements.developerToggle.addEventListener("click", toggleDeveloper);
}

function renderDeveloper() {
  const run = state.run;
  const stage = run?.stages?.[state.stage];
  if (!run || !stage) return;
  const manifest = run.manifest;
  const model = stage.developer?.modelConfiguration;
  const entries = [
    ["Artifact path", `${run.identity.artifactPath}/${stage.developer?.relativePath ?? ""}`],
    ["Stage status", stage.developer?.lineage?.status ?? stage.status],
    ["Model", model?.model ?? "기록 없음"],
    ["Reasoning effort", model?.reasoningEffort ?? "기록 없음"],
    ["Checksum", stage.developer?.checksum ?? "기록 없음"],
    ["Source run", manifest.sourceRunId ?? stage.developer?.lineage?.sourceRunId ?? "없음"],
    ["From stage", manifest.fromStage ?? "legacy/browser run"],
    ["Override", manifest.overrideFile ?? "없음"],
    ["Git commit", manifest.code?.gitCommit ?? "기록 없음"],
    ["Git dirty", manifest.code?.gitDirty == null ? "기록 없음" : String(manifest.code.gitDirty)],
  ];
  elements.developerPanel.innerHTML = `<dl class="developer-grid">${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function toggleDeveloper() {
  elements.developerPanel.hidden = !elements.developerPanel.hidden;
  if (!elements.developerPanel.hidden) renderDeveloper();
}

function renderTabs() {
  const stages = state.run?.stages ?? {};
  elements.tabs.innerHTML = stageOrder.map((id) => {
    const stage = stages[id];
    return `<button class="stage-tab ${state.stage === id ? "active" : ""} ${stage?.status !== "available" ? "missing" : ""}" data-stage="${id}"><strong>${escapeHtml(stage?.label ?? id)}</strong><span>${escapeHtml(stage?.technicalLabel ?? id)}</span></button>`;
  }).join("") + '<button class="stage-tab missing" disabled><strong>훈련 방식 설계</strong><span>현재 미구현</span></button>';
  elements.tabs.querySelectorAll("[data-stage]").forEach((button) => button.addEventListener("click", () => { state.stage = button.dataset.stage; renderTabs(); renderStage(); if (!elements.developerPanel.hidden) renderDeveloper(); }));
}

function renderMetrics(metrics) {
  if (!metrics?.length) return "";
  return `<div class="metrics">${metrics.map((item) => `<div class="metric ${escapeHtml(item.tone)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>`;
}

function renderSection(section) {
  if (section.type === "prose") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><p class="prose">${escapeHtml(section.body)}</p></section>`;
  if (section.type === "list") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><ul class="simple-list">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
  if (section.type === "outline") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="outline-list">${section.items.map((item) => `<article class="outline-item"><h4>${escapeHtml(item.title)}</h4><ul>${item.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul></article>`).join("")}</div></section>`;
  if (section.type === "areas") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="area-list">${section.items.map((item, index) => `<article class="area-item"><h4>${index + 1}. ${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description)}</p><div class="item-meta">${item.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div></article>`).join("")}</div></section>`;
  if (section.type === "keyValue") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><dl class="key-value">${section.items.map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`).join("")}</dl></section>`;
  if (section.type === "example") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="example-box"><strong>${escapeHtml(section.cue)}</strong><div class="example-arrow">↓</div><p>${escapeHtml(section.target)}</p>${section.supportingInfo ? `<div class="item-meta">${escapeHtml(section.supportingInfo)}</div>` : ""}</div></section>`;
  if (section.type === "options") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="area-list">${section.items.map((item) => `<article class="area-item"><h4>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description)}</p></article>`).join("")}</div></section>`;
  if (section.type === "learningUnits") return `<section class="section"><h3>${escapeHtml(section.title)}</h3>${section.linkageAvailable ? "" : '<p class="status-note">Plan 영역과 LU를 직접 연결하는 metadata는 현재 artifact에 없습니다. 관계를 추론해 표시하지 않습니다.</p>'}<div class="lu-list">${section.items.map((item) => `<article class="lu-item"><h4>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</h4><p><strong>학습 대상</strong><br>${escapeHtml(item.semanticTarget)}</p><p><strong>학습 의도</strong><br>${escapeHtml(item.intent)}</p><div class="item-meta">${item.knowledgeType ? `<span class="pill">${escapeHtml(item.knowledgeType)}</span>` : ""}${item.area ? `<span class="pill">${escapeHtml(item.area)}</span>` : ""}<span>${escapeHtml(item.evidence)}</span></div>${item.rationale ? `<p><strong>선정 이유</strong><br>${escapeHtml(item.rationale)}</p>` : ""}</article>`).join("")}</div></section>`;
  if (section.type === "coverage") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="coverage-grid">${section.items.map((item) => `<div class="coverage-cell ${item.count === 0 ? "zero" : item.count >= 2 ? "multi" : ""}"><span>${escapeHtml(item.id)}</span><strong>${item.count}</strong></div>`).join("")}</div></section>`;
  if (section.type === "cards") return `<section class="section"><h3>${escapeHtml(section.title)}</h3><div class="card-list">${section.items.map((item) => `<article class="card-item"><h4>Card ${String(item.index).padStart(2, "0")} ${item.learningUnitId ? `· ${escapeHtml(item.learningUnitId)}` : ""}</h4><div class="card-face"><span>앞면</span><p>${escapeHtml(item.front)}</p><span>뒷면</span><p>${escapeHtml(item.back)}</p></div><div class="item-meta"><span class="pill">${escapeHtml(item.type)}</span>${item.strategy ? `<span class="pill">${escapeHtml(item.strategy)}</span>` : ""}<span>${escapeHtml(item.source)}</span></div>${item.qualityNotes.length ? `<ul class="simple-list">${item.qualityNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div></section>`;
  if (section.type === "issues") return `<section class="section"><h3>${escapeHtml(section.title)}</h3>${section.items.length ? `<ul class="simple-list">${section.items.map((item) => `<li>Card ${item.card}${item.learningUnitId ? ` · ${escapeHtml(item.learningUnitId)}` : ""}: ${escapeHtml(item.note)}</li>`).join("")}</ul>` : `<p class="status-note">${escapeHtml(section.empty)}</p>`}</section>`;
  return "";
}

function renderStage() {
  const stage = state.run?.stages?.[state.stage];
  if (!stage) return;
  if (stage.status !== "available") {
    elements.content.innerHTML = `<div class="error-box"><strong>${escapeHtml(stage.label)}</strong><p>${escapeHtml(stage.error)}</p></div>`;
    return;
  }
  elements.content.innerHTML = `
    <header class="stage-heading"><h2>${escapeHtml(stage.label)} <small>${escapeHtml(stage.technicalLabel)}</small></h2><p>${escapeHtml(stage.summary)}</p></header>
    ${renderMetrics(stage.metrics)}
    ${stage.sections.map(renderSection).join("")}
    <details class="raw-details"><summary>원본 JSON 보기</summary><pre>${escapeHtml(JSON.stringify(stage.raw, null, 2))}</pre></details>`;
}

async function selectRun(caseId, runId) {
  state.selected = `${caseId}/${runId}`;
  renderRunList();
  elements.content.innerHTML = '<div class="empty-state"><strong>Run artifact를 읽는 중입니다.</strong></div>';
  try {
    state.run = await fetchJson(`/api/runs/${encodeURIComponent(caseId)}/${encodeURIComponent(runId)}`);
    state.stage = "analyze";
    elements.developerPanel.hidden = true;
    renderHeader(); renderTabs(); renderStage();
  } catch (error) {
    elements.content.innerHTML = `<div class="error-box"><strong>Run을 열지 못했습니다.</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function loadRuns(showLoading = true) {
  if (showLoading) elements.runList.innerHTML = '<div class="empty-state"><span>Run 목록을 읽는 중입니다.</span></div>';
  try {
    state.runs = (await fetchJson("/api/runs")).runs;
    renderRunList();
    if (!state.run) {
      const first = state.runs.find((run) => run.status !== "invalid");
      if (first) await selectRun(first.caseId, first.runId);
    }
  } catch (error) {
    elements.runList.innerHTML = `<div class="error-box">${escapeHtml(error.message)}</div>`;
  }
}

elements.refresh.addEventListener("click", loadRuns);
elements.newExperiment.addEventListener("click", openExperiment);
elements.closeExperiment.addEventListener("click", closeExperiment);
elements.cancelExperiment.addEventListener("click", closeExperiment);
elements.form.addEventListener("submit", submitExperiment);
elements.pdfInput.addEventListener("change", () => {
  const file = elements.pdfInput.files?.[0] ?? null;
  state.selectedPdf = file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf") ? file : null;
  elements.pdfStatus.textContent = state.selectedPdf ? `${state.selectedPdf.name} · ${formatBytes(state.selectedPdf.size)} · 선택됨` : "PDF 파일을 선택하세요.";
  updateExperimentButton();
});
loadRuns();
