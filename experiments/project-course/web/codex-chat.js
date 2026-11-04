// Codex 실험판 화면(11/4). 대화 목록 · 작업 폴더 · 파일 고치기 허락 · 모델 · 배운 것. 답하는 중에는 0.5초마다 다시 읽는다
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); } for (const k of kids.flat()) if (k != null) e.append(k); return e; };
const api = async (method, url, body) => { const r = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "실패"); return j; };
let cur = null, editingWs = false, sig = "";
let sel = new URLSearchParams(location.search).get("chat") || localStorage.getItem("recaller-codex-chat");
const KIND = { asked: "물어봄", confused: "헷갈림", misconception: "틀리게 앎", explained: "자기 말로 설명", applied: "직접 써 봄" };

function content(text) {
  const box = h("div");
  text.split(/```[^\n]*\n([\s\S]*?)(?:```|$)/g).forEach((part, i) => {
    if (i % 2) box.append(h("pre", {}, h("code", {}, part.trimEnd())));
    else if (part.trim()) { const p = h("p"); for (const [j, s] of part.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g).entries()) p.append(j % 2 ? h(s.startsWith("`") ? "code" : "strong", {}, s.replace(/^`|`$|^\*\*|\*\*$/g, "")) : s); box.append(p); }
  });
  return box;
}
async function loadList() {
  const { chats, status } = await api("GET", "/api/codex-chat");
  $("list").replaceChildren(...chats.map((c) => h("button", { class: `item ${c.id === sel ? "on" : ""}`, title: c.title, onclick: () => open(c.id) }, (c.busy ? "… " : "") + c.title)));
  $("status").textContent = status.codex ? (status.sdk ? "" : "Codex SDK가 없어요(.codex-sdk).") : "이 PC에서 codex.exe를 못 찾았어요.";
}
async function open(id) { sel = id; localStorage.setItem("recaller-codex-chat", id); history.replaceState(null, "", `?chat=${id}`); editingWs = false; sig = ""; await refresh(); loadList(); }
async function refresh() {
  if (!sel) return;
  try { cur = await api("GET", `/api/codex-chat/${sel}`); } catch { sel = null; return; }
  draw();
}
const opt = (b) => api("POST", `/api/codex-chat/${cur.id}/options`, b).then((v) => { cur = v; sig = ""; draw(); }).catch((e) => alertLine(e.message));
const alertLine = (t) => { $("status").textContent = t; };
// 그 대화의 작업 폴더를 VS Code로(새 대화 · 폴더 바꾸기 때는 저절로, 그 밖엔 버튼)
const openCode = (id) => api("POST", `/api/codex-chat/${id}/open`).then((r) => alertLine(r.ok ? "VS Code에서 이 대화의 작업 폴더를 열었어요." : r.message)).catch((e) => alertLine(e.message));
function draw() {
  const c = cur; if (!c) return;
  $("title").textContent = c.messages.find((m) => m.role === "user")?.text.slice(0, 50) || "새 대화";
  $("model").replaceChildren(...c.models.map((m) => h("option", { value: m.id }, m.label))); $("model").value = c.model; $("model").disabled = c.busy;
  // 작업 폴더 줄
  if (editingWs) {
    const inp = h("input", { class: "path", value: c.workspace, spellcheck: "false" });
    const save = () => opt({ workspace: inp.value }).then(() => { editingWs = false; draw(); openCode(cur.id); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { editingWs = false; draw(); } });
    $("wsbar").replaceChildren(h("span", { class: "mut" }, "작업 폴더"), inp, h("button", { class: "btn small primary", onclick: save }, "저장"), h("button", { class: "btn small", onclick: () => { editingWs = false; draw(); } }, "취소"));
    setTimeout(() => inp.focus(), 0);
  } else {
    $("wsbar").replaceChildren(h("span", { class: "mut" }, "작업 폴더"), h("code", { title: c.workspace }, c.workspace),
      h("button", { class: "btn small", disabled: c.busy, onclick: () => { editingWs = true; draw(); } }, "바꾸기"),
      h("button", { class: "btn small", onclick: () => openCode(c.id) }, "VS Code로 열기"),
      c.edit ? h("label", { class: "small" }, h("input", { type: "checkbox", checked: c.edit === "allow", disabled: c.busy, onchange: (e) => opt({ edit: e.target.checked ? "allow" : "deny" }) }), " 튜터가 고치기") : null);
  }
  $("editask").replaceChildren(c.edit ? "" : h("div", { class: "ask" }, h("span", { style: "flex:1" }, "튜터(Codex)가 작업 폴더의 파일을 직접 만들고 고치고 명령을 실행해도 될까요?"),
    h("button", { class: "btn small primary", onclick: () => opt({ edit: "allow" }) }, "허용"), h("button", { class: "btn small", onclick: () => opt({ edit: "deny" }) }, "허용 안 함")));
  // 배운 것
  const by = new Map(); for (const x of c.learned) { if (!by.has(x.concept)) by.set(x.concept, []); by.get(x.concept).push(x); }
  $("learned").hidden = !by.size;
  $("learned").querySelector("summary").textContent = `배운 것 ${by.size}개`;
  $("learned").querySelector("ul").replaceChildren(...[...by].map(([k, xs]) => h("li", {}, h("b", {}, k), xs.map((x) => h("span", { class: "k", title: `"${x.quote}"` }, KIND[x.kind] ?? x.kind)), xs[0].meaning ? h("div", { class: "small mut" }, xs[0].meaning) : null)));
  // 대화
  const s = JSON.stringify(c.messages) + c.busy;
  if (s !== sig) {
    const box = $("msgs"); const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.replaceChildren(...c.messages.map((m) => h("div", { class: `m ${m.role}` }, m.role === "assistant" ? content(m.text) : m.text)),
      ...(c.busy ? [h("div", { class: "m tool" }, "Codex가 생각하고 있어요…")] : []),
      ...(!c.messages.length ? [h("p", { class: "mut" }, "아무거나 물어보세요. 작업 폴더를 바꾸면 그 폴더에서 같이 봐요.")] : []));
    if (near || !sig) box.scrollTop = box.scrollHeight;
    sig = s;
  }
  $("send").textContent = c.busy ? "멈추기" : "보내기"; $("send").className = `btn ${c.busy ? "" : "primary"}`;
}
async function send() {
  if (!cur) return;
  if (cur.busy) { cur = await api("POST", `/api/codex-chat/${cur.id}/stop`); return draw(); }
  const t = $("q").value.trim(); if (!t) return;
  $("q").value = "";
  try { cur = await api("POST", `/api/codex-chat/${cur.id}/ask`, { text: t }); sig = ""; draw(); loadList(); } catch (e) { $("q").value = t; alertLine(e.message); }
}
$("send").onclick = send;
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("model").onchange = (e) => opt({ model: e.target.value });
$("new").onclick = async () => { const c = await api("POST", "/api/codex-chat"); await open(c.id); openCode(c.id); $("q").focus(); };
(async () => {
  await loadList();
  if (sel) await refresh(); if (!cur) { const c = await api("POST", "/api/codex-chat"); await open(c.id); }
  setInterval(async () => { if (document.hidden || !sel) return; if (cur?.busy || Date.now() % 4000 < 600) { const was = cur?.busy; await refresh(); if (was && !cur?.busy) loadList(); } }, 500);
})();
