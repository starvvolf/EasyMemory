import { STAGE_DEFINITIONS } from "./artifact-reader.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "정보 없음") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function stageResponse(stage) {
  return record(stage?.value).response;
}

function field(label, value, tone = "default") {
  return { label, value: text(value), tone };
}

function listSection(title, items, empty = "표시할 항목이 없습니다.") {
  return { type: "list", title, items: items.length ? items : [empty] };
}

function analyzeView(response) {
  const files = array(record(response).files);
  const first = record(files[0]);
  return {
    summary: text(first.summary, "자료 분석 결과가 비어 있습니다."),
    metrics: [field("자료 수", files.length), field("자료 유형", first.documentType)],
    sections: [
      listSection("핵심 주제", array(first.keyTopics).map(String)),
      {
        type: "outline",
        title: "문서 구조",
        items: array(first.outline).map((item) => ({
          title: text(record(item).heading),
          details: array(record(item).points).map(String),
        })),
      },
      ...files.slice(1).map((file) => ({ type: "prose", title: text(file.fileName), body: text(file.summary) })),
    ],
  };
}

function planView(response) {
  const value = record(response);
  const plan = record(value.plan ?? value);
  const whole = record(value.wholeDocumentCorePlan);
  const effective = record(value.effectiveStudyGuideline);
  const groups = array(plan.groups);
  const areas = array(whole.areas);
  const selected = record(effective.selectedGroup ?? value.selectedLearningArea?.selectedGroup);
  const items = (areas.length ? areas : groups).map((item, index) => ({
    id: text(item.id, `area-${index + 1}`),
    title: text(item.title),
    description: text(item.description),
    meta: [
      item.learningValue ? `학습 가치: ${item.learningValue}` : null,
      item.itemCount != null ? `${item.itemCount} ${item.itemLabel ?? "단위"}` : null,
      array(item.sourceScope).length ? `범위: ${item.sourceScope.join(" · ")}` : null,
    ].filter(Boolean),
  }));
  return {
    summary: text(whole.summary ?? plan.summary),
    metrics: [field("학습 영역", items.length), field("선택 영역", selected.title ?? plan.recommendedGroupId)],
    sections: [
      whole.learningGoal ? { type: "prose", title: "전체 학습 목표", body: whole.learningGoal } : null,
      { type: "areas", title: areas.length ? "전체 핵심 학습 범위" : "AI가 구성한 학습 영역", items },
      array(whole.exclusions).length ? listSection("제외한 내용", whole.exclusions.map(String)) : null,
    ].filter(Boolean),
  };
}

function recallView(response, inputs) {
  const value = record(response);
  const draft = record(value.recallDesign);
  const selected = record(value.selectedRecallDesign);
  const option = record(selected.selectedOption ?? record(inputs?.userSelections).recallOption);
  const variant = record(selected.selectedVariant ?? record(inputs?.userSelections).recallVariant);
  const example = record(record(inputs?.userSelections).representativeExample ?? variant.sample);
  return {
    summary: option.title ? `선택된 인출 방식: ${option.title}` : text(draft.question, "선택된 인출 방식이 없습니다."),
    metrics: [field("선택 옵션", option.id), field("변형", variant.label ?? variant.id), field("카드 형태", option.mode)],
    sections: [
      option.title ? { type: "keyValue", title: "선택된 인출 방식", items: [field("단서", option.cue), field("인출 대상", option.target), field("단위", option.unit), field("생성 지시", option.instruction)] } : null,
      variant.label ? { type: "keyValue", title: "선택된 변형", items: [field("이름", variant.label), field("설명", variant.description), field("변수 처리", variant.slotMode), field("예시 출처", variant.exampleSource)] } : null,
      example.title ? { type: "example", title: "대표 예시", cue: text(example.cue), target: text(example.target), supportingInfo: text(example.supportingInfo, "") } : null,
      { type: "options", title: "제안된 다른 방식", items: array(draft.options).map((item) => ({ id: text(item.id), title: text(item.title), description: `${text(item.cue)} → ${text(item.target)}` })) },
    ].filter(Boolean),
  };
}

function prepareView(response) {
  const value = record(response);
  const analysis = record(value.analysis);
  const units = array(analysis.learningUnits);
  return {
    summary: text(analysis.detectedGoal, "학습 목표 정보가 없습니다."),
    metrics: [field("LearningUnit", units.length), field("자료 유형", analysis.sourceType), field("주 지식 유형", analysis.primaryKnowledgeType)],
    sections: [
      { type: "prose", title: "권장 학습 전략", body: text(analysis.recommendedStrategy) },
      listSection("핵심 주제", array(analysis.keyTopics).map(String)),
      {
        type: "learningUnits",
        title: `학습 단위 ${units.length}개`,
        linkageAvailable: units.some((unit) => unit.parentAreaId || unit.sourceAreaId),
        items: units.map((unit) => ({
          id: text(unit.id),
          title: text(unit.intent ?? unit.semanticTarget ?? unit.generalizedForm ?? unit.sourceRange),
          semanticTarget: text(unit.semanticTarget ?? unit.generalizedForm ?? unit.sourceText),
          intent: text(unit.learningIntent ?? unit.intent),
          evidence: [unit.sourceId, unit.sourcePage ? `p.${unit.sourcePage}` : null, unit.sourceRange].filter(Boolean).join(" · "),
          area: unit.parentAreaId ?? unit.sourceAreaId ?? null,
          knowledgeType: unit.knowledgeType ?? null,
          rationale: unit.rationale ?? null,
        })),
      },
    ],
  };
}

function cardItems(response) {
  return array(response).map((card, index) => ({
    index: index + 1,
    type: card.type ?? "unknown",
    front: text(card.front ?? card.clozeText),
    back: text(card.back ?? card.answer ?? array(card.answers).join(" / ")),
    learningUnitId: card.learningUnitId ?? null,
    source: [card.sourceId, card.sourcePage ? `p.${card.sourcePage}` : null].filter(Boolean).join(" · "),
    strategy: card.strategy ?? null,
    qualityPassed: card.qualityPassed,
    qualityNotes: array(card.qualityNotes).map(String),
  }));
}

function coverageOf(units, cards) {
  const coverage = Object.fromEntries(units.map((unit) => [unit.id, 0]));
  for (const card of cards) if (card.learningUnitId) coverage[card.learningUnitId] = (coverage[card.learningUnitId] ?? 0) + 1;
  return coverage;
}

function cardsView(response, prepareResponse, title = "생성 카드") {
  const cards = cardItems(response);
  const units = array(record(prepareResponse).analysis?.learningUnits);
  const coverage = coverageOf(units, cards);
  const zero = Object.entries(coverage).filter(([, count]) => count === 0).map(([id]) => id);
  const multi = Object.entries(coverage).filter(([, count]) => count >= 2).map(([id]) => id);
  return {
    summary: `${title} ${cards.length}개`,
    metrics: [field("카드", cards.length), field("0장 LU", zero.length, zero.length ? "warning" : "success"), field("2장 이상 LU", multi.length, multi.length ? "warning" : "success")],
    sections: [
      { type: "coverage", title: "LU별 카드 수", items: Object.entries(coverage).map(([id, count]) => ({ id, count })), zero, multi },
      { type: "cards", title, items: cards },
    ],
  };
}

function criticView(response, cardsResponse, prepareResponse) {
  const view = cardsView(response, prepareResponse, "검사 후 카드");
  const critic = array(response);
  const before = array(cardsResponse);
  const passed = critic.filter((card) => card.qualityPassed === true).length;
  const failed = critic.filter((card) => card.qualityPassed === false).length;
  const changed = critic.filter((card, index) => JSON.stringify(card) !== JSON.stringify(before[index])).length;
  view.summary = `Critic이 ${critic.length}개 카드를 검사했습니다.`;
  view.metrics = [field("통과", passed, "success"), field("실패", failed, failed ? "warning" : "success"), field("변경 위치", changed)];
  view.sections.unshift({
    type: "issues",
    title: "검사 결과",
    items: critic.flatMap((card, index) => array(card.qualityNotes).map((note) => ({ card: index + 1, learningUnitId: card.learningUnitId ?? null, note: String(note) }))),
    empty: "기록된 품질 경고가 없습니다.",
  });
  return view;
}

export function renderStage(stageId, run) {
  const definition = STAGE_DEFINITIONS.find((item) => item.id === stageId);
  if (!definition) throw new Error(`지원하지 않는 stage입니다: ${stageId}`);
  const stage = run.stages[stageId];
  if (!stage || stage.status !== "available") {
    return { id: stageId, ...definition, status: stage?.status ?? "missing", error: stage?.error ?? "artifact가 없습니다.", summary: "이 단계의 결과를 표시할 수 없습니다.", metrics: [], sections: [], raw: null, developer: stage ?? null };
  }
  const response = stageResponse(stage);
  const prepare = stageResponse(run.stages.prepare);
  const inputs = run.inputs.status === "available" ? run.inputs.value : {};
  let view;
  if (stageId === "analyze") view = analyzeView(response);
  else if (stageId === "plan") view = planView(response);
  else if (stageId === "recall") view = recallView(response, inputs);
  else if (stageId === "prepare") view = prepareView(response);
  else if (stageId === "cards") view = cardsView(response, prepare);
  else if (stageId === "critic") view = criticView(response, stageResponse(run.stages.cards), prepare);
  else view = cardsView(response, prepare, "최종 카드");
  return {
    id: stageId,
    ...definition,
    status: "available",
    ...view,
    raw: stage.value,
    developer: { relativePath: stage.relativePath, checksum: stage.checksum, lineage: stage.lineage, modelConfiguration: stage.value.modelConfiguration ?? null, capturedAt: stage.value.capturedAt ?? null },
  };
}

export function renderRun(run) {
  return {
    identity: { caseId: run.caseId, runId: run.runId, artifactPath: run.runDirectory },
    manifest: run.manifest,
    inputs: run.inputs.value,
    observations: run.observations.value,
    stages: Object.fromEntries(STAGE_DEFINITIONS.map((stage) => [stage.id, renderStage(stage.id, run)])),
    activityDesign: { status: "not_implemented", label: "훈련 방식 설계", technicalLabel: "Activity Design" },
  };
}
