/* 되짚기 화면(협업/되짚기/되짚기_최신_v9.html)을 Recaller에 옮긴 것.
   화면·흐름·기록 규칙은 원본을 따르고, 문제 생성은 하지 않는다. 문제는 Recaller 출제 문서를 env.loadDecks()로 받는다.
   env: see dejipgi-app.d.ts. env.builder (objective design, authoring, save) and env.ask are left unset on purpose. */
let signInOutcome = null;
/** Display only: identical generated titles need a stable handle, not a renamed source or new study identity. */
export function deckDisplayTitle(deck, peers){
  if (!/^gen_[a-f0-9]{32}$/.test(deck.id) || !peers.some(other => other.id !== deck.id && other.title === deck.title)) return deck.title;
  // Same title made more than once: show when it was made (a person reads "10/18 03:12", not an ID).
  const when = (d) => { if (!(d.madeAt > 0)) return ""; const t = new Date(d.madeAt), p = (n) => String(n).padStart(2, "0");
    return `${t.getMonth() + 1}/${t.getDate()} ${p(t.getHours())}:${p(t.getMinutes())} 생성`; };
  const mine = when(deck);
  if (mine && !peers.some(other => other.id !== deck.id && other.title === deck.title && when(other) === mine)) return `${deck.title} · ${mine}`;
  const short = deck.id.slice(4, 12);
  const collision = peers.some(other => other.id !== deck.id && other.title === deck.title && other.id.slice(4, 12) === short);
  return `${deck.title} · ${mine ? mine + " · " : ""}자료 ${collision ? deck.id.slice(4) : short}`;
}
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
/* Review gap for a box, stretched or shortened by the learner's "아는 게 자꾸 나와요 / 금방 잊어요" feedback (prefs.intervalScale). */
function gap(box){ const k = (typeof S !== "undefined" && S.plan && S.plan.prefs && S.plan.prefs.intervalScale) || 1; return Math.round(INTERVALS[box] * Math.min(2, Math.max(0.5, k))); }

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
  // A changed document gets a fresh record; the old one stays under its own hash. New-engine materials (gen_…) grow
  // section by section with stable question IDs, so their record is kept per material instead (리허설 2026-10-12:
  // records and reports vanished each time a section was added).
  pkey(deck){ return deck.id + "@" + (String(deck.id).startsWith("gen_") ? "live" : (deck.artifactSha256 || "example")); },
  all(){ if (this.mode !== "local") return {}; try{ return JSON.parse(localStorage.getItem(this.key) || "{}"); }catch(e){ return {}; } },
  restore(deck){
    const all = this.all();
    let saved = all[this.pkey(deck)];
    if (!saved && String(deck.id).startsWith("gen_")){
      // Records saved before this fix sit under a section-count hash: take the most recent one.
      const old = Object.entries(all).filter(([k]) => k.startsWith(deck.id + "@")).map(([, v]) => v).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      saved = old[0];
    }
    saved = saved || {};
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
    this.schedulePush();
  },
  /* Subjects and exam dates, and which material belongs to which subject. Kept as one more entry of the records map
     (PLAN), so it travels to the other computer and merges by save time like a material's record. */
  PLAN:"__plan",
  plan(){
    const p = this.all()[this.PLAN];
    return { subjects: p && Array.isArray(p.subjects) ? p.subjects.filter(s => s && typeof s.name === "string") : [], of: p && p.of && typeof p.of === "object" ? p.of : {} };
  },
  savePlan(plan){
    if (this.mode !== "local") return;
    try{ const all = this.all(); all[this.PLAN] = { subjects:plan.subjects, of:plan.of, savedAt:now() }; localStorage.setItem(this.key, JSON.stringify(all)); }
    catch(e){ toast("과목 설정을 저장하지 못했어요."); }
    this.schedulePush();
  },
  pendingList(){ if (this.mode !== "local") return []; try{ const v = JSON.parse(localStorage.getItem(this.key + ":pending") || "[]"); return Array.isArray(v) ? v : []; }catch(e){ return []; } },
  savePending(list){ if (this.mode !== "local") return; try{ localStorage.setItem(this.key + ":pending", JSON.stringify(list)); }catch(e){} this.schedulePush(); },
  /* Records also live in the data folder (env.records), so another computer sharing that folder sees the same history.
     The newer save of each material wins; pending materials are joined by id. */
  pushTimer:null,
  schedulePush(){
    if (!env.records || this.mode !== "local") return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => { env.records.save({ records:this.all(), pending:this.pendingList(), updatedAt:now() }).catch(() => {}); }, 1500);
  },
  async pull(){
    if (!env.records || this.mode !== "local") return false;
    let remote = null;
    try{ remote = await env.records.load(); }catch(e){ return false; }
    if (!remote) return false;
    const local = this.all(); let changed = false;
    for (const [k, v] of Object.entries(remote.records || {})){
      if (!local[k] || ((v && v.savedAt) || 0) > (local[k].savedAt || 0)){ local[k] = v; changed = true; }
    }
    const pend = this.pendingList(); const ids = new Set(pend.map(p => p && p.id));
    for (const p of remote.pending || []) if (p && p.id && !ids.has(p.id)){ pend.push(p); changed = true; }
    try{ localStorage.setItem(this.key, JSON.stringify(local)); localStorage.setItem(this.key + ":pending", JSON.stringify(pend)); }catch(e){ return false; }
    return changed;
  }
};
// Objectives the learner took out and questions they reported stay in the document but leave practice and review.
function applyFilters(deck){
  const hidden = new Set(deck.hidden || []);
  // "핵심만" (end-of-session feedback "너무 꼼꼼·지엽적"): support objectives of this material leave practice too.
  const p = typeof S !== "undefined" && S.plan && S.plan.prefs;
  const coreOnly = p && p.detail && p.detail[deck.sourceCatalogId || deck.id] === "core";
  const support = coreOnly ? new Set((deck.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").map(o => o.id)) : null;
  deck.items = (deck.allItems || deck.items).filter(it => !hidden.has(it.objectiveId) && !(deck.reported && deck.reported[it.id]) && !(support && support.has(it.objectiveId)));
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
  reader:{ deckId:null, page:1, active:null, zoom:false, attachErr:"", attachBusy:false,
    panel:"ask", peek:null, badge:new Set(), snap:null, pulse:new Set(), terms:{ key:"", list:[] } },
  pdf:{},
  lib:{ status:"loading", error:"" },
  builder:freshBuilder(),
  account:null,
  plan:{ subjects:[], of:{} },
  planEdit:null,            // null | "new" | subject name being edited (home)
  sum:{ subject:null, weakOnly:false, hide:false, shown:new Set() },
  rules:null, rulesWarnings:[], patches:{}, hideSuggest:null, gapMarks:new Set()
};

/* ---------- scheduling & status ---------- */
function schedOf(deck, itemId){ return deck.sched[itemId] || (deck.sched[itemId] = { box:0, due:0, seen:false }); }
function isDue(deck, item, t = now()){ const s = deck.sched[item.id]; return !!(s && s.seen && s.due <= t); }
function isNew(deck, item){ const s = deck.sched[item.id]; return !s || !s.seen; }
function applyOutcome(deck, item, outcome){
  // outcome: "correct" | "wrong" | "unsure" | "assisted"
  const s = schedOf(deck, item.id); const t = now(); s.seen = true;
  if (outcome === "correct"){ s.box = Math.min(s.box + 1, INTERVALS.length - 1); s.due = t + gap(s.box); s.lastIndep = t; }
  else if (outcome === "unsure"){ s.due = t + DAY; }
  // Missed ones are only marked for now (사용자 결정 2026-10-12): no re-ask 10 minutes later, back in the next day's review.
  else if (outcome === "wrong"){ s.box = 0; s.due = t + DAY; }
  else if (outcome === "assisted"){ s.due = t + DAY; }
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

/* ---------- weak spots: the last try was missed, "잘 모름", or solved after seeing the answer ---------- */
function lastTry(deck, item){
  for (let i = deck.events.length - 1; i >= 0; i--){ const e = deck.events[i]; if (e.item === item.id && (e.kind === "submit" || e.kind === "rate" || e.kind === "reveal")) return e; }
  return null;
}
function isWeak(deck, item){
  const e = lastTry(deck, item); if (!e) return false;
  if (e.kind === "reveal" || e.assisted) return true;
  return e.kind === "submit" ? e.correct !== true : e.rating !== "remembered";
}
function missCount(deck, item){
  return deck.events.filter(e => e.item === item.id && (e.kind === "reveal" || (e.kind === "submit" && !e.correct) || (e.kind === "rate" && e.rating !== "remembered"))).length;
}
/* Objective status for the summary: weak beats everything, then never tried, then all solved alone. */
function objectiveState(deck, objectiveId){
  const its = deck.items.filter(i => i.objectiveId === objectiveId);
  if (!its.length) return "none";
  if (its.some(i => isWeak(deck, i))) return "weak";
  const st = its.map(i => itemStatus(deck, i));
  if (st.every(s => s === "new")) return "new";
  if (st.every(s => s === "recent" || s === "steady")) return "good";
  return "mid";
}

/* ---------- subjects & exam dates (S.plan); a material belongs by its registered PDF, so remakes follow it ---------- */
function planKey(d){ return d.sourceCatalogId || d.id; }
function subjectOf(d){ const name = S.plan.of[planKey(d)]; return name && S.plan.subjects.some(s => s.name === name) ? name : ""; }
function setSubject(d, name){ const old = subjectOf(d); if (name) S.plan.of[planKey(d)] = name; else delete S.plan.of[planKey(d)]; Store.savePlan(S.plan); if (old) touchMemory(old); if (name) touchMemory(name); render(); }
function examOf(name){ const s = S.plan.subjects.find(x => x.name === name); return s ? s.exam || "" : ""; }
function daysLeft(exam){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exam || ""); if (!m) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() - today.getTime()) / DAY);
}
function ddayLabel(n){ return n == null ? "" : n > 0 ? `D-${n}` : n === 0 ? "D-day" : "시험 끝"; }
/* Upcoming exams first (soonest first), then subjects without a date, then finished ones. */
function orderedSubjects(){
  const rank = (s) => { const n = daysLeft(s.exam); return n == null ? [1, 0] : n >= 0 ? [0, n] : [2, -n]; };
  return S.plan.subjects.slice().sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || a.name.localeCompare(b.name, "ko"); });
}
const byTitle = (a, b) => (a.example ? 1 : 0) - (b.example ? 1 : 0) || String(a.title).localeCompare(String(b.title), "ko", { numeric:true });
const displayTitle = deck => deckDisplayTitle(deck, Object.values(S.decks));
function decksOf(subject){ return Object.values(S.decks).filter(d => !d.pending && subjectOf(d) === subject).sort(byTitle); }
function weakList(decks){ return decks.flatMap(d => d.items.filter(it => isWeak(d, it)).map(it => ({ d, it, miss:missCount(d, it) }))); }
function addSubject(name, exam){
  name = String(name || "").trim().slice(0, 30);
  if (!name){ toast("과목 이름을 적어 주세요."); return false; }
  if (S.plan.subjects.some(s => s.name === name)){ toast("같은 이름의 과목이 있어요."); return false; }
  S.plan.subjects.push({ name, exam:exam || "" }); Store.savePlan(S.plan); return true;
}
function updateSubject(old, name, exam){
  name = String(name || "").trim().slice(0, 30);
  if (!name){ toast("과목 이름을 적어 주세요."); return false; }
  if (name !== old && S.plan.subjects.some(s => s.name === name)){ toast("같은 이름의 과목이 있어요."); return false; }
  const s = S.plan.subjects.find(x => x.name === old); if (!s) return false;
  s.name = name; s.exam = exam || "";
  if (name !== old) for (const k of Object.keys(S.plan.of)) if (S.plan.of[k] === old) S.plan.of[k] = name;
  Store.savePlan(S.plan); return true;
}
function removeSubject(name){
  S.plan.subjects = S.plan.subjects.filter(s => s.name !== name);
  for (const k of Object.keys(S.plan.of)) if (S.plan.of[k] === name) delete S.plan.of[k];
  Store.savePlan(S.plan);
}

/* ---------- 오늘 할 것 (env.planner = src/lib/study/plan.ts, rules from 학습규칙/오늘할것.md) ---------- */
const planner = env.planner || null;
function realDecks(){ return Object.values(S.decks).filter(d => !d.pending && !d.example); }
/* Phrases asked while reading, per registered PDF, for "물어봄" (loaded once per material at start). */
function notesBySource(){
  const out = {};
  for (const [k, v] of Object.entries(NT.src)) if (v && v.list) out[k] = v.list.map(n => ({ page:n.page, quote:n.quote, askedAt:n.askedAt, kind:n.kind }));
  return out;
}
function todayPlan(){
  if (!planner) return null;
  const decks = realDecks().sort(byTitle);
  if (!decks.length) return null;
  try{ return planner.today({ decks, settings:S.plan, notes:notesBySource(), rules:S.rules || undefined, now:now() }); }
  catch(e){ console.error(e); return null; }
}
const REASON = { weak:["약점", "bad"], asked:["물어봄", "ask"], due:["복습", ""], diagnose:["첫 훑기", "acc"], new:["새 문제", ""] };
const chunkSize = () => (S.rules && S.rules.chunk) || 20;
function startToday(){
  const plan = todayPlan();
  if (!plan || !plan.queue.length){ toast("오늘 할 문제가 없어요."); return; }
  const queue = plan.queue.slice(0, chunkSize()).map(r => ({ deck:r.deckId, item:r.itemId, reason:r.reason }));
  S.session = { queue, i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"today", viewed:new Set() };
  prepCurrent(); setView("practice");
}
function weekday(t){ return ["일","월","화","수","목","금","토"][new Date(t).getDay()]; }
function renderToday(plan, pendings){
  const left = plan.queue.length;
  const total = plan.doneToday + left;
  const minutesLeft = Math.round(plan.queue.reduce((sum, r) => { const d = S.decks[r.deckId]; const it = d && (d.allItems || d.items).find(x => x.id === r.itemId); return sum + ((S.rules && S.rules.seconds && it && S.rules.seconds[it.format]) || 40); }, 0) / 60);
  const d0 = new Date();
  const title = left ? (plan.doneToday ? "이어서 해요" : "오늘 할 것") : plan.doneToday ? "오늘 할 것을 마쳤어요" : pendings.length ? "문제를 만드는 동안 먼저 읽어 두세요" : "오늘은 할 문제가 없어요";
  const panel = h("section", { class:"panel today2" });
  panel.append(h("div", { class:"today2-head" },
    h("div", null,
      h("p", { class:"today2-date", text:`${d0.getMonth() + 1}월 ${d0.getDate()}일 ${weekday(d0)}요일` }),
      h("h2", { text:title }),
      h("p", { class:"small muted num", text: left
        ? `${left}문제 · 약 ${minutesLeft}분 남음${plan.doneToday ? ` · 오늘 ${plan.doneToday}문제 풂` : ""} · 하루 ${plan.budgetMinutes}분 기준`
        : plan.doneToday ? `오늘 ${plan.doneToday}문제를 풀었어요. 내일 할 것은 내일 아침에 다시 계산해요.` : "새 자료를 올리거나, 과목에 시험일을 넣어 보세요." })),
    h("div", { class:"row" },
      left ? h("button", { class:"btn primary big", "data-autofocus":"1", onclick:startToday }, plan.doneToday ? "이어서 하기" : "시작하기", h("span", { class:"btn-sub num", text:`${Math.min(left, chunkSize())}문제` })) : null,
      h("button", { class:"btn", onclick: () => setView("create") }, "+ 새 자료"))));
  if (total) panel.append(h("div", { class:"today2-bar", "aria-hidden":"true" }, h("i", { style:`width:${(plan.doneToday / total * 100).toFixed(1)}%` })));
  const rows = h("div", { class:"today2-rows" });
  for (const sp of plan.subjects){
    const picked = Object.values(sp.picked).reduce((a, b) => a + b, 0);
    if (!picked && sp.phase === "learn" && !sp.doneToday) continue;
    const chips = Object.entries(sp.picked).filter(([, n]) => n).map(([k, n]) => h("span", { class:`chip ${REASON[k][1]}`, text:`${REASON[k][0]} ${n}` }));
    const n = sp.daysLeft;
    const line = sp.phase === "over" ? "시험이 끝났어요. 이 과목은 오늘 할 것에서 빠져요."
      : sp.phase === "final" ? "시험 직전이에요. 새 문제 없이 약점과 복습, 한 장 정리만 해요."
      : sp.counts.fresh ? (sp.learnUntil ? `안 풀어본 ${sp.counts.fresh}문제를 하루 ${sp.quota}개씩 · ${Number(sp.learnUntil.slice(5, 7))}/${Number(sp.learnUntil.slice(8, 10))}까지 한 번씩 봐요` : `안 풀어본 ${sp.counts.fresh}문제 · 하루 ${sp.quota}개씩`)
      : sp.counts.items ? "모든 문제를 한 번 이상 풀었어요. 약점과 복습만 남았어요." : "";
    rows.append(h("div", { class:`today2-row${sp.phase === "final" ? " final" : ""}${sp.phase === "over" ? " over" : ""}` },
      h("span", { class:`dday-mid${n != null && n >= 0 && n <= 3 ? " soon" : ""}${n == null || n < 0 ? " past" : ""}`, text: n == null ? "—" : n > 0 ? `D-${n}` : n === 0 ? "D-day" : "끝" }),
      h("div", { class:"today2-main" },
        h("div", { class:"row", style:"gap:6px" }, h("b", { text:sp.name || "과목 미지정" }), ...chips),
        line ? h("p", { class:"small muted", text:line }) : null),
      h("div", { class:"today2-side" },
        picked ? h("span", { class:"small muted num", text:`약 ${sp.minutes}분` }) : sp.doneToday ? h("span", { class:"small good-text", text:"오늘 끝" }) : null,
        sp.phase === "final" && sp.name ? h("button", { class:"btn small", onclick: () => openSummary(sp.name) }, "한 장 정리") : null)));
  }
  if (rows.childNodes.length) panel.append(rows);
  for (const note of plan.notes) panel.append(h("p", { class:"small muted", text:note }));
  const coach = coachPanel(plan, pendings);
  if (coach) panel.append(coach);
  const mine = myAdjustments();
  if (mine) panel.append(mine);
  if (S.rulesWarnings.length) panel.append(h("p", { class:"small help-text", text:`학습규칙 확인: ${S.rulesWarnings.join(" / ")}` }));
  if (!S.plan.subjects.length) panel.append(h("p", { class:"small muted", text:"아래 ‘시험 과목’에 과목과 시험일을 넣으면 시험 날짜에 맞춰 하루 분량을 나눠요." }));
  return panel;
}

/* ---------- 빠른 고리 (학습규칙/품질.md, docs/품질_자동화.md): fixes in place, no model calls ---------- */
function rule(key, fallback){ return (S.rules && typeof S.rules[key] === "number") ? S.rules[key] : fallback; }
function stamp(){ return new Date().toISOString(); }
function ledger({ deck, item, objective, signal, action, cause, detail }){
  if (!env.quality || !env.quality.log) return;
  env.quality.log([{ at:stamp(), deck:deck.title, item:item ? item.id : undefined, objective: objective || (item ? item.objectiveId : undefined), signal, action, cause, detail: detail || undefined }])
    .then(() => { clearTimeout(ledgerTimer); ledgerTimer = setTimeout(loadPatchList, 1500); }, () => {});
}
let ledgerTimer = null;
function prefs(){ return S.plan.prefs || (S.plan.prefs = {}); }
function loadPatchList(){ if (env.quality && env.quality.list) env.quality.list().then((m) => { S.patches = (m && m.patches) || {}; S.qualityCounts = (m && m.counts) || {}; if (!disposed && !S.session && S.view !== "create") render(); }, () => {}); }
function savePrefs(msg){ Store.savePlan(S.plan); if (msg) toast(msg); render(); }
async function patchItem(deck, patch, entry, msg){
  if (!env.quality || !env.quality.patch) { toast("이 화면에서는 문제를 고칠 수 없어요."); return; }
  try{ await env.quality.patch(deck.id, patch, entry); toast(msg); loadPatchList(); await reloadDecks(); }
  catch(e){ toast((e && e.message) || "고치지 못했어요."); }
}
/* After "내 답도 맞아요": keep that spelling as correct from now on, or (when it keeps happening) make it a flashcard. */
function quickFix(deck, item, c){
  if (item.format !== "value" || !c.overridden || !c.text.trim() || c.fixed) return null;
  const times = deck.events.filter(e => e.item === item.id && e.override).length;
  const answer = c.text.trim();
  return h("div", { class:"quickfix" },
    h("span", { class:"small", text: times >= rule("cardAfterOverrides", 2) ? `이 문제에서 ‘내 답도 맞아요’가 ${times}번째예요. 표기가 여러 가지라 떠올리기 카드가 더 맞아 보여요.` : "다음부터 이 답도 정답으로 칠까요?" }),
    h("div", { class:"row" },
      h("button", { class:"btn small", onclick: () => { c.fixed = true; patchItem(deck, { kind:"accept", itemId:item.id, answer }, undefined, `‘${answer}’도 정답으로 쳐요.`); } }, "정답에 추가"),
      times >= rule("cardAfterOverrides", 2) ? h("button", { class:"btn small primary", onclick: () => { c.fixed = true; patchItem(deck, { kind:"card", itemId:item.id },
        { at:stamp(), deck:deck.title, item:item.id, objective:item.objectiveId, signal:`내 답도 맞아요 ${times}번`, action:"떠올리기 카드로 바꿈", cause:"형식선택" }, "떠올리기 카드로 바꿨어요. 기록 탭 ‘고친 것’에서 되돌릴 수 있어요."); } }, "카드로 바꾸기") : null));
}
/* One-tap feedback on the question itself. */
function itemFeedback(deck, item, c){
  if (c.feedback) return h("p", { class:"small muted", text:c.feedback });
  return h("div", { class:"row itemfb" }, h("span", { class:"small muted", text:"이 문제는" }),
    h("button", { class:"chip-btn", onclick: () => { c.feedback = "목표를 뺐어요. 비슷한 게 있으면 위에 보여요."; hideObjective(deck, item.objectiveId, "지엽"); } }, "너무 지엽적"),
    h("button", { class:"chip-btn", onclick: () => {
      const s = schedOf(deck, item.id); s.box = INTERVALS.length - 1; s.due = now() + gap(s.box); s.easy = true; Store.save(deck);
      ledger({ deck, item, signal:"너무 쉬워요", action:"가장 긴 복습 간격으로", cause:"너무쉬움" });
      c.feedback = `${fmtWhen(s.due)}에 다시 나와요.`; render(); } }, "너무 쉬움"));
}
function hideSuggestBar(){
  const g = S.hideSuggest; if (!g) return null;
  const d = S.decks[g.deckId]; if (!d){ S.hideSuggest = null; return null; }
  const list = g.ids.map(id => d.objectives.find(o => o.id === id)).filter(Boolean);
  if (!list.length){ S.hideSuggest = null; return null; }
  return h("section", { class:"panel suggest" },
    h("p", null, h("b", { text:`비슷한 목표 ${list.length}개도 뺄까요?` }), h("span", { class:"small muted", text:` ‘${g.from.slice(0, 40)}’를 뺐어요.` })),
    h("ul", { class:"small" }, list.slice(0, 6).map(o => h("li", { text:o.statement }))),
    h("div", { class:"row" },
      h("button", { class:"btn small primary", onclick: () => {
        d.hidden = [...new Set([...(d.hidden || []), ...g.ids])]; applyFilters(d); Store.save(d);
        ledger({ deck:d, signal:`비슷한 목표 ${g.ids.length}개`, action:"함께 뺌", cause: g.why === "지엽" ? "지엽" : "목표설계", detail:list.map(o => o.statement).join(" / ") });
        S.hideSuggest = null; toast(`${g.ids.length}개를 더 뺐어요. 기록 탭에서 다시 넣을 수 있어요.`); render(); } }, "모두 빼기"),
      h("button", { class:"btn small ghost", onclick: () => { S.hideSuggest = null; render(); } }, "그대로 두기")));
}
/* End-of-session feedback: each answer changes something right away and says what changed. */
const FEEDBACK = {
  amount:[["많았어요", -15], ["딱 좋아요", 0], ["더 할 수 있어요", 15]],
  repeat:[["아는 게 자꾸 나와요", 1.25], ["금방 잊어요", 0.8]],
};
function sessionFeedback(){
  const s = S.session; s.fb = s.fb || {};
  const decks = [...new Set(s.queue.map(q => q.deck))].map(id => S.decks[id]).filter(Boolean);
  const base = (S.rules && S.rules.dailyMinutes) || 90;
  const minutes = prefs().dailyMinutes || base;
  const group = (key, label, kids) => h("div", { class:"fbrow" }, h("span", { class:"small muted", text:label }), h("div", { class:"row" }, kids),
    s.fb[key] ? h("span", { class:"small good-text", text:s.fb[key] }) : null);
  s.fbPick = s.fbPick || {};
  const pick = (key, fn, label) => () => { if (s.fb[key]) return; s.fbPick[key] = label; s.fb[key] = fn(); render(); };
  const chosen = (key, label) => s.fbPick[key] === label ? "true" : "false";
  const supportOf = (d) => (d.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").length;
  return h("section", { class:"panel stack fb" },
    h("p", null, h("b", { text:"이번 풀이 어땠어요?" }), h("span", { class:"small muted", text:" 누르면 바로 반영돼요." })),
    group("amount", "하루 분량", FEEDBACK.amount.map(([label, delta]) => h("button", { class:"chip-btn", "aria-pressed":chosen("amount", label), disabled: s.fb.amount ? true : null, onclick: pick("amount", () => {
      if (!delta) return "지금 분량을 유지해요.";
      const next = Math.min(300, Math.max(20, minutes + delta)); prefs().dailyMinutes = next; savePrefs();
      ledger({ deck:{ title:"전체" }, signal:`분량: ${label}`, action:`하루 ${minutes}분 → ${next}분`, cause:"분량" });
      return `하루 ${minutes}분 → ${next}분. 오늘 할 것을 다시 계산했어요.`; }, label) }, label))),
    group("repeat", "복습 간격", FEEDBACK.repeat.map(([label, k]) => h("button", { class:"chip-btn", "aria-pressed":chosen("repeat", label), disabled: s.fb.repeat ? true : null, onclick: pick("repeat", () => {
      const cur = prefs().intervalScale || 1; const next = Math.round(Math.min(2, Math.max(0.5, cur * k)) * 100) / 100; prefs().intervalScale = next; savePrefs();
      ledger({ deck:{ title:"전체" }, signal:`간격: ${label}`, action:`복습 간격 ×${cur} → ×${next}`, cause:"간격" });
      return `복습 간격 ×${next}. 다음에 맞히는 문제부터 적용돼요.`; }, label) }, label))),
    group("content", "내용", [
      h("button", { class:"chip-btn", "aria-pressed":chosen("content", "지엽"), disabled: s.fb.content ? true : null, onclick: pick("content", () => {
        let n = 0;
        for (const d of decks){ if (!supportOf(d)) continue; (prefs().detail || (prefs().detail = {}))[planKey(d)] = "core"; n++; }
        for (const d of decks) ledger({ deck:d, signal:"내용: 너무 꼼꼼·지엽적", action: supportOf(d) ? "보조 목표 빼고 핵심만" : "바꿀 보조 목표 없음", cause:"지엽" });
        savePrefs(); for (const d of decks) applyFilters(d);
        return n ? `자료 ${n}개를 ‘핵심만’으로 바꿨어요. 정리 탭에서 되돌릴 수 있어요.` : "보조 목표가 따로 없는 자료예요. 문제의 ‘너무 지엽적’으로 하나씩 빼 주세요."; }, "지엽") }, "너무 꼼꼼·지엽적"),
      h("button", { class:"chip-btn", "aria-pressed":chosen("content", "빠짐"), disabled: s.fb.content ? true : null, onclick: pick("content", () => {
        for (const d of decks) ledger({ deck:d, signal:"내용: 빠진 게 많아요", action:"문제 없는 쪽을 정리 탭에 표시", cause:"빠뜨림" });
        const name = decks.length ? subjectOf(decks[0]) : ""; setTimeout(() => openSummary(name), 900);
        return "정리 탭에서 문제가 없는 쪽을 보여 드릴게요. 빠진 쪽을 누르면 기록돼요."; }, "빠짐") }, "빠진 게 많아요")]));
}
/* ---------- 앱 안의 코치 (src/lib/study/coach.ts): a few cards with one-tap actions; closing one hides it ---------- */
function coachPanel(plan, pendings){
  if (!env.coach) return null;
  let cards = [];
  try{
    cards = env.coach({ plan, rules:S.rules || {}, prefs:S.plan.prefs || {}, counts:S.qualityCounts || {},
      waiting: pendings.filter(p => p.pending && p.pending.status === "confirm").length,
      unassigned: S.plan.subjects.length ? realDecks().filter(d => !subjectOf(d)).length : 0,
      subjectsWithoutDate: S.plan.subjects.filter(s => !s.exam && decksOf(s.name).length).map(s => s.name) });
  }catch(e){ console.error(e); return null; }
  if (!cards.length) return null;
  const close = (id) => { (prefs().coachSeen || (prefs().coachSeen = {}))[id] = new Date().toISOString().slice(0, 10); savePrefs(); };
  const run = (card, a) => {
    if (a.do === "summary") openSummary(a.subject);
    else if (a.do === "weak") startWeak(a.subject);
    else if (a.do === "minutes"){ prefs().dailyMinutes = a.minutes; ledger({ deck:{ title:"전체" }, signal:"코치: 밀린 양", action:`하루 ${a.minutes}분으로`, cause:"분량" }); toast(`하루 ${a.minutes}분으로 바꿨어요.`); }
    else if (a.do === "subjects"){ S.planEdit = (S.plan.subjects.find(s => !s.exam) || {}).name || null; render(); requestAnimationFrame(() => { const el = document.querySelector(".subjects"); if (el) el.scrollIntoView({ behavior:"smooth", block:"center" }); }); return; }
    else if (a.do === "genNote"){ const cur = prefs().genNote || ""; prefs().genNote = cur ? `${cur}\n${a.text}` : a.text; S.builder.note = ""; S.builder.noteSeeded = false;
      ledger({ deck:{ title:"전체" }, signal:`코치: ${card.title}`, action:"다음 자료 메모에 추가", cause:card.id.split(":")[1] || "기타", detail:a.text }); toast("다음에 자료를 만들 때 메모에 들어가요."); }
    else if (a.do === "propose"){ ledger({ deck:{ title:"전체" }, signal:`코치 제안: ${card.title}`, action:"개선 후보로 올림", cause:a.cause, detail:a.text }); toast("개선 후보로 올렸어요. 시험 뒤 개선 라운드에서 비교해요."); }
    close(card.id);
  };
  return h("div", { class:"coach" }, cards.map(card => h("div", { class:`coach-card ${card.kind}` },
    h("div", { class:"coach-text" }, h("b", { text:card.title }), h("p", { class:"small muted", text:card.body })),
    h("div", { class:"row" }, card.actions.map(a => h("button", { class:"btn small", onclick: () => run(card, a) }, a.label)),
      h("button", { class:"btn small ghost", title:"이 안내 닫기", onclick: () => close(card.id) }, "닫기")))));
}
/* What the learner changed by feedback, with a way back to 학습규칙's defaults. */
function myAdjustments(){
  const p = S.plan.prefs || {};
  const parts = [];
  if (p.dailyMinutes) parts.push(`하루 ${p.dailyMinutes}분`);
  if (p.intervalScale && p.intervalScale !== 1) parts.push(`복습 간격 ×${p.intervalScale}`);
  const core = Object.keys(p.detail || {}).length; if (core) parts.push(`핵심만 자료 ${core}개`);
  if (p.genNote) parts.push("다음 자료 메모 있음");
  if (!parts.length) return null;
  return h("p", { class:"small muted" }, `내 조정: ${parts.join(" · ")} `, h("button", { class:"linkish", onclick: () => {
    const seenCards = p.coachSeen; S.plan.prefs = seenCards ? { coachSeen:seenCards } : {}; for (const d of realDecks()) applyFilters(d); savePrefs("학습규칙 기본값으로 돌렸어요."); } }, "기본값으로"));
}

/* ---------- 학습 메모 (study-memory/<과목>.md): rewritten after studying or changing subjects ---------- */
let memoryTimer = null;
const memoryDirty = new Set();
function touchMemory(subject){
  if (!env.memory || !planner || subject == null) return;
  if (subject) memoryDirty.add(subject); else for (const s of S.plan.subjects) memoryDirty.add(s.name);
  clearTimeout(memoryTimer);
  memoryTimer = setTimeout(() => {
    const list = [...memoryDirty]; memoryDirty.clear();
    for (const name of list){
      const decks = decksOf(name); if (!decks.length) continue;
      let auto;
      try{ auto = planner.memoryAuto({ subject:name, decks, settings:S.plan, notes:notesBySource(), now:now() }); }catch(e){ console.error(e); continue; }
      env.memory.save(name, auto).catch(() => {});
    }
  }, 2500);
}

/* ---------- views ---------- */
function setView(v){
  if (S.session && S.session.overlay && v !== "read") S.session = null;
  S.view = v;
  if (v !== "read" && Chat.isOpen() && typeof Chat !== "undefined"){ if (Chat.ctl) Chat.ctl.abort(); Chat.el.hidden = true; }
  if (v !== "read" && typeof Chat !== "undefined" && Chat.docked){ Chat.undock(); Explain.stop(); }
  root.dataset.view = v;
  if (v === "create") loadAccount();
  if (v !== "read" && typeof hideSel === "function"){ hideSel(); NT.drawer = false; paintDrawer(); }
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
  const bar = S.view !== "create" && !(S.session && S.session.phase === "ask") ? hideSuggestBar() : null;
  if (bar) app.append(bar);
  if (S.view === "practice") app.append(S.session ? renderSession() : renderHome());
  else if (S.view === "create") app.append(renderBuilder());
  else if (S.view === "read") {
    const typing = Chat.el && Chat.el.contains(document.activeElement);
    app.append(renderReader()); dockChat(typing); requestAnimationFrame(drawPage); if (Chat.isOpen()) Chat.paint(); paintDrawer();
    if (overlayCheck()){
      app.append(h("div", { class:"checklayer", role:"dialog", "aria-modal":"true", "aria-label":`p.${S.session.page} 확인 문제`,
        onclick: (e) => { if (e.target === e.currentTarget) closeCheck(); } }, h("div", { class:"checkbox" }, renderSession())));
      const f = app.querySelector(".checklayer [data-autofocus]");
      if (f && !f.disabled && !app.querySelector(".checklayer").contains(document.activeElement)) f.focus({ preventScroll:true });
    }
  }
  else if (S.view === "summary") app.append(renderSummary());
  else app.append(renderRecords());
  if (S.view === "practice" && S.session){
    const f = app.querySelector("[data-autofocus]");
    if (f && !f.disabled && (document.activeElement === document.body || !app.contains(document.activeElement))) f.focus({ preventScroll:true });
  }
}
/* 태블릿 모드: a button beside the save chip opens the pairing card (address + 6-digit code, 10 minutes). */
const TB = { open:false, code:null, expires:0, urls:[], devices:[], err:"", timer:null };
function tabletButton(){
  if (!env.tablet || document.getElementById("tabletBtn")) return;
  const store = document.getElementById("store"); if (!store) return;
  const btn = h("button", { class:"tablet-btn", id:"tabletBtn", title:"같은 와이파이의 태블릿에서 열기", onclick: () => toggleTablet() }, "📱 태블릿");
  store.parentNode.insertBefore(btn, store);
}
async function toggleTablet(force){
  TB.open = force ?? !TB.open; TB.err = "";
  if (TB.open){ try{ Object.assign(TB, await env.tablet.info()); }catch(e){ TB.err = e.message; } }
  paintTablet();
}
async function newTabletCode(){
  try{ const r = await env.tablet.code(); Object.assign(TB, { code:r.code, expires:r.expires, urls:r.urls, err:"" }); }catch(e){ TB.err = e.message; }
  paintTablet();
}
function paintTablet(){
  let el = document.getElementById("tabletCard");
  if (!TB.open){ if (el) el.remove(); clearInterval(TB.timer); TB.timer = null; return; }
  const left = Math.max(0, Math.round((TB.expires - Date.now()) / 1000));
  const live = TB.code && left > 0;
  const fresh = h("aside", { class:"tablet-card", id:"tabletCard", role:"dialog", "aria-label":"태블릿 연결" },
    h("div", { class:"row", style:"justify-content:space-between" }, h("strong", { text:"태블릿에서 열기" }),
      h("button", { class:"dclose", "aria-label":"닫기", onclick: () => toggleTablet(false) }, "✕")),
    h("ol", { class:"tablet-steps" },
      h("li", null, "태블릿을 이 컴퓨터와 ", h("b", { text:"같은 와이파이" }), "에 연결해요."),
      h("li", null, "태블릿 브라우저 주소창에 이렇게 쳐요:",
        TB.urls.length ? TB.urls.map((u, i) => h("div", { class:"tablet-url" + (i ? " alt" : ""), text:u })) : h("div", { class:"small muted", text:"이 컴퓨터의 와이파이 주소를 찾지 못했어요. 와이파이 연결을 확인해 주세요." }),
        TB.urls.length > 1 ? h("div", { class:"small muted", text:"첫 번째 주소가 안 열리면 아래 주소를 써 보세요." }) : null),
      h("li", null, "태블릿에 나온 칸에 이 코드를 넣어요:",
        live ? h("div", { class:"tablet-code" }, h("b", { text:TB.code.replace(/(\d{3})(\d{3})/, "$1 $2") }), h("span", { class:"small muted", text:` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} 남음` }))
          : h("button", { class:"btn primary small", style:"margin-top:6px", onclick:newTabletCode }, TB.code ? "새 코드 받기" : "연결 코드 받기"))),
    h("p", { class:"small muted", text:"한 번 연결한 태블릿은 다음부터 코드 없이 열려요. 기록은 이 컴퓨터에 저장돼서, 컴퓨터가 켜져 있고 앱이 떠 있어야 해요. 처음 한 번 Windows가 네트워크 허용을 물으면 ‘개인 네트워크’를 허용해 주세요." }),
    TB.devices.length ? h("div", { class:"row small", style:"justify-content:space-between" }, h("span", { class:"muted", text:`연결된 기기 ${TB.devices.length}대` }),
      h("button", { class:"linkish", onclick: async () => { try{ await env.tablet.revoke(); Object.assign(TB, { devices:[], code:null }); toast("모든 태블릿 연결을 끊었어요."); }catch(e){ TB.err = e.message; } paintTablet(); } }, "모두 끊기")) : null,
    TB.err ? h("p", { class:"check", text:TB.err }) : null);
  if (el) el.replaceWith(fresh); else root.append(fresh);
  if (live && !TB.timer) TB.timer = setInterval(() => { if (!TB.open || TB.expires < Date.now()){ clearInterval(TB.timer); TB.timer = null; } paintTablet(); }, 1000);
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
  const plan = todayPlan();
  if (plan && decks.some(d => !d.example)) wrap.append(renderToday(plan, pendings));
  else wrap.append(h("section", { class:"panel today" },
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
  // A material still being made whose first sections are ready shows as its real deck with the progress note.
  const growing = new Map(pendings.filter(p => p.pending.artifactId && S.decks[p.pending.artifactId]).map(p => [p.pending.artifactId, p]));
  for (const d of pendings){
    if (d.pending.artifactId && growing.has(d.pending.artifactId)) continue;
    wrap.append(h("article", { class:"deck" },
      h("div", null, h("h3", { text:d.title }), h("div", { class:"meta" }, h("span", { text:d.sourceName }), h("span", { class:`chip ${d.pending.status === "failed" ? "bad" : "acc"}`, text:PENDING_LABEL[d.pending.status] || "준비 중" }))),
      h("div", { class:"row" }, h("button", { class:"btn small primary", onclick: () => openReader(d.id, d.lastPage || d.pending.from || 1) }, d.lastPage ? `이어 읽기 p.${d.lastPage}` : "읽기")),
      h("div", { style:"grid-column:1/-1" }, pendingNote(d))));
  }
  const realDecks = decks.filter(d => !d.example);
  if (realDecks.length) wrap.append(subjectStrip());
  // Materials grouped by subject, the nearest exam first; materials without a subject come last.
  const groups = orderedSubjects().map(s => ({ name:s.name, list:decksOf(s.name) })).filter(g => g.list.length);
  const loose = decks.filter(d => !subjectOf(d)).sort(byTitle);
  if (loose.length) groups.push({ name:"", list:loose });
  for (const g of groups){
    const list = h("div", { class:"decks" });
    for (const d of g.list) list.append(deckCard(d, growing));
    wrap.append(g.name || groups.length > 1 ? h("section", { class:"subj-group" }, subjectHead(g.name, g.list), list) : list);
  }
  wrap.append(h("div", { class:"legend" },
    h("span", { style:"--c:var(--good)", text:"혼자 맞힘" }),
    h("span", { style:"--c:var(--bad)", text:"복습 필요" }),
    h("span", { style:"--c:var(--help)", text:"정답 보고 풂" }),
    h("span", { style:"--c:var(--read)", text:"읽은 직후만 풂" }),
    h("span", { style:"--c:var(--line)", text:"안 풀어봄" })
  ));
  if (S.lib.status === "loading") wrap.append(h("p", { class:"small muted", text:"Recaller 문제를 불러오는 중…" }));
  else if (S.lib.status === "error") wrap.append(h("div", { class:"note err", text:S.lib.error }));
  wrap.append(h("p", { class:"small muted" }, "정답을 보기 전에 스스로 떠올려 맞힌 것만 ‘혼자 맞힘’으로 셉니다. 한 번 맞혔다고 끝내지 않고, 간격을 늘려 가며 다시 물어봅니다."));
  return wrap;
}
/* Subjects with their exam date: chips to edit, "+ 과목" to add. Inline form, no browser dialogs. */
function subjectStrip(){
  const subs = orderedSubjects();
  const panel = h("section", { class:"panel subjects" });
  panel.append(h("div", { class:"row", style:"justify-content:space-between" },
    h("p", { class:"eyebrow", text:"시험 과목" }),
    S.planEdit ? null : h("button", { class:"btn small ghost", onclick: () => { S.planEdit = "new"; render(); } }, "+ 과목")));
  if (subs.length) panel.append(h("div", { class:"row subj-chips" }, subs.map(s => {
    const n = daysLeft(s.exam);
    return h("button", { class:"subj-chip", "aria-pressed": S.planEdit === s.name ? "true" : "false", title:"눌러서 이름·시험일 고치기", onclick: () => { S.planEdit = S.planEdit === s.name ? null : s.name; render(); } },
      h("b", { text:s.name }), n != null ? h("span", { class:`dday${n >= 0 && n <= 3 ? " soon" : ""}${n < 0 ? " past" : ""}`, text:ddayLabel(n) }) : h("span", { class:"dday past", text:"날짜 없음" }));
  })));
  else if (!S.planEdit) panel.append(h("p", { class:"small muted", text:"과목과 시험일을 넣으면 시험이 가까운 과목부터 모아 보여 주고, 과목별 약점 다시 풀기와 한 장 정리를 쓸 수 있어요." }));
  if (S.planEdit){
    const editing = S.planEdit !== "new" ? S.plan.subjects.find(s => s.name === S.planEdit) : null;
    const name = h("input", { type:"text", class:"answer-input", placeholder:"과목 이름 (예: 컴퓨터그래픽스)", maxlength:"30", style:"flex:1;min-width:160px;font-size:15px;padding:8px 11px" });
    const date = h("input", { type:"date", class:"answer-input", style:"width:auto;font-size:15px;padding:7px 10px" });
    name.value = editing ? editing.name : ""; date.value = editing ? editing.exam || "" : "";
    const save = () => { if (editing ? updateSubject(editing.name, name.value, date.value) : addSubject(name.value, date.value)){ S.planEdit = null; render(); } };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); save(); } });
    panel.append(h("div", { class:"row subj-form" }, name, h("label", { class:"row small muted", style:"gap:6px" }, "시험일", date),
      h("button", { class:"btn small primary", onclick:save }, editing ? "저장" : "추가"),
      h("button", { class:"btn small ghost", onclick: () => { S.planEdit = null; render(); } }, "취소"),
      editing ? h("button", { class:"btn small ghost danger", onclick: () => { removeSubject(editing.name); S.planEdit = null; render(); } }, "과목 지우기") : null));
    if (editing) panel.append(h("p", { class:"small muted", text:"과목을 지워도 자료와 풀이 기록은 그대로 남고, ‘과목 미지정’으로 옮겨져요." }));
    requestAnimationFrame(() => { if (!editing && name.isConnected) name.focus(); });
  }
  return panel;
}
function subjectHead(name, list){
  if (!name) return h("div", { class:"subj-head" }, h("div", null, h("h2", { text:"과목 미지정" }),
    S.plan.subjects.length ? h("p", { class:"small muted", text:"자료 카드의 과목 칸에서 고르면 그 과목으로 묶여요." }) : null));
  const n = daysLeft(examOf(name));
  const weak = weakList(list);
  const objs = new Set(weak.map(w => w.d.id + ":" + w.it.objectiveId)).size;
  const due = list.reduce((sum, d) => sum + deckCounts(d).due, 0);
  const exam = examOf(name);
  return h("div", { class:"subj-head" },
    h("div", { class:"subj-title" },
      n != null ? h("span", { class:`dday-big${n >= 0 && n <= 3 ? " soon" : ""}${n < 0 ? " past" : ""}`, text: n > 0 ? `D-${n}` : n === 0 ? "D-day" : "끝" }) : null,
      h("div", null,
        h("h2", { text:name }),
        h("p", { class:"small muted num" },
          exam ? `${Number(exam.slice(5, 7))}월 ${Number(exam.slice(8, 10))}일 시험 · ` : "",
          `약점 목표 ${objs}개 · 복습 차례 ${due}개`))),
    h("div", { class:"row" },
      h("button", { class:"btn small", onclick: () => openSummary(name) }, "한 장 정리"),
      h("button", { class:"btn small primary", disabled: weak.length ? null : true, onclick: () => startWeak(name) }, `약점 다시 풀기${weak.length ? ` ${Math.min(weak.length, WEAK_MAX)}` : ""}`)));
}
function deckCard(d, growing){
  const c = deckCounts(d);
  const pct = (n) => (c.total ? (n / c.total * 100) : 0) + "%";
  let pick = null;
  if (!d.example && S.plan.subjects.length){
    pick = h("select", { class:"subj-pick", "aria-label":"과목", title:"과목" },
      h("option", { value:"", text:"과목 없음" }), orderedSubjects().map(s => h("option", { value:s.name, text:s.name })));
    pick.value = subjectOf(d);
    pick.addEventListener("change", () => setSubject(d, pick.value));
  }
  return h("article", { class:"deck" },
    h("div", null,
      h("h3", null, d.pastExam ? h("span", { class:"chip exam", style:"margin-right:6px;vertical-align:2px", text:"기출형" }) : null, displayTitle(d).replace(/ · 기출형/, "")),
      h("div", { class:"meta" },
        pick,
        h("span", { class:"num", text:`목표 ${d.objectives.length} · 문제 ${d.items.length}` }),
        c.due ? h("span", { class:"chip bad num", text:`복습 ${c.due}` }) : null,
        c.fresh ? h("span", { class:"chip num", text:`새 문제 ${c.fresh}` }) : null,
        d.skipped && d.skipped.length ? h("span", { class:"chip help num", title:d.skipped.map(x => `${x.questionId}: ${x.reason}`).join("\n"), text:`빠진 문항 ${d.skipped.length}` }) : null
      )
    ),
    h("div", { class:"row" },
      h("button", { class:"btn small ghost", onclick: () => { S.recordsDeck = d.id; setView("records"); } }, "기록"),
      h("button", { class:"btn small ghost", onclick: () => openReader(d.id, d.lastPage || firstPage(d)) }, d.lastPage ? `이어 읽기 p.${d.lastPage}` : "읽기"),
      h("button", { class:"btn small primary", onclick: () => startSession(d.id, true) }, c.due || c.fresh ? "연습" : "더 풀기")
    ),
    h("div", { class:"bar", "aria-hidden":"true" },
      h("i", { class:"g", style:`width:${pct(c.good)}` }), h("i", { class:"r", style:`width:${pct(c.review)}` }), h("i", { class:"h", style:`width:${pct(c.help)}` }), h("i", { class:"c", style:`width:${pct(c.read)}` })
    ),
    growing.has(d.id) ? h("div", { style:"grid-column:1/-1" }, pendingNote(growing.get(d.id))) : null
  );
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
/* 약점 다시 풀기: a subject's weak questions across its materials, most-missed first, regardless of the review day.
   Results count like review; a question solved alone leaves the weak list. */
const WEAK_MAX = 30;
function startWeak(subject){
  const list = weakList(decksOf(subject)).sort((a, b) => b.miss - a.miss).slice(0, WEAK_MAX);
  if (!list.length){ toast("약점으로 표시된 문제가 없어요."); return; }
  S.session = { queue: shuffle(list).map(w => ({ deck:w.d.id, item:w.it.id })), i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"weak", subject, viewed:new Set() };
  prepCurrent(); setView("practice");
}
function itemsOnPage(d, page){
  return d.items.filter(it => it.page === page || (d.objectives.find(o => o.id === it.objectiveId)?.pages || []).includes(page));
}
function startCheck(deckId, page){
  const d = S.decks[deckId];
  const items = itemsOnPage(d, page);
  if (!items.length){ toast("이 쪽에 연결된 문제가 없어요."); return; }
  // From the reader the check opens over the page (blurred so the answer can't be read off it) and closes back to it.
  const overlay = S.view === "read";
  S.session = { queue: items.map(it => ({ deck:d.id, item:it.id })), i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"check", page, viewed:new Set(), overlay };
  prepCurrent();
  if (overlay){ render(); const f = document.querySelector(".checklayer [data-autofocus]"); if (f) f.focus({ preventScroll:true }); } else setView("practice");
}
function assistedNow(deck, item){ return S.session.assisted.has(deck.id + ":" + item.id) || S.session.viewed.has(deck.id + ":" + item.page); }
function applyCheck(deck, item){
  // right after reading: never counts as memory evidence; real review starts tomorrow
  const s = schedOf(deck, item.id); s.seen = true; s.due = Math.max(s.due || 0, now() + DAY);
}
/* The current question as shown. A 용어 flashcard may be shown as a choice among the material's other terms
   (학습규칙/품질.md [용어-고르기]); the record still belongs to the same question. */
function curRef(){
  const q = S.session.queue[S.session.i]; if (!q) return null;
  const deck = S.decks[q.deck];
  const base = (deck.allItems || deck.items).find(x => x.id === q.item);
  const c = S.session.cur;
  const v = c && c.itemKey === q.deck + ":" + q.item ? c.asChoice : null;
  return { deck, item: v ? { ...base, format:"choice", options:v.options, answer:v.answer, termCard:true } : base };
}
function termChoiceFor(deck, it){
  if (it.format !== "card" || !env.quality || !env.quality.termChoice || (S.rules && S.rules.termChoice === false) || S.session.mode === "check") return null;
  try{ return env.quality.termChoice({ items:deck.allItems || deck.items, outline:deck.outline }, it.id, new Date().toDateString()); }catch(e){ return null; }
}
function prepCurrent(){
  const q = S.session.queue[S.session.i]; if (!q) return;
  const r = curRef(); if (!r) return;
  const it = r.item;
  const asChoice = termChoiceFor(r.deck, it);
  S.session.cur = { itemKey:q.deck + ":" + q.item, asChoice, pick:null, text:"", order:[], pool: it.format === "order" ? shuffle(it.steps.map((s,i) => i)) : [],
    optOrder: asChoice ? asChoice.options.map((o, i) => i) : it.format === "choice" ? shuffle(it.options.map((o,i) => i)) : [], verdict:null, overridden:false, cardShown:false };
}
function logEvent(deck, item, ev){ deck.events.push({ t:now(), item:item.id, ...ev }); }
function finishItem(outcome){
  const { deck, item } = curRef();
  if (S.session.mode === "check") applyCheck(deck, item); else applyOutcome(deck, item, outcome);
  // 첫 훑기: solved alone on the very first try means it is already known, so it waits longer (학습규칙 [첫훑기-앎-간격]).
  const q = S.session.queue[S.session.i];
  if (q && q.reason === "diagnose" && outcome === "correct" && planner){
    const s = schedOf(deck, item.id); s.box = planner.diagnoseBox(INTERVALS, (S.rules && S.rules.diagnoseKnownDays) || 7); s.due = now() + gap(s.box);
  }
  // 너무 쉬움 (학습규칙/품질.md [쉬움-연속]): solved alone on several different days → the longest gap, once.
  if (outcome === "correct" && S.session.mode !== "check" && env.quality){
    const s = schedOf(deck, item.id);
    if (!s.easy && s.box < INTERVALS.length - 1 && env.quality.tooEasy(deck.events, item.id, rule("easyStreak", 4))){
      s.box = INTERVALS.length - 1; s.due = now() + gap(s.box); s.easy = true;
      ledger({ deck, item, signal:"연속으로 혼자 맞힘", action:"가장 긴 복습 간격으로", cause:"너무쉬움" });
    }
  }
  S.session.results.push({ deck:deck.id, item:item.id, outcome });
  S.session.assisted.add(deck.id + ":" + item.id); // the result screen shows the answer, so a retry later in this session is not independent
  Store.save(deck);
}
function submitAnswer(){
  const { deck, item } = curRef(); const c = S.session.cur;
  const assisted = assistedNow(deck, item); const reading = S.session.mode === "check" || undefined;
  let correct = null;
  if (item.format === "choice"){ if (c.pick == null) return; correct = c.pick === item.answer; }
  else if (item.format === "value"){ if (!c.text.trim()) return; correct = item.accepted.some(a => norm(a) === norm(c.text)); }
  else if (item.format === "order"){ if (c.order.length !== item.steps.length) return; correct = c.order.every((v,i) => v === i); }
  logEvent(deck, item, { kind:"submit", correct, assisted, afterReading:reading, answer: item.format === "value" ? c.text.slice(0, 80) : undefined, asChoice: item.termCard || undefined });
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
  S.session.assisted.add(deck.id + ":" + item.id);
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
  const s = schedOf(deck, item.id); s.box = Math.min(s.box + 1, INTERVALS.length - 1); s.due = now() + gap(s.box); s.lastIndep = now();
  const res = S.session.results[S.session.results.length - 1]; if (res) res.outcome = "correct";
  S.session.queue = S.session.queue.filter((q, idx) => !(idx > S.session.i && q.retry && q.item === item.id));
  c.verdict = "good"; c.overridden = true;
  ledger({ deck, item, signal:"내 답도 맞아요", action:"이번 풀이를 맞음으로", cause:"인정답안누락", detail:`내 답 "${c.text.slice(0, 60)}" / 정답 "${(item.accepted || [])[0] || ""}"` });
  Store.save(deck); render();
}
/* "이 문제 이상해요": the question leaves practice and review; the report stays as quality evidence. */
const REPORT_REASONS = ["정답이 틀렸어요", "문제가 애매해요", "원문과 달라요", "기타"];
function reportItem(reason){
  const { deck, item } = curRef();
  deck.reported = deck.reported || {};
  deck.reported[item.id] = { reason, t:now() };
  logEvent(deck, item, { kind:"report", reason });
  ledger({ deck, item, signal:`신고: ${reason}`, action:"연습·복습에서 뺌", cause:{ "정답이 틀렸어요":"정답오류", "문제가 애매해요":"애매함", "원문과 달라요":"원문불일치" }[reason] || "기타" });
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
/* 쪽 확인 겹창: closing returns to the same page; the side panel then shows what changed (목표 tab peek). */
const overlayCheck = () => !!(S.session && S.session.overlay);
function closeCheck(){
  const s = S.session; if (!s || !s.overlay) return;
  const r = s.results, good = r.filter(x => x.outcome === "correct").length;
  S.session = null; render();
  if (r.length) toast(`p.${s.page} 확인 ${r.length}문제 · 맞힘 ${good}${r.length - good ? ` · 다시 볼 것 ${r.length - good}` : ""}`);
}
function nextItem(){
  S.session.i++; S.session.phase = "ask";
  if (S.session.i >= S.session.queue.length){
    S.session.phase = "done";
    for (const name of new Set(S.session.queue.map(q => S.decks[q.deck] ? subjectOf(S.decks[q.deck]) : ""))) if (name) touchMemory(name);
    if (S.session.overlay){ closeCheck(); return; }
  }
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
    s.overlay ? h("button", { class:"btn ghost small", title:"닫고 이 쪽으로 (Esc) · 푼 것까지는 기록돼요", onclick: closeCheck }, `✕ p.${s.page}로`)
      : h("button", { class:"btn ghost small", onclick: () => { S.session = null; render(); } }, "그만하기"),
    h("div", { class:"progress", "aria-hidden":"true" }, h("i", { style:`width:${(s.i / total * 100).toFixed(1)}%` })),
    h("span", { class:"mono num muted", text:`${s.i + 1} / ${total}` })
  );
  const locked = s.phase !== "ask";
  const card = h("article", { class:"qcard", "aria-live":"polite" });
  card.append(h("div", { class:"qhead" },
    h("span", { class:"chip page", text:`p.${item.page}` }),
    h("span", { class:"chip", text: item.termCard ? "용어 고르기" : FORMAT_LABEL[item.format] }),
    s.mode === "check" ? h("span", { class:"chip read", text:"읽은 직후 확인" }) : null,
    s.mode === "weak" ? h("span", { class:"chip bad", text:"약점 다시 풀기" }) : null,
    s.queue[s.i].reason && REASON[s.queue[s.i].reason] ? h("span", { class:`chip ${REASON[s.queue[s.i].reason][1]}`, text:REASON[s.queue[s.i].reason][0] }) : null,
    s.queue[s.i].retry ? h("span", { class:"chip help", text:"다시 확인" }) : null,
    deck.pastExam ? h("span", { class:"chip exam", text:"기출형" }) : null,
    s.overlay ? null : h("span", { class:"chip", text:displayTitle(deck).replace(/ · 기출형/, "") })
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
        bad:["bad", item.format === "card" ? "잘 모른다고 표시했어요" : "이번엔 떠올리지 못했어요", "복습 필요로 표시해 뒀어요. 내일 복습에 다시 나와요."],
        assisted:["help", "정답을 보고 확인했어요", "혼자 맞힌 기록으로 세지 않아요. 내일 복습에 다시 나와요."],
        "self-good":["self", "알고 있다고 표시했어요", "자기평가라서 자동 채점보다 약한 근거로 기록돼요."],
        "self-mid":["self", "헷갈렸다고 표시했어요", "내일 다시 물어볼게요."],
        "read-good":["read", c.overridden ? "맞음으로 고쳤어요 (읽은 직후)" : "읽은 직후 맞혔어요", "방금 읽은 내용이라 기억 기록으로 세지 않아요. 내일부터 복습에 넣을게요."],
        "read-mid":["read", "일부만 떠올렸어요 (읽은 직후)", "내일부터 복습에 넣을게요."],
        "read-bad":["bad", "읽은 직후에도 헷갈렸어요", "아래 ‘원문에서 보기’로 다시 읽어 보세요. 복습 필요로 표시해 뒀어요."]
      }[c.verdict];
      card.append(h("div", { class:`verdict ${map[0]}` }, h("strong", { text:map[1] }), h("span", { class:"small", text:map[2] }),
        (item.format === "value" && (c.verdict === "bad" || c.verdict === "read-bad") && !c.overridden && c.text.trim()) ? h("span", null, h("button", { class:"linkish", onclick:overrideCorrect }, "내 답도 맞아요 (표기만 달라요)")) : null
      ));
      if (item.explanation) rv.append(h("div", null, h("dt", { text:"설명" }), h("dd", null, richText(item.explanation))));
      if (obj) rv.append(h("div", null, h("dt", { text:"학습목표" }), h("dd", { text:obj.statement })));
      rv.append(h("div", null, h("dt", { text:`원문 근거 · p.${item.page}` }), h("dd", null, h("mark", { class:"quote", text:item.quote || "기록된 인용 없음" }), item.quoteVerified === false ? h("span", { class:"chip help", style:"margin-left:6px", text:"원문과 일치 확인 안 됨" }) : null,
        h("div", { style:"margin-top:8px" }, h("button", { class:"btn small", onclick: () => { if (s.overlay){ const pg = item.page, oid = item.objectiveId; closeCheck(); S.reader.active = oid; if (S.reader.page !== pg) goPage(pg); else render(); } else openReader(deck.id, item.page, item.objectiveId); } }, s.overlay ? "원문에서 다시 보기" : "원문에서 보기 →")))));
    }
    card.append(rv);
    if (s.phase === "result"){ const fix = quickFix(deck, item, c); if (fix) card.append(fix); card.append(itemFeedback(deck, item, c)); card.append(renderReport(deck, item, c)); }
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
    if (item.termCard) act.append(h("button", { class:"btn ghost small", title:"보기 없이 떠올리는 카드로 풀어요", onclick: () => { c.asChoice = null; c.optOrder = []; c.pick = null; render(); } }, "카드로 풀기"));
    if (item.format !== "card") act.append(h("button", { class:"btn ghost small", onclick:peek, title:"정답을 먼저 보면 이번 풀이는 혼자 맞힌 기록으로 세지 않아요" }, "정답 먼저 보기"));
  } else if (s.phase === "rate"){
    // Flashcards are judged by the learner, in two steps (docs/DECISIONS.md 2026-10-12 주관식 형식). "잘 모름" counts as a weak spot.
    act.append(h("span", { class:"small muted", text:"떠올린 것과 비교해 보세요" }));
    act.append(h("div", { class:"rate" },
      h("button", { class:"btn", onclick: () => rateCard("forgot") }, "잘 모름"),
      h("button", { class:"btn primary", onclick: () => rateCard("remembered") }, "알고 있음")
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
      S.session.mode === "today" ? (() => {
        const p = todayPlan(); const left = p ? p.queue.length : 0;
        return h("p", { class:"small", text: left ? `오늘 할 것이 ${left}문제 남았어요.` : "오늘 할 것을 모두 마쳤어요." });
      })() : null,
      S.session.mode === "weak" ? (() => {
        const left = weakList(decksOf(S.session.subject)).length;
        return h("p", { class:"small", text: left ? `${S.session.subject} 약점이 ${left}문제 남았어요. 혼자 맞히면 약점에서 빠져요.` : `${S.session.subject} 약점을 모두 풀었어요.` });
      })() : null,
      S.session.mode !== "check" && S.session.results.length ? sessionFeedback() : null,
      S.session.mode === "check"
        ? h("div", { class:"row" },
            h("button", { class:"btn primary", onclick: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, nextPageWithItems(S.decks[d], pg) || pg); } }, "다음 쪽 읽기"),
            h("button", { class:"btn", onclick: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, pg); } }, `p.${S.session.page}로 돌아가기`))
        : h("div", { class:"row" },
            S.session.mode === "today" && (todayPlan() || { queue:[] }).queue.length ? h("button", { class:"btn primary", onclick:startToday }, "이어서 하기") : null,
            h("button", { class: S.session.mode === "today" && (todayPlan() || { queue:[] }).queue.length ? "btn" : "btn primary", onclick: () => { S.session = null; render(); } }, "처음으로"),
            h("button", { class:"btn", onclick: () => { S.session = null; setView("records"); } }, "기록 보기"))
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
  if (!S.session || e.isComposing || !(S.view === "practice" || (S.view === "read" && S.session.overlay))) return;
  const tag = (e.target.tagName || "").toLowerCase();
  const s = S.session;
  if (e.key === "Escape" && s.overlay){ e.preventDefault(); closeCheck(); return; }
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
  if (S.session && S.session.overlay) S.session = null;
  resetExplain();
  R.deckId = deckId; R.page = page || 1; R.active = objId || null; R.zoom = false; R.attachErr = "";
  rememberPage();
  setView("read"); window.scrollTo({ top:0 });
}
function goPage(n){
  const R = S.reader, d = S.decks[R.deckId]; if (!d) return;
  if (overlayCheck()) S.session = null;
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
function hideObjective(d, objectiveId, why){
  d.hidden = [...new Set([...(d.hidden || []), objectiveId])];
  applyFilters(d); Store.save(d);
  const o = d.objectives.find(x => x.id === objectiveId);
  ledger({ deck:d, objective:objectiveId, signal: why === "지엽" ? "너무 지엽적이에요" : "목표 빼기", action:"연습·복습에서 뺌", cause: why === "지엽" ? "지엽" : "목표설계", detail:o ? o.statement : "" });
  // Offer the look-alikes in the same material (학습규칙/품질.md [비슷한목표-기준]).
  const ids = o && env.quality ? env.quality.similar(o, d.objectives.filter(x => !(d.hidden || []).includes(x.id)), rule("similarHide", 50) / 100) : [];
  S.hideSuggest = ids.length ? { deckId:d.id, from:o.statement, ids, why } : null;
  if (!ids.length) toast("이 목표의 문제는 연습과 복습에서 빠져요. 기록 탭에서 다시 넣을 수 있어요.");
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
    const segs = entry.layout && entry.layout[i];
    const x = segs ? segs[0].x0 : tx[4], x1 = segs ? segs[segs.length - 1].x1 : tx[4] + it.width * entry.vp.scale;
    return { x, y:tx[5] - fh * 0.95, w:x1 - x, h:fh * 1.2 };
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
      entry.layout = inkLayout(entry, page);
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
    ...badges.map(b => h("div", { class:"hlnum" + (b.line ? " line" : ""), style:`left:${b.x / W * 100}%;top:${b.y / H * 100}%`, text:String(b.num) })),
    ...(() => { const tl = textLayer(entry, cssW); return [...termMarks(d, tl), tl]; })(), ...noteMarks(d, entry, W, H));
}
/* 핵심 용어: terms of core 용어·개념 objectives, marked wherever they are written on the page (chunk.ts importantTerms). */
function termsOn(){ return !(S.plan.prefs && S.plan.prefs.showTerms === false); }
function importantOf(d){
  if (!env.chunk || !env.chunk.important) return null;
  const sig = (d.outline ? d.outline.length : 0) + ":" + (d.patchSig || "") + ":" + (d.items || []).length;
  if (!d._imp || d._impSig !== sig){ try{ d._imp = env.chunk.important(d); d._impSig = sig; }catch(e){ d._imp = null; } }
  return d._imp;
}
function termMarks(d, tl){
  if (!tl._tokens || !tl._tokens.length) return [];
  const terms = importantOf(d); if (!terms || !terms.keys.size) return [];
  const out = [], seenLines = new Set(), found = [];
  for (const t of tl._tokens){
    if (seenLines.has(t.line)) continue; seenLines.add(t.line);
    const words = t.line.map(n => tl._tokens[n].text);
    for (const m of env.chunk.find(words, terms)){
      const list = t.line.slice(m.start, m.end + 1).map(n => tl._tokens[n]);
      const x0 = Math.min(...list.map(k => k.x0)), x1 = Math.max(...list.map(k => k.x1)), y0 = Math.min(...list.map(k => k.y0)), y1 = Math.max(...list.map(k => k.y1));
      const text = list.map(k => k.text).join(" ");
      if (!found.includes(text)) found.push(text);
      if (termsOn()) out.push(h("div", { class:"tm", title:`핵심 용어: ${text}`, style:`left:${x0 / tl._W * 100}%;top:${(y0 + (y1 - y0) * 0.1) / tl._H * 100}%;width:${(x1 - x0) / tl._W * 100}%;height:${(y1 - y0) * 0.8 / tl._H * 100}%` }));
    }
  }
  pageTermsFound(d, found);
  if (Chat.el && !Chat.busy) Chat.paintSugs();
  return out;
}
async function drawPage(){
  if (S.view !== "read") return;
  const R = S.reader, d = S.decks[R.deckId]; if (!d) return;
  const token = ++drawToken;
  fitPage(d);
  const box = document.getElementById("pagebox");
  if (box) await paintBox(box, d, R.page, Math.max(200, Math.floor(box.getBoundingClientRect().width)));
  if (token !== drawToken) return;
  const zb = document.getElementById("zoombox");
  if (zb) await paintBox(zb, d, R.page, Math.max(200, Math.floor(zb.getBoundingClientRect().width)));
  placeNoteCard();
}
/* One screen, no scrolling: a slide page gets the width that makes its height fit between the reader bar and the
   action bar; the rail beside it takes the rest. Tall (portrait) pages keep the column width and scroll as before. */
function fitPage(d){
  const page = document.querySelector(".rpage.wide"); if (!page) return;
  const sheet = page.querySelector(".sheet"), rail = page.querySelector(".rrail"), bar = document.querySelector(".ractions");
  if (!sheet) return;
  const aspect = pageAspect(d);
  const top = sheet.getBoundingClientRect().top + window.scrollY;
  const below = (bar ? bar.offsetHeight : 64) + 18;
  const availH = Math.max(260, window.innerHeight - top - below);
  const sideBySide = window.innerWidth >= 1000 && rail && rail.childNodes.length;
  page.classList.toggle("side", !!sideBySide);
  // The rail holds the docked question window and tabs, so it gets a real column (340–440px).
  const railW = sideBySide ? Math.round(Math.min(440, Math.max(340, page.clientWidth * 0.3))) : 0;
  const availW = page.clientWidth - (sideBySide ? railW + 18 : 0);
  const w = Math.floor(Math.min(availW, availH * aspect));
  sheet.style.width = w + "px";
  if (rail){
    rail.style.width = sideBySide ? Math.max(railW, page.clientWidth - w - 18) + "px" : "";
    rail.style.height = sideBySide ? Math.max(Math.round(w / aspect), Math.min(availH, 560)) + "px" : "";
    rail.style.maxHeight = "";
  }
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
  const d = S.decks[R.deckId]; ensurePdf(d); loadNotes(d);
  const P = S.pdf[d.id]; const total = pageTotal(d);
  R.page = Math.max(1, Math.min(total, R.page));
  if (S.session && !S.session.overlay) S.session.viewed.add(d.id + ":" + R.page);
  const pdfOn = P && (P.status === "ready" || P.status === "loading");
  const wide = pdfOn && pageAspect(d) > 1.15;          // slides: explanation goes below, not beside
  const objs = d.objectives.filter(o => o.pages.includes(R.page) && !(d.hidden || []).includes(o.id));
  const n = itemsOnPage(d, R.page).length;
  const nxt = nextPageWithItems(d, R.page);
  const wrap = h("div");

  if (S.session && !S.session.overlay) wrap.append(h("div", { class:"banner", role:"status" },
    h("span", { text:"연습 중이에요. 여기서 본 쪽의 문제는 이번 연습에서 ‘정답 보고 풂’으로 기록돼요." }),
    h("button", { class:"btn small", onclick: () => setView("practice") }, "연습으로 돌아가기")));

  const sel = h("select", { id:"readDeck", "aria-label":"자료 고르기" }, decks.map(x => h("option", { value:x.id, selected: x.id === d.id ? "selected" : null }, displayTitle(x))));
  sel.addEventListener("change", () => openReader(sel.value, firstPage(S.decks[sel.value])));
  const pg = h("input", { class:"num", id:"pgInput", type:"number", min:"1", max:String(total), "aria-label":"쪽 번호" });
  pg.value = String(R.page); pg.addEventListener("change", () => goPage(Number(pg.value)));
  wrap.append(h("div", { class:"rbar" }, sel, h("span", { class:"grow" }),
    env.chunk && env.chunk.important && !d.example ? h("button", { class:"btn small", "aria-pressed": termsOn() ? "true" : "false", title:"핵심 용어·개념 목표의 용어를 쪽에 표시",
      onclick: () => { (S.plan.prefs || (S.plan.prefs = {})).showTerms = !termsOn(); Store.savePlan(S.plan); render(); } }, "핵심 용어") : null,
    notesButton(d),
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
  // Slides fit the screen (fitPage): the page is sized to the height left, and the side panel sits beside it:
  // 설명 (docked question window with this page's easy explanation) · 목표 · 상태, switched like browser tabs.
  if (wide && dockWanted()) page.append(sidePanel(d, objs, n));
  const holder = wide ? h("aside", { class:"rrail" }) : page;
  if (wide && !dockWanted()) page.append(holder);
  if (wide && !dockWanted() && window.innerWidth >= 1000) holder.append(h("button", { class:"btn small", title:"질문 창을 쪽 옆에 붙이고 쉬운 설명을 바로 보기",
    onclick: () => { S.plan.prefs.chatFloat = false; Store.savePlan(S.plan); if (Chat.el) Chat.el.hidden = true; render(); } }, "질문 창 옆에 붙이기"));
  if (objs.length && !(wide && dockWanted())){
    holder.append(h("div", { class:"goals" }, h("span", { class:"lbl", text:"이 쪽에서 익힐 것" }),
      objs.map((o, i) => h("div", { class:"goalrow" },
        h("button", { class:"goal", "aria-pressed": R.active === o.id ? "true" : "false", title:"원문에서 이 부분만 진하게 보기", onclick: () => { R.active = R.active === o.id ? null : o.id; render(); } },
          h("span", { class:"gnum", text:String(i + 1) }), h("span", { text:o.statement })),
        d.example ? null : h("button", { class:"linkish", title:"이 목표의 문제를 연습·복습에서 빼기", onclick: () => hideObjective(d, o.id) }, "빼기")))));
  }
  if (P && P.status === "error") page.append(h("p", { class:"attach", text:"원본 PDF를 불러오지 못했어요. 원본 등록 상태를 확인해 주세요." }));

  const card = renderNoteCard(d);
  const grid = h("div", { class:"rgrid" + (card ? (wide || !pdfOn ? " noteflt" : " open noteopen") : "") }, page, card);
  wrap.append(grid);

  if (R.zoom && P && P.status === "ready"){
    const a = pageAspect(d);
    wrap.append(h("div", { class:"zoomlayer", role:"dialog", "aria-label":`원본 ${R.page}쪽 크게 보기`, onclick: (e) => { if (e.target === e.currentTarget){ R.zoom = false; render(); } } },
      h("div", { class:"zoombar" }, h("span", { text:`p.${R.page}` }), h("button", { class:"qbtn", onclick: () => { R.zoom = false; render(); } }, "닫기 ✕")),
      h("div", { class:"pagebox", id:"zoombox", "data-key":d.id + ":" + R.page, style:`width:min(calc(100vw - 32px), calc((100vh - 90px) * ${a}));aspect-ratio:${a}` })));
  }

  wrap.append(h("div", { class:"ractions" },
    h("span", { class:"where" }, h("b", { text:`p.${R.page}` }), objs.length ? ` · 익힐 것 ${objs.length}` : " · 연결된 목표 없음",
      notesOn(d) && pdfOn ? h("span", { class:"nhint", text:" · 모르는 건 원문을 드래그해 물어보세요" }) : null),
    wide && dockWanted() ? null : h("button", { class:"btn", "aria-pressed": Chat.isOpen() ? "true" : "false", onclick: () => Chat.toggle() }, Chat.isOpen() ? "질문 창 닫기" : "질문하기"),
    S.session && !S.session.overlay ? h("button", { class:"btn primary", onclick: () => setView("practice") }, "연습으로 돌아가기")
      : n ? h("button", { class:"btn primary", title:"읽은 직후 푼 결과는 기억 기록으로 세지 않고, 내일부터 복습에 넣어요.", onclick: () => startCheck(d.id, R.page) }, `이 쪽 문제 풀기 (${n})`)
      : nxt ? h("button", { class:"btn", onclick: () => goPage(nxt) }, `문제 있는 다음 쪽 · p.${nxt} →`) : null));
  return wrap;
}
on(document, "keydown", (e) => {
  if (S.view !== "read" || overlayCheck() || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.key === "Escape" && S.reader.zoom){ S.reader.zoom = false; render(); return; }
  if (e.key === "ArrowRight"){ e.preventDefault(); goPage(S.reader.page + 1); }
  else if (e.key === "ArrowLeft"){ e.preventDefault(); goPage(S.reader.page - 1); }
});
let resizeTimer;
on(window, "resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
  if (S.view !== "read") return;
  // crossing the side-by-side width: the question window moves between the side panel and its own window
  if (!!document.querySelector(".rside") !== (dockWanted() && !!document.querySelector(".rpage.wide"))) render(); else drawPage();
}, 150); });
(function watchDpr(){
  try{
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    on(mq, "change", () => { if (S.view === "read") drawPage(); watchDpr(); }, { once:true });
  }catch(e){}
})();
/* ----- 읽기 곁 패널: 설명 (the question window docked, with this page's easy explanation) · 목표 · 상태.
   Switched like browser tabs. When a goal or the status really changes while the learner is just reading,
   the panel slides to that tab for a moment, pulses what changed, and slides back (motion off → a dot on the tab). ----- */
const reducedMotion = () => { try{ return matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){ return false; } };
function dockWanted(){ return window.innerWidth >= 1000 && !(S.plan.prefs && S.plan.prefs.chatFloat); }
function dockChat(refocus){
  const slot = document.getElementById("chatDock");
  if (slot){ Chat.dockInto(slot, refocus); const R = S.reader; Explain.want(S.decks[R.deckId], R.page); }
  else if (Chat.docked){ Chat.undock(); Explain.stop(); }
}
let peekTimer, pulseTimer;
function setPanelTab(k){
  const R = S.reader; R.panel = k; R.badge.delete(k);
  if (R.peek){ R.peek = null; clearTimeout(peekTimer); }
  showPane(k);
}
function showPane(k){
  const side = document.querySelector(".rside"); if (!side) return;
  side.classList.toggle("peeking", !!S.reader.peek);
  side.querySelectorAll(".rtabs [data-tab]").forEach(b => { b.setAttribute("aria-selected", b.dataset.tab === k ? "true" : "false"); b.classList.toggle("dot", S.reader.badge.has(b.dataset.tab)); });
  side.querySelectorAll(".rpane").forEach(p => p.classList.toggle("on", p.dataset.pane === k));
}
const GOAL_STATE = { weak:["약점", "bad"], new:["안 풀어봄", ""], mid:["푸는 중", "help"], good:["혼자 맞힘", "good"], none:["문제 없음", ""] };
function pageNotes(d, page){ return noteList(d).filter(x => x.page === page).length; }
function panelSnap(d, objs, n){
  const c = deckCounts(d);
  return { key:d.id + ":" + S.reader.page, count:objs.length + ":" + n,
    goals:new Map(objs.map(o => [o.id, objectiveState(d, o.id)])),
    state:[c.good, c.due, c.fresh, weakList([d]).length, pageNotes(d, S.reader.page)].join("/") };
}
function detectPeek(snap){
  const R = S.reader, prev = R.snap; R.snap = snap;
  if (!prev || prev.key !== snap.key) return;
  const changed = [...snap.goals.keys()].filter(id => prev.goals.get(id) !== snap.goals.get(id));
  const goals = changed.length || prev.count !== snap.count, state = prev.state !== snap.state;
  if (!goals && !state) return;
  R.pulse = new Set(goals ? changed : []); R.pulseState = !goals && state;
  clearTimeout(pulseTimer); pulseTimer = setTimeout(() => { R.pulse = new Set(); R.pulseState = false; }, 3000);
  const tab = goals ? "goals" : "state";
  if (R.panel === tab) return;
  const ta = Chat.el && Chat.el.querySelector("textarea");
  const busy = Chat.busy || (ta && (ta.value.trim() || document.activeElement === ta));
  if (R.panel !== "ask" || busy || reducedMotion()){ R.badge.add(tab); return; }
  R.peek = { tab };
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (R.peek && R.peek.tab === tab){ R.peek = null; showPane(R.panel); } }, 2600);
}
function sidePanel(d, objs, n){
  const R = S.reader;
  detectPeek(panelSnap(d, objs, n));
  const shown = R.peek ? R.peek.tab : R.panel;
  const tabs = [["ask", "설명"], ["goals", objs.length ? `목표 ${objs.length}` : "목표"], ["state", "상태"]];
  const bar = h("div", { class:"rtabs", role:"tablist", "aria-label":"곁 패널" },
    tabs.map(([k, label]) => h("button", { role:"tab", "data-tab":k, class: R.badge.has(k) && k !== shown ? "dot" : null, "aria-selected": shown === k ? "true" : "false", onclick: () => setPanelTab(k) }, label)),
    h("span", { class:"grow" }),
    h("button", { class:"qbtn", title:"새 대화 시작 (지금 대화는 노트에 남아요)", onclick: () => { setPanelTab("ask"); Chat.reset(); } }, "새 대화"),
    h("button", { class:"qbtn", title:"질문 창을 따로 띄우기", "aria-label":"질문 창 띄우기", onclick: () => {
      (S.plan.prefs || (S.plan.prefs = {})).chatFloat = true; Store.savePlan(S.plan); Chat.undock(); Explain.stop(); render(); Chat.open(); } }, "⧉"));
  const panes = h("div", { class:"rpanes" },
    h("div", { class:"rpane", "data-pane":"ask", id:"chatDock", role:"tabpanel" }),
    h("div", { class:"rpane pad", "data-pane":"goals", role:"tabpanel" }, goalsPane(d, objs, n)),
    h("div", { class:"rpane pad", "data-pane":"state", role:"tabpanel" }, statePane(d, n)));
  for (const p of panes.children) if (p.dataset.pane === shown) p.classList.add("on");
  return h("aside", { class:"rrail rside" + (R.peek ? " peeking" : "") }, bar, panes);
}
function goalsPane(d, objs, n){
  const R = S.reader, nxt = nextPageWithItems(d, R.page);
  if (!objs.length) return [h("p", { class:"small muted", text: d.pending ? "문제를 만드는 중이에요. 이 쪽의 목표가 생기면 여기에 떠요." : "이 쪽에 연결된 학습목표가 없어요." }),
    nxt ? h("button", { class:"btn small", onclick: () => goPage(nxt) }, `목표 있는 다음 쪽 · p.${nxt} →`) : null];
  return [h("span", { class:"lbl", text:"이 쪽에서 익힐 것" }),
    ...objs.map((o, i) => { const [label, cls] = GOAL_STATE[objectiveState(d, o.id)] || GOAL_STATE.none;
      return h("div", { class:"pgoal" + (R.pulse.has(o.id) ? " pulse" : "") },
        h("button", { class:"goal", "aria-pressed": R.active === o.id ? "true" : "false", title:"원문에서 이 부분만 진하게 보기", onclick: () => { R.active = R.active === o.id ? null : o.id; render(); } },
          h("span", { class:"gnum", text:String(i + 1) }), h("span", { text:o.statement })),
        h("div", { class:"pgoal-foot" }, h("span", { class:"chip " + cls, text:label }), h("span", { class:"grow" }),
          d.example ? null : h("button", { class:"linkish", title:"이 목표의 문제를 연습·복습에서 빼기", onclick: () => hideObjective(d, o.id) }, "빼기"))); }),
  ];
}
function termChips(list){
  if (!list.length) return [h("span", { class:"small muted", text:"이 쪽엔 표시된 핵심 용어가 없어요." })];
  return list.map(t => h("button", { class:"chip-btn", title:"질문 창에 넣기", onclick: () => Chat.quoteIn(t) }, t));
}
function pageTermsFound(d, found){
  const R = S.reader; R.terms = { key:d.id + ":" + R.page, list:found };
  const el = document.getElementById("pgTerms"); if (el) el.replaceChildren(...termChips(found));
}
function statePane(d, n){
  const R = S.reader, c = deckCounts(d), weak = weakList([d]).length, notes = pageNotes(d, R.page);
  const key = d.id + ":" + R.page, plan = d.example ? null : todayPlan();
  const mine = plan ? plan.queue.filter(r => r.deckId === d.id).length : 0;
  const pct = c.total ? Math.round(c.good / c.total * 100) : 0;
  const row = (k, v, cls) => h("div", { class:"strow" }, h("span", { text:k }), h("b", { class:"num" + (cls ? " " + cls : ""), text:v }));
  return [
    h("div", { class:"stbox" + (R.pulseState ? " pulse" : "") }, h("span", { class:"lbl", text:`이 쪽 · p.${R.page}` }),
      row("연결된 문제", `${n}개`), row("모르는 것 노트", `${notes}개`, notes ? "ask" : "")),
    h("div", { class:"stbox" }, h("span", { class:"lbl", text:"이 쪽 핵심 용어" }),
      h("div", { class:"pgterms", id:"pgTerms" }, R.terms.key === key ? termChips(R.terms.list) : h("span", { class:"small muted", text:"쪽을 그리는 중…" }))),
    h("div", { class:"stbox" + (R.pulseState ? " pulse" : "") }, h("span", { class:"lbl", text:"이 자료" }),
      h("div", { class:"stbar", title:`혼자 맞힘 ${c.good} / ${c.total}` }, h("i", { style:`width:${pct}%` })),
      row("혼자 맞힘", `${c.good} / ${c.total}`), row("약점", `${weak}개`, weak ? "bad" : ""), row("복습 차례", `${c.due}개`), row("새 문제", `${c.fresh}개`)),
    plan ? h("div", { class:"stbox" }, h("span", { class:"lbl", text:"오늘" }),
      row("이 자료에서 남은 것", `${mine}개`), row("전체 남은 것", `${plan.queue.length}개`), row("오늘 푼 것", `${plan.doneToday}개`),
      plan.queue.length && !S.session ? h("button", { class:"btn small", style:"margin-top:6px", onclick: () => startToday() }, "오늘 할 것 이어서") : null) : null,
  ];
}
/* ----- 질문 칩: what to ask or do next on this page. Built from the page's own data (free, instant): my weak goal,
   a pair of look-alike terms, a core term, a formula, the exam angle; plus the model's own follow-ups, which ride
   on the explanation/answer it was writing anyway ("[다음] q1 | q2", hidden from the text). One action closes it. ----- */
const clip = (t, n) => { t = String(t ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const NEXT_RULE = `- 답 맨 끝에 줄을 바꿔 "[다음] 질문1 | 질문2" 형식으로, 학습자가 이 쪽에 대해 이어서 물어볼 만한 짧은 질문 2개(각 25자 이내)를 적는다. "더 자세히 알려 줘" 같은 뻔한 질문은 쓰지 않는다.`;
function splitNext(text){
  text = String(text || "");
  const m = text.match(/(?:^|\n)[ \t]*\[다음\][ \t]*([^\n]*)\s*$/);
  if (!m) return { body:text.replace(/\n[ \t]*\[[^\]\n]{0,3}$/, ""), next:[] };   // hide a half-written tag while streaming
  const next = m[1].split(/\s*[|｜]\s*/).map(q => q.trim().replace(/^["'“‘]+|["'”’]+$/g, ""))
    .filter(q => q.length >= 4 && q.length <= 40 && !/자세히|더 알려|더 설명/.test(q)).slice(0, 2);
  return { body:text.slice(0, m.index).trimEnd(), next };
}
const shown = (text) => splitNext(text).body;
function objKind(d, id){ for (const sec of d.outline || []) for (const o of sec.objectives) if (o.id === id) return o.kind || ""; return ""; }
function objName(d, o){
  const card = d.items.find(it => it.objectiveId === o.id && it.format === "card" && typeof it.answer === "string" && it.answer.trim().length <= 18 && !it.answer.includes("$"));
  if (card) return card.answer.trim();
  // "동차좌표 평행이동 행렬을 쓸 수 있다" → "동차좌표 평행이동 행렬"
  const name = String(o.statement).replace(/[을를]?\s+\S*(할|쓸|그릴|읽을|풀)\s*수\s*있다\.?\s*$/, "").replace(/[?？]\s*$/, "");
  return clip(name || o.statement, 20);
}
function confusablePair(d, items){
  if (!env.quality || !env.quality.termChoice) return null;
  for (const it of items){
    if (it.format !== "card") continue;
    let r = null; try{ r = env.quality.termChoice({ items:d.allItems || d.items, outline:d.outline }, it.id, "pair"); }catch(e){}
    if (!r) continue;
    const a = r.options[r.answer], b = r.options.find((x, i) => i !== r.answer);
    if (a && b && a.length <= 18 && b.length <= 18) return [a, b];
  }
  return null;
}
function pageSuggestions(c){
  const { d, page } = c, R = S.reader, out = [], seen = new Set();
  for (const m of Chat.msgs) if (m.role === "user") seen.add(phraseKey(m.content));   // never offer what was just asked
  const add = (label, why) => { const k = phraseKey(label); if (!label || seen.has(k)) return; seen.add(k); out.push({ label, why }); };
  const items = itemsOnPage(d, page);
  const weak = c.objs.find(o => objectiveState(d, o.id) === "weak");
  if (weak) add(`내가 틀린 ‘${objName(d, weak)}’ 다시 짚어 줘`, "내 약점");
  const lastA = [...Chat.msgs].reverse().find(m => m.role === "assistant");
  const ai = lastA && lastA.page === page && lastA.next && lastA.next.length ? lastA.next : Explain.next(d, page);
  for (const q of ai) add(q, "AI 제안");
  const pair = confusablePair(d, items);
  if (pair) add(`‘${pair[0]}’랑 ‘${pair[1]}’ 뭐가 달라?`, "헷갈리는 짝");
  const terms = R.terms.key === d.id + ":" + page ? R.terms.list : [];
  if (terms[0]) add(`‘${clip(terms[0], 18)}’ 쉽게 말하면 뭐야?`, "핵심 용어");
  if (c.objs.some(o => objKind(d, o.id) === "공식")) add("이 식에 숫자 넣어서 한 번 보여 줘", "공식");
  if (c.objs.length) add("시험엔 이 쪽이 어떻게 나와?", "시험 기준");
  return out;
}
function pageAction(c){
  if (S.session && !S.session.overlay) return { label:"연습으로 돌아가기", run: () => setView("practice") };
  const n = itemsOnPage(c.d, c.page).length;
  if (n) return { label:`✓ 이 쪽 문제 바로 풀기 (${n})`, run: () => startCheck(c.d.id, c.page) };
  const nxt = nextPageWithItems(c.d, c.page);
  return nxt ? { label:`문제 있는 다음 쪽 · p.${nxt} →`, run: () => goPage(nxt) } : null;
}
/* 쉬운 설명 요청문: the learner can rewrite it (⚙ on the card); the [다음] line for follow-up chips is always added. */
const EXPLAIN_ASK = `이 쪽을 처음 보는 사람에게 쉽게 설명해 줘. 첫 문장은 이 쪽이 무엇에 대한 것인지, 이어서 핵심을 2~4문장으로. 어려운 용어는 원문 그대로 쓰고 바로 뒤 괄호에 쉬운 풀이를 붙인다. 마지막에 "한 줄 요약: "으로 시작하는 줄을 쓴다.`;
const EXPLAIN_PRESETS = [
  ["기본", EXPLAIN_ASK],
  ["아주 짧게", "이 쪽의 핵심만 두세 문장으로 아주 쉽게 설명해 줘. 어려운 용어는 원문 그대로 쓰고 괄호에 쉬운 풀이를 붙인다."],
  ["예시 위주", "이 쪽을 일상적인 비유나 구체적인 예시(숫자 예시 포함) 하나로 쉽게 설명해 줘. 원문 용어는 그대로 쓰고 괄호에 풀이를 붙인다. 마지막에 \"한 줄 요약: \"으로 시작하는 줄을 쓴다."],
  ["시험 대비", "이 쪽에서 시험에 나올 만한 핵심(정의, 식, 순서, 헷갈리는 짝)을 쉬운 말로 짚어 줘. 무엇을 외워야 하고 무엇을 이해해야 하는지 나눠서. 원문 용어는 그대로 쓴다."],
  ["원문 줄마다", "원문 줄을 짧게 인용하고 바로 아래에 쉬운 말 한두 문장을 붙이는 식으로 이 쪽 전체를 풀어 줘."],
];
const explainAsk = () => (S.plan.prefs && typeof S.plan.prefs.explainAsk === "string" && S.plan.prefs.explainAsk.trim()) || EXPLAIN_ASK;
/* 쪽마다 쉬운 설명: after 1.5s on a page with enough text, once per page; kept (study-notes/<source>.explain.json)
   so it shows instantly next time. It is not a 모르는 것 note, so it never counts as "물어봄". */
const Explain = {
  src:{}, run:null, timer:null, err:null, skip:new Set(),
  sid(d){ return d.sourceCatalogId || d.id; },
  auto(){ return !(S.plan.prefs && S.plan.prefs.autoExplain === false); },
  load(d){
    const k = this.sid(d); if (this.src[k]) return;
    const e = this.src[k] = { status:"loading", map:new Map() };
    if (!notesOn(d) || !notesApi.explanations){ e.status = "ready"; return; }
    notesApi.explanations(k).then(list => { for (const x of list) e.map.set(x.page, x.text); }, () => {})
      .then(() => { e.status = "ready"; const R = S.reader, cur = S.decks[R.deckId]; if (S.view === "read" && Chat.docked && cur && this.sid(cur) === k){ this.paintNode(); this.want(cur, R.page); } });
  },
  stop(){ clearTimeout(this.timer); this.timer = null; if (this.run && this.run.ctl) this.run.ctl.abort(); this.run = null; },
  want(d, page){
    if (!d) return;
    this.load(d);
    const key = this.sid(d) + ":" + page;
    if (this.run && this.run.key === key) return;
    if (this.run) this.stop();
    clearTimeout(this.timer); this.timer = null;
    const e = this.src[this.sid(d)];
    if (!ask || !this.auto() || e.status !== "ready" || e.map.has(page) || this.skip.has(key) || (this.err && this.err.key === key)) return;
    this.timer = setTimeout(() => { this.timer = null; const R = S.reader; if (S.view === "read" && Chat.docked && R.deckId === d.id && R.page === page) this.go(d, page, false); }, 1500);
  },
  async go(d, page, force){
    if (!ask) return;
    const key = this.sid(d) + ":" + page;
    this.err = null;
    const text = await pageText(d, page);
    if (!force && text.replace(/\s/g, "").length < 40){ this.skip.add(key); this.paintNode(); return; }
    const objs = d.objectives.filter(o => o.pages.includes(page));
    const run = this.run = { key, text:"", ctl:new AbortController() };
    this.paintNode();
    const prompt = Chat.prompt({ d, page, objs }, text) + `
[요청]
${explainAsk().slice(0, 1500)}
맨 마지막 줄에는 [다음] 줄을 쓴다.`;
    try{
      await ask([{ role:"user", content:prompt }], { signal:run.ctl.signal, onText: ({ text:t }) => { run.text = t; this.paintBody(); } });
      if (this.run !== run) return;
      if (run.text.includes("$") && !katexLib) await ensureKatex();
      this.run = null;
      if (run.text.trim()){
        this.src[this.sid(d)].map.set(page, run.text);
        if (notesOn(d) && notesApi.saveExplanation) notesApi.saveExplanation(this.sid(d), page, run.text).catch(() => {});
      }
    }catch(err){
      if (this.run !== run) return;
      this.run = null;
      if (!(err && err.code === "cancelled")) this.err = { key, text:sampleErrorCopy(err) };
    }
    this.paintNode();
  },
  editing:false, draft:null,
  /* ⚙: rewrite how the explanation is asked for. Saved in __plan (both computers); pages already explained keep
     theirs until "이 쪽 다시 설명". */
  editor(d, page){
    const ta = h("textarea", { class:"ex-prompt", rows:"5", "aria-label":"쉬운 설명 요청문" });
    ta.value = this.draft ?? explainAsk();
    ta.addEventListener("input", () => { this.draft = ta.value; });
    const save = (redo) => {
      const v = ta.value.trim(); const p = S.plan.prefs || (S.plan.prefs = {});
      if (!v || v === EXPLAIN_ASK) delete p.explainAsk; else p.explainAsk = v.slice(0, 1500);
      Store.savePlan(S.plan); this.draft = null; this.editing = false;
      if (redo){ this.skip.delete(this.sid(d) + ":" + page); this.go(d, page, true); } else this.paintNode();
      toast(redo ? "새 요청문으로 이 쪽을 다시 설명해요." : "요청문을 저장했어요. 새로 여는 쪽부터 적용돼요.");
    };
    return h("div", { class:"ex-edit" },
      h("div", { class:"ex-presets" }, EXPLAIN_PRESETS.map(([label, text]) =>
        h("button", { class:"chip-btn", "aria-pressed": ta.value.trim() === text ? "true" : "false", onclick: () => { this.draft = text; this.paintNode(); } }, label))),
      ta,
      h("p", { class:"small muted", text:"쪽 원문과 학습목표, 기본 규칙(원문 근거, 짧고 쉽게)은 늘 함께 들어가요. 이미 설명한 쪽은 그대로 두고, 새로 여는 쪽부터 적용돼요." }),
      h("div", { class:"row", style:"gap:6px;justify-content:flex-end" },
        h("button", { class:"btn small ghost", onclick: () => { this.draft = null; this.editing = false; this.paintNode(); } }, "취소"),
        h("button", { class:"btn small", onclick: () => save(false) }, "저장"),
        ask ? h("button", { class:"btn small primary", onclick: () => save(true) }, "저장하고 이 쪽 다시 설명") : null));
  },
  node(d, page){
    const key = this.sid(d) + ":" + page, e = this.src[this.sid(d)];
    const saved = e && e.map.get(page), run = this.run && this.run.key === key ? this.run : null;
    const auto = h("input", { type:"checkbox" }); auto.checked = this.auto();
    auto.addEventListener("change", () => { (S.plan.prefs || (S.plan.prefs = {})).autoExplain = auto.checked; Store.savePlan(S.plan); this.paintNode(); if (auto.checked) this.want(d, page); });
    const head = h("div", { class:"ex-head" }, h("b", { text:`쉬운 설명 · p.${page}` }), h("span", { class:"grow" }),
      ask ? h("label", { class:"ex-auto", title:"쪽을 넘기고 1.5초 머무르면 자동으로 설명해요. 쪽마다 한 번만 만들고 저장해 둬요." }, auto, "자동") : null,
      h("button", { class:"ex-gear" + (S.plan.prefs && S.plan.prefs.explainAsk ? " on" : ""), "aria-pressed": this.editing ? "true" : "false",
        title: S.plan.prefs && S.plan.prefs.explainAsk ? "설명 방식 바꾸기 (내 요청문 사용 중)" : "설명 방식 바꾸기", "aria-label":"쉬운 설명 설정",
        onclick: () => { this.editing = !this.editing; this.draft = null; this.paintNode(); } }, "⚙"));
    const again = (label) => h("button", { class:"chip-btn", onclick: () => { this.skip.delete(key); this.go(d, page, true); } }, label);
    let body;
    if (run) body = h("div", { class:"ex-body streaming", id:"explainBody" }, richLines(shown(run.text) || "쉬운 설명을 쓰는 중…"));
    else if (saved) body = h("div", { class:"ex-body", id:"explainBody" }, richLines(shown(saved)));
    else if (!ask) body = h("p", { class:"small muted", text:"질문 답변이 연결되면 쪽마다 쉬운 설명이 여기 바로 떠요." });
    else if (this.err && this.err.key === key) body = h("div", null, h("p", { class:"check", text:this.err.text }), again("다시 설명 받기"));
    else if (this.skip.has(key)) body = h("div", null, h("p", { class:"small muted", text:"글자가 거의 없는 쪽이라 자동 설명은 건너뛰었어요." }), again("그래도 설명 보기"));
    else if (!this.auto()) body = again("이 쪽 쉬운 설명 보기");
    else body = h("p", { class:"small muted ex-wait", text: e && e.status === "loading" ? "저장된 설명을 불러오는 중…" : "잠깐 머무르면 쉬운 설명이 떠요…" });
    return h("div", { class:"explain", id:"explainCard" }, head, this.editing ? this.editor(d, page) : null, body);
  },
  next(d, page){ const e = this.src[this.sid(d)], t = e && e.map.get(page); return t ? splitNext(t).next : []; },
  paintNode(){ const el = document.getElementById("explainCard"), R = S.reader, d = S.decks[R.deckId]; if (el && d) el.replaceWith(this.node(d, R.page)); if (Chat.el && !Chat.busy) Chat.paintSugs(); },
  paintBody(){ const b = document.getElementById("explainBody"); if (b && this.run) b.replaceChildren(...richLines(shown(this.run.text) || "…")); else this.paintNode(); },
};
/* ----- floating question window: lives outside #app so re-renders never reset it.
   Answers need a paid model call, so `ask` stays unset until the user approves wiring it. ----- */
const Chat = {
  el:null, msgs:[], busy:false, ctl:null, err:"",
  // 모르는 것 노트: one conversation is one note item; a conversation continued from a card extends that card.
  noteId:null, noteSource:null, noteTitle:"", fromNote:null, base:0, quote:null,
  box(){ try{ return JSON.parse(localStorage.getItem("dejipgi.chatbox") || "null"); }catch(e){ return null; } },
  saveBox(){ if (!this.el || this.mode !== "normal") return; const r = this.el.getBoundingClientRect(); try{ localStorage.setItem("dejipgi.chatbox", JSON.stringify({ x:r.left, y:r.top, w:r.width, h:r.height })); }catch(e){} },
  mode:"normal", docked:false,
  isOpen(){ return !!(this.el && !this.el.hidden && !this.docked); },
  /* 곁 패널에 붙기: the same window, moved into the reader's side panel (no header; the panel's tabs replace it). */
  dockInto(slot, refocus){
    if (!this.el) this.build();
    const log = this.el.querySelector("#chatLog"), top = log ? log.scrollTop : 0;
    this.docked = true; this.el.classList.add("docked"); this.el.hidden = false;
    this.el.querySelector("textarea").placeholder = "물어보기 · Enter 보내기";
    for (const k of ["left","top","width","height"]) this.el.style[k] = "";
    slot.append(this.el); this.paint();
    if (log && top) log.scrollTop = top;
    if (refocus) this.el.querySelector("textarea").focus({ preventScroll:true });
  },
  undock(){
    if (!this.el || !this.docked) return;
    this.docked = false; this.el.classList.remove("docked"); this.el.hidden = true;
    this.el.querySelector("textarea").placeholder = "지금 보는 쪽에 대해 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)";
    root.append(this.el); this.setMode("normal");
  },
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
  close(){ if (this.docked) return; if (this.ctl) this.ctl.abort(); if (this.el) this.el.hidden = true; if (S.view === "read") render(); },
  open(){
    // Docked: the window is already on screen; show what was just loaded into it (a saved talk, a card's thread).
    if (this.docked){ setPanelTab("ask"); this.paint(); setTimeout(() => this.el.querySelector("textarea").focus(), 0); return; }
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
      h("button", { class:"qbtn", title:"새 대화 시작 (지금 대화는 노트에 남아요)", onclick: () => this.reset() }, "새 대화"),
      h("button", { class:"qbtn", id:"chatMin", "aria-label":"질문 창 접기", title:"접기", onclick: () => this.setMode(this.mode === "min" ? "normal" : "min") }, "—"),
      h("button", { class:"qbtn", id:"chatMax", "aria-label":"질문 창 크게", title:"크게 보기", onclick: () => this.setMode(this.mode === "max" ? "normal" : "max") }, "⤢"),
      h("button", { class:"qbtn", "aria-label":"질문 창 닫기", title:"닫기", onclick: () => this.close() }, "✕"));
    head.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) this.setMode(this.mode === "max" ? "normal" : "max"); });
    this.el = h("section", { class:"chatwin", role:"dialog", "aria-label":"질문하기", hidden:true },
      head, h("div", { class:"chat-saved", id:"chatSaved", hidden:true }),
      h("div", { class:"chat-log", id:"chatLog", "aria-live":"polite" }),
      h("div", { class:"chat-foot" }, h("div", { class:"chat-in" }, h("div", { id:"chatQuote" }), ta), h("button", { class:"btn primary small", id:"chatSend", onclick: () => this.send() }, "보내기")));
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
    const saved = this.el.querySelector("#chatSaved");
    saved.hidden = !this.noteTitle; saved.textContent = this.noteTitle ? `노트 · ${this.noteTitle}` : ""; saved.title = saved.textContent;
    const qbox = this.el.querySelector("#chatQuote");
    qbox.replaceChildren(...(this.quote ? [h("div", { class:"qchip" }, h("span", { text:`“${this.quote}”` }), h("button", { class:"qbtn", "aria-label":"인용 빼기", onclick: () => { this.quote = null; this.paint(); } }, "✕"))] : []));
    const log = this.el.querySelector("#chatLog");
    const nodes = [];
    if (this.fromNote) nodes.push(h("p", { class:"chat-hint", style:"text-align:center", text:`‘${this.fromNote}’ 카드에서 이어진 대화예요. 여기 대화도 그 카드에 저장돼요.` }));
    if (this.docked && c) nodes.push(Explain.node(c.d, c.page));
    if (!this.msgs.length)
      nodes.push(h("p", { class:"chat-hint", text: this.docked ? "더 궁금한 건 바로 물어보거나 아래에서 골라 보세요. 원문을 드래그해 [질문 창에 넣기]로 인용할 수도 있어요." : "지금 보는 쪽을 근거로 답해요. 바로 물어보거나 아래에서 골라 보세요. 원문을 드래그해 [질문 창에 넣기]로 인용할 수도 있어요." }));
    for (const m of this.msgs){
      nodes.push(h("div", { class:"bubble " + m.role },
        m.page && m.role === "user" ? h("span", { class:"bpage", text:`p.${m.page}` }) : null,
        m.quote ? h("div", { class:"qchip", text:`“${m.quote}”` }) : null,
        h("div", { class:"btext" }, m.role === "assistant" ? richLines(shown(m.content) || "…") : m.content)));
    }
    if (this.err) nodes.push(h("p", { class:"check", text:this.err }));
    nodes.push(this.sugs(c));
    log.replaceChildren(...nodes);
    log.scrollTop = log.scrollHeight;
    const send = this.el.querySelector("#chatSend");
    send.textContent = this.busy ? "멈추기" : "보내기";
    send.onclick = () => this.busy ? (this.ctl && this.ctl.abort()) : this.send();
  },
  /* 질문 칩: up to 2–3 questions for this page (✎ puts one in the box to edit) and one next action */
  sugs(c){
    const box = h("div", { class:"chat-sugs", id:"chatSugs" });
    if (!c || this.busy) return box;
    const act = pageAction(c), qs = pageSuggestions(c).slice(0, act ? 2 : 3);
    if (!qs.length && !this.msgs.length) qs.push({ label:"이 쪽 쉽게 설명해 줘", why:"" });
    for (const q of qs) box.append(h("span", { class:"sug" + (q.why === "AI 제안" ? " ai" : "") },
      h("button", { class:"chip-btn", title:q.why ? `${q.why} · 누르면 바로 물어봐요` : null, onclick: () => { this.el.querySelector("textarea").value = q.label; this.send(); } },
        q.why === "AI 제안" ? h("span", { class:"sug-ai", "aria-label":"AI 제안", text:"✦" }) : null, q.label),
      h("button", { class:"sug-edit", title:"입력창에 넣고 고쳐 쓰기", "aria-label":"고쳐서 묻기", onclick: () => { const ta = this.el.querySelector("textarea"); ta.value = q.label; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, "✎")));
    if (act) box.append(h("button", { class:"chip-btn act", onclick: act.run }, act.label));
    return box;
  },
  paintSugs(){
    const old = this.el && this.el.querySelector("#chatSugs"); if (!old) return;
    const log = this.el.querySelector("#chatLog"), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    old.replaceWith(this.sugs(this.context())); if (atEnd) log.scrollTop = log.scrollHeight;
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
${NEXT_RULE}

[자료] ${c.d.title}
[지금 보는 쪽 p.${c.page}]
${text || "(이 쪽은 추출된 글자가 없다. 이미지 위주의 쪽일 수 있다.)"}
${c.objs.length ? `\n[이 쪽의 학습목표]\n${c.objs.map(o => "- " + o.statement).join("\n")}` : ""}
`;
  },
  reset(keepOpen){
    if (this.ctl) this.ctl.abort();
    Object.assign(this, { msgs:[], err:"", noteId:null, noteSource:null, noteTitle:"", fromNote:null, base:0, quote: keepOpen ? this.quote : null });
    if (!keepOpen) this.paint();
  },
  /* 질문 창에 넣기: the dragged text becomes a quote chip on the next question */
  quoteIn(text){
    this.quote = text;
    if (this.docked){ setPanelTab("ask"); this.paint(); this.el.querySelector("textarea").focus(); return; }
    if (!this.isOpen()) this.open(); else { this.paint(); this.el.querySelector("textarea").focus(); }
  },
  /* 질문 창에서 계속: carry a card's answer and turns into the window; new turns go back to that card */
  continueNote(d, note){
    this.reset(true);
    this.msgs = [{ role:"assistant", content:note.answer ? note.answer.lead : "" }, ...note.thread.map(t => ({ role:t.role, content:t.text, quote:t.quote || null }))];
    Object.assign(this, { base:this.msgs.length, noteId:note.id, noteSource:d.sourceCatalogId, fromNote:note.quote, noteTitle:`‘${note.quote}’ 카드` });
    if (this.isOpen()) this.paint(); else this.open();
  },
  openTalk(d, note){
    this.reset(true);
    this.msgs = note.thread.map(t => ({ role:t.role, content:t.text, quote:t.quote || null, page:t.role === "user" ? t.page : undefined }));
    Object.assign(this, { base:0, noteId:note.id, noteSource:d.sourceCatalogId, noteTitle:note.quote });
    if (this.isOpen()) this.paint(); else this.open();
    notesApi.seen(d.sourceCatalogId, note.id).then(n => { if (n) putNote(d, n); }, () => {});
  },
  async saveTalk(c){
    if (!notesOn(c.d)) return;
    const turns = this.msgs.slice(this.base).filter(m => m.content).map(m => ({ role:m.role, text:m.content, quote:m.quote || null, page: m.role === "user" ? m.page : undefined }));
    if (!turns.some(t => t.role === "assistant")) return;
    try{
      const note = await notesApi.talk({ sourceId:c.d.sourceCatalogId, page:c.page, noteId:this.noteId, turns });
      const first = !this.noteId;
      Object.assign(this, { noteId:note.id, noteSource:c.d.sourceCatalogId, noteTitle: note.kind === "talk" ? note.quote : `‘${note.quote}’ 카드` });
      putNote(c.d, note); this.paint(); paintDrawer();
      if (first && note.kind === "talk"){ toast("이 대화를 ‘모르는 것’ 노트에 남겼어요."); if (S.view === "read" && !window.getSelection().toString()) render(); }
    }catch{ /* the answer is already on screen; saving is retried with the next turn */ }
  },
  async send(){
    const ta = this.el.querySelector("textarea");
    const q = ta.value.trim() || (this.quote ? "이 부분 설명해 줘" : ""); if (!q || this.busy) return;
    const c = this.context();
    if (!c) return;
    if (!ask){ this.err = "질문 답변은 아직 연결하지 않았어요. 유료 호출이라 확인을 받은 뒤 붙일 예정이에요."; this.paint(); return; }
    if (S.session) S.session.viewed.add(c.d.id + ":" + c.page);   // asking about a page during practice counts as help
    ta.value = ""; this.err = "";
    if (this.noteId && this.noteSource !== c.d.sourceCatalogId) this.reset(true);   // another material: a new conversation
    this.msgs.push({ role:"user", content:q, page:c.page, quote:this.quote });
    this.quote = null;
    const reply = { role:"assistant", content:"", page:c.page }; this.msgs.push(reply);
    this.busy = true; this.ctl = new AbortController(); this.paint();
    const history = this.msgs.slice(0, -1).slice(-12).map(m => ({ role:m.role, content: m.role === "user" ? `${m.page ? `(p.${m.page}를 보며) ` : ""}${m.quote ? `[원문 인용] “${m.quote}”\n` : ""}${m.content}` : m.content })).filter(m => m.content);
    const turns = [{ role:"user", content:this.prompt(c, await pageText(c.d, c.page)) }, ...history];
    try{
      await ask(turns, { signal:this.ctl.signal, onText: ({ text }) => { reply.content = text; const last = this.el.querySelector("#chatLog .bubble.assistant:last-of-type .btext"); if (last) last.replaceChildren(...richLines(shown(text))); } });
      const sp = splitNext(reply.content); reply.content = sp.body; reply.next = sp.next;
      if (JSON.stringify(reply.content).includes("$") && !katexLib){ await ensureKatex(); }
      this.saveTalk(c);
    }catch(e){
      if (e && e.text) reply.content = shown(e.text);
      if (!(e && e.code === "cancelled")) this.err = sampleErrorCopy(e);
      if (!reply.content) this.msgs.pop();
    }finally{ this.busy = false; this.ctl = null; this.paint(); }
  }
};
/* ----- 모르는 것 노트 (docs/DECISIONS.md 2026-09-30): drag over the page → ask → a card linked to the text.
   A phrase asked once is answered from the note after that (no model call); re-views mark weak points. ----- */
const notesApi = env.notes || null;
const NOTE_WEAK = 3;
const NOTE_KIND = { term:["용어","k-term"], procedure:["절차","k-proc"], concept:["개념","k-concept"], talk:["대화","k-talk"] };
const NT = { src:{}, open:null, asking:null, anchor:null, again:false, err:null, busy:false, drawer:false, filter:"all", tab:"notes" };
function agoText(iso){
  const d = now() - Date.parse(iso);
  if (!(d >= 0)) return "방금";
  if (d < MIN) return "방금";
  if (d < 60*MIN) return `${Math.round(d / MIN)}분 전`;
  if (d < DAY) return `${Math.round(d / (60*MIN))}시간 전`;
  return `${Math.round(d / DAY)}일 전`;
}
function phraseKey(t){ return String(t ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR"); }
function notesOn(d){ return !!(notesApi && d && d.sourceCatalogId && !d.example); }
function noteList(d){ const e = notesOn(d) && NT.src[d.sourceCatalogId]; return e ? e.list : []; }
function loadNotes(d){
  if (!notesOn(d) || NT.src[d.sourceCatalogId]) return;
  const k = d.sourceCatalogId; NT.src[k] = { status:"loading", list:[] };
  notesApi.list(k).then(list => { NT.src[k] = { status:"ready", list }; }, () => { NT.src[k] = { status:"error", list:[] }; })
    .then(() => { if (!disposed && (S.view === "read" || (!S.session && S.view !== "create"))) render(); });
}
function putNote(d, note){
  if (!note) return;
  const e = NT.src[d.sourceCatalogId] || (NT.src[d.sourceCatalogId] = { status:"ready", list:[] });
  const i = e.list.findIndex(n => n.id === note.id);
  if (i >= 0) e.list[i] = note; else e.list.push(note);
}
function findPhrase(d, quote){ const k = phraseKey(quote); return noteList(d).find(n => n.kind !== "talk" && phraseKey(n.quote) === k) || null; }
function noteError(e){
  const c = e && e.code;
  if (c === "usage_limit") return { text:"ChatGPT 사용량 한도에 닿았어요. 한도가 풀리면 다시 물어봐 주세요.", retry:true };
  if (c === "login_required" || c === "not_configured") return { text:(e && e.message) || "ChatGPT 계정을 연결해 주세요.", login:true };
  return { text:(e && e.message) || "답을 받지 못했어요.", retry:true };
}
async function sentenceAround(d, page, quote){
  const text = await pageText(d, page);
  const r = findRange(text, quote); if (!r) return null;
  const before = text.slice(0, r[0]), after = text.slice(r[1]);
  const s = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("다. ")) + 1;
  const eRel = after.search(/[.!?。](\s|$)|\n/);
  return text.slice(s, r[1] + (eRel < 0 ? after.length : eRel + 1)).replace(/\s+/g, " ").trim().slice(0, 800);
}

/* ask: a new phrase calls the model once; a known one opens its saved answer */
async function askPhrase(d, page, quote, anchor){
  hideSel();
  const known = findPhrase(d, quote);
  if (known && known.status === "answered"){ openNote(d, known.id, true); return; }
  NT.open = null; NT.asking = { quote, page }; NT.anchor = anchor; NT.again = false; NT.err = null; NT.busy = true;
  render();
  try{
    const [sentence, text] = await Promise.all([sentenceAround(d, page, quote), pageText(d, page)]);
    const res = await notesApi.ask({ sourceId:d.sourceCatalogId, page, quote, sentence, pageText:text, title:d.title, purpose:d.purpose || null });
    putNote(d, res.note);
    NT.open = res.note.id; NT.asking = null; NT.again = !!res.reused;
  }catch(e){ NT.err = noteError(e); }
  finally{ NT.busy = false; if (!disposed) render(); }
}
async function markPhrase(d, page, quote){
  hideSel();
  try{ const note = await notesApi.mark({ sourceId:d.sourceCatalogId, page, quote, sentence: await sentenceAround(d, page, quote) }); putNote(d, note); toast("모름으로 표시했어요. 밑줄을 누르면 그때 물어봐요."); render(); }
  catch(e){ toast(noteError(e).text); }
}
function openNote(d, id, countSeen){
  const note = noteList(d).find(n => n.id === id); if (!note) return;
  if (note.status === "marked"){ askPhrase(d, note.page, note.quote, null); return; }
  NT.open = id; NT.asking = null; NT.err = null; NT.anchor = null; NT.again = !!countSeen;
  render();
  if (countSeen) notesApi.seen(d.sourceCatalogId, id).then(n => { putNote(d, n); if (NT.open === id && !disposed) render(); }, () => {});
}
function closeNote(){ NT.open = null; NT.asking = null; NT.err = null; NT.anchor = null; render(); }
async function followNote(d, note, q){
  NT.busy = true; NT.err = null; render();
  try{ putNote(d, await notesApi.follow({ sourceId:d.sourceCatalogId, noteId:note.id, question:q, pageText: await pageText(d, note.page), title:d.title })); }
  catch(e){ NT.err = noteError(e); }
  finally{ NT.busy = false; if (!disposed) render(); }
}

/* the transparent text layer over the canvas: lets the reader drag-select the PDF's own words */
/* Where each word of a text item really sits on the rendered page. pdf.js reports one width per item, but in some
   slides (PowerPoint, tight kerning) the drawn line is ~10% narrower than that width, and the invisible text font
   spaces letters differently from the slide font, so hover boxes and highlights drifted off the words.
   We read the ink of the item's line from the canvas: when the gaps between ink runs match the item's words,
   each word gets its own measured box; otherwise the item keeps one box trimmed to where its ink ends. */
function inkLayout(entry, page){
  const ctx = entry.canvas.getContext("2d", { willReadFrequently:true });
  const meter = document.createElement("canvas").getContext("2d");
  const fontOf = (name) => { try{ const f = page && page.commonObjs.get(name); return f && f.loadedName ? `"${f.loadedName}", sans-serif` : "sans-serif"; }catch(e){ return "sans-serif"; } };
  const W = entry.canvas.width, H = entry.canvas.height;
  const lines = entry.items.map(it => { const tx = pdfjs.Util.transform(entry.vp.transform, it.transform); return { tx, fh:Math.hypot(tx[2], tx[3]) }; });
  return entry.items.map((it, i) => {
    const chars = [...it.str]; const { tx, fh } = lines[i];
    const w = it.width * entry.vp.scale;
    if (!chars.length || !it.str.trim() || !fh || !w || Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) return null;   // rotated: leave as is
    // Search a little past the reported width, but not into the next item on the same line.
    let right = tx[4] + w * 1.12;
    for (let k = i + 1; k < entry.items.length; k++){ const o = lines[k]; if (Math.abs(o.tx[5] - tx[5]) < fh * 0.3 && o.tx[4] > tx[4] + 1){ right = Math.min(right, o.tx[4] - 1); break; } }
    const x0 = Math.max(0, Math.floor(tx[4] - 1)), x1 = Math.min(W, Math.ceil(right)), y0 = Math.max(0, Math.floor(tx[5] - fh * 0.72)), y1 = Math.min(H, Math.ceil(tx[5] + fh * 0.05));
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    let data; try{ data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data; }catch(e){ return null; }
    const cw = x1 - x0, ch = y1 - y0;
    // Background = the corner pixel's colour; ink = anything clearly different from it.
    const bg = [data[0], data[1], data[2]];
    const ink = new Uint8Array(cw);
    for (let x = 0; x < cw; x++) for (let y = 0; y < ch; y++){
      const o = (y * cw + x) * 4;
      if (Math.max(Math.abs(data[o] - bg[0]), Math.abs(data[o + 1] - bg[1]), Math.abs(data[o + 2] - bg[2])) > 40){ ink[x] = 1; break; }
    }
    // Ink runs (any blank column splits), minus specks at the edges.
    const runs = []; let start = -1;
    for (let x = 0; x <= cw; x++){
      if (x < cw && ink[x]){ if (start < 0) start = x; continue; }
      if (start >= 0){ runs.push([start, x]); start = -1; }
    }
    // A one-pixel speck far from the text (a neighbour's antialiasing) is not a letter; a thin "I" or "l" is.
    while (runs.length > 1 && runs[0][1] - runs[0][0] <= 1 && runs[1][0] - runs[0][1] > fh * 0.3) runs.shift();
    while (runs.length > 1 && runs[runs.length - 1][1] - runs[runs.length - 1][0] <= 1 && runs[runs.length - 1][0] - runs[runs.length - 2][1] > fh * 0.3) runs.pop();
    if (!runs.length) return null;
    const words = [...it.str.matchAll(/\S+/gu)].map(m => { const a = [...it.str.slice(0, m.index)].length; return [a, a + [...m[0]].length]; });
    // We know how many words there are: the widest gaps between runs are the spaces. Accept only when those gaps
    // clearly stand out from the gaps inside words.
    if (words.length > 1 && runs.length >= words.length){
      const gaps = runs.slice(1).map((r, k) => ({ k, size:r[0] - runs[k][1] })).sort((p, q) => q.size - p.size);
      const cut = gaps.slice(0, words.length - 1), rest = gaps.slice(words.length - 1);
      const smallestCut = Math.min(...cut.map(g => g.size)), largestRest = rest.length ? Math.max(...rest.map(g => g.size)) : 0;
      if (smallestCut >= fh * 0.12 && smallestCut > largestRest * 1.3){
        const bounds = cut.map(g => g.k).sort((p, q) => p - q);
        let from = 0;
        return words.map(([a, b], k) => {
          const to = k < bounds.length ? bounds[k] : runs.length - 1;
          const seg = { a, b, x0:x0 + runs[from][0], x1:x0 + runs[to][1] };
          from = to + 1; return seg;
        });
      }
    } else if (words.length === 1) return [{ a:words[0][0], b:words[0][1], x0:x0 + runs[0][0], x1:x0 + runs[runs.length - 1][1] }];
    // Gaps inside words rival the spaces (thin fonts): place words by the slide font's own letter widths across the
    // ink, then snap each edge to the nearest blank gap so boxes start and end on real letters.
    const inkFrom = runs[0][0], inkTo = runs[runs.length - 1][1];
    if (words.length > 1 && inkTo - inkFrom > fh){
      meter.font = `${fh}px ${fontOf(it.fontName)}`;
      const full = meter.measureText(it.str.trimEnd()).width || 1, lead = meter.measureText(it.str.slice(0, it.str.length - it.str.trimStart().length)).width;
      const k = (inkTo - inkFrom) / Math.max(1, full - lead);
      const at = (ci) => inkFrom + (meter.measureText([...it.str].slice(0, ci).join("")).width - lead) * k;
      const starts = runs.map(r => r[0]), ends = runs.map(r => r[1]);
      const snap = (x, list) => { let best = x, d = fh * 0.35; for (const v of list){ const dd = Math.abs(v - x); if (dd < d){ d = dd; best = v; } } return best; };
      return words.map(([a, b]) => {
        const left = snap(at(a), starts), right = snap(at(b), ends);
        return { a, b, x0:x0 + left, x1:x0 + Math.max(right, left + 2) };
      });
    }
    const last = inkTo + x0;
    return [{ a:0, b:chars.length, x0:tx[4], x1: last > tx[4] + w * 0.5 ? last : tx[4] + w }];
  });
}
/* x of character j (or the end of character j - 1 when `end`) of item i, in canvas pixels */
function charX(entry, i, j, end){
  const it = entry.items[i], segs = entry.layout && entry.layout[i];
  const tx = pdfjs.Util.transform(entry.vp.transform, it.transform);
  if (!segs){ const len = [...it.str].length || 1; return tx[4] + it.width * entry.vp.scale * j / len; }
  const seg = segs.find(sg => end ? j > sg.a && j <= sg.b : j >= sg.a && j < sg.b) || (end ? segs[segs.length - 1] : segs[0]);
  const t = Math.min(1, Math.max(0, (j - seg.a) / Math.max(1, seg.b - seg.a)));
  return seg.x0 + (seg.x1 - seg.x0) * t;
}
function textLayer(entry, cssW){
  const W = entry.canvas.width, H = entry.canvas.height, k = cssW / W;
  const tl = h("div", { class:"tl" });
  const tokens = [];
  entry.items.forEach((it, i) => {
    if (!it.str || !it.str.trim()) return;
    const tx = pdfjs.Util.transform(entry.vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]); if (!fh) return;
    const angle = Math.atan2(tx[1], tx[0]);
    const segs = entry.layout && entry.layout[i];
    const chars = [...it.str];
    // One span per measured word (or per item when words could not be told apart), sized to its ink.
    const parts = segs ? segs.map(sg => ({ text:chars.slice(sg.a, sg.b).join(""), x:sg.x0, w:sg.x1 - sg.x0 })) : [{ text:it.str, x:tx[4], w:it.width * entry.vp.scale }];
    parts.forEach((part, k2) => {
      const span = h("span", { style:`left:${part.x / W * 100}%;top:${(tx[5] - fh * 0.86) / H * 100}%;font-size:${(fh * k).toFixed(2)}px` }, part.text);
      span._w = part.w * k; span._a = angle;
      tl.append(span, k2 < parts.length - 1 ? " " : "");
      // Words with their page box (canvas px), for meaning-unit boxes (chunk.ts).
      const node = span.firstChild, first = segs ? segs[k2].a : 0;
      if (!angle) for (const m of part.text.matchAll(/\S+/gu)){
        const a = [...part.text.slice(0, m.index)].length, b = a + [...m[0]].length;
        const x0 = segs && parts.length > 1 ? part.x : charX(entry, i, first + a, false);
        const x1 = segs && parts.length > 1 ? part.x + part.w : charX(entry, i, first + b, true);
        tokens.push({ text:m[0], node, start:m.index, end:m.index + m[0].length, x0, x1, y0:tx[5] - fh * 0.9, y1:tx[5] + fh * 0.2, base:tx[5], fh });
      }
    });
    tl.append(it.hasEOL ? "\n" : " ");
  });
  // Lines: words on the same baseline, left to right, across text items.
  const lines = [];
  tokens.map((t, n) => n).sort((a, b) => tokens[a].base - tokens[b].base || tokens[a].x0 - tokens[b].x0).forEach(n => {
    const t = tokens[n], line = lines[lines.length - 1];
    if (line && Math.abs(tokens[line[0]].base - t.base) < t.fh * 0.3) line.push(n); else lines.push([n]);
  });
  // Pieces that touch on the page are one word ("Raster" "-" "Scan" drawn as separate items → "Raster-Scan").
  const merged = [];
  for (const line of lines){
    line.sort((a, b) => tokens[a].x0 - tokens[b].x0);
    const out = [];
    for (const n of line){
      const t = tokens[n], prev = out[out.length - 1];
      const hyphen = prev && (/[-‐‑–]$/.test(prev.text) || /^[-‐‑–]/.test(t.text));
      if (prev && t.x0 - prev.x1 < t.fh * (hyphen ? 0.22 : 0.08)) Object.assign(prev, { text:prev.text + t.text, x1:Math.max(prev.x1, t.x1), endNode:t.endNode || t.node, end:t.end, y0:Math.min(prev.y0, t.y0), y1:Math.max(prev.y1, t.y1) });
      else out.push({ ...t });
    }
    const ids = out.map(t => merged.push(t) - 1);
    ids.forEach((id, pos) => { merged[id].line = ids; merged[id].pos = pos; });
  }
  tl._tokens = merged; tl._W = W; tl._H = H;
  requestAnimationFrame(() => {
    for (const span of tl.querySelectorAll("span")){
      const w = span.offsetWidth; if (!w) continue;
      span.style.transform = `${span._a ? `rotate(${span._a}rad) ` : ""}scaleX(${span._w / w})`;
    }
  });
  return tl;
}
/* Preview the word under the pointer without changing the reader's drag selection. */
let wordHover = null, wordPress = null;
function clearWordHover(){ if (wordHover) wordHover.remove(); wordHover = null; }
function pdfWordAtPoint(x, y){
  let node, offset;
  if (document.caretPositionFromPoint){
    const caret = document.caretPositionFromPoint(x, y);
    if (caret){ node = caret.offsetNode; offset = caret.offset; }
  } else if (document.caretRangeFromPoint){
    const caret = document.caretRangeFromPoint(x, y);
    if (caret){ node = caret.startContainer; offset = caret.startOffset; }
  }
  if (!node || node.nodeType !== 3 || !node.parentElement.closest(".tl") || !root.contains(node)) return null;
  for (const match of node.textContent.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu)){
    const end = match.index + match[0].length;
    if (offset < match.index || offset > end) continue;
    const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, end);
    const rect = range.getBoundingClientRect();
    // Caret APIs also return the nearest text when the pointer is in empty page space.
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { range, rect };
  }
  return null;
}
/* 의미 단위: the material's terms first, then phrase rules (src/lib/study/chunk.ts); Alt keeps one word. */
function readerLexicon(){
  const d = S.decks[S.reader.deckId]; if (!d || !env.chunk) return null;
  const asked = noteList(d).filter(n => n.kind !== "talk").map(n => n.quote);
  const sig = asked.length + ":" + (d.outline ? d.outline.length : 0);
  if (!d._lex || d._lexSig !== sig){ try{ d._lex = env.chunk.lexicon(d, asked); d._lexSig = sig; }catch(e){ d._lex = null; } }
  return d._lex;
}
function unitAt(e){
  const tl = e.target.closest && e.target.closest(".tl"); if (!tl || !tl._tokens || !tl._tokens.length) return null;
  const box = tl.getBoundingClientRect(), sx = box.width / tl._W, sy = box.height / tl._H;
  const px = (e.clientX - box.left) / sx, py = (e.clientY - box.top) / sy;
  // The word whose box is nearest to the pointer on that line, so small moves in the gaps between words, or just
  // above or below the letters, keep the same unit instead of falling back to the old single-word guess.
  let hit = null, best = Infinity;
  for (const t of tl._tokens){
    const pad = t.fh * 0.25;
    if (py < t.y0 - pad || py > t.y1 + pad) continue;
    const dx = px < t.x0 ? t.x0 - px : px > t.x1 ? px - t.x1 : 0;
    if (dx > t.fh * 0.6) continue;
    const dy = py < t.y0 ? t.y0 - py : py > t.y1 ? py - t.y1 : 0;
    const d = dx + dy * 2;
    if (d < best){ best = d; hit = t; }
  }
  if (!hit) return null;
  const words = hit.line.map(n => tl._tokens[n].text);
  const c = e.altKey || !env.chunk ? { start:hit.pos, end:hit.pos, kind:"word" } : env.chunk.at(words, hit.pos, readerLexicon());
  const list = hit.line.slice(c.start, c.end + 1).map(n => tl._tokens[n]);
  const x0 = Math.min(...list.map(t => t.x0)), x1 = Math.max(...list.map(t => t.x1)), y0 = Math.min(...list.map(t => t.y0)), y1 = Math.max(...list.map(t => t.y1));
  const tail = list[list.length - 1];
  const range = document.createRange(); range.setStart(list[0].node, list[0].start); range.setEnd(tail.endNode || tail.node, tail.end);
  return { kind:c.kind, range, rect:{ left:box.left + x0 * sx, top:box.top + y0 * sy + (y1 - y0) * sy * 0.08, width:(x1 - x0) * sx, height:(y1 - y0) * sy * 0.84 } };
}
on(root, "mousemove", (e) => {
  clearWordHover();
  const sel = window.getSelection();
  if (e.buttons || sel && !sel.isCollapsed || !e.target.closest(".tl")) return;
  const unit = unitAt(e);
  // Pages with measured words use only those; the caret guess is for pages without them (rotated text and the like).
  const tlNow = e.target.closest(".tl");
  const word = unit || (tlNow && tlNow._tokens && tlNow._tokens.length ? null : pdfWordAtPoint(e.clientX, e.clientY)); if (!word) return;
  const r = word.rect;
  wordHover = h("div", { class:`pdf-word-hover${unit && unit.kind === "term" ? " term" : ""}`, "aria-hidden":"true", title: unit && unit.kind === "term" ? "이 자료의 용어" : null,
    style:`left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` });
  root.append(wordHover);
});
on(root, "mousedown", (e) => {
  clearWordHover();
  wordPress = e.button === 0 && e.target.closest(".tl") ? { x:e.clientX, y:e.clientY } : null;
});
on(root, "mouseup", (e) => {
  const press = wordPress; wordPress = null;
  const sel = window.getSelection();
  if (!press || !sel || !sel.isCollapsed || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return;
  const tlNow = e.target.closest && e.target.closest(".tl");
  const word = unitAt(e) || (tlNow && tlNow._tokens && tlNow._tokens.length ? null : pdfWordAtPoint(e.clientX, e.clientY)); if (!word) return;
  sel.removeAllRanges(); sel.addRange(word.range); // Existing selection menu handles the click, not a model call.
});
on(root, "mouseleave", clearWordHover);
on(window, "scroll", clearWordHover, { passive:true, capture:true });
on(window, "resize", clearWordHover);
/* where a note's phrase sits on the page: part of a text item, split by character position */
function phraseRects(entry, quote){
  let s = ""; const map = [];
  entry.items.forEach((it, i) => { [...it.str.normalize("NFKC")].forEach((ch, j) => { if (/\s/.test(ch)) return; s += ch.toLocaleLowerCase("ko-KR"); map.push([i, j]); }); });
  const q = looseText(quote); if (q.length < 2) return [];
  const at = s.indexOf(q); if (at < 0) return [];
  const byItem = new Map();
  for (const [i, j] of map.slice(at, at + q.length)){ const r = byItem.get(i); byItem.set(i, r ? [Math.min(r[0], j), Math.max(r[1], j)] : [j, j]); }
  return [...byItem].map(([i, [a, b]]) => {
    const it = entry.items[i];
    const tx = pdfjs.Util.transform(entry.vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]);
    const xa = charX(entry, i, a, false), xb = charX(entry, i, b + 1, true);
    return { x:xa, y:tx[5] - fh * 0.95, w:xb - xa, h:fh * 1.2 };
  }).filter(r => r.w > 0);
}
function noteMarks(d, entry, W, H){
  const out = [];
  for (const note of noteList(d)){
    if (note.kind === "talk") continue;
    const weak = note.seen >= NOTE_WEAK, on = NT.open === note.id;
    for (const r of phraseRects(entry, note.quote)){
      out.push(h("button", { class:"nu" + (weak ? " weak" : "") + (on ? " on" : "") + (note.status === "marked" ? " marked" : ""), "data-note":note.id,
        title: note.status === "marked" ? "모름 표시 · 누르면 물어봐요" : "물어본 곳 · 누르면 저장된 답", "aria-label":`${note.quote} 노트 열기`,
        style:`left:${r.x / W * 100}%;top:${r.y / H * 100}%;width:${r.w / W * 100}%;height:${r.h / H * 100}%`,
        onclick:(e) => { e.stopPropagation(); openNote(d, note.id, true); } }));
    }
  }
  return out;
}

/* selection menu: lives outside #app so re-renders do not reset it */
let selPop = null, selTimer = null;
function hideSel(){ if (selPop) selPop.remove(); selPop = null; }
function readSelection(){
  const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim(); if (!text || text.length > 400) return null;
  const range = sel.getRangeAt(0);
  const el = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const tl = el && el.closest(".tl"); if (!tl || !root.contains(tl)) return null;
  const box = tl.closest(".pagebox"); const key = box && box.dataset.key; if (!key) return null;
  const cut = key.lastIndexOf(":");
  const rect = range.getBoundingClientRect(), br = box.getBoundingClientRect();
  return { text, rect, deckId:key.slice(0, cut), page:Number(key.slice(cut + 1)), yRatio:(rect.top + rect.height / 2 - br.top) / br.height };
}
function showSel(){
  const info = readSelection(); if (!info){ hideSel(); return; }
  const d = S.decks[info.deckId]; if (!d) return;
  const canNote = notesOn(d), chatOpen = Chat.isOpen() || Chat.docked;
  if (!canNote && !chatOpen){ hideSel(); return; }
  hideSel();
  const known = canNote ? findPhrase(d, info.text) : null;
  const anchor = { deckId:d.id, page:info.page, yRatio:info.yRatio };
  const btns = [];
  if (canNote){
    btns.push(known && known.status === "answered"
      ? h("button", { onclick: () => { window.getSelection().removeAllRanges(); hideSel(); openNote(d, known.id, true); } }, "저장된 답 보기")
      : h("button", { onclick: () => { window.getSelection().removeAllRanges(); askPhrase(d, info.page, info.text, anchor); } }, "물어보기", h("span", { class:"k", text:"Enter" })));
    if (!known) btns.push(h("button", { title:"답은 나중에, 모른다는 표시만", onclick: () => { window.getSelection().removeAllRanges(); markPhrase(d, info.page, info.text); } }, "모름 표시"));
  }
  if (chatOpen) btns.push(h("button", { onclick: () => { window.getSelection().removeAllRanges(); hideSel(); Chat.quoteIn(info.text); } }, "질문 창에 넣기"));
  const below = info.rect.top < 64;
  selPop = h("div", { class:"selpop" + (below ? " below" : ""), role:"toolbar", "aria-label":"고른 글",
    style:`left:${Math.min(Math.max(info.rect.left + info.rect.width / 2, 110), innerWidth - 110)}px;top:${below ? info.rect.bottom + 8 : info.rect.top - 8}px` }, btns);
  selPop.addEventListener("mousedown", (e) => e.preventDefault());   // keep the selection while clicking
  root.append(selPop);
}
on(document, "mouseup", (e) => { if (e.target.closest && e.target.closest(".selpop")) return; setTimeout(showSel, 0); });
on(document, "selectionchange", () => {
  clearTimeout(selTimer);
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed){ if (selPop && !selPop.matches(":hover")) hideSel(); return; }
  if (matchMedia("(hover:none)").matches) selTimer = setTimeout(showSel, 450);   // touch: no mouseup after handles move
});
on(window, "scroll", () => { if (selPop) hideSel(); }, { passive:true });
on(document, "keydown", (e) => {
  if (!selPop || e.isComposing) return;
  if (e.key === "Escape"){ hideSel(); return; }
  if (e.key === "Enter"){ const b = selPop.querySelector("button"); if (b){ e.preventDefault(); b.click(); } }
});

/* answer card: right column on wide screens (linked by a line), bottom sheet on narrow ones */
function renderNoteCard(d){
  if (!notesOn(d)) return null;
  const note = NT.open ? noteList(d).find(n => n.id === NT.open) : null;
  if (!note && !NT.asking) return null;
  const quote = note ? note.quote : NT.asking.quote;
  const [kl, kc] = NOTE_KIND[note ? note.kind : "term"];
  const weak = note && note.seen >= NOTE_WEAK;
  const a = note && note.answer;
  const body = [];
  if (!note || NT.busy && !a){
    body.push(NT.err ? null : h("div", { class:"nskel" }, h("i", { style:"width:88%" }), h("i", { style:"width:62%" }), h("i", { style:"width:74%" })));
  } else if (a){
    body.push(h("p", { class:"nlead" }, ...richText(a.lead)));
    if (a.steps && a.steps.length) body.push(h("ol", { class:"nsteps" }, a.steps.map(s => h("li", null, h("b", null, ...richText(s.step)), s.why ? h("span", { class:"why" }, " — ", ...richText(s.why)) : null))));
    if (a.quote) body.push(h("div", { class:"nquote", text:`“${a.quote}”` }));
    if (a.extra) body.push(h("p", { class:"nextra" }, ...richText(a.extra)));
    if (a.outsideSource) body.push(h("div", { class:"nout" }, h("b", { text:"원문 밖 설명" }), " · ", ...richText(a.outsideSource)));
  }
  const thread = note && note.thread.length ? h("div", { class:"nthread" }, note.thread.map(t => h("div", { class:"bubble " + (t.role === "user" ? "user" : "assistant") }, h("div", { class:"btext" }, t.role === "user" ? t.text : richLines(t.text))))) : null;
  const err = NT.err ? h("div", { class:"nerr", role:"alert" }, h("span", { text:NT.err.text }),
    NT.err.login ? h("button", { class:"btn small", onclick:connectAccount }, "ChatGPT 연결") : null,
    NT.err.retry && !note ? h("button", { class:"btn small", onclick: () => askPhrase(d, NT.asking.page, NT.asking.quote, NT.anchor) }, "다시 시도") : null) : null;
  const input = h("input", { name:"q", placeholder:"이어서 물어보기", "aria-label":"이어서 물어보기", autocomplete:"off", disabled: NT.busy ? "" : null });
  const follow = note && a ? h("form", { class:"nfollow", onsubmit:(e) => { e.preventDefault(); const q = input.value.trim(); if (q && !NT.busy) followNote(d, note, q); } },
    input, h("button", { class:"btn small", disabled: NT.busy ? "" : null }, NT.busy ? "답 기다리는 중…" : "보내기")) : null;
  return h("aside", { class:"notecard" + (weak ? " weak" : ""), role:"dialog", "aria-label":`${quote} 노트` },
    h("div", { class:"nhd" }, h("span", { class:`nk ${kc}`, text:kl }), h("span", { class:"nq", title:quote, text:quote }), weak ? h("span", { class:"nk k-weak", text:"약점" }) : null,
      h("button", { class:"qbtn", "aria-label":"닫기", onclick:closeNote }, "✕")),
    note && NT.again ? h("div", { class:"nagain", text: weak ? `${note.seen}번째 다시 봄 · 약점으로 표시했어요` : `${note.seen}번째 다시 봄 · 저장된 답이에요 (AI 호출 없음)` }) : null,
    h("div", { class:"nbody" }, body, thread, err),
    follow,
    note && note.thread.length >= 4 ? h("div", { class:"ncont" }, h("span", { text:"대화가 길어졌어요." }), h("button", { class:"btn small", onclick: () => { Chat.continueNote(d, note); closeNote(); } }, "질문 창에서 계속")) : null,
    note ? h("div", { class:"nft" }, h("span", { text:`p.${note.page} · ${agoText(note.askedAt)} 물어봄` }), h("span", { class:"grow" }), h("span", { text:`다시 본 횟수 ${note.seen}` })) : null);
}
/* line the card up with its text and draw the link from the page's right edge (wide layout only) */
function placeNoteCard(){
  // Side panel layout (slides, wide screens): the answer card opens over the panel, like a page laid on top of it,
  // instead of floating in the corner where the docked question window is.
  const side = document.querySelector(".rside"), flt = document.querySelector(".rgrid.noteflt .notecard");
  if (flt){
    flt.classList.toggle("onside", !!side);
    if (side){ const r = side.getBoundingClientRect();
      Object.assign(flt.style, { left:r.left + "px", top:Math.max(8, r.top) + "px", width:r.width + "px", height:Math.min(r.height, innerHeight - Math.max(8, r.top) - 8) + "px", right:"auto", bottom:"auto" }); }
    else for (const k of ["left","top","width","height","right","bottom"]) flt.style[k] = "";
  }
  const grid = document.querySelector(".rgrid.noteopen"); if (!grid) return;
  const card = grid.querySelector(".notecard"), box = document.getElementById("pagebox");
  grid.querySelectorAll(".nlink,.ntick").forEach(el => el.remove());
  if (!card || !box || getComputedStyle(card).position === "fixed") return;
  const gr = grid.getBoundingClientRect(), br = box.getBoundingClientRect();
  let y = null;
  const mark = box.querySelector(`.nu[data-note="${NT.open}"]`);
  if (mark){ const r = mark.getBoundingClientRect(); y = r.top + r.height / 2 - br.top; }
  else if (NT.anchor && NT.anchor.yRatio != null) y = NT.anchor.yRatio * br.height;
  if (y == null){ card.style.marginTop = "0px"; return; }
  const top = Math.max(0, Math.min(br.top - gr.top + y - 24, br.bottom - gr.top - 120));
  card.style.marginTop = top + "px";
  const x1 = br.right - gr.left, y1 = br.top - gr.top + y, cr = card.getBoundingClientRect(), x2 = cr.left - gr.left, y2 = cr.top - gr.top + 22;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "nlink"); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", `left:0;top:0;width:${gr.width}px;height:${Math.max(y1, y2) + 4}px`);
  const mx = (x1 + x2) / 2;
  svg.innerHTML = `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/><circle cx="${x1}" cy="${y1}" r="3"/>`;
  grid.append(svg);
  grid.append(h("i", { class:"ntick", style:`left:${x1 - 2}px;top:${y1 - 9}px` }));
}
on(window, "resize", () => { if (S.view === "read") requestAnimationFrame(placeNoteCard); });

/* the notes drawer: this material's asked and marked things */
function notesButton(d){
  if (!notesOn(d)) return null;
  const n = noteList(d).length;
  return h("button", { class:"btn small", "data-notes-toggle":"", "aria-pressed": NT.drawer ? "true" : "false", onclick: () => { NT.drawer = !NT.drawer; paintDrawer(); } }, "모르는 것", n ? h("span", { class:"ncount", text:String(n) }) : null);
}
/* 목차 (서랍의 두 번째 탭): the material's own AI outline from generation — unit → part → goal — with where I got stuck.
   Red dot = 모르는 것 notes on those pages; "틀림" = a weak goal. Old-flow materials (no outline) list goals by page. */
function tocList(d){
  const R = S.reader, notes = noteList(d), hidden = new Set(d.hidden || []);
  const notesIn = (pages) => { const set = new Set(pages); return notes.filter(n => set.has(n.page)).length; };
  const dot = (n, weak) => h("span", { class:"tmarks" }, weak ? h("span", { class:"tweak", text:"틀림" }) : null,
    n ? h("span", { class:"tdot", title:`모르는 것 ${n}개`, text:String(n) }) : null);
  const span = (pages) => pages.length ? (pages.length > 1 && pages.at(-1) !== pages[0] ? `p.${pages[0]}–${pages.at(-1)}` : `p.${pages[0]}`) : "";
  const here = (pages) => pages.includes(R.page);
  const goal = (o) => { const st = objectiveState(d, o.id), pages = (o.pages || []).slice().sort((a, b) => a - b);
    return h("button", { class:"trow goal-row" + (here(pages) ? " here" : "") + (st === "weak" ? " weak" : ""), onclick: () => goPage(pages[0] || R.page) },
      h("span", { class:"tt", text:o.statement }), dot(notesIn(pages), st === "weak"), h("span", { class:"tp", text:span(pages) })); };
  const outline = Array.isArray(d.outline) && d.outline.length ? d.outline : null;
  if (!outline){
    const objs = d.objectives.filter(o => !hidden.has(o.id)).slice().sort((a, b) => (a.pages[0] || 0) - (b.pages[0] || 0));
    return objs.length ? objs.map(goal) : [h("p", { class:"small muted", style:"padding:8px", text:"아직 목차가 없어요. 문제를 만들면 목표별 목차가 생겨요." })];
  }
  return outline.map(sec => {
    const objs = sec.objectives.filter(o => !hidden.has(o.id));
    const allPages = [...new Set([...(sec.pages || []), ...objs.flatMap(o => o.pages || [])])].sort((a, b) => a - b);
    const weakN = objs.filter(o => objectiveState(d, o.id) === "weak").length;
    const parts = []; const byPart = new Map();
    for (const o of objs){ const k = o.part || ""; if (!byPart.has(k)){ byPart.set(k, []); parts.push(k); } byPart.get(k).push(o); }
    return h("section", { class:"tsec" },
      h("button", { class:"trow sec" + (here(allPages) ? " in" : ""), onclick: () => goPage(allPages[0] || R.page) },
        h("span", { class:"tt", text:sec.title }), dot(notesIn(allPages), weakN > 0), h("span", { class:"tp", text:span(allPages) })),
      ...parts.flatMap(k => {
        const list = byPart.get(k);
        if (!k) return list.map(goal);
        const pp = [...new Set(list.flatMap(o => o.pages || []))].sort((a, b) => a - b);
        return h("div", { class:"tpart" },
          h("button", { class:"trow part" + (here(pp) ? " in" : ""), onclick: () => goPage(pp[0] || R.page) }, h("span", { class:"tt", text:k }), dot(notesIn(pp), list.some(o => objectiveState(d, o.id) === "weak")), h("span", { class:"tp", text:span(pp) })),
          list.map(goal));
      }));
  });
}
/* 모르는 것 서랍: ✕, Esc, or a click anywhere outside it closes it */
function closeDrawer(){ if (!NT.drawer) return; NT.drawer = false; paintDrawer(); if (S.view === "read") render(); }
on(document, "keydown", (e) => { if (e.key === "Escape" && NT.drawer && !e.isComposing){ e.preventDefault(); closeDrawer(); } });
on(document, "pointerdown", (e) => {
  if (!NT.drawer || !e.target.closest) return;
  if (e.target.closest("#notesDrawer, [data-notes-toggle], .ncard, .selpop, .chatwin")) return;
  closeDrawer();
});
function paintDrawer(){
  let el = document.getElementById("notesDrawer");
  const d = S.decks[S.reader.deckId];
  if (!NT.drawer || S.view !== "read" || !notesOn(d)){ if (el) el.remove(); return; }
  const filters = [["all","전체"],["weak","약점"],["term","용어"],["procedure","절차"],["concept","개념"],["talk","대화"],["marked","아직 안 물어봄"]];
  const pass = (n) => NT.filter === "all" || (NT.filter === "weak" ? n.seen >= NOTE_WEAK : NT.filter === "marked" ? n.status === "marked" : n.kind === NT.filter && n.status !== "marked");
  const list = noteList(d).filter(pass).sort((a, b) => b.seen - a.seen || Date.parse(b.askedAt) - Date.parse(a.askedAt));
  const item = (n) => { const [kl, kc] = NOTE_KIND[n.kind];
    return h("button", { class:"nitem", onclick: () => {
      NT.drawer = false; paintDrawer();
      if (n.kind === "talk"){ if (S.reader.page !== n.page) goPage(n.page); Chat.openTalk(d, n); return; }
      if (S.reader.page !== n.page) goPage(n.page);
      openNote(d, n.id, true);
      setTimeout(() => { const m = document.querySelector(`.nu[data-note="${n.id}"]`); if (m) m.scrollIntoView({ block:"center", behavior:"smooth" }); }, 400);
    } },
      h("div", { class:"t" }, h("span", { class:"q", text:n.quote }), n.seen >= NOTE_WEAK ? h("span", { class:"nk k-weak", text:"약점" }) : null, h("span", { class:`nk ${kc}`, text: n.status === "marked" ? "모름" : kl })),
      h("div", { class:"s", text: n.status === "marked" ? "아직 안 물어봤어요 · 누르면 물어봐요" : n.kind === "talk" ? `질문 · ${n.answer ? n.answer.lead : ""}` : (n.answer ? n.answer.lead : "") }),
      h("div", { class:"m" }, h("span", { text:`p.${n.page}` }), h("span", { text:agoText(n.askedAt) }), h("span", { text:`다시 본 횟수 ${n.seen}` }))); };
  const dlist = el && el.querySelector(".dlist"), keepTop = dlist && el.dataset.tab === NT.tab ? dlist.scrollTop : null;
  const tabBtn = (k, label) => h("button", { role:"tab", class:"dtab", "aria-selected": NT.tab === k ? "true" : "false", onclick: () => { NT.tab = k; paintDrawer(); } }, label);
  const head = h("div", { class:"dh" },
    h("div", { class:"dtabs", role:"tablist", "aria-label":"모르는 것" }, tabBtn("notes", `노트${noteList(d).length ? " " + noteList(d).length : ""}`), tabBtn("toc", "목차")),
    h("span", { class:"grow" }), h("button", { class:"dclose", title:"닫기 (Esc)", "aria-label":"모르는 것 닫기", onclick: closeDrawer }, "✕"));
  if (NT.tab === "toc"){
    const fresh = h("aside", { class:"notesdrawer", id:"notesDrawer", role:"dialog", "aria-label":"목차", "data-tab":"toc" }, head,
      h("div", { class:"dlist toc" }, tocList(d)),
      h("div", { class:"dfoot small muted" }, h("span", { class:"tdot" }), " 모르는 것 노트 수 · ", h("span", { class:"tweak", text:"틀림" }), " 약점 목표 · 누르면 그 쪽으로 가요"));
    if (el) el.replaceWith(fresh); else root.append(fresh);
    if (keepTop != null) fresh.querySelector(".dlist").scrollTop = keepTop;
    else { const here = fresh.querySelector(".here"); if (here) here.scrollIntoView({ block:"center" }); }
    return;
  }
  const fresh = h("aside", { class:"notesdrawer", id:"notesDrawer", role:"dialog", "aria-label":"모르는 것 노트", "data-tab":"notes" }, head,
    h("div", { class:"dfilters" }, filters.map(([k, t]) => h("button", { class:"chip-btn", "aria-pressed": NT.filter === k ? "true" : "false", onclick: () => { NT.filter = k; paintDrawer(); } }, t))),
    h("div", { class:"dlist" }, list.length ? list.map(item) : h("p", { class:"small muted", style:"padding:8px", text: noteList(d).length ? "해당하는 항목이 없어요." : "원문을 드래그해 모르는 것을 물어보면 여기에 쌓여요." })),
    h("div", { class:"dfoot small muted", text:`같은 것을 ${NOTE_WEAK}번 이상 다시 보면 약점으로 표시해요.` }));
  if (el) el.replaceWith(fresh); else root.append(fresh);
}
function richLines(text){
  return String(text).split(/\n/).flatMap((line, i) => {
    const m = line.match(/^\s*원문 밖 설명\s*[:：]\s*(.*)$/);
    const node = m ? h("span", { class:"outside" }, h("b", { text:"원문 밖 설명" }), ...richText(m[1])) : null;
    const parts = node ? [node] : richText(line);
    return i ? [h("br"), ...parts] : parts;
  });
}
/* ----- 정리: one page per subject — every objective with what to recall, by material, unit and heading.
   Colored by the learner's own record; "가리기" turns it into a quick self-test before the exam. ----- */
const SUM_STATE = { weak:["약점", "bad"], new:["안 풀어봄", ""], mid:["푸는 중", "help"], good:["혼자 맞힘", "good"], none:["문제 없음", ""] };
function openSummary(subject){ S.sum.subject = subject; S.sum.shown = new Set(); S.session = null; setView("summary"); window.scrollTo({ top:0 }); }
/* The material's units; old-flow decks have no design outline, so their objectives show with the source quote. */
function summarySections(d){
  const hidden = new Set(d.hidden || []);
  if (Array.isArray(d.outline) && d.outline.length) return d.outline.map(sec => ({ title:sec.title, pages:sec.pages,
    objectives: sec.objectives.filter(o => !hidden.has(o.id)) })).filter(sec => sec.objectives.length);
  const objs = d.objectives.filter(o => !hidden.has(o.id)).map(o => ({ id:o.id, statement:o.statement, recall:"", quote:o.quote, pages:o.pages, importance:"core" }));
  return objs.length ? [{ title:"학습목표", pages:[], objectives:objs }] : [];
}
function renderSummary(){
  const all = Object.values(S.decks).filter(d => !d.pending);
  if (!all.length) return h("div", { class:"panel", text:"아직 자료가 없어요." });
  const subs = orderedSubjects().filter(s => decksOf(s.name).length);
  const hasLoose = all.some(d => !subjectOf(d));
  if (S.sum.subject == null || (S.sum.subject && !subs.some(s => s.name === S.sum.subject)) || (S.sum.subject === "" && !hasLoose)) S.sum.subject = subs.length ? subs[0].name : "";
  const subject = S.sum.subject;
  const decks = decksOf(subject);
  const wrap = h("div", { class:"stack summary" });

  const sel = h("select", { class:"btn", id:"sumSel", style:"font-weight:600" },
    subs.map(s => h("option", { value:s.name, text:`${s.name}${s.exam ? ` · ${ddayLabel(daysLeft(s.exam))}` : ""}` })),
    hasLoose ? h("option", { value:"", text:"과목 미지정" }) : null);
  sel.value = subject;
  sel.addEventListener("change", () => { S.sum.subject = sel.value; S.sum.shown = new Set(); render(); });
  const toggle = (key, label) => h("button", { class:"chip-btn", "aria-pressed": S.sum[key] ? "true" : "false", onclick: () => { S.sum[key] = !S.sum[key]; S.sum.shown = new Set(); render(); } }, label);

  // Counts over every objective shown below.
  let total = 0, weak = 0, fresh = 0;
  const perDeck = decks.map(d => {
    const secs = summarySections(d);
    const st = new Map();
    let asked = new Map();
    if (planner){ try{ const list = (NT.src[d.sourceCatalogId] && NT.src[d.sourceCatalogId].list) || []; for (const id of planner.asked(d, list.map(n => ({ page:n.page, quote:n.quote, askedAt:n.askedAt, kind:n.kind })))) asked.set(id, list.filter(n => (d.objectives.find(o => o.id === id)?.pages || []).includes(n.page)).map(n => n.quote)); }catch(e){ asked = new Map(); } }
    for (const sec of secs) for (const o of sec.objectives){ const v = objectiveState(d, o.id); st.set(o.id, v); total++; if (v === "weak") weak++; else if (v === "new") fresh++; }
    return { d, secs, st, asked };
  });
  const weakQs = weakList(decks).length;
  wrap.append(h("section", { class:"panel sum-tools stack" },
    h("div", { class:"row", style:"justify-content:space-between" },
      h("div", { class:"row" }, h("label", { for:"sumSel", class:"small muted", text:"과목" }), sel),
      h("div", { class:"row" },
        subject ? h("button", { class:"btn small primary", disabled: weakQs ? null : true, onclick: () => startWeak(subject) }, `약점 다시 풀기${weakQs ? ` ${Math.min(weakQs, WEAK_MAX)}` : ""}`) : null,
        h("button", { class:"btn small ghost", onclick: () => window.print() }, "인쇄"))),
    h("div", { class:"row" }, toggle("weakOnly", "약점·물어본 것만"), toggle("hide", "떠올릴 것 가리기"),
      h("span", { class:"small muted num", text:`목표 ${total} · 약점 ${weak} · 안 풀어봄 ${fresh}` })),
    S.sum.hide ? h("p", { class:"small muted", text:"목표만 보고 떠올린 뒤 눌러서 확인하세요. 여기서 확인한 것은 풀이 기록에 들어가지 않아요." }) : null));

  if (!decks.length) wrap.append(h("div", { class:"panel small muted", text:"이 과목에 묶인 자료가 없어요. 연습 탭의 자료 카드에서 과목을 골라 주세요." }));
  for (const { d, secs, st, asked } of perDeck){
    const box = h("section", { class:"sum-deck" });
    const dWeak = [...st.values()].filter(v => v === "weak").length;
    const supportN = (d.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").length;
    const coreOnly = !!(S.plan.prefs && S.plan.prefs.detail && S.plan.prefs.detail[planKey(d)] === "core");
    box.append(h("header", { class:"row", style:"justify-content:space-between" },
      h("div", null, h("h3", { text:displayTitle(d) }), h("p", { class:"small muted num", text:`목표 ${st.size}${dWeak ? ` · 약점 ${dWeak}` : ""}${coreOnly ? ` · 핵심만 (보조 ${supportN}개 뺌)` : ""}` })),
      h("div", { class:"row" },
        supportN ? h("button", { class:"chip-btn", "aria-pressed": coreOnly ? "true" : "false", title:"보조 목표를 연습·오늘 할 것에서 빼거나 다시 넣어요",
          onclick: () => { const det = prefs().detail || (prefs().detail = {}); if (coreOnly) delete det[planKey(d)]; else det[planKey(d)] = "core";
            ledger({ deck:d, signal: coreOnly ? "정리: 보조 목표 다시 넣기" : "정리: 핵심만", action: coreOnly ? "보조 목표 포함" : `보조 ${supportN}개 뺌`, cause:"지엽" });
            applyFilters(d); savePrefs(); } }, "핵심만") : null,
        h("button", { class:"btn small ghost", onclick: () => openReader(d.id, d.lastPage || firstPage(d)) }, "원문 읽기"))));
    // Pages of the material with no objective at all: title slides, or content the design skipped (빠뜨림).
    if (Array.isArray(d.outline) && d.outline.length){
      const covered = new Set(d.outline.flatMap(sec => sec.objectives).flatMap(o => o.pages || []));
      const gaps = [...new Set(d.outline.flatMap(sec => sec.pages || []))].filter(n => !covered.has(n)).sort((a, b) => a - b);
      if (gaps.length) box.append(h("div", { class:"gaps" },
        h("span", { class:"small muted", text:`문제가 없는 쪽 ${gaps.length}개 · 표지·목차가 아닌데 내용이 있으면 눌러 주세요` }),
        h("div", { class:"row" }, gaps.slice(0, 40).map(n => {
          const key = d.id + ":" + n, marked = S.gapMarks.has(key);
          return h("button", { class:"chip-btn", "aria-pressed": marked ? "true" : "false", title: marked ? "빠진 내용으로 기록했어요" : "빠진 내용이 있다고 기록",
            onclick: () => { if (marked) { openReader(d.id, n); return; } S.gapMarks.add(key); ledger({ deck:d, signal:`p.${n} 내용이 빠짐`, action:"빠뜨린 쪽으로 기록(다시 만들기 후보)", cause:"빠뜨림", detail:`p.${n}` }); toast(`p.${n}을 빠진 쪽으로 기록했어요. 다시 누르면 그 쪽을 열어요.`); render(); } }, `p.${n}`);
        }))));
    }
    let shownHere = 0;
    for (const sec of secs){
      const objs = sec.objectives.filter(o => !S.sum.weakOnly || st.get(o.id) === "weak" || asked.has(o.id));
      if (!objs.length) continue;
      shownHere += objs.length;
      const pages = sec.pages && sec.pages.length ? (sec.pages.length > 1 ? `p.${sec.pages[0]}–${sec.pages[sec.pages.length - 1]}` : `p.${sec.pages[0]}`) : "";
      const ol = h("ol", { class:"sum-list" });
      let lastPart = null;
      for (const o of objs){
        if (o.part && o.part !== lastPart){ ol.append(h("li", { class:"sum-part", text:o.part })); }
        lastPart = o.part || lastPart;
        const v = st.get(o.id) || "none";
        const key = d.id + ":" + o.id;
        const covered = S.sum.hide && !S.sum.shown.has(key);
        const recall = o.recall
          ? (covered
            ? h("button", { class:"sum-cover", onclick: () => { S.sum.shown.add(key); render(); } }, "떠올린 뒤 눌러서 확인")
            : h("div", { class:"sum-recall" }, richLines(o.recall)))
          : o.quote ? (covered
            ? h("button", { class:"sum-cover", onclick: () => { S.sum.shown.add(key); render(); } }, "떠올린 뒤 눌러서 확인")
            : h("div", { class:"sum-recall quote" }, h("mark", { class:"quote", text:o.quote }))) : null;
        ol.append(h("li", { class:"sum-obj", "data-st":v },
          h("span", { class:"sum-dot", title:SUM_STATE[v][0], "aria-label":SUM_STATE[v][0] }),
          h("div", { class:"sum-body" },
            h("p", { class:"sum-stmt" }, richText(o.statement)),
            recall,
            h("div", { class:"sum-meta" },
              v === "weak" ? h("span", { class:"chip bad", text:"약점" }) : null,
              asked.has(o.id) ? h("span", { class:"chip ask", title:`읽다가 물어본 것: ${asked.get(o.id).join(" / ")}`, text:"물어봄" }) : null,
              o.importance === "support" ? h("span", { class:"chip", text:"보조" }) : null,
              o.pages && o.pages.length ? h("button", { class:"linkish small", onclick: () => openReader(d.id, o.pages[0], o.id) }, `원문 p.${o.pages.join(",")}`) : null))));
      }
      box.append(h("div", { class:"sum-sec" }, h("h4", null, h("span", { text:sec.title }), pages ? h("small", { class:"muted num", text:pages }) : null), ol));
    }
    if (!shownHere) box.append(h("p", { class:"small muted", text: S.sum.weakOnly ? "이 자료에는 약점이 없어요." : "정리할 목표가 없어요." }));
    wrap.append(box);
  }
  wrap.append(h("div", { class:"legend" },
    h("span", { style:"--c:var(--bad)", text:"약점 (마지막에 틀림·잘 모름·정답 보고 풂)" }),
    h("span", { style:"--c:var(--help)", text:"푸는 중" }),
    h("span", { style:"--c:var(--good)", text:"혼자 맞힘" }),
    h("span", { style:"--c:var(--line-strong)", text:"안 풀어봄" })));
  return wrap;
}
/* ----- records ----- */
function renderRecords(){
  const decks = Object.values(S.decks).filter(d => !d.pending).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt);
  if (!decks.length) return h("div", { class:"panel", text:"아직 자료가 없어요." });
  if (!S.recordsDeck || !S.decks[S.recordsDeck]) S.recordsDeck = decks[0].id;
  const deck = S.decks[S.recordsDeck];
  const sel = h("select", { id:"deckSel", class:"btn", style:"font-weight:500" }, decks.map(d => h("option", { value:d.id, selected: d.id === deck.id ? "selected" : null }, displayTitle(d))));
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
  const fixes = (S.patches && S.patches[deck.id]) || [];
  if (fixes.length) wrap.append(h("section", { class:"panel stack" },
    h("p", { class:"eyebrow", text:"고친 것 (공부하면서 바로 고친 문제)" }),
    h("div", { class:"itemlist" }, fixes.map(f => {
      const it = (deck.allItems || []).find(x => x.id === f.itemId);
      return h("div", { class:"item" },
        h("div", { class:"meta" }, h("span", { class:"chip acc", text: f.kind === "accept" ? `정답 추가 · ${f.answer}` : "떠올리기 카드로" }), h("span", { class:"small muted", text:new Date(f.at).toLocaleString("ko-KR", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }) })),
        it ? h("p", null, richText(it.prompt.slice(0, 160))) : null,
        h("div", null, h("button", { class:"btn small", onclick: async () => {
          try{ await env.quality.unpatch(deck.id, f.id, { at:stamp(), deck:deck.title, item:f.itemId, signal:"고친 것 되돌리기", action: f.kind === "accept" ? `정답 추가 취소 ${f.answer}` : "카드 전환 취소", cause: f.kind === "accept" ? "인정답안누락" : "형식선택" });
            toast("되돌렸어요."); loadPatchList(); await reloadDecks(); render(); }catch(e){ toast("되돌리지 못했어요."); } } }, "되돌리기")));
    }))));
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
/* Engine v2 purposes (docs/DECISIONS.md 2026-10-12). "그냥 읽기" needs no generation, so it is not offered here. */
const PURPOSES = [
  ["core", "핵심 암기", "꼭 떠올려야 하는 것만 골라요. 보조 내용은 확인할 때 빼 둬요."],
  ["understand", "이해", "왜·어떻게를 설명할 수 있게, 개념과 관계 위주로 적게 골라요."],
  ["all", "통암기", "나온 내용을 빠짐없이 떠올리게 해요. 문제가 많아져요."],
];
/* 4. 기출 (선택): exam PDFs are kept apart from lecture PDFs (prefs.pastExams, synced with the plan).
   Uploading one here only registers it; no questions are made from an exam. */
const EXAM_NAME = /기출|중간|기말|시험|퀴즈|exam|midterm|final|quiz/i;
const knownExams = () => (S.plan.prefs && Array.isArray(S.plan.prefs.pastExams)) ? S.plan.prefs.pastExams : [];
function markExam(src, on){
  const p = S.plan.prefs || (S.plan.prefs = {});
  p.pastExams = on ? [...knownExams().filter(x => x.id !== src.id), { id:src.id, fileName:src.fileName }] : knownExams().filter(x => x.id !== src.id);
  if (!on) S.builder.pastExamSourceIds = S.builder.pastExamSourceIds.filter(id => id !== src.id);
  Store.savePlan(S.plan);
}
function examField(b){
  const known = knownExams(), picked = b.pastExamSourceIds, full = picked.length >= 2;
  const toggle = (id) => { b.pastExamSourceIds = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id].slice(0, 2); render(); };
  const upload = h("input", { type:"file", accept:"application/pdf", class:"hidden", onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    b.examBusy = true; b.error = ""; render();
    try{
      const src = await engine.registerPastExam(f);
      markExam(src, true); if (b.pastExamSourceIds.length < 2) b.pastExamSourceIds = [...b.pastExamSourceIds, src.id];
      toast(`‘${src.fileName}’을 기출로 올렸어요.`);
    }catch(error){ b.error = error.message || "기출 PDF를 올리지 못했어요."; }
    finally{ b.examBusy = false; render(); }
  } });
  const chips = known.map(x => h("span", { class:"exam-chip" + (picked.includes(x.id) ? " on" : "") },
    h("button", { class:"chip-btn", "aria-pressed": picked.includes(x.id) ? "true" : "false", disabled: b.busy || (full && !picked.includes(x.id)),
      title:"이 기출의 느낌을 반영해요", onclick: () => toggle(x.id) }, x.fileName.replace(/\.pdf$/i, "")),
    h("button", { class:"exam-x", title:"기출 목록에서 빼기 (파일은 그대로)", "aria-label":`${x.fileName} 기출 목록에서 빼기`, disabled:b.busy,
      onclick: () => { markExam(x, false); render(); } }, "✕")));
  let finder = null;
  if (b.pastExamOpen){
    const ids = new Set(known.map(x => x.id));
    const rest = (b.pastExamSources || []).filter(x => !ids.has(x.id)).sort((a, c) => (EXAM_NAME.test(c.fileName) ? 1 : 0) - (EXAM_NAME.test(a.fileName) ? 1 : 0) || a.fileName.localeCompare(c.fileName, "ko"));
    finder = h("div", { class:"exam-find" },
      b.pastExamSources === null ? h("p", { class:"small muted", text:"등록된 PDF를 불러오는 중…" })
      : rest.length ? rest.map(x => h("div", { class:"exam-row" },
          h("span", { class:"small", text:x.fileName }), EXAM_NAME.test(x.fileName) ? h("span", { class:"chip exam", text:"기출 같아요" }) : null, h("span", { class:"grow" }),
          h("button", { class:"btn small", disabled:b.busy, onclick: () => { markExam(x, true); if (b.pastExamSourceIds.length < 2) b.pastExamSourceIds = [...b.pastExamSourceIds, x.id]; render(); } }, "기출로 표시")))
      : h("p", { class:"small muted", text:"기출로 표시할 다른 PDF가 없어요." }));
  }
  return h("div", { class:"field exam-field" },
    h("label", { text:"4. 기출 (선택)" }),
    h("span", { class:"small muted", text:"고른 기출의 느낌(묻는 방식·문제 크기·함정)을 반영해요. 문항은 베끼지 않고, 범위는 위에서 고른 그대로예요. 최대 2개." }),
    h("div", { class:"chat-sugs" }, ...chips,
      h("label", { class:"chip-btn exam-add" + (b.examBusy ? " busy" : ""), title:"기출 PDF를 올려 둬요. 기출로는 문제를 만들지 않아요." }, b.examBusy ? "올리는 중…" : "+ 기출 PDF 올리기", upload)),
    h("button", { class:"linkish small", style:"align-self:flex-start", onclick: async () => {
      b.pastExamOpen = !b.pastExamOpen; render();
      if (b.pastExamOpen && b.pastExamSources === null){ try{ b.pastExamSources = await engine.pastExamSources(); }catch(error){ b.pastExamSources = []; b.error = error.message; } render(); }
    } }, b.pastExamOpen ? "닫기" : "이미 등록한 PDF에서 기출 고르기"),
    finder,
    picked.length ? h("p", { class:"small", style:"color:var(--ask)", text:`기출 ${picked.length}개 반영 · 처음 한 번 기출을 분석하고 문제마다 베끼기 검사를 해서 조금 더 걸려요.` }) : null);
}
function freshBuilder(){ return { pages:[], sourceName:"", from:1, to:1, purpose:"core", note:"", readImages:true, busy:false, status:"", error:"", file:null, pdfDoc:null, sections:[], picked:[], pastExamSourceIds:[], pastExamSources:null, pastExamOpen:false }; }
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
    b.pages = pages; b.sourceName = file.name; b.from = 1; b.to = pages.length; b.file = file; b.pdfDoc = doc;
    b.sections = await readSections(doc, pages); b.picked = [];
  }catch(e){
    b.error = "PDF를 읽지 못했어요. 암호가 걸렸거나 손상된 파일일 수 있어요.";
  }finally{ b.busy = false; b.status = ""; render(); }
}

/* pending material: readable now, questions later */
function pendingDeck(rec){
  return { id:rec.id, pending:rec, title:rec.title, sourceName:rec.sourceName, sourceCatalogId:rec.sourceId, pageCount:rec.pageCount,
    createdAt:rec.createdAt, example:false, items:[], allItems:[], objectives:[], pages:[], events:[], sched:{}, hidden:[], reported:{}, lastPage:rec.lastPage || 0, skipped:[] };
}
function savePending(){ Store.savePending(Object.values(S.decks).filter(d => d.pending).map(d => ({ ...d.pending, lastPage:d.lastPage }))); }
async function startMaterial(){
  const b = S.builder; if (b.busy || !engine || !b.file) return;
  b.busy = true; b.error = ""; b.status = "PDF를 등록하고 문제 만들기를 시작하는 중…"; render();
  try{
    const res = await engine.start({ file:b.file, from:b.from, to:b.to, purpose:b.purpose, note:b.note.trim(), readImages:b.readImages, ...(b.pastExamSourceIds.length ? { pastExamSourceIds:b.pastExamSourceIds } : {}) });
    const rec = { id:"pending:" + res.requestId, requestId:res.requestId, sourceId:res.sourceId, title:b.sourceName.replace(/\.pdf$/i, ""), sourceName:b.sourceName,
      pageCount:b.pages.length, from:b.from, to:b.to, purpose:b.purpose, note:b.note.trim(), createdAt:now(), status:"waiting", message:"" };
    const deck = pendingDeck(rec);
    S.decks[deck.id] = deck;
    if (b.pdfDoc) S.pdf[deck.id] = { status:"ready", doc:b.pdfDoc, canv:{}, aspect: await docAspect(b.pdfDoc) };
    savePending();
    S.builder = freshBuilder();
    toast("문제 만들기를 시작했어요. 목표가 정리되면 확인을 부탁할게요. 그동안 읽어 두세요.");
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
    toast(String(res.requestId).startsWith("gen_") ? "신고한 문제를 다시 만들고 있어요. 새 문제는 ‘다시 만든 문제’ 자료로 따로 붙어요." : "다시 만들기 요청을 올렸어요. 담당 AI 대화에서 ‘대기 중인 요청 처리해’라고 해 주세요. 새 문제는 따로 자료로 붙어요.");
    setView("practice"); pollPending();
  }catch(e){ toast((e && e.message) || "다시 만들기 요청을 올리지 못했어요."); }
}
async function restartMaterial(d){
  if (!engine) return;
  const rec = d.pending;
  try{
    const res = rec.remake ? await engine.remake(rec.remake) : await engine.restart({ requestId:rec.requestId, sourceId:rec.sourceId, from:rec.from, to:rec.to, purpose:rec.purpose, note:rec.note || "" });
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
const PENDING_LABEL = { waiting:"시작 대기", running:"자료 파악 중", confirm:"목표 확인 필요", paused:"잠시 멈춤", authoring:"문제 만드는 중", ready:"준비됨", failed:"실패" };
let pollTimer = null;
async function pollPending(){
  clearTimeout(pollTimer);
  if (disposed || !engine) return;
  const list = Object.values(S.decks).filter(d => d.pending && d.pending.status !== "failed");
  if (!list.length) return;
  let changed = false, ready = false, grew = false;
  for (const d of list){
    let next;
    try{ next = await engine.check(d.pending.requestId); }
    catch(e){ next = { status:d.pending.status, message:(e && e.message) || "상태를 확인하지 못했어요." }; }
    if (disposed) return;
    if (next.status !== d.pending.status || (next.message || "") !== d.pending.message) changed = true;
    // Sections authored so far are already a deck: reload it whenever another section is added.
    if (next.artifactId && next.status !== "ready" && ((next.message || "") !== d.pending.message || !d.pending.artifactId)) grew = true;
    Object.assign(d.pending, { status:next.status, message:next.message || "", artifactId:next.artifactId || d.pending.artifactId });
    if (next.status === "confirm" && next.objectives){
      // Keep what the learner already ticked across polls; start from the engine's default (core only, or all for 통암기).
      const known = new Set(next.objectives.map(o => o.id));
      if (!d.pending.objectives || d.pending.objectives.length !== next.objectives.length) d.pending.chosen = (next.chosen || []).filter(id => known.has(id));
      d.pending.objectives = next.objectives;
    } else if (next.status !== "confirm"){ delete d.pending.objectives; delete d.pending.chosen; }
    if (next.status === "ready") ready = true;
  }
  if (ready || grew) await reloadDecks();
  if (changed || ready){ savePending(); if (!S.session && S.view !== "create") render(); }
  pollTimer = setTimeout(pollPending, 5000);
}
async function confirmGoals(d){
  const p = d.pending; if (!engine || !engine.confirm || p.confirming) return;
  p.confirming = true; render();
  try{
    await engine.confirm(p.requestId, p.chosen || []);
    Object.assign(p, { status:"authoring", message:(p.chosen || []).length ? "문제 만드는 중" : "고른 목표가 없어요" });
    delete p.objectives; delete p.chosen;
    savePending(); pollPending();
  }catch(e){ toast((e && e.message) || "목표를 확정하지 못했어요."); }
  finally{ p.confirming = false; render(); }
}
/* The one confirmation before authoring: objectives grouped by section, support ones unticked. */
function goalPanel(d){
  const p = d.pending, chosen = new Set(p.chosen || []);
  const groups = [];
  for (const o of p.objectives){ let g = groups.find(x => x.title === o.section); if (!g){ g = { title:o.section, list:[] }; groups.push(g); } g.list.push(o); }
  const toggle = (id) => { p.chosen = chosen.has(id) ? [...chosen].filter(x => x !== id) : [...chosen, id]; savePending(); render(); };
  return h("div", { class:"goals" },
    h("p", { class:"small muted", text:"이 목표들로 문제를 만들어요. 필요 없는 건 빼고, 보조 목표 중 필요한 건 더하세요." }),
    groups.map(g => h("section", null, h("h4", { text:g.title }),
      h("ul", null, g.list.map(o => h("li", null, h("label", null,
        h("input", { type:"checkbox", checked:chosen.has(o.id) ? true : null, onchange: () => toggle(o.id) }),
        h("span", null, o.part ? h("small", { class:"muted part", text:o.part }) : null, h("span", { text:o.statement }), o.importance === "support" ? h("span", { class:"chip", text:"보조" }) : null,
          h("small", { class:"muted", text:`떠올릴 것: ${o.recall}` })))))))),
    h("div", { class:"row" },
      h("button", { class:"btn primary", disabled:p.confirming ? true : null, onclick: () => confirmGoals(d) }, p.confirming ? "확정하는 중…" : `이 목표 ${chosen.size}개로 문제 만들기`),
      h("span", { class:"small muted", text:`전체 ${p.objectives.length}개 중` })));
}
function pendingNote(d){
  const p = d.pending;
  if (p.status === "confirm" && p.objectives && p.objectives.length) return h("div", { class:"note row", role:"status" },
    h("div", { style:"flex:1;min-width:0" }, h("strong", { text:`문제 준비 중 · ${p.message || PENDING_LABEL.confirm}` }), goalPanel(d)));
  const text = p.message || PENDING_LABEL[p.status] || "";
  return h("div", { class:`note row${p.status === "failed" ? " err" : ""}`, role:"status" },
    h("span", { style:"flex:1;min-width:0", text: p.status === "failed" ? `문제 만들기 실패 · ${text}` : `문제 준비 중 · ${text}` }),
    p.status === "paused" && account && S.account && S.account.show && !S.account.ready ? h("button", { class:"btn small", onclick:connectAccount }, "ChatGPT 연결") : null,
    p.status === "paused" && engine && engine.resume ? h("button", { class:"btn small", onclick: () => resumeMaterial(d) }, "다시 시작") : null,
    p.status === "failed" ? h("button", { class:"btn small", onclick: () => restartMaterial(d) }, "다시 요청") : null,
    p.status === "failed" || p.status === "paused" ? h("button", { class:"btn small ghost", onclick: () => removePending(d) }, "지우기") : null);
}

function renderBuilder(){
  const b = S.builder;
  // The coach's lines for the next material (from feedback like "너무 지엽적") start the memo; the learner can edit them.
  if (!b.note && !b.noteSeeded && S.plan.prefs && S.plan.prefs.genNote){ b.note = S.plan.prefs.genNote; b.noteSeeded = true; }
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

  const from = h("input", { type:"number", id:"from", min:"1", max:String(b.pages.length), style:"width:90px" });
  const to = h("input", { type:"number", id:"to", min:"1", max:String(b.pages.length), style:"width:90px" });
  from.value = String(b.from); to.value = String(b.to);
  const upd = () => { b.picked = []; b.from = Math.max(1, Math.min(Number(from.value) || 1, b.pages.length)); b.to = Math.max(b.from, Math.min(Number(to.value) || b.pages.length, b.pages.length)); render(); };
  from.addEventListener("change", upd); to.addEventListener("change", upd);
  const note = h("textarea", { id:"note", rows:"2", placeholder:"예: 중간고사 범위, 공식은 직접 써 볼 수 있게, 영어 용어는 원문 그대로" });
  note.value = b.note;
  note.addEventListener("input", () => { b.note = note.value; });
  const empty = b.pages.filter(p => !p.text.trim()).length;
  const span = b.to - b.from + 1;
  // Same rule as the engine (pages.ts): pages short of a full text slide are read from their image, about 20 s each, 3 at a time.
  const thin = b.pages.filter(p => p.n >= b.from && p.n <= b.to && (p.text.match(/[\p{L}\p{N}]/gu) || []).length < 600).length;
  const purpose = PURPOSES.find(x => x[0] === b.purpose) || PURPOSES[0];
  wrap.append(h("section", { class:"panel stack" },
    h("div", null, h("p", { class:"eyebrow", text:"방향 정하기" }), h("h2", { style:"font-size:18px;margin-top:2px", text:"어떻게 공부할지 알려 주세요" }),
      empty && !b.readImages ? h("p", { class:"small muted", text:`글자가 없는 쪽 ${empty}개는 그림·스캔이라, 아래 ‘그림·수식도 읽기’를 켜야 문제에 들어가요.` }) : null),
    h("div", { class:"field" }, h("label", { text:"1. 목적" }),
      h("div", { class:"chat-sugs" }, PURPOSES.map(([key, label]) => h("button", { class:"chip-btn", "aria-pressed": b.purpose === key ? "true" : "false", disabled:b.busy,
        onclick: () => { b.purpose = key; render(); } }, label))),
      h("span", { class:"small muted", text:purpose[2] })),
    h("div", { class:"field" }, h("label", { text:"2. 범위" }),
      h("div", { class:"row" }, h("span", { class:"small muted", text:"시작 쪽" }), from, h("span", { class:"small muted", text:"끝 쪽" }), to,
        h("button", { class:"btn small ghost", disabled:b.busy, onclick: () => { b.picked = []; applyPicked(); render(); } }, "전체")),
      b.sections.length ? h("details", { open: b.picked.length ? true : null },
        h("summary", { class:"small", text: `${b.sections[0].fromOutline ? "목차" : "쪽 제목"}에서 고르기${b.picked.length ? ` · ${b.picked.length}개 선택` : ""}` }),
        h("div", { class:"sections" }, b.sections.map((sec, i) => h("button", { class:"chip-btn", style: sec.level ? "margin-left:14px" : null,
          "aria-pressed": b.picked.includes(i) ? "true" : "false", disabled:b.busy,
          onclick: () => { b.picked = b.picked.includes(i) ? b.picked.filter(x => x !== i) : [...b.picked, i]; applyPicked(); render(); } },
          h("span", { class:"num small", text: sec.start === sec.end ? `p.${sec.start} ` : `p.${sec.start}–${sec.end} ` }), sec.title))),
        h("p", { class:"small muted", text:"여러 개를 고르면 처음부터 끝까지 이어진 범위로 만들어요." })) : null,
      span > 60 ? h("p", { class:"small muted", text:`${span}쪽은 오래 걸려요. 한 주차·한 장씩 나눠 만들면 먼저 끝난 것부터 공부할 수 있어요.` }) : null),
    h("div", { class:"field" }, h("label", { for:"note", text:"3. 메모 (선택)" }), note),
    engine?.pastExamSources ? examField(b) : null,
    thin ? h("label", { class:"row small", style:"gap:8px;cursor:pointer" },
      h("input", { type:"checkbox", checked:b.readImages ? true : null, disabled:b.busy, onchange:(e) => { b.readImages = e.target.checked; render(); } }),
      h("span", null, h("b", { text:"그림·수식도 읽기" }), h("span", { class:"muted", text:` · 글자가 적은 ${thin}쪽을 그림으로 읽어요 (약 ${Math.max(1, Math.ceil(thin * 20 / 3 / 60))}분 더). 행렬·도표·그림 속 글자가 문제에 들어가요.` }))) : null,
    h("div", { class:"row" },
      h("button", { class:"btn primary", id:"startBtn", disabled: b.busy || !engine, onclick:startMaterial }, "읽기 시작"),
      h("span", { class:"small muted", text:"바로 읽기로 넘어가요. AI가 목표를 정리하면 한 번 확인을 부탁하고, 그다음 문제가 쪽마다 붙어요." }))));
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
      if (prev && prev.artifactSha256 === d.artifactSha256 && (prev.patchSig || "") === (d.patchSig || "")) continue;   // keep the live deck (and its in-memory session refs)
      const deck = { ...d, example:false, createdAt:-d.order, pages:[], events:[], sched:{} };
      Store.restore(deck);
      S.decks[deck.id] = deck;
    }
    // a pending material whose questions are now recorded becomes that document; carry the reading position over
    for (const p of Object.values(S.decks).filter(x => x.pending && x.pending.artifactId && S.decks[x.pending.artifactId])){
      const real = S.decks[p.pending.artifactId];
      if (!real.lastPage && p.lastPage){ real.lastPage = p.lastPage; Store.save(real); }
      if (S.reader.deckId === p.id) S.reader.deckId = real.id;
      if (p.pending.status === "ready"){
        delete S.decks[p.id];
        toast(`‘${real.title}’ 문제가 모두 준비됐어요.`);
      } else if (!p.pending.announced){
        // Still authoring: keep the pending record (it keeps polling) and let the learner start on what is ready.
        p.pending.announced = true; savePending();
        toast(`‘${real.title}’ 첫 문제들이 준비됐어요. 지금 연습할 수 있고, 나머지 목차는 만드는 대로 붙어요.`);
      }
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
S.plan = Store.plan();
for (const rec of Store.pendingList()) if (rec && rec.id && rec.requestId) S.decks[rec.id] = pendingDeck(rec);
updateStoreChip(); tabletButton(); render();
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
if (env.rules) env.rules().then((r) => { if (disposed || !r) return; S.rules = r.rules || null; S.rulesWarnings = r.warnings || []; if (!S.session) render(); }, () => {});
reloadDecks().then(() => { if (!disposed) for (const d of realDecks()) loadNotes(d); });
loadPatchList();
// Bring in records saved on another computer, then send this browser's records back.
Store.pull().then((changed) => {
  if (disposed) return;
  if (changed){
    S.plan = Store.plan();
    for (const d of Object.values(S.decks)) if (!d.pending && !d.example) Store.restore(d);
    for (const rec of Store.pendingList()) if (rec && rec.id && rec.requestId && !S.decks[rec.id]) S.decks[rec.id] = pendingDeck(rec);
    if (!S.session) render();
    pollPending();
  }
  Store.schedulePush();
});

return () => {
  disposed = true;
  listeners.abort();
  if (Chat.ctl) Chat.ctl.abort();
  clearTimeout(pollTimer);
  for (const P of Object.values(S.pdf)) if (P.doc) P.doc.destroy();
  root.querySelectorAll("#toast, .chatwin").forEach(el => el.remove());
  document.querySelectorAll("#tabletBtn, #tabletCard").forEach(el => el.remove()); clearInterval(TB.timer);
  delete root.dataset.view;
};
}
