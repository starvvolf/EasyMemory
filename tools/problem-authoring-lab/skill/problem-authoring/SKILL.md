---
name: problem-authoring
description: Author and iteratively refine workbook- or school-test-quality questions from fixed learning content using a free block layout, rendered previews, stable answer contracts, and targeted patches. Use for the problem-authoring lab, not for changing source learning content or production Study Forge renderers.
---

# Problem authoring

Treat the supplied learning content, objective, success criteria, and source evidence as fixed. Decide how to turn that content into a clear retrieval task and a readable question page; do not use an existing Study Forge card layout as a template.

## Workflow

1. Identify the exact knowledge or judgment the learner must produce. Preserve its source link.
2. Choose a response contract and stable `questionId`, `responseId`, and option IDs before arranging the page.
3. Compose the page from text, boxes, source-linked images, small tables, choices, blanks, and answer-reveal blocks. The available elements are primitives, not finished layouts.
4. Render both the unanswered and answer-revealed states. Inspect question numbering, prompt hierarchy, boxes, choices, blank size, alignment, whitespace, legibility, answer leakage, and response-to-answer mapping.
5. Patch only the blocks or response contracts responsible for concrete issues. Preserve stable IDs and save the instruction and before/after artifacts.
6. Stop at the configured revision limit. Passing local validation means only that the artifact is ready for independent evaluation, not that its educational quality is proven.

Read [multiple-choice.md](references/multiple-choice.md) when the intended response is selection among alternatives. Read [fill-blank.md](references/fill-blank.md) when the learner must supply missing text. These are initial production hypotheses, not a closed list of supported question forms or permanent sequences. A new block composition is acceptable when it better serves the retrieval goal, remains unambiguous, and keeps answer/retry behavior connected.

Do not invent diagram facts. An image block must point to an asset from the same source and page. Do not add blanks through postprocessing; every blank must be an authored block bound to one response contract.
