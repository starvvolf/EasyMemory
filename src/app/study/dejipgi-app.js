/* 되짚기 화면(협업/되짚기/되짚기_최신_v9.html)을 Recaller에 옮긴 것.
   화면·흐름·기록 규칙은 원본을 따르고, 문제 생성은 하지 않는다. 문제는 Recaller 출제 문서를 env.loadDecks()로 받는다.
   env: see dejipgi-app.d.ts. env.builder (objective design, authoring, save) and env.ask are left unset on purpose. */
let signInOutcome = null;
export function mountDejipgi(root, env){
"use strict";
const listeners = new AbortController();
let disposed = false;
const on = (target, type, fn, opts) => target.addEventListener(type, fn, { ...opts, signal:listeners.signal });
/* ---------- tiny DOM helper (model text always goes through textContent) ---------- */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const [k,v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.setAttribute("style", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()){
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const now = () => Date.now();
const MIN = 60e3, DAY = 864e5;
const INTERVALS = [10*MIN, 1*DAY, 3*DAY, 7*DAY, 16*DAY, 35*DAY];

/* ---------- answer normalization (one place, used for grading and validation) ---------- */
function norm(s){
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[−‐-―]/g, "-")
    .replace(/[’‘´`']/g, "′")
    .replace(/\^\{-1\}|\^-1|⁻¹/g, "^-1")
    .replace(/[·*]/g, "")
    .replace(/\s+/g, "")
    .replace(/[;、]/g, ",")
    .replace(/(^|,|\()\+/g, "$1")
    .replace(/(°|도)(?=$|,|\))/g, "")
    .replace(/(이다|입니다|다)\.?$/, "")
    .replace(/\.$/, "")
    .toLocaleLowerCase("ko-KR");
}
function looseText(s){ return String(s ?? "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR"); }

/* ---------- example deck (original notes, shown only when no Recaller document is available) ---------- */
function exampleDeck(){
  const pages = [
    { n:1, text:"평행이동. 점 (x, y)에 이동량 (tx, ty)를 더하면 새 점은 (x+tx, y+ty)이다. 동차좌표로 쓰면 3×3 행렬의 마지막 열 위 두 칸에 tx와 ty가 놓이고 나머지는 단위행렬과 같다. 역변환은 이동량의 부호를 바꾼 T(-tx, -ty)이다." },
    { n:2, text:"회전. 원점을 기준으로 양의 각 θ만큼 돌리면 반시계 방향으로 회전한다. 좌표식은 x′ = x cosθ − y sinθ, y′ = x sinθ + y cosθ 이다. 90도 회전이면 (x, y)는 (−y, x)가 된다. 원점이 아닌 점 (a, b)를 중심으로 돌릴 때는 먼저 중심점이 원점에 오도록 평행이동하고, 원점 기준으로 회전한 뒤, 처음 이동을 되돌린다. 행렬로는 T(a, b)·R(θ)·T(−a, −b)이다." },
    { n:3, text:"스케일과 합성. 스케일 S(sx, sy)는 x에 sx, y에 sy를 곱한다. 역변환은 S(1/sx, 1/sy)이며 sx, sy가 0이 아니어야 한다. 여러 변환을 합칠 때 행렬 곱은 결합법칙이 성립하지만 교환법칙은 일반적으로 성립하지 않는다. 점을 열벡터로 쓰면 M = A·B·C에서 가장 오른쪽 C가 먼저 적용된다." }
  ];
  const O = (id, statement, kind, pg, quote) => ({ id, statement, kind, importance:"core", pages:[pg], quote });
  const objectives = [
    O("o1","점과 이동량으로 평행이동한 좌표를 계산할 수 있다","formula",1,"점 (x, y)에 이동량 (tx, ty)를 더하면 새 점은 (x+tx, y+ty)이다"),
    O("o2","동차좌표 이동 행렬에서 이동량의 위치를 말할 수 있다","fact",1,"3×3 행렬의 마지막 열 위 두 칸에 tx와 ty가 놓이고"),
    O("o3","원점 기준 90도 회전 결과를 계산할 수 있다","formula",2,"90도 회전이면 (x, y)는 (−y, x)가 된다"),
    O("o4","회전 좌표식을 기억해서 쓸 수 있다","formula",2,"x′ = x cosθ − y sinθ, y′ = x sinθ + y cosθ"),
    O("o5","임의의 점을 중심으로 한 회전 절차를 순서대로 말할 수 있다","procedure",2,"먼저 중심점이 원점에 오도록 평행이동하고, 원점 기준으로 회전한 뒤, 처음 이동을 되돌린다"),
    O("o6","스케일의 역변환 인수를 구할 수 있다","formula",3,"역변환은 S(1/sx, 1/sy)이며 sx, sy가 0이 아니어야 한다"),
    O("o7","행렬 곱의 결합법칙과 교환법칙 성립 여부를 구별할 수 있다","concept",3,"행렬 곱은 결합법칙이 성립하지만 교환법칙은 일반적으로 성립하지 않는다"),
    O("o8","열벡터 방식에서 합성 변환의 적용 순서를 판단할 수 있다","concept",3,"가장 오른쪽 C가 먼저 적용된다")
  ];
  const I = (objectiveId, format, prompt, extra, explanation) => {
    const o = objectives.find(x => x.id === objectiveId);
    return { id:"ex-"+objectiveId, objectiveId, format, prompt, ...extra, explanation, page:o.pages[0], quote:o.quote, quoteVerified:true, checks:[] };
  };
  const items = [
    I("o1","value","점 (3, −2)를 이동량 (−1, 5)만큼 평행이동하면 새 좌표는?",{ accepted:["(2,3)"] },"x는 3+(−1)=2, y는 −2+5=3이다."),
    I("o2","choice","동차좌표 3×3 평행이동 행렬에서 tx, ty가 놓이는 자리는?",{ options:["마지막 열의 위 두 칸","마지막 행의 앞 두 칸","주대각선의 위 두 칸","첫째 열의 아래 두 칸"], answer:0 },"점을 열벡터로 곱하면 마지막 열의 값이 x, y에 더해진다."),
    I("o3","value","점 (0, 4)를 원점 기준 양의 방향으로 90도 회전하면 새 좌표는?",{ accepted:["(-4,0)"] },"(x, y)가 (−y, x)가 되므로 (0, 4)는 (−4, 0)이 된다."),
    I("o4","card","원점 기준으로 θ만큼 회전할 때 x′와 y′의 좌표식을 쓰세요.",{ answer:"x′ = x cosθ − y sinθ\ny′ = x sinθ + y cosθ" },"x′에는 −y sinθ, y′에는 +x sinθ가 붙는 부호에 주의한다."),
    I("o5","order","점 (a, b)를 중심으로 θ만큼 회전하는 절차를 순서대로 고르세요.",{ steps:["중심점이 원점에 오도록 평행이동","원점 기준으로 θ만큼 회전","처음 평행이동을 되돌리기"] },"회전은 원점 기준으로만 정의되므로 중심을 원점으로 옮겼다가 되돌린다."),
    I("o6","value","스케일 S(2, 4)를 되돌리는 역변환의 스케일 인수 (sx, sy)는?",{ accepted:["(1/2,1/4)","(0.5,0.25)","s(1/2,1/4)"] },"각 축의 배율을 역수로 바꾼다."),
    I("o7","choice","변환 행렬의 곱셈에 대해 옳은 설명은?",{ options:["결합법칙은 성립하고 교환법칙은 일반적으로 불성립","교환법칙은 성립하고 결합법칙은 일반적으로 불성립","결합법칙과 교환법칙이 모두 일반적으로 성립","결합법칙과 교환법칙이 모두 일반적으로 불성립"], answer:0 },"괄호 위치는 바꿔도 되지만 곱하는 순서는 바꾸면 결과가 달라질 수 있다."),
    I("o8","choice","점을 열벡터로 쓸 때 M = A·B·C를 적용하면 실제로 변환이 적용되는 순서는?",{ options:["C → B → A","A → B → C","B → A → C","A → C → B"], answer:0 },"열벡터 p에 대해 M p = A(B(C p))이므로 C가 가장 먼저다.")
  ];
  return { id:"example", title:"2D 기하 변환 (예시)", sourceName:"예시 요약 노트 · 3쪽", example:true, createdAt:0, pages, objectives, items, events:[], sched:{} };
}

/* ---------- store: per-user progress in this browser; deck content always comes from Recaller ---------- */
const Store = {
  mode:"memory", key:"",
  init(){
    this.key = "recaller:study:v1:" + (env.uid || "local");
    try{ localStorage.setItem("dejipgi.probe","1"); localStorage.removeItem("dejipgi.probe"); this.mode = "local"; }catch(e){ this.mode = "memory"; }
  },
  // a changed document gets a fresh record; the old one stays under its own hash
  pkey(deck){ return deck.id + "@" + (deck.artifactSha256 || "example"); },
  all(){ if (this.mode !== "local") return {}; try{ return JSON.parse(localStorage.getItem(this.key) || "{}"); }catch(e){ return {}; } },
  restore(deck){
    const saved = this.all()[this.pkey(deck)] || {};
    deck.allItems = deck.allItems || deck.items;
    const ids = new Set(deck.allItems.map(i => i.id));
    deck.events = Array.isArray(saved.events) ? saved.events.filter(e => ids.has(e.item)) : [];
    deck.sched = {};
    if (saved.sched) for (const [id, s] of Object.entries(saved.sched)) if (ids.has(id)) deck.sched[id] = s;
    deck.hidden = Array.isArray(saved.hidden) ? saved.hidden : [];
    deck.reported = saved.reported && typeof saved.reported === "object" ? saved.reported : {};
    deck.lastPage = Number(saved.lastPage) || 0;
    applyFilters(deck);
  },
  save(deck){
    if (this.mode !== "local") return;
    try{
      const all = this.all();
      all[this.pkey(deck)] = { events:deck.events.slice(-800), sched:deck.sched, hidden:deck.hidden || [], reported:deck.reported || {}, lastPage:deck.lastPage || 0, savedAt:now() };
      localStorage.setItem(this.key, JSON.stringify(all));
    }catch(e){ toast("기록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요."); }
  },
  pendingList(){ if (this.mode !== "local") return []; try{ const v = JSON.parse(localStorage.getItem(this.key + ":pending") || "[]"); return Array.isArray(v) ? v : []; }catch(e){ return []; } },
  savePending(list){ if (this.mode !== "local") return; try{ localStorage.setItem(this.key + ":pending", JSON.stringify(list)); }catch(e){} }
};
// Objectives the learner took out and questions they reported stay in the document but leave practice and review.
function applyFilters(deck){
  const hidden = new Set(deck.hidden || []);
  deck.items = (deck.allItems || deck.items).filter(it => !hidden.has(it.objectiveId) && !(deck.reported && deck.reported[it.id]));
}

/* ---------- question window answers: not connected yet (a paid call; wired only after the user approves) ---------- */
const ask = typeof env.ask === "function" ? env.ask : null;
function sampleErrorCopy(e){
  const c = e && e.code;
  if (c === "rate_limited") return "지금은 요청이 많거나 사용량 한도에 닿았어요. 잠시 뒤 다시 물어봐 주세요.";
  if (c === "cancelled") return "답변을 멈췄어요.";
  return "답변 중 연결이 끊겼어요. 다시 물어봐 주세요.";
}
/* ---------- app state ---------- */
const S = {
  view:"practice",
  decks:{},
  session:null,
  recordsDeck:null,
  deleting:null,
  reader:{ deckId:null, page:1, active:null, zoom:false, attachErr:"", attachBusy:false },
  pdf:{},
  lib:{ status:"loading", error:"" },
  builder:freshBuilder(),
  account:null
};

/* ---------- scheduling & status ---------- */
function schedOf(deck, itemId){ return deck.sched[itemId] || (deck.sched[itemId] = { box:0, due:0, seen:false }); }
function isDue(deck, item, t = now()){ const s = deck.sched[item.id]; return !!(s && s.seen && s.due <= t); }
function isNew(deck, item){ const s = deck.sched[item.id]; return !s || !s.seen; }
function applyOutcome(deck, item, outcome){
  // outcome: "correct" | "wrong" | "unsure" | "assisted"
  const s = schedOf(deck, item.id); const t = now(); s.seen = true;
  if (outcome === "correct"){ s.box = Math.min(s.box + 1, INTERVALS.length - 1); s.due = t + INTERVALS[s.box]; s.lastIndep = t; }
  else if (outcome === "unsure"){ s.due = t + DAY; }
  else if (outcome === "wrong"){ s.box = 0; s.due = t + 10*MIN; }
  else if (outcome === "assisted"){ s.due = t + 10*MIN; }
}
function itemStatus(deck, item){
  const evs = deck.events.filter(e => e.item === item.id);
  if (!evs.length) return "new";
  const indep = evs.filter(e => (e.kind === "submit" || e.kind === "rate") && !e.assisted && !e.afterReading);
  const s = deck.sched[item.id] || {};
  if (!indep.length) return evs.some(e => e.afterReading) ? "readcheck" : "assisted";
  const last = indep[indep.length - 1];
  const lastOk = last.kind === "submit" ? last.correct === true : last.rating === "remembered";
  if (!lastOk || (s.due && s.due <= now())) return "review";
  const days = new Set(indep.filter(e => e.kind === "submit" ? e.correct : e.rating === "remembered").map(e => new Date(e.t).toDateString()));
  return days.size >= 3 ? "steady" : "recent";
}
const STATUS = {
  new:{ label:"안 풀어봄", cls:"" },
  assisted:{ label:"정답 보고 풂", cls:"help" },
  readcheck:{ label:"읽은 직후만 풂", cls:"read" },
  review:{ label:"복습 필요", cls:"bad" },
  recent:{ label:"최근 혼자 맞힘", cls:"good" },
  steady:{ label:"3일 이상 혼자 맞힘", cls:"good" }
};

/* ---------- views ---------- */
function setView(v){
  S.view = v;
  if (v !== "read" && Chat.isOpen() && typeof Chat !== "undefined"){ if (Chat.ctl) Chat.ctl.abort(); Chat.el.hidden = true; }
  root.dataset.view = v;
  if (v === "create") loadAccount();
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v ? "true" : "false"));
  render();
}
on(document.getElementById("tabs"), "click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  if (S.session && b.dataset.view !== "practice" && b.dataset.view !== "read") S.session = null;
  setView(b.dataset.view);
});
function render(){
  const app = document.getElementById("app");
  app.replaceChildren();
  if (S.view === "practice") app.append(S.session ? renderSession() : renderHome());
  else if (S.view === "create") app.append(renderBuilder());
  else if (S.view === "read") { app.append(renderReader()); requestAnimationFrame(drawPage); if (Chat.isOpen()) Chat.paint(); }
  else app.append(renderRecords());
  if (S.view === "practice" && S.session){
    const f = app.querySelector("[data-autofocus]");
    if (f && !f.disabled && (document.activeElement === document.body || !app.contains(document.activeElement))) f.focus({ preventScroll:true });
  }
}
function updateStoreChip(){
  const chip = document.getElementById("store");
  chip.dataset.mode = Store.mode;
  document.getElementById("storeText").textContent = Store.mode === "local" ? "이 브라우저에만 저장" : "저장 안 됨 · 새로고침하면 사라짐";
}
let toastTimer;
function toast(msg){
  let el = document.getElementById("toast");
  if (!el){ el = h("div", { id:"toast", role:"status", style:"position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));background:var(--ink);color:var(--surface);padding:10px 16px;border-radius:10px;font-size:13.5px;max-width:calc(100% - 32px);z-index:9;box-shadow:var(--shadow)" }); root.append(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

/* ----- home ----- */
function deckCounts(deck){
  const c = { due:0, fresh:0, good:0, review:0, help:0, read:0, total:deck.items.length };
  const t = now();
  for (const it of deck.items){
    if (isNew(deck, it)) c.fresh++; else if (isDue(deck, it, t)) c.due++;
    const st = itemStatus(deck, it);
    if (st === "recent" || st === "steady") c.good++; else if (st === "review") c.review++; else if (st === "assisted") c.help++; else if (st === "readcheck") c.read++;
  }
  return c;
}
function renderHome(){
  const all = Object.values(S.decks).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt);
  const pendings = all.filter(d => d.pending);
  const decks = all.filter(d => !d.pending);
  let due = 0, fresh = 0;
  decks.forEach(d => { const c = deckCounts(d); due += c.due; fresh += Math.min(c.fresh, 10); });
  const wrap = h("div", { class:"stack" });
  wrap.append(h("section", { class:"panel today" },
    h("div", null,
      h("p", { class:"eyebrow", text:"오늘" }),
      h("h2", { text: due ? "복습할 문제가 기다리고 있어요" : fresh ? "새 문제로 시작해 볼까요" : pendings.length ? "문제를 만드는 동안 먼저 읽어 두세요" : decks.length ? "오늘 할 문제를 모두 마쳤어요" : "새 자료로 시작해 볼까요" }),
      h("div", { class:"counts" },
        h("div", null, h("b", { class:"num", text:String(due) }), h("span", { text:"복습 차례" })),
        h("div", null, h("b", { class:"num", text:String(fresh) }), h("span", { text:"새 문제 (자료당 최대 10)" }))
      )
    ),
    h("div", { class:"row" },
      h("button", { class:"btn primary", disabled: !(due || fresh), onclick: () => startSession(null) }, "전체 연습 시작"),
      h("button", { class:"btn", onclick: () => setView("create") }, "+ 새 자료")
    )
  ));
  for (const d of pendings){
    wrap.append(h("article", { class:"deck" },
      h("div", null, h("h3", { text:d.title }), h("div", { class:"meta" }, h("span", { text:d.sourceName }), h("span", { class:`chip ${d.pending.status === "failed" ? "bad" : "acc"}`, text:PENDING_LABEL[d.pending.status] || "준비 중" }))),
      h("div", { class:"row" }, h("button", { class:"btn small primary", onclick: () => openReader(d.id, d.lastPage || d.pending.from || 1) }, d.lastPage ? `이어 읽기 p.${d.lastPage}` : "읽기")),
      h("div", { style:"grid-column:1/-1" }, pendingNote(d))));
  }
  wrap.append(h("div", { class:"legend" },
    h("span", { style:"--c:var(--good)", text:"혼자 맞힘" }),
    h("span", { style:"--c:var(--bad)", text:"복습 필요" }),
    h("span", { style:"--c:var(--help)", text:"정답 보고 풂" }),
    h("span", { style:"--c:var(--read)", text:"읽은 직후만 풂" }),
    h("span", { style:"--c:var(--line)", text:"안 풀어봄" })
  ));
  const list = h("div", { class:"decks" });
  for (const d of decks){
    const c = deckCounts(d);
    const pct = (n) => (c.total ? (n / c.total * 100) : 0) + "%";
    list.append(h("article", { class:"deck" },
      h("div", null,
        h("h3", { text:d.title }),
        h("div", { class:"meta" },
          h("span", { text:d.sourceName }),
          h("span", { class:"num", text:`목표 ${d.objectives.length} · 문제 ${d.items.length}` }),
          c.due ? h("span", { class:"chip bad num", text:`복습 ${c.due}` }) : null,
          c.fresh ? h("span", { class:"chip num", text:`새 문제 ${c.fresh}` }) : null,
          d.skipped && d.skipped.length ? h("span", { class:"chip help num", title:d.skipped.map(x => `${x.questionId}: ${x.reason}`).join("\n"), text:`빠진 문항 ${d.skipped.length}` }) : null
        )
      ),
      h("div", { class:"row" },
        h("button", { class:"btn small", onclick: () => { S.recordsDeck = d.id; setView("records"); } }, "기록"),
        h("button", { class:"btn small", onclick: () => openReader(d.id, d.lastPage || firstPage(d)) }, d.lastPage ? `이어 읽기 p.${d.lastPage}` : "읽기"),
        h("button", { class:"btn small primary", onclick: () => startSession(d.id, true) }, c.due || c.fresh ? "연습" : "더 풀기")
      ),
      h("div", { class:"bar", "aria-hidden":"true" },
        h("i", { class:"g", style:`width:${pct(c.good)}` }), h("i", { class:"r", style:`width:${pct(c.review)}` }), h("i", { class:"h", style:`width:${pct(c.help)}` }), h("i", { class:"c", style:`width:${pct(c.read)}` })
      )
    ));
  }
  if (S.lib.status === "loading") list.append(h("p", { class:"small muted", text:"Recaller 문제를 불러오는 중…" }));
  else if (S.lib.status === "error") list.append(h("div", { class:"note err", text:S.lib.error }));
  wrap.append(list);
  wrap.append(h("p", { class:"small muted" }, "정답을 보기 전에 스스로 떠올려 맞힌 것만 ‘혼자 맞힘’으로 셉니다. 한 번 맞혔다고 끝내지 않고, 간격을 늘려 가며 다시 물어봅니다."));
  return wrap;
}

/* ----- session ----- */
function shuffle(a){ const b = a.slice(); for (let i = b.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function startSession(deckId, allowEarly){
  const decks = deckId ? [S.decks[deckId]] : Object.values(S.decks);
  const t = now(); let queue = [];
  for (const d of decks){
    const due = d.items.filter(it => isDue(d, it, t)).sort((a,b) => d.sched[a.id].due - d.sched[b.id].due).map(it => ({ deck:d.id, item:it.id }));
    const fresh = d.items.filter(it => isNew(d, it)).slice(0, 10).map(it => ({ deck:d.id, item:it.id }));
    queue.push(...due, ...fresh);
  }
  if (!queue.length && allowEarly && deckId){
    const d = S.decks[deckId];
    queue = d.items.slice().sort((a,b) => (d.sched[a.id]?.due || 0) - (d.sched[b.id]?.due || 0)).slice(0, 10).map(it => ({ deck:d.id, item:it.id }));
  }
  if (!queue.length){ toast("지금 풀 문제가 없어요."); return; }
  queue = queue.slice(0, 25);
  S.session = { queue, i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"review", viewed:new Set() };
  prepCurrent(); setView("practice");
}
function itemsOnPage(d, page){
  return d.items.filter(it => it.page === page || (d.objectives.find(o => o.id === it.objectiveId)?.pages || []).includes(page));
}
function startCheck(deckId, page){
  const d = S.decks[deckId];
  const items = itemsOnPage(d, page);
  if (!items.length){ toast("이 쪽에 연결된 문제가 없어요."); return; }
  S.session = { queue: items.map(it => ({ deck:d.id, item:it.id })), i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"check", page, viewed:new Set() };
  prepCurrent(); setView("practice");
}
function assistedNow(deck, item){ return S.session.assisted.has(item.id) || S.session.viewed.has(deck.id + ":" + item.page); }
function applyCheck(deck, item){
  // right after reading: never counts as memory evidence; real review starts tomorrow
  const s = schedOf(deck, item.id); s.seen = true; s.due = Math.max(s.due || 0, now() + DAY);
}
function curRef(){ const q = S.session.queue[S.session.i]; if (!q) return null; const deck = S.decks[q.deck]; return { deck, item: (deck.allItems || deck.items).find(x => x.id === q.item) }; }
function prepCurrent(){
  const r = curRef(); if (!r) return;
  const it = r.item;
  S.session.cur = { pick:null, text:"", order:[], pool: it.format === "order" ? shuffle(it.steps.map((s,i) => i)) : [], optOrder: it.format === "choice" ? shuffle(it.options.map((o,i) => i)) : [], verdict:null, overridden:false, cardShown:false };
}
function logEvent(deck, item, ev){ deck.events.push({ t:now(), item:item.id, ...ev }); }
function finishItem(outcome){
  const { deck, item } = curRef();
  if (S.session.mode === "check") applyCheck(deck, item); else applyOutcome(deck, item, outcome);
  S.session.results.push({ deck:deck.id, item:item.id, outcome });
  S.session.assisted.add(item.id); // the result screen shows the answer, so a retry later in this session is not independent
  if ((outcome === "wrong" || outcome === "assisted") && !S.session.requeued.has(item.id)){
    S.session.requeued.add(item.id);
    const pos = Math.min(S.session.i + 4, S.session.queue.length);
    S.session.queue.splice(pos, 0, { deck:deck.id, item:item.id, retry:true });
  }
  Store.save(deck);
}
function submitAnswer(){
  const { deck, item } = curRef(); const c = S.session.cur;
  const assisted = assistedNow(deck, item); const reading = S.session.mode === "check" || undefined;
  let correct = null;
  if (item.format === "choice"){ if (c.pick == null) return; correct = c.pick === item.answer; }
  else if (item.format === "value"){ if (!c.text.trim()) return; correct = item.accepted.some(a => norm(a) === norm(c.text)); }
  else if (item.format === "order"){ if (c.order.length !== item.steps.length) return; correct = c.order.every((v,i) => v === i); }
  logEvent(deck, item, { kind:"submit", correct, assisted, afterReading:reading, answer: item.format === "value" ? c.text.slice(0, 80) : undefined });
  c.verdict = assisted ? "assisted" : reading ? (correct ? "read-good" : "read-bad") : correct ? "good" : "bad";
  finishItem(assisted ? "assisted" : correct ? "correct" : "wrong");
  S.session.phase = "result"; render();
}
function dontKnow(){
  const { deck, item } = curRef(); const c = S.session.cur;
  const assisted = assistedNow(deck, item); const reading = S.session.mode === "check" || undefined;
  logEvent(deck, item, { kind:"submit", correct:false, assisted, gaveUp:true, afterReading:reading });
  c.verdict = assisted ? "assisted" : reading ? "read-bad" : "bad";
  finishItem(assisted ? "assisted" : "wrong");
  S.session.phase = "result"; render();
}
function peek(){
  const { deck, item } = curRef(); const c = S.session.cur;
  S.session.assisted.add(item.id);
  logEvent(deck, item, { kind:"reveal", afterReading: S.session.mode === "check" || undefined });
  c.verdict = "assisted";
  finishItem("assisted");
  S.session.phase = "result"; render();
}
function showCard(){ S.session.cur.cardShown = true; S.session.phase = "rate"; render(); }
function rateCard(rating){
  const { deck, item } = curRef(); const c = S.session.cur;
  const assisted = assistedNow(deck, item); const reading = S.session.mode === "check" || undefined;
  logEvent(deck, item, { kind:"rate", rating, assisted, afterReading:reading });
  c.verdict = assisted ? "assisted" : reading ? (rating === "remembered" ? "read-good" : rating === "unsure" ? "read-mid" : "read-bad") : rating === "remembered" ? "self-good" : rating === "unsure" ? "self-mid" : "bad";
  finishItem(assisted ? "assisted" : rating === "remembered" ? "correct" : rating === "unsure" ? "unsure" : "wrong");
  S.session.phase = "result"; render();
}
function overrideCorrect(){
  const { deck, item } = curRef(); const c = S.session.cur;
  const ev = [...deck.events].reverse().find(e => e.item === item.id && e.kind === "submit");
  if (ev){ ev.correct = true; ev.override = true; }
  if (S.session.mode === "check"){ c.verdict = "read-good"; c.overridden = true; S.session.queue = S.session.queue.filter((q, idx) => !(idx > S.session.i && q.retry && q.item === item.id)); Store.save(deck); render(); return; }
  const s = schedOf(deck, item.id); s.box = Math.min(s.box + 1, INTERVALS.length - 1); s.due = now() + INTERVALS[s.box]; s.lastIndep = now();
  const res = S.session.results[S.session.results.length - 1]; if (res) res.outcome = "correct";
  S.session.queue = S.session.queue.filter((q, idx) => !(idx > S.session.i && q.retry && q.item === item.id));
  c.verdict = "good"; c.overridden = true;
  Store.save(deck); render();
}
/* "이 문제 이상해요": the question leaves practice and review; the report stays as quality evidence. */
const REPORT_REASONS = ["정답이 틀렸어요", "문제가 애매해요", "원문과 달라요", "기타"];
function reportItem(reason){
  const { deck, item } = curRef();
  deck.reported = deck.reported || {};
  deck.reported[item.id] = { reason, t:now() };
  logEvent(deck, item, { kind:"report", reason });
  S.session.queue = S.session.queue.filter((q, idx) => !(idx > S.session.i && q.deck === deck.id && q.item === item.id));
  S.session.cur.reported = reason; S.session.cur.reporting = false;
  applyFilters(deck); Store.save(deck);
  toast("신고했어요. 이 문제는 연습과 복습에서 빠져요. 기록 탭에서 되돌릴 수 있어요.");
  render();
}
function renderReport(deck, item, c){
  if (c.reported || (deck.reported && deck.reported[item.id])) return h("p", { class:"small muted" }, h("span", { class:"chip help", text:`신고함 · ${c.reported || deck.reported[item.id].reason}` }));
  if (!c.reporting) return h("p", null, h("button", { class:"linkish", onclick: () => { c.reporting = true; render(); } }, "이 문제 이상해요"));
  return h("div", { class:"row" }, h("span", { class:"small muted", text:"무엇이 이상한가요?" }),
    REPORT_REASONS.map(r => h("button", { class:"btn small", onclick: () => reportItem(r) }, r)),
    h("button", { class:"btn small ghost", onclick: () => { c.reporting = false; render(); } }, "취소"));
}
/* The authored stem block by block (text, math, table, box, blank, figures); older items fall back to the plain prompt. */
function mathBlock(latex){
  const el = h("div", { class:"math qmath" });
  if (katexLib){
    try{ el.innerHTML = katexLib.renderToString(latex, { displayMode:true, output:"htmlAndMathml", throwOnError:false, trust:false, strict:"ignore" }); return el; }catch(e){}
  }
  el.append(h("span", { class:"texfb" }, texFallback(latex)));
  return el;
}
function renderStem(deck, item){
  if (!Array.isArray(item.blocks) || !item.blocks.length) return h("p", { class:"qprompt" }, richText(item.prompt));
  const wrap = h("div", { class:"qstem" });
  for (const b of item.blocks){
    if (b.kind === "text") wrap.append(h("p", { class: b.heading ? "qprompt" : "qbody" }, richText(b.text)));
    else if (b.kind === "math") wrap.append(mathBlock(b.latex));
    else if (b.kind === "table") wrap.append(h("div", { class:"qtable-wrap" }, h("table", { class:"qtable" },
      b.rows.map((row, ri) => h("tr", null, row.map(cell => h(ri < b.headerRows ? "th" : "td", null, richText(cell))))))));
    else if (b.kind === "box") wrap.append(h("div", { class:"qbox" }, richText(b.label)));
    else if (b.kind === "blank") wrap.append(h("p", { class:"qprompt" }, richText(b.before),
      h("span", { class: b.own ? "qblank" : "qblank other", text: b.own ? "빈칸" : "다른 칸" }), richText(b.after)));
    // Source figures are not cropped yet (crop units are undefined); a whole page could give the answer away.
    else if (b.kind === "image") wrap.append(h("figure", { class:"qfig" }, h("div", { class:"qfig-ph", text:`원문 p.${b.page}의 그림` }), h("figcaption", { text:b.alt })));
    else if (b.kind === "generated-image") wrap.append(h("figure", { class:"qfig" },
      h("img", { src: env.assetUrl ? env.assetUrl(deck.id, b.path) : "", alt:b.alt }), b.caption ? h("figcaption", { text:b.caption }) : null));
  }
  return wrap;
}
function nextItem(){
  S.session.i++; S.session.phase = "ask";
  if (S.session.i >= S.session.queue.length){ S.session.phase = "done"; }
  else prepCurrent();
  render();
  const f = document.querySelector("[data-autofocus]"); if (f) f.focus();
}
const FORMAT_LABEL = { choice:"고르기", value:"값 쓰기", order:"순서 맞추기", card:"떠올리고 확인" };
function renderSession(){
  const s = S.session;
  if (s.phase === "done") return renderSessionEnd();
  const { deck, item } = curRef(); const c = s.cur;
  const obj = deck.objectives.find(o => o.id === item.objectiveId);
  const total = s.queue.length;
  const top = h("div", { class:"session-top" },
    h("button", { class:"btn ghost small", onclick: () => { S.session = null; render(); } }, "그만하기"),
    h("div", { class:"progress", "aria-hidden":"true" }, h("i", { style:`width:${(s.i / total * 100).toFixed(1)}%` })),
    h("span", { class:"mono num muted", text:`${s.i + 1} / ${total}` })
  );
  const locked = s.phase !== "ask";
  const card = h("article", { class:"qcard", "aria-live":"polite" });
  card.append(h("div", { class:"qhead" },
    h("span", { class:"chip page", text:`p.${item.page}` }),
    h("span", { class:"chip", text:FORMAT_LABEL[item.format] }),
    s.mode === "check" ? h("span", { class:"chip read", text:"읽은 직후 확인" }) : null,
    s.queue[s.i].retry ? h("span", { class:"chip help", text:"다시 확인" }) : null,
    h("span", { class:"chip", text:deck.title })
  ));
  card.append(renderStem(deck, item));

  if (item.format === "choice"){
    const box = h("div", { class:"options", role:"group" });
    c.optOrder.forEach((oi, pos) => {
      const cls = ["opt"];
      if (locked && oi === item.answer) cls.push("is-correct");
      else if (locked && c.pick === oi && oi !== item.answer) cls.push("is-wrong");
      box.append(h("button", { class:cls.join(" "), "aria-pressed": c.pick === oi ? "true" : "false", disabled:locked, onclick: () => { c.pick = oi; render(); } },
        h("span", { class:"k", text:String(pos + 1) }), h("span", null, richText(item.options[oi]))));
    });
    card.append(box);
  } else if (item.format === "value"){
    const inp = h("input", { class:"answer-input", id:"ans", type:"text", autocomplete:"off", spellcheck:"false", placeholder:"답을 입력하세요", "data-autofocus":"1", disabled:locked, value:c.text });
    inp.value = c.text;
    inp.addEventListener("input", () => { c.text = inp.value; const b = document.getElementById("submitBtn"); if (b) b.disabled = !c.text.trim(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); submitAnswer(); } });
    card.append(h("div", { class:"field" }, h("label", { for:"ans", class:"muted small", style:"font-weight:400", text:"예: (1,2), 3/4, 75°  · 띄어쓰기와 ·, °, 따옴표 차이는 채점에서 무시해요" }), inp));
  } else if (item.format === "order"){
    const picked = h("div", { class:"order-picked", "aria-label":"고른 순서" });
    if (!c.order.length) picked.append(h("span", { class:"small muted", text:"아래 단계를 먼저 오는 것부터 누르세요." }));
    c.order.forEach((si, k) => {
      const wrongPos = locked && si !== k;
      picked.append(h("button", { class:"step", disabled:locked, style: locked ? `border-color:${wrongPos ? "var(--bad)" : "var(--good)"}` : null, onclick: () => { c.order.splice(k, 1); c.pool.push(si); render(); } },
        h("b", { text:String(k + 1) }), h("span", { text:item.steps[si] })));
    });
    const pool = h("div", { class:"order-pool" });
    c.pool.forEach((si, k) => pool.append(h("button", { class:"step", disabled:locked, onclick: () => { c.pool.splice(k, 1); c.order.push(si); render(); } }, item.steps[si])));
    card.append(picked, pool);
  } else if (item.format === "card"){
    if (s.phase === "ask"){
      const ta = h("textarea", { class:"answer-input", id:"ans", placeholder:"떠올린 내용을 적어 보세요 (선택). 적지 않고 머릿속으로만 떠올려도 됩니다.", "data-autofocus":"1" });
      ta.value = c.text; ta.addEventListener("input", () => { c.text = ta.value; });
      card.append(ta);
    } else if (c.text.trim()){
      card.append(h("div", { class:"note" }, h("div", { class:"small", text:"내가 적은 답" }), h("div", { style:"white-space:pre-line;color:var(--ink)", text:c.text })));
    }
  }

  // result
  if (s.phase === "rate" || s.phase === "result"){
    const rv = h("dl", { class:"reveal" });
    if (item.format === "card" || s.phase === "result"){
      const ansText = item.format === "choice" ? item.options[item.answer] : item.format === "value" ? item.accepted[0] : item.format === "order" ? item.steps.map((x,i) => `${i+1}. ${x}`).join("\n") : item.answer;
      rv.append(h("div", null, h("dt", { text:"정답" }), h("dd", { style:"white-space:pre-line;font-weight:600" }, richText(ansText))));
    }
    if (s.phase === "result"){
      const map = {
        good:["good", c.overridden ? "맞음으로 고쳤어요" : "혼자 맞혔어요", c.overridden ? "자동 채점이 놓친 답을 직접 인정했어요. 기록에 표시해 둡니다." : "다음에는 간격을 늘려 다시 물어볼게요."],
        bad:["bad", "이번엔 떠올리지 못했어요", "10분쯤 뒤, 이번 연습 안에서 한 번 더 나옵니다."],
        assisted:["help", "정답을 보고 확인했어요", "혼자 맞힌 기록으로 세지 않아요. 잠시 뒤 다시 물어볼게요."],
        "self-good":["self", "기억났다고 표시했어요", "자기평가라서 자동 채점보다 약한 근거로 기록돼요."],
        "self-mid":["self", "헷갈렸다고 표시했어요", "내일 다시 물어볼게요."],
        "read-good":["read", c.overridden ? "맞음으로 고쳤어요 (읽은 직후)" : "읽은 직후 맞혔어요", "방금 읽은 내용이라 기억 기록으로 세지 않아요. 내일부터 복습에 넣을게요."],
        "read-mid":["read", "일부만 떠올렸어요 (읽은 직후)", "내일부터 복습에 넣을게요."],
        "read-bad":["bad", "읽은 직후에도 헷갈렸어요", "아래 ‘원문에서 보기’로 다시 읽어 보세요. 이번 확인에서 한 번 더 나와요."]
      }[c.verdict];
      card.append(h("div", { class:`verdict ${map[0]}` }, h("strong", { text:map[1] }), h("span", { class:"small", text:map[2] }),
        (item.format === "value" && (c.verdict === "bad" || c.verdict === "read-bad") && !c.overridden && c.text.trim()) ? h("span", null, h("button", { class:"linkish", onclick:overrideCorrect }, "내 답도 맞아요 (표기만 달라요)")) : null
      ));
      if (item.explanation) rv.append(h("div", null, h("dt", { text:"설명" }), h("dd", null, richText(item.explanation))));
      if (obj) rv.append(h("div", null, h("dt", { text:"학습목표" }), h("dd", { text:obj.statement })));
      rv.append(h("div", null, h("dt", { text:`원문 근거 · p.${item.page}` }), h("dd", null, h("mark", { class:"quote", text:item.quote || "기록된 인용 없음" }), item.quoteVerified === false ? h("span", { class:"chip help", style:"margin-left:6px", text:"원문과 일치 확인 안 됨" }) : null,
        h("div", { style:"margin-top:8px" }, h("button", { class:"btn small", onclick: () => openReader(deck.id, item.page, item.objectiveId) }, "원문에서 보기 →")))));
    }
    card.append(rv);
    if (s.phase === "result") card.append(renderReport(deck, item, c));
  }

  // actions
  const act = h("div", { class:"actions" });
  if (s.phase === "ask"){
    if (item.format === "card"){
      act.append(h("button", { class:"btn primary", onclick:showCard }, "답 확인 ", h("span", { class:"kbd", text:"Enter" })));
    } else {
      const ready = item.format === "choice" ? c.pick != null : item.format === "value" ? !!c.text.trim() : c.order.length === item.steps.length;
      act.append(h("button", { class:"btn primary", id:"submitBtn", disabled:!ready, onclick:submitAnswer }, "제출 ", h("span", { class:"kbd", text:"Enter" })));
      act.append(h("button", { class:"btn", onclick:dontKnow }, "모르겠어요"));
    }
    act.append(h("span", { class:"spacer" }));
    if (item.format !== "card") act.append(h("button", { class:"btn ghost small", onclick:peek, title:"정답을 먼저 보면 이번 풀이는 혼자 맞힌 기록으로 세지 않아요" }, "정답 먼저 보기"));
  } else if (s.phase === "rate"){
    act.append(h("span", { class:"small muted", text:"떠올린 것과 비교해 보세요" }));
    act.append(h("div", { class:"rate" },
      h("button", { class:"btn", onclick: () => rateCard("forgot") }, "못 떠올림"),
      h("button", { class:"btn", onclick: () => rateCard("unsure") }, "일부만"),
      h("button", { class:"btn primary", onclick: () => rateCard("remembered") }, "다 떠올림")
    ));
  } else {
    act.append(h("span", { class:"spacer" }));
    act.append(h("button", { class:"btn primary", "data-autofocus":"1", onclick:nextItem }, s.i + 1 >= s.queue.length ? "결과 보기 " : "다음 ", h("span", { class:"kbd", text:"Enter" })));
  }
  card.append(act);
  return h("div", null, top, card);
}
function renderSessionEnd(){
  const r = S.session.results;
  const good = r.filter(x => x.outcome === "correct").length, bad = r.filter(x => x.outcome === "wrong").length, help = r.filter(x => x.outcome === "assisted").length, mid = r.filter(x => x.outcome === "unsure").length;
  const next = Object.values(S.decks).flatMap(d => Object.values(d.sched).filter(s => s.seen).map(s => s.due)).filter(t => t > now()).sort((a,b) => a-b)[0];
  return h("div", { class:"stack" },
    h("section", { class:"panel stack" },
      h("p", { class:"eyebrow", text:"연습 끝" }),
      h("h2", { style:"font-family:var(--display);font-size:22px", text: S.session.mode === "check" ? `p.${S.session.page} 확인 문제 ${r.length}번 풀었어요` : `${r.length}번 풀었어요` }),
      S.session.mode === "check" ? h("p", { class:"small muted", text:"읽은 직후 푼 결과는 기억 기록으로 세지 않아요. 진짜 확인은 내일부터 복습에서 해요." }) : null,
      h("div", { class:"tiles", style:"margin:0" },
        h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--good)", text:String(good) }), h("span", { text: S.session.mode === "check" ? "맞힘 (읽은 직후)" : "혼자 맞힘" })),
        h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--bad)", text:String(bad) }), h("span", { text:"못 떠올림" })),
        h("div", { class:"tile" }, h("b", { class:"num", text:String(mid) }), h("span", { text:"헷갈림" })),
        h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--help)", text:String(help) }), h("span", { text:"정답 보고 풂" }))
      ),
      h("p", { class:"small muted", text: next ? `다음 복습은 ${fmtWhen(next)}에 차례가 와요.` : "" }),
      S.session.mode === "check"
        ? h("div", { class:"row" },
            h("button", { class:"btn primary", onclick: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, nextPageWithItems(S.decks[d], pg) || pg); } }, "다음 쪽 읽기"),
            h("button", { class:"btn", onclick: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, pg); } }, `p.${S.session.page}로 돌아가기`))
        : h("div", { class:"row" }, h("button", { class:"btn primary", onclick: () => { S.session = null; render(); } }, "처음으로"), h("button", { class:"btn", onclick: () => { S.session = null; setView("records"); } }, "기록 보기"))
    )
  );
}
function fmtWhen(t){
  const d = t - now();
  if (d < 60*MIN) return `${Math.max(1, Math.round(d / MIN))}분 뒤`;
  if (d < DAY) return `${Math.round(d / (60*MIN))}시간 뒤`;
  return `${Math.round(d / DAY)}일 뒤`;
}
on(document, "keydown", (e) => {
  if (S.view !== "practice" || !S.session || e.isComposing) return;
  const tag = (e.target.tagName || "").toLowerCase();
  const s = S.session;
  if (e.key === "Enter" && tag !== "textarea" && tag !== "input" && tag !== "button"){
    e.preventDefault();
    if (s.phase === "result") nextItem();
    else if (s.phase === "ask"){ const r = curRef(); if (r.item.format === "card") showCard(); else submitAnswer(); }
  } else if (s.phase === "ask" && /^[1-4]$/.test(e.key) && tag !== "input" && tag !== "textarea"){
    const r = curRef(); if (r.item.format === "choice"){ const oi = s.cur.optOrder[Number(e.key) - 1]; if (oi != null){ s.cur.pick = oi; render(); } }
  }
});
/* ----- reader ----- */
let pdfjs = null;
async function docAspect(doc){
  try{ const vp = (await doc.getPage(1)).getViewport({ scale:1 }); return vp.width / vp.height; }catch(e){ return 0.75; }
}
function sortedDecks(){ return Object.values(S.decks).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt); }
function itemPages(d){ return [...new Set(d.items.map(i => i.page))].sort((a,b) => a - b); }
function firstPage(d){ return itemPages(d)[0] || 1; }
function nextPageWithItems(d, pg){ return itemPages(d).find(p => p > pg) || null; }
function maxPage(d){ return d.pageCount || Math.max(1, ...d.pages.map(p => p.n), ...d.items.map(i => i.page)); }
function pageTotal(d){ const P = S.pdf[d.id]; return P && P.doc ? P.doc.numPages : maxPage(d); }
function resetExplain(){}
function openReader(deckId, page, objId){
  const R = S.reader;
  resetExplain();
  R.deckId = deckId; R.page = page || 1; R.active = objId || null; R.zoom = false; R.attachErr = "";
  rememberPage();
  setView("read"); window.scrollTo({ top:0 });
}
function goPage(n){
  const R = S.reader, d = S.decks[R.deckId]; if (!d) return;
  n = Math.max(1, Math.min(pageTotal(d), Math.round(n) || 1));
  if (n === R.page){ render(); return; }
  resetExplain(); R.page = n; R.active = null; R.zoom = false; rememberPage(); render();
  const bar = document.querySelector(".rbar");
  if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block:"start" });
}
function rememberPage(){
  const d = S.decks[S.reader.deckId]; if (!d || d.example) return;
  d.lastPage = S.reader.page;
  if (d.pending) savePending(); else Store.save(d);
}
function hideObjective(d, objectiveId){
  d.hidden = [...new Set([...(d.hidden || []), objectiveId])];
  applyFilters(d); Store.save(d);
  toast("이 목표의 문제는 연습과 복습에서 빠져요. 기록 탭에서 다시 넣을 수 있어요.");
  render();
}
function pageQuotes(d, n){ return d.objectives.filter(o => o.pages.includes(n)).map((o, i) => ({ id:o.id, quote:o.quote, num:i + 1 })).filter(q => q.quote); }
function ensurePdf(d){
  if (S.pdf[d.id] || !d.sourceCatalogId) return;
  S.pdf[d.id] = { status:"loading", canv:{} };
  (async () => {
    try{
      if (!pdfjs) pdfjs = await env.loadPdfjs();
      const buf = await env.loadPdf(d.sourceCatalogId);
      const doc = await pdfjs.getDocument({ data:new Uint8Array(buf), isEvalSupported:false }).promise;
      if (disposed){ doc.destroy(); return; }
      S.pdf[d.id] = { status:"ready", doc, canv:{}, aspect: await docAspect(doc) };
    }catch(e){ S.pdf[d.id] = { status:"error", canv:{} }; }
    if (S.view === "read") render();
  })();
}
function highlightRects(entry, quote){
  let s = ""; const map = [];
  entry.items.forEach((it, i) => { for (const ch of it.str.normalize("NFKC")){ if (/\s/.test(ch)) continue; s += ch.toLowerCase(); map.push(i); } });
  const q = looseText(quote).toLowerCase(); if (q.length < 4) return [];
  let at = s.indexOf(q), len = q.length;
  if (at < 0){ const q2 = q.slice(0, 24); at = s.indexOf(q2); len = q2.length; if (at < 0) return []; }
  const idx = [...new Set(map.slice(at, at + len))];
  return idx.map(i => {
    const it = entry.items[i];
    const tx = pdfjs.Util.transform(entry.vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]);
    return { x:tx[4], y:tx[5] - fh * 0.95, w:it.width * entry.vp.scale, h:fh * 1.2 };
  }).filter(r => r.w > 0);
}
/* which source passages to mark: an explanation line the reader picked, otherwise this page's goals */
function activeRefs(d, n){
  const R = S.reader;
  return pageQuotes(d, n).map(q => ({ ...q, dim: !!R.active && q.id !== R.active, kind:"goal" }));
}
function pageAspect(d){ const P = S.pdf[d.id]; return P && P.status === "ready" && P.aspect ? P.aspect : 0.75; }
let drawToken = 0;
async function paintBox(box, d, pageNo, cssW){
  const P = S.pdf[d.id]; if (!P || P.status !== "ready") return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const ck = pageNo + ":" + cssW + ":" + dpr;
  let entry = P.canv[ck];
  if (!entry){
    try{
      const page = await P.doc.getPage(pageNo);
      const base = page.getViewport({ scale:1 });
      let px = cssW * dpr; if (px > 4200) px = 4200;
      const vp = page.getViewport({ scale:px / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      canvas.style.width = cssW + "px";
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `원본 ${pageNo}쪽`);
      await page.render({ canvas, canvasContext:canvas.getContext("2d"), viewport:vp }).promise;
      const tc = await page.getTextContent();
      entry = { canvas, vp, items:tc.items.filter(it => typeof it.str === "string") };
      P.canv[ck] = entry;
      const keys = Object.keys(P.canv); if (keys.length > 8) delete P.canv[keys[0]];
    }catch(e){ return; }
  }
  if (!box.isConnected || box.dataset.key !== d.id + ":" + pageNo) return;
  const rects = [], badges = [];
  for (const q of activeRefs(d, pageNo)){
    const rs = highlightRects(entry, q.quote);
    rs.forEach(r => rects.push({ ...r, dim:q.dim, line:q.kind === "line" }));
    if (rs.length) badges.push({ x:rs[0].x, y:rs[0].y, num:q.num, line:q.kind === "line" });
  }
  const W = entry.canvas.width, H = entry.canvas.height;
  // a canvas can live in one box at a time; the zoom view gets its own bitmap because its width differs
  box.replaceChildren(entry.canvas,
    ...rects.map(r => h("div", { class:"hl" + (r.dim ? " dim" : "") + (r.line ? " line" : ""), style:`left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%` })),
    ...badges.map(b => h("div", { class:"hlnum" + (b.line ? " line" : ""), style:`left:${b.x / W * 100}%;top:${b.y / H * 100}%`, text:String(b.num) })));
}
async function drawPage(){
  if (S.view !== "read") return;
  const R = S.reader, d = S.decks[R.deckId]; if (!d) return;
  const token = ++drawToken;
  const box = document.getElementById("pagebox");
  if (box) await paintBox(box, d, R.page, Math.max(200, Math.floor(box.getBoundingClientRect().width)));
  if (token !== drawToken) return;
  const zb = document.getElementById("zoombox");
  if (zb) await paintBox(zb, d, R.page, Math.max(200, Math.floor(zb.getBoundingClientRect().width)));
}
function findRange(text, quote){
  const chars = [...String(quote).replace(/\s+/g, "")].slice(0, 160).map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (chars.length < 4) return null;
  for (const n of [chars.length, Math.min(24, chars.length)]){
    try{ const m = new RegExp(chars.slice(0, n).join("\\s*")).exec(text); if (m) return [m.index, m.index + m[0].length]; }catch(e){}
  }
  return null;
}
async function pageText(d, n){
  const P = S.pdf[d.id];
  if (P && P.status === "ready"){
    try{
      const pg = await P.doc.getPage(n); const tc = await pg.getTextContent(); let t = "";
      for (const it of tc.items){ if (typeof it.str !== "string") continue; t += it.str + (it.hasEOL ? "\n" : " "); }
      return t.replace(/[ \t]+/g, " ").trim();
    }catch(e){}
  }
  const p = d.pages.find(x => x.n === n); return p ? p.text : "";
}
/* ---- math: KaTeX with its stylesheet (bundled by Recaller), MathML kept for screen readers ---- */
let katexLib = null, katexLoading = null;
function ensureKatex(){
  if (katexLib) return Promise.resolve(true);
  if (!katexLoading) katexLoading = env.loadKatex().then((k) => { katexLib = k; return true; }, () => false);
  return katexLoading;
}
function richText(str){
  const parts = String(str ?? "").split(/(\$[^$\n]+\$)/g).filter(p => p !== "");
  return parts.map(p => {
    if (/^\$[^$]+\$$/.test(p)){
      const tex = p.slice(1, -1);
      if (katexLib){
        try{ const span = document.createElement("span"); span.className = "math"; span.innerHTML = katexLib.renderToString(tex, { output:"htmlAndMathml", throwOnError:false, trust:false, strict:"ignore" }); return span; }catch(e){}
      }
      return h("span", { class:"texfb" }, texFallback(tex));
    }
    return document.createTextNode(p);
  });
}
/* readable fallback when KaTeX is unavailable: Greek letters and operators as symbols, _x and ^x as sub/superscripts */
const TEX_SYM = { alpha:"α", beta:"β", gamma:"γ", delta:"δ", theta:"θ", lambda:"λ", mu:"μ", pi:"π", sigma:"σ", phi:"φ", omega:"ω", Delta:"Δ", Sigma:"Σ",
  cdot:"·", times:"×", pm:"±", le:"≤", ge:"≥", neq:"≠", ne:"≠", approx:"≈", to:"→", rightarrow:"→", leftarrow:"←", infty:"∞", sqrt:"√", prime:"′" };
function texFallback(tex){
  let t = String(tex)
    .replace(/\\(?:left|right|displaystyle|mathrm|text|operatorname)(?![A-Za-z])/g, "")
    .replace(/\\[,;:!]|\\ /g, " ")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\(sin|cos|tan|log|ln|exp|det|max|min)(?![A-Za-z])/g, "$1 ")
    .replace(/\\([A-Za-z]+)/g, (m, w) => TEX_SYM[w] ?? w)
    .replace(/'/g, "′");
  const out = []; const re = /([_^])(\{([^{}]*)\}|(.))/g; let last = 0, m;
  while ((m = re.exec(t))){
    out.push(document.createTextNode(t.slice(last, m.index).replace(/[{}]/g, "")));
    out.push(h(m[1] === "_" ? "sub" : "sup", { text:(m[3] ?? m[4]).replace(/[{}]/g, "") }));
    last = re.lastIndex;
  }
  out.push(document.createTextNode(t.slice(last).replace(/[{}]/g, "")));
  return out;
}
function markTextRefs(text, refs){
  const ranges = [];
  for (const q of refs){ const r = findRange(text, q.quote); if (r) ranges.push({ s:r[0], e:r[1], num:q.num, dim:q.dim, line:q.kind === "line" }); }
  ranges.sort((a,b) => a.s - b.s);
  const out = []; let pos = 0;
  for (const r of ranges){
    if (r.s < pos) continue;
    out.push(text.slice(pos, r.s));
    out.push(h("mark", { class:"quote" + (r.line ? " line" : ""), style: r.dim ? "opacity:.4" : null }, r.num ? h("sup", { class:"qn" + (r.line ? " line" : ""), text:String(r.num) }) : null, text.slice(r.s, r.e)));
    pos = r.e;
  }
  out.push(text.slice(pos));
  return out;
}
function renderReader(){
  const decks = sortedDecks();
  if (!decks.length) return h("div", { class:"panel", text:"아직 자료가 없어요." });
  const R = S.reader;
  if (!R.deckId || !S.decks[R.deckId]){ R.deckId = decks[0].id; R.page = firstPage(decks[0]); }
  const d = S.decks[R.deckId]; ensurePdf(d);
  const P = S.pdf[d.id]; const total = pageTotal(d);
  R.page = Math.max(1, Math.min(total, R.page));
  if (S.session) S.session.viewed.add(d.id + ":" + R.page);
  const pdfOn = P && (P.status === "ready" || P.status === "loading");
  const wide = pdfOn && pageAspect(d) > 1.15;          // slides: explanation goes below, not beside
  const objs = d.objectives.filter(o => o.pages.includes(R.page) && !(d.hidden || []).includes(o.id));
  const n = itemsOnPage(d, R.page).length;
  const nxt = nextPageWithItems(d, R.page);
  const wrap = h("div");

  if (S.session) wrap.append(h("div", { class:"banner", role:"status" },
    h("span", { text:"연습 중이에요. 여기서 본 쪽의 문제는 이번 연습에서 ‘정답 보고 풂’으로 기록돼요." }),
    h("button", { class:"btn small", onclick: () => setView("practice") }, "연습으로 돌아가기")));

  const sel = h("select", { id:"readDeck", "aria-label":"자료 고르기" }, decks.map(x => h("option", { value:x.id, selected: x.id === d.id ? "selected" : null }, x.title)));
  sel.addEventListener("change", () => openReader(sel.value, firstPage(S.decks[sel.value])));
  const pg = h("input", { class:"num", id:"pgInput", type:"number", min:"1", max:String(total), "aria-label":"쪽 번호" });
  pg.value = String(R.page); pg.addEventListener("change", () => goPage(Number(pg.value)));
  wrap.append(h("div", { class:"rbar" }, sel, h("span", { class:"grow" }),
    h("div", { class:"pager" },
      h("button", { class:"qbtn", disabled: R.page <= 1, "aria-label":"이전 쪽", onclick: () => goPage(R.page - 1) }, "‹"),
      pg, h("span", { class:"num", text:`/ ${total}` }),
      h("button", { class:"qbtn", disabled: R.page >= total, "aria-label":"다음 쪽", onclick: () => goPage(R.page + 1) }, "›"))));
  if (d.pending) wrap.append(h("div", { style:"margin-bottom:12px" }, pendingNote(d)));

  const page = h("section", { class:"rpage" + (wide ? " wide" : "") });
  let sheet;
  if (pdfOn){
    sheet = h("div", { class:"sheet" },
      h("div", { class:"pagebox", id:"pagebox", "data-key":d.id + ":" + R.page, style: wide ? `aspect-ratio:${pageAspect(d)}` : null }, h("div", { class:"loading", text: P.status === "loading" ? "원본 PDF를 불러오는 중…" : "쪽을 그리는 중…" })),
      P.status === "ready" ? h("button", { class:"zoombtn", "aria-label":"크게 보기", onclick: () => { R.zoom = true; render(); } }, "크게 보기") : null);
  } else {
    const stored = d.pages.find(p => p.n === R.page);
    sheet = h("div", { class:"sheet" }, h("div", { class:"paper" }, h("div", { class:"inner" }, h("span", { class:"pn", text:`p.${R.page}` }),
      stored && stored.text.trim() ? markTextRefs(stored.text, activeRefs(d, R.page)) : h("span", { class:"muted", text:"이 쪽은 저장된 텍스트가 없어요." }))));
  }
  page.append(sheet);
  if (objs.length){
    page.append(h("div", { class:"goals" }, h("span", { class:"lbl", text:"이 쪽에서 익힐 것" }),
      objs.map((o, i) => h("div", { class:"goalrow" },
        h("button", { class:"goal", "aria-pressed": R.active === o.id ? "true" : "false", title:"원문에서 이 부분만 진하게 보기", onclick: () => { R.active = R.active === o.id ? null : o.id; render(); } },
          h("span", { class:"gnum", text:String(i + 1) }), h("span", { text:o.statement })),
        d.example ? null : h("button", { class:"linkish", title:"이 목표의 문제를 연습·복습에서 빼기", onclick: () => hideObjective(d, o.id) }, "빼기")))));
  }
  if (P && P.status === "error") page.append(h("p", { class:"attach", text:"원본 PDF를 불러오지 못했어요. 원본 등록 상태를 확인해 주세요." }));

  const grid = h("div", { class:"rgrid" }, page);
  wrap.append(grid);

  if (R.zoom && P && P.status === "ready"){
    const a = pageAspect(d);
    wrap.append(h("div", { class:"zoomlayer", role:"dialog", "aria-label":`원본 ${R.page}쪽 크게 보기`, onclick: (e) => { if (e.target === e.currentTarget){ R.zoom = false; render(); } } },
      h("div", { class:"zoombar" }, h("span", { text:`p.${R.page}` }), h("button", { class:"qbtn", onclick: () => { R.zoom = false; render(); } }, "닫기 ✕")),
      h("div", { class:"pagebox", id:"zoombox", "data-key":d.id + ":" + R.page, style:`width:min(calc(100vw - 32px), calc((100vh - 90px) * ${a}));aspect-ratio:${a}` })));
  }

  wrap.append(h("div", { class:"ractions" },
    h("span", { class:"where" }, h("b", { text:`p.${R.page}` }), objs.length ? ` · 익힐 것 ${objs.length}` : " · 연결된 목표 없음"),
    h("button", { class:"btn", "aria-pressed": Chat.isOpen() ? "true" : "false", onclick: () => Chat.toggle() }, Chat.isOpen() ? "질문 창 닫기" : "질문하기"),
    S.session ? h("button", { class:"btn primary", onclick: () => setView("practice") }, "연습으로 돌아가기")
      : n ? h("button", { class:"btn primary", onclick: () => startCheck(d.id, R.page) }, `이 쪽 문제 풀기 (${n})`)
      : nxt ? h("button", { class:"btn", onclick: () => goPage(nxt) }, `문제 있는 다음 쪽 · p.${nxt} →`) : null));
  if (n && !S.session) wrap.append(h("p", { class:"small muted", style:"margin-top:2px", text:"읽은 직후 푼 결과는 기억 기록으로 세지 않고, 내일부터 복습에 넣어요." }));
  return wrap;
}
on(document, "keydown", (e) => {
  if (S.view !== "read" || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.key === "Escape" && S.reader.zoom){ S.reader.zoom = false; render(); return; }
  if (e.key === "ArrowRight"){ e.preventDefault(); goPage(S.reader.page + 1); }
  else if (e.key === "ArrowLeft"){ e.preventDefault(); goPage(S.reader.page - 1); }
});
let resizeTimer;
on(window, "resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.view === "read") drawPage(); }, 150); });
(function watchDpr(){
  try{
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    on(mq, "change", () => { if (S.view === "read") drawPage(); watchDpr(); }, { once:true });
  }catch(e){}
})();
/* ----- floating question window: lives outside #app so re-renders never reset it.
   Answers need a paid model call, so `ask` stays unset until the user approves wiring it. ----- */
const Chat = {
  el:null, msgs:[], busy:false, ctl:null, err:"",
  box(){ try{ return JSON.parse(localStorage.getItem("dejipgi.chatbox") || "null"); }catch(e){ return null; } },
  saveBox(){ if (!this.el || this.mode !== "normal") return; const r = this.el.getBoundingClientRect(); try{ localStorage.setItem("dejipgi.chatbox", JSON.stringify({ x:r.left, y:r.top, w:r.width, h:r.height })); }catch(e){} },
  mode:"normal",
  isOpen(){ return !!(this.el && !this.el.hidden); },
  setMode(m){
    if (!this.el) return;
    if (this.mode === "normal" && m !== "normal" && innerWidth > 700) this.saveBox();
    this.mode = m;
    this.el.dataset.mode = m;
    const max = this.el.querySelector("#chatMax"), min = this.el.querySelector("#chatMin");
    max.textContent = m === "max" ? "⤡" : "⤢"; max.title = m === "max" ? "원래 크기" : "크게 보기"; max.setAttribute("aria-label", max.title);
    min.textContent = m === "min" ? "▢" : "—"; min.title = m === "min" ? "펼치기" : "접기"; min.setAttribute("aria-label", min.title);
    if (m === "normal") this.place();
    else if (m === "max" && innerWidth > 700){
      const w = Math.min(innerWidth - 32, Math.max(560, Math.round(innerWidth * 0.46)));
      Object.assign(this.el.style, { left:(innerWidth - w - 16) + "px", top:"16px", width:w + "px", height:(innerHeight - 32) + "px" });
    }
    else if (m === "min" && innerWidth > 700){
      const r = this.el.getBoundingClientRect();
      Object.assign(this.el.style, { height:"", top:Math.min(r.top, innerHeight - 60) + "px" });
    }
    if (m !== "min") setTimeout(() => { const log = this.el.querySelector("#chatLog"); if (log) log.scrollTop = log.scrollHeight; }, 0);
  },
  toggle(){ this.isOpen() ? this.close() : this.open(); },
  close(){ if (this.ctl) this.ctl.abort(); if (this.el) this.el.hidden = true; if (S.view === "read") render(); },
  open(){
    if (!this.el) this.build();
    this.el.hidden = false; this.setMode(this.mode === "max" ? "max" : "normal"); this.paint();
    ensureKatex().then(ok => { if (ok && this.isOpen()) this.paint(); });
    setTimeout(() => this.el.querySelector("textarea").focus(), 0);
    if (S.view === "read") render();
  },
  place(){
    const b = this.box(), vw = innerWidth, vh = innerHeight;
    if (vw <= 700){ Object.assign(this.el.style, { left:"", top:"", width:"", height:"" }); return; }
    const w = Math.min(Math.max(b?.w || 380, 300), vw - 24), hgt = Math.min(Math.max(b?.h || Math.min(480, vh - 220), 260), vh - 24);
    const x = Math.min(Math.max(b?.x ?? vw - w - 24, 8), vw - w - 8), y = Math.min(Math.max(b?.y ?? 120, 8), vh - hgt - 8);
    Object.assign(this.el.style, { left:x + "px", top:y + "px", width:w + "px", height:hgt + "px" });
  },
  build(){
    const ta = h("textarea", { id:"chatInput", rows:"2", placeholder:"지금 보는 쪽에 대해 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)" });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); this.send(); } });
    const head = h("div", { class:"chat-head" },
      h("span", { class:"chat-grip", "aria-hidden":"true" }),
      h("strong", { id:"chatTitle", text:"질문하기" }),
      h("span", { class:"grow" }),
      h("button", { class:"qbtn", title:"대화 비우기", onclick: () => { if (this.ctl) this.ctl.abort(); this.msgs = []; this.err = ""; this.paint(); } }, "비우기"),
      h("button", { class:"qbtn", id:"chatMin", "aria-label":"질문 창 접기", title:"접기", onclick: () => this.setMode(this.mode === "min" ? "normal" : "min") }, "—"),
      h("button", { class:"qbtn", id:"chatMax", "aria-label":"질문 창 크게", title:"크게 보기", onclick: () => this.setMode(this.mode === "max" ? "normal" : "max") }, "⤢"),
      h("button", { class:"qbtn", "aria-label":"질문 창 닫기", title:"닫기", onclick: () => this.close() }, "✕"));
    head.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) this.setMode(this.mode === "max" ? "normal" : "max"); });
    this.el = h("section", { class:"chatwin", role:"dialog", "aria-label":"질문하기", hidden:true },
      head,
      h("div", { class:"chat-log", id:"chatLog", "aria-live":"polite" }),
      h("div", { class:"chat-foot" }, ta, h("button", { class:"btn primary small", id:"chatSend", onclick: () => this.send() }, "보내기")));
    root.append(this.el);
    // drag by the header (desktop only)
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if (innerWidth <= 700 || e.target.closest("button")) return;
      const r = this.el.getBoundingClientRect(); drag = { dx:e.clientX - r.left, dy:e.clientY - r.top };
      head.setPointerCapture(e.pointerId); this.el.classList.add("dragging");
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = this.el.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - drag.dx, 4), innerWidth - r.width - 4);
      const y = Math.min(Math.max(e.clientY - drag.dy, 4), innerHeight - 48);
      this.el.style.left = x + "px"; this.el.style.top = y + "px";
    });
    const end = () => { if (!drag) return; drag = null; this.el.classList.remove("dragging"); this.saveBox(); };
    head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
    // resize from any edge or corner
    for (const dir of ["n","s","e","w","ne","nw","se","sw"]){
      const hd = h("div", { class:"rz rz-" + dir, "aria-hidden":"true" });
      let st = null;
      hd.addEventListener("pointerdown", (e) => {
        if (innerWidth <= 700) return;
        if (this.mode !== "normal") this.setMode("normal");
        const r = this.el.getBoundingClientRect(); st = { x:e.clientX, y:e.clientY, l:r.left, t:r.top, w:r.width, h:r.height };
        hd.setPointerCapture(e.pointerId); this.el.classList.add("dragging"); e.preventDefault();
      });
      hd.addEventListener("pointermove", (e) => {
        if (!st) return;
        const dx = e.clientX - st.x, dy = e.clientY - st.y, MINW = 300, MINH = 220;
        let { l, t, w, h:hh } = st;
        if (dir.includes("e")) w = Math.min(Math.max(st.w + dx, MINW), innerWidth - st.l - 4);
        if (dir.includes("s")) hh = Math.min(Math.max(st.h + dy, MINH), innerHeight - st.t - 4);
        if (dir.includes("w")){ w = Math.min(Math.max(st.w - dx, MINW), st.l + st.w - 4); l = st.l + st.w - w; }
        if (dir.includes("n")){ hh = Math.min(Math.max(st.h - dy, MINH), st.t + st.h - 4); t = st.t + st.h - hh; }
        Object.assign(this.el.style, { left:l + "px", top:t + "px", width:w + "px", height:hh + "px" });
      });
      const stop = () => { if (!st) return; st = null; this.el.classList.remove("dragging"); this.saveBox(); };
      hd.addEventListener("pointerup", stop); hd.addEventListener("pointercancel", stop);
      this.el.append(hd);
    }
    on(window, "resize", () => { if (this.isOpen()) this.setMode(this.mode); });
  },
  context(){
    const R = S.reader, d = S.decks[R.deckId];
    if (!d) return null;
    return { d, page:R.page, objs:d.objectives.filter(o => o.pages.includes(R.page)) };
  },
  paint(){
    if (!this.el) return;
    const c = this.context();
    this.el.querySelector("#chatTitle").textContent = c ? `질문하기 · p.${c.page}` : "질문하기";
    const log = this.el.querySelector("#chatLog");
    const nodes = [];
    if (!this.msgs.length){
      nodes.push(h("p", { class:"chat-hint", text:"지금 보는 쪽을 근거로 답해요. 바로 물어보거나 아래에서 골라 보세요." }));
      nodes.push(h("div", { class:"chat-sugs" }, ["이 쪽 쉽게 설명해 줘", "핵심만 한 줄로 알려 줘", "원문 줄마다 쉬운 말로 풀어 줘", "예시 숫자로 한 번 보여 줘"].map(q =>
        h("button", { class:"chip-btn", onclick: () => { this.el.querySelector("textarea").value = q; this.send(); } }, q))));
    }
    for (const m of this.msgs){
      nodes.push(h("div", { class:"bubble " + m.role },
        m.page ? h("span", { class:"bpage", text:`p.${m.page}` }) : null,
        h("div", { class:"btext" }, m.role === "assistant" ? richLines(m.content || "…") : m.content)));
    }
    if (this.err) nodes.push(h("p", { class:"check", text:this.err }));
    log.replaceChildren(...nodes);
    log.scrollTop = log.scrollHeight;
    const send = this.el.querySelector("#chatSend");
    send.textContent = this.busy ? "멈추기" : "보내기";
    send.onclick = () => this.busy ? (this.ctl && this.ctl.abort()) : this.send();
  },
  prompt(c, text){
    text = String(text || "").slice(0, 6000);
    return `너는 학습자가 지금 읽고 있는 자료를 옆에서 도와주는 튜터다.

규칙
- 아래 [지금 보는 쪽]의 원문을 근거로 답한다. 원문에 없는 내용을 덧붙일 때는 그 문장 앞에 "원문 밖 설명:"이라고 밝힌다.
- 쉽고 짧게, 보통 3~6문장. "줄마다 풀어 달라"는 요청이면 원문 줄을 짧게 인용하고 바로 아래에 쉬운 말 한두 문장을 붙인다.
- 원문의 기호와 용어는 바꾸지 않는다. 기준점, 방향, 부호, 단위, 조건을 빠뜨리지 않는다. 식은 $...$ 안에 LaTeX로 쓴다.
- 질문이 이 쪽과 무관하면 짧게 답하고, 이 쪽과 어떻게 이어지는지 한 문장 덧붙인다.
- 마크다운 기호(#, *, **, -)는 쓰지 않고 평문으로 쓴다. 단계는 "1)" "2)"처럼 적는다.

[자료] ${c.d.title}
[지금 보는 쪽 p.${c.page}]
${text || "(이 쪽은 추출된 글자가 없다. 이미지 위주의 쪽일 수 있다.)"}
${c.objs.length ? `\n[이 쪽의 학습목표]\n${c.objs.map(o => "- " + o.statement).join("\n")}` : ""}
`;
  },
  async send(){
    const ta = this.el.querySelector("textarea");
    const q = ta.value.trim(); if (!q || this.busy) return;
    const c = this.context();
    if (!c) return;
    if (!ask){ this.err = "질문 답변은 아직 연결하지 않았어요. 유료 호출이라 확인을 받은 뒤 붙일 예정이에요."; this.paint(); return; }
    if (S.session) S.session.viewed.add(c.d.id + ":" + c.page);   // asking about a page during practice counts as help
    ta.value = ""; this.err = "";
    this.msgs.push({ role:"user", content:q, page:c.page });
    const reply = { role:"assistant", content:"" }; this.msgs.push(reply);
    this.busy = true; this.ctl = new AbortController(); this.paint();
    const history = this.msgs.slice(0, -1).slice(-12).map(m => ({ role:m.role, content: m.role === "user" && m.page ? `(p.${m.page}를 보며) ${m.content}` : m.content })).filter(m => m.content);
    const turns = [{ role:"user", content:this.prompt(c, await pageText(c.d, c.page)) }, ...history];
    try{
      await ask(turns, { signal:this.ctl.signal, onText: ({ text }) => { reply.content = text; const last = this.el.querySelector("#chatLog .bubble.assistant:last-of-type .btext"); if (last) last.replaceChildren(...richLines(text)); } });
      if (JSON.stringify(reply.content).includes("$") && !katexLib){ await ensureKatex(); }
    }catch(e){
      if (e && e.text) reply.content = e.text;
      if (!(e && e.code === "cancelled")) this.err = sampleErrorCopy(e);
      if (!reply.content) this.msgs.pop();
    }finally{ this.busy = false; this.ctl = null; this.paint(); }
  }
};
function richLines(text){
  return String(text).split(/\n/).flatMap((line, i) => {
    const m = line.match(/^\s*원문 밖 설명\s*[:：]\s*(.*)$/);
    const node = m ? h("span", { class:"outside" }, h("b", { text:"원문 밖 설명" }), ...richText(m[1])) : null;
    const parts = node ? [node] : richText(line);
    return i ? [h("br"), ...parts] : parts;
  });
}/* ----- records ----- */
function renderRecords(){
  const decks = Object.values(S.decks).filter(d => !d.pending).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt);
  if (!decks.length) return h("div", { class:"panel", text:"아직 자료가 없어요." });
  if (!S.recordsDeck || !S.decks[S.recordsDeck]) S.recordsDeck = decks[0].id;
  const deck = S.decks[S.recordsDeck];
  const sel = h("select", { id:"deckSel", class:"btn", style:"font-weight:500" }, decks.map(d => h("option", { value:d.id, selected: d.id === deck.id ? "selected" : null }, d.title)));
  sel.addEventListener("change", () => { S.recordsDeck = sel.value; S.deleting = null; render(); });
  const graded = deck.events.filter(e => e.kind === "submit" && !e.assisted && !e.gaveUp && !e.afterReading);
  const acc = graded.length ? Math.round(graded.filter(e => e.correct).length / graded.length * 100) : null;
  const st = deck.items.map(it => itemStatus(deck, it));
  const cnt = (k) => st.filter(x => x === k).length;
  const wrap = h("div", { class:"stack" });
  wrap.append(h("div", { class:"row", style:"justify-content:space-between" },
    h("div", { class:"row" }, h("label", { for:"deckSel", class:"small muted", text:"자료" }), sel),
    S.deleting === deck.id
      ? h("div", { class:"confirm" }, h("span", { text:"이 자료의 풀이 기록을 모두 지울까요? 문제는 그대로 남아요." }), h("button", { class:"btn small", onclick: () => { deck.events = []; deck.sched = {}; Store.save(deck); S.deleting = null; render(); } }, "지우기"), h("button", { class:"btn small ghost", onclick: () => { S.deleting = null; render(); } }, "취소"))
      : h("button", { class:"btn small ghost", onclick: () => { S.deleting = deck.id; render(); } }, "기록 초기화")
  ));
  wrap.append(h("div", { class:"tiles" },
    h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--good)", text:String(cnt("recent") + cnt("steady")) }), h("span", { text:"혼자 맞힘 (최근)" })),
    h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--bad)", text:String(cnt("review")) }), h("span", { text:"복습 필요" })),
    h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--help)", text:String(cnt("assisted")) }), h("span", { text:"정답 보고만 풂" })),
    h("div", { class:"tile" }, h("b", { class:"num", style:"color:var(--read)", text:String(cnt("readcheck")) }), h("span", { text:"읽은 직후만 풂" })),
    h("div", { class:"tile" }, h("b", { class:"num", text:String(cnt("new")) }), h("span", { text:"안 풀어봄" })),
    h("div", { class:"tile" }, h("b", { class:"num", text: acc == null ? "–" : acc + "%" }), h("span", { text:`자동 채점 정답률 (${graded.length}회)` }))
  ));
  const tbody = h("tbody");
  deck.items.forEach((it, idx) => {
    const o = deck.objectives.find(x => x.id === it.objectiveId);
    const evs = deck.events.filter(e => e.item === it.id && e.kind !== "reveal" && e.kind !== "report");
    const s = deck.sched[it.id];
    const status = STATUS[st[idx]];
    tbody.append(h("tr", null,
      h("td", null, h("div", { style:"font-weight:600", text:o ? o.statement : it.prompt }), h("div", { class:"small muted" }, `p.${it.page} · ${FORMAT_LABEL[it.format]} · `, h("button", { class:"linkish", onclick: () => openReader(deck.id, it.page, it.objectiveId) }, "원문"))),
      h("td", null, h("span", { class:`chip ${status.cls}`, text:status.label })),
      h("td", null, h("div", { class:"trail", title:"왼쪽이 오래된 기록" }, evs.slice(-14).map(e => {
        const ok = e.kind === "submit" ? e.correct : e.rating === "remembered";
        const cls = e.assisted ? "h" : e.afterReading ? (ok ? "c" : "r") : e.kind === "rate" ? (ok ? "s" : "r") : ok ? "g" : "r";
        return h("i", { class:cls, title: new Date(e.t).toLocaleString("ko-KR") });
      }))),
      h("td", { class:"n small", text: s && s.seen ? (s.due <= now() ? "지금" : fmtWhen(s.due)) : "–" })
    ));
  });
  wrap.append(h("div", { class:"table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, h("th", { text:"학습목표" }), h("th", { text:"상태" }), h("th", { text:"기록 (최근 14회)" }), h("th", { text:"다음 복습" }))),
    tbody
  )));
  wrap.append(h("div", { class:"legend" },
    h("span", { style:"--c:var(--good)", text:"자동 채점 정답" }),
    h("span", { style:"--c:var(--accent)", text:"자기평가: 떠올림" }),
    h("span", { style:"--c:var(--bad)", text:"못 떠올림" }),
    h("span", { style:"--c:var(--help)", text:"정답 본 뒤 풂 (셈에서 제외)" }),
    h("span", { style:"--c:var(--read)", text:"읽은 직후 맞힘 (셈에서 제외)" })
  ));
  const hiddenObjs = deck.objectives.filter(o => (deck.hidden || []).includes(o.id));
  const reportedItems = (deck.allItems || []).filter(it => deck.reported && deck.reported[it.id]);
  if (hiddenObjs.length || reportedItems.length){
    const restore = () => { applyFilters(deck); Store.save(deck); render(); };
    wrap.append(h("section", { class:"panel stack" },
      h("p", { class:"eyebrow", text:"연습에서 뺀 것" }),
      hiddenObjs.length ? h("div", { class:"itemlist" }, hiddenObjs.map(o => h("div", { class:"item" },
        h("div", { class:"meta" }, h("span", { class:"chip", text:"뺀 목표" }), h("span", { class:"chip page", text:"p." + o.pages.join(",") })),
        h("p", { text:o.statement }),
        h("div", null, h("button", { class:"btn small", onclick: () => { deck.hidden = deck.hidden.filter(x => x !== o.id); restore(); } }, "다시 넣기"))))) : null,
      reportedItems.length ? h("div", { class:"itemlist" }, reportedItems.map(it => h("div", { class:"item" },
        h("div", { class:"meta" }, h("span", { class:"chip help", text:`신고 · ${deck.reported[it.id].reason}` }), h("span", { class:"chip page", text:"p." + it.page })),
        h("p", null, richText(it.prompt)),
        h("div", null, h("button", { class:"btn small", onclick: () => { delete deck.reported[it.id]; restore(); } }, "신고 취소"))))) : null,
      reportedItems.length && !deck.example ? h("div", { class:"row" },
        h("button", { class:"btn small primary", disabled:!engine, onclick: () => remakeReported(deck) }, "신고한 문제의 목표 다시 만들기"),
        h("span", { class:"small muted", text:"앞의 학습 설계를 그대로 쓰고, 신고한 문제의 목표만 새로 만들어요." })) : null,
      h("p", { class:"small muted", text:"신고한 문제는 품질 근거로 남아요." })));
  }
  wrap.append(h("p", { class:"small muted", text:"‘3일 이상 혼자 맞힘’은 서로 다른 3일에 정답을 보기 전 스스로 맞힌 경우예요. 숙달했다는 판정이 아니라, 지금까지의 근거를 그대로 보여주는 표시입니다." }));
  return wrap;
}
/* ----- 새 자료: PDF → 짧은 질문 → "이렇게 만들게요" → 바로 읽기 (docs/DECISIONS.md, 2026-09-29 앱 전체 흐름).
   Reading the PDF runs in the browser. Generation is one queued request that the assigned AI runs through MCP
   (env.builder); the material is readable right away and its questions attach when the AI has recorded them. ----- */
const engine = env.builder || null;
/* ChatGPT sign-in for in-app generation (docs/DECISIONS.md 2026-09-30). Only shown when the host says it applies. */
const account = env.account || null;
async function loadAccount(){
  if (!account) return;
  try{ S.account = await account.status(); }catch{ S.account = null; }
  if (!disposed && S.view === "create") render();
}
async function connectAccount(){
  try{ await account.connect(); }catch(e){ toast((e && e.message) || "ChatGPT 연결을 시작하지 못했어요."); }
}
async function disconnectAccount(){
  try{ await account.disconnect(); toast("ChatGPT 연결을 해제했어요."); }catch(e){ toast((e && e.message) || "연결을 해제하지 못했어요."); }
  loadAccount();
}
function accountNote(){
  const a = S.account;
  if (!account || !a || !a.show) return null;
  return a.ready
    ? h("div", { class:"note row", role:"status" }, h("span", { style:"flex:1;min-width:0", text:a.message }),
        h("button", { class:"btn small ghost", onclick:disconnectAccount }, "연결 해제"))
    : h("div", { class:"note warn row", role:"status" }, h("span", { style:"flex:1;min-width:0", text:a.message }),
        h("button", { class:"btn small", onclick:connectAccount }, "ChatGPT 연결"));
}
const PURPOSES = [["exam", "시험 대비"], ["class", "수업 따라가기"], ["understand", "개념 이해"], ["apply", "실제로 써먹기"]];
const ABILITIES = ["용어·정의 말하기", "식·절차 쓰기", "계산·적용하기", "비슷한 것 구별하기", "말로 설명하기"];
function freshBuilder(){ return { pages:[], sourceName:"", from:1, to:1, purpose:"exam", abilities:[], summary:"", edited:false, busy:false, status:"", error:"", file:null, pdfDoc:null, sections:[], picked:[] }; }
/* Range picking without any AI call: the PDF's own bookmarks, or each page's first line when it has none. */
async function readSections(doc, pages){
  const flat = [];
  try{
    const walk = async (items, level) => {
      for (const it of items || []){
        let dest = it.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]){
          const page = typeof dest[0] === "number" ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
          if (it.title && it.title.trim()) flat.push({ title:it.title.trim(), start:page, level });
        }
        if (level < 1) await walk(it.items, level + 1);
      }
    };
    await walk(await doc.getOutline(), 0);
  }catch(e){ flat.length = 0; }
  const fromOutline = flat.length >= 2;
  const list = fromOutline ? flat.sort((a, b) => a.start - b.start)
    : pages.filter(p => p.text.trim()).map(p => ({ title:p.text.split("\n")[0].trim().slice(0, 60), start:p.n, level:0 }));
  return list.map((sec, i) => {
    const next = list.slice(i + 1).find(x => x.level <= sec.level);
    return { ...sec, end: Math.max(sec.start, (next ? next.start - 1 : pages.length)), fromOutline };
  });
}
function applyPicked(){
  const b = S.builder;
  const chosen = b.picked.map(i => b.sections[i]).filter(Boolean);
  if (chosen.length){ b.from = Math.min(...chosen.map(x => x.start)); b.to = Math.max(...chosen.map(x => x.end)); }
  else { b.from = 1; b.to = b.pages.length; }
  syncSummary();
}
async function readPdf(file){
  const b = S.builder;
  b.busy = true; b.error = ""; b.status = "PDF를 읽는 중…"; render();
  try{
    if (!pdfjs) pdfjs = await env.loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported:false }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++){
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let text = "";
      for (const it of tc.items){ if (typeof it.str !== "string") continue; text += it.str; text += it.hasEOL ? "\n" : " "; }
      pages.push({ n, text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() });
      if (n % 5 === 0){ b.status = `PDF를 읽는 중… ${n}/${doc.numPages}쪽`; render(); }
    }
    b.pages = pages; b.sourceName = file.name; b.from = 1; b.to = pages.length; b.file = file; b.pdfDoc = doc; b.edited = false;
    b.sections = await readSections(doc, pages); b.picked = [];
    syncSummary();
  }catch(e){
    b.error = "PDF를 읽지 못했어요. 암호가 걸렸거나 손상된 파일일 수 있어요.";
  }finally{ b.busy = false; b.status = ""; render(); }
}
function planSentence(){
  const b = S.builder;
  const purpose = (PURPOSES.find(x => x[0] === b.purpose) || PURPOSES[0])[1];
  const range = b.from === 1 && b.to === b.pages.length ? "전체를" : `${b.from}~${b.to}쪽을`;
  const can = b.abilities.length ? `${b.abilities.join(", ")}를 할 수 있게` : "핵심을 스스로 떠올릴 수 있게";
  return `${range} ${purpose}로 공부해요. ${can} 문제를 만들어 주세요. 원문의 기호와 용어는 바꾸지 않아요.`;
}
function syncSummary(){ const b = S.builder; if (!b.edited) b.summary = planSentence(); }

/* pending material: readable now, questions later */
function pendingDeck(rec){
  return { id:rec.id, pending:rec, title:rec.title, sourceName:rec.sourceName, sourceCatalogId:rec.sourceId, pageCount:rec.pageCount,
    createdAt:rec.createdAt, example:false, items:[], allItems:[], objectives:[], pages:[], events:[], sched:{}, hidden:[], reported:{}, lastPage:rec.lastPage || 0, skipped:[] };
}
function savePending(){ Store.savePending(Object.values(S.decks).filter(d => d.pending).map(d => ({ ...d.pending, lastPage:d.lastPage }))); }
async function startMaterial(){
  const b = S.builder; if (b.busy || !engine || !b.file || !b.summary.trim()) return;
  b.busy = true; b.error = ""; b.status = "PDF를 등록하고 요청을 올리는 중…"; render();
  try{
    const res = await engine.start({ file:b.file, from:b.from, to:b.to, purpose:b.summary.trim(), answers:{ purpose:b.purpose, abilities:b.abilities.slice() } });
    const rec = { id:"pending:" + res.requestId, requestId:res.requestId, sourceId:res.sourceId, title:b.sourceName.replace(/\.pdf$/i, ""), sourceName:b.sourceName,
      pageCount:b.pages.length, from:b.from, to:b.to, purpose:b.summary.trim(), createdAt:now(), status:"waiting", message:"" };
    const deck = pendingDeck(rec);
    S.decks[deck.id] = deck;
    if (b.pdfDoc) S.pdf[deck.id] = { status:"ready", doc:b.pdfDoc, canv:{}, aspect: await docAspect(b.pdfDoc) };
    savePending();
    S.builder = freshBuilder();
    toast("요청을 올렸어요. 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 하면 문제가 만들어져요. 그동안 읽어 두세요.");
    openReader(deck.id, rec.from);
    pollPending();
  }catch(e){
    b.busy = false; b.status = ""; b.error = (e && e.message) || "요청을 올리지 못했어요."; render();
  }
}
async function remakeReported(deck){
  if (!engine) return;
  const objectiveIds = [...new Set((deck.allItems || []).filter(it => deck.reported && deck.reported[it.id]).map(it => it.objectiveId))];
  try{
    const res = await engine.remake({ artifactId:deck.id, objectiveIds });
    const rec = { id:"pending:" + res.requestId, requestId:res.requestId, sourceId:res.sourceId, title:`${deck.title} · 다시 만든 문제`, sourceName:deck.sourceName,
      pageCount:deck.pageCount, from:res.from, to:res.to, purpose:res.purpose, createdAt:now(), status:"waiting", message:"", remake:{ artifactId:deck.id, objectiveIds } };
    S.decks[rec.id] = pendingDeck(rec); savePending();
    toast("다시 만들기 요청을 올렸어요. 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 해 주세요. 새 문제는 따로 자료로 붙어요.");
    setView("practice"); pollPending();
  }catch(e){ toast((e && e.message) || "다시 만들기 요청을 올리지 못했어요."); }
}
async function restartMaterial(d){
  if (!engine) return;
  const rec = d.pending;
  try{
    const res = rec.remake ? await engine.remake(rec.remake) : await engine.restart({ requestId:rec.requestId, sourceId:rec.sourceId, from:rec.from, to:rec.to, purpose:rec.purpose });
    Object.assign(rec, { requestId:res.requestId, status:"waiting", message:"" });
    savePending(); render(); pollPending();
  }catch(e){ toast((e && e.message) || "다시 요청하지 못했어요."); }
}
function removePending(d){ delete S.decks[d.id]; savePending(); if (S.reader.deckId === d.id) S.reader.deckId = null; render(); }
async function resumeMaterial(d){
  try{
    await engine.resume(d.pending.requestId);
    Object.assign(d.pending, { status:"running", message:"" });
    savePending(); render(); pollPending();
  }catch(e){ toast(e.message || "다시 시작하지 못했어요."); }
}
const PENDING_LABEL = { waiting:"AI 실행 대기", running:"AI가 만드는 중", paused:"잠시 멈춤", authoring:"문제 검사·기록 중", ready:"준비됨", failed:"실패" };
let pollTimer = null;
async function pollPending(){
  clearTimeout(pollTimer);
  if (disposed || !engine) return;
  const list = Object.values(S.decks).filter(d => d.pending && d.pending.status !== "failed");
  if (!list.length) return;
  let changed = false, ready = false;
  for (const d of list){
    let next;
    try{ next = await engine.check(d.pending.requestId); }
    catch(e){ next = { status:d.pending.status, message:(e && e.message) || "상태를 확인하지 못했어요." }; }
    if (disposed) return;
    if (next.status !== d.pending.status || (next.message || "") !== d.pending.message) changed = true;
    Object.assign(d.pending, { status:next.status, message:next.message || "", artifactId:next.artifactId || d.pending.artifactId });
    if (next.status === "ready") ready = true;
  }
  if (ready) await reloadDecks();
  if (changed || ready){ savePending(); if (!S.session && S.view !== "create") render(); }
  pollTimer = setTimeout(pollPending, 5000);
}
function pendingNote(d){
  const p = d.pending;
  const text = p.message || (p.status === "waiting" ? "AI 실행 대기 중 · 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 해 주세요" : PENDING_LABEL[p.status] || "");
  return h("div", { class:`note row${p.status === "failed" ? " err" : ""}`, role:"status" },
    h("span", { style:"flex:1;min-width:0", text: p.status === "failed" ? `문제 만들기 실패 · ${text}` : `문제 준비 중 · ${text}` }),
    p.status === "paused" && account && S.account && S.account.show && !S.account.ready ? h("button", { class:"btn small", onclick:connectAccount }, "ChatGPT 연결") : null,
    p.status === "paused" && engine && engine.resume ? h("button", { class:"btn small", onclick: () => resumeMaterial(d) }, "다시 시작") : null,
    p.status === "failed" ? h("button", { class:"btn small", onclick: () => restartMaterial(d) }, "다시 요청") : null,
    p.status === "failed" || p.status === "paused" ? h("button", { class:"btn small ghost", onclick: () => removePending(d) }, "지우기") : null);
}

function renderBuilder(){
  const b = S.builder;
  const wrap = h("div", { class:"stack" });
  const step = b.pages.length ? 2 : 1;
  wrap.append(h("ol", { class:"steps" },
    h("li", { "data-on": step === 1 ? "true" : "false", "data-done": step > 1 ? "true" : "false" }, "자료 올리기"),
    h("li", { "data-on": step === 2 ? "true" : "false" }, "방향 정하기"),
    h("li", { "data-on":"false" }, "읽기 시작")));
  if (!engine) wrap.append(h("div", { class:"note warn", text:"이 화면에서는 생성 요청을 보낼 수 없어요. 로컬 실험 모드에서 열어 주세요." }));
  const acc = accountNote(); if (acc) wrap.append(acc);
  if (b.error) wrap.append(h("div", { class:"note err", role:"alert", text:b.error }));
  if (b.status) wrap.append(h("div", { class:"note", role:"status", text:b.status }));

  const drop = h("div", { class:"drop", id:"drop" },
    h("strong", { text: b.pages.length ? `${b.sourceName} · ${b.pages.length}쪽` : "PDF를 끌어다 놓거나 골라 주세요" }),
    h("span", { class:"small muted", text:"올리자마자 읽을 수 있어요. 문제는 AI가 뒤에서 만들어 붙여요." }),
    h("label", { class:"btn", for:"pdf" }, b.pages.length ? "다른 PDF 고르기" : "PDF 고르기"),
    h("input", { id:"pdf", type:"file", accept:"application/pdf", class:"hidden", disabled:b.busy, onchange:(e) => { const f = e.target.files[0]; if (f) readPdf(f); } }));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.dataset.over = "true"; });
  drop.addEventListener("dragleave", () => { drop.dataset.over = "false"; });
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.dataset.over = "false"; const f = e.dataTransfer.files[0]; if (f && /pdf$/i.test(f.name)) readPdf(f); });
  wrap.append(h("section", { class:"panel stack" }, drop));
  if (!b.pages.length) return wrap;

  const chips = (options, isOn, toggle) => h("div", { class:"chat-sugs" }, options.map(([key, label]) =>
    h("button", { class:"chip-btn", "aria-pressed": isOn(key) ? "true" : "false", disabled:b.busy, onclick: () => { toggle(key); syncSummary(); render(); } }, label)));
  const from = h("input", { type:"number", id:"from", min:"1", max:String(b.pages.length), style:"width:90px" });
  const to = h("input", { type:"number", id:"to", min:"1", max:String(b.pages.length), style:"width:90px" });
  from.value = String(b.from); to.value = String(b.to);
  const upd = () => { b.picked = []; b.from = Math.max(1, Math.min(Number(from.value) || 1, b.pages.length)); b.to = Math.max(b.from, Math.min(Number(to.value) || b.pages.length, b.pages.length)); syncSummary(); render(); };
  from.addEventListener("change", upd); to.addEventListener("change", upd);
  const summary = h("textarea", { id:"summary", rows:"3" });
  summary.value = b.summary;
  summary.addEventListener("input", () => { b.summary = summary.value; b.edited = true; const s = root.querySelector("#startBtn"); if (s) s.disabled = b.busy || !engine || !b.summary.trim(); });
  const empty = b.pages.filter(p => !p.text.trim()).length;
  wrap.append(h("section", { class:"panel stack" },
    h("div", null, h("p", { class:"eyebrow", text:"방향 정하기" }), h("h2", { style:"font-size:18px;margin-top:2px", text:"어떻게 공부할지 알려 주세요" }),
      empty ? h("p", { class:"small muted", text:`글자가 없는 쪽 ${empty}개는 그림·스캔이라 AI가 글로 읽지 못할 수 있어요.` }) : null),
    h("div", { class:"field" }, h("label", { text:"1. 무엇을 위해 공부하나요?" }),
      chips(PURPOSES, (k) => b.purpose === k, (k) => { b.purpose = k; })),
    h("div", { class:"field" }, h("label", { text:"2. 공부하고 나면 무엇을 할 수 있어야 하나요? (여러 개)" }),
      chips(ABILITIES.map(x => [x, x]), (k) => b.abilities.includes(k), (k) => { b.abilities = b.abilities.includes(k) ? b.abilities.filter(x => x !== k) : [...b.abilities, k]; })),
    h("div", { class:"field" }, h("label", { text:"3. 범위" }),
      h("div", { class:"row" }, h("span", { class:"small muted", text:"시작 쪽" }), from, h("span", { class:"small muted", text:"끝 쪽" }), to,
        h("button", { class:"btn small ghost", disabled:b.busy, onclick: () => { b.picked = []; applyPicked(); render(); } }, "전체")),
      b.sections.length ? h("details", { open: b.picked.length ? true : null },
        h("summary", { class:"small", text: `${b.sections[0].fromOutline ? "목차" : "쪽 제목"}에서 고르기${b.picked.length ? ` · ${b.picked.length}개 선택` : ""}` }),
        h("div", { class:"sections" }, b.sections.map((sec, i) => h("button", { class:"chip-btn", style: sec.level ? "margin-left:14px" : null,
          "aria-pressed": b.picked.includes(i) ? "true" : "false", disabled:b.busy,
          onclick: () => { b.picked = b.picked.includes(i) ? b.picked.filter(x => x !== i) : [...b.picked, i]; applyPicked(); render(); } },
          h("span", { class:"num small", text: sec.start === sec.end ? `p.${sec.start} ` : `p.${sec.start}–${sec.end} ` }), sec.title))),
        h("p", { class:"small muted", text:"여러 개를 고르면 처음부터 끝까지 이어진 범위로 요청해요." })) : null),
    h("div", { class:"field" }, h("label", { for:"summary", text:"이렇게 만들게요" }), summary,
      h("span", { class:"small muted", text: b.edited ? "직접 고친 문장으로 요청해요." : "위에서 고르면 문장이 바뀌어요. 직접 고쳐도 돼요." })),
    h("div", { class:"row" },
      h("button", { class:"btn primary", id:"startBtn", disabled: b.busy || !engine || !b.summary.trim(), onclick:startMaterial }, "읽기 시작"),
      h("span", { class:"small muted", text:"요청을 올리고 바로 읽기로 넘어가요. 문제는 AI가 만들면 쪽마다 붙어요." }))));
  return wrap;
}

/* ---------- boot ---------- */
function reloadDecks(){
  return env.loadDecks().then((decks) => {
    if (disposed) return;
    const ids = new Set(decks.map(d => d.id));
    for (const id of Object.keys(S.decks)) if (!ids.has(id) && !S.decks[id].example && !S.decks[id].pending) delete S.decks[id];
    for (const d of decks){
      const prev = S.decks[d.id];
      if (prev && prev.artifactSha256 === d.artifactSha256) continue;   // keep the live deck (and its in-memory session refs)
      const deck = { ...d, example:false, createdAt:-d.order, pages:[], events:[], sched:{} };
      Store.restore(deck);
      S.decks[deck.id] = deck;
    }
    // a pending material whose questions are now recorded becomes that document; carry the reading position over
    for (const p of Object.values(S.decks).filter(x => x.pending && x.pending.artifactId && S.decks[x.pending.artifactId])){
      const real = S.decks[p.pending.artifactId];
      if (!real.lastPage && p.lastPage){ real.lastPage = p.lastPage; Store.save(real); }
      if (S.reader.deckId === p.id) S.reader.deckId = real.id;
      delete S.decks[p.id];
      toast(`‘${real.title}’ 문제가 준비됐어요. 읽던 쪽에 확인 문제가 붙었어요.`);
    }
    if (decks.length || Object.values(S.decks).some(x => x.pending)) delete S.decks.example;
    else if (!S.decks.example){ const ex = exampleDeck(); Store.restore(ex); S.decks[ex.id] = ex; }
    S.lib = { status:"ready", error:"" };
  }, (e) => {
    if (disposed) return;
    if (!Object.keys(S.decks).length){ const ex = exampleDeck(); Store.restore(ex); S.decks[ex.id] = ex; }
    S.lib = { status:"error", error:(e && e.message) || "Recaller 문제를 불러오지 못했어요." };
  }).then(() => { if (!disposed && !S.session) render(); });
}
Store.init();
for (const rec of Store.pendingList()) if (rec && rec.id && rec.requestId) S.decks[rec.id] = pendingDeck(rec);
updateStoreChip(); render();
pollPending();
loadAccount();
{
  // Back from the ChatGPT sign-in page (/study?chatgpt=connected|connection-failed). Kept for one tick so a
  // development double mount still shows it.
  const params = new URLSearchParams(location.search);
  if (params.get("chatgpt")){
    signInOutcome = params.get("chatgpt");
    params.delete("chatgpt");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
    setTimeout(() => { signInOutcome = null; }, 0);
  }
  const outcome = signInOutcome;
  if (outcome){
    toast(outcome === "connected" ? "ChatGPT 계정을 연결했어요." : "ChatGPT 연결에 실패했어요. 다시 시도해 주세요.");
    setView("create");
  }
}
ensureKatex().then(ok => { if (ok && !disposed) render(); });
reloadDecks();

return () => {
  disposed = true;
  listeners.abort();
  if (Chat.ctl) Chat.ctl.abort();
  clearTimeout(pollTimer);
  for (const P of Object.values(S.pdf)) if (P.doc) P.doc.destroy();
  root.querySelectorAll("#toast, .chatwin").forEach(el => el.remove());
  delete root.dataset.view;
};
}
