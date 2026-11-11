// 프로젝트 코스 화면. 빌드 없이 도는 바닐라 JS.
// #/run/<id> 실습 대화(자유 실습만, 11/11 정해진 코스 뺌)
const $ = (s, el = document) => el.querySelector(s);
// VS Code 오른쪽 탭 안에서 열릴 때(?embed=1): 위쪽 바와 VS Code 열기 버튼을 빼고 좁은 폭에 맞춘다.
const EMBED = new URLSearchParams(location.search).has("embed");
// 앱 안 편집기 화면의 오른쪽 튜터(11/11): 장기 · 지금 목표는 앱 위 띠에 있으니 여기서는 버튼만 남긴다
const STUDIO = new URLSearchParams(location.search).has("studio");
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

async function route() {
  await loadStatus().catch(() => {});
  const hash = location.hash;
  let m;
  try {
    if (hash === "#/memory") return await renderMemory();
    if (hash === "#/rechecks") return await renderRechecks();
    if ((m = /^#\/note\/(\w+)/.exec(hash))) return await renderNote(m[1]);
    if ((m = /^#\/timeline\/(\w+)/.exec(hash))) return await renderTimeline(m[1]);
    if ((m = /^#\/evals(?:\/([\w-]+))?/.exec(hash))) return await renderEvals(m[1]);
    if ((m = /^#\/run\/(\w+)/.exec(hash))) return await renderRunOrLesson(m[1]);
    // 11/4 사용자 "홈은 대화 첫 시작만, 예전식은 다 숨겨": 들어오면 늘 홈(대화 시작 + 대화 목록)
    return await renderHome();
  } catch (e) {
    view.replaceChildren(h("div", { class: "empty" }, h("h1", {}, "열지 못했어요"), h("p", {}, e.message), h("button", { class: "btn", onclick: () => go("#/") }, "처음으로")));
  }
}
window.addEventListener("hashchange", route);
// 튜터 창 바깥 화면의 맨 위 줄(11/5 사용자 "VS Code 붙는 창에서 홈 화면에선 X·창 확대 같은 기본 기능이 안 됨"):
// 창(float/main.cjs)은 테두리가 없어 OS 단추가 없다. 걸음 카드 화면(.fw)은 자기 머리줄에 닫기·넓게가 있지만, 홈·코스 고르기 같은
// 다른 화면에는 없어서 갇혔다. 그런 화면에서는 이 줄을 보인다: [← 하던 걸음] [넓게/작게] [닫기].
let floatBar = null;
function syncFloatBar() {
  if (!FLOAT) return;
  if (!floatBar) {
    floatBar = h("div", { class: "floatbar", role: "toolbar", "aria-label": "튜터 창" },
      h("button", { onclick: () => fetch("/api/float").then((r) => r.json()).then((st) => go(st.runId ? `#/run/${st.runId}` : "#/")).catch(() => go("#/")) }, "← 하던 걸음으로"),
      h("span", {}, "Recaller 튜터"),
      h("button", { onclick: () => { floatUi.size = floatUi.size === "wide" ? "normal" : "wide"; floatPost({ size: floatUi.size }); syncFloatBar(); } }, ""),
      h("button", { title: "튜터 창 닫기", onclick: () => floatPost({ open: false }) }, "닫기 ✕"));
    document.body.prepend(floatBar);
  }
  floatBar.children[2].textContent = floatUi.size === "wide" ? "작게" : "넓게";
  const lessonView = Boolean(document.querySelector(".fw"));
  floatBar.hidden = lessonView;
  document.documentElement.classList.toggle("float-bar", !lessonView);
}
if (FLOAT) {
  window.addEventListener("hashchange", () => setTimeout(syncFloatBar, 0));
  new MutationObserver(() => syncFloatBar()).observe(document.getElementById("view") ?? document.body, { childList: true });
  setTimeout(syncFloatBar, 0);
}

const homeEngine = () => { try { return localStorage.getItem("recaller-engine") || "codex"; } catch { return "codex"; } };
const setHomeEngine = (k) => { try { localStorage.setItem("recaller-engine", k); } catch { /* */ } };
/* ---------- 홈(11/4 사용자 "최소한만: 대화 첫 시작 → 대화창, 홈 누르면 대화 목록, 새 대화") ---------- */
async function renderHome() {
  const chats = await api("GET", "/api/chats").catch(() => []);
  const input = h("textarea", { rows: 3, class: "hin", placeholder: "무엇을 배워 볼까요? (Enter 시작, Shift+Enter 줄바꿈)", "aria-label": "첫 질문" });
  const btn = h("button", { class: "btn primary" }, "시작");
  const start = (e) => {
    const text = input.value.trim(); if (!text) return input.focus();
    busy(btn, async () => {
      // 웹 화면에서 시작하면 VS Code만 열고 튜터 창은 띄우지 않는다(이 화면이 대화창). 튜터 창·VS Code 탭 안에서는 여는 것 없이
      const out = await api("POST", "/api/free", { courseId: "hello-api", course: "none", engine: homeEngine() === "codex" ? "codex" : undefined, open: !FLOAT && !EMBED, float: false });
      await api("POST", `/api/runs/${out.runId}/lesson/1/act`, { do: "ask", text });
      openChat({ runId: out.runId, workspace: out.workspace });
    });
  };
  btn.onclick = start;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); start(e); } });
  const when = (at) => { const d = new Date(at); const t = Date.now() - d; return t < 864e5 ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); };
  const list = chats.length ? h("div", { class: "hlist" }, h("div", { class: "mut small" }, "이전 대화"),
    chats.map((c) => h("button", { class: "hitem", onclick: () => openChat(c) }, h("span", { class: `heb ${c.engine}` }, c.engine === "codex" ? "Codex" : "기존"), h("span", { class: "grow" }, c.title), h("span", { class: "mut small" }, c.busy ? "답하는 중" : when(c.at))))) : null;
  // 11/4 사용자 "첫 화면에서 Codex 버전 · 기존 버전 나눠서 체크": 고른 것은 이 브라우저에 기억
  const eng = h("div", { class: "heng", role: "radiogroup", "aria-label": "엔진" }, [["codex", "Codex 버전"], ["basic", "기존 버전"]].map(([k, t]) =>
    h("button", { class: `hchip ${homeEngine() === k ? "on" : ""}`, role: "radio", "aria-checked": String(homeEngine() === k), onclick: () => { setHomeEngine(k); renderHome(); } }, t)));
  const memBtn = h("button", { class: "btn small", onclick: () => go("#/memory") }, "학습자 메모리");
  // 다시 확인(11/8): 예전 실습에서 부족했던 것 중 날짜가 된 것
  const due = await api("GET", "/api/rechecks").catch(() => ({ items: [], total: 0 }));
  const reBtn = due.total ? h("button", { class: `btn small ${due.items.length ? "primary" : ""}`, title: "예전 실습에서 부족했던 바로 그 지점을 다시 물어봐요", onclick: () => go("#/rechecks") }, due.items.length ? `다시 확인 ${due.items.length}개` : "다시 확인") : null;
  const evBtn = h("button", { class: "btn small", title: "튜터 평가 실험 결과", onclick: () => go("#/evals") }, "실험 결과");
  // 실험 자료 비우기(11/6 사용자 "실험용으로 작게"): 두 번 눌러야 비움(보관으로 옮김, 지우지 않음)
  const resetBtn = h("button", { class: "btn small", title: "대화 · 목표 · 학습자 메모리를 .data/보관으로 옮겨요(지우지 않음). 앱의 기억은 그대로.", onclick: async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "한 번 더 누르면 비워요"; setTimeout(() => { delete b.dataset.sure; b.textContent = "실험 자료 비우기"; }, 4000); return; }
    const r = await api("POST", "/api/dev/reset"); toast(r.label ? `보관했어요: .data/보관/${r.label} (${r.count}개)` : "이미 비어 있어요"); go("#/");
  } }, "실험 자료 비우기");
  view.replaceChildren(h("div", { class: `home2 ${FLOAT ? "fw" : ""}` }, h("h1", {}, "무엇을 배워 볼까요?"), eng, h("div", { class: "hbox" }, input, btn), h("div", { class: "hmem" }, reBtn, resetBtn, evBtn, memBtn), list));
  input.focus();
}
/* 학습 종료(11/6): 정리하는 동안 덮개 → 결과 한 줄 → 홈 */
async function endLearning(run) {
  const cover = h("div", { class: "endcover" }, h("div", { class: "endbox" }, h("div", { class: "spin" }), h("b", {}, "학습을 정리하는 중이에요"), h("div", { class: "mut small" }, "배운 것 · 부족했던 점 · 학습자 메모리를 정리하고 지식에 넣어요")));
  document.body.append(cover);
  try {
    const r = await api("POST", `/api/runs/${run.id}/end`);
    const a = r.recorded ? `배운 것 ${r.recorded.learned} · 부족했던 점 ${r.recorded.gaps}${r.recorded.memory ? ` · 메모리 ${r.recorded.memory}곳 갱신` : ""}` : "정리할 목표가 없었어요";
    toast(`${a}${r.synced ? ` · 지식 ${r.synced.created}개 새로` : " · 앱이 꺼져 있어 지식은 다음에 넣어요"}`);
    go(`#/note/${run.id}`); // 11/8: 끝나면 이번 학습의 세션 노트(배운 것 · 부족함과 그 뒤)를 먼저 보여 준다
  } catch (e) { toast(e.message); } finally { cover.remove(); }
}
/* 학습 기록 타임라인(11/8 사용자 "행동이 완수되는 걸 시간 기준으로, 상태가 어떻게 변하는지 모서리 둥근 상자를 화살표로 잇고, 토큰 · 속도는 작게 버튼으로") */
const tlUi = { metrics: false, open: new Set(), full: new Set() };
function stateBox(st) {
  if (!st) return h("div", { class: "mut small" }, "(이 칸은 타임라인을 남기기 전 기록이라 상태가 없어요)");
  const mk = { done: "✓", skipped: "↷", doing: "▶", todo: "·" };
  const row = (k, ...v) => h("div", { class: "tlrow" }, h("span", { class: "tlk" }, k), h("span", { class: "tlv" }, ...v));
  return h("div", { class: "tlstate" },
    row("장기 목표", st.long ?? "없음", st.mode ? h("span", { class: "chip" }, st.mode === "topdown" ? "탑다운" : "바텀업") : null),
    st.map.length ? row(st.support ? "로드맵(보관)" : "로드맵", ...st.map.map((m, i) => h("span", { class: `tlchip ${m.status}` }, `${i + 1}${mk[m.status] ? " " + mk[m.status] : ""} ${m.title}`))) : null,
    row("현재 목표", st.current ? `${st.current.title} — ${st.current.phase}` : "없음", st.current ? h("div", { class: "mut small" }, `완료 조건: ${st.current.done}`) : null),
    st.support ? row(`보충${st.support.round > 1 ? ` (${st.support.round}번째)` : ""}`, ...st.support.steps.map((x) => h("span", { class: `tlchip sup ${x.status}` }, `${mk[x.status] ? mk[x.status] + " " : ""}${x.title}`)), h("span", { class: `tlchip goal ${st.support.back ? "doing" : ""}` }, `🎯 ${st.support.target}`)) : null,
    st.survey ? row("설문", st.survey.join(" / ")) : null, st.plan ? row("계획 제안", st.plan) : null, st.stuck ? row("어려움", st.stuck) : null,
    row("학습자 메모리", st.memory.length ? h("div", {}, st.memory.map((m) => h("div", { class: "small" }, `${m.status} · ${m.text}`))) : "없음"),
    row("설정", `파일 고치기 ${st.edit === "allow" ? "허용" : st.edit === "deny" ? "거절" : "안 물음"} · 저장하면 확인 ${st.autoCheck ? "켬" : "끔"} · 목표 정리 ${st.records}개`));
}
async function renderTimeline(runId) {
  const t = await api("GET", `/api/runs/${runId}/timeline`);
  const steps = t.steps;
  // 막힌 순간(11/11): 오류 · 틀림 · 어려워요부터 풀림 · 넘어감까지 한 장면씩. 타임라인 위에 모아 보인다
  const moments = (await api("GET", `/api/runs/${runId}/moments`).catch(() => ({ moments: [] }))).moments ?? [];
  const dur = (sec) => (sec >= 60 ? `${Math.round(sec / 60)}분` : `${sec}초`);
  const momentBox = (m, i) => {
    const state = !m.closedAt ? "open" : m.how === "안 풀고 넘어감" ? "left" : "solved";
    const help = [m.help.replies ? `튜터 답 ${m.help.replies}번` : "", m.help.code ? "코드 받음" : "", m.help.edits.length ? `튜터가 고침: ${m.help.edits.join(", ")}` : ""].filter(Boolean).join(" · ");
    return h("div", { class: `mbox ${state}` },
      h("div", { class: "tlhead" }, h("span", { class: "tln" }, i + 1), h("span", { class: `tlwho m-${m.by === "오류" ? "err" : m.by === "판정" ? "judge" : "hard"}` }, m.by === "오류" ? "오류" : m.by === "판정" ? "틀림 판정" : "너무 어려워요"),
        h("span", { class: `mhow ${state}` }, !m.closedAt ? "아직 막힘" : m.how), h("span", { class: "grow" }), h("span", { class: "tlmetric" }, `${dur(m.seconds)}${m.tries > 1 ? ` · ${m.tries}번 시도` : ""}`)),
      m.goal ? h("div", { class: "mgoal" }, m.goal) : null,
      m.command ? h("pre", { class: "mcode" }, `> ${m.command}
${m.error ?? ""}`) : m.gap ? h("div", { class: "tlsay" }, `빠진 곳: ${m.gap}`) : m.reasons ? h("div", { class: "tlsay" }, m.reasons) : null,
      m.said.length ? h("div", { class: "msaid" }, m.said.slice(0, 3).map((x) => h("div", { class: "tlsay message" }, x))) : null,
      help ? h("div", { class: "mhelp" }, h("span", { class: "tlk" }, "받은 도움"), help) : m.closedAt && state === "solved" ? h("div", { class: "mhelp" }, h("span", { class: "tlk" }, "받은 도움"), "없음") : null,
      m.changed?.length ? h("div", { class: "mchg" }, h("span", { class: "tlk" }, "이렇게 바꿔서 풀림"), m.changed.map((c) => h("div", {}, h("div", { class: "mfile" }, c.file), h("pre", { class: "mcode diff" }, c.diff.map((l) => h("span", { class: l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "" }, l + "\n")))))) : null);
  };
  const sum = steps.reduce((a, s) => (s.usage ? { input: a.input + s.usage.input, cached: a.cached + s.usage.cached, output: a.output + s.usage.output, ms: a.ms + s.usage.ms } : a), { input: 0, cached: 0, output: 0, ms: 0 });
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  const metric = (u) => u ? h("span", { class: "tlmetric" }, u.input || u.output ? `입력 ${k(u.input)}(캐시 ${k(u.cached)}) · 출력 ${k(u.output)} · ` : "", `${(u.ms / 1000).toFixed(1)}초${u.calls ? ` · 호출 ${u.calls}` : ""}`) : null;
  const who = { message: "학습자", button: "버튼", save: "저장", system: "Recaller" };
  // 11/11 사용자 "학습 기록 UI가 어색함. 컨셉 살려서 둥글둥글하게 가독성 좋게": 칸 = 둥근 카드, 학습자 말 · AI 답은 말풍선, 도구 · 바뀐 것은 알약
  const box = (s) => {
    const open = tlUi.open.has(s.n), full = tlUi.full.has(s.n), reply = s.reply || "";
    const kind = s.trigger.kind;
    return h("div", { class: `tlbox ${kind}` },
      h("div", { class: "tlhead" }, h("span", { class: "tln" }, s.n), h("span", { class: `tlwho ${kind}` }, who[kind] ?? kind),
        kind === "message" ? null : h("b", { class: "tllabel" }, s.trigger.label),
        h("span", { class: "grow" }), s.usage ? h("button", { class: "tlm", title: "토큰 · 속도", onclick: () => { tlUi.metrics = !tlUi.metrics; drawTl(); } }, "⏱") : null),
      tlUi.metrics && s.usage ? h("div", {}, metric(s.usage)) : null,
      s.trigger.text ? h("div", { class: `tlsay ${kind}` }, s.trigger.text) : null,
      reply ? h("div", { class: "tlai" }, h("span", { class: "tlav" }, "R"),
        h("div", { class: "tlbub" }, h("div", { class: `tlreply ${full || reply.length <= 220 ? "" : "clip"}` }, reply.replace(/\*\*(.+?)\*\*/g, "$1")),
          reply.length > 220 ? h("button", { class: "tlpill", onclick: () => { full ? tlUi.full.delete(s.n) : tlUi.full.add(s.n); drawTl(); } }, full ? "접기" : "더 보기") : null)) : null,
      s.tools?.length ? h("div", { class: "tltools" }, ...s.tools.map((x) => h("span", { class: "tlchip tool" }, "🔧 ", x))) : null,
      s.extra ? h("div", { class: "tlextra small" }, Object.entries(s.extra).filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([kk, v]) => h("div", {}, h("span", { class: "tlk" }, ({ learned: "배운 것", gaps: "부족했던 점", memory: "메모리 반영", recorded: "정리", synced: "기억에 넣음" })[kk] ?? kk), " ", Array.isArray(v) ? v.join(" · ") : typeof v === "object" ? JSON.stringify(v) : String(v)))) : null,
      s.changes?.length ? h("div", { class: "tlchgbox" }, h("span", { class: "tlk" }, "바뀐 것"), h("ul", { class: "tlchg" }, s.changes.map((c) => h("li", {}, c)))) : null,
      s.state ? h("div", {}, h("button", { class: "tlpill", onclick: () => { open ? tlUi.open.delete(s.n) : tlUi.open.add(s.n); drawTl(); } }, open ? "상태 접기" : "이때 상태 보기")) : null,
      open ? stateBox(s.state) : null);
  };
  const drawTl = () => view.replaceChildren(h("div", { class: `home2 tl tlpage ${FLOAT ? "fw" : ""}` },
    h("div", { class: "tltop" }, h("button", { class: "btn small", onclick: () => history.back() }, "← 돌아가기"), h("h1", {}, "학습 기록"), h("span", { class: "tlcount" }, `${steps.length}칸`), h("span", { class: "grow" }),
      h("button", { class: `btn small ${tlUi.metrics ? "primary" : ""}`, title: "칸마다 토큰 · 속도", onclick: () => { tlUi.metrics = !tlUi.metrics; drawTl(); } }, "⏱ 토큰 · 속도")),
    h("p", { class: "tlintro" }, `내가 한 말 · 누른 버튼 · 저장 하나와 그에 대한 튜터 답이 한 칸이에요.${t.rough ? " 이 대화는 기록을 남기기 전이라 목표 정리로 만든 거친 칸이에요." : ""}`),
    tlUi.metrics ? h("p", { class: "tlintro" }, `전체: 입력 ${k(sum.input)}(캐시 ${k(sum.cached)}) · 출력 ${k(sum.output)} · AI 시간 ${(sum.ms / 1000).toFixed(1)}초`) : null,
    moments.length ? h("section", { class: "msec" }, h("div", { class: "msec-h" }, h("b", {}, "막힌 순간"), h("span", { class: "tlcount" }, `${moments.length}번`),
      h("span", { class: "tlintro" }, `풀림 ${moments.filter((m) => m.closedAt && m.how !== "안 풀고 넘어감").length} · 넘어감 ${moments.filter((m) => m.how === "안 풀고 넘어감").length}${moments.some((m) => !m.closedAt) ? " · 지금 막힘 1" : ""}`)),
      h("div", { class: "mlist" }, moments.map(momentBox))) : null,
    moments.length ? h("div", { class: "msec-h" }, h("b", {}, "전체 기록")) : null,
    steps.length ? h("div", { class: "tlflow" }, steps.flatMap((s, i) => [box(s), i < steps.length - 1 ? h("div", { class: "tlarrow" }) : null])) : h("p", { class: "mut" }, "아직 기록이 없어요.")));
  drawTl();
}

/* 실험 결과(11/8 사용자 "실험도 같은 모양으로"): 문항 하나 = 상황 → 학습자 답 → (판정) → 튜터 답 → 채점, 조건 탭 */
const evUi = { cond: null, onlyFail: false };
async function renderEvals(id) {
  if (!id) {
    const { items } = await api("GET", "/api/dev/evals");
    view.replaceChildren(h("div", { class: `home2 tl ${FLOAT ? "fw" : ""}` }, h("div", { class: "memhead" }, h("button", { class: "btn small", onclick: () => go("#/") }, "← 홈"), h("h1", {}, "실험 결과")),
      items.length ? h("ul", { class: "memlist" }, items.map((x) => h("li", { class: "mem" }, h("a", { href: `#/evals/${x}` }, x)))) : h("p", { class: "mut" }, "아직 실험이 없어요.")));
    return;
  }
  const r = await api("GET", `/api/dev/evals/${id}`);
  const conds = Object.keys(r.rows ?? {});
  if (!evUi.cond || !conds.includes(evUi.cond)) evUi.cond = conds[0];
  const GOLD = { correct: "맞음", partial: "일부만 맞음", incorrect: "틀림", subtle: "미묘하게 틀림", unclear: "근거 부족", not_answer: "답이 아님" };
  const draw = () => {
    const rows = (r.rows[evUi.cond] ?? []).filter((x) => !evUi.onlyFail || (x.gold && (x.grade?.accepted && x.gold !== "correct" && x.gold !== "not_answer" || x.grade?.leaked || x.grade?.near)));
    const sm = r.summary?.[evUi.cond] ?? {};
    const box = (cls, who, ...kids) => h("div", { class: `tlbox ${cls}` }, h("div", { class: "tlhead" }, h("span", { class: `tlwho ${cls}` }, who)), ...kids);
    const judgeCase = (x) => { const c = r.cases?.[x.id] ?? {};
      return h("div", { class: "evcase" }, h("div", { class: "small mut" }, `${x.id} · ${c.topic ?? ""} · 기대: ${GOLD[x.gold] ?? x.gold}`),
        h("div", { class: "tlflow" },
          box("system", "상황", h("div", { class: "small" }, `현재 목표: ${c.goal?.title ?? ""} — ${c.goal?.done ?? ""}`), h("div", { class: "tlsay" }, `튜터: ${c.tutor ?? ""}`)), h("div", { class: "tlarrow" }, "↓"),
          box("message", "학습자", h("div", { class: "tlsay" }, `“${c.learner ?? ""}”`)), h("div", { class: "tlarrow" }, "↓"),
          x.verdict ? box("save", "판정", h("div", { class: "small" }, `${x.verdict.verdict}${x.verdict.right ? ` · 맞은 부분: ${x.verdict.right}` : ""}${x.verdict.gap ? ` · 빠진 곳: ${x.verdict.gap}` : ""}`), x.ms?.judge ? h("span", { class: "tlmetric" }, `${(x.ms.judge / 1000).toFixed(1)}초`) : null) : null, x.verdict ? h("div", { class: "tlarrow" }, "↓") : null,
          box("button", "튜터", h("div", { class: "tlreply" }, x.reply), h("span", { class: "tlmetric" }, `${((x.ms?.tutor ?? 0) / 1000).toFixed(1)}초`)), h("div", { class: "tlarrow" }, "↓"),
          box("system", "채점", h("div", { class: "tltools" },
            h("span", { class: `tlchip ${x.grade.accepted && x.gold !== "correct" && x.gold !== "not_answer" ? "bad" : "ok"}` }, x.grade.accepted ? "맞다고 받아들임" : "맞다고 안 함"),
            x.gold !== "correct" && x.gold !== "not_answer" ? h("span", { class: `tlchip ${x.grade.pointed_gap ? "ok" : "bad"}` }, x.grade.pointed_gap ? "빠진 곳 짚음" : "빠진 곳 못 짚음") : null,
            h("span", { class: `tlchip ${x.grade.leaked || x.grade.near ? "bad" : "ok"}` }, x.grade.leaked ? "정답 통째로" : x.grade.near ? "힌트에 정답 핵심" : "정답 안 줌")), h("div", { class: "small mut" }, x.grade.note)))); };
    const recordCase = (x) => h("div", { class: "evcase" }, h("div", { class: "tlflow" }, box("system", "목표", h("b", {}, x.goal), h("span", { class: "tlmetric" }, `${((x.ms ?? 0) / 1000).toFixed(1)}초`)), h("div", { class: "tlarrow" }, "↓"),
      box("button", "정리", h("div", { class: "small" }, `배운 것 ${x.learned} · 부족했던 점 ${x.gaps}${x.withCode ? ` (코드 ${x.withCode})` : ""}: ${(x.gapsOut ?? []).join(" · ")}`)), h("div", { class: "tlarrow" }, "↓"),
      box("system", "채점", h("div", { class: "small" }, `대화에서 찾은 부족함 ${x.found}개 · 놓침 ${x.missed?.length ?? 0}${x.missed?.length ? `: ${x.missed.join(" / ")}` : ""}`), x.unsupported?.length ? h("div", { class: "small" }, `근거 없는 부족함: ${x.unsupported.join(" / ")}`) : null)));
    view.replaceChildren(h("div", { class: `home2 tl ${FLOAT ? "fw" : ""}` },
      h("div", { class: "memhead" }, h("button", { class: "btn small", onclick: () => go("#/evals") }, "← 실험 목록"), h("h1", {}, id.startsWith("judge") ? "답 판정 실험" : "목표 정리 실험")),
      h("div", { class: "tltools" }, conds.map((k) => h("button", { class: `btn small ${k === evUi.cond ? "primary" : ""}`, onclick: () => { evUi.cond = k; draw(); } }, k)),
        id.startsWith("judge") ? h("label", { class: "small" }, h("input", { type: "checkbox", checked: evUi.onlyFail, onchange: (e) => { evUi.onlyFail = e.target.checked; draw(); } }), " 실패만") : null),
      h("p", { class: "small" }, Object.entries(sm).filter(([kk]) => kk !== "falseAcceptIds").map(([kk, v]) => `${({ falseAccept: "틀린 답 인정", correctAccepted: "맞는 답 인정", pointedGap: "빠진 곳 짚음", leaked: "정답 통째로", nearAnswer: "정답에 가까운 힌트", handledAsks: "질문에 응함", judgeAgree: "판정 일치", msTutorMedian: "튜터 ms", msJudgeMedian: "판정 ms", gapRecall: "부족함 잡음", unsupportedGaps: "근거 없는 부족함", msMedian: "ms" })[kk] ?? kk} ${v}`).join(" · ")),
      ...rows.map((x) => (id.startsWith("judge") ? judgeCase(x) : recordCase(x)))));
  };
  draw();
}

/* 학습자 메모리(11/6 사용자 "GPT 메모리 관리하듯이 이 사람이 어느 정도인지 관리"): 진행 방식 · 경향, 상태 · 근거 · 갱신 기록, 고치기 · 지우기 */
const memUi = { edit: null };
async function renderMemory() {
  const { items } = await api("GET", "/api/memory");
  const post = (id, b) => busy(null, async () => { await api("POST", `/api/memory/${id}`, b); memUi.edit = null; renderMemory(); });
  const card = (i) => {
    const editing = memUi.edit === i.id;
    const input = editing ? h("textarea", { rows: 2, class: "hin" }, i.text) : null;
    return h("li", { class: `mem ${i.status === "나아짐" ? "better" : ""}` },
      h("div", { class: "memrow" }, h("span", { class: `memst ${i.status}` }, i.status),
        editing ? input : h("span", { class: "grow" }, i.text),
        editing ? h("button", { class: "btn small primary", onclick: () => post(i.id, { text: input.value }) }, "저장") : h("button", { class: "btn small", onclick: () => { memUi.edit = i.id; renderMemory(); } }, "고치기"),
        h("button", { class: "btn small", onclick: () => post(i.id, { delete: true }) }, "지우기")),
      h("div", { class: "mut small" }, `근거 ${i.evidence.length}개 (목표 ${new Set(i.evidence.map((e) => e.runId + e.goal)).size}곳): ${[...new Set(i.evidence.map((e) => e.name))].join(", ")}`),
      i.history.length ? h("details", { class: "small" }, h("summary", {}, `갱신 기록 ${i.history.length}`), h("ul", {}, [...i.history].reverse().map((x) => h("li", {}, `${x.at.slice(5, 16).replace("T", " ")} · ${x.what}`)))) : null);
  };
  const tend = items.filter((i) => i.kind === "경향").sort((a, b) => b.at.localeCompare(a.at));
  view.replaceChildren(h("div", { class: `home2 memory ${FLOAT ? "fw" : ""}` },
    h("div", { class: "memhead" }, h("button", { class: "btn small", onclick: () => go("#/") }, "← 홈"), h("h1", {}, "학습자 메모리")),
    h("p", { class: "mut small" }, "목표를 끝낼 때마다 튜터가 정리하면서 갱신해요. 처음 보면 가설, 다른 목표에서도 보이면 확인, 나아진 게 보이면 나아짐. 튜터는 대화할 때 이걸 읽어요."),
    h("h3", {}, "경향"), tend.length ? h("ul", { class: "memlist" }, tend.map(card)) : h("p", { class: "mut small" }, "아직 없어요. 목표를 하나 끝내면 생겨요.")));
}
/* 다시 확인(11/8 사용자 "알려준 데서 끝난 게 아니라 다시 한번 확인하는 것까지"): 예전 실습의 부족함을 겨냥한 문항을 하나씩 */
// 답을 내면 그 문항의 날짜가 뒤로 가서 목록에서 빠진다 → 결과는 답한 문항(reUi.cur)에 붙여 보여 주고, [다음]에서 목록을 새로 받는다(검토 11/8).
// 건너뛴 문항은 이번 화면에서만 뒤로 미룬다
const reUi = { all: false, result: null, answer: "", cur: null, skipped: new Set() };
async function renderRechecks() {
  const r = await api("GET", `/api/rechecks${reUi.all ? "?all=1" : ""}`);
  const list = [...r.items.filter((x) => !reUi.skipped.has(x.id)), ...r.items.filter((x) => reUi.skipped.has(x.id))];
  const cur = reUi.result && reUi.cur ? reUi.cur : list[0];
  reUi.cur = cur ?? null;
  const head = h("div", { class: "memhead" }, h("button", { class: "btn small", onclick: () => go("#/") }, "← 홈"), h("h1", {}, "다시 확인"));
  const tog = h("label", { class: "small" }, h("input", { type: "checkbox", checked: reUi.all, onchange: (e) => { reUi.all = e.target.checked; reUi.result = null; reUi.cur = null; reUi.skipped = new Set(); renderRechecks(); } }), " 날짜가 안 된 것도 보기");
  if (!cur) { view.replaceChildren(h("div", { class: "home2 memory" }, head, tog, h("p", { class: "mut" }, r.total ? "오늘 다시 확인할 것이 없어요. 날짜가 되면 여기 나와요." : "아직 다시 확인할 것이 없어요. 실습에서 목표를 끝내면 부족했던 점마다 문항이 생겨요."))); return; }
  const ta = h("textarea", { rows: 5, placeholder: "기억나는 대로 답해 보세요(모르면 모른다고 적어도 돼요)", value: reUi.answer, oninput: (e) => { reUi.answer = e.target.value; } });
  const submit = h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => {
    reUi.result = await api("POST", `/api/rechecks/${cur.runId}/${cur.id}`, { answer: reUi.answer }); renderRechecks();
  }) }, "답 내기");
  const res = reUi.result;
  const KO = { correct: "맞았어요", partial: "일부만 맞았어요", incorrect: "아직 틀려요", unclear: "판단하기 어려워요" };
  const resultBox = res ? h("div", { class: `gcard ${res.verdict === "correct" ? "plan" : ""}` },
    h("b", {}, KO[res.verdict] ?? res.verdict, res.sameMistake ? " · 예전과 같은 곳에서 헷갈렸어요" : ""), h("p", { class: "small" }, res.note),
    h("div", { class: "small" }, h("b", {}, "모범답: "), res.answer),
    h("div", { class: "mut small" }, `다음 확인: ${res.dueAt ? new Date(res.dueAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "-"} · 상태: ${res.status}`),
    h("div", { class: "grow2" }, h("button", { class: "btn small primary", onclick: () => { reUi.result = null; reUi.answer = ""; reUi.cur = null; renderRechecks(); } }, "다음"))) : null;
  view.replaceChildren(h("div", { class: "home2 memory" }, head, tog,
    h("div", { class: "mut small" }, `${res ? "방금 답한 문항" : `남은 ${list.length}개`} · ${cur.concept} · 예전 목표: ${cur.goal}${cur.tries ? ` · ${cur.tries}번째 다시 확인` : ""}${cur.status === "다시 틀림" ? " · 지난번에도 틀림" : ""}`),
    h("div", { class: "gcard" }, h("pre", { class: "gcmd", style: "white-space:pre-wrap" }, cur.q)),
    res ? resultBox : h("div", {}, ta, h("div", { class: "grow2" }, submit, h("button", { class: "btn small", onclick: () => { reUi.skipped.add(cur.id); reUi.answer = ""; reUi.cur = null; renderRechecks(); } }, "건너뛰기")))));
}
/* 세션 노트(11/8): 학습 한 번 = 제목 · 태그 · 목표마다 요약 · 배운 것 · 부족함(어디서 드러났고 · 무엇으로 채웠고 · 확인됐는지 · 다시 확인 문항) */
async function renderNote(runId) {
  const n = await api("GET", `/api/runs/${runId}/note`);
  const ST = { "열림": "bad", "채우는 중": "", "세션에서 채움": "ok", "다시 확인 맞음": "ok", "다시 틀림": "bad" };
  const gap = (x) => h("li", { class: "gnote" },
    h("div", {}, h("b", {}, x.concept || x.unit), x.type ? h("span", { class: "mut small" }, ` · ${x.type}`) : null, " ", h("span", { class: `tlchip ${ST[x.status] ?? ""}` }, x.status)),
    x.wrong ? h("div", { class: "small" }, `무엇이 부족했나: ${x.wrong}`) : null,
    h("div", { class: "mut small" }, `드러난 곳: ${x.from.join(" · ")}${x.cause.length ? ` · 고른 이유: ${x.cause.join(", ")}` : ""}`),
    x.remedy.length ? h("div", { class: "small" }, `채운 방법: ${x.remedy.join(" / ")}`) : null,
    x.fillEvidence ? h("div", { class: "small" }, `채운 근거: ${x.fillEvidence}`) : null,
    x.right ? h("div", { class: "small" }, `바로 알기: ${x.right}`) : null,
    x.code ? h("details", { class: "small" }, h("summary", {}, `틀렸던 코드 ${x.code.file} ${x.code.from}~${x.code.to}줄`), h("pre", { class: "gcode" }, x.code.code)) : null,
    x.recheck ? h("details", { class: "small" }, h("summary", {}, `다시 확인 문항${x.dueAt ? ` · ${new Date(x.dueAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}` : ""}`), h("pre", { class: "gcmd", style: "white-space:pre-wrap" }, x.recheck),
      x.checks.length ? h("ul", {}, x.checks.map((c) => h("li", {}, `${c.at.slice(5, 10)} ${c.verdict} · ${c.note}`))) : null) : null);
  view.replaceChildren(h("div", { class: "home2 memory" },
    h("div", { class: "memhead" }, h("button", { class: "btn small", onclick: () => go("#/") }, "← 홈"), h("h1", {}, "세션 노트")),
    h("h2", {}, n.title), n.tags.length ? h("div", { class: "gopts" }, n.tags.map((t) => h("span", { class: "gopt" }, t))) : null,
    h("p", { class: "small" }, `부족함 ${n.counts.all}개 · 채움 확인 ${n.counts.filled} · 아직 열림 ${n.counts.open}${n.counts.rechecked ? ` · 다시 확인까지 맞음 ${n.counts.rechecked}` : ""}`,
      " ", h("a", { href: `#/run/${runId}` }, "대화로"), " · ", h("a", { href: `#/timeline/${runId}` }, "타임라인"), n.counts.all ? [" · ", h("a", { href: "#/rechecks" }, "다시 확인")] : null),
    h("h3", {}, "부족했던 것과 그 뒤"), n.gaps.length ? h("ul", { class: "memlist" }, n.gaps.map(gap)) : h("p", { class: "mut small" }, "아직 없어요."),
    h("h3", {}, "목표마다"), n.goals.length ? h("ul", { class: "memlist" }, n.goals.map((g) => h("li", {}, h("b", {}, g.goal), h("span", { class: "mut small" }, ` · ${g.status}`), h("p", { class: "small" }, g.summary),
      g.learned.length ? h("div", { class: "small" }, "배운 것: ", g.learned.map((x) => `${x.concept}(${x.type})`).join(", ")) : null,
      h("details", { class: "small" }, h("summary", {}, "거친 과정"), h("ol", {}, g.steps.map((s) => h("li", {}, s))))))) : h("p", { class: "mut small" }, "목표를 끝내면 정리가 여기 와요.")));
}
/** 대화 열기: 튜터 창이면 VS Code 폴더도 그 대화로, VS Code 탭이면 폴더가 다를 때 폴더부터 */
function openChat(c) {
  if (FLOAT) return busy(null, async () => { await api("POST", `/api/runs/${c.runId}/editor`).catch(() => null); go(`#/run/${c.runId}`); });
  if (EMBED && c.workspace && !inThisFolder(c.workspace)) {
    switchingNote("그 대화의 작업 폴더로 가는 중이에요"); openFolder(c.workspace);
    // 11/5: VS Code가 폴더를 못 열면(확장이 거절 등) 끝없이 기다리지 않고 이 탭에서 바로 대화를 연다
    setTimeout(() => { if (location.hash !== `#/run/${c.runId}`) go(`#/run/${c.runId}`); }, 6000);
    return;
  }
  go(`#/run/${c.runId}`);
}

/* =================== 수업 (대화) =================== */
let lessonCtx = null;
let events = null;
async function renderRunOrLesson(id) {
  // 11/11 정해진 코스를 뺐다: 대화로 하는 실습만 연다(예전 코스 실습은 서버가 410)
  const run = await api("GET", `/api/runs/${id}`);
  if (EMBED && run.workspace && !inThisFolder(run.workspace)) { switchingNote("작업 폴더를 여는 중이에요"); openFolder(run.workspace); return; }
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
const TY = { shown: new Map(), full: new Map(), ws: "", raf: 0, last: 0, key: null, init: true, guard: 0 };
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
  // 창이 가려져 그림 그리기가 멈추면(튜터 창이 VS Code 뒤 · 숨은 탭) 흘리기도 멈춰 답이 안 보인다(11/9 화면 점검) → 1초 안에 안 돌면 다 보여 준다
  clearTimeout(TY.guard);
  TY.guard = setTimeout(() => {
    if (performance.now() - TY.last < 900) return;
    for (const el of document.querySelectorAll(".ty[data-mid]")) { const id = el.dataset.mid, full = TY.full.get(id) ?? ""; if ((TY.shown.get(id) ?? full.length) < full.length) { TY.shown.set(id, full.length); el.replaceChildren(rich(full, TY.ws)); } }
  }, 1000);
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
  // 한글 조합 중에 다시 그리면 조합이 깨진다: 조합이 끝나면 그린다(11/11)
  if (lessonCtx?.lesson?.free && freeUi.composing) { freeUi.redraw = true; return; }
  return drawFree();
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
  stop: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="currentColor"/></svg>',
};
const icon = (name) => { const s = h("span", { class: "ico" }); s.innerHTML = ICON[name]; return s; };
function thinkLine(run, lesson) {
  return h("div", { class: "fthink" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")),
    h("span", { class: "grow" }, lesson.asking ? "위 질문에 골라 주세요" : lesson.thinking ? lesson.thinking : "튜터가 확인하는 중이에요"),
    h("button", { class: "fchip", onclick: (e) => busy(e.target, async () => { lessonCtx.lesson = await api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "stop_chat" }); drawLesson(); }) }, "멈추기"));
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

route();

/* ---------- 프리스타일(11/4 사용자 "실험판 느낌 그대로 제품에 연결"): 걸음 없이 대화만 ----------
 * 튜터 창(FLOAT)과 튜터 탭 둘 다. VS Code에서 고른 줄 · [막혔어요] · 실습 서버 · 검사는 그대로 쓴다 */
/* 입력칸(11/11 사용자 "튜터가 얘기하는 동안 채팅창 눌러도 풀리는 문제 … 메시지 큐에 넣어서"):
 * 답이 흘러나올 때마다 화면을 다시 그려도 쓰던 글 · 커서 · 포커스를 그대로 두고,
 * 답하는 중에 보낸 말은 줄을 세웠다가 답이 끝나면 차례로 보낸다(이 화면 안에서만, 새로 고침하면 사라짐) */
const freeUi = { run: "", draft: "", sel: [0, 0], focus: false, composing: false, redraw: false, queue: [], flushing: false };
function drawFree() {
  const { run, lesson } = lessonCtx;
  if (freeUi.run !== run.id) Object.assign(freeUi, { run: run.id, draft: "", sel: [0, 0], focus: false, queue: [] });
  const old = view.querySelector(".freein textarea");
  if (old) { freeUi.focus = document.activeElement === old; freeUi.sel = [old.selectionStart, old.selectionEnd]; }
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
  if (lesson.goals?.survey && !lesson.busy) list.append(surveyCard(lesson.goals.survey, send));
  if (lesson.goals?.plan && !lesson.busy) list.append(goalPlanCard(lesson.goals.plan, send));
  if (lesson.goals?.shell && !lesson.busy) list.append(shellCard(lesson.goals.shell, send));
  if (lesson.goals && goalUi.stuck && !lesson.busy) list.append(goalStuckCard(lesson.goals, send));
  if (lesson.busy) list.append(thinkLine(run, lesson));
  if (freeUi.queue.length) list.append(h("div", { class: "fqueue" }, freeUi.queue.map((t, i) => h("div", { class: "freeme queued", title: "답이 끝나면 보내요" },
    h("span", { class: "qwait", "aria-hidden": "true" }, h("i"), h("i"), h("i")), t,
    h("button", { class: "fib", title: "보내지 않기", "aria-label": "보내지 않기", onclick: () => { freeUi.queue.splice(i, 1); drawLesson(); } }, "×")))));
  const input = h("textarea", { rows: 2, placeholder: "물어보기 (Enter 보내기, Shift+Enter 줄바꿈)", "aria-label": "튜터에게 물어보기" });
  input.value = freeUi.draft;
  input.addEventListener("input", () => { freeUi.draft = input.value; });
  input.addEventListener("compositionstart", () => { freeUi.composing = true; });
  input.addEventListener("compositionend", () => { freeUi.composing = false; freeUi.draft = input.value; if (freeUi.redraw) { freeUi.redraw = false; setTimeout(drawLesson, 0); } });
  input.addEventListener("blur", () => { if (freeUi.composing) { freeUi.composing = false; if (freeUi.redraw) { freeUi.redraw = false; setTimeout(drawLesson, 0); } } });
  const go = (e) => {
    const t = input.value.trim(); if (!t) return;
    input.value = ""; freeUi.draft = "";
    freeUi.focus = true; freeUi.sel = [0, 0];
    if (lessonCtx.lesson.busy || freeUi.flushing) { freeUi.queue.push(t); return drawLesson(); }
    sendFree(run, t);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(e); } });
  const stop = () => api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "stop_chat" }).then((l) => { lessonCtx.lesson = l; drawLesson(); }).catch((e) => toast(e.message));
  const sendBtn = h("button", { class: "fsendb", type: "button" });
  const paint = () => {
    const stopping = lesson.busy && !input.value.trim();
    sendBtn.replaceChildren(icon(stopping ? "stop" : "send"));
    sendBtn.classList.toggle("stop", stopping);
    sendBtn.disabled = !stopping && !input.value.trim();
    sendBtn.title = stopping ? "지금 답하는 걸 멈춰요" : "보내기";
    sendBtn.setAttribute("aria-label", sendBtn.title);
  };
  sendBtn.onclick = (e) => (lesson.busy && !input.value.trim() ? stop() : go(e));
  input.addEventListener("input", paint);
  paint();
  const foot = h("footer", { class: "freefoot" },
    // 도움 다이얼(11/11 사용자 "다이얼 하나 + 기록은 정직하게"): 막혔을 때 튜터가 어디까지 해 주나. 누르면 바로 바뀌고(AI 안 부름) 다음 답부터
    lesson.chat && lesson.goals ? h("div", { class: "fdial", role: "group", "aria-label": "도움 정도" }, h("span", { class: "fdial-k" }, "도움"),
      [["self", "스스로", "방향만 받아요. 코드는 내가 써요"], ["together", "같이", "틀은 받고 핵심은 내가 채워요"], ["fast", "빨리 만들기", "튜터가 바로 써 주고 설명해 줘요(받아 쓴 것으로 기록돼요)"]].map(([k, label, tip]) =>
        h("button", { class: `fdial-b ${(lesson.goals.help ?? "together") === k ? "on" : ""}`, title: tip, "aria-pressed": String((lesson.goals.help ?? "together") === k),
          onclick: (e) => { if ((lesson.goals.help ?? "together") !== k) send({ do: "goal", op: "help", help: k })(e); } }, label))) : null,
    // 11/11 사용자 "채팅창 위에 끝이 동글동글한 직사각형으로" · 11/5 사용자 "너무 쉬워 · 너무 어려워 두 개가 막혔어요보다 낫다"
    // 11/11 사용자: 목표가 정해지기 전에는 눌러도 할 일이 없어 숨긴다
    lesson.chat && lesson.goals && lesson.goals.current && !lesson.busy ? h("div", { class: "fquick" },
      // 11/7 사용자 "다음으로 넘어가는 게 기본, 새로 짜기는 고객센터 밑에 조그맣게 써 놓은 것처럼 덤으로"
      goalUi.easy && lesson.goals.current ? h("span", { class: "feasy" },
        h("button", { class: "fchip on", onclick: (e) => { goalUi.easy = false; send({ do: "goal", op: "easy_next" })(e); }, title: "이 단계는 이미 알아요. 끝남으로 두고 다음 단계로" }, lesson.goals.support && !lesson.goals.support.back ? "이 보충 넘어가기" : "다음 단계로 넘어가기"),
        h("button", { class: "fchip", onclick: () => { goalUi.easy = false; drawLesson(); } }, "취소"),
        h("button", { class: "flink", onclick: (e) => { goalUi.easy = false; send({ do: "goal", op: "easy" })(e); }, title: "이 단계를 더 어렵게 다시 짜요(남은 로드맵도 같이)" }, "그래도 안 맞으면: 더 어렵게 다시 짜기"))
      : h("button", { class: "fchip", onclick: lesson.goals.current ? () => { goalUi.easy = true; goalUi.stuck = false; drawLesson(); } : send({ do: "goal", op: "easy" }) }, "너무 쉬워요"),
      h("button", { class: `fchip warm ${goalUi.stuck ? "on" : ""}`, onclick: () => { goalUi.stuck = !goalUi.stuck; drawLesson(); } }, "너무 어려워요")) : null,
    // 11/11 사용자 "코덱스나 클로드 앱처럼": 입력칸 안 오른쪽 아래 둥근 아이콘 하나. 답하는 중 · 칸이 비면 ■ 멈추기, 글이 있으면 ↑(답하는 중이면 알아서 줄 섬)
    h("div", { class: "freein" }, input, sendBtn));
  const head = h("header", { class: "freehead" },
    // 제목은 한 줄 전체를 쓰고, 길면 … (2026-11-06 사용자 "제목한테 가로줄 하나주고 길면 ..."). 전체 제목은 마우스를 올리면 보인다.
    h("div", { class: "fhtitle", title: lesson.chat ? (lesson.goals?.long?.text ?? "새 대화") : run.course?.title ?? "프리스타일" }, h("b", {}, STUDIO && lesson.chat ? "튜터" : lesson.chat ? (lesson.goals?.current?.title ?? lesson.goals?.long?.text ?? "새 대화") : run.course?.title ?? "프리스타일"), h("span", { class: "mut small" }, lesson.chat ? ` · ${lesson.chat.engine === "codex" ? "Codex" : "기존"} 엔진${lesson.chat.focus ? ` · 초점: ${lesson.chat.focus}` : ""}${lesson.chat.support.length ? ` · 보충: ${lesson.chat.support.join(" › ")}` : ""}` : " · 프리스타일")),
    lesson.chat ? modelPick(run, lesson) : null,
    h("button", { class: "fib", title: "대화 목록", "aria-label": "대화 목록", onclick: () => go_("#/home") }, icon("home")),
    h("button", { class: "btn small", title: "새 대화", onclick: () => go_("#/home") }, "+ 새 대화"),
    lesson.chat ? h("button", { class: "btn small", title: "행동마다 상태가 어떻게 바뀌었는지 기록 보기", onclick: () => go_(`#/timeline/${run.id}`) }, "기록") : null,
    lesson.goals?.long ? h("button", { class: "btn small", title: "하던 목표를 정리하고(배운 것 · 부족했던 점 · 학습자 메모리) 앱 지식으로 넣은 뒤 끝내요", disabled: lesson.busy, onclick: () => endLearning(run) }, "학습 종료") : null,
    FLOAT ? h("button", { class: "fib", title: floatUi.size === "wide" ? "작게" : "넓게", onclick: () => { floatUi.size = floatUi.size === "wide" ? "normal" : "wide"; floatPost({ size: floatUi.size }); drawLesson(); } }, icon(floatUi.size === "wide" ? "narrow" : "wide")) : null,
    FLOAT ? h("button", { class: `fib ${floatUi.pinned ? "on" : ""}`, title: "고정", onclick: async () => { const out = await floatPost({ pinned: !floatUi.pinned }); floatUi.pinned = !!out?.pinned; drawLesson(); } }, icon("pin")) : null,
    FLOAT ? h("button", { class: "fib", title: "닫기", onclick: () => floatPost({ open: false }) }, icon("close")) : null);
  view.replaceChildren(h("div", { class: `freewrap ${FLOAT ? "fw " + floatUi.size : ""}` }, head, lesson.chat?.engine === "codex" && lesson.chat.codexLogin === false ? h("div", { class: "editask" }, h("span", { class: "grow" }, "Codex 버전은 Recaller 전용 Codex 로그인이 한 번 필요해요(평소 Codex 앱 설정 · 기억과 섞이지 않게)."), h("button", { class: "btn small primary", onclick: (e) => busy(e.target, async () => { const r = await api("POST", "/api/codex-chat/login"); toast(r.already ? "이미 로그인돼 있어요." : "브라우저에서 ChatGPT로 로그인해 주세요. 끝나면 이 화면을 새로고침해요."); }) }, "Codex 로그인")) : null, lesson.chat ? wsBar(run, lesson) : null, lesson.goals ? goalBar(lesson, send) : null, lesson.chat ? learnedBar(lesson) : null, list, lesson.chat && !lesson.chat.edit ? editAsk(run) : null, foot));
  list.scrollTop = list.scrollHeight;
  if (!FLOAT && !freeUi.focus) window.scrollTo({ top: document.body.scrollHeight });
  if (freeUi.focus) { input.focus({ preventScroll: true }); try { input.setSelectionRange(...freeUi.sel); } catch {} }
  tyAfterDraw();
  // 답이 끝났고 줄 선 말이 있으면 하나 보낸다(판정 카드 · 설문이 떠 있어도 보통 질문으로 간다)
  if (!lesson.busy && freeUi.queue.length && !freeUi.flushing) sendFree(run, freeUi.queue.shift());
}
/** 보내는 동안(서버가 아직 답하는 중으로 바뀌기 전)에 또 보내면 줄에 선다 */
function sendFree(run, t) {
  freeUi.flushing = true;
  api("POST", `/api/runs/${run.id}/lesson/${run.current}/act`, { do: "ask", text: t })
    .then((l) => { lessonCtx.lesson = l; })
    .catch(async (e) => {
      if (!/답하는 중|busy/i.test(e.message)) { freeUi.draft ||= t; return toast(e.message); }
      freeUi.queue.unshift(t); // 아직 답하는 중: 상태를 다시 받아 끝나면(다음 알림 때) 보낸다
      lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`).catch(() => ({ ...lessonCtx.lesson, busy: true }));
      if (!lessonCtx.lesson.busy) await new Promise((r) => setTimeout(r, 1500));
    })
    .finally(() => { freeUi.flushing = false; drawLesson(); });
}
const go_ = (hash) => go(hash);

/* 학습 목표(11/4 사용자 설계 "장기 목표 / 현재 목표"): 장기 · 지도 · 현재 목표(이해 · 적용 · 다음으로) · 보충, 설문 · 계획 확정 · 막혔어요 */
const goalUi = { stuck: false, easy: false, showLong: false, picks: {}, texts: {}, reasons: new Set(), stuckText: "" };
function goalBar(lesson, send) {
  const g = lesson.goals;
  if (!g.long) return g.survey || g.plan ? null : h("div", { class: "gbar mut small" }, "만들고 싶은 걸 말하면 튜터가 몇 가지 물어보고 장기 목표를 같이 정해요.");
  const op = (o, extra = {}) => send({ do: "goal", op: o, ...extra });
  const mark = { done: "✓", skipped: "↷", doing: "▶", todo: "" };
  const c = g.current, S = g.support, sp = S && !S.back ? S.steps.find((x) => x.status === "doing") : null;
  if (STUDIO) { // 제목 · 완료 조건 · 로드맵은 위 띠(마우스를 올리면 완료 조건)에. 여기는 지금 할 버튼과 새 이름만
    const t = sp ?? c;
    if (!t) return null;
    return h("div", { class: "gbar gslim" }, !sp && c.names?.length ? namesBox(c.names, send) : null,
      h("div", { class: "grow2" },
        !t.understood ? h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 직접 해 볼 과제를 내요", onclick: op("understood") }, "이해했어요 → 적용하기")
          : !t.applied ? h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 완료 조건에 맞게 했는지 판정해요. 맞으면 다음으로 가요", onclick: op("applied") }, "해 봤어요") : null,
        sp ? null : h("button", { class: `btn small ${c.understood && c.applied ? "primary" : ""}`, disabled: lesson.busy, title: c.understood && c.applied ? "" : "이해 · 적용을 다 안 해도 넘어갈 수 있어요(건너뜀으로 남아요)", onclick: op("next") }, "다음으로 →")));
  }
  // 11/6 사용자 "지금만 보이게 하고 장기 목표는 눌러서 보게": 장기 목표 · 로드맵은 접어 두고 한 줄 버튼으로 연다
  const prog = g.progress.total ? `${g.progress.done}/${g.progress.total}` : `해 본 것 ${g.progress.done}개`;
  const fold = h("button", { class: "gfold", "aria-expanded": String(goalUi.showLong), onclick: () => { goalUi.showLong = !goalUi.showLong; drawLesson(); } },
    `${goalUi.showLong ? "▾" : "▸"} 장기 목표 · ${S ? "원래 로드맵(잠시 보관)" : "로드맵"} (${prog})`);
  return h("div", { class: "gbar" }, fold,
    goalUi.showLong ? h("div", { class: "glong" }, h("span", { class: "gk" }, "장기"), h("b", { title: g.long.spec || "" }, g.long.text),
      h("button", { class: "gmode", disabled: lesson.busy, title: "진행 방식 바꾸기", onclick: op("mode", { mode: g.mode === "topdown" ? "bottomup" : "topdown" }) }, g.mode === "topdown" ? "탑다운" : "바텀업"),
      h("span", { class: "mut small" }, prog)) : null,
    goalUi.showLong && g.map.length ? h("div", { class: `gmap ${S ? "kept" : ""}` }, g.map.map((m, i) => h("span", { class: `gstep ${m.status}` }, `${i + 1}${mark[m.status] ? " " + mark[m.status] : ""} ${m.title}`))) : null,
    // 보충 로드맵(11/7 사용자 "원래 로드맵은 보관해 숨기고, 맨 마지막 종착지를 A로 놓고 보충 시작"): 보충 단계들 → 🎯 막힌 단계
    S ? h("div", { class: "gmap sup" }, h("span", { class: "gk warm" }, `보충 로드맵${S.round > 1 ? ` (${S.round}번째)` : ""}`),
      S.steps.map((x) => h("span", { class: `gstep ${x.status} sup` }, `${mark[x.status] ? mark[x.status] + " " : ""}${x.title}`)),
      h("span", { class: `gstep goal ${S.back ? "doing" : ""}` }, `🎯 ${S.target.title}`)) : null,
    sp ? h("div", { class: "gcur sup" }, h("div", {}, h("span", { class: "gk warm" }, "보충"), h("b", {}, sp.title)),
      h("div", { class: "mut small" }, `완료 조건: ${sp.done} · 막힌 이유: ${S.why}`),
      // 11/8 사용자 "보충 단계도 현재 단계랑 똑같이 이해와 적용"
      h("div", { class: "gsteps" }, h("span", { class: `gph ${sp.understood ? "done" : "now"}` }, sp.understood ? "① 이해 ✓" : "① 이해"), h("span", { class: "mut" }, "→"), h("span", { class: `gph ${sp.applied ? "done" : sp.understood ? "now" : ""}` }, "② 적용")),
      h("div", { class: "grow2" },
        !sp.understood ? h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 직접 해 볼 과제를 내요", onclick: op("understood") }, "이해했어요 → 적용하기")
          : h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 완료 조건에 맞게 했는지 판정해요. 맞으면 다음으로 가요", onclick: op("applied") }, "해 봤어요"),
        h("span", { class: "mut small" }, S.steps.some((x) => x.status === "todo") ? "끝나면 다음 보충" : `끝나면 "${S.target.title}"로 돌아가요`))) : null,
    c ? h("div", { class: `gcur ${sp ? "paused" : ""}` }, h("div", {}, h("span", { class: "gk" }, sp ? "종착지(막힌 단계)" : S?.back ? "보충 마치고 돌아옴" : "지금"), h("b", {}, c.title)),
      h("div", { class: "mut small" }, `완료 조건: ${c.done}`),
      c.names?.length ? namesBox(c.names, send) : null,
      // 11/5 사용자 "목표마다 이해 → 적용 흐름": 지금 단계 표시 + 그 단계 버튼 하나 + 다음으로(언제든)
      sp ? null : h("div", { class: "gsteps" },
        h("span", { class: `gph ${c.understood ? "done" : "now"}` }, c.understood ? "① 이해 ✓" : "① 이해"),
        h("span", { class: "mut" }, "→"),
        h("span", { class: `gph ${c.applied ? "done" : c.understood ? "now" : ""}` }, c.applied ? "② 적용 ✓" : "② 적용")),
      sp ? null : h("div", { class: "grow2" },
        !c.understood ? h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 직접 해 볼 과제를 내요", onclick: op("understood") }, "이해했어요 → 적용하기") : null,
        c.understood && !c.applied ? h("button", { class: "btn small primary", disabled: lesson.busy, title: "튜터가 완료 조건에 맞게 했는지 판정해요(채팅 답 · 저장한 코드). 맞으면 적용 ✓", onclick: op("applied") }, "해 봤어요") : null,
        h("button", { class: `btn small ${c.understood && c.applied ? "primary" : ""}`, disabled: lesson.busy, title: c.understood && c.applied ? "" : "이해 · 적용을 다 안 해도 넘어갈 수 있어요(건너뜀으로 남아요)", onclick: op("next") }, "다음으로 →"))) : null);
}
// 새로 쓰는 이름(11/11 사용자 "문법 같이 생각하기 힘든 거는 그냥 알려 주는 게"): 과제 아래 접는 칸. 처음인 이름은 펼친 채(코드가 기록으로 정함),
// 접힌 걸 펼치면 "봤음"으로 남는다(AI 안 부름)
const namesUi = { open: {} };
function namesBox(names, send) {
  const openNow = (n) => namesUi.open[n.name] ?? n.open;
  const anyOpen = names.some(openNow);
  const toggle = (e) => {
    const to = !anyOpen;
    for (const n of names) namesUi.open[n.name] = to;
    const fresh = to ? names.filter((n) => !n.seen).map((n) => n.name) : [];
    if (fresh.length) send({ do: "goal", op: "names_seen", names: fresh })(e); else drawLesson();
  };
  return h("div", { class: "gnames" },
    h("button", { class: "gnames-h", "aria-expanded": String(anyOpen), onclick: toggle }, `${anyOpen ? "▾" : "▸"} 이 과제에 쓰는 새 이름 ${names.length}개${anyOpen ? "" : " (눌러서 보기)"}`),
    anyOpen ? h("ul", { class: "gnames-l" }, names.map((n) => h("li", {}, h("code", {}, n.name), h("span", { class: "mut small" }, ` ${n.what}`), n.example ? h("div", {}, h("code", { class: "gnames-ex" }, n.example)) : null))) : null);
}
function surveyCard(sv, send) {
  const picks = (goalUi.picks[sv.id] ??= sv.questions.map(() => new Set()));
  const texts = (goalUi.texts[sv.id] ??= sv.questions.map(() => ""));
  return h("div", { class: "gcard" }, sv.intro ? h("p", {}, sv.intro) : null,
    sv.questions.map((q, i) => h("div", { class: "gq" }, h("div", { class: "gqq" }, `${i + 1}. ${q.q}`, q.multi ? h("span", { class: "mut small" }, " (여러 개)") : null),
      h("div", { class: "gopts" }, q.options.map((o) => h("button", { class: `gopt ${picks[i].has(o) ? "on" : ""}`, onclick: () => { if (!q.multi) picks[i].clear(); picks[i].has(o) ? picks[i].delete(o) : picks[i].add(o); drawLesson(); } }, o))),
      h("input", { class: "gin", placeholder: "덧붙일 말(없으면 비워 둬요)", value: texts[i], oninput: (e) => { texts[i] = e.target.value; } }))),
    h("div", { class: "grow2" }, h("button", { class: "btn small primary", onclick: (e) => send({ do: "goal", op: "answer", answers: sv.questions.map((_, i) => ({ picks: [...picks[i]], text: texts[i] })) })(e) }, "보내기"),
      h("span", { class: "mut small" }, "고르지 않은 질문은 \"알아서\"로 보내요")));
}
// 튜터가 돌리려는 명령(11/8 결정 8): 설치 · git 기록 바꾸기 · 지우기 · 작업 폴더 밖은 학습자가 고른다
function shellCard(p, send) {
  return h("div", { class: "gcard" }, h("div", { class: "gk" }, "튜터가 이 명령을 돌리려고 해요"),
    h("pre", { class: "gcmd" }, p.command),
    p.why ? h("p", { class: "small" }, p.why) : null,
    h("p", { class: "small mut" }, `먼저 묻는 이유: ${p.reason}`),
    h("div", { class: "grow2" }, h("button", { class: "btn small primary", onclick: send({ do: "goal", op: "cmd", id: p.id, ok: true }) }, "실행"),
      h("button", { class: "btn small", onclick: send({ do: "goal", op: "cmd", id: p.id, ok: false }) }, "안 함"),
      h("span", { class: "mut small" }, "직접 쳐 보고 싶으면 [안 함]을 누르고 VS Code 터미널에서 쳐 보세요")));
}
function goalPlanCard(p, send) {
  return h("div", { class: "gcard plan" }, h("div", { class: "gk" }, "장기 목표 제안"), h("h3", {}, p.long), p.spec ? h("p", { class: "small" }, p.spec) : null,
    h("div", { class: "small" }, h("b", {}, "진행 방식: "), p.mode === "topdown" ? "탑다운 — 구조부터 보고, 지도를 따라" : "바텀업 — 작은 것 하나부터 넓혀 가기"),
    p.map.length ? h("ol", { class: "small" }, p.map.map((t) => h("li", {}, t))) : null,
    h("div", { class: "small" }, h("b", {}, "첫 목표: "), p.first.title, h("span", { class: "mut" }, ` — 완료 조건: ${p.first.done}`)),
    // 먼저 알 것 지도(11/10 사용자 "장기목표 잡으면서 선행개념이랑 의존성을 다 정리해"): 아래 것부터, ← 는 그 전에 알아야 할 것
    h("div", { class: "grow2" }, h("button", { class: "btn small primary", onclick: send({ do: "goal", op: "confirm" }) }, "확정"), h("button", { class: "btn small", onclick: send({ do: "goal", op: "dismiss_plan" }) }, "다시 얘기하기")));
}
function goalStuckCard(g, send) {
  return h("div", { class: "gcard" }, h("div", { class: "gqq" }, "어디가 어려워요? 해당하는 걸 골라 주세요(여러 개 · 안 골라도 돼요). 여기 없으면 아래에 적어 주세요"),
    h("div", { class: "gopts col" }, g.stuckReasons.map((r) => h("button", { class: `gopt ${goalUi.reasons.has(r) ? "on" : ""}`, onclick: () => { goalUi.reasons.has(r) ? goalUi.reasons.delete(r) : goalUi.reasons.add(r); drawLesson(); } }, r))),
    h("input", { class: "gin", placeholder: "적어도 되고 안 적어도 돼요(예: cache(1)이 왜 안 되는지)", value: goalUi.stuckText, oninput: (e) => { goalUi.stuckText = e.target.value; } }),
    h("div", { class: "grow2" }, h("button", { class: "btn small primary", onclick: (e) => { const reasons = [...goalUi.reasons], text = goalUi.stuckText; goalUi.stuck = false; goalUi.reasons = new Set(); goalUi.stuckText = ""; send({ do: "goal", op: "hard", reasons, text })(e); } }, "보충 로드맵 짜기"),
      h("button", { class: "btn small", onclick: () => { goalUi.stuck = false; drawLesson(); } }, "취소")));
}

/* 배운 것(11/4 사용자 "배운 거 갱신"): 질문이 끝날 때마다 대화에서 뽑은 사건. 근거는 학습자 말 그대로 */
const KIND_KO = { asked: "물어봄", confused: "헷갈림", misconception: "틀리게 앎", explained: "자기 말로 설명", applied: "직접 써 봄" };
const learnedUi = { open: false };
function learnedBar(lesson) {
  if (lesson.records) return recordsBar(lesson);
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

/* 목표 정리(11/5 사용자 "목표가 끝나면 쭉 대화 기록 받아서 정리, 학습자가 어떤 절차를 거쳐서 뭘 배웠는지") */
const recUi = { tab: "개념" };
const REC_TABS = ["개념", "원리", "절차", "규칙", "방법", "비교"];
function recordsBar(lesson) {
  const rs = lesson.records || [];
  if (!rs.length) return null;
  // 11/5 사용자 "개념/원리/절차/규칙/방법/비교 탭": 끝낸 목표들에서 배운 것을 칸별로, 그 밑에 목표별 과정
  const all = rs.flatMap((r) => (r.learned || []).map((x) => ({ ...x, goal: r.goal })));
  // 11/6 사용자 "부족한 점을 캐치해서 지식으로": 목표 정리의 부족한 점은 맨 위에 따로
  const gaps = rs.flatMap((r) => (r.gaps || []).map((x) => ({ ...x, goal: r.goal })));
  const head = h("button", { class: "lhead", onclick: () => { learnedUi.open = !learnedUi.open; drawLesson(); } }, `배운 것 ${all.length}개 · 부족했던 점 ${gaps.length}개 · 끝낸 목표 ${rs.length}개`, h("span", { class: "mut small" }, learnedUi.open ? " 접기" : " 펼치기"));
  if (!learnedUi.open) return h("div", { class: "learned" }, head);
  const count = (t) => all.filter((x) => (x.type || "개념") === t).length;
  const tabs = h("div", { class: "rtabs" }, REC_TABS.map((t) => h("button", { class: `rtab ${recUi.tab === t ? "on" : ""}`, onclick: () => { recUi.tab = t; drawLesson(); } }, `${t} ${count(t)}`)));
  const items = all.filter((x) => (x.type || "개념") === recUi.tab);
  const gapList = gaps.length ? h("div", { class: "gaps" }, h("div", { class: "small" }, h("b", {}, "부족했던 점")), h("ul", {}, gaps.map((x) => h("li", {},
    h("b", {}, x.concept), h("span", { class: "mut small" }, ` · ${x.type}`),
    x.wrong ? h("div", { class: "small" }, `헷갈린 것: ${x.wrong}`) : null,
    x.right ? h("div", { class: "small" }, `바로 알기: ${x.right}`) : null,
    x.code ? h("details", { class: "small" }, h("summary", {}, `틀렸던 코드 ${x.code.file} ${x.code.from}~${x.code.to}줄`), h("pre", { class: "gcode" }, x.code.code)) : null,
    h("div", { class: "mut small" }, `목표: ${x.goal}${x.quote ? ` · "${x.quote}"` : ""}`))))) : null;
  // 학습자 메모리에 반영한 것(11/6) → 자세히는 학습자 메모리 화면
  const memN = rs.reduce((n, r) => n + (r.memory?.done?.length ?? 0), 0);
  const obsList = memN ? h("div", { class: "small mut" }, `학습자 메모리에 ${memN}번 반영 `, h("a", { href: "#/memory" }, "보기")) : null;
  const noteLink = h("div", { class: "small" }, h("a", { href: `#/note/${lessonCtx.run?.id ?? ""}` }, "세션 노트 보기"), h("span", { class: "mut" }, " — 부족했던 것마다 채웠는지 · 다시 확인 문항"));
  return h("div", { class: "learned" }, head, noteLink, obsList, gapList, tabs,
    items.length ? h("ul", {}, items.map((x) => h("li", {}, h("b", {}, x.concept), h("span", { class: "mut small" }, ` · ${x.how}`),
      x.meaning ? h("div", { class: "small" }, x.meaning) : null,
      h("div", { class: "mut small" }, `목표: ${x.goal}${x.quote ? ` · "${x.quote}"` : ""}`)))) : h("p", { class: "mut small" }, "이 칸에는 아직 없어요."),
    h("details", { class: "small" }, h("summary", {}, "목표별 과정"), h("ul", {}, [...rs].reverse().map((r) => h("li", {},
      h("b", {}, r.goal), h("span", { class: `lk ${r.status === "마침" ? "applied" : ""}` }, r.status),
      r.summary ? h("div", {}, r.summary) : null,
      r.steps?.length ? h("div", { class: "mut" }, "과정: ", r.steps.join(" → ")) : null)))));
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
    // 앱 안 편집기(11/11): 왼쪽 편집기 · 오른쪽 튜터 한 화면. 그 화면 안(?embed)에서는 안 보인다
    EMBED ? null : h("a", { class: "btn small", href: `/studio.html?run=${run.id}`, title: "VS Code와 같은 편집기를 이 화면 왼쪽에 띄우고 튜터는 오른쪽에(내 VS Code 설정과는 따로)" }, "앱 안에서 편집"),
    h("label", { class: "small edittog", title: "VS Code에서 저장(Ctrl+S)하면 튜터가 그 파일을 확인해요" }, h("input", { type: "checkbox", checked: lesson.autoCheck !== false, onchange: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/auto-check`, { on: e.target.checked }); toast(e.target.checked ? "저장하면 튜터가 확인해요." : "저장해도 튜터가 확인하지 않아요."); }) }), " 저장하면 확인"),
    lesson.chat.edit ? h("label", { class: "small edittog", title: "튜터가 이 폴더의 파일을 고칠 수 있는지" }, h("input", { type: "checkbox", checked: lesson.chat.edit === "allow", disabled: lesson.busy, onchange: (e) => chatOpt(run, { edit: e.target.checked ? "allow" : "deny" }) }), " 튜터가 고치기") : null);
}
