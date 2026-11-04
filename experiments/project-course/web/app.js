// 프로젝트 코스 화면. 빌드 없이 도는 바닐라 JS.
// #/intake/<id> 코스 정하기 · #/run/<id> 코스 진행 · #/run/<id>/summary 결과
const $ = (s, el = document) => el.querySelector(s);
// VS Code 오른쪽 탭 안에서 열릴 때(?embed=1): 위쪽 바와 VS Code 열기 버튼을 빼고 좁은 폭에 맞춘다.
const EMBED = new URLSearchParams(location.search).has("embed");
if (EMBED) {
  const root = document.documentElement;
  const q = new URLSearchParams(location.search);
  root.classList.add("embed");
  const setTheme = (t) => { root.dataset.vs = t === "light" ? "light" : "dark"; };
  setTheme(q.get("theme"));
  root.style.setProperty("--mono", `${q.get("mono") ? `${q.get("mono")}, ` : ""}Consolas, "Cascadia Mono", "D2Coding", ui-monospace, monospace`);
  // VS Code 테마를 바꾸면 확장이 알려 준다
  window.addEventListener("message", (e) => {
    if (e.data && e.data.recallerTheme) setTheme(e.data.recallerTheme);
    // VS Code 색 테마의 코드 색(키워드·문자열·주석…)을 받아 코드 블록에 그대로 쓴다
    if (e.data && "recallerCode" in e.data) {
      const c = e.data.recallerCode || {};
      const set = (k, v) => { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); };
      set("--cb-bg", c.bg); set("--cb-fg", c.fg); set("--c-kw", c.kw); set("--c-kc", c.kc); set("--c-kb", c.kb); set("--c-str", c.str);
      set("--c-com", c.com); set("--c-num", c.num); set("--c-fn", c.fn); set("--c-var", c.vr); set("--c-ty", c.ty);
      set("--cb-size", c.size ? `${c.size}px` : null);
      root.classList.toggle("vscode-code", !!c.bg);
    }
  });
  try { window.parent.postMessage({ recallerReady: true }, "*"); } catch { /* */ }
}
// 튜터 창(?float=1, 11/2): VS Code 위에 떠서 따라다니는 창. 위에 얇은 줄(📌 고정 · 닫기)만 더한다.
const FLOAT = new URLSearchParams(location.search).has("float");
// 튜터 창 크기·고정·닫기는 코스 서버에 알리면 창(float/main.cjs)이 0.25초 안에 따른다
const floatPost = (b) => fetch("/api/float", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => null);
const floatUi = { pinned: false, size: "normal", pastOpen: false, sheetHidden: 0 };
/* [막혔어요](11/3): 무엇이 막혔는지 고르기 → 그 칸 대화. words: "모르는 단어"를 골랐을 때 고른 코드의 단어들 */
const stuckUi = { open: false, words: null, quote: null };
/** 고르기 판: 6가지 → (단어면) 그 줄의 단어 버튼 */
function stuckPicker(run, lesson, send, cls = "") {
  if (!stuckUi.open || lesson.busy) return null;
  const close = () => { stuckUi.open = false; stuckUi.words = null; drawLesson(); };
  const go = (body) => (e) => { stuckUi.open = false; stuckUi.words = null; floatUi.sheetHidden = 0; send({ do: "stuck", ...body })(e); };
  if (stuckUi.words) return h("div", { class: `stuckpick ${cls}` },
    h("div", { class: "sp-h" }, h("span", {}, "어떤 단어예요?"), h("button", { class: "fib", "aria-label": "닫기", onclick: close }, "✕")),
    stuckUi.quote ? h("code", { class: "sp-q" }, `${stuckUi.quote.file} ${stuckUi.quote.from}줄 · ${stuckUi.quote.code.trim().slice(0, 80)}`) : h("p", { class: "mut small" }, "VS Code에서 막힌 줄에 커서를 두거나 드래그하면 그 줄의 단어가 나와요."),
    h("div", { class: "sp-w" }, stuckUi.words.map((w) => h("button", { class: "fchip", onclick: go({ choice: 0, word: w }) }, w)),
      h("button", { class: "fchip", onclick: go({ choice: 0 }) }, "여기 없어요")));
  return h("div", { class: `stuckpick ${cls}` },
    h("div", { class: "sp-h" }, h("span", {}, lesson.stuck ? "이 설명에서 또 막혔나요?" : "어디가 막혔어요?"), h("button", { class: "fib", "aria-label": "닫기", onclick: close }, "✕")),
    h("div", { class: "sp-c" }, (lesson.stuckChoices || []).map((label, i) => h("button", { class: "fbtn", onclick: i === 0 ? () => busy(null, async () => {
      const out = await api("GET", `/api/runs/${run.id}/lesson/${run.current}/stuck-words`);
      stuckUi.words = out.words; stuckUi.quote = out.quote; drawLesson();
    }) : go({ choice: i }) }, h("b", {}, label)))));
}
/** 지금 위치 한 줄 + [이제 알겠어요] [그만하고 돌아가기] */
function stuckBar(lesson, send) {
  if (!lesson.stuck) return null;
  return h("div", { class: "stuckbar" },
    h("div", { class: "sb-p" }, h("span", { class: "sb-t" }, "막혔어요"), lesson.stuck.path.map((p, i) => [i ? h("span", { class: "sb-s" }, "›") : null, h("span", { class: i === lesson.stuck.path.length - 1 ? "sb-cur" : "" }, p.label)])),
    lesson.busy ? null : h("div", { class: "sb-a" },
      h("button", { class: "fchip", onclick: (e) => send({ do: "stuck_ok" })(e) }, "이제 알겠어요"),
      h("button", { class: "fchip", onclick: () => { stuckUi.open = true; drawLesson(); } }, "또 막혔어요"),
      h("button", { class: "fchip", onclick: (e) => send({ do: "stuck_leave" })(e) }, "그만하고 돌아가기")));
}
if (FLOAT) {
  document.documentElement.classList.add("float");
  fetch("/api/float").then((r) => r.json()).then((st) => { floatUi.pinned = !!st.pinned; floatUi.size = st.size === "wide" ? "wide" : "normal"; if (lessonCtx) drawLesson(); }).catch(() => {});
  // 창 높이가 띠만 하면(타이핑 중) 띠 화면으로
  const pillCheck = () => document.documentElement.classList.toggle("pill", window.innerHeight < 110);
  window.addEventListener("resize", pillCheck); pillCheck();
}
// VS Code 탭 안이면 확장이 지금 열린 폴더를 알려 준다(root). 다른 폴더가 필요하면 확장에 "그 폴더 열어 줘"를 보낸다.
const VS_ROOT = EMBED ? new URLSearchParams(location.search).get("root") : null;
const normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
const inThisFolder = (p) => !VS_ROOT || normPath(p) === normPath(VS_ROOT);
function openFolder(p) { window.parent.postMessage({ recallerOpenFolder: p }, "*"); }
function switchingNote(text) {
  view.replaceChildren(h("div", { class: "empty", style: "margin:48px auto" },
    h("div", { class: "spin" }), h("h1", { style: "margin-top:14px" }, text),
    h("p", {}, "VS Code 창이 작업 폴더로 바뀌면서 잠깐 새로 고쳐져요. 튜터는 오른쪽에 다시 떠요."),
    h("p", { class: "mut small" }, "\"이 폴더의 작성자를 신뢰합니까?\" 창이 뜨면 [예, 작성자를 신뢰합니다]를 누르세요.")));
}
// 화면 조립 때 "조건 ? 요소 : null"을 그대로 넣어도 "null" 글자가 찍히지 않게(초보 화면에 null이 보이던 문제)
for (const name of ["replaceChildren", "append", "prepend"]) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...kids) { return orig.apply(this, kids.filter((k) => k !== null && k !== undefined && k !== false)); };
}
const view = $("#view");
let status = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`);
  return data;
}
function toast(text, ms = 3200) {
  const t = $("#toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
/** 버튼을 누른 동안 돌림표. 실패하면 알림. */
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  try { return await fn(); }
  catch (e) { toast(e.message, 5000); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove("busy"); } }
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function loadStatus() {
  status = await api("GET", "/api/status");
  const ai = status.ai;
  const chip = $("#aiChip");
  chip.className = "chip " + (ai.mode === "off" ? "" : ai.limit && ai.used >= ai.limit ? "bad" : "acc");
  chip.textContent = ai.mode === "off" ? "AI 꺼짐 · 준비된 힌트" : ai.mode === "fake" ? "AI 가짜(시험용)" : ai.limit ? `AI ${ai.used}/${ai.limit}회` : `AI ${ai.used}회`;
  chip.title = (ai.mode === "app" ? "앱(3000)과 같은 ChatGPT 로그인을 써요. 이 실험의 허용 횟수예요." : "") + (status.engine ? ` 튜터 엔진: ${status.engine}` : "");
  const pick = $("#runPick");
  pick.innerHTML = "";
  pick.append(h("option", { value: "" }, status.runs.length ? "진행 중인 코스…" : "진행 중인 코스 없음"));
  for (const r of status.runs) pick.append(h("option", { value: r.id }, `${r.current}단계 · ${new Date(r.createdAt).toLocaleDateString("ko-KR")} (${r.id.slice(0, 4)})`));
  const m = /#\/run\/(\w+)/.exec(location.hash);
  pick.value = m ? m[1] : "";
  if (!status.node.ok) { $("#nodeWarn").hidden = false; $("#nodeWarn").textContent = status.node.message; }
}
$("#runPick").onchange = (e) => { if (e.target.value) go(`#/run/${e.target.value}`); };
$("#newIntake").onclick = (e) => busy(e.target, async () => { const it = await api("POST", "/api/intake", {}); go(`#/intake/${it.id}`); });

async function route() {
  await loadStatus().catch(() => {});
  const hash = location.hash;
  let m;
  try {
    if (hash === "#/lab") return await renderLab();
    if ((m = /^#\/intake\/(\w+)/.exec(hash))) return await renderIntake(m[1]);
    if ((m = /^#\/run\/(\w+)\/summary/.exec(hash))) return await renderSummary(m[1]);
    if ((m = /^#\/run\/(\w+)\/cards/.exec(hash))) return await renderRun(m[1]);
    if ((m = /^#\/run\/(\w+)\/vscode/.exec(hash))) return await renderHandoff(m[1]);
    if ((m = /^#\/run\/(\w+)\/notes/.exec(hash))) return await renderNotes(m[1]);
    if ((m = /^#\/run\/(\w+)/.exec(hash))) return await renderRunOrLesson(m[1]);
    // 11/4 사용자 "홈은 대화 첫 시작만, 예전식은 다 숨겨": 들어오면 늘 홈(대화 시작 + 대화 목록)
    return await renderHome();
  } catch (e) {
    view.replaceChildren(h("div", { class: "empty" }, h("h1", {}, "열지 못했어요"), h("p", {}, e.message), h("button", { class: "btn", onclick: () => go("#/") }, "처음으로")));
  }
}
window.addEventListener("hashchange", route);

function resumeRun(r) {
  if (FLOAT) return busy(null, async () => { await api("POST", `/api/runs/${r.id}/editor`).catch(() => null); go(`#/run/${r.id}`); });
  if (EMBED && r.workspace && !inThisFolder(r.workspace)) { switchingNote("하던 곳으로 가는 중이에요"); openFolder(r.workspace); return; }
  go(`#/run/${r.id}`);
}
/* ---------- 홈(11/4 사용자 "최소한만: 대화 첫 시작 → 대화창, 홈 누르면 대화 목록, 새 대화") ---------- */
async function renderHome() {
  const chats = await api("GET", "/api/chats").catch(() => []);
  const input = h("textarea", { rows: 3, class: "hin", placeholder: "무엇을 배워 볼까요? (Enter 시작, Shift+Enter 줄바꿈)", "aria-label": "첫 질문" });
  const btn = h("button", { class: "btn primary" }, "시작");
  const start = (e) => {
    const text = input.value.trim(); if (!text) return input.focus();
    busy(btn, async () => {
      // 웹 화면에서 시작하면 VS Code만 열고 튜터 창은 띄우지 않는다(이 화면이 대화창). 튜터 창·VS Code 탭 안에서는 여는 것 없이
      const out = await api("POST", "/api/free", { courseId: "hello-api", course: "none", open: !FLOAT && !EMBED, float: false });
      await api("POST", `/api/runs/${out.runId}/lesson/1/act`, { do: "ask", text });
      openChat({ runId: out.runId, workspace: out.workspace });
    });
  };
  btn.onclick = start;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); start(e); } });
  const when = (at) => { const d = new Date(at); const t = Date.now() - d; return t < 864e5 ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); };
  const list = chats.length ? h("div", { class: "hlist" }, h("div", { class: "mut small" }, "이전 대화"),
    chats.map((c) => h("button", { class: "hitem", onclick: () => openChat(c) }, h("span", { class: "grow" }, c.title), h("span", { class: "mut small" }, c.busy ? "답하는 중" : when(c.at))))) : null;
  view.replaceChildren(h("div", { class: `home2 ${FLOAT ? "fw" : ""}` }, h("h1", {}, "무엇을 배워 볼까요?"), h("div", { class: "hbox" }, input, btn), list));
  input.focus();
}
/** 대화 열기: 튜터 창이면 VS Code 폴더도 그 대화로, VS Code 탭이면 폴더가 다를 때 폴더부터 */
function openChat(c) {
  if (FLOAT) return busy(null, async () => { await api("POST", `/api/runs/${c.runId}/editor`).catch(() => null); go(`#/run/${c.runId}`); });
  if (EMBED && c.workspace && !inThisFolder(c.workspace)) { switchingNote("그 대화의 작업 폴더로 가는 중이에요"); openFolder(c.workspace); return; }
  go(`#/run/${c.runId}`);
}

/** 코스를 시작한 뒤: 튜터 탭 안이면 작업 폴더로, 밖이면 VS Code 열기 안내로 */
function afterStart(out) {
  // 튜터 창(VS Code 위)에서 시작하면: 새 작업 폴더를 VS Code로 열고, 창은 바로 새 진행으로
  if (FLOAT) return api("POST", `/api/runs/${out.runId}/editor`).catch(() => null).then(() => go(`#/run/${out.runId}`));
  if (EMBED) { if (inThisFolder(out.workspace)) return go(`#/run/${out.runId}`); switchingNote("작업 폴더를 여는 중이에요"); openFolder(out.workspace); return; }
  go(`#/run/${out.runId}/vscode`);
}

/* =================== 코스 정하기 =================== */
async function renderIntake(id) {
  const it = await api("GET", `/api/intake/${id}`);
  const box = h("div", { class: "chat" });
  box.append(h("div", { class: "chat-head" }, h("h1", {}, "코스 정하기"),
    h("div", { class: "mut small" }, it.mode === "ai" ? "AI와 대화해요. 버튼으로 골라도, 직접 써도 돼요." : "정해진 질문으로 진행해요.")));
  const lastAskIdx = it.messages.map((m) => !!m.ask).lastIndexOf(true);
  it.messages.forEach((m, i) => {
    if (m.text) box.append(h("div", { class: `msg ${m.role}` }, h("div", { class: "bubble" }, m.text)));
    if (m.ask && i === lastAskIdx && !it.confirmedRun) { const card = askCard(it, m.ask); if (card) box.append(card); }
  });
  if (it.confirmedRun) box.append(h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn primary", onclick: () => go(`#/run/${it.confirmedRun}`) }, "코스로 가기")));
  const input = h("input", { placeholder: "자유롭게 적어도 돼요 (Enter)", "aria-label": "메시지" });
  const send = h("button", { class: "btn primary", type: "submit" }, "보내기");
  const form = h("form", { onsubmit: (e) => { e.preventDefault(); const text = input.value.trim(); if (!text) return; busy(send, async () => { await api("POST", `/api/intake/${id}/answer`, { text }); input.value = ""; await renderIntake(id); }); } }, input, send);
  const comp = h("div", { class: "composer" }, form);
  view.replaceChildren(box, it.confirmedRun ? "" : comp);
  window.scrollTo({ top: document.body.scrollHeight });
  if (!it.confirmedRun) setTimeout(() => input.focus(), 50);
}

function askCard(it, ask) {
  const id = it.id;
  if (ask.kind === "text") return h("div", { class: "ask" }, h("div", { class: "q" }, ask.question), h("div", { class: "mut small" }, "↓ 아래 칸에 적고 Enter를 누르세요. 짧아도 괜찮아요.")); // 답은 아래 입력창으로
  if (ask.kind === "choice") {
    const picked = new Set();
    const opts = h("div", { class: "opts" });
    const ok = h("button", { class: "btn primary small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/intake/${id}/answer`, { choice: [...picked] }); await renderIntake(id); }) }, "확인");
    ask.options.forEach((o, i) => {
      const b = h("button", { class: "opt", onclick: (e) => {
        if (!ask.multi) return busy(e.target, async () => { await api("POST", `/api/intake/${id}/answer`, { choice: [i] }); await renderIntake(id); });
        picked.has(i) ? picked.delete(i) : picked.add(i); b.classList.toggle("on");
      } }, o);
      opts.append(b);
    });
    return h("div", { class: "ask" }, h("div", { class: "q" }, ask.question), opts, ask.multi ? h("div", { class: "row", style: "margin-top:10px" }, ok, h("span", { class: "mut small" }, "여러 개 고를 수 있어요")) : null);
  }
  if (ask.kind === "diagnose") {
    const answers = {};
    const items = ask.items.map((d) => {
      const opts = h("div", { class: "opts" });
      d.options.forEach((o, i) => {
        const b = h("button", { class: "opt", onclick: () => { answers[d.id] = i; opts.querySelectorAll(".opt").forEach((x) => x.classList.remove("on")); b.classList.add("on"); } }, o);
        opts.append(b);
      });
      return h("div", { class: "diag-item" }, h("div", { class: "q" }, d.q), opts);
    });
    const submit = h("button", { class: "btn primary", onclick: (e) => {
      if (Object.keys(answers).length < ask.items.length) return toast("모든 문제에 답해 주세요. 모르면 '잘 모르겠어요'.");
      busy(e.target, async () => { await api("POST", `/api/intake/${id}/diagnose`, { answers }); await renderIntake(id); });
    } }, "제출하고 계획 보기");
    return h("div", { class: "ask" }, h("div", { class: "q" }, ask.question), ...items, h("div", { style: "margin-top:12px" }, submit));
  }
  if (ask.kind === "proposal") return planCard(it, ask);
  return null;
}

function planCard(it, ask) {
  const plan = structuredClone(ask.plan);
  const card = h("div", { class: "ask plan" });
  const draw = async () => {
    const courses = await api("GET", "/api/courses");
    const course = courses.find((c) => c.id === ask.courseId);
    const main = course.stages.filter((s) => !s.transfer);
    const tl = h("div", { class: "timeline" });
    for (const s of course.stages) {
      let mode = s.transfer ? (plan.transfer ? "full" : "skip") : s.n < plan.start ? "skip" : plan.quick.includes(s.n) ? "quick" : "full";
      const sel = h("select", { "aria-label": `${s.n}단계 방식`, onchange: (e) => {
        const v = e.target.value;
        if (s.transfer) plan.transfer = v !== "skip";
        else if (v === "skip") { plan.start = Math.max(plan.start, s.n + 1); if (!main.some((x) => x.n === plan.start)) plan.start = main.at(-1).n; }
        else {
          if (s.n < plan.start) plan.start = s.n;
          plan.quick = plan.quick.filter((q) => q !== s.n && q > plan.start);
          if (v === "quick" && s.n !== plan.start) plan.quick.push(s.n);
        }
        draw();
      } },
        s.transfer ? [h("option", { value: "full" }, "한다"), h("option", { value: "skip" }, "안 한다")]
          : [h("option", { value: "full" }, "직접 하기"), h("option", { value: "quick" }, "빠르게"), h("option", { value: "skip" }, "건너뛰기")]);
      sel.value = mode;
      tl.append(h("div", { class: `tl ${mode}` }, h("div", { class: "n" }, s.transfer ? "전이 과제" : `${s.n}단계`), h("div", {}, s.title), sel));
    }
    const minutes = main.filter((s) => s.n >= plan.start).reduce((a, s) => a + (plan.quick.includes(s.n) ? 10 : 35), 0) + (plan.transfer ? 25 : 0);
    card.replaceChildren(
      h("div", { class: "row" }, h("h2", { class: "grow" }, course.title), h("span", { class: "chip" }, course.stack)),
      h("div", { class: "mut small" }, `예상 ${Math.round(minutes / 6) / 10}시간 · ${plan.start}단계부터`),
      tl,
      h("ul", {}, ask.plan.reasons.map((r) => h("li", {}, r))),
      ask.plan.notes.length ? h("ul", { class: "mut small" }, ask.plan.notes.map((r) => h("li", {}, r))) : null,
      h("div", { class: "mut small" }, "직접 하기: 튜터와 코드를 읽고 직접 고쳐요. · 빠르게: 설명만 보고 정답 코드로 넘어가요. · 건너뛰기: 그 단계 코드는 완성된 채로 받아요. 단계마다 아래 칸에서 바꿀 수 있어요."),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => {
        await afterStart(await api("POST", `/api/intake/${it.id}/confirm`, { plan }));
      }) }, "이 계획으로 시작")));
  };
  draw();
  return card;
}

/* =================== 코스 진행 =================== */
let current = null;
async function renderRun(id, keepScroll = false) {
  const y = window.scrollY;
  const run = await api("GET", `/api/runs/${id}`);
  current = run;
  api("POST", `/api/runs/${id}/activate`).catch(() => {});
  const st = run.stage;
  view.replaceChildren(h("div", { class: "course" }, rail(run), h("div", { class: "main" },
    stageHead(run, st), workspaceCard(run, st),
    predictCard(run, st), observeCard(run, st), fixCard(run, st), recheckCard(run, st), explainCard(run, st), recordsCard(run, st))));
  if (keepScroll) window.scrollTo({ top: y });
}
const refresh = () => renderRun(current.id, true);

function rail(run) {
  return h("nav", { class: "rail" },
    h("div", { class: "title" }, run.course.title),
    run.stages.map((s) => {
      const cls = ["st", s.n === run.current ? "cur" : "", s.status?.done ? (s.status.independent ? "done" : "helped") : "", s.inPlan || s.status?.started ? "" : "out"].join(" ");
      const sub = s.status?.done ? (s.status.skipped ? "빠르게 넘어감" : s.status.independent ? "직접 통과" : "도움 받아 통과") : s.before ? "완성된 채로 받음" : !s.inPlan ? "계획에 없음" : s.quick ? "빠르게" : s.status?.started ? "진행 중" : "";
      return h("button", { class: cls, onclick: (e) => busy(e.currentTarget, async () => {
        if (s.n === run.current) return;
        const out = await api("POST", `/api/runs/${run.id}/stage/${s.n}/start`, {});
        if (out.rewritten) toast(`${s.n}단계 시작 상태로 작업 폴더를 바꿨어요.${out.backup ? " 전 파일은 .recaller/backup에 있어요." : ""}`, 5000);
        await renderRun(run.id);
      }) }, h("span", { class: "dot" }, s.status?.done ? "✓" : s.transfer ? "⇢" : s.n), h("span", {}, h("div", { class: "lbl" }, s.transfer ? "전이: " + s.title.replace("전이 과제: ", "") : s.title), sub ? h("div", { class: "sub" }, sub) : null));
    }),
    h("div", { class: "sep", style: "height:6px" }),
    h("button", { class: "btn small", onclick: () => go(`#/run/${run.id}/summary`) }, "결과와 기록 후보 보기"));
}

function stageHead(run, st) {
  return h("section", { class: "card stage-head" },
    h("div", { class: "row" }, h("span", { class: "chip acc" }, st.transfer ? "전이 과제" : `${st.n}단계`), st.quick ? h("span", { class: "chip warn" }, "빠르게") : null, h("span", { class: "mut small" }, run.course.stack)),
    h("h1", { style: "margin-top:8px" }, st.title),
    h("p", {}, h("strong", {}, st.goal)),
    h("p", { class: "mut" }, st.intro),
    h("div", { class: "row", style: "margin-top:10px" }, st.knowledge.map((k) => h("span", { class: "chip", title: k.essentials }, k.name))));
}

function workspaceCard(run, st) {
  const dev = run.dev;
  const ready = run.workspaceStage === st.n;
  const logs = h("div", { class: "logs", hidden: true }, (dev.logs || []).join("\n") || "(로그 없음)");
  return h("section", { class: "card ws" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "작업 공간"),
      dev.running ? h("span", { class: "chip ok" }, `서버 켜짐 :${dev.port}`) : h("span", { class: "chip" }, "서버 꺼짐")),
    h("div", { class: "path", title: "작업 폴더" }, run.workspace),
    h("div", { class: "row" },
      ready ? h("button", { class: "btn", onclick: (e) => { if (confirm("이 단계의 시작 상태로 되돌릴까요? 지금 파일은 .recaller/backup에 남아요.")) busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${st.n}/start`, { reset: true }); toast("시작 상태로 되돌렸어요."); await refresh(); }); } }, "처음 상태로 되돌리기")
        : h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${st.n}/start`, {}); await refresh(); }) }, "작업 폴더 만들기"),
      h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { const r = await api("POST", `/api/runs/${run.id}/editor`); toast(r.ok ? "VS Code를 열었어요." : r.message, 6000); }) }, "VS Code로 열기"),
      h("button", { class: "btn", onclick: () => { navigator.clipboard?.writeText(run.workspace); toast("경로를 복사했어요."); } }, "경로 복사"),
      dev.running
        ? h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/dev/stop`); await refresh(); }) }, "서버 끄기")
        : h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { const d = await api("POST", `/api/runs/${run.id}/dev/start`); if (d.exited) toast("서버가 바로 꺼졌어요. 로그를 보세요.", 5000); await refresh(); }) }, "서버 켜기"),
      dev.running ? h("a", { href: `http://127.0.0.1:${dev.port}/`, target: "_blank", rel: "noopener" }, "게시판 화면 열기") : null,
      h("button", { class: "btn ghost small", onclick: async (e) => { const d = await api("GET", `/api/runs/${run.id}/dev`); logs.textContent = (d.logs || []).join("\n") || "(로그 없음)"; logs.hidden = !logs.hidden; e.target.textContent = logs.hidden ? "로그 보기" : "로그 닫기"; } }, "로그 보기")),
    logs,
    dev.exited ? h("div", { class: "banner bad", style: "margin:0" }, `서버가 꺼졌어요 (종료 코드 ${dev.exited.code}). 로그에서 오류 위치를 확인하세요.`) : null);
}

function predictCard(run, st) {
  const allDone = st.predict.every((p) => p.done);
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: `num ${allDone ? "done" : ""}` }, "1"), "결과 예측"),
    h("div", { class: "mut small", style: "margin-bottom:8px" }, "코드를 돌리기 전에 먼저 생각해요. 처음 고른 답이 기록돼요."),
    st.predict.map((p) => {
      const box = h("div", { class: "pq" }, h("div", { class: "q" }, p.q));
      const opts = h("div", { class: "opts" });
      p.options.forEach((o, i) => {
        const cls = ["opt", p.done ? (i === p.done.answer ? "right" : i === p.done.choice ? "wrong" : "") : ""].join(" ");
        opts.append(h("button", { class: cls, disabled: !!p.done, onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${st.n}/predict`, { pid: p.id, choice: i }); await refresh(); }) }, o));
      });
      box.append(opts);
      if (p.done) box.append(h("div", { class: `verdict ${p.done.correct ? "ok" : "bad"}` }, h("strong", {}, p.done.correct ? "맞았어요. " : "다시 볼 곳이에요. "), p.done.why));
      return box;
    }),
    st.quick && allDone && !st.progress?.doneAt ? h("div", { class: "row", style: "margin-top:10px" },
      h("span", { class: "mut small grow" }, "빠르게 단계예요. 원리를 알았으면 정답 코드로 넘어갈 수 있어요(직접 고침으로는 기록되지 않아요)."),
      h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${st.n}/skip`); toast("정답 코드로 채웠어요."); await refresh(); }) }, "정답 코드로 넘어가기")) : null);
}

function resultsList(res, opts = {}) {
  if (!res) return null;
  const wrap = h("div", { class: "results" });
  if (!res.started) wrap.append(h("div", { class: "banner bad", style: "margin:0" }, h("pre", {}, res.startError)));
  const groups = opts.group ? [["이번 단계", res.results.filter((r) => !r.regression)], ["이전 단계 (회귀 검사)", res.results.filter((r) => r.regression)]] : [["", res.results]];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    if (title) wrap.append(h("div", { class: "group-t" }, `${title} · ${list.filter((r) => r.ok).length}/${list.length} 통과`));
    for (const r of list) {
      const kind = { normal: "정상", boundary: "경계", error: "오류" }[r.kind] || r.kind;
      const f = r.failure;
      wrap.append(h("div", { class: `res ${r.ok ? "ok" : "bad"}` },
        h("div", { class: "t" }, h("span", { class: "mark" }, r.ok ? "✓" : "✗"), h("span", { class: "grow" }, r.title), h("span", { class: "chip" }, kind), r.regression ? h("span", { class: "chip" }, `${r.stage}단계`) : null),
        !r.ok && f ? h("div", { class: "cmp" },
          f.request ? [h("span", { class: "k" }, "요청"), h("code", {}, f.request)] : null,
          h("span", { class: "k" }, "기대"), h("span", {}, f.expected),
          h("span", { class: "k" }, "실제"), h("span", {}, f.actual),
          f.note ? [h("span", { class: "k" }, ""), h("span", { class: "mut" }, f.note)] : null,
          r.where ? [h("span", { class: "k" }, "위치"), h("span", { class: "where" }, `${r.where.file}${r.where.line ? `:${r.where.line}` : ""} (후보)`)] : null,
          r.logHits?.length ? [h("span", { class: "k" }, "로그"), h("span", { class: "where" }, r.logHits.map((x) => `${x.file}:${x.line}`).join(", "))] : null) : null));
    }
  }
  wrap.append(h("div", { class: "mut small" }, `${res.passed}개 통과 · ${res.failed}개 실패 · ${(res.ms / 1000).toFixed(1)}초`));
  return wrap;
}

function observeCard(run, st) {
  const out = h("div", {});
  const tryp = tryPanel(run, st);
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: `num ${st.progress?.observedAt ? "done" : ""}` }, "2"), "없애 보기: 지금 코드로 확인"),
    h("p", { style: "margin:0 0 8px" }, st.observe.text),
    h("div", { class: "mut small" }, "확인할 것: " + st.observe.checks.join(" · ")),
    h("div", { class: "row", style: "margin-top:10px" }, h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => {
      const r = await api("POST", `/api/runs/${run.id}/stage/${st.n}/check`, { purpose: "observe" });
      out.replaceChildren(resultsList(r));
    }) }, "지금 코드로 확인하기")),
    out, tryp);
}

function tryPanel(run, st) {
  const reply = h("div", { class: "reply", hidden: true });
  const method = h("select", {}, ["GET", "POST", "PATCH", "DELETE"].map((m) => h("option", {}, m)));
  const pathIn = h("input", { value: "/health", "aria-label": "주소" });
  const as = h("select", { "aria-label": "누구로" }, h("option", { value: "" }, "로그인 없이"), h("option", { value: "A" }, "A로"), h("option", { value: "B" }, "B로"));
  const bodyIn = h("textarea", { placeholder: '본문 JSON (예: {"title":"첫 글"})' });
  const sendBtn = h("button", { class: "btn", onclick: (e) => busy(e.target, async () => {
    const text = bodyIn.value.trim();
    let body, raw;
    if (text) { try { body = JSON.parse(text); } catch { raw = text; } }
    const r = await api("POST", `/api/runs/${run.id}/try`, { method: method.value, path: pathIn.value, body, raw, as: as.value || undefined });
    reply.hidden = false;
    const hdr = Object.entries(r.headers || {}).filter(([k]) => ["content-type", "location", "allow", "set-cookie", "x-total-count"].includes(k)).map(([k, v]) => `${k}: ${v}`).join("\n");
    reply.textContent = `${r.request}\n→ ${r.timedOut ? "응답 없음 (3초 기다림)" : r.error ? `연결 실패: ${r.error}` : r.status}\n${hdr ? hdr + "\n" : ""}${r.body || ""}`;
  }) }, "보내기");
  const presets = h("div", { class: "presets" }, st.try.map((p) => h("button", { class: "btn small", onclick: () => {
    method.value = p.method; pathIn.value = p.path; as.value = p.as || ""; bodyIn.value = p.raw ?? (p.body ? JSON.stringify(p.body) : "");
  } }, p.label)));
  return h("div", { class: "tryp" },
    h("div", { class: "row" }, h("strong", {}, "직접 요청 보내 보기"), h("span", { class: "mut small" }, run.dev.running ? "실습 서버(4101)에 보내요. A·B는 로그인하면 쿠키를 기억해요." : "[서버 켜기]를 누르면 보낼 수 있어요.")),
    presets, h("div", { class: "form" }, method, pathIn, as, sendBtn), bodyIn, reply);
}

function partCard(p) {
  return h("div", { class: "part" }, h("h3", {}, p.name, " ", h("span", { class: "mut mono" }, p.files.join(", "))),
    h("dl", {}, h("dt", {}, "역할"), h("dd", {}, p.role), h("dt", {}, "핵심"), h("dd", {}, p.core), h("dt", {}, "받고 냄"), h("dd", {}, p.io),
      h("dt", {}, "없으면"), h("dd", {}, p.without), h("dt", {}, "흔한 실수"), h("dd", {}, p.mistake)));
}

function fixCard(run, st) {
  const hintOut = h("div", {});
  const used = new Set((st.progress?.hints || []).map((x) => x.level));
  const hintBtn = (lvl, label) => h("button", { class: "btn small", disabled: lvl > 1 && !used.has(lvl - 1), onclick: (e) => {
    if (lvl === 3 && !confirm("정답 줄을 볼까요? 이걸 본 뒤의 통과는 '직접 고침'으로 기록하지 않아요.")) return;
    busy(e.target, async () => {
      const r = await api("POST", `/api/runs/${run.id}/stage/${st.n}/hint`, { level: lvl });
      hintOut.replaceChildren(h("div", { class: `hintbox ${lvl === 3 ? "sol" : ""}` }, h("div", { class: "mut small", style: "font-family:inherit;margin-bottom:4px" }, `힌트 ${lvl}단계 · ${r.source.startsWith("ai") ? "AI" : r.source === "solution" ? "준비된 정답" : "준비된 힌트"}`), r.text));
      used.add(lvl);
      hintRow.replaceChildren(hintBtn(1, "1 방향"), hintBtn(2, "2 위치"), hintBtn(3, "3 정답 줄"));
    });
  } }, label);
  const hintRow = h("span", { class: "row" }, hintBtn(1, "1 방향"), hintBtn(2, "2 위치"), hintBtn(3, "3 정답 줄"));
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: "num" }, "3"), "VS Code에서 고치기"),
    h("p", { style: "margin:0 0 6px" }, st.fix.text),
    h("div", { class: "mut small" }, "파일: ", st.fix.files.map((f) => h("code", {}, f, " "))),
    h("details", { style: "margin-top:10px" }, h("summary", {}, `이 단계의 부품 카드 (${st.parts.length})`), h("div", { class: "parts" }, st.parts.map(partCard))),
    h("div", { class: "row", style: "margin-top:12px" }, h("span", { class: "mut small" }, "막히면 힌트:"), hintRow),
    hintOut);
}

function recheckCard(run, st) {
  const out = h("div", {}, run.lastCheck ? resultsList(run.lastCheck, { group: true }) : null);
  const p = st.progress;
  const doneBar = p?.doneAt ? h("div", { class: `donebar ${p.independent ? "ok" : "helped"}` },
    h("strong", { class: "grow" }, p.skipped ? "정답 코드로 넘어갔어요." : p.independent ? "직접 고쳐서 통과했어요." : "정답 줄을 본 뒤 통과했어요. 다음 복습에서 코드 없이 다시 확인해요."),
    nextBtn(run, st)) : null;
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: `num ${p?.doneAt ? "done" : ""}` }, "4"), "재검사"),
    h("div", { class: "mut small" }, `이번 단계와 이전 단계 검사 ${st.checks.length}개를 모두 돌려요. 검사용 서버(4102)와 검사용 DB를 따로 써서, 내 개발 DB는 그대로예요.`),
    h("div", { class: "row", style: "margin-top:10px" }, h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => {
      const r = await api("POST", `/api/runs/${run.id}/stage/${st.n}/check`, { purpose: "check" });
      if (r.newlyDone) { toast(r.independent ? "통과! 직접 고친 기록을 남겼어요." : "통과했어요."); await refresh(); }
      else out.replaceChildren(resultsList(r, { group: true }));
    }) }, "검사하기"), p?.runs?.length ? h("span", { class: "mut small" }, `검사 ${p.runs.length}번 실행`) : null),
    out, doneBar);
}
function nextBtn(run, st) {
  const order = run.stages.filter((s) => s.inPlan).map((s) => s.n);
  const next = order.find((n) => n > st.n);
  if (!next) return h("button", { class: "btn", onclick: () => go(`#/run/${run.id}/summary`) }, "결과 보기");
  return h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${next}/start`, {}); window.scrollTo({ top: 0 }); await renderRun(run.id); }) }, `다음: ${next}단계 →`);
}

function explainCard(run, st) {
  const ta = h("textarea", { class: "explain", placeholder: "내 말로 짧게" }, st.explain.done?.text || "");
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: `num ${st.explain.done ? "done" : ""}` }, "5"), "내 말로 설명하기"),
    h("p", { style: "margin:0 0 8px" }, st.explain.q),
    ta,
    h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/stage/${st.n}/explain`, { text: ta.value }); toast("저장했어요. 맞는지는 복습 때 다시 봐요."); await refresh(); }) }, "저장"),
      h("span", { class: "mut small" }, "채점하지 않아요. 기록 후보에 메모로 남아요.")));
}

const KIND = { met: ["만남", ""], correct: ["맞힘", "ok"], wrong: ["틀림", "bad"], hint: ["힌트", "warn"], asked: ["물어봄", "warn"], note: ["메모", ""] };
function recordsCard(run) {
  const items = run.records.items;
  return h("section", { class: "card" },
    h("h2", {}, h("span", { class: "num" }, "6"), "이 단계에서 나온 학습 기록 후보"),
    h("div", { class: "mut small", style: "margin-bottom:8px" }, "실제 지식 저장소에는 아직 넣지 않고 파일로만 남겨요. 직접 한 활동만 '맞힘'이 돼요."),
    items.length ? h("div", { class: "recs" }, items.map((r) => h("div", { class: "rec" }, h("span", { class: `chip ${KIND[r.kind]?.[1] || ""}` }, KIND[r.kind]?.[0] || r.kind), h("span", {}, h("strong", {}, r.knowledgeName), " · ", r.detail))))
      : h("div", { class: "mut small" }, "아직 없어요."),
    h("div", { class: "path", style: "margin-top:8px" }, run.records.file));
}

/* =================== VS Code로 넘어가기 =================== */
// 코스를 정하면 VS Code가 저절로 열리고, 이 창은 "어디서 계속하는지"만 알려 준다.
let handoffTimer = null;
async function renderHandoff(id) {
  clearInterval(handoffTimer);
  const run = await api("GET", `/api/runs/${id}`);
  const step = (state, title, desc) => h("li", { class: `hstep ${state}` }, h("span", { class: "hdot" }, state === "done" ? "✓" : state === "now" ? "" : "·"), h("div", {}, h("strong", {}, title), desc ? h("div", { class: "mut small" }, desc) : null));
  const box = h("div", { class: "handoff" });
  let opened = null;
  const draw = (connected) => {
    box.replaceChildren(
      h("h1", {}, connected ? "준비됐어요!" : "VS Code에서 이어서 해요"),
      h("p", { class: "mut" }, connected
        ? "VS Code 오른쪽에 튜터가 나타났어요. 이제 이 창은 닫아도 돼요."
        : "공부는 VS Code에서 해요. 왼쪽에 코드, 오른쪽에 튜터가 뜨고, 튜터가 하나씩 알려 드려요."),
      h("ol", { class: "hsteps" },
        step("done", "작업 폴더를 만들었어요", run.workspace),
        step(opened === null ? "now" : opened.ok ? "done" : "bad", "VS Code 열기", opened === null ? "여는 중… 처음에는 '이 작성자를 신뢰하시겠습니까?' 창이 뜰 수 있어요. [예]를 누르세요." : opened.ok ? (opened.message || "열었어요.") : opened.message),
        step(connected ? "done" : opened?.ok ? "now" : "wait", "튜터 연결", connected ? "연결됐어요." : "VS Code가 열리면 오른쪽에 튜터가 저절로 떠요. 30초가 지나도 안 뜨면 VS Code에서 Ctrl+Shift+P → \"Reload Window\"를 입력하세요.")),
      opened && !opened.ok ? h("div", { class: "banner warn", style: "margin:0" },
        h("div", {}, "VS Code를 자동으로 열지 못했어요. VS Code를 직접 켜고 [파일 → 폴더 열기]에서 아래 폴더를 여세요."),
        h("div", { class: "path", style: "margin-top:6px" }, run.workspace),
        h("button", { class: "btn small", style: "margin-top:6px", onclick: () => { navigator.clipboard?.writeText(run.workspace); toast("경로를 복사했어요."); } }, "경로 복사")) : null,
      h("div", { class: "row", style: "margin-top:8px" },
        h("button", { class: "btn", onclick: (e) => busy(e.target, open) }, "VS Code 다시 열기"),
        h("button", { class: "btn ghost", onclick: () => { clearInterval(handoffTimer); go(`#/run/${id}`); } }, "VS Code 없이 이 브라우저에서 하기")));
  };
  const open = async () => { opened = await api("POST", `/api/runs/${id}/editor`).catch((e) => ({ ok: false, message: e.message })); draw(false); };
  view.replaceChildren(h("div", { class: "empty", style: "text-align:left" }, box));
  draw(false);
  open();
  handoffTimer = setInterval(async () => {
    if (!location.hash.includes("/vscode")) return clearInterval(handoffTimer);
    const l = await api("GET", `/api/runs/${id}/lesson/${run.current}`).catch(() => null);
    if (l?.bridge?.connected) { clearInterval(handoffTimer); draw(true); }
  }, 1500);
}

/* =================== 프로젝트 노트 (학습자 기억, 파일별) =================== */
const NOTE_KIND = { block: ["💬", "덩어리 설명"], asked: ["❓", "질문"], word: ["🔤", "물어본 말"], what: ["🔤", "이건 뭐예요"], tour: ["🧭", "흐름 투어"], fixed: ["✅", "고침"], edited: ["🛠", "튜터가 고침"] };
const SCOPE_CLS = { 문법: "s-syn", 도구: "s-tool", 프로젝트: "s-proj" };
async function renderNotes(id) {
  const run = await api("GET", `/api/runs/${id}`);
  const nv = await api("GET", `/api/runs/${id}/notes`);
  const ws = nv.workspace;
  const askAbout = (text, shown) => busy(null, async () => { await api("POST", `/api/runs/${id}/lesson/${run.current}/act`, { do: "ask", mode: "explain", text, shown }); go(`#/run/${id}`); });
  const openF = (file, line = 1) => api("POST", `/api/runs/${id}/lesson/${run.current}/act`, { do: "open", file, line }).catch(() => {});
  // 연결 지도: import로 이어진 순서(아무도 가져다 쓰지 않는 파일 = 시작점부터)
  const byFile = new Map(nv.files.map((f) => [f.file, f]));
  const roots = nv.files.filter((f) => f.exists && !f.usedBy.length).map((f) => f.file);
  const seen = new Set();
  const tree = (f, depth) => {
    if (seen.has(f) || depth > 6) return [];
    seen.add(f);
    const x = byFile.get(f);
    const n = x?.entries.length ?? 0;
    return [h("div", { class: "tnode", style: `padding-left:${depth * 16}px` }, depth ? h("span", { class: "mut" }, "└ ") : null,
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); document.getElementById(`nf-${f}`)?.scrollIntoView({ behavior: "smooth" }); } }, f.split("/").pop()),
      x?.part ? h("span", { class: "mut small" }, ` ${x.part.name}`) : null, n ? h("span", { class: "chip acc" }, `${n}`) : null),
      ...(x?.uses ?? []).flatMap((u) => tree(u.file, depth + 1))];
  };
  const map = h("div", { class: "lcard notesmap" }, h("div", { class: "mut small" }, "파일 연결 지도 — 위 파일이 아래 파일을 가져다 써요 · 숫자는 기록 수"), ...roots.flatMap((r) => tree(r, 0)));
  const fileCard = (x) => h("div", { class: `lcard nfile ${x.entries.length ? "" : "quiet"}`, id: `nf-${x.file}` },
    h("div", { class: "row" }, h("b", { class: "grow" }, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openF(x.file); } }, x.file)), x.exists ? null : h("span", { class: "chip" }, "이 단계엔 없음")),
    x.part ? h("div", { class: "small" }, h("b", {}, x.part.name), " — ", x.part.role) : null,
    x.uses.length || x.usedBy.length || x.flowOut.length || x.flowIn.length ? h("div", { class: "nlinks small" },
      x.uses.length ? h("div", {}, h("span", { class: "mut" }, "가져다 씀 → "), x.uses.map((u) => h("span", { class: "nl" }, `${u.file.split("/").pop()}${u.names.length ? ` (${u.names.slice(0, 3).join(", ")})` : ""}`))) : null,
      x.usedBy.length ? h("div", {}, h("span", { class: "mut" }, "여기를 쓰는 곳 ← "), x.usedBy.map((u) => h("span", { class: "nl" }, u.file.split("/").pop()))) : null,
      x.flowOut.map((l) => h("div", {}, h("span", { class: "mut" }, "흐름 → "), fileLink(ws, l.to.file, l.to.line), ` ${l.label}`, h("span", { class: "mut" }, ` (여기 ${l.from.line}줄에서)`))),
      x.flowIn.map((l) => h("div", {}, h("span", { class: "mut" }, "흐름 ← "), fileLink(ws, l.from.file, l.from.line), h("span", { class: "mut" }, ` 에서 넘어옴 (${l.to.line}줄 ${l.label})`)))) : null,
    x.terms.length ? h("div", { class: "nterms" }, x.terms.slice(0, 18).map((t) => h("button", { class: `nterm ${SCOPE_CLS[t.scope]}`, title: `${t.scope}${t.asked ? ` · ${t.asked}번 물어봄` : ""} — 누르면 다시 물어봐요`, onclick: () => askAbout(`\`${t.name}\`는 뭐예요? ${x.file}에서 쓰인 뜻으로, 문법을 모르는 사람에게 3~6문장으로.`, `"${t.name}"는 뭐예요?`) }, t.name, t.asked ? h("sup", {}, t.asked) : null))) : null,
    x.entries.length ? h("ul", { class: "nentries" }, x.entries.slice(0, 30).map((e) => h("li", {},
      h("span", { class: "nk", title: NOTE_KIND[e.kind]?.[1] }, NOTE_KIND[e.kind]?.[0] ?? "•"), " ",
      e.from ? h("a", { href: "#", class: "mono small", onclick: (ev) => { ev.preventDefault(); openF(x.file, e.from); } }, `${e.from}${e.to && e.to !== e.from ? `~${e.to}` : ""}줄`) : null, e.from ? " " : null,
      h("b", {}, e.title), e.summary ? h("div", { class: "small mut" }, e.summary) : null))) : h("div", { class: "small mut" }, "아직 여기서 물어본 게 없어요. 코드 위 💬 설명을 눌러 보세요."));
  const active = nv.files.filter((f) => f.entries.length), quiet = nv.files.filter((f) => !f.entries.length && f.exists);
  const termsAll = h("div", { class: "lcard" }, h("div", { class: "mut small" }, "만난 말 — 문법·도구는 다른 프로젝트에서도 같은 뜻(복습 카드로 넘어가요), 프로젝트 이름은 이 프로젝트에서만"),
    ...["문법", "도구", "프로젝트"].map((k) => nv.terms[k].length ? h("div", { class: "nterms" }, h("span", { class: "mut small" }, `${k} `), nv.terms[k].map((t) => h("span", { class: `nterm ${SCOPE_CLS[k]}` }, t.name, t.asked ? h("sup", {}, t.asked) : null))) : null));
  view.replaceChildren(h("div", { class: "notes" },
    h("div", { class: "row" }, h("h2", { class: "grow" }, "📒 프로젝트 노트"), h("button", { class: "btn small", onclick: () => go(`#/run/${id}`) }, "수업으로")),
    h("p", { class: "small mut" }, "이 프로젝트에서 물어보고 배운 것을 파일별로 모아 둬요. 파일 사이가 어떻게 이어지는지(가져다 쓰기·흐름 투어)도 같이 보여요."),
    map, ...active.map(fileCard), Object.values(nv.terms).some((x) => x.length) ? termsAll : null,
    quiet.length ? h("details", { class: "lcard" }, h("summary", {}, `아직 기록 없는 파일 ${quiet.length}개`), ...quiet.map(fileCard)) : null));
}

/* =================== 수업 (대화) =================== */
let lessonCtx = null;
let events = null;
async function renderRunOrLesson(id) {
  const run = await api("GET", `/api/runs/${id}`);
  // 11/4 사용자 "예전식은 다 숨겨": 대화(실험판 엔진)가 아닌 예전 진행은 열지 않는다
  if (!run.chat) {
    view.replaceChildren(h("div", { class: "empty", style: "margin:40px auto" }, h("h1", {}, "예전 방식 진행이에요"), h("p", {}, "지금은 대화로만 공부해요. 홈에서 새 대화를 시작하거나 이전 대화를 고르세요."),
      h("div", { class: "row", style: "justify-content:center;margin-top:12px" }, h("button", { class: "btn primary", onclick: () => go("#/home") }, "홈으로"))));
    return;
  }
  if (EMBED && run.workspace && !inThisFolder(run.workspace)) {
    const st = run.stages.find((x) => x.n === run.current);
    view.replaceChildren(h("div", { class: "empty", style: "margin:40px auto" },
      h("div", { class: "chip acc" }, `${run.current}단계`), h("h1", { style: "margin-top:8px" }, st?.title ?? ""),
      h("p", {}, "이 단계는 다른 작업 폴더에서 해요. 아래 버튼을 누르면 VS Code가 그 폴더로 바뀌어요."),
      h("div", { class: "row", style: "justify-content:center;margin-top:12px" },
        h("button", { class: "btn primary", onclick: () => { switchingNote("작업 폴더를 여는 중이에요"); openFolder(run.workspace); } }, "작업 폴더 열기"),
        h("button", { class: "btn", onclick: () => go("#/home") }, "코스 목록"))));
    return;
  }
  if (!run.lesson) {
    if (!EMBED) return renderRun(id);
    current = run;
    const st = run.stages.find((x) => x.n === run.current);
    const prev = [...run.stages].reverse().find((x) => x.n < run.current && x.status?.started);
    view.replaceChildren(h("div", { class: "empty", style: "text-align:left;margin:32px auto" },
      h("div", { class: "chip acc" }, `${run.current}단계`), h("h1", { style: "margin-top:8px" }, st?.title ?? ""),
      h("p", {}, "이 단계의 대화형 수업은 아직 준비 중이에요. 지금은 단계 카드(예측 → 확인 → 고치기 → 검사)로 할 수 있어요. 막히면 카드 화면 아래에서도 힌트를 받을 수 있어요."),
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "btn primary", onclick: () => go(`#/run/${id}/cards`) }, "단계 카드로 하기"),
        prev ? h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${id}/stage/${prev.n}/start`, {}); go(`#/run/${id}`); }) }, `${prev.n}단계로 돌아가기`) : null)));
    return;
  }
  current = run;
  api("POST", `/api/runs/${id}/activate`).catch(() => {});
  const lesson = await api("GET", `/api/runs/${id}/lesson/${run.current}`);
  lessonCtx = { run, lesson };
  drawLesson();
  if (events) events.close();
  events = new EventSource(`/api/runs/${id}/events`);
  events.onmessage = async (e) => {
    if (!lessonCtx || lessonCtx.run.id !== id || !/^#\/run\/\w+$/.test(location.hash)) return;
    if (e.data === "saved") flashSaved();
    if (e.data === "lesson") { lessonCtx.lesson = await api("GET", `/api/runs/${id}/lesson/${lessonCtx.run.current}`); lessonCtx.run.dev = lessonCtx.lesson.dev; drawLesson(); }
  };
}

/* ---------- 글자 흘리기(11/3 사용자 "gpt챗·클로드처럼 일정한 속도로") ----------
 * 서버는 0.45초마다 덩어리로 보내 오지만, 화면은 받은 글을 일정한 속도로 한 글자씩 보여 준다.
 * 밀린 글이 많으면 빨라진다(0.6초 안에 따라잡게). 처음 열 때 이미 있던 말은 그대로 다 보인다. */
const TY = { shown: new Map(), full: new Map(), ws: "", raf: 0, last: 0, key: null, init: true };
function tyText(m, ws, key) {
  if (TY.key !== key) { TY.key = key; TY.shown.clear(); TY.full.clear(); TY.init = true; }
  const full = m.text || "";
  // 글 id는 숫자(수업) 또는 "c7"(실험판 엔진 대화) — 화면 속성과 같게 글자로 맞춘다(11/4: 숫자로 바꾸다 "c7"이 NaN이 돼 흘리기가 멈춤)
  const mid = String(m.id);
  TY.full.set(mid, full); TY.ws = ws;
  if (!TY.shown.has(mid)) TY.shown.set(mid, TY.init ? full.length : 0);
  const n = Math.floor(TY.shown.get(mid));
  return h("div", { class: "ty", "data-mid": String(m.id) }, rich(full.slice(0, n), ws));
}
function tyAfterDraw() {
  TY.init = false;
  if (!TY.raf) { TY.last = performance.now(); TY.raf = requestAnimationFrame(tyTick); }
}
function tyTick(t) {
  const dt = Math.min(0.1, (t - TY.last) / 1000); TY.last = t;
  let pending = false;
  for (const el of document.querySelectorAll(".ty[data-mid]")) {
    const id = el.dataset.mid; const full = TY.full.get(id) ?? "";
    const n0 = TY.shown.get(id) ?? full.length;
    if (n0 >= full.length) continue;
    // 11/4 사용자 "실험창이 더 빨라 보임": 밀림이 0.6초를 넘지 않게(실험창은 받은 대로 바로 보여 줌)
    const rate = Math.max(90, (full.length - n0) / 0.6); // 글자/초
    const n = Math.min(full.length, n0 + rate * dt);
    TY.shown.set(id, n);
    if (Math.floor(n) !== Math.floor(n0)) {
      const sc = el.closest(".fscroll, .fmsgs, .labchat");
      const near = sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80 : window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
      el.replaceChildren(rich(full.slice(0, Math.floor(n)), TY.ws));
      if (near) { if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollTo({ top: document.body.scrollHeight }); }
    }
    if (n < full.length) pending = true;
  }
  TY.raf = pending ? requestAnimationFrame(tyTick) : 0;
}

/** 튜터 글(마크다운): 제목, 목록, 인용, ```코드 블록```(색칠·복사·줄 링크), **굵게**, *기울임*, `코드`, [[파일:줄]] */
function rich(text, ws) {
  const box = h("div", { class: "rich" });
  const lines = String(text || "").split("\n");
  let list = null, para = [];
  // 한 줄 바꿈은 그대로 줄바꿈으로(수업 대본이 줄바꿈으로 나눠 쓴 글을 지키려고)
  const flush = () => { if (para.length) { box.append(h("p", {}, para.flatMap((l, k) => (k ? [h("br"), ...inline(l, ws)] : inline(l, ws))))); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*(.*)$/.exec(line);
    if (fence) {
      flush(); list = null;
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      box.append(codeBlock(body.join("\n"), fence[1] || "", fence[2] || "", ws));
      continue;
    }
    const hd = /^\s*(#{1,4})\s+(.*)$/.exec(line);
    if (hd) { flush(); list = null; box.append(h(hd[1].length <= 2 ? "h3" : "h4", { class: "rh" }, inline(hd[2].replace(/\*\*/g, ""), ws))); continue; }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flush(); list = null; box.append(h("blockquote", {}, inline(q[1], ws))); continue; }
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      if (!list || list.tagName !== (ordered ? "OL" : "UL")) { list = h(ordered ? "ol" : "ul"); box.append(list); }
      list.append(h("li", {}, inline(li[3], ws)));
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); list = null; box.append(h("hr")); continue; }
    if (!line.trim()) { flush(); list = null; continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.lastChild?.append(" ", ...inline(line.trim(), ws)); continue; }
    list = null; para.push(line.trim());
  }
  flush();
  return box;
}
/** 코드 블록: 머리줄(언어·파일 줄 링크·복사) + 색칠한 코드. 정보 줄 예: ```ts src/server.ts:9 */
function codeBlock(code, lang, info, ws) {
  const loc = /([\w./-]+\.[a-z]+):(\d+)/.exec(info);
  const copy = h("button", { class: "cbcopy", type: "button", onclick: async (e) => {
    try { await navigator.clipboard.writeText(code); e.target.textContent = "복사됨"; setTimeout(() => (e.target.textContent = "복사"), 1200); } catch { e.target.textContent = "복사 안 됨"; }
  } }, "복사");
  const pre = h("pre", { class: "cbody" });
  pre.innerHTML = highlight(code, lang);
  // 파일에서 떼어 온 코드가 아닌 짧은 JS/TS 예시는 [▶ 돌려 보기] (따로 떨어진 곳에서 4초까지)
  const out = h("pre", { class: "sout", hidden: true });
  const runnable = !loc && /^(ts|js|typescript|javascript)$/i.test(lang) && code.split("\n").length <= 30 && lessonCtx?.run?.id;
  const runBtn = runnable ? h("button", { class: "cbcopy", type: "button", title: "이 코드만 따로 돌려 봐요", onclick: (e) => busy(e.target, async () => {
    const r = await api("POST", `/api/runs/${lessonCtx.run.id}/snippet`, { code });
    out.hidden = false; out.className = `sout ${r.ok ? "" : "err"}`; out.textContent = r.output;
  }) }, "▶ 돌려 보기") : null;
  return h("div", { class: "cb" },
    h("div", { class: "cbh" }, h("span", { class: "cblang" }, ({ ts: "TypeScript", typescript: "TypeScript", js: "JavaScript", javascript: "JavaScript", json: "JSON", sql: "SQL", bash: "터미널", sh: "터미널", http: "HTTP" })[lang.toLowerCase()] || lang || "코드"),
      loc && ws ? fileLink(ws, loc[1], Number(loc[2])) : null, h("span", { class: "grow" }), runBtn, copy),
    pre, out);
}
/** 아주 작은 색칠기(TS/JS 위주): 주석·문자열·키워드·숫자·함수 이름 */
function highlight(code, lang) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!/^(ts|js|typescript|javascript|tsx|jsx|)$/i.test(lang)) return esc(code);
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(if|else|for|of|in|while|do|switch|case|break|continue|return|await|try|catch|finally|throw|import|export|from|default|as)\b|\b(const|let|var|function|async|new|class|extends|type|interface|instanceof|typeof|void|delete|static|readonly|public|private)\b|\b(null|undefined|true|false|this)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()|\b([A-Z][\w$]*)\b|([a-z_$][\w$]*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? "tc" : m[2] ? "ts" : m[3] ? "kc" : m[4] ? "tk" : m[5] ? "tb" : m[6] ? "tn" : m[7] ? "tf" : m[8] ? "ty" : "tv";
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
/** 도구 카드 글을 짧게: "파일을 읽었어요: src/app.ts" → "app.ts 읽음" */
function shortTool(label) {
  let m;
  if ((m = /^파일을 읽었어요: (.+)$/.exec(label))) return `${m[1].split("/").pop()} 읽음`;
  if ((m = /^VS Code에서 (.+?) (\d+)번째 줄을 열었어요/.exec(label))) return `${m[1].split("/").pop()} ${m[2]}줄 열어 줌`;
  return label.replace(/했어요$|었어요$|았어요$/, "");
}
function inline(text, ws) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]:]+):(\d+)\]\]|(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h("strong", {}, m[1]));
    else if (m[2]) out.push(h("code", { class: m[2].length <= 40 ? "ic ask" : "ic", title: m[2].length <= 40 ? "누르면 이게 뭔지 이어서 물어봐요" : undefined }, m[2]));
    else if (m[5]) out.push(h("em", {}, m[5]));
    else out.push(fileLink(ws, m[3], Number(m[4])));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function fileLink(ws, file, line) {
  const abs = `${ws.replace(/\\/g, "/").replace(/\/$/, "")}/${file}`;
  const href = `vscode://file/${abs.replace(/^\//, "")}:${line}`;
  return h("a", { class: "flink", href, title: "VS Code에서 이 줄 열기", onclick: (e) => {
    // 연결 확장이 있으면 그쪽으로 연다(브라우저의 "VS Code 열기" 확인 창이 안 뜸)
    if (!lessonCtx?.lesson?.bridge?.connected) return;
    e.preventDefault();
    api("POST", `/api/runs/${lessonCtx.run.id}/lesson/${lessonCtx.run.current}/act`, { do: "open", file, line }).catch(() => { location.href = href; });
  } }, `${file.split("/").pop()} ${line}줄`);
}

function flashSaved() {
  const b = $(".savebar");
  if (!b) return;
  b.classList.add("hit"); b.textContent = "저장을 봤어요";
  setTimeout(() => b.classList.remove("hit"), 1500);
}

function drawLesson() {
  if (lessonCtx?.lesson?.free) return drawFree();
  if (FLOAT) return drawFloat();
  const { run, lesson } = lessonCtx;
  const ws = lesson.workspace;
  const msgs = lesson.messages;
  const lastActIdx = msgs.map((m) => !!m.actions).lastIndexOf(true);
  const pending = lastActIdx >= 0 && !lesson.busy && (lesson.waiting === "action" || lesson.waiting === "save") ? msgs[lastActIdx].actions : [];
  const send = (body) => (e) => busy(e?.target, async () => {
    lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, body);
    if (lessonCtx.lesson.waiting === "done") {
      const next = run.stages.find((s) => s.inPlan && s.n > run.current);
      if (next) { await api("POST", `/api/runs/${run.id}/stage/${next.n}/start`, {}); return go(`#/run/${run.id}`); }
      if (lessonCtx.lesson.next) return waitNextStage(run, lessonCtx.lesson.next);
    }
    drawLesson();
  });

  const chat = h("div", { class: "lchat" });
  // 튜터 설명 속 코드 이름(`found.handler` 등)을 누르면 "이건 뭐예요?"를 이어서 묻는다 — 복사해서 다시 묻지 않게
  chat.addEventListener("click", (e) => {
    const c = e.target.closest?.(".lmsg.tutor .rich code.ask");
    if (!c || lessonCtx?.lesson?.busy) return;
    send({ do: "ask", text: `방금 설명에 나온 \`${c.textContent}\`는 뭐예요? 문법을 모르는 사람에게 이 코드에서의 뜻으로 쉽게, 3~6문장으로 알려 주세요. 필요하면 짧은 코드 블록으로 보여 주세요. 파일은 위에 붙어 있으니 도구 없이 바로 답해요.`, shown: `"${c.textContent}"는 뭐예요?`, mode: "explain" })(e);
  });
  let prevRole = "";
  let toolRow = null; // 이어지는 도구 카드는 한 줄로 묶는다(카드가 줄줄이 쌓이면 어수선 — 10/30)
  for (const m of msgs) {
    if (m.role === "tutor" && m.card?.type === "tool" && !m.text) {
      const item = m.card.url
        ? h("a", { class: `titem ${m.card.ok ? "" : "bad"}`, href: m.card.url, target: "_blank", rel: "noreferrer", title: "공식 문서 열기" }, m.card.icon, " ", shortTool(m.card.label))
        : h("span", { class: `titem ${m.card.ok ? "" : "bad"}`, title: m.card.detail || "" }, m.card.icon, " ", shortTool(m.card.label));
      if (toolRow) { toolRow.append(h("span", { class: "tsep" }, "·"), item); continue; }
      const cont = prevRole === "tutor"; prevRole = "tutor";
      toolRow = h("div", { class: "toolrow" }, item);
      chat.append(h("div", { class: `lmsg tutor ${cont ? "cont" : ""}` }, h("div", { class: `avatar ${cont ? "ghost" : ""}` }, cont ? "" : "R"), h("div", { class: "lcol" }, toolRow)));
      continue;
    }
    toolRow = null;
    if (m.role === "note") { chat.append(h("div", { class: "lnote" }, m.text)); prevRole = "note"; continue; }
    // 튜터가 이어서 말하면(도구 쓰는 중) 아이콘은 첫 줄에만
    const cont = m.role === "tutor" && prevRole === "tutor";
    prevRole = m.role;
    const row = h("div", { class: `lmsg ${m.role} ${cont ? "cont" : ""}` });
    if (m.role === "tutor") row.append(h("div", { class: `avatar ${cont ? "ghost" : ""}` }, cont ? "" : "R"));
    const col = h("div", { class: "lcol" });
    if (m.text) col.append(m.role === "me" ? h("div", { class: "bubble" }, m.text) : h("div", { class: "bubble" }, tyText(m, ws, run.id)));
    if (m.card) col.append(lessonCard(m.card, run, lesson, send, ws));
    row.append(col);
    chat.append(row);
  }
  if (lesson.busy) chat.append(h("div", { class: "lmsg tutor cont" }, h("div", { class: "avatar ghost" }), h("div", { class: "busyline" },
    h("div", { class: "bubble typing" }, h("span"), h("span"), h("span")),
    // 생각 요약 한 줄(GPT 앱의 "~하는 중"), 없으면 기다림 안내
    lesson.asking ? h("span", { class: "mut small" }, "위 질문에 골라 주세요.") : h("span", { class: `mut small ${lesson.thinking ? "think" : ""}` }, lesson.thinking ? `💭 ${lesson.thinking}` : "튜터가 확인하는 중이에요. 10~30초쯤 걸려요."),
    h("button", { class: "btn small stopbtn", title: "지금 답하는 걸 멈춰요", onclick: (e) => busy(e.target, async () => { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/stop`); drawLesson(); }) }, "■ 멈추기"))));

  const input = h("input", { placeholder: "튜터에게 물어보기 — 예: 라우터가 뭐예요?", "aria-label": "튜터에게 물어보기" });
  const askBtn = h("button", { class: "btn primary", type: "submit" }, "물어보기");
  const form = h("form", { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; send({ do: "ask", text: t })({ target: askBtn }); } }, input, askBtn);
  const quick = h("div", { class: "quick" }, pending.map((a) => h("button", { class: `btn ${a.do === "hint" ? "" : "primary"}`, onclick: (e) => {
    if (a.do === "hint" && a.label.includes("정답") && !confirm("정답 줄을 볼까요? 이걸 본 뒤의 통과는 '직접 고침'으로 기록하지 않아요.")) return;
    send({ do: a.do })(e);
  } }, a.label)));
  // 지금 할 일: 채팅이 길어져도 늘 아래에 보인다. 자유 질문을 했으면 [하던 거로 돌아가기]
  const nowbar = lesson.now && lesson.waiting !== "done" ? h("div", { class: "nowbar" }, h("span", { class: "nowtag" }, "지금 할 일"), h("span", { class: "nowtext" }, lesson.now),
    lesson.mode ? h("span", { class: "chip" }, { self: "직접", pair: "같이", auto: "튜터가 고침" }[lesson.mode]) : null,
    lesson.resumable ? h("button", { class: "btn small primary", onclick: (e) => send({ do: "resume" })(e) }, "하던 거로 돌아가기") : null) : null;
  const savebar = lesson.waiting === "save" ? h("div", { class: "savebar" }, h("span", { class: "pulse" }), "VS Code에서 고친 뒤 ", h("kbd", {}, "Ctrl"), "+", h("kbd", {}, "S"), " (저장)를 누르면 제가 바로 확인해요") : null;

  const dev = lesson.dev || run.dev;
  const side = h("aside", { class: "lside" },
    h("div", { class: "lstage" }, h("span", { class: "chip acc" }, `${lesson.stage}단계`), h("h2", {}, lesson.title)),
    h("div", { class: "lprog" }, Array.from({ length: lesson.beats }, (_, i) => h("span", { class: i < lesson.beat ? "on" : i === lesson.beat ? "cur" : "" }))),
    h("div", { class: "lteach" }, h("div", { class: "mut small" }, "이번에 배울 것"), h("ul", {}, lesson.teach.map((t) => h("li", {}, t)))),
    h("div", { class: "lws" },
      h("div", { class: "mut small" }, "작업 폴더"),
      h("div", { class: "path" }, ws),
      h("div", { class: "row" },
        h("button", { class: "btn small", title: "파일별로 물어본 것·배운 것과 파일 사이 연결", onclick: () => go(`#/run/${run.id}/notes`) }, "📒 노트"),
        EMBED ? h("button", { class: "btn small", title: "이어 하기 · 새 코스 정하기", onclick: () => go("#/home") }, "코스 목록") : h("button", { class: "btn small primary", onclick: () => go(`#/run/${run.id}/vscode`) }, "VS Code에서 하기"),
        EMBED ? null : dev?.running
          ? h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/dev/stop`); lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`); drawLesson(); }) }, "서버 끄기")
          : h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/dev/start`); lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`); drawLesson(); }) }, "서버 켜기")),
      h("div", { class: "row small" }, EMBED ? null : dev?.running ? h("span", { class: "chip ok" }, "서버 켜짐 :4101") : h("span", { class: "chip" }, "서버 꺼짐"),
        lesson.bridge?.connected ? (EMBED ? null : h("span", { class: "chip ok" }, "VS Code 연결됨")) : h("span", { class: "chip", title: "VS Code에서 하기를 누르면 연결돼요" }, "VS Code 연결 안 됨")),
      lesson.bridge?.connected ? h("div", { class: "seeing small" }, lesson.bridge.file
        ? [h("span", { class: "mut" }, "튜터가 보는 곳 "), h("code", {}, `${lesson.bridge.file}:${lesson.bridge.line}`),
           lesson.bridge.selection ? h("span", { class: "mut" }, ` · ${lesson.bridge.selection.from}~${lesson.bridge.selection.to}줄 선택`) : null,
           lesson.bridge.dirty ? h("span", { class: "chip warn" }, "저장 안 함") : null,
           lesson.bridge.errors ? h("span", { class: "chip bad" }, `빨간 줄 ${lesson.bridge.errors}`) : null]
        : h("span", { class: "mut" }, "작업 폴더 밖 파일을 보고 있어요")) : null),
    lesson.pocket?.length ? h("div", { class: "lpocket" }, h("div", { class: "mut small" }, `물음표 주머니 (${lesson.pocket.length})`),
      lesson.pocket.map((p) => h("div", { class: "pitem" },
        h("div", {}, p.terms.length ? p.terms.join(", ") : h("code", {}, p.code)),
        h("div", { class: "row" }, p.later.length ? p.later.map((n) => h("span", { class: "chip warn" }, `${n}단계에서`)) : h("span", { class: "chip ok" }, "답함"), p.ai ? h("span", { class: "chip" }, "AI") : null)))) : null,
    h("div", { class: "lmore" },
      h("a", { href: `#/run/${run.id}/cards` }, "단계 카드 화면으로"),
      h("a", { href: `#/run/${run.id}/summary` }, "결과와 기록 후보")));

  const y = window.scrollY, atBottom = window.innerHeight + y >= document.body.scrollHeight - 80;
  const stuckBtn = lesson.busy || lesson.stuck ? null : h("button", { class: "btn small", type: "button", onclick: () => { stuckUi.open = !stuckUi.open; drawLesson(); } }, "막혔어요");
  view.replaceChildren(h("div", { class: "lesson" }, side, h("main", { class: "lmain" }, chat, h("div", { class: "lfoot" }, stuckBar(lesson, send), stuckPicker(run, lesson, send), nowbar, savebar, quick, h("div", { class: "row" }, form, stuckBtn)))));
  if (atBottom || !drawLesson.drawn) window.scrollTo({ top: document.body.scrollHeight });
  drawLesson.drawn = true;
  tyAfterDraw();
}

/* ---------- 생성 코스: 다음 단계가 뒤에서 만들어지는 중이면 기다렸다가 시작 ---------- */
async function waitNextStage(run, next) {
  const box = h("div", { class: "empty", style: "margin:32px auto;text-align:left" }, h("div", { class: "chip acc" }, `${next.n}단계`), h("h1", { style: "margin-top:8px" }, next.title),
    h("p", { class: "gen-msg" }, next.failed || "다음 단계를 만드는 중이에요. 준비되면 바로 시작해요."));
  view.replaceChildren(box);
  if (next.failed) return;
  for (let i = 0; i < 90; i++) {
    const r = await fetch(`/api/runs/${run.id}/stage/${next.n}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (r.ok) return go(`#/run/${run.id}`);
    const j = await r.json().catch(() => ({}));
    box.querySelector(".gen-msg").textContent = j.error || "다음 단계를 만드는 중이에요.";
    if (r.status !== 409 || /넘지 못했어요|못했어요/.test(j.error || "")) return;
    await new Promise((res) => setTimeout(res, 4000));
  }
}

/* ---------- 홈: 만들고 싶은 걸 적으면 코스를 만든다(AI) ---------- */
function genForm() {
  const ta = h("textarea", { rows: 2, placeholder: "예: 할 일을 추가하고 지우는 서버를 만들고 싶어요", "aria-label": "만들고 싶은 것" });
  const msg = h("p", { class: "small mut", style: "margin:6px 0 0" }, "AI가 목차를 짜고 첫 단계를 만들어 자동으로 검사해요. 1~3분 걸리고 AI 사용량이 들어요.");
  const btn = h("button", { class: "btn primary", type: "submit" }, "코스 만들기");
  const form = h("form", { class: "genform", onsubmit: (e) => { e.preventDefault(); const goal = ta.value.trim(); if (!goal) return; busy(btn, async () => {
    const { id } = await api("POST", "/api/generate", { goal });
    for (let i = 0; i < 120; i++) {
      const st = await api("GET", `/api/generate/${id}`);
      msg.textContent = st.message || "만드는 중이에요";
      if (st.phase === "failed") return;
      if (st.ready?.includes(1)) { msg.textContent = "1단계 준비 완료! 시작할게요."; return afterStart(await api("POST", "/api/quickstart", { courseId: id })); }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }); } }, h("div", { class: "mut small", style: "margin-bottom:6px" }, "만들고 싶은 걸 적어 주세요"), ta, h("div", { class: "row", style: "margin-top:8px" }, btn), msg);
  return form;
}

/* ---------- 튜터 창(?float=1, 11/2 시안): 지금 걸음 카드 하나 + 따로 여는 질문 칸 ---------- */
const ICON = {
  check: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  wide: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M7 13H3V9M13 3L9 7M3 13l4-4"/></svg>',
  narrow: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M13 3L9 7M9 3v4h4M3 13l4-4M7 13V9H3"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6zM8 8.5V14"/></svg>',
  home: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
};
const icon = (name) => { const s = h("span", { class: "ico" }); s.innerHTML = ICON[name]; return s; };
const MODE_SUB = { diagnose: "정답 대신 다른 원인 하나와 확인 방법", mode_self: "저장하면 바로 확인해요", mode_pair: "빈칸으로 나눠 하나씩 같이", mode_auto: "바뀐 줄을 보여 드려요 · 기록에 그대로 남아요", hint: "한 칸씩만 더 알려 드려요", check: "지금 코드로 바로 확인" };

function drawFloat() {
  const { run, lesson } = lessonCtx;
  const ws = lesson.workspace;
  const steps = lesson.steps || [];
  const cur = Math.max(0, lesson.beat);
  const step = steps[cur];
  const send = (body) => (e) => busy(e?.target, async () => {
    lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, body);
    if (lessonCtx.lesson.waiting === "done") {
      const next = run.stages.find((s) => s.inPlan && s.n > run.current);
      if (next) { await api("POST", `/api/runs/${run.id}/stage/${next.n}/start`, {}); return go(`#/run/${run.id}`); }
      if (lessonCtx.lesson.next) return waitNextStage(run, lessonCtx.lesson.next);
    }
    drawLesson();
  });
  const msgs = lesson.messages;
  // 걸음 표시가 없는 옛 대화(11/2 전)는 끝의 몇 개만
  const here = msgs.some((m) => m.beat !== undefined) ? msgs.filter((m) => m.beat === lesson.beat) : msgs.slice(-4);
  const card = here.filter((m) => !m.t);
  // 질문 칸은 "하던 거로 돌아가기" 뒤의 질문만(11/3: 돌아간 뒤에도 옛 질문이 남아 버튼을 가리던 문제)
  const lastMain = here.map((m) => !m.t).lastIndexOf(true);
  const thread = here.filter((m, i) => m.t && i > lastMain);
  const lastActIdx = msgs.map((m) => !!m.actions).lastIndexOf(true);
  const pending = lastActIdx >= 0 && !lesson.busy && (lesson.waiting === "action" || lesson.waiting === "save") ? msgs[lastActIdx].actions : [];
  const setSize = (size) => { floatUi.size = size; floatPost({ size }); drawLesson(); };

  // 맨 위: 단계 이름 + 크기·고정·닫기
  const head = h("header", { class: "fh" },
    h("div", { class: "fh-t" },
      h("div", { class: "fh-co", title: run.course?.title ?? "" }, run.course?.title ?? ""),
      h("div", { class: "fh-row" }, h("span", { class: "fh-st" }, `${lesson.stage}단계`), h("span", { class: "fh-ti" }, String(lesson.title ?? "").replace(/^\d+\s*단계\s*[:·.\-]?\s*/, "")))),
    h("button", { class: "fib", title: "처음 화면(새 코스 · 다른 진행)", "aria-label": "처음 화면", onclick: () => go("#/home") }, icon("home")),
    h("button", { class: "fib", title: floatUi.size === "wide" ? "작게" : "넓게 펼치기", "aria-label": floatUi.size === "wide" ? "작게" : "넓게 펼치기", onclick: () => setSize(floatUi.size === "wide" ? "normal" : "wide") }, icon(floatUi.size === "wide" ? "narrow" : "wide")),
    h("button", { class: `fib ${floatUi.pinned ? "on" : ""}`, title: floatUi.pinned ? "고정됨: 코드를 쳐도 안 접혀요" : "고정: 코드를 칠 때 접지 않기", "aria-label": "고정", onclick: async () => { const out = await floatPost({ pinned: !floatUi.pinned }); floatUi.pinned = !!out?.pinned; drawLesson(); } }, icon("pin")),
    h("button", { class: "fib", title: "튜터 창 닫기", "aria-label": "닫기", onclick: () => floatPost({ open: false }) }, icon("close")));

  // 걸음 줄
  const rail = h("div", { class: "frail", "aria-label": "이번 단계 걸음" }, steps.map((st, i) => h("i", { class: i < cur ? "d" : i === cur ? "n" : "", title: st.label })));
  const railText = step ? h("div", { class: "frail-t" }, h("b", {}, `${cur + 1} / ${steps.length}`), ` · ${step.label}`) : null;

  // 지난 걸음: 한 줄씩, 3개 넘으면 접기
  const pastAll = steps.slice(0, cur);
  const pastShown = floatUi.pastOpen ? pastAll : pastAll.slice(-2);
  const past = pastAll.length ? h("div", { class: "fpast" },
    pastAll.length > pastShown.length ? h("button", { class: "fmore", onclick: () => { floatUi.pastOpen = true; drawLesson(); } }, `앞 걸음 ${pastAll.length - pastShown.length}개 더 보기`) : null,
    pastShown.map((st) => h("p", {}, icon("check"), h("span", {}, st.now)))) : null;

  // 오랜만에 열면: 지난번 요약(사건에서 코드가 고른 사실)
  const recapCard = lesson.recap ? h("div", { class: "frecap" }, h("div", { class: "fey" }, "지난번에는"), h("p", { class: "frecap-t" }, lesson.recap.text),
    h("button", { class: "fbtn pri", onclick: (e) => send({ do: "recap_ok" })(e) }, h("b", {}, "이어서 하기"))) : null;
  // 지금 걸음 카드
  const body = h("div", { class: "fcard" }, step ? h("div", { class: "fey" }, step.label) : null);
  for (const m of card) {
    if (m.role === "note") { body.append(h("p", { class: "fnote" }, m.text)); continue; }
    if (m.role === "me") { if (m.text) body.append(h("p", { class: "fme" }, "↳ ", m.text)); if (m.card) body.append(lessonCard(m.card, run, lesson, send, ws)); continue; }
    if (m.card?.type === "tool" && !m.text) { body.append(h("p", { class: "ftool" }, m.card.icon, " ", shortTool(m.card.label))); continue; }
    if (m.text) body.append(tyText(m, ws, run.id));
    if (m.card) body.append(lessonCard(m.card, run, lesson, send, ws));
  }
  if (lesson.waiting === "save" && lesson.mode && lesson.mode !== "auto") body.append(h("p", { class: "fsave" }, h("span", { class: "pulse" }), "고친 뒤 ", h("kbd", {}, "Ctrl"), "+", h("kbd", {}, "S"), "를 누르면 바로 확인해요"));
  if (lesson.busy && !thread.length) body.append(thinkLine(run, lesson));
  // 설명 걸음이면 "알아요, 넘길게요"(강제하지 않음)
  const known = step && (step.kind === "say" || step.kind === "map") && lesson.waiting === "action" && pending.some((a) => a.do === "next") && cur < steps.length - 1
    ? h("button", { class: "fbtn ghost", onclick: (e) => send({ do: "known" })(e) }, h("b", {}, "알아요, 넘길게요")) : null;
  const acts = pending.length && !thread.length ? h("div", { class: "facts" }, ...pending.map((a, i) => {
    if (a.do === "hint" && a.label.includes("정답")) return h("button", { class: "fbtn", onclick: (e) => { if (confirm("정답 줄을 볼까요? 이걸 본 뒤의 통과는 '직접 고침'으로 기록하지 않아요.")) send({ do: a.do })(e); } }, h("b", {}, a.label));
    return h("button", { class: `fbtn ${i === 0 ? "pri" : ""}`, onclick: (e) => send({ do: a.do })(e) }, h("b", {}, a.label), MODE_SUB[a.do] ? h("span", {}, MODE_SUB[a.do]) : null);
  }), known) : null;
  if (acts) body.append(acts);

  // 따로 물어본 대화: 걸음 위로 올라오는 칸
  let sheet = null;
  if (thread.length && floatUi.sheetHidden !== thread.at(-1).id) {
    const list = h("div", { class: "fmsgs" });
    for (const m of thread) {
      if (m.role === "note") { list.append(h("p", { class: "fnote" }, m.text)); continue; }
      if (m.card?.type === "tool" && !m.text) { list.append(h("p", { class: "ftool" }, m.card.icon, " ", shortTool(m.card.label))); continue; }
      if (m.role === "me") { list.append(h("div", { class: "fq" }, m.card?.type === "code" ? h("span", { class: "fref" }, `${m.card.file} ${m.card.from}${m.card.to > m.card.from ? `~${m.card.to}` : ""}줄`) : null, m.text)); continue; }
      list.append(h("div", { class: "fa" }, m.text ? tyText(m, ws, run.id) : null, m.card ? lessonCard(m.card, run, lesson, send, ws) : null));
    }
    if (lesson.busy) list.append(thinkLine(run, lesson));
    const more = (text, shown) => send({ do: "ask", text, shown, mode: "explain" });
    sheet = h("section", { class: "fsheet", "aria-label": "질문" },
      h("div", { class: "fsh" }, h("span", {}, "질문 · ", h("b", {}, step?.label ?? ""), lesson.session?.detours?.length > 1 ? ` · ${lesson.session.detours.length}번째 질문` : "", "에서"), h("button", { class: "fib", "aria-label": "닫고 돌아가기", onclick: (e) => lesson.resumable ? send({ do: "resume" })(e) : (floatUi.sheetHidden = thread.at(-1).id, drawLesson()) }, icon("close"))),
      stuckBar(lesson, send),
      list,
      lesson.busy || lesson.stuck ? null : h("div", { class: "fchips" },
        h("button", { class: "fchip", onclick: more("방금 설명을 다른 예시 하나로 다시 보여 주세요. 짧게.", "예시 하나 더") }, "예시 하나 더"),
        h("button", { class: "fchip", onclick: more("방금 설명을 다른 말로, 더 쉽게 3문장으로 다시 설명해 주세요.", "다르게 설명해 줘") }, "다르게 설명해 줘"),
        floatUi.size === "wide" ? null : h("button", { class: "fchip", onclick: () => setSize("wide") }, "넓게 보기")),
      lesson.busy || lesson.stuck ? null : h("button", { class: "fbtn pri back", onclick: (e) => lesson.resumable ? send({ do: "resume" })(e) : (floatUi.sheetHidden = thread.at(-1).id, drawLesson()) }, h("b", {}, `알겠어요, ${ro(step?.label ?? "하던 것")} 돌아가기`)));
  }

  // 아래: 빠른 질문 + 입력
  const input = h("input", { placeholder: "막히면 물어보세요", "aria-label": "튜터에게 물어보기" });
  const form = h("form", { class: "fask", onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; floatUi.sheetHidden = 0; send({ do: "ask", text: t })({ target: form }); } },
    input, h("button", { class: "fsend", type: "submit", "aria-label": "보내기" }, icon("send")));
  const quick = h("div", { class: "fquick" },
    h("button", { class: "fchip", onclick: (e) => { floatUi.sheetHidden = 0; send({ do: "ask", text: "지금 걸음에서 보고 있는 코드가 실제로 어떻게 동작하는지 흐름으로 보여 주세요.", mode: "tour" })(e); } }, "흐름 보기"),
    h("button", { class: "fchip", onclick: (e) => { floatUi.sheetHidden = 0; send({ do: "ask", text: "지금 걸음을 하려면 무엇부터 보면 되는지, 답은 말하지 말고 방향만 한 줄로 알려 주세요.", shown: "어디부터 봐요?" })(e); } }, "어디부터 봐요?"),
    lesson.stuck ? null : h("button", { class: "fchip warm", onclick: () => { stuckUi.open = !stuckUi.open; drawLesson(); } }, "막혔어요"));
  const foot = h("footer", { class: "ff" }, stuckPicker(run, lesson, send, "in-float"), quick, form);

  // 띠(타이핑하는 동안): 걸음 점 + 지금 할 일
  const pill = h("button", { class: "fpill", onclick: () => floatPost({ wake: true }) },
    h("span", { class: "frail mini" }, steps.map((st, i) => h("i", { class: i < cur ? "d" : i === cur ? "n" : "" }))),
    h("span", { class: "fpill-t" }, h("b", {}, lesson.now || step?.now || ""), h("span", {}, lesson.waiting === "save" ? "저장하면 바로 확인해요" : "누르면 펼쳐요")));

  view.replaceChildren(h("div", { class: `fw ${floatUi.size}` }, pill, head, h("div", { class: "frailbox" }, rail, railText),
    h("div", { class: "fscroll" }, recapCard, past, body), sheet, foot));
  const sc = view.querySelector(".fscroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  const ms = view.querySelector(".fmsgs"); if (ms) ms.scrollTop = ms.scrollHeight;
  tyAfterDraw();
}
/** "예측" → "예측으로", "고치기" → "고치기로" (받침 있으면 으로) */
function ro(word) { const c = word.charCodeAt(word.length - 1); const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0; return word + (jong && jong !== 8 ? "으로" : "로"); }
function thinkLine(run, lesson) {
  return h("div", { class: "fthink" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")),
    h("span", { class: "grow" }, lesson.asking ? "위 질문에 골라 주세요" : lesson.thinking ? lesson.thinking : "튜터가 확인하는 중이에요"),
    h("button", { class: "fchip", onclick: (e) => busy(e.target, async () => { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/stop`); drawLesson(); }) }, "멈추기"));
}

/* ---------- 흐름 투어 카드: 걸음마다 VS Code에서 그 덩어리에 불이 켜진다 ---------- */
const tours = {}; // 카드 id → { i, auto, timer, done, sent }
function tourGo(run, card, i) {
  const t = tours[card.id];
  t.i = Math.max(0, Math.min(card.steps.length - 1, i)); t.sent = t.i;
  api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "tour", text: card.id, choice: t.i }).catch(() => {});
  scheduleTour(run, card);
  drawLesson();
}
function stepSeconds(st) { return Math.min(20, Math.max(6, 5 + (st.text.length + st.code.length / 3) * 0.05)); }
function scheduleTour(run, card) {
  const t = tours[card.id];
  clearTimeout(t.timer);
  if (!t.auto || t.done) return;
  const st = card.steps[t.i];
  t.due = Date.now() + stepSeconds(st) * 1000;
  t.timer = setTimeout(() => {
    if (t.i >= card.steps.length - 1) { t.auto = false; drawLesson(); return; }
    tourGo(run, card, t.i + 1);
  }, stepSeconds(st) * 1000);
}
function tourCard(card, run, lesson, send, ws) {
  const latest = [...(lesson.messages || [])].reverse().find((m) => m.card?.type === "tour")?.card?.id === card.id;
  const t = (tours[card.id] ??= { i: 0, auto: false, done: !latest, sent: -1 });
  if (!t.done && t.sent !== t.i) { t.sent = t.i; api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "tour", text: card.id, choice: t.i }).catch(() => {}); }
  const n = card.steps.length, st = card.steps[t.i];
  const head = h("div", { class: "tourh" }, h("span", { class: "tico" }, "🧭"), h("b", { class: "grow" }, card.title),
    t.done ? h("button", { class: "btn small", onclick: () => { t.done = false; t.sent = -1; tourGo(run, card, 0); } }, "다시 보기")
      : h("button", { class: "btn small", title: "투어 끝내기", onclick: () => { t.done = true; t.auto = false; clearTimeout(t.timer); api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "tourEnd" }).catch(() => {}); drawLesson(); } }, "끝내기"));
  if (t.done) return h("div", { class: "lcard tour done" }, head,
    h("ol", { class: "tourlist" }, card.steps.map((x) => h("li", {}, `${x.title} `, h("span", { class: "mut" }, `${x.file.split("/").pop()} ${x.from}~${x.to}줄`)))));
  const dots = h("div", { class: "tdots" }, card.steps.map((x, k) => h("button", { class: `tdot ${k < t.i ? "past" : k === t.i ? "cur" : ""}`, title: `${k + 1}. ${x.title}`, onclick: () => tourGo(run, card, k) }, String(k + 1))));
  const last = t.i === n - 1;
  const nextBtn = last
    ? h("button", { class: "btn primary small", onclick: () => { t.done = true; t.auto = false; clearTimeout(t.timer); api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "tourEnd" }).catch(() => {}); drawLesson(); } }, "다 봤어요 ✓")
    : h("button", { class: "btn primary small", onclick: () => tourGo(run, card, t.i + 1) }, "확인했어요, 다음 ▶");
  const autoBtn = h("button", { class: "btn small", onclick: () => { t.auto = !t.auto; scheduleTour(run, card); drawLesson(); } }, t.auto ? "⏸ 멈추기" : "⏵ 자동 넘기기");
  const dur = stepSeconds(st), gone = t.due ? Math.max(0, dur - (t.due - Date.now()) / 1000) : 0;
  const bar = t.auto && !last ? h("div", { class: "tbar", title: "자동으로 넘어가요" }, h("span", { style: `animation-duration:${dur}s;animation-delay:-${gone.toFixed(2)}s` })) : null;
  return h("div", { class: "lcard tour" }, head, dots,
    h("div", { class: "tstep" }, h("span", { class: "tnum" }, `${t.i + 1}/${n}`), h("b", {}, st.title), h("span", { class: "mut small" }, " · ", fileLink(ws, st.file, st.from), `~${st.to}줄`)),
    codeBlock(st.code, "ts", `${st.file}:${st.from}`, ws),
    rich(st.text, ws),
    h("div", { class: "row tctl" },
      h("button", { class: "btn small", disabled: t.i === 0, onclick: () => tourGo(run, card, t.i - 1) }, "◀ 이전"), nextBtn, h("span", { class: "grow" }), autoBtn,
      h("button", { class: "btn small", title: "이 걸음을 더 자세히", onclick: (e) => send({ do: "ask", mode: "explain", shown: `${st.title} 더 자세히 알려 주세요`, text: `흐름 투어 ${t.i + 1}걸음(${st.file} ${st.from}~${st.to}줄, "${st.title}")을 문법을 모르는 사람에게 더 자세히 설명해 주세요. 줄마다 무슨 뜻인지 짧게.\n\n\`\`\`ts\n${st.code}\n\`\`\`` })(e) }, "더 자세히")),
    bar);
}

function lessonCard(card, run, lesson, send, ws) {
  if (card.type === "tour") return tourCard(card, run, lesson, send, ws);
  if (card.type === "table") return h("div", { class: "lcard table" },
    h("div", { class: "mut small" }, "🗄 DB 들여다보기 · ", h("code", { class: "ic" }, card.sql)),
    card.columns.length ? h("div", { class: "tscroll" }, h("table", {}, h("thead", {}, h("tr", {}, card.columns.map((c) => h("th", {}, c)))),
      h("tbody", {}, card.rows.map((r) => h("tr", {}, r.map((v) => h("td", { title: String(v ?? "") }, v === null ? "NULL" : String(v).length > 48 ? String(v).slice(0, 48) + "…" : String(v)))))))) : null,
    card.note ? h("div", { class: "small mut" }, card.note) : null);
  if (card.type === "choice") {
    const done = card.picked !== undefined;
    return h("div", { class: "lcard" }, h("div", { class: "opts" }, card.options.map((o, i) =>
      h("button", { class: `opt ${done ? (i === card.answer ? "right" : i === card.picked ? "wrong" : "") : ""}`, disabled: done, onclick: (e) => send({ do: "choice", choice: i })(e) }, o))));
  }
  if (card.type === "ask") {
    // 튜터가 고르게 물음: 지금 기다리는 질문이면 버튼, 지난 질문이면 고른 답만
    const open = lesson.asking === card.id && card.answer === undefined;
    const answer = (body) => (e) => busy(e?.target, async () => { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/answer`, { id: card.id, ...body }); drawLesson(); });
    const own = h("input", { placeholder: "직접 적기", "aria-label": "직접 적어서 답하기" });
    return h("div", { class: "lcard askq" }, h("div", { class: "aq" }, "❓ ", card.question),
      h("div", { class: "opts" }, card.options.map((o, i) => h("button", { class: `opt ${card.answer !== undefined && card.picked === i ? "right" : ""}`, disabled: !open, onclick: answer({ choice: i }) }, o))),
      open ? h("form", { class: "aqown", onsubmit: (e) => { e.preventDefault(); const t = own.value.trim(); if (t) answer({ text: t })(e); } }, own, h("button", { class: "btn small", type: "submit" }, "보내기"))
        : card.answer !== undefined && card.picked === undefined && card.answer ? h("div", { class: "small mut" }, `직접 적음: ${card.answer}`) : !card.answer && !open ? h("div", { class: "small mut" }, "답하지 않고 넘어갔어요") : null);
  }
  if (card.type === "snippet") return h("div", { class: `lcard snip ${card.ok ? "" : "bad"}` },
    h("div", { class: "mut small" }, "▶ 코드 조각을 돌려 봤어요", h("span", { class: "grow" }), `${card.ms}ms`),
    codeBlock(card.code, "ts", "", ws),
    h("pre", { class: `sout ${card.ok ? "" : "err"}` }, card.output));
  if (card.type === "reply") {
    const head = card.timedOut ? "답장 없음 (3초 기다림)" : card.error ? `연결 실패: ${card.error}` : `${card.status}`;
    const cls = card.timedOut || card.error || card.status >= 500 ? "bad" : card.status >= 400 ? "warn" : "ok";
    return h("div", { class: "lcard reply" },
      h("div", { class: "rline" }, h("span", { class: "mut small" }, "보낸 편지"), h("code", {}, card.request)),
      h("div", { class: "rline" }, h("span", { class: "mut small" }, "답장"), h("span", { class: `chip ${cls}` }, head)),
      Object.keys(card.headers || {}).length ? h("pre", { class: "rbody mut" }, Object.entries(card.headers).map(([k, v]) => `${k}: ${v}`).join("\n")) : null,
      card.body ? h("pre", { class: "rbody" }, card.body) : null);
  }
  if (card.type === "tool") return h("details", { class: `lcard tool ${card.ok ? "" : "bad"}` },
    h("summary", {}, h("span", { class: "ti" }, card.icon), h("span", {}, card.label)),
    card.detail ? h("pre", { class: "rbody" }, card.detail) : null);
  if (card.type === "diff") return h("div", { class: `lcard diff ${card.undone ? "undone" : ""}` },
    h("div", { class: "row" }, h("span", { class: "chip warn" }, "튜터가 고침"), h("code", {}, card.file), h("span", { class: "grow" }),
      card.undone ? h("span", { class: "chip" }, "되돌림") : h("button", { class: "btn small", onclick: (e) => send({ do: "undo", text: card.id })(e) }, "되돌리기")),
    card.why ? h("div", { class: "small" }, card.why) : null,
    h("pre", { class: "rbody dl" }, card.diff.split("\n").map((l) => h("div", { class: l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : "" }, l))));
  if (card.type === "map") return h("div", { class: "lcard map" },
    h("div", { class: "mut small" }, `${card.file} 지도 · 누르면 VS Code에서 그 덩어리가 열려요`),
    h("div", { class: "chunks" }, card.chunks.map((c, i) => h("button", { class: `chunk ${c.focus ? "on" : ""} ${/-/.test(c.label) ? "sub" : ""}`, onclick: (e) => {
      // 누른 덩어리로 불을 옮긴다(카드와 코드 둘 다) — 11/2
      const box = e.currentTarget.parentElement;
      for (const b of box.children) b.classList.toggle("on", b === e.currentTarget);
      if (lessonCtx?.lesson?.bridge?.connected) api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "peek", index: i, file: card.file, line: c.line }).catch(() => {});
      else location.href = `vscode://file/${ws.replace(/\\/g, "/")}/${card.file}:${c.line}`;
    } }, h("span", { class: "cl" }, c.label, c.focus ? h("span", { class: "today" }, "오늘 고칠 곳") : null), h("span", { class: "cd" }, c.desc || ""), h("span", { class: "cn mono" }, `${c.line}줄`)))));
  if (card.type === "code") return h("div", { class: "lcard code" }, h("div", { class: "mut small" }, fileLink(ws, card.file, card.from), card.to > card.from ? `~${card.to}줄` : ""), h("pre", { class: "rbody" }, card.code));
  if (card.type === "check") return h("div", { class: "lcard" }, h("div", { class: "mut small" }, "확인 결과"), resultsList(card.result, { group: true }));
  if (card.type === "hint") return h("div", { class: "lcard hint" }, h("div", { class: "mut small" }, `힌트 ${card.level}단계 · ${card.source.startsWith("ai") ? "AI 튜터" : card.source === "solution" ? "준비된 정답 줄" : card.source === "auto" ? "튜터가 고친 줄" : "준비된 힌트"}`), card.level === 3 ? h("pre", { class: "sol" }, card.text) : rich(card.text, ws));
  if (card.type === "explain") {
    if (card.done) return h("div", { class: "lcard" }, h("div", { class: "mut small" }, "내 설명"), card.done);
    const ta = h("textarea", { class: "explain", placeholder: "내 말로 짧게" });
    return h("div", { class: "lcard" }, ta, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn primary", onclick: (e) => { if (!ta.value.trim()) return toast("한 문장이라도 적어 주세요."); send({ do: "explain", text: ta.value })(e); } }, "적어 두기"),
      h("button", { class: "btn", onclick: (e) => send({ do: "confused" })(e) }, "아직 헷갈려요"), h("button", { class: "btn ghost", onclick: (e) => send({ do: "explain_skip" })(e) }, "건너뛸게요")));
  }
  return null;
}

/* =================== 결과 =================== */
async function renderSummary(id) {
  const s = await api("GET", `/api/runs/${id}/summary`);
  const stRows = s.stages.map((x) => h("tr", {},
    h("td", {}, x.transfer ? "전이" : `${x.n}`), h("td", {}, x.title),
    h("td", {}, x.done ? h("span", { class: `chip ${x.independent ? "ok" : "warn"}` }, x.skipped ? "빠르게 넘어감" : x.independent ? "직접 통과" : "도움 받아 통과") : h("span", { class: "mut small" }, x.before ? "완성된 채로 받음" : x.inPlan ? "아직" : "계획에 없음")),
    h("td", {}, x.predictTotal ? `${x.predictRight}/${x.predictTotal}` : "—"),
    h("td", {}, x.hints ? `${x.hints}번 (최대 ${x.maxHint})` : "0"),
    h("td", {}, x.failedRuns), h("td", {}, x.explained ? "✓" : "")));
  const kRows = s.knowledge.map((k) => h("tr", {},
    h("td", {}, h("strong", {}, k.name)),
    h("td", {}, k.independent ? h("span", { class: "chip ok" }, "직접 적용함") : h("span", { class: "chip" }, "만남")),
    h("td", { class: "small" }, `맞힘 ${k.correct} · 틀림 ${k.wrong} · 힌트 ${k.hint} · 메모 ${k.note}`),
    h("td", { class: "small mut" }, h("details", {}, h("summary", {}, `${k.lines.length}개 근거`), h("div", {}, k.lines.map((l) => h("div", {}, l)))))));
  view.replaceChildren(h("div", { class: "course", style: "grid-template-columns:1fr;max-width:1000px" }, h("div", { class: "main sum" },
    h("div", { class: "row" }, h("h1", { class: "grow" }, `${s.course.title} · 결과`), h("button", { class: "btn", onclick: () => go(`#/run/${id}`) }, "코스로 돌아가기")),
    h("section", { class: "card" }, h("h2", {}, "단계별: 프로젝트 상태와 내가 직접 한 것"),
      h("div", { style: "overflow-x:auto" }, h("table", {}, h("thead", {}, h("tr", {}, ["", "단계", "통과", "예측", "힌트", "실패한 검사", "설명"].map((t) => h("th", {}, t)))), h("tbody", {}, stRows)))),
    h("section", { class: "card" }, h("h2", {}, "지식별 기록 후보"),
      h("div", { class: "mut small", style: "margin-bottom:8px" }, "'직접 적용함'은 정답 줄을 보지 않고 고쳐서 검사를 통과한 지식이에요. 최종 앱에서는 이 기록이 지식 저장소로 가고, 코드 없이 묻는 복습 문제가 나와요."),
      h("div", { style: "overflow-x:auto" }, h("table", {}, h("tbody", {}, kRows))),
      h("div", { class: "path", style: "margin-top:10px" }, `${s.file} (${s.total}개)`)))));
}

route();

/* ---------- AI 채팅 실험방(11/3 사용자 "말투부터 하는 짓까지 맘에 안 들어서 직접 실험") ----------
 * 왼쪽: 실험용 진행 기록으로 튜터와 대화. 오른쪽: 추가 지시(모든 튜터 차례 끝에 붙음) · 프롬프트 처리 방식 · 마지막으로 모델에 간 것 */
let labEvents = null;
const labUi = { tab: "edit", key: null };
async function renderLab() {
  const info = await api("GET", "/api/lab");
  const box = h("div", { class: "lab" });
  view.replaceChildren(box);
  const newBtn = h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", "/api/lab/new", { courseId: "hello-api" }); renderLab(); }) }, info.runId ? "새 대화로" : "실험 시작");
  const head = h("div", { class: "labhead" }, h("h2", {}, "AI 채팅 실험방"), h("span", { class: "mut small grow" }, "튜터와 직접 대화해 보고, 오른쪽에서 프롬프트를 고쳐 가며 비교해요. 대화는 맛보기 코스(인사 서버) 위에서 해요."), newBtn);
  const chatCol = h("section", { class: "labchatcol" });
  const side = h("aside", { class: "labside" });
  box.append(head, h("div", { class: "labgrid" }, chatCol, side));
  drawLabSide(side, info);
  if (!info.runId) { chatCol.append(h("div", { class: "empty" }, h("p", {}, "[실험 시작]을 누르면 실험용 진행 기록을 만들어요."))); return; }
  const run = await api("GET", `/api/runs/${info.runId}`);
  const L = `/api/runs/${info.runId}/lesson/${run.current}`;
  let lesson = await api("GET", L);
  const draw = () => {
    const list = h("div", { class: "labchat" });
    for (const m of lesson.messages) {
      if (m.role === "note") { list.append(h("p", { class: "lnote" }, m.text)); continue; }
      if (m.card?.type === "tool" && !m.text) { list.append(h("p", { class: "ftool" }, m.card.icon, " ", shortTool(m.card.label))); continue; }
      if (m.role === "me") { if (m.text) list.append(h("div", { class: "labme" }, m.text)); continue; }
      list.append(h("div", { class: "labai" }, m.text ? tyText(m, lesson.workspace, "lab-" + info.runId) : null, m.card && m.card.type !== "tool" ? h("span", { class: "chip" }, `카드: ${m.card.type}`) : null));
    }
    const last = [...lesson.messages].reverse().find((m) => m.actions?.length);
    const acts = !lesson.busy && last ? h("div", { class: "row wrap" }, last.actions.map((a) => h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { lesson = await api("POST", L + "/act", { do: a.do }); draw(); }) }, a.label))) : null;
    if (lesson.busy) list.append(h("p", { class: "mut small" }, lesson.thinking ? `💭 ${lesson.thinking}` : "튜터가 답하는 중…"));
    const input = h("textarea", { rows: 2, placeholder: "튜터에게 말하기 (Enter 보내기, Shift+Enter 줄바꿈)" });
    const sendIt = () => { const t = input.value.trim(); if (!t || lesson.busy) return; input.value = ""; api("POST", L + "/act", { do: "ask", text: t }).catch((e) => alert(e.message)); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendIt(); } });
    const stop = lesson.busy ? h("button", { class: "btn small", onclick: () => api("POST", L + "/stop") }, "■ 멈추기") : null;
    chatCol.replaceChildren(list, acts, h("div", { class: "labin" }, input, h("button", { class: "btn primary", onclick: sendIt }, "보내기"), stop));
    list.scrollTop = list.scrollHeight;
    tyAfterDraw();
  };
  draw();
  if (labEvents) labEvents.close();
  labEvents = new EventSource(`/api/runs/${info.runId}/events`);
  let wasBusy = lesson.busy;
  labEvents.onmessage = async (e) => {
    if (location.hash !== "#/lab") { labEvents.close(); return; }
    if (e.data !== "lesson") return;
    lesson = await api("GET", L); draw();
    if (wasBusy && !lesson.busy) drawLabSide(side, await api("GET", "/api/lab"));
    wasBusy = lesson.busy;
  };
}
function drawLabSide(side, info) {
  const tabs = [["edit", "맥락 고치기"], ["extra", "추가 지시"], ["pipe", "처리 방식"], ["last", "마지막으로 간 것"]];
  const bar = h("div", { class: "labtabs" }, tabs.map(([k, label]) => h("button", { class: `btn small ${labUi.tab === k ? "primary" : ""}`, onclick: () => { labUi.tab = k; drawLabSide(side, info); } }, label)));
  let body;
  if (labUi.tab === "edit") {
    // 11/4 사용자 "대화 내역만 고정으로 붙게 하고 다른 건 다 수정 가능하게"
    const items = info.prompts || [];
    labUi.key = labUi.key && items.some((p) => p.key === labUi.key) ? labUi.key : items[0]?.key;
    const it = items.find((p) => p.key === labUi.key);
    const pick = h("select", { onchange: (e) => { labUi.key = e.target.value; drawLabSide(side, info); } }, items.map((p) => h("option", { value: p.key, selected: p.key === labUi.key }, `${p.label}${p.changed ? " · 바꿈" : ""}`)));
    const ta = h("textarea", { class: "labextra", rows: 18, spellcheck: "false" }, it?.current ?? "");
    const msg = h("span", { class: "mut small" }, it?.changed ? "바꾼 글을 쓰는 중이에요." : "기본값이에요.");
    const save = (text) => busy(null, async () => { await api("POST", "/api/lab/prompt", { key: it.key, text }); const fresh = await api("GET", "/api/lab"); Object.assign(info, fresh); drawLabSide(side, info); });
    body = h("div", { class: "labpane" },
      h("p", { class: "small" }, h("b", {}, "앞서 한 대화 내역"), "(앞부분 요약 · 최근 대화 · 지난 질문 뒤 화면)만 코드가 그대로 붙이고, 나머지는 여기서 고쳐요. 저장하면 다음 답부터 쓰여요. 실제 코스 튜터에도 똑같이 적용돼요."),
      pick,
      it ? h("p", { class: "small mut" }, it.where) : null,
      it?.vars?.length ? h("div", { class: "small" }, "넣을 수 있는 자리표시(값이 빈 줄은 저절로 빠져요): ", it.vars.map((v) => h("code", { class: "labvar", title: "누르면 커서 자리에 넣어요", onclick: () => { const p0 = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, p0) + `{${v}}` + ta.value.slice(p0); ta.focus(); } }, `{${v}}`))) : null,
      ta,
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => save(ta.value) }, "저장"),
        h("button", { class: "btn", onclick: () => { if (confirm("기본값으로 되돌릴까요?")) save(""); } }, "기본값으로"),
        h("button", { class: "btn ghost", onclick: () => { ta.value = it.def; } }, "기본값 불러와 보기"), msg));
  } else if (labUi.tab === "extra") {
    const ta = h("textarea", { class: "labextra", rows: 14, placeholder: "예) 반말 섞지 말고 짧게. 질문엔 첫 문장에 답부터. 비유는 한 번만. 목록·소제목 쓰지 마." }, info.extra || "");
    const msg = h("span", { class: "mut small" }, info.extra ? "지금 적용 중이에요." : "비어 있어요.");
    body = h("div", { class: "labpane" },
      h("p", { class: "small" }, "여기 적은 글은 ", h("b", {}, "모든 튜터 차례의 맥락 맨 끝"), "에 '[추가 지시]'로 붙어요. 실험방뿐 아니라 실제 코스의 튜터에도 똑같이 적용돼요. 저장하면 다음 답부터 바로 반영돼요."),
      ta,
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => { const out = await api("POST", "/api/lab/extra", { extra: ta.value }); info.extra = out.extra; msg.textContent = out.extra ? "저장했어요. 다음 답부터 적용돼요." : "비웠어요."; }) }, "저장"),
        h("button", { class: "btn", onclick: () => { ta.value = ""; } }, "지우기"), msg));
  } else if (labUi.tab === "pipe") {
    body = h("div", { class: "labpane" },
      h("p", { class: "small mut" }, "튜터에게 질문 하나가 갈 때 코드가 맥락을 이렇게 조립해요. 위에서 아래 순서로 모델에 들어가요."),
      h("ol", { class: "labpipe" }, info.pipeline.map((p) => h("li", {}, h("b", {}, p.step), h("div", { class: "small" }, p.what)))),
      h("details", {}, h("summary", {}, "고정 지시문(SYSTEM) 전체 보기"), h("pre", { class: "labpre" }, info.system)));
  } else {
    const l = info.last;
    body = h("div", { class: "labpane" },
      !l?.turn ? h("p", { class: "mut" }, "아직 기록이 없어요. 왼쪽에서 한 번 물어보면 여기 실제로 간 것이 나와요.") : [
        h("p", { class: "small mut" }, `${l.at} · 이 대화의 ${l.turnNo ?? "?"}번째 차례 · 대화 메시지 ${l.messages}개 · 모델 ${l.settings?.model ?? "?"} · 생각 ${JSON.stringify(l.settings?.reasoning)} · 글 ${JSON.stringify(l.settings?.text)}`),
        h("p", { class: "small" }, "도구: ", l.tools.join(", ")),
        h("details", { open: true }, h("summary", {}, "이번 차례에 덧붙인 글 (맥락 · 학습자 말)"), h("pre", { class: "labpre" }, l.turn)),
        h("details", {}, h("summary", {}, "지시문 (실제로 간 것, OpenCode 덧붙임 뗀 뒤)"), h("pre", { class: "labpre" }, l.instructions)),
        h("details", { open: true }, h("summary", {}, "받은 답"), h("pre", { class: "labpre" }, l.answer || "(없음)")),
        h("button", { class: "btn small", onclick: async () => drawLabSide(side, await api("GET", "/api/lab")) }, "새로 고침")]);
  }
  side.replaceChildren(bar, body);
}


/* ---------- 프리스타일(11/4 사용자 "실험판 느낌 그대로 제품에 연결"): 걸음 없이 대화만 ----------
 * 튜터 창(FLOAT)과 튜터 탭 둘 다. VS Code에서 고른 줄 · [막혔어요] · 실습 서버 · 검사는 그대로 쓴다 */
function drawFree() {
  const { run, lesson } = lessonCtx;
  const ws = lesson.workspace;
  const send = (body) => (e) => busy(e?.target, async () => { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, body); drawLesson(); });
  const list = h("div", { class: "freelist" });
  for (const m of lesson.messages) {
    if (m.role === "note") { list.append(h("p", { class: "fnote" }, m.text)); continue; }
    if (m.card?.type === "tool" && !m.text) { list.append(h("p", { class: "ftool" }, m.card.icon, " ", shortTool(m.card.label))); continue; }
    if (m.role === "me") { list.append(h("div", { class: "freeme" }, m.card?.type === "code" ? h("span", { class: "fref" }, `${m.card.file} ${m.card.from}${m.card.to > m.card.from ? `~${m.card.to}` : ""}줄`) : null, m.text || "")); continue; }
    list.append(h("div", { class: "freeai" }, m.text ? tyText(m, ws, run.id) : null, m.card && m.card.type !== "tool" ? lessonCard(m.card, run, lesson, send, ws) : null));
  }
  if (!lesson.messages.length) list.append(h("p", { class: "mut small freeempty" }, "아무거나 물어보세요. VS Code에서 줄을 고르고 물어보면 그 줄을 같이 봐요."));
  if (lesson.busy) list.append(thinkLine(run, lesson));
  const input = h("textarea", { rows: 2, placeholder: "물어보기 (Enter 보내기, Shift+Enter 줄바꿈)", "aria-label": "튜터에게 물어보기" });
  const go = (e) => { const t = input.value.trim(); if (!t || lesson.busy) return; input.value = ""; send({ do: "ask", text: t })(e); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(e); } });
  const foot = h("footer", { class: "freefoot" },
    lesson.chat ? null : stuckBar(lesson, send), lesson.chat ? null : stuckPicker(run, lesson, send, FLOAT ? "in-float" : ""),
    h("div", { class: "freein" }, input, lesson.chat && lesson.busy ? h("button", { class: "btn", onclick: send({ do: "stop_chat" }) }, "멈추기") : h("button", { class: "btn primary", onclick: go, disabled: lesson.busy }, "보내기")),
    lesson.chat || lesson.stuck || lesson.busy ? null : h("div", { class: "fquick" }, h("button", { class: "fchip warm", onclick: () => { stuckUi.open = !stuckUi.open; drawLesson(); } }, "막혔어요")));
  const head = h("header", { class: "freehead" },
    h("div", { class: "grow" }, h("b", {}, run.course?.title ?? "프리스타일"), h("span", { class: "mut small" }, lesson.chat ? ` · 실험판 엔진${lesson.chat.focus ? ` · 초점: ${lesson.chat.focus}` : ""}${lesson.chat.support.length ? ` · 보충: ${lesson.chat.support.join(" › ")}` : ""}` : " · 프리스타일")),
    lesson.chat ? modelPick(run, lesson) : null,
    h("button", { class: "fib", title: "대화 목록", "aria-label": "대화 목록", onclick: () => go_("#/home") }, icon("home")),
    h("button", { class: "btn small", title: "새 대화", onclick: () => go_("#/home") }, "+ 새 대화"),
    FLOAT ? h("button", { class: "fib", title: floatUi.size === "wide" ? "작게" : "넓게", onclick: () => { floatUi.size = floatUi.size === "wide" ? "normal" : "wide"; floatPost({ size: floatUi.size }); drawLesson(); } }, icon(floatUi.size === "wide" ? "narrow" : "wide")) : null,
    FLOAT ? h("button", { class: `fib ${floatUi.pinned ? "on" : ""}`, title: "고정", onclick: async () => { const out = await floatPost({ pinned: !floatUi.pinned }); floatUi.pinned = !!out?.pinned; drawLesson(); } }, icon("pin")) : null,
    FLOAT ? h("button", { class: "fib", title: "닫기", onclick: () => floatPost({ open: false }) }, icon("close")) : null);
  view.replaceChildren(h("div", { class: `freewrap ${FLOAT ? "fw " + floatUi.size : ""}` }, head, lesson.chat ? wsBar(run, lesson) : null, lesson.chat ? learnedBar(lesson) : null, list, lesson.chat && !lesson.chat.edit ? editAsk(run) : null, foot));
  list.scrollTop = list.scrollHeight;
  if (!FLOAT) window.scrollTo({ top: document.body.scrollHeight });
  tyAfterDraw();
}
const go_ = (hash) => go(hash);

/* 배운 것(11/4 사용자 "배운 거 갱신"): 질문이 끝날 때마다 대화에서 뽑은 사건. 근거는 학습자 말 그대로 */
const KIND_KO = { asked: "물어봄", confused: "헷갈림", misconception: "틀리게 앎", explained: "자기 말로 설명", applied: "직접 써 봄" };
const learnedUi = { open: false };
function learnedBar(lesson) {
  const items = lesson.learned || [];
  if (!items.length) return null;
  const byConcept = new Map();
  for (const x of items) { if (!byConcept.has(x.concept)) byConcept.set(x.concept, []); byConcept.get(x.concept).push(x); }
  const head = h("button", { class: "lhead", onclick: () => { learnedUi.open = !learnedUi.open; drawLesson(); } }, `배운 것 ${byConcept.size}개`, h("span", { class: "mut small" }, learnedUi.open ? " 접기" : " 펼치기"));
  if (!learnedUi.open) return h("div", { class: "learned" }, head);
  return h("div", { class: "learned" }, head, h("ul", {}, [...byConcept].map(([c, xs]) => h("li", {},
    h("b", {}, c), " ", xs.map((x) => h("span", { class: `lk ${x.kind}`, title: `"${x.quote}"` }, KIND_KO[x.kind] ?? x.kind)),
    xs[0].meaning ? h("div", { class: "mut small" }, xs[0].meaning) : null))));
}

/* 대화 설정(11/4 사용자): 모델 고르기 · 파일 고치기 허락(처음에 묻고, 작업 폴더 줄에서 바꿈) */
const chatOpt = (run, body) => busy(null, async () => { try { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/chat-options`, body); drawLesson(); } catch (e) { toast(e.message); } });
function modelPick(run, lesson) {
  const sel = h("select", { class: "mpick", title: "이 대화의 모델(다음 질문부터)", "aria-label": "모델", disabled: lesson.busy, onchange: (e) => chatOpt(run, { model: e.target.value }) },
    lesson.chat.models.map((m) => h("option", { value: m.id }, m.label)));
  sel.value = lesson.chat.model;
  return sel;
}
function editAsk(run) {
  return h("div", { class: "editask" }, h("span", { class: "grow" }, "튜터가 작업 폴더의 파일을 직접 만들고 고쳐도 될까요? 나중에 작업 폴더 줄에서 바꿀 수 있어요."),
    h("button", { class: "btn small primary", onclick: () => chatOpt(run, { edit: "allow" }) }, "허용"),
    h("button", { class: "btn small", onclick: () => chatOpt(run, { edit: "deny" }) }, "허용 안 함"));
}

/* 작업 폴더 줄(11/4 사용자 "현재 작업 폴더 위치도 사람이 보고 수정 가능하게"): 보기 · 바꾸기 · VS Code로 열기 */
const wsUi = { edit: false };
function wsBar(run, lesson) {
  const path = lesson.workspace || "";
  if (wsUi.edit) {
    const input = h("input", { class: "wsin", value: path, "aria-label": "작업 폴더 경로", spellcheck: "false" });
    const save = (e) => busy(e?.target, async () => {
      try { await api("POST", `/api/runs/${run.id}/workspace`, { path: input.value }); wsUi.edit = false; lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`); drawLesson(); toast("작업 폴더를 바꿨어요. 다음 질문부터 이 폴더를 봐요."); }
      catch (err) { toast(err.message); }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(e); } if (e.key === "Escape") { wsUi.edit = false; drawLesson(); } });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return h("div", { class: "wsbar edit" }, input, h("button", { class: "btn small primary", onclick: save }, "저장"), h("button", { class: "btn small", onclick: () => { wsUi.edit = false; drawLesson(); } }, "취소"));
  }
  return h("div", { class: "wsbar" }, h("span", { class: "mut small" }, "작업 폴더"), h("code", { class: "wsp", title: path }, path),
    h("button", { class: "btn small", disabled: lesson.busy, title: lesson.busy ? "답하는 중에는 못 바꿔요" : "다른 폴더로 바꾸기", onclick: () => { wsUi.edit = true; drawLesson(); } }, "바꾸기"),
    h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/editor`, { float: false }); toast("VS Code에서 열었어요."); }) }, "VS Code로 열기"),
    lesson.chat.edit ? h("label", { class: "small edittog", title: "튜터가 이 폴더의 파일을 고칠 수 있는지" }, h("input", { type: "checkbox", checked: lesson.chat.edit === "allow", disabled: lesson.busy, onchange: (e) => chatOpt(run, { edit: e.target.checked ? "allow" : "deny" }) }), " 튜터가 고치기") : null);
}
