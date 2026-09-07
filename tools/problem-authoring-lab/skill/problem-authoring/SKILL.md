---
name: problem-authoring
description: Author and iteratively refine workbook- or school-test-quality questions from fixed learning content using a free block layout, rendered previews, stable answer contracts, and targeted patches. Use for the problem-authoring lab, not for changing source learning content or production Study Forge renderers.
---

# Problem authoring

Treat the supplied learning content, objective, success criteria, and source evidence as fixed. Start from the objective, decide what learner answer would count as evidence, then design the task that elicits that answer. Distinguish memorizing source wording, repeated retrieval practice, and measuring performance; do not claim one as evidence of another. Do not use an existing Study Forge card layout as a template.

## Workflow

1. Identify the exact knowledge or judgment the learner must produce. Preserve its source link.
2. Choose a response contract and stable `questionId`, `responseId`, and option IDs before arranging the page.
3. Compose the page from text, boxes, source-linked images, explicitly generated assets, small tables, choices, blanks, and answer-reveal blocks. The available elements are primitives, not finished layouts.
4. Render both the unanswered and answer-revealed states. Inspect question numbering, prompt hierarchy, boxes, choices, blank size, alignment, whitespace, legibility, answer leakage, and response-to-answer mapping.
5. Patch only the blocks or response contracts responsible for concrete issues. Preserve stable IDs and save the instruction and before/after artifacts.
6. Stop at the configured revision limit. Passing local validation means only that the artifact is ready for independent evaluation, not that its educational quality is proven.

Read only the references needed for the task:

- [multiple-choice.md](references/multiple-choice.md) for selection and plausible distractors.
- [fill-blank.md](references/fill-blank.md) for recall targets and sufficient context.
- [relationship-structure.md](references/relationship-structure.md) for order, sets, hierarchies, or named relations.
- [graph-geometry.md](references/graph-geometry.md) for graphs, coordinates, and geometric figures.

These are optional methods, not a closed type list or fixed layout catalog, and they may be combined. A new block composition is acceptable when it better serves the evidence needed, remains unambiguous, and keeps answer/retry behavior connected.

## Independent review

Hide the answer and solve the item, then reveal it and compare the response to the intended evidence and source. Check alternate valid answers, answer leakage, and input burden unrelated to the objective. Keep machine contract checks, independent mathematical calculation, and actual screen observation as separate evidence.

Classify a failure before patching it: objective/evidence/task mismatch is design; unsupported or incorrect facts are content; lost relation or poor arrangement is layout; accepted-answer or option-key mismatch is grading; overflow, font, or asset loading is rendering. Patch only the responsible block, response, asset, or instruction.

Do not invent diagram facts. An `image` block must point to an asset from the same source and page. A newly plotted graph must instead use `generated-image` with a local SVG, generator and version, source script and numeric spec, and matching hashes; never label it as a source image or load an external SVG resource. Preserve the plotted functions and conditions in the spec so the question and answer can be reproduced. Do not add blanks through postprocessing; every blank must be an authored block bound to one response contract.
