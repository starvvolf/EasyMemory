# Direct structured JSON generation port

## Ported behavior

- The active `/api/generate` `cards` stage requests the complete `CardDraft` object in the response schema.
- The `generate-from-plan` path uses the same complete card contract instead of a smaller card object that the server later hydrates.
- Card output is validated for learning-unit, objective, blueprint, and source references before it becomes a stored `Card`.
- Cloze blank/answer counts, multiple-choice answer indices, O/X fields, and structure-node references are rejected when inconsistent.
- `materializeCards` adds only the product-owned `id` and initial `status`. Generated question, answer, source, and metadata fields are retained byte-for-byte as JavaScript string/array values.
- A card generation result remains `qualityPassed=false` and `qualityStatus=not_run`; a successful schema check is not reported as an independent quality review.

## Preserved product behavior

- Existing `/api/analyze`, `/api/plan`, `/api/generate`, learning-unit, activity-design, review, deck, and study contracts remain in place.
- `src/app/page.tsx`, shared `src/lib/types.ts`, storage, and learning-loop code are unchanged.
- Existing activity recommendations still determine which supported cards are generated.
- Legacy stored activity-design input can still be adapted when it is read, but newly authored activity design must return explicit objectives and blueprints.

## Removed silent transformations

- Compact card hydration no longer supplies source, answer, or quality fields on behalf of the card model.
- Card materialization no longer rewrites cloze text, splits answers, removes text from a structure prompt, or supplies missing structure defaults.
- The active card path no longer sends validated output to a second model that may rewrite its content.
- Activity design validation no longer changes terminal operations, downgrades direct relations, replaces problem types, or inserts memorization fallback blueprints. Invalid output fails validation.

## Server entry points relevant to operator authorization

The actual AI-generation entry points are `/api/analyze`, `/api/plan`, and `/api/generate`. The last endpoint includes `prepare`, `activity-design`, `cards`, and `generate-from-plan`. Study, source, deck, and project data APIs are not AI-generation entry points merely because they are API routes.

## Offline verification

`scripts/direct-json-generation.test.ts` replays the frozen DFS/BFS raw API fixture. It verifies that all 16 cards retain every generated field through validation and materialization and that invalid blank counts are rejected without repair.
