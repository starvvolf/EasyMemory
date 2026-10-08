# Initial experiment report

Run: astra-medium-mcp-20260907-r01
Iteration: 0. Revisions: 0. One revision remains reserved exclusively for evaluator visual feedback.
Exactly four authored questions: q01 and q02 single-choice; q03 and q04 fill-blank.
All source fields, targets and success criteria were copied unchanged from the fixed MCP packet.
No mock documents were read. Only contract.ts and renderer.ts were read for the schema and renderer.
No product code, dependencies, global configuration, model processes, purchases, external messages, or subagents were used.

## Hashes returned by MCP
Input hash: d23b0f21f3df1762058ca4ddfb38fdeb6c19f50cc835b146613333426b718c90
Skill hash: 771b9c53e47eb3b4bc0568f8184d63a8d416cf85e245082c43aa505e1f6fdc74
Skill version: problem-authoring-hypothesis-v1
The exact input and complete returned skill/method instructions are preserved in tool-calls.json.

## Execution metadata
Requested model: gpt-6-astra
Requested reasoning: medium
Configured model / reasoning: unknown (not inspected or changed)
Verified actual model / reasoning: unknown
Actual authoring session ID: unknown
Actual usage: unknown
The current Codex assistant composed the explicit block document itself and invoked the real MCP tools.
There was no substitute-model invocation or API fallback. The MCP tools expose no model-selection argument.
Existing account authentication was left untouched. No credential files were read or copied.
The browser inventory unexpectedly included a credential-bearing unrelated URL; it was not opened, reused, or copied into artifacts. Authentication/session identity was not inferred from it.
Consequently this is an MCP artifact run under the requested model label, not independent verification that the requested model/reasoning executed.

## Calls and artifacts
The five real problem_authoring_lab MCP calls, complete JSON arguments and results, are preserved in tool-calls.json in invocation order (the first two were requested concurrently).
document.json, before-answer.html, after-answer.html, inspection.json and execution.json were created by record_problem_iteration.
validate_problem_document returned valid=true and issues=[].
No patch/revision tool was called.

Supporting tools: functions.exec for tool metadata discovery and orchestration; exec_command for git status and contract.ts/renderer.ts/Computer Use skill reads; cua.getState for browser availability; cua.createBrowserTab for the saved before-answer.html; apply_patch for this report and exact MCP trace.
Initial git status showed existing modifications only in docs/CURRENT_STATUS.md, docs/GENERATION_ENGINE_CURRENT_STATE.md and docs/PLANNING_RULES.md. They were not changed.

## Visual inspection
PENDING. Browser screenshot capability exists, but opening the local before-answer.html was rejected by browser URL security policy. No workaround was attempted; neither render was visually inspected. HTML reading is not visual inspection.
No screenshot artifacts were created. The outer evaluator must inspect both actual renders.

HTML-only review concerns, not screenshot observations:
- q03-context contains newline-separated bullets, but the renderer uses normal HTML whitespace; the two phenomena may display on one line.
- q04-reveal lists three answers in response-ID order without explicit (가)/(나)/(다) labels; mapping is correct in the contract but visual clarity needs review.
- q03 tests the iron threshold with both phenomena supplied, so it does not independently demonstrate the learner can identify those phenomena.
- q04 supplies textual descriptions of appearances rather than actual observed spectrum images; direct visual discrimination remains untested.
- Evaluator should check all numbering, stem hierarchy, boxes, choice wrapping, blank widths, spacing, overflow and answer leakage.

Contract answer mapping: q01-response -> q01-o2; q02-response -> q02-o4; q03-response -> 철 (accepted variants preserved); q04-response-a/b/c -> 연속 스펙트럼 / 선 스펙트럼 / 흡수 스펙트럼.
Unanswered HTML contains no correct-choice class or revealed answer text; this is a markup finding only.
Local contract validation is not independent educational or visual quality approval.

