const $ = (id) => document.getElementById(id);
let chat = null, pending = false, polling = false, switching = false, rendered = "", errorText = "", debug = null;
const storageKey = "recaller-learning-chat";
const at = new URL(location.href).searchParams.get("chat");
let selected = at || localStorage.getItem(storageKey);
async function api(method, path, body) {
  const r = await fetch(`/api/agent-chat${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || "요청에 실패했어요."); return data;
}
function adopt(value) {
  chat = value; selected = value.id;
  localStorage.setItem(storageKey, selected);
  history.replaceState(null, "", `?chat=${selected}`);
  draw();
}
function inline(text, parent) {
  for (const [i, part] of text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g).entries()) {
    if (i % 2) { const el = document.createElement(part.startsWith("`") ? "code" : "strong"); el.textContent = part.startsWith("`") ? part.slice(1, -1) : part.slice(2, -2); parent.append(el); }
    else parent.append(document.createTextNode(part));
  }
}
function content(text, parent) {
  const segments = text.split(/```[^\n]*\n([\s\S]*?)(?:```|$)/g);
  segments.forEach((part, i) => {
    const el = document.createElement(i % 2 ? "pre" : "p");
    if (i % 2) { const code = document.createElement("code"); code.textContent = part.trimEnd(); el.append(code); }
    else inline(part, el);
    parent.append(el);
  });
}
function draw() {
  const isBusy = pending || switching || !!chat?.busy;
  $("send").disabled = isBusy || !chat;
  $("stop").hidden = !chat?.busy;
  $("new").disabled = isBusy;
  $("restart").disabled = isBusy || !chat;
  $("inspect").disabled = !chat || switching;
  const running = chat?.messages.filter((m) => m.progress?.status === "running") ?? [];
  $("status").textContent = errorText || (isBusy ? running.length ? running.map((m) => m.progress.label).join(" · ") : "튜터가 답변을 이어 가고 있어요…" : "");
  if (!chat) return;
  const signature = JSON.stringify(chat.messages);
  if (signature !== rendered) {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 180;
    const nodes = chat.messages.map((m) => {
      const el = document.createElement(m.role === "tool" ? "details" : "div"); el.className = `agent-message ${m.role}`;
      if (m.role === "tool") {
        if (m.progress) el.classList.add("tool-progress", `tool-${m.progress.status}`);
        const title = document.createElement("summary"); title.textContent = `${m.progress ? ({ running: "◌", completed: "✓", failed: "!", cancelled: "■" })[m.progress.status] + " " : ""}${m.text.split("\n")[0]}`;
        el.append(title); if (m.text.includes("\n")) content(m.text, el);
      }
      else if (m.role === "user" || m.role === "error") el.textContent = m.text;
      else content(m.text, el);
      return el;
    });
    $("messages").replaceChildren(...nodes); rendered = signature;
    if (nearBottom) $("chat-form").scrollIntoView({ block: "end" });
  }
  $("goal").textContent = chat.goal; $("focus").textContent = chat.focus;
  $("support").replaceChildren(...(chat.support.length ? chat.support.map((f) => { const li = document.createElement("li"); li.textContent = f.topic; return li; }) : [Object.assign(document.createElement("li"), { textContent: "지금은 원래 주제를 보고 있어요." })]));
  $("observations").replaceChildren(...(chat.observations.length ? chat.observations.slice(-6).reverse().map((o) => {
    const el = document.createElement("div"); el.className = "agent-observation";
    const label = document.createElement("small"); label.textContent = `${({ understood: "이해한 것으로 보임", confused: "헷갈림", misconception: "오개념" })[o.kind]} · AI 판단`;
    const note = document.createElement("p"); note.textContent = o.note;
    const quote = document.createElement("blockquote"); quote.textContent = o.evidence;
    el.append(label, note, quote); return el;
  }) : [Object.assign(document.createElement("p"), { textContent: "아직 관찰 기록이 없어요." })]));
  $("workspace").textContent = `실험 코드 폴더: ${chat.workspace}`;
  $("suggestions").hidden = chat.messages.some((m) => m.role === "user");
}
async function send() {
  const text = $("question").value.trim(); if (!text || !chat || pending || chat.busy) return;
  pending = true; errorText = ""; $("question").value = ""; draw();
  try { adopt(await api("POST", `/${chat.id}/ask`, { text })); }
  catch (e) { errorText = e.message; $("question").value = text; }
  finally { pending = false; if (chat) { try { adopt(await api("GET", `/${chat.id}`)); } catch { draw(); } } }
}
$("chat-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
$("question").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
async function replaceChat(restart) {
  if (pending || switching || chat?.busy) return;
  switching = true; errorText = ""; draw();
  try { adopt(await api("POST", restart ? `/${chat.id}/restart` : "")); $("question").value = ""; $("question").focus(); }
  catch (e) { errorText = e.message; }
  finally { switching = false; draw(); }
}
$("new").addEventListener("click", () => replaceChat(false));
$("restart").addEventListener("click", () => replaceChat(true));
$("stop").addEventListener("click", async () => { try { adopt(await api("POST", `/${chat.id}/stop`)); } catch (e) { $("status").textContent = e.message; } });
document.querySelectorAll("[data-question]").forEach((b) => b.addEventListener("click", () => { $("question").value = b.dataset.question; $("question").focus(); }));
function panel(name) {
  for (const key of ["layout", "actual", "edit"]) $("panel-" + key).hidden = key !== name;
  document.querySelectorAll("[data-panel]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.panel === name)));
}
document.querySelectorAll("[data-panel]").forEach((b) => b.addEventListener("click", () => panel(b.dataset.panel)));
const pretty = (value) => JSON.stringify(value, null, 2);
function showRequest() {
  const requests = debug?.trace?.requests ?? [];
  const request = requests[Number($("request-pick").value)];
  $("actual-input").textContent = request ? pretty(request.body) : debug?.previousRequest ? pretty(debug.previousRequest) : "아직 저장된 실제 모델 입력이 없어요. 대화를 한 번 보내면 여기에 표시돼요.";
}
function showDebug(data, fillEditors) {
  debug = data;
  $("prompt-layout").replaceChildren(...data.layout.map((text) => Object.assign(document.createElement("li"), { textContent: text.replace(/^\d+\. /, "") })));
  $("prompt-preview").textContent = pretty(data.preview);
  const requests = data.trace?.requests ?? [];
  $("request-pick").replaceChildren(...requests.map((request, index) => Object.assign(document.createElement("option"), { value: String(index), textContent: `${index + 1}번째 호출 · ${new Date(request.at).toLocaleTimeString("ko-KR")}` })));
  $("request-pick").disabled = !requests.length;
  $("request-info").textContent = data.trace ? `이번 질문: ${data.trace.question}\n실제 모델 호출 ${requests.length}개 · 도구 호출 뒤 요청도 각각 볼 수 있어요.` : data.previousRequest ? "이 기능을 추가하기 전 마지막 호출 기록이에요." : "아직 실제 호출 기록이 없어요. [프롬프트 배치]에서 다음 차례 조립 재료를 볼 수 있어요.";
  $("assembled-input").textContent = data.trace ? pretty({ at: data.trace.at, instructions: data.trace.prompts.system, parts: data.trace.parts, question: data.trace.question, toolEvents: data.trace.toolEvents ?? [] }) : "이 기능을 추가한 뒤 질문부터 저장돼요.";
  showRequest();
  if (fillEditors) for (const key of ["system", "fixed", "turn"]) $("prompt-" + key).value = data.prompts[key];
}
$("inspect").addEventListener("click", async () => {
  if (!chat) return;
  $("prompt-status").textContent = "불러오는 중…"; $("prompt-dialog").showModal();
  try { showDebug(await api("GET", `/${chat.id}/debug`), true); $("prompt-status").textContent = ""; }
  catch (e) { $("prompt-status").textContent = e.message; }
});
$("close-inspect").addEventListener("click", () => $("prompt-dialog").close());
$("request-pick").addEventListener("change", showRequest);
$("refresh-input").addEventListener("click", async () => {
  try { showDebug(await api("GET", `/${chat.id}/debug`), false); $("prompt-status").textContent = "기록을 갱신했어요."; }
  catch (e) { $("prompt-status").textContent = e.message; }
});
$("save-prompts").addEventListener("click", async () => {
  $("save-prompts").disabled = true;
  try {
    const input = Object.fromEntries(["system", "fixed", "turn"].map((key) => [key, $("prompt-" + key).value]));
    await api("POST", "/prompts", input);
    showDebug(await api("GET", `/${chat.id}/debug`), false);
    $("prompt-status").textContent = "저장했어요. 다음 메시지부터 적용돼요. 대화와 학습 상태는 유지해요.";
  } catch (e) { $("prompt-status").textContent = e.message; }
  finally { $("save-prompts").disabled = false; }
});
$("default-prompts").addEventListener("click", () => {
  if (!debug) return;
  for (const key of ["system", "fixed", "turn"]) $("prompt-" + key).value = debug.defaults[key];
  $("prompt-status").textContent = "기본값을 불러왔어요. [저장]을 눌러야 적용돼요.";
});
try { adopt(selected ? await api("GET", `/${selected}`) : await api("POST", "")); }
catch (e) { selected = null; $("status").textContent = `${e.message} 위의 [새 대화]로 시작해 주세요.`; }
setInterval(async () => {
  if (!selected || polling || switching || document.hidden) return;
  polling = true;
  const requested = selected;
  try { const value = await api("GET", `/${requested}`); if (selected === requested && !switching) adopt(value); } catch { /* 다음 주기에 재연결 */ }
  finally { polling = false; }
}, 500);
