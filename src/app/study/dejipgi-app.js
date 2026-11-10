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
/* Long requests (용어 지도·번역) show the server's own reason, so a failure can be told apart from a dropped line. */
function composeErrorCopy(e){
  const c = e && e.code;
  if (c === "rate_limited" || c === "cancelled") return sampleErrorCopy(e);
  return e && e.message && !/fetch|network/i.test(e.message) ? e.message : sampleErrorCopy(e);
}
function sampleErrorCopy(e){
  const c = e && e.code;
  if (c === "rate_limited") return "지금은 요청이 많거나 사용량 한도에 닿았어요. 잠시 뒤 다시 물어봐 주세요.";
  if (c === "cancelled") return "답변을 멈췄어요.";
  return "답변 중 연결이 끊겼어요. 다시 물어봐 주세요.";
}
/* ---------- app state ---------- */
const S = {
  view:"home",
  kp:{ subject:null, sel:null, filter:"all" },
  archive:{ entries:null, err:"" },
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
function setSubject(d, name){ const old = subjectOf(d); if (name) S.plan.of[planKey(d)] = name; else delete S.plan.of[planKey(d)]; Store.savePlan(S.plan); syncSubjects(); if (old) touchMemory(old); if (name) touchMemory(name); render(); }
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
/* 과목 = 목표 (2026-10-28 "4개 축"): subjects and their materials go to the knowledge store's goals whenever they change,
   so the 기억 screen and 일정 use the same 과목·시험일 (env.onSubjects in DejipgiStudy.tsx; nothing outside local mode). */
function syncSubjects(renamed){
  if (!env.onSubjects) return;
  const materials = Object.values(S.decks).filter(d => !d.pending && subjectOf(d)).map(d => ({ subject:subjectOf(d), title:String(d.sourceName || d.title || "").replace(/\.pdf$/i, "") }));
  try{ env.onSubjects(S.plan.subjects.map(s => ({ name:s.name, exam:s.exam || "" })), materials, renamed); }catch(e){}
}
function addSubject(name, exam){
  name = String(name || "").trim().slice(0, 30);
  if (!name){ toast("과목 이름을 적어 주세요."); return false; }
  if (S.plan.subjects.some(s => s.name === name)){ toast("같은 이름의 과목이 있어요."); return false; }
  S.plan.subjects.push({ name, exam:exam || "" }); Store.savePlan(S.plan); syncSubjects(); return true;
}
function updateSubject(old, name, exam){
  name = String(name || "").trim().slice(0, 30);
  if (!name){ toast("과목 이름을 적어 주세요."); return false; }
  if (name !== old && S.plan.subjects.some(s => s.name === name)){ toast("같은 이름의 과목이 있어요."); return false; }
  const s = S.plan.subjects.find(x => x.name === old); if (!s) return false;
  s.name = name; s.exam = exam || "";
  if (name !== old) for (const k of Object.keys(S.plan.of)) if (S.plan.of[k] === old) S.plan.of[k] = name;
  Store.savePlan(S.plan); syncSubjects(name !== old ? { from:old, to:name } : undefined); return true;
}
function removeSubject(name){
  S.plan.subjects = S.plan.subjects.filter(s => s.name !== name);
  for (const k of Object.keys(S.plan.of)) if (S.plan.of[k] === name) delete S.plan.of[k];
  Store.savePlan(S.plan);
  syncSubjects();
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
  S.session.from = S.view; prepCurrent(); setView("practice");
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
/* One-tap feedback on the question itself. */
/* End-of-session feedback: each answer changes something right away and says what changed. */
const FEEDBACK = {
  amount:[["많았어요", -15], ["딱 좋아요", 0], ["더 할 수 있어요", 15]],
  repeat:[["아는 게 자꾸 나와요", 1.25], ["금방 잊어요", 0.8]],
};
/* ---------- 앱 안의 코치 (src/lib/study/coach.ts): a few cards with one-tap actions; closing one hides it ---------- */
/* What the learner changed by feedback, with a way back to 학습규칙's defaults. */

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
/* 메뉴 넷 (2026-10-26): 오늘 · 공부 · 지식 · 일정. Every screen belongs to one of them; the rest live under ⋯ 더보기. */
const TAB_OF = { home:"home", practice:"practice", read:"practice", code:"practice", web:"practice", project:"practice", start:"practice", create:"practice",
  knowledge:"knowledge", summary:"knowledge", plan:"plan" };
function setView(v){
  // 11/11 사용자 "자료 지도에서 [오늘] 눌러도 아무 반응 없음": 위에 떠 있는 자료 지도·원문 보기가 바뀐 화면을 가렸다. 다른 화면으로 가면 닫는다.
  if (typeof SourcePeek !== "undefined") SourcePeek.close();
  if (typeof MaterialMapView !== "undefined") MaterialMapView.close();
  if (S.session && S.session.overlay && v !== "read") S.session = null;
  S.view = v;
  if (v !== "read" && typeof Chat !== "undefined" && Chat.isOpen()){ if (Chat.ctl) Chat.ctl.abort(); Chat.visible = false; }
  if (v !== "read" && typeof Chat !== "undefined" && Chat.docked){ Chat.docked = false; Explain.stop(); }
  root.dataset.view = v;
  if (v === "create") loadAccount();
  if (v !== "read" && typeof hideSel === "function"){ hideSel(); NT.drawer = false; }
  render();
}
/* ==========================================================================================================
   Recaller 2 (설계 문서 "Recaller 2 설계", 2026-10-24): 홈 · 기억 · 작업대.
   What to know (기억 포인트) is kept apart from where it is (원문 쪽·스팬); mastery is read per point from the
   same records the practice screen writes. Old materials without a plan get one point per goal.
   ========================================================================================================== */
const KP_STATE = {
  weak:{ label:"약점", cls:"bad", rank:0 }, mid:{ label:"푸는 중", cls:"help", rank:1 }, new:{ label:"안 풀어봄", cls:"", rank:2 },
  good:{ label:"혼자 맞힘", cls:"good", rank:3 }, mastered:{ label:"숙련", cls:"good", rank:4 }, none:{ label:"문제 없음", cls:"", rank:5 }
};
/* Short labels (지식 포인트 이름): $…$ shown inline with the plain fallback so a chip never grows a math block. */
function kpKey(title){ return looseText(title).replace(/[()·:,.\-–—]/g, ""); }
function deckPoints(d){
  if (d.points && Array.isArray(d.points.points) && d.points.points.length) return d.points;
  const objs = d.objectives || [];
  return { points: objs.map(o => ({ id:"o:" + o.id, title:String(o.recall || o.statement || "").slice(0, 80), essentials:[o.statement].filter(Boolean), section:"",
    pages:o.pages || [], spans:(o.pages || []).map(p => ({ page:p, kind:"text", quote:"" })) })),
    byObjective: Object.fromEntries(objs.map(o => [o.id, ["o:" + o.id]])) };
}
/* Knowledge points of a subject ("" = everything), merged across materials by title: the same concept from an AI
   deck and from 족보 counts once. */
function knowledgeOf(subject){
  const decks = (subject ? decksOf(subject) : realDecks()).filter(d => !d.example);
  const map = new Map();
  for (const d of decks){
    const L = deckPoints(d);
    const keyOf = new Map();
    for (const p of L.points){
      const key = kpKey(p.title) || (d.id + ":" + p.id);
      keyOf.set(p.id, key);
      let k = map.get(key);
      if (!k){ k = { key, title:p.title, essentials:p.essentials || [], section:p.section || "", refs:[], items:[] }; map.set(key, k); }
      k.refs.push({ d, pages:p.pages || [], spans:p.spans || [] });
      if ((p.essentials || []).length > k.essentials.length) k.essentials = p.essentials;
      if (!k.section && p.section) k.section = p.section;
    }
    for (const it of d.items){
      for (const pid of (L.byObjective[it.objectiveId] || [])){ const k = map.get(keyOf.get(pid)); if (k && !k.items.some(x => x.d === d && x.it === it)) k.items.push({ d, it }); }
    }
  }
  return [...map.values()].map(k => ({ ...k, state:kpState(k) }));
}
function kpState(k){
  if (!k.items.length) return "none";
  if (k.items.some(({ d, it }) => isWeak(d, it))) return "weak";
  const st = k.items.map(({ d, it }) => itemStatus(d, it));
  if (st.every(s => s === "new")) return "new";
  if (st.every(s => s === "recent" || s === "steady")) return st.some(s => s === "steady") ? "mastered" : "good";
  return "mid";
}
function kpCounts(list){
  const c = { weak:0, mid:0, new:0, good:0, mastered:0, none:0 };
  for (const k of list) c[k.state]++;
  return c;
}
function startPoint(k){
  if (!k.items.length){ toast("이 기억 포인트에 묶인 문제가 아직 없어요."); return; }
  S.session = { queue: shuffle(k.items).map(({ d, it }) => ({ deck:d.id, item:it.id })), i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"point", viewed:new Set() };
  S.session.from = S.view; prepCurrent(); setView("practice");
}
/* Subjects that still have materials (a subject whose materials all went to 보관함 drops out of home and 지식). */
function liveSubjects(){ return orderedSubjects().filter(sub => decksOf(sub.name).length); }
function currentSubject(){
  const subs = liveSubjects();
  if (S.kp.subject !== null && (S.kp.subject === "" || subs.some(s => s.name === S.kp.subject))) return S.kp.subject;
  return subs.length ? subs[0].name : "";
}
/* The coach box: one question to the same model the reader's chat uses, with the learner's state as context. */
/* 오늘 (2026-10-26): what to do today, in the order a learner wants it — start something, the day's review and
   to-dos, then the PDF plan and the coach. The knowledge cloud moved to 기억, the material list to 공부. */
function publishPdfToday(plan){
  const left = plan ? plan.queue.length : 0;
  const minutes = plan ? Math.round(plan.queue.reduce((sum, r) => { const d = S.decks[r.deckId]; const it = d && (d.allItems || d.items).find(x => x.id === r.itemId); return sum + ((S.rules && S.rules.seconds && it && S.rules.seconds[it.format]) || 40); }, 0) / 60) : 0;
  const info = { left, chunk:Math.min(left, chunkSize()), minutes, doneToday: plan ? plan.doneToday : 0, start: startToday };
  window.__recallerPdfToday = info;
  try{ window.dispatchEvent(new CustomEvent("recaller:pdf-today", { detail: info })); }catch(e){}
}
// 홈 시계: 1분마다 글자만 바꾼다(다시 그리지 않음).
/* 지식창 (2026-10-26): the new learner-wide knowledge window is a React screen (workspace/KnowledgeWindow.tsx). The
   per-subject view above stays as "자료별 기억 포인트" (예전 화면), one button away. */
/* 지식창 · 코드 · 일정 hosts: made once, kept across re-renders (like the flow canvas), so their state survives. */
// 11/11 앱과 React 화면의 다리(workspace/bridge.ts): 상태가 바뀌면 bump()로 React에 다시 그리라고 알린다.
const ui = { v:0, subs:new Set(),
  subscribe: (fn) => { ui.subs.add(fn); return () => { ui.subs.delete(fn); }; },
  version: () => ui.v,
  bump(){ ui.v++; for (const fn of ui.subs) fn(); } };
/* What is on screen, for the knowledge sidebar and the agent's current_view (the code screen reports its own). */
let lastContextKey = "";
function emitContext(){
  if (S.view === "code" || S.view === "web") return;
  let ctx = { view:S.view, title:{ home:"오늘", knowledge:"기억", practice:"공부 · PDF 자료", create:"자료 넣기", records:"학습 기록", bench:"작업대", plan:"기록", summary:"한 장 정리", archive:"보관함", web:"공부 · 웹 글", project:"공부 · 실습", start:"새 공부" }[S.view] || S.view, refs:[], knowledgeIds:[] };
  if (S.view === "read" && S.reader && S.reader.deckId && S.decks[S.reader.deckId]){
    const d = S.decks[S.reader.deckId];
    ctx = { ...ctx, title:`${displayTitle(d)} p.${S.reader.page}`, refs:[d.id + ":"] };
  } else if (S.session && S.session.queue && S.session.queue[S.session.i]){
    const r = curRef();
    if (r){ const ids = (r.deck.points && r.deck.points.byObjective && r.deck.points.byObjective[r.item.objectiveId]) || [];
      ctx = { ...ctx, title:`${displayTitle(r.deck)} · 연습`, refs: ids.length ? ids.map(id => r.deck.id + ":" + id) : [r.deck.id + ":"] }; }
  }
  const key = JSON.stringify(ctx);
  if (key === lastContextKey) return;
  lastContextKey = key;
  try{ window.dispatchEvent(new CustomEvent("recaller:context", { detail: ctx })); }catch(e){}
}
on(window, "recaller:go", (e) => {
  let v = e.detail && e.detail.view; if (!v) return;
  if (v === "knowledge-legacy"){ S.kp.legacy = true; v = "knowledge"; } else if (v === "knowledge") S.kp.legacy = false;
  if (S.session && v !== "practice" && v !== "read") S.session = null;
  setView(v); window.scrollTo({ top:0 });
});
// [경계] 지식 창(B, 2026-10-30): 왼쪽에서 PDF 자료를 누르면 그 자료의 자료 지도를 연다 (같은 PDF를 여러 번 만들었으면 가장 최근 것).
on(window, "recaller:map-open", (e) => {
  const id = String((e.detail && e.detail.genId) || "");
  const d = S.decks[id] || S.decks["pending:" + id];
  const page = Number(e.detail && e.detail.page) || 0;
  // 11/10: 공부 기록에 없는 자료(기억 탭이 실제로 만든 자료 목록에서 연 것)도 지도는 연다(문제 풀기는 자료가 공부에 붙은 뒤).
  const deck = d || (genDeck(id) ? { id, title: "" } : null);
  if (deck && genDeck(deck.id)){ MaterialMapView.open(deck); if (page && d) SourcePeek.open(d, page); } else toast("이 자료의 지도를 아직 열 수 없어요. 공부 › PDF 자료에서 열어 주세요.");
});
/* ---------- 작업대 · 흐름 (2026-10-24): 입력 박스와 모델 박스를 화살표로 이어 돌려 보는 캔버스(FlowBench.tsx). ---------- */
const flowApi = {
  compose: (input) => env.notes.compose(input),
  decks: () => realDecks().map(d => ({ id:d.id, title:displayTitle(d), pages:pageTotal(d) })).sort((a, b) => a.title.localeCompare(b.title)),
  pageText: async (id, from, to) => {
    const d = S.decks[id]; if (!d) throw new Error("자료를 찾지 못했어요.");
    ensurePdf(d);
    for (let i = 0; i < 40 && S.pdf[d.id] && S.pdf[d.id].status === "loading"; i++) await new Promise(r => setTimeout(r, 250));
    const parts = [];
    for (let n = from; n <= to; n++) parts.push(`[p.${n}]\n${await pageText(d, n)}`);
    return { title:displayTitle(d), text:parts.join("\n\n").slice(0, 14000) };
  },
};

/* ---------- 보관함: experiment duplicates put away (kept on disk, restorable) ---------- */
const ARCHIVE_BEFORE = Date.parse("2026-10-20T00:00:00+09:00");
/* One-time tidy (2026-10-24, 사용자 요청 "테스트용 몇천 개 치워"): for each PDF, materials made before 10/20 that were never
   practised are experiment copies. Practised ones stay; when none was practised, the newest stays so the PDF keeps one set.
   Runs in the learner's browser because practice records live here. */
function experimentCopies(){
  const bySource = new Map();
  for (const d of realDecks()){ const k = planKey(d); if (!bySource.has(k)) bySource.set(k, []); bySource.get(k).push(d); }
  const out = [];
  for (const list of bySource.values()){
    const old = list.filter(d => (d.madeAt || 0) < ARCHIVE_BEFORE && !/^족보/.test(String(d.sourceName || d.title || "")));
    if (!old.length) continue;
    const used = old.filter(d => (d.events || []).length);
    const keep = new Set(used.map(d => d.id));
    if (!used.length && old.length === list.length){
      const newest = old.slice().sort((a, b) => (b.madeAt || 0) - (a.madeAt || 0) || String(b.title).localeCompare(String(a.title)))[0];
      keep.add(newest.id);
    }
    for (const d of old) if (!keep.has(d.id)) out.push(d);
  }
  return out;
}
function tidyDone(){ try{ return !!localStorage.getItem(Store.key + ":tidyV1"); }catch(e){ return true; } }
function markTidy(){ try{ localStorage.setItem(Store.key + ":tidyV1", stamp()); }catch(e){} }
async function tidyExperiments(auto){
  if (!env.archive) return;
  const list = experimentCopies();
  if (!list.length){ if (!auto) toast("치울 실험용 문제 세트가 없어요."); markTidy(); return; }
  try{
    await env.archive.put(list.map(d => ({ id:d.id, title:displayTitle(d), reason:"실험용 중복(10/20 이전, 풀지 않음)" })));
    for (const d of list) delete S.decks[d.id];
    markTidy();
    const n = list.reduce((sum, d) => sum + d.items.length, 0);
    toast(`실험용 문제 세트 ${list.length}개(문제 ${n}개)를 보관함으로 옮겼어요.`);
    S.archive.entries = null; render();
  }catch(e){ toast("보관함에 옮기지 못했어요: " + (e && e.message || e)); }
}
async function loadArchive(){
  if (!env.archive) return;
  try{ S.archive.entries = await env.archive.list(); }catch(e){ S.archive.entries = []; S.archive.err = String(e && e.message || e); }
  render();
}
async function restoreArchived(ids){
  try{ await env.archive.restore(ids); toast(`${ids.length}개를 꺼냈어요.`); S.archive.entries = null; await reloadDecks(); render(); }
  catch(e){ toast("꺼내지 못했어요: " + (e && e.message || e)); }
}
/* 11/11 보관함을 React로(workspace/ArchiveView.tsx). */
const archiveApi = {
  snapshot(){
    if (!env.archive) return { off:true, loading:false, entries:[] };
    if (S.archive.entries === null){ if (!S.archive.loading){ S.archive.loading = true; loadArchive().finally(() => { S.archive.loading = false; }); } return { off:false, loading:true, entries:[] }; }
    return { off:false, loading:false, entries:S.archive.entries.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "ko", { numeric:true })).map(e => ({ id:e.id, title:e.title, reason:e.reason || "" })) };
  },
  restore: (ids) => restoreArchived(ids),
  tidy: () => tidyExperiments(false),
};
/* 11/11 화면 전체를 React로(StudyApp.tsx): 앱은 지금 어느 화면인지와 그 화면이 쓸 값·동작만 넘긴다. */
function suggestView(){
  const g = S.hideSuggest; if (!g) return null;
  const d = S.decks[g.deckId]; if (!d){ S.hideSuggest = null; return null; }
  const list = g.ids.map(id => d.objectives.find(o => o.id === id)).filter(Boolean);
  if (!list.length){ S.hideSuggest = null; return null; }
  return { n:list.length, from:g.from.slice(0, 40), list:list.slice(0, 6).map(o => o.statement) };
}
function legacyKnowledgeView(){
  const subs = liveSubjects(), cur = currentSubject();
  const subject = cur, points = knowledgeOf(subject);
  const sel = points.find(k => k.key === S.kp.sel) || null;
  const filter = S.kp.filter || "all";
  const shownPts = points.filter(k => filter === "all" || (filter === "weak" ? k.state === "weak" : filter === "new" ? k.state === "new" : k.state === "good" || k.state === "mastered"));
  const groups = new Map();
  for (const k of shownPts){ const g = k.section || "기타"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
  const c = kpCounts(points);
  let detail = null;
  if (sel){
    const spans = sel.refs.flatMap(r => (r.spans.length ? r.spans : r.pages.map(p => ({ page:p, kind:"text", quote:"" }))).map(x => ({ ...x, d:r.d })));
    const seen = new Map();
    for (const sp of spans){ const k = planKey(sp.d) + ":" + sp.page + ":" + sp.quote; if (seen.has(k)) seen.get(k).n++; else seen.set(k, { ...sp, n:1 }); }
    const matName = (d) => String(d.sourceName || displayTitle(d)).replace(/^족보[^·]*·\s*/, "").replace(/\.pdf$/i, "").replace(/ · .*$/, "");
    detail = { key:sel.key, state:sel.state, title:sel.title, section:sel.section || "", essentials:sel.essentials, items:sel.items.length,
      spans:[...seen.values()].slice(0, 8).map(x => ({ deckId:x.d.id, page:x.page, mat:matName(x.d), n:x.n, quote:String(x.quote || "").slice(0, 120) })) };
  }
  return { subjects: subs.length ? [...subs.map(x => ({ key:x.name, label:x.name, dday:ddayLabel(daysLeft(x.exam)), n:daysLeft(x.exam) })), { key:"", label:"전체", dday:"", n:null }] : null,
    cur, subject, total:points.length, filter, counts:c, states:KP_STATE, sel: sel ? sel.key : null, detail,
    groups:[...groups.entries()].map(([g, ks]) => ({ name:g, points:ks.map(k => ({ key:k.key, title:k.title, state:k.state, items:k.items.length })) })) };
}
let toastTimer;
function toast(msg){ S.toast = { msg:String(msg || ""), at:Date.now() }; ui.bump(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; ui.bump(); }, 3800); }
function tabletView(){
  if (!env.tablet) return null;
  if (!TB.open) return { open:false };
  const left = Math.max(0, Math.round((TB.expires - Date.now()) / 1000)), live = !!(TB.code && left > 0);
  if (live && !TB.timer) TB.timer = setInterval(() => { if (!TB.open || TB.expires < Date.now()){ clearInterval(TB.timer); TB.timer = null; } ui.bump(); }, 1000);
  return { open:true, urls:TB.urls, live, code: TB.code ? TB.code.replace(/(\d{3})(\d{3})/, "$1 $2") : "", hadCode:!!TB.code, left:`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, devices:TB.devices.length, err:TB.err };
}
function paintTablet(){ if (!TB.open){ clearInterval(TB.timer); TB.timer = null; } ui.bump(); }
const shellApi = {
  snapshot(){
    const a = S.account;
    return { view:S.view, group:TAB_OF[S.view] || "", session:!!S.session, overlay:overlayCheck(), legacy: !!S.kp.legacy,
      suggest: S.view !== "create" && !(S.session && S.session.phase === "ask") ? suggestView() : null,
      account: account && a && a.show ? { ready:!!a.ready, message:a.message || "" } : null,
      create:{ engineReady:!!engine, devEngines: location.port === "3002" || /[?&]engines=1/.test(location.search), noteSeed:(S.plan.prefs && S.plan.prefs.genNote) || "", key:S.createKey || 0 },
      store:Store.mode, toast:S.toast ? S.toast.msg : "", tablet:tabletView(), prompts:!!notesApi,
      knowledgeLegacy: S.view === "knowledge" && S.kp.legacy ? legacyKnowledgeView() : null, flow: !!(env.notes && env.notes.compose && env.mountFlow) };
  },
  tab: (v) => { if (S.session && v !== "practice" && v !== "read") S.session = null; setView(v); },
  go: (v) => setView(v),
  leaveToPractice: () => { S.session = null; setView("practice"); },
  legacy: (on) => { S.kp.legacy = on; render(); },
  suggestAll: () => { const g = S.hideSuggest, d = g && S.decks[g.deckId]; if (!d) return; const list = g.ids.map(id => d.objectives.find(o => o.id === id)).filter(Boolean);
    d.hidden = [...new Set([...(d.hidden || []), ...g.ids])]; applyFilters(d); Store.save(d);
    ledger({ deck:d, signal:`비슷한 목표 ${g.ids.length}개`, action:"함께 뺌", cause: g.why === "지엽" ? "지엽" : "목표설계", detail:list.map(o => o.statement).join(" / ") });
    S.hideSuggest = null; toast(`${g.ids.length}개를 더 뺐어요. 기록 탭에서 다시 넣을 수 있어요.`); render(); },
  suggestKeep: () => { S.hideSuggest = null; render(); },
  connect: () => connectAccount(), disconnect: () => disconnectAccount(),
  loadPdfjs: async () => { if (!pdfjs) pdfjs = await env.loadPdfjs(); return pdfjs; },
  startMaterial: (o, doc) => startFromNewMaterial(o, doc),
  prompts: () => openPrompts(),
  toast: (m) => toast(m),
  tablet: { toggle: (f) => toggleTablet(f), code: () => newTabletCode(),
    revoke: async () => { try{ await env.tablet.revoke(); Object.assign(TB, { devices:[], code:null }); toast("모든 태블릿 연결을 끊었어요."); }catch(e){ TB.err = e.message; } ui.bump(); } },
  kp: { subject: (k) => { S.kp.subject = k; S.kp.sel = null; render(); }, filter: (k) => { S.kp.filter = k; render(); }, pick: (k) => { S.kp.sel = k; render(); },
    practice: (k) => { const p = knowledgeOf(currentSubject()).find(x => x.key === k); if (p) startPoint(p); },
    read: (id, page) => openReader(id, page), summary: () => { S.sum.subject = currentSubject() || null; setView("summary"); } },
  flowApi,
  get apis(){ return { materials:materialsApi, session:sessionApi, summary:summaryApi, records:recordsApi, archive:archiveApi, reader:readerApi, overlays:overlaysApi }; },
};
/* 다시 그리기 (11/11부터 화면은 전부 React, StudyApp.tsx): 읽기 화면 준비, 오늘 카드에 PDF 문제 알리기, 지금 화면 알리기, 그리고 React에 다시 그리라고. */
function render(){
  if (disposed) return;
  if (S.view === "read") prepReader();
  if (S.view === "home") publishPdfToday(realDecks().length ? todayPlan() : null);
  emitContext();
  ui.bump();
}
/* 태블릿 모드: a button beside the save chip opens the pairing card (address + 6-digit code, 10 minutes). */
const TB = { open:false, code:null, expires:0, urls:[], devices:[], err:"", timer:null };
/* 전체화면 (touch screens): hides the browser's address and tab bars. Works over plain http, unlike installing as an app. */
async function toggleTablet(force){
  TB.open = force ?? !TB.open; TB.err = "";
  if (TB.open){ try{ Object.assign(TB, await env.tablet.info()); }catch(e){ TB.err = e.message; } }
  paintTablet();
}
async function newTabletCode(){
  try{ const r = await env.tablet.code(); Object.assign(TB, { code:r.code, expires:r.expires, urls:r.urls, err:"" }); }catch(e){ TB.err = e.message; }
  paintTablet();
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
/* Subjects with their exam date: chips to edit, "+ 과목" to add. Inline form, no browser dialogs. */
const Fold = {
  KEY:"dejipgi.fold", set:null,
  load(){ if (this.set) return this.set; try{ this.set = new Set(JSON.parse(localStorage.getItem(this.KEY) || "[]")); }catch(e){ this.set = new Set(); } return this.set; },
  is(k){ return this.load().has(k); },
  toggle(k){ const s = this.load(); s.has(k) ? s.delete(k) : s.add(k); try{ localStorage.setItem(this.KEY, JSON.stringify([...s])); }catch(e){} render(); },
};
function materialName(list){
  const plain = list.find(d => !/^족보/.test(d.sourceName || "")) || list[0];
  return String(plain.sourceName || plain.title || "").replace(/^족보[^·]*·\s*/, "").replace(/\.pdf$/i, "").replace(/\s*·\s*\d+쪽$/, "");
}
/* Decks of one subject grouped by their material (PDF). A material with one deck shows that card directly. */

/* 11/11 PDF 자료 목록을 React로(workspace/MaterialList.tsx): 위 renderHome과 같은 값을 그림 없이 넘긴다. */
function pendingView(d){
  const p = d.pending;
  let text = p.message || PENDING_LABEL[p.status] || "";
  if (p.status === "paused" && /호출 수\((\d+)\)/.test(text)) text = `만들다 멈췄어요. 한 번에 AI를 부를 수 있는 횟수(${text.match(/호출 수\((\d+)\)/)[1]}번)를 다 썼어요. ‘이어 만들기’를 누르면 멈춘 곳부터 다시 만들어요 (AI 사용량이 들어요).`;
  const goals = p.status === "confirm" && p.objectives && p.objectives.length ? {
    chosen: [...(p.chosen || [])], confirming: !!p.confirming,
    objectives: p.objectives.map(o => ({ id:o.id, section:o.section || "", part:o.part || "", statement:o.statement || "", support:o.importance === "support", recall:o.recall || "" })) } : null;
  return {
    id:d.id, title:d.title, sourceName:d.sourceName || "", status:p.status, label:PENDING_LABEL[p.status] || "준비 중", map:genDeck(d.id),
    readPage:d.lastPage || p.from || 1, lastPage:d.lastPage || 0,
    note: {
      goals, headline: `문제 준비 중 · ${p.message || PENDING_LABEL.confirm}`,
      text: p.status === "failed" ? `문제 만들기 실패 · ${text}` : p.status === "cards" ? text : p.status === "authoring" ? `문제 준비 중 · ${text}` : p.status === "paused" ? text : `준비 중 · ${text}`,
      failed: p.status === "failed", making: !!p.making,
      canQuestions: p.status === "cards" && !!(engine && engine.questions),
      canConnect: p.status === "paused" && !!(account && S.account && S.account.show && !S.account.ready),
      canResume: p.status === "paused" && !!(engine && engine.resume),
      canRestart: p.status === "failed", canRemove: p.status === "failed" || p.status === "paused" },
  };
}
function deckView(d, growing){
  const c = deckCounts(d);
  return { id:d.id, title:displayTitle(d).replace(/ · 기출형/, ""), pastExam:!!d.pastExam, objectives:d.objectives.length, items:d.items.length,
    counts:c, skipped:(d.skipped || []).map(x => `${x.questionId}: ${x.reason}`), map:genDeck(d.id), lastPage:d.lastPage || 0, firstPage:firstPage(d),
    growing: growing.has(d.id) ? pendingView(growing.get(d.id)) : null };
}
const materialsApi = {
  snapshot(){
    const all = Object.values(S.decks).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt);
    const pendings = all.filter(d => d.pending), decks = all.filter(d => !d.pending);
    let due = 0, fresh = 0;
    decks.forEach(d => { const c = deckCounts(d); due += c.due; fresh += Math.min(c.fresh, 10); });
    const plan = decks.some(d => !d.example) ? todayPlan() : null, todayLeft = plan ? plan.queue.length : 0;
    const growing = new Map(pendings.filter(p => p.pending.artifactId && S.decks[p.pending.artifactId]).map(p => [p.pending.artifactId, p]));
    const matKey = (x) => looseText(String(x.sourceName || x.title || "").replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "").replace(/\s*·\s*p\.[\d–-]+.*$/, ""));
    const realNames = new Set(decks.map(matKey));
    const joined = new Map(), loose = [];
    for (const d of pendings){
      if (d.pending.artifactId && growing.has(d.pending.artifactId)) continue;
      if (d.pending.status === "cards" && realNames.has(matKey(d))){ const k = matKey(d); if (!joined.has(k)) joined.set(k, []); joined.get(k).push(d); continue; }
      loose.push(pendingView(d));
    }
    const byMat = new Map();
    for (const d of decks.slice().sort(byTitle)){ const k = planKey(d); if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(d); }
    const mats = [...byMat.entries()].map(([k, list]) => {
      const extra = joined.get(matKey(list[0])) || [];
      return { key:"m:" + k, name:materialName(list), open:Fold.is("m:" + k), count:list.length + extra.length,
        due:list.reduce((n, d) => n + deckCounts(d).due, 0), fresh:list.reduce((n, d) => n + deckCounts(d).fresh, 0),
        extra:extra.map(pendingView), decks:list.map(d => deckView(d, growing)) };
    }).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric:true }));
    return { todayLeft, due, fresh, chunk:chunkSize(), pendings:pendings.length, decks:decks.length, loose, mats, lib:{ status:S.lib.status, error:S.lib.error || "" } };
  },
  startToday: () => startToday(),
  startAll: () => startSession(null),
  practice: (id) => startSession(id, true),
  records: (id) => { S.recordsDeck = id; setView("records"); },
  map: (id) => { const d = S.decks[id]; if (d) MaterialMapView.open(d); },
  read: (id, page) => openReader(id, page),
  fold: (key) => Fold.toggle(key),
  toggleGoal: (id, gid) => { const d = S.decks[id]; if (!d) return; const p = d.pending, chosen = new Set(p.chosen || []); p.chosen = chosen.has(gid) ? [...chosen].filter(x => x !== gid) : [...chosen, gid]; savePending(); render(); },
  confirmGoals: (id) => { const d = S.decks[id]; if (d) confirmGoals(d); },
  makeQuestions: (id) => { const d = S.decks[id]; if (d) makeQuestions(d); },
  connect: () => connectAccount(),
  resume: (id) => { const d = S.decks[id]; if (d) resumeMaterial(d); },
  restart: (id) => { const d = S.decks[id]; if (d) restartMaterial(d); },
  remove: (id) => { const d = S.decks[id]; if (d) removePending(d); },
};

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
  S.session.from = S.view; prepCurrent(); setView("practice");
}
/* 약점 다시 풀기: a subject's weak questions across its materials, most-missed first, regardless of the review day.
   Results count like review; a question solved alone leaves the weak list. */
const WEAK_MAX = 30;
function startWeak(subject){
  const list = weakList(subject ? decksOf(subject) : realDecks()).sort((a, b) => b.miss - a.miss).slice(0, WEAK_MAX);
  if (!list.length){ toast("약점으로 표시된 문제가 없어요."); return; }
  S.session = { queue: shuffle(list).map(w => ({ deck:w.d.id, item:w.it.id })), i:0, phase:"ask", assisted:new Set(), requeued:new Set(), results:[], cur:null, mode:"weak", subject, viewed:new Set() };
  S.session.from = S.view; prepCurrent(); setView("practice");
}
function itemsOnPage(d, page){
  return d.items.filter(it => it.page === page || (d.objectives.find(o => o.id === it.objectiveId)?.pages || []).includes(page));
}
function startCheck(deckId, page, objId, given){
  const d = S.decks[deckId];
  const items = given || (objId ? d.items.filter(it => it.objectiveId === objId) : itemsOnPage(d, page));
  if (!items.length){ toast(objId ? "이 목표에 연결된 문제가 없어요." : "이 쪽에 연결된 문제가 없어요."); return; }
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
  // To the knowledge window: every result in practice, and a miss right after reading too (missing what was just read
  // is the clearest 몰랐음); a correct answer right after reading is not memory evidence, so it is not passed on.
  if (env.onPractice && (S.session.mode !== "check" || outcome === "wrong")) { try{ env.onPractice(deck, item, outcome); }catch(e){} }
  S.session.assisted.add(deck.id + ":" + item.id); // the result screen shows the answer, so a retry later in this session is not independent
  Store.save(deck);
}
function submitAnswer(){
  const { deck, item } = curRef(); const c = S.session.cur;
  const assisted = assistedNow(deck, item); const reading = S.session.mode === "check" || undefined;
  let correct = null;
  if (item.format === "choice"){ if (c.pick == null) return; correct = c.pick === item.answer; }
  else if (item.format === "value"){
    if (!c.text.trim()) return;
    correct = item.accepted.some(a => norm(a) === norm(c.text));
    // 직접 확인 (2026-10-28): a typed answer the grader cannot match is not called wrong yet — answers to formulas and
    // names are written many ways, so the learner sees theirs beside the answer and decides. Nothing is recorded until then.
    if (!correct && !assisted){ S.session.phase = "judge"; render(); return; }
  }
  else if (item.format === "order"){ if (c.order.length !== item.steps.length) return; correct = c.order.every((v,i) => v === i); }
  logEvent(deck, item, { kind:"submit", correct, assisted, afterReading:reading, answer: item.format === "value" ? c.text.slice(0, 80) : undefined, asChoice: item.termCard || undefined });
  c.verdict = assisted ? "assisted" : reading ? (correct ? "read-good" : "read-bad") : correct ? "good" : "bad";
  finishItem(assisted ? "assisted" : correct ? "correct" : "wrong");
  S.session.phase = "result"; render();
}
/* 직접 확인: the learner's own call on a typed answer the grader could not match. Recorded once, as chosen. */
function judgeSelf(ok){
  const { deck, item } = curRef(); const c = S.session.cur;
  if (S.session.phase !== "judge") return;
  const reading = S.session.mode === "check" || undefined;
  logEvent(deck, item, { kind:"submit", correct:ok, assisted:false, selfJudged:true, override: ok || undefined, afterReading:reading, answer:c.text.slice(0, 80) });
  c.verdict = reading ? (ok ? "read-good" : "read-bad") : ok ? "good" : "bad";
  c.selfJudged = true; c.overridden = ok;
  if (ok) ledger({ deck, item, signal:"직접 확인: 맞았어요", action:"이번 풀이를 맞음으로", cause:"인정답안누락", detail:`내 답 "${c.text.slice(0, 60)}" / 정답 "${(item.accepted || [])[0] || ""}"` });
  finishItem(ok ? "correct" : "wrong");
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
  // The knowledge window got a 틀림 for this; take it back (and, outside reading checks, count it as 맞힘).
  if (env.onPractice) { try{ env.onPractice(deck, item, S.session.mode === "check" ? "override-read" : "override"); }catch(e){} }
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
/* The authored stem block by block (text, math, table, box, blank, figures); older items fall back to the plain prompt. */
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
/* 문제 이름 (2026-10-26): the same names as the knowledge window's question blocks — 객관식 · 주관식 · OX · 순서 · 플래시카드. */
const FORMAT_LABEL = { choice:"객관식", value:"주관식", order:"순서", card:"플래시카드" };
const isOX = (item) => item.format === "choice" && Array.isArray(item.options) && item.options.length === 2 && item.options.every(o => /^\s*(O|X|○|×|참|거짓|맞다|틀리다|예|아니오)\s*$/i.test(String(o)));
const formatLabel = (item) => item.termCard ? "객관식 · 용어" : isOX(item) ? "OX" : FORMAT_LABEL[item.format];
/* 11/11 문제 풀기를 React로(workspace/PracticeSession.tsx): 위 renderSession·renderSessionEnd와 같은 값과 동작. */
function sessionFbAct(key, label){
  const s = S.session; s.fb = s.fb || {}; s.fbPick = s.fbPick || {};
  if (s.fb[key]) return;
  const decks = [...new Set(s.queue.map(q => q.deck))].map(id => S.decks[id]).filter(Boolean);
  const minutes = prefs().dailyMinutes || (S.rules && S.rules.dailyMinutes) || 90;
  const supportOf = (d) => (d.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").length;
  let msg = "";
  if (key === "amount"){
    const delta = (FEEDBACK.amount.find(x => x[0] === label) || [0, 0])[1];
    if (!delta) msg = "지금 분량을 유지해요.";
    else { const next = Math.min(300, Math.max(20, minutes + delta)); prefs().dailyMinutes = next; Store.savePlan(S.plan);
      ledger({ deck:{ title:"전체" }, signal:`분량: ${label}`, action:`하루 ${minutes}분 → ${next}분`, cause:"분량" });
      msg = `하루 ${minutes}분 → ${next}분. 오늘 할 것을 다시 계산했어요.`; }
  } else if (key === "repeat"){
    const k = (FEEDBACK.repeat.find(x => x[0] === label) || [0, 1])[1];
    const cur = prefs().intervalScale || 1; const next = Math.round(Math.min(2, Math.max(0.5, cur * k)) * 100) / 100; prefs().intervalScale = next; Store.savePlan(S.plan);
    ledger({ deck:{ title:"전체" }, signal:`간격: ${label}`, action:`복습 간격 ×${cur} → ×${next}`, cause:"간격" });
    msg = `복습 간격 ×${next}. 다음에 맞히는 문제부터 적용돼요.`;
  } else if (key === "content" && label === "지엽"){
    let n = 0;
    for (const d of decks){ if (!supportOf(d)) continue; (prefs().detail || (prefs().detail = {}))[planKey(d)] = "core"; n++; }
    for (const d of decks) ledger({ deck:d, signal:"내용: 너무 꼼꼼·지엽적", action: supportOf(d) ? "보조 목표 빼고 핵심만" : "바꿀 보조 목표 없음", cause:"지엽" });
    Store.savePlan(S.plan); for (const d of decks) applyFilters(d);
    msg = n ? `자료 ${n}개를 ‘핵심만’으로 바꿨어요. 정리 탭에서 되돌릴 수 있어요.` : "보조 목표가 따로 없는 자료예요. 문제의 ‘너무 지엽적’으로 하나씩 빼 주세요.";
  } else if (key === "content"){
    for (const d of decks) ledger({ deck:d, signal:"내용: 빠진 게 많아요", action:"문제 없는 쪽을 정리 탭에 표시", cause:"빠뜨림" });
    const name = decks.length ? subjectOf(decks[0]) : ""; setTimeout(() => openSummary(name), 900);
    msg = "정리 탭에서 문제가 없는 쪽을 보여 드릴게요. 빠진 쪽을 누르면 기록돼요.";
  }
  s.fbPick[key] = label; s.fb[key] = msg; render();
}
const sessionApi = {
  snapshot(){
    const s = S.session; if (!s) return null;
    if (s.phase === "done"){
      const r = s.results;
      const next = Object.values(S.decks).flatMap(d => Object.values(d.sched).filter(x => x.seen).map(x => x.due)).filter(t => t > now()).sort((a,b) => a-b)[0];
      const todayLeft = s.mode === "today" ? ((todayPlan() || { queue:[] }).queue.length) : 0;
      const weakLeft = s.mode === "weak" ? weakList(s.subject ? decksOf(s.subject) : realDecks()).length : 0;
      return { done:true, mode:s.mode, page:s.page, from:s.from || "", subject:s.subject || "",
        good:r.filter(x => x.outcome === "correct").length, bad:r.filter(x => x.outcome === "wrong").length, help:r.filter(x => x.outcome === "assisted").length, mid:r.filter(x => x.outcome === "unsure").length, n:r.length,
        next: next ? fmtWhen(next) : "", todayLeft, weakLeft, mapBack: s.mode === "check" && genDeck(s.queue[0].deck),
        fb: s.mode !== "check" && r.length ? { picked:{ ...(s.fbPick || {}) }, said:{ ...(s.fb || {}) }, amount:FEEDBACK.amount.map(x => x[0]), repeat:FEEDBACK.repeat.map(x => x[0]) } : null };
    }
    const { deck, item } = curRef(); const c = s.cur;
    const obj = deck.objectives.find(o => o.id === item.objectiveId);
    const q = s.queue[s.i];
    const times = deck.events.filter(e => e.item === item.id && e.override).length;
    const numeric = /^[\s\d().,+\-−*/×÷^°√πθ=<>≤≥]+$|^\$/.test(String((item.accepted && item.accepted[0]) || item.answerText || item.answer || ""));
    return { done:false, i:s.i, total:s.queue.length, phase:s.phase, mode:s.mode, overlay:!!s.overlay, page:s.page,
      reason: q.reason && REASON[q.reason] ? REASON[q.reason] : null, retry:!!q.retry,
      deck:{ id:deck.id, title:displayTitle(deck).replace(/ · 기출형/, ""), pastExam:!!deck.pastExam },
      item, format:formatLabel(item), objective: obj ? obj.statement : "", numeric,
      assetUrl: (path) => env.assetUrl ? env.assetUrl(deck.id, path) : "",
      cur:{ pick:c.pick, text:c.text, order:c.order.slice(), pool:c.pool.slice(), optOrder:c.optOrder.slice(), verdict:c.verdict, overridden:!!c.overridden, selfJudged:!!c.selfJudged,
        feedback:c.feedback || "", reporting:!!c.reporting, reported: c.reported || (deck.reported && deck.reported[item.id] ? deck.reported[item.id].reason : ""),
        key:c.itemKey + ":" + s.i },
      quickFix: item.format === "value" && c.overridden && c.text.trim() && !c.fixed ? { times, card: times >= rule("cardAfterOverrides", 2) } : null,
      reportReasons: REPORT_REASONS };
  },
  pick: (oi) => { S.session.cur.pick = oi; render(); },
  setText: (t) => { S.session.cur.text = t; ui.bump(); },
  orderAdd: (k) => { const c = S.session.cur; const si = c.pool.splice(k, 1)[0]; c.order.push(si); render(); },
  orderRemove: (k) => { const c = S.session.cur; const si = c.order.splice(k, 1)[0]; c.pool.push(si); render(); },
  submit: () => submitAnswer(), dontKnow: () => dontKnow(), peek: () => peek(), showCard: () => showCard(),
  rate: (r) => rateCard(r), judge: (ok) => judgeSelf(ok), override: () => overrideCorrect(), next: () => nextItem(),
  asCard: () => { const c = S.session.cur; c.asChoice = null; c.optOrder = []; c.pick = null; render(); },
  leave: () => leaveSession(), close: () => closeCheck(),
  source: () => { const s = S.session; const { deck, item } = curRef();
    if (s.overlay){ const pg = item.page, oid = item.objectiveId; closeCheck(); S.reader.active = oid; if (S.reader.page !== pg) goPage(pg); else render(); } else openReader(deck.id, item.page, item.objectiveId); },
  fixAccept: () => { const { deck, item } = curRef(); const c = S.session.cur; const answer = c.text.trim(); c.fixed = true; patchItem(deck, { kind:"accept", itemId:item.id, answer }, undefined, `‘${answer}’도 정답으로 쳐요.`); },
  fixCard: () => { const { deck, item } = curRef(); const c = S.session.cur; const times = deck.events.filter(e => e.item === item.id && e.override).length; c.fixed = true;
    patchItem(deck, { kind:"card", itemId:item.id }, { at:stamp(), deck:deck.title, item:item.id, objective:item.objectiveId, signal:`내 답도 맞아요 ${times}번`, action:"떠올리기 카드로 바꿈", cause:"형식선택" }, "떠올리기 카드로 바꿨어요. 기록 탭 ‘고친 것’에서 되돌릴 수 있어요."); },
  fbNarrow: () => { const { deck, item } = curRef(); S.session.cur.feedback = "목표를 뺐어요. 비슷한 게 있으면 위에 보여요."; hideObjective(deck, item.objectiveId, "지엽"); },
  fbEasy: () => { const { deck, item } = curRef(); const s = schedOf(deck, item.id); s.box = INTERVALS.length - 1; s.due = now() + gap(s.box); s.easy = true; Store.save(deck);
    ledger({ deck, item, signal:"너무 쉬워요", action:"가장 긴 복습 간격으로", cause:"너무쉬움" }); S.session.cur.feedback = `${fmtWhen(s.due)}에 다시 나와요.`; render(); },
  reporting: (on) => { S.session.cur.reporting = on; render(); },
  report: (r) => reportItem(r),
  sessionFb: (key, label) => sessionFbAct(key, label),
  toMap: () => { const d = S.decks[S.session.queue[0].deck]; S.session = null; setView("practice"); if (d) MaterialMapView.open(d); },
  toList: () => { S.session = null; setView("practice"); },
  nextPage: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, nextPageWithItems(S.decks[d], pg) || pg); },
  backPage: () => { const d = S.session.queue[0].deck, pg = S.session.page; S.session = null; openReader(d, pg); },
  continueToday: () => startToday(),
  records: () => { S.session = null; setView("records"); },
};
/* 그만하기·처음으로 (2026-11-02 A, 점검_UIUX화면연결 2번): back to the screen the practice was started from (오늘 → 오늘). */
function leaveSession(){
  const back = S.session && S.session.from;
  S.session = null;
  if (back && back !== "practice" && back !== S.view) setView(back); else render();
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
  } else if (s.phase === "judge" && (e.key === "1" || e.key === "2") && tag !== "textarea"){
    e.preventDefault(); judgeSelf(e.key === "1");
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
  if (genDeck(deckId) && S.decks[deckId]){ if (S.session && S.session.overlay) S.session = null; SourcePeek.open(S.decks[deckId], page); return; }
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
  resetExplain(); GoalEx.open = null; R.page = n; R.active = null; R.zoom = false; rememberPage(); render();
  const bar = document.querySelector(".rbar");
  if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block:"start" });
}
function rememberPage(){
  const d = S.decks[S.reader.deckId]; if (!d || d.example) return;
  d.lastPage = S.reader.page;
  if (d.pending) savePending(); else Store.save(d);
  tellFocus();
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
  const tr = Trans.nodes(d, pageNo, entry);
  if (tr.length){ entry.canvas.after(...tr); if (tr.some(x => x.classList.contains("trb"))){ box.classList.add("translated"); Trans.fit(box); } }
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
  NT.placeTick = (NT.placeTick || 0) + 1; ui.bump();
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
/* 11/11 원문 읽기를 React로(workspace/reader/ReaderView.tsx). 그리기 전 준비(자료·쪽 고르기, PDF·노트 불러오기, 질문 창 붙이기). */
function readerLayout(d){
  const P = S.pdf[d.id], pdfOn = !!(P && (P.status === "ready" || P.status === "loading"));
  const wide = pdfOn && pageAspect(d) > 1.15;          // slides: explanation goes below, not beside
  return { P, pdfOn, wide, docked: wide && dockWanted() };
}
function prepReader(){
  const decks = sortedDecks(); if (!decks.length) return;
  const R = S.reader;
  if (!R.deckId || !S.decks[R.deckId]){ R.deckId = decks[0].id; R.page = firstPage(decks[0]); }
  const d = S.decks[R.deckId]; ensurePdf(d); loadNotes(d);
  R.page = Math.max(1, Math.min(pageTotal(d), R.page));
  if (S.session && !S.session.overlay) S.session.viewed.add(d.id + ":" + R.page);
  const L = readerLayout(d);
  if (L.docked){ Chat.docked = true; Explain.want(d, R.page); }
  else if (Chat.docked){ Chat.docked = false; Explain.stop(); }
}
/* 원문 읽기 화면에 그릴 값과 동작 (reader/ReaderView.tsx). */
function textMarks(text, refs){
  const ranges = [];
  for (const q of refs){ const r = findRange(text, q.quote); if (r) ranges.push({ s:r[0], e:r[1], num:q.num, dim:q.dim, line:q.kind === "line" }); }
  ranges.sort((a,b) => a.s - b.s);
  const out = []; let pos = 0;
  for (const r of ranges){ if (r.s < pos) continue; out.push({ text:text.slice(pos, r.s) }); out.push({ text:text.slice(r.s, r.e), mark:true, num:r.num || 0, dim:!!r.dim, line:r.line }); pos = r.e; }
  out.push({ text:text.slice(pos) });
  return out;
}
function chatView(){
  const c = Chat.context();
  Chat.switchThread(c);
  const sg = Chat.sugs(c);
  return { docked:Chat.docked, visible:Chat.isOpen(), mode:Chat.mode, page: c ? c.page : 0, noteTitle:Chat.noteTitle, quote:Chat.quote, fromNote:Chat.fromNote || "",
    msgs: Chat.msgs.map(m => ({ role:m.role, page:m.page || 0, quote:m.quote || "", text: m.role === "assistant" ? (shown(m.content) || "…") : m.content })),
    err:Chat.err, busy:Chat.busy, input:Chat.input, focusTick:Chat.focusTick,
    sugs: sg.qs.map(q => ({ label:q.label, why:q.why || "" })), act: sg.act ? sg.act.label : "",
    explain: Chat.docked && c ? Explain.view(c.d, c.page) : null };
}
const chatApi = {
  input: (v) => { Chat.input = v; ui.bump(); },
  send: (t) => Chat.send(t), stop: () => Chat.stop(), reset: () => Chat.reset(), close: () => Chat.close(), mode: (m) => Chat.setMode(m),
  unquote: () => { Chat.quote = null; ui.bump(); },
  edit: (label) => { Chat.input = label; Chat.focus(); },
  act: () => { const sg = Chat.sugs(Chat.context()); if (sg.act) sg.act.run(); },
  explainAuto: (on) => Explain.setAuto(on), explainAgain: () => Explain.again(), gear: (k) => openPrompts(k),
};
function noteCardView(d){
  if (!notesOn(d)) return null;
  const note = NT.open ? noteList(d).find(n => n.id === NT.open) : null;
  if (!note && !NT.asking) return null;
  const [kl, kc] = NOTE_KIND[note ? note.kind : "term"];
  return { id: note ? note.id : "", quote: note ? note.quote : NT.asking.quote, kind:kl, kindCls:kc, weak: !!(note && note.seen >= NOTE_WEAK),
    loading: !note || (NT.busy && !(note && note.answer)), answer: note && note.answer ? note.answer : null,
    thread: note ? note.thread.map(t => ({ role:t.role, text:t.text })) : [], err: NT.err, busy:NT.busy, again: !!(note && NT.again), seen: note ? note.seen : 0,
    page: note ? note.page : 0, ago: note ? agoText(note.askedAt) : "", long: !!(note && note.thread.length >= 4), anchorY: NT.anchor && NT.anchor.yRatio != null ? NT.anchor.yRatio : null, placeTick:NT.placeTick || 0 };
}
const readerApi = {
  snapshot(){
    const decks = sortedDecks();
    if (!decks.length) return null;
    const R = S.reader, d = S.decks[R.deckId]; if (!d) return null;
    const L = readerLayout(d), P = L.P, total = pageTotal(d);
    const objs = d.objectives.filter(o => o.pages.includes(R.page) && !(d.hidden || []).includes(o.id));
    const n = itemsOnPage(d, R.page).length, nxt = nextPageWithItems(d, R.page);
    let side = null;
    if (L.docked){
      detectPeek(panelSnap(d, objs, n));
      const c = deckCounts(d), weak = weakList([d]).length, notes = pageNotes(d, R.page), plan = d.example ? null : todayPlan();
      side = { shown: R.peek ? R.peek.tab : R.panel, peek:!!R.peek, badge:[...R.badge], pulseState:!!R.pulseState,
        state:{ n, notes, terms: R.terms.key === d.id + ":" + R.page ? R.terms.list : null, good:c.good, total:c.total, weak, due:c.due, fresh:c.fresh,
          today: plan ? { mine:plan.queue.filter(r => r.deckId === d.id).length, left:plan.queue.length, done:plan.doneToday, canGo: !!plan.queue.length && !S.session } : null } };
    }
    const making = pendingOf(d), stored = !L.pdfOn ? d.pages.find(p => p.n === R.page) : null;
    return { decks:decks.map(x => ({ id:x.id, title:displayTitle(x) })), deckId:d.id, title:d.title, page:R.page, total, key:d.id + ":" + R.page, example:!!d.example,
      practicing: !!(S.session && !S.session.overlay), pdf: P ? P.status : "none", pdfOn:L.pdfOn, wide:L.wide, docked:L.docked, aspect:pageAspect(d), zoom: !!(R.zoom && P && P.status === "ready"),
      floatable: L.wide && !L.docked && window.innerWidth >= 1000,
      tools:{ terms: env.chunk && env.chunk.important && !d.example ? termsOn() : null, trans: L.pdfOn && Trans.can(d) ? Trans.on() : null,
        termMap: !!(d.example || (notesApi && notesApi.compose)), map: genDeck(d.id), notes: notesOn(d) ? { count:noteList(d).length, open:NT.drawer } : null },
      making: making ? pendingView(making) : null,
      text: stored && stored.text.trim() ? textMarks(stored.text, activeRefs(d, R.page)) : null,
      objs: objs.map((o, i) => { const [label, cls] = GOAL_STATE[objectiveState(d, o.id)] || GOAL_STATE.none;
        return { id:o.id, num:i + 1, statement:o.statement, active:R.active === o.id, open:GoalEx.isOpen(d, o), gx:GoalEx.view(d, o), label, cls, pulse: !!(R.pulse && R.pulse.has(o.id)) }; }),
      pendingGoals: !!d.pending, n, nxt, notesHint: notesOn(d) && L.pdfOn, chatOpen:Chat.isOpen(), side,
      paint:[d.id, R.page, R.active || "", termsOn(), Trans.on(), noteList(d).map(x => x.id + x.seen + x.status).join(","), NT.open || "", P ? P.status : "", R.zoom ? 1 : 0, L.wide ? 1 : 0, L.docked ? 1 : 0].join("|"),
      note: noteCardView(d), chat: L.docked ? chatView() : null };
  },
  pickDeck: (id) => openReader(id, firstPage(S.decks[id])),
  go: (n) => goPage(n),
  terms: () => { (S.plan.prefs || (S.plan.prefs = {})).showTerms = !termsOn(); Store.savePlan(S.plan); render(); },
  trans: () => Trans.toggle(),
  termMap: () => TermMap.openFor(S.decks[S.reader.deckId]),
  map: () => MaterialMapView.open(S.decks[S.reader.deckId]),
  notes: () => { NT.drawer = !NT.drawer; ui.bump(); },
  zoom: (on) => { S.reader.zoom = on; render(); },
  chat: () => Chat.toggle(),
  attach: () => { S.plan.prefs.chatFloat = false; Store.savePlan(S.plan); Chat.visible = false; render(); },
  float: () => { (S.plan.prefs || (S.plan.prefs = {})).chatFloat = true; Store.savePlan(S.plan); Chat.docked = false; Explain.stop(); render(); Chat.open(); },
  newChat: () => { setPanelTab("ask"); Chat.reset(); },
  tab: (k) => setPanelTab(k),
  goal: (oid) => { const d = S.decks[S.reader.deckId], o = d && d.objectives.find(x => x.id === oid); if (o) GoalEx.toggle(d, o); },
  goalRedo: (oid) => { const d = S.decks[S.reader.deckId], o = d && d.objectives.find(x => x.id === oid); if (o) GoalEx.go(d, o); },
  goalAsk: (oid) => { const d = S.decks[S.reader.deckId], o = d && d.objectives.find(x => x.id === oid); if (o) Chat.quoteIn(o.statement); },
  hide: (oid) => hideObjective(S.decks[S.reader.deckId], oid),
  check: (oid) => startCheck(S.reader.deckId, S.reader.page, oid || undefined),
  practice: () => setView("practice"),
  today: () => startToday(),
  quote: (t) => Chat.quoteIn(t),
  gear: (k) => openPrompts(k),
  draw: () => drawPage(),
  fit: () => { const d = S.decks[S.reader.deckId]; if (d) fitPage(d); },
  noteClose: () => closeNote(),
  noteFollow: (q) => { const d = S.decks[S.reader.deckId], note = d && noteList(d).find(n => n.id === NT.open); if (note && q && !NT.busy) followNote(d, note, q); },
  noteRetry: () => { const d = S.decks[S.reader.deckId]; if (d && NT.asking) askPhrase(d, NT.asking.page, NT.asking.quote, NT.anchor); },
  noteContinue: () => { const d = S.decks[S.reader.deckId], note = d && noteList(d).find(n => n.id === NT.open); if (note){ Chat.continueNote(d, note); closeNote(); } },
  connect: () => connectAccount(),
  chatApi, goalApi:null,
  // 자료 목록의 PendingNote와 같은 동작(만드는 중인 자료)
  toggleGoal: (id, gid) => materialsApi.toggleGoal(id, gid), confirmGoals: (id) => materialsApi.confirmGoals(id), makeQuestions: (id) => materialsApi.makeQuestions(id),
  resume: (id) => materialsApi.resume(id), restart: (id) => materialsApi.restart(id), remove: (id) => materialsApi.remove(id),
};
/* 원문 읽기 밖에 떠 있는 것들 (reader/ReaderOverlays.tsx): 프롬프트 설정 · 용어 지도 · 모르는 것 서랍 · 고른 글 메뉴 · 떠 있는 질문 창. */
function drawerView(){
  const d = S.decks[S.reader.deckId];
  if (!NT.drawer || S.view !== "read" || !notesOn(d)) return null;
  const filters = [["all","전체"],["weak","약점"],["term","용어"],["procedure","절차"],["concept","개념"],["talk","대화"],["marked","아직 안 물어봄"]];
  const pass = (n) => NT.filter === "all" || (NT.filter === "weak" ? n.seen >= NOTE_WEAK : NT.filter === "marked" ? n.status === "marked" : n.kind === NT.filter && n.status !== "marked");
  const all = noteList(d);
  const list = all.filter(pass).sort((a, b) => b.seen - a.seen || Date.parse(b.askedAt) - Date.parse(a.askedAt));
  return { tab:NT.tab, count:all.length, filter:NT.filter, filters:filters.map(([key, label]) => ({ key, label })), weakAt:NOTE_WEAK, page:S.reader.page,
    list: list.map(n => { const [kl, kc] = NOTE_KIND[n.kind]; return { id:n.id, quote:n.quote, kind:n.kind, kl, kc, weak:n.seen >= NOTE_WEAK, marked:n.status === "marked", page:n.page, ago:agoText(n.askedAt), seen:n.seen,
      lead: n.answer ? n.answer.lead : "", open: n.kind === "talk" && NT.talkOpen === n.id,
      thread: n.kind === "talk" && NT.talkOpen === n.id ? n.thread.slice(-12).map(t => ({ role:t.role, text: t.role === "assistant" ? shown(t.text) : t.text })) : [] }; }),
    toc: NT.tab === "toc" ? tocView(d) : null };
}
const overlaysApi = {
  snapshot(){
    const view = S.view;
    return { prompts: promptsView(), termMap: view === "read" ? TermMap.view() : null, drawer: drawerView(),
      sel: NT.sel && view === "read" ? { x:NT.sel.x, y:NT.sel.y, below:NT.sel.below, actions:selActions().map(a => ({ label:a.label, key:a.key || "", title:a.title || "" })) } : null,
      chat: view === "read" && Chat.isOpen() ? chatView() : null, peek: SourcePeek.view() };
  },
  peek: { close: () => SourcePeek.close(), go: (k) => SourcePeek.go(k), paint: (box) => SourcePeek.paint(box) },
  get promptsApi(){ return promptsApi; }, chatApi,
  selRun: (i) => { const a = selActions()[i]; if (a) a.run(); },
  tm: { close: () => { TM.open = false; ui.bump(); }, make: () => TermMap.go(S.decks[S.reader.deckId]), pick: (en) => TermMap.pick(en), gear: () => openPrompts("terms"),
    go: (page) => { TM.open = false; ui.bump(); goPage(page); } },
  drawer: {
    close: () => closeDrawer(), tab: (k) => { NT.tab = k; ui.bump(); }, filter: (k) => { NT.filter = k; ui.bump(); },
    go: (page) => { if (S.reader.page !== page) goPage(page); },
    toc: (page) => goPage(page),
    item: (id) => { const d = S.decks[S.reader.deckId], n = d && noteList(d).find(x => x.id === id); if (!n) return;
      if (n.kind === "talk"){ NT.talkOpen = NT.talkOpen === id ? null : id; ui.bump(); return; }
      NT.drawer = false; if (S.reader.page !== n.page) goPage(n.page); openNote(d, n.id, true);
      setTimeout(() => { const m = document.querySelector(`.nu[data-note="${n.id}"]`); if (m) m.scrollIntoView({ block:"center", behavior:"smooth" }); }, 400); },
    talkGo: (id) => { const d = S.decks[S.reader.deckId], n = d && noteList(d).find(x => x.id === id); if (!n) return; NT.drawer = false; if (S.reader.page !== n.page) goPage(n.page); else ui.bump(); },
    talkContinue: (id) => { const d = S.decks[S.reader.deckId], n = d && noteList(d).find(x => x.id === id); if (!n) return; NT.drawer = false; if (S.reader.page !== n.page) goPage(n.page); Chat.openTalk(d, n); },
  },
};
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
  const d = S.decks[S.reader.deckId];
  if (d && readerLayout(d).docked !== Chat.docked) render(); else drawPage();
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
let peekTimer, pulseTimer;
function setPanelTab(k){
  const R = S.reader; R.panel = k; R.badge.delete(k);
  if (R.peek){ R.peek = null; clearTimeout(peekTimer); }
  ui.bump();
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
  const ta = document.querySelector(".chatwin textarea");
  const busy = Chat.busy || Chat.input.trim() || (ta && document.activeElement === ta);
  if (R.panel !== "ask" || busy || reducedMotion()){ R.badge.add(tab); return; }
  R.peek = { tab };
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (R.peek && R.peek.tab === tab){ R.peek = null; ui.bump(); } }, 2600);
}
function pageTermsFound(d, found){
  const R = S.reader, key = d.id + ":" + R.page;
  if (R.terms && R.terms.key === key && R.terms.list.join("\n") === found.join("\n")) return;
  R.terms = { key, list:found };
  setTimeout(() => ui.bump(), 0);
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
  return clip((name || o.statement).replace(/\$/g, ""), 20);
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
const EXPLAIN_ASK = `이 쪽을 처음 보는 비전공자에게 채팅으로 설명하듯 써 줘. 맨 위에 **핵심 한 줄**. 이어서 이 쪽의 성격에 맞는 형식으로: 여러 대상을 비교하면 표나 대상별 목록(같은 기준으로), 과정이면 번호 단계, 개념이면 쉬운 정의와 일상 비유, 역사면 시간 순서. 그림은 읽는 법을 나열하지 말고 무슨 뜻인지만. 어려운 용어는 원문 그대로 쓰고 괄호에 쉬운 풀이. 제목에만 있고 본문에 설명이 없는 용어는 "원문 밖 설명:"으로 짧게 보충. 마지막 줄은 "**시험 포인트:** "로 외울 것이나 헷갈리는 짝 하나.`;
const EXPLAIN_PRESETS = [
  ["기본", EXPLAIN_ASK],
  ["아주 짧게", "이 쪽의 핵심만 두세 문장으로 아주 쉽게 설명해 줘. 어려운 용어는 원문 그대로 쓰고 괄호에 쉬운 풀이를 붙인다."],
  ["예시 위주", "이 쪽을 일상적인 비유나 구체적인 예시(숫자 예시 포함) 하나로 쉽게 설명해 줘. 원문 용어는 그대로 쓰고 괄호에 풀이를 붙인다. 마지막에 \"한 줄 요약: \"으로 시작하는 줄을 쓴다."],
  ["시험 대비", "이 쪽에서 시험에 나올 만한 핵심(정의, 식, 순서, 헷갈리는 짝)을 쉬운 말로 짚어 줘. 무엇을 외워야 하고 무엇을 이해해야 하는지 나눠서. 원문 용어는 그대로 쓴다."],
  ["원문 줄마다", "원문 줄을 짧게 인용하고 바로 아래에 쉬운 말 한두 문장을 붙이는 식으로 이 쪽 전체를 풀어 줘."],
];
/* ----- 프롬프트 설정: every place that asks the model — what is fixed, what is added automatically, and the
   learner's own part (__plan.prefs.prompts, shared by both computers). Fixed rules always win over the learner's part. ----- */
const PROMPTS = {
  explain: { label:"쉬운 설명", when:"쪽을 넘기면 옆 패널에 자동으로 뜨는 설명이에요.", def:EXPLAIN_ASK, presets:EXPLAIN_PRESETS,
    auto:["자료 이름", "지금 보는 쪽의 원문", "이 쪽 학습목표", "후속 질문 칩용 [다음] 줄 요청"] },
  chat: { label:"질문 창 답변", when:"질문 창에 직접 물을 때 답하는 방식이에요.", def:"",
    presets:[["기본", ""], ["더 짧게", "답은 두세 문장 이내로, 핵심만."], ["예시 먼저", "먼저 구체적인 예시나 숫자로 보여 주고, 그다음 원리를 설명해 줘."], ["시험 관점", "답 끝에 이 내용이 시험에서 어떻게 나올 수 있는지 한 줄 덧붙여 줘."]],
    auto:["자료 이름", "지금 보는 쪽의 원문", "이 쪽 학습목표", "최근 대화 12개", "인용한 원문 구절"] },
  ask: { label:"용어 물어보기", when:"원문을 드래그해 [물어보기]를 누를 때 나오는 모르는 것 카드예요. 이미 물어본 말은 저장된 답을 다시 보여 줘서, 바꾼 요청은 새로 묻는 말부터 적용돼요.", def:"",
    presets:[["기본", ""], ["더 쉽게", "중학생도 알아듣게 쉬운 말로. 핵심 답은 한 문장."], ["예시 하나", "덧붙일 한 줄(extra)에 이 자료 맥락의 짧은 예시를 하나 넣어 줘."], ["원어 풀이", "영어 원어 용어는 단어 단위로 뜻을 풀어 줘(예: frame=틀, buffer=임시 저장소)."]],
    auto:["자료 이름", "학습 목적", "고른 글", "고른 글이 든 문장", "이 쪽 원문"] },
  goal: { label:"목표 설명", when:"‘이 쪽에서 익힐 것’의 목표를 누르면 펼쳐지는 정리예요. 목표마다 처음 한 번 만들고 저장해서, 바꾼 요청은 [다시 정리]부터 적용돼요.", def:"",
    presets:[["기본", ""], ["원문 예시까지", "원문에 나온 예시와 수치도 빠짐없이 함께 정리해 줘."], ["서술형 답안식", "서술형 시험 답안에 그대로 옮겨 쓸 수 있는 문장으로 정리해 줘."], ["용어 풀이 포함", "어려운 용어는 원문 그대로 쓰고 바로 뒤 괄호에 쉬운 풀이를 붙여 줘."]],
    auto:["자료 이름", "학습목표", "목표의 근거 구절", "목표가 걸친 쪽의 원문(최대 3쪽)"] },
  terms: { label:"용어 지도", when:"읽기 화면 위 [용어 지도]로 만드는 자료 전체의 용어 묶음·비유·이야기예요. 자료마다 한 번 만들고 저장해서, 바꾼 요청은 [다시 만들기]부터 적용돼요.", def:"",
    presets:[["기본", ""], ["게임 비유", "비유와 이야기는 게임(fps, 그래픽 옵션, 모니터 설정 등) 경험에 빗대어 써 줘."], ["일상 비유", "비유와 이야기는 집안일·요리·교통 같은 일상생활에 빗대어 써 줘."], ["스마트폰 비유", "비유와 이야기는 스마트폰과 앱을 쓰는 경험에 빗대어 써 줘."]],
    auto:["자료 이름", "자료 전체 쪽의 원문(쪽마다 앞부분)", "출력 양식(묶음·용어·이야기, 형식 고정)"] },
  follow: { label:"카드에서 이어 묻기", when:"모르는 것 카드 아래에서 이어서 물을 때예요.", def:"",
    presets:[["기본", ""], ["더 짧게", "한두 문장으로 답해 줘."], ["예시로", "가능하면 예시 하나로 답해 줘."]],
    auto:["자료 이름", "고른 글", "앞선 답", "이어진 대화", "이 쪽 원문", "새 질문"] },
};
function promptOf(k){
  const p = S.plan.prefs || {};
  const v = p.prompts && typeof p.prompts[k] === "string" ? p.prompts[k] : (k === "explain" && typeof p.explainAsk === "string" ? p.explainAsk : "");
  return v.trim();
}
const explainAsk = () => promptOf("explain") || EXPLAIN_ASK;
const PS = { open:false, tab:"explain", draft:{}, fixed:null, preview:null };
function openPrompts(tab){ PS.open = true; if (tab) PS.tab = tab; PS.preview = null; ui.bump();
  if (!PS.fixed && notesApi && notesApi.prompts) notesApi.prompts().then(f => { PS.fixed = f; ui.bump(); }, () => {}); }
function savePrompt(k, value){
  const p = S.plan.prefs || (S.plan.prefs = {}); const v = String(value || "").trim().slice(0, 1500);
  p.prompts = { ...(p.prompts || {}) };
  if (!v || v === PROMPTS[k].def) delete p.prompts[k]; else p.prompts[k] = v;
  if (k === "explain") delete p.explainAsk;
  Store.savePlan(S.plan); delete PS.draft[k];
}
function fixedText(k){
  if (k === "explain" || k === "chat"){
    const sample = Chat.prompt({ d:{ title:"(자료 이름)" }, page:"N", objs:[{ statement:"(이 쪽 학습목표)" }] }, "(이 쪽 원문)", k === "chat" ? "(내 요청)" : "");
    return k === "explain" ? `${sample}\n[요청]\n(내 요청)\n맨 마지막 줄에는 [다음] 줄을 쓴다.` : sample;
  }
  if (k === "terms") return TermMap.system("(내 요청)") + "\n\n— 사용자 쪽 —\n[자료] (자료 이름)\n[원문 p.N]\n(쪽마다 원문)";
  if (k === "goal") return GoalEx.prompt({ title:"(자료 이름)" }, { statement:"(학습목표)", quote:"(목표의 근거 구절)" }, "[원문 p.N]\n(그 쪽 원문)", "(내 요청)");
  if (!PS.fixed) return "불러오는 중…";
  return `${PS.fixed[k]}\n\n[학습자가 정한 답변 방식 — 위의 형식·근거 규칙과 충돌하면 위 규칙을 따른다]\n(내 요청)`;
}
async function buildPreview(k){
  const R = S.reader, d = S.decks[R.deckId];
  if ((k === "explain" || k === "chat") && S.view === "read" && d){
    const c = { d, page:R.page, objs:d.objectives.filter(o => o.pages.includes(R.page)) }, text = await pageText(d, R.page);
    const mine = (PS.draft[k] ?? promptOf(k)) || PROMPTS[k].def;
    PS.preview = k === "explain" ? `${Chat.prompt(c, text)}\n[요청]\n${mine}\n맨 마지막 줄에는 [다음] 줄을 쓴다.` : Chat.prompt(c, text, mine) + "\n(이어서 최근 대화와 새 질문)";
  } else if (k === "goal" && S.view === "read" && d && d.objectives.some(o => o.pages.includes(R.page))){
    const o = d.objectives.find(x => x.pages.includes(R.page));
    PS.preview = GoalEx.prompt(d, o, await GoalEx.source(d, o), (PS.draft[k] ?? promptOf(k)) || "");
  } else PS.preview = fixedText(k).replace("(내 요청)", (PS.draft[k] ?? promptOf(k)) || "(비어 있음 — 이 부분은 빠져요)");
  ui.bump();
}
/* 프롬프트 설정 창에 그릴 값 (reader/PromptsDialog.tsx) */
function promptsView(){
  if (!PS.open) return null;
  const k = PS.tab, def = PROMPTS[k], cur = PS.draft[k] ?? (promptOf(k) || def.def);
  const R = S.reader, d = S.decks[R.deckId];
  return { tab:k, tabs:Object.entries(PROMPTS).map(([key, x]) => ({ key, label:x.label, custom:!!promptOf(key) })), when:def.when, cur, hasDefault:!!def.def,
    presets:def.presets.map(([label, text]) => ({ label, text })), auto:def.auto, custom:!!promptOf(k), redo: k === "explain" && !!ask && S.view === "read" && !!d && Chat.docked,
    fixed:fixedText(k), preview:PS.preview, previewLabel: (k === "explain" || k === "chat" || k === "goal") && S.view === "read" ? "실제로 보내는 모양 (지금 보는 쪽 기준)" : "실제로 보내는 모양" };
}
const promptsApi = {
  close: () => { PS.open = false; ui.bump(); },
  tab: (k) => { PS.tab = k; PS.preview = null; ui.bump(); },
  draft: (v) => { PS.draft[PS.tab] = v; ui.bump(); },
  reset: () => { savePrompt(PS.tab, PROMPTS[PS.tab].def); ui.bump(); toast("기본으로 되돌렸어요."); },
  save: () => { const k = PS.tab; savePrompt(k, PS.draft[k] ?? (promptOf(k) || PROMPTS[k].def)); ui.bump(); toast("저장했어요. 다음 요청부터 적용돼요."); },
  saveRedo: () => { const k = PS.tab, R = S.reader, d = S.decks[R.deckId]; savePrompt(k, PS.draft[k] ?? (promptOf(k) || PROMPTS[k].def)); PS.open = false; ui.bump();
    if (d){ Explain.skip.delete(Explain.sid(d) + ":" + R.page); Explain.go(d, R.page, true); } toast("새 요청으로 이 쪽을 다시 설명해요."); },
  preview: () => { if (!PS.preview) buildPreview(PS.tab); },
};
/* A page whose text layer says little (a picture slide): the explanation and the question window send its pictures. */
function picturePage(d, text){ return Boolean(d && d.sourceCatalogId) && ((text || "").match(/[\p{L}\p{N}]/gu) || []).length < 300; }

/* 쪽마다 쉬운 설명: after 1.5s on a page with enough text, once per page; kept (study-notes/<source>.explain.json)
   so it shows instantly next time. It is not a 모르는 것 note, so it never counts as "물어봄". */
const Explain = {
  src:{}, run:null, timer:null, err:null, skip:new Set(),
  sid(d){ return d.sourceCatalogId || d.id; },
  auto(){ return !(S.plan.prefs && S.plan.prefs.autoExplain === false); },
  load(d){
    const k = this.sid(d); if (this.src[k]) return;
    const e = this.src[k] = { status:"loading", map:new Map(), goals:new Map() };
    if (!notesOn(d) || !notesApi.explanations){ e.status = "ready"; return; }
    notesApi.explanations(k).then(list => { for (const x of list){ if (x.goal) e.goals.set(x.goal, x.text); else e.map.set(x.page, x.text); } }, () => {})
      .then(() => { e.status = "ready"; const R = S.reader, cur = S.decks[R.deckId]; if (S.view === "read" && cur && this.sid(cur) === k){ ui.bump(); if (Trans.on()) drawPage(); } if (S.view === "read" && Chat.docked && cur && this.sid(cur) === k) this.want(cur, R.page); });
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
    // Picture-heavy page: its pictures go with the request instead of skipping it (lecture slides that are mostly images).
    const pic = picturePage(d, text);
    if (!force && !pic && text.replace(/\s/g, "").length < 40){ this.skip.add(key); this.paintNode(); return; }
    const objs = d.objectives.filter(o => o.pages.includes(page));
    const run = this.run = { key, text:"", ctl:new AbortController() };
    this.paintNode();
    const prompt = Chat.prompt({ d, page, objs }, text) + `
[요청]
${explainAsk().slice(0, 1500)}
맨 마지막 줄에는 [다음] 줄을 쓴다.`;
    try{
      await ask([{ role:"user", content:prompt }], { signal:run.ctl.signal, onText: ({ text:t }) => { run.text = t; this.paintBody(); }, ...(pic ? { pageImage:{ sourceId:d.sourceCatalogId, page } } : {}) });
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
  /* 쉬운 설명 칸에 그릴 값 (ChatWindow.tsx의 ExplainCard) */
  view(d, page){
    const key = this.sid(d) + ":" + page, e = this.src[this.sid(d)];
    const saved = e && e.map.get(page), run = this.run && this.run.key === key ? this.run : null;
    return { page, auto:this.auto(), canAsk:!!ask, custom:!!promptOf("explain"), loading: !!(e && e.status === "loading"),
      text: run ? (shown(run.text) || "쉬운 설명을 쓰는 중…") : saved ? shown(saved) : "", streaming:!!run,
      err: this.err && this.err.key === key ? this.err.text : "", skipped:this.skip.has(key) };
  },
  setAuto(on){ const R = S.reader, d = S.decks[R.deckId]; (S.plan.prefs || (S.plan.prefs = {})).autoExplain = on; Store.savePlan(S.plan); ui.bump(); if (on && d) this.want(d, R.page); },
  again(){ const R = S.reader, d = S.decks[R.deckId]; if (!d) return; this.skip.delete(this.sid(d) + ":" + R.page); this.go(d, R.page, true); },
  next(d, page){ const e = this.src[this.sid(d)], t = e && e.map.get(page); return t ? splitNext(t).next : []; },
  paintNode(){ ui.bump(); },
  paintBody(){ ui.bump(); },
};
/* ----- 번역 보기: the PDF page itself turns Korean. Text lines are grouped into blocks (a bullet, a wrapped paragraph,
   a title, a label); each block is covered with the page's own background and the translation is written in the same
   box, so figures and layout stay. Key terms keep their English once per page ("한국어(English)"). One request per page,
   kept with the explanations (`__tr:<page>`, checked against the block texts); the next page is prepared ahead. ----- */
const TRANS_RULES = `너는 영어 강의 슬라이드를 한국어로 옮기는 번역가다. 학습자는 내용을 한국어로 이해하면서 영어 핵심 용어도 눈에 익혀야 한다.
입력은 번호가 붙은 블록들이다. t 배열에 1번 블록부터 차례로 번역을 하나씩 넣는다. 블록 수와 순서를 그대로 지킨다.

규칙
- 슬라이드 문체로 간결하게 옮긴다(명사형 또는 "~다"). 원문에 없는 설명을 덧붙이지 않는다.
- 기술 용어는 이 쪽에서 처음 나올 때 "한국어(English)"로 병기하고, 그 뒤로는 한국어만 쓴다. 우리말로 굳은 말이 없는 용어는 음차하거나 영어 그대로 둔다(예: 픽셀, 래스터).
- (제목) 블록은 "한국어 제목 (English Title)"로 쓴다.
- (라벨) 블록은 짧은 한국어로만 쓰고 병기하지 않는다.
- 수식, 기호, 변수명, 숫자, 단위, 코드, 사람·제품 이름은 그대로 둔다. 옮길 것이 없으면 원문 그대로 쓴다.
- 블록을 합치거나 나누지 않는다. 한 문장이 여러 블록에 걸쳐 있어도 각 블록 자리에 해당하는 부분만 옮긴다.
- 글머리표(•, -, 1. 등)는 그대로 둔다.`;
const TR = { blocks:{}, run:new Map(), err:{} };
const Trans = {
  on(){ return !!(S.plan.prefs && S.plan.prefs.translate); },
  can(d){ return !!(notesApi && notesApi.compose) && !!d.sourceCatalogId; },
  toggle(){ const p = S.plan.prefs || (S.plan.prefs = {}); p.translate = !this.on(); Store.savePlan(S.plan); render(); },
  key(n){ return `__tr:${n}`; },
  /* Blocks in scale-1 page units (independent of the drawn size). */
  async blocks(d, n){
    const ck = d.id + ":" + n; if (TR.blocks[ck]) return TR.blocks[ck];
    const P = S.pdf[d.id]; if (!P || P.status !== "ready") return null;
    const page = await P.doc.getPage(n), vp = page.getViewport({ scale:1 }), tc = await page.getTextContent();
    const runs = [];
    for (const it of tc.items){
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const tx = pdfjs.Util.transform(vp.transform, it.transform), fh = Math.hypot(tx[2], tx[3]);
      if (!fh || Math.abs(Math.atan2(tx[1], tx[0])) > 0.02) continue;
      runs.push({ text:it.str, x0:tx[4], x1:tx[4] + it.width, base:tx[5], fh });
    }
    runs.sort((a, b) => a.base - b.base || a.x0 - b.x0);
    const lines = [];
    for (const r of runs){
      const l = lines.find(l => Math.abs(l.base - r.base) < r.fh * 0.35 && r.x0 - l.x1 < r.fh * 2.2 && r.x1 > l.x0 - r.fh * 2.2);
      if (l){ l.parts.push(r); l.x0 = Math.min(l.x0, r.x0); l.x1 = Math.max(l.x1, r.x1); l.fh = Math.max(l.fh, r.fh); }
      else lines.push({ parts:[r], x0:r.x0, x1:r.x1, base:r.base, fh:r.fh });
    }
    for (const l of lines){
      l.parts.sort((a, b) => a.x0 - b.x0);
      l.text = l.parts.reduce((t, r, i) => i && r.x0 - l.parts[i - 1].x1 > r.fh * 0.12 && !/\s$/.test(t) ? t + " " + r.text : t + r.text, "").replace(/\s+/g, " ").trim();
      l.y0 = l.base - l.fh * 0.88; l.y1 = l.base + l.fh * 0.25;
    }
    lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const BULLET = /^([•▪◦●○■□►▶✓✔\-–*]|\(?\d{1,2}[.)]\s|[a-z][.)]\s)/;
    const blocks = [];
    for (const l of lines){
      const b = BULLET.test(l.text) ? null : [...blocks].reverse().find(b => Math.abs(b.fh - l.fh) < b.fh * 0.2 && l.y0 - b.y1 < l.fh * 0.75 && l.y0 >= b.y1 - l.fh * 0.4 && l.x0 < b.x1 && l.x1 > b.x0);
      if (b){ b.text = /[-‐]$/.test(b.text) ? b.text.slice(0, -1) + l.text : b.text + " " + l.text; b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1); b.y1 = l.y1; b.lines++; }
      else blocks.push({ text:l.text, x0:l.x0, x1:l.x1, y0:l.y0, y1:l.y1, fh:l.fh, lines:1 });
    }
    const out = blocks.filter(b => /[A-Za-z]{2}/.test(b.text)).slice(0, 90);
    const big = Math.max(0, ...out.map(b => b.fh));
    for (const b of out){
      b.tag = b.fh >= big * 0.98 && b.fh > 0 && b.y0 < vp.height * 0.3 && out.filter(x => x.fh >= big * 0.98).length <= 2 ? "제목"
        : b.lines === 1 && b.text.split(/\s+/).length <= 4 && (b.x1 - b.x0) < vp.width * 0.25 ? "라벨" : "";
    }
    // A title gets the room to its right (the Korean title also carries the English one).
    for (const b of out) if (b.tag === "제목"){
      const right = Math.min(vp.width * 0.96, ...out.filter(x => x !== b && x.x0 > b.x1 && x.y1 > b.y0 && x.y0 < b.y1).map(x => x.x0 - b.fh * 0.5));
      if (right > b.x1) b.x1 = right;
    }
    const res = { W:vp.width, H:vp.height, list:out, sig:this.sig(out) };
    TR.blocks[ck] = res; return res;
  },
  sig(list){ let h1 = 0; for (const c of list.map(b => b.text).join("\n")) h1 = (h1 * 31 + c.codePointAt(0)) >>> 0; return list.length + ":" + h1.toString(36); },
  saved(d, n, sig){
    const e = Explain.src[Explain.sid(d)], raw = e && e.goals ? e.goals.get(this.key(n)) : null;
    if (!raw) return null; try{ const v = JSON.parse(raw); return v.sig === sig && Array.isArray(v.t) ? v.t : null; }catch(err){ return null; }
  },
  async ensure(d, n, quiet){
    const k = Explain.sid(d) + ":" + n;
    if (TR.run.has(k) || !this.can(d)) return;
    const B = await this.blocks(d, n); if (!B || !B.list.length) return;
    const e = Explain.src[Explain.sid(d)]; if (!e || e.status !== "ready") return;
    if (this.saved(d, n, B.sig)) return;
    if (quiet && TR.err[k]) return;
    delete TR.err[k];
    const task = (async () => {
      const user = `[자료] ${d.title}\n[쪽] p.${n}\n\n${B.list.map((b, i) => `${i + 1}. ${b.tag ? `(${b.tag}) ` : ""}${b.text}`).join("\n")}`;
      const raw = await notesApi.compose({ system:TRANS_RULES, user, kind:"translate" });
      const v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const t = B.list.map((b, i) => typeof (v.t || [])[i] === "string" && v.t[i].trim() ? v.t[i].trim().slice(0, 600) : null);
      const val = JSON.stringify({ sig:B.sig, t });
      e.goals.set(this.key(n), val);
      if (notesOn(d) && notesApi.saveExplanation) notesApi.saveExplanation(Explain.sid(d), n, val, this.key(n)).catch(() => {});
    })();
    TR.run.set(k, task);
    if (!quiet) this.repaint(d, n);
    try{ await task; }catch(err){ TR.err[k] = err instanceof SyntaxError ? "번역을 읽지 못했어요." : composeErrorCopy(err); }
    TR.run.delete(k);
    this.repaint(d, n);
    // Prepare the next page while this one is read.
    if (!quiet && this.on() && !TR.err[k] && n < pageTotal(d)) this.ensure(d, n + 1, true);
  },
  repaint(d, n){ const R = S.reader; if (S.view === "read" && R.deckId === d.id && R.page === n) drawPage(); },
  /* Nodes for paintBox: the covered, translated blocks, or a small status chip. Synchronous; work is kicked off. */
  nodes(d, n, entry){
    if (!this.on() || !this.can(d)) return [];
    Explain.load(d);
    const B = TR.blocks[d.id + ":" + n], k = Explain.sid(d) + ":" + n, e = Explain.src[Explain.sid(d)];
    if (!B){ this.blocks(d, n).then((x) => { if (x) this.repaint(d, n); }, () => {}); return [this.chip("번역 준비 중…")]; }
    if (!B.list.length) return [this.chip("이 쪽엔 옮길 글이 없어요")];
    const t = this.saved(d, n, B.sig);
    if (!t){
      if (TR.err[k]) return [this.chip(TR.err[k] + " · 다시 시도", () => { delete TR.err[k]; this.ensure(d, n); })];
      if (e && e.status === "ready" && !TR.run.has(k)) setTimeout(() => this.ensure(d, n), 0);
      return [this.chip("이 쪽을 번역하는 중…", null, true)];
    }
    const cache = entry._trc || (entry._trc = {});
    const c = entry.canvas, sx = c.width / B.W, sy = c.height / B.H, ctx = c.getContext("2d", { willReadFrequently:true });
    const px = (x, y) => { try{ const v = ctx.getImageData(Math.max(0, Math.min(c.width - 1, Math.round(x))), Math.max(0, Math.min(c.height - 1, Math.round(y))), 1, 1).data; return [v[0], v[1], v[2]]; }catch(err){ return [255, 255, 255]; } };
    const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
    return B.list.map((b, i) => {
      if (!t[i]) return null;
      const X0 = b.x0 * sx, X1 = b.x1 * sx, Y0 = b.y0 * sy, Y1 = b.y1 * sy, pad = 3, ck2 = n + ":" + i;
      const [bg, ink] = cache[ck2] || (cache[ck2] = (() => {
      // Background: the lightest-agreeing sample just outside the box; text: the darkest-contrast ink inside it.
      const around = [px(X0 - pad, Y0 - pad), px(X1 + pad, Y0 - pad), px(X0 - pad, Y1 + pad), px(X1 + pad, Y1 + pad), px((X0 + X1) / 2, Y0 - pad)];
      around.sort((a, b2) => lum(a) - lum(b2)); const bg = around[2];
      let ink = bg, best = 0;
      for (let gx = 0; gx < 9; gx++) for (let gy = 0; gy < 3; gy++){ const v = px(X0 + (X1 - X0) * (gx + 0.5) / 9, Y0 + (Y1 - Y0) * (gy + 0.5) / 3); const dl = Math.abs(lum(v) - lum(bg)); if (dl > best){ best = dl; ink = v; } }
      if (best < 60) ink = lum(bg) > 140 ? [20, 22, 28] : [250, 250, 250];
      return [bg, ink]; })());
      return h("div", { class:"trb", "data-fs":String(b.fh * 0.92), "data-w":String(B.W), "data-h":String((b.y1 - b.y0) / B.W), title:b.text,
        style:`left:${b.x0 / B.W * 100}%;top:${b.y0 / B.H * 100}%;width:${(b.x1 - b.x0) / B.W * 100}%;height:${(b.y1 - b.y0) / B.H * 100}%;background:rgb(${bg.join(",")});color:rgb(${ink.join(",")})` + (b.tag === "제목" ? ";font-weight:700" : "") }, t[i]);
    }).filter(Boolean);
  },
  chip(text, onclick, wait){ return h(onclick ? "button" : "div", { class:"trchip" + (wait ? " ex-wait" : ""), onclick }, text); },
  /* Fit each block's Korean into its box: start at the line's height, shrink until it fits (not below 55%). */
  fit(box){
    const bw = box.getBoundingClientRect().width;
    for (const el of box.querySelectorAll(".trb")){
      const k = bw / Number(el.dataset.w); let fs = Number(el.dataset.fs) * k; const min = fs * 0.55;
      el.style.fontSize = fs + "px";
      while (fs > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)){ fs *= 0.92; el.style.fontSize = fs + "px"; }
      // Still too long at the smallest size: let the box grow downward rather than cut the text.
      if (el.scrollHeight > el.clientHeight + 1){ el.style.minHeight = el.style.height; el.style.height = "auto"; }
    }
  },
};
/* ----- 용어 지도: a term-heavy material rebuilt for memory — every term split into Korean word parts, a grounded
   definition, one familiar analogy and its look-alike; grouped as a tree; and one story that walks through all of them.
   Made once per material range (one long request) and kept with the explanations (`__terms:<from>-<to>`). ----- */
const TERMS_RULES = `너는 영어 강의자료의 용어와 개념을 한국어 학습자가 기억하기 쉽게 재구성하는 튜터다.
아래 [원문]에서 이 자료를 이해하고 시험을 보는 데 필요한 용어·개념을 빠짐없이 뽑아, 정해진 형식(묶음 groups → 용어 terms, 그리고 story)으로 답한다.
각 용어 칸: en 원문 표기, ko 한국어 용어, parts 단어 쪼개기, under 상위 용어의 en(없으면 빈 문자열), def 정의, analogy 비유, pair 헷갈리는 짝과 차이(없으면 빈 문자열), page 쪽 번호(모르면 0).

규칙
- groups: 의미가 가까운 용어끼리 묶는다(보통 3~8묶음). 원문 순서보다 개념의 구조를 따른다. 상하 관계가 있으면 under로 잇는다.
- en: 원문 표기를 그대로 쓴다(약어가 있으면 "Cathode Ray Tube (CRT)"처럼).
- parts: 영어 단어를 뜻 단위로 쪼개 한국어 뜻을 붙인다. 쪼갤 게 없으면 빈 문자열.
- def: 원문에 근거한 정의 한두 문장. 원문에 정의가 없으면 원문이 그 용어를 쓰는 맥락으로 쓰고, 지어내지 않는다.
- analogy: 처음 듣는 사람도 바로 그림이 그려지는 익숙한 비유 한 문장. 개념을 틀리게 만드는 비유는 쓰지 않는다.
- story: 모든 용어가 원인→결과나 순서로 이어지는 짧은 흐름 글(예: "화면에 그림 한 장이 뜨기까지"). 용어가 나올 때마다 [[en]]처럼 en을 대괄호 두 겹으로 감싼다. 문단은 줄바꿈으로 나눈다.
- 식은 $...$ 안에 LaTeX로 쓴다. 마크다운 기호는 쓰지 않는다.`;
const TM = { open:false, run:null, err:null, sel:null, key:"" };
/* 자료 지도 (workspace/MaterialMap.tsx, 2026-10-29): the outline and its knowledge on one screen, over the reader.
   Kept outside #app so a re-render of the reader does not close it; a page picked there opens in the reader. */
// 사용자 10/30: a material the engine made is studied from its map, not a reading screen. 원문 opens one page over the map,
// 문제 풀기 starts that page's questions, and a material made without questions gets them here (문제 만들기).
const genDeck = (id) => !!env.mountView && /^(pending:)?gen_/.test(String(id || ""));
const MaterialMapView = {
  cur: null,
  asked: {},
  open(d){
    this.close();
    const ov = h("div", { class:"mm2-overlay" }), host = h("div");
    ov.append(host);
    (document.getElementById("app").closest(".dejipgi") || document.body).append(ov);
    const gid = String(d.id).replace(/^pending:/, "");
    const deckNow = () => S.decks[gid] || S.decks["pending:" + gid] || d;
    const stop = env.mountView("map", host, { genId: gid,
      onPage: (p) => SourcePeek.open(deckNow(), p),
      // The card's own question (objective "s4-q4c3" for card "s4.4c3"), or the page's when it has none of its own.
      onPractice: (p, cardId) => {
        const real = S.decks[gid];
        if (!real){ toast("문제가 아직 연습에 붙지 않았어요. 잠시 뒤 다시 눌러 주세요."); return; }
        const objId = String(cardId || "").replace(/^(s\d+)\.(.+)$/, "$1-q$2");
        this.close(); S.session = null;
        startCheck(gid, p, real.items.some(it => it.objectiveId === objId) ? objId : undefined);
      },
      onMakeQuestions: () => makeQuestions(deckNow()),
      // 만든 문제부터 풀기 (11/6 사용자 "자료 입력하고 실시간으로 만들어지는 창에서 문제도 바로 풀 수 있게, 만들어진 문제부터"):
      // while the material is still being made, the questions published so far; pressed again, only the ones not yet asked here.
      onPracticeAll: () => {
        const real = S.decks[gid];
        const items = real ? real.items : [];
        if (!items.length){ toast("아직 만들어진 문제가 없어요. 잠시 뒤 다시 눌러 주세요."); return; }
        const asked = this.asked[gid] || (this.asked[gid] = new Set());
        const fresh = items.filter(it => !asked.has(it.id));
        const pick = fresh.length ? fresh : items;
        for (const it of pick) asked.add(it.id);
        this.close(); S.session = null;
        startCheck(gid, pick[0].page, undefined, pick);
      },
      onClose: () => this.close() });
    this.cur = { ov, stop };
  },
  close(){ if (this.cur){ this.cur.stop(); this.cur.ov.remove(); this.cur = null; } },
};
/* 뒤로 한 칸(11/11 사용자 "뒤로 가기, 하나 더 열린 탭 있으면 그것만 닫기"): Esc · 마우스 뒤로 버튼 · Alt+← 가 맨 위의 것 하나만 닫는다.
   원문 보기(자기 Esc가 먼저) → 자료 지도 안에서 열린 것(플래시카드·펼친 카드: 지도가 recaller:back을 받아 처리하면 끝) → 자료 지도 → 새 자료 화면은 PDF 자료로. */
function backOne(){
  if (SourcePeek.cur){ SourcePeek.close(); return true; }
  if (MaterialMapView.cur){
    const ev = new CustomEvent("recaller:back", { cancelable:true });
    window.dispatchEvent(ev);
    if (!ev.defaultPrevented) MaterialMapView.close();
    return true;
  }
  if (S.view === "create" && !S.builder?.busy){ setView("practice"); render(); return true; }
  return false;
}
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target; const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if ((e.key === "Escape" && MaterialMapView.cur && !typing) || (e.altKey && e.key === "ArrowLeft")){ if (backOne()) e.preventDefault(); }
});
document.addEventListener("mouseup", (e) => { if (e.button === 3 && backOne()) e.preventDefault(); });
// 원문 보기가 열려 있으면 Esc·←·→는 그 창 것 (다른 곳보다 먼저)
on(document, "keydown", (e) => {
  if (!SourcePeek.cur) return;
  if (e.key === "Escape"){ e.stopPropagation(); e.preventDefault(); SourcePeek.close(); }
  else if (e.key === "ArrowLeft"){ e.stopPropagation(); SourcePeek.go(-1); }
  else if (e.key === "ArrowRight"){ e.stopPropagation(); SourcePeek.go(1); }
}, { capture:true });

/* 원문 보기: one page of the PDF in a window over whatever is on screen (the map, a result), ‹ › to turn, Esc to close. */
// 11/11 React로: 창은 reader/ReaderOverlays.tsx의 SourcePeekLayer가 그리고, 쪽 그림만 여기 paintBox가 그 칸에 그린다.
const SourcePeek = {
  cur: null,
  open(d, page){
    if (!d) return;
    ensurePdf(d);
    const total = pageTotal(d);
    this.cur = { d, page: Math.max(1, Math.min(total, page || 1)) };
    ui.bump();
  },
  go(k){ const c = this.cur; if (!c) return; const n = c.page + k; if (n < 1 || n > pageTotal(c.d)) return; c.page = n; ui.bump(); },
  view(){
    const c = this.cur; if (!c) return null;
    const P = S.pdf[c.d.id];
    if (!P || P.status === "loading") setTimeout(() => { if (this.cur === c) ui.bump(); }, 300);
    return { page:c.page, total:pageTotal(c.d), key:c.d.id + ":" + c.page, status: !P ? "loading" : P.status, aspect:pageAspect(c.d) };
  },
  async paint(box){
    const c = this.cur; if (!c || !box) return;
    const P = S.pdf[c.d.id]; if (!P || P.status !== "ready") return;
    await paintBox(box, c.d, c.page, Math.max(200, Math.floor(box.getBoundingClientRect().width)));
  },
  close(){ if (!this.cur) return; this.cur = null; ui.bump(); },
};
const TermMap = {
  // The studied range: real decks carry no page texts, so it comes from where the objectives and questions sit.
  range(d){
    const ns = [...(d.pages || []).map(p => p.n), ...d.objectives.flatMap(o => o.pages || []), ...(d.items || []).map(i => i.page), ...(d.outline || []).flatMap(s => s.pages || [])].filter(Number.isFinite);
    return ns.length ? [Math.min(...ns), Math.max(...ns)] : [1, pageTotal(d)];
  },
  key(d){ const [a, b] = this.range(d); return `__terms:${a}-${b}`; },
  saved(d){
    const e = Explain.src[Explain.sid(d)], raw = e && e.goals ? e.goals.get(this.key(d)) : null;
    if (!raw) return null; try{ return this.clean(JSON.parse(raw)); }catch(err){ return null; }
  },
  clean(x){
    const str = (v, n) => String(v ?? "").trim().slice(0, n);
    const groups = (Array.isArray(x && x.groups) ? x.groups : []).map(g => ({ name:str(g.name, 60) || "묶음",
      terms:(Array.isArray(g.terms) ? g.terms : []).map(t => ({ en:str(t.en, 120), ko:str(t.ko, 80), parts:str(t.parts, 200), under:str(t.under, 120),
        def:str(t.def, 600), analogy:str(t.analogy, 400), pair:str(t.pair, 300), page:Number.isFinite(+t.page) && +t.page > 0 ? +t.page : null })).filter(t => t.en) })).filter(g => g.terms.length);
    if (!groups.length) throw new Error("빈 지도");
    return { groups, story:str(x.story, 8000) };
  },
  async source(d){
    // A v3 material already has a knowledge map from reading the whole PDF: start from it, with less page text.
    const p = pendingOf(d), known = String(d.knowledge || (p && p.pending.knowledge) || "");
    const [a, b] = this.range(d), n = b - a + 1, per = Math.max(400, Math.min(3000, Math.floor((52000 - known.length) / n)));
    const parts = known ? [known] : [];
    for (let p = a; p <= b; p++){ const t = String(await pageText(d, p) || "").trim(); if (t) parts.push(`[원문 p.${p}]\n${t.slice(0, per)}`); }
    return parts.join("\n\n");
  },
  system(style){ style = String(style || "").trim(); return TERMS_RULES + (style ? `\n\n[학습자가 정한 방식 — 위 규칙·형식과 충돌하면 위 규칙을 따른다]\n${style.slice(0, 1500)}` : ""); },
  openFor(d){ TM.open = true; TM.sel = null; TM.key = Explain.sid(d) + ":" + this.key(d); Explain.load(d); ui.bump(); },
  async go(d){
    if (!notesApi || !notesApi.compose) return;
    const k = Explain.sid(d) + ":" + this.key(d);
    TM.err = null; TM.run = { key:k, at:Date.now() }; ui.bump();
    try{
      const user = `[자료] ${d.title}\n\n${await this.source(d)}`;
      const raw = await notesApi.compose({ system:this.system(promptOf("terms")), user, kind:"terms" });
      const m = raw.indexOf("{"), z = raw.lastIndexOf("}");
      const map = this.clean(JSON.parse(raw.slice(m, z + 1)));
      if (map.story.includes("$") || map.groups.some(g => g.terms.some(t => (t.def + t.analogy).includes("$")))) await ensureKatex();
      const e = Explain.src[Explain.sid(d)]; if (e) e.goals.set(this.key(d), JSON.stringify(map));
      if (notesOn(d) && notesApi.saveExplanation) notesApi.saveExplanation(Explain.sid(d), this.range(d)[0], JSON.stringify(map), this.key(d)).catch(() => {});
    }catch(err){
      TM.err = { key:k, text: err instanceof SyntaxError || (err && err.message === "빈 지도") ? "지도를 읽지 못했어요. 다시 만들어 주세요." : composeErrorCopy(err) };
    }
    TM.run = null; ui.bump();
  },
  find(map, name){ const n = String(name).trim().toLowerCase(); for (const g of map.groups) for (const t of g.terms) if (t.en.toLowerCase() === n || t.ko.toLowerCase() === n) return t; return null; },
  pick(en){ TM.sel = TM.sel === en ? null : en; ui.bump();
    if (TM.sel) requestAnimationFrame(() => { const el = [...document.querySelectorAll("[data-term]")].find(x => x.dataset.term === en); if (el) el.scrollIntoView({ block:"nearest", behavior:"smooth" }); }); },
  /* 용어 지도 창에 그릴 값 (reader/TermMapDialog.tsx) */
  view(){
    const R = S.reader, d = S.decks[R.deckId];
    if (!TM.open || !d) return null;
    const k = Explain.sid(d) + ":" + this.key(d), e = Explain.src[Explain.sid(d)];
    return { title:displayTitle(d), map:this.saved(d), sel:TM.sel, running:!!(TM.run && TM.run.key === k), loading:!!(e && e.status === "loading"),
      canMake:!!(notesApi && notesApi.compose), err: TM.err && TM.err.key === k ? TM.err.text : "", custom:!!promptOf("terms") };
  },
};
/* ----- 목표 설명: press a goal in "이 쪽에서 익힐 것" and it opens into a compact note of exactly what the goal asks —
   nothing left out, nothing added; length follows the goal, not a line count. Made once per goal and kept beside the
   page explanations (study-notes/<source>.explain.json, entries with `goal`). ----- */
const GOAL_RULES = `너는 학습자가 읽고 있는 자료의 학습목표 하나를 정리해 주는 튜터다.

규칙
- [학습목표]가 요구하는 내용을 빠짐없이, 그 이상은 덧붙이지 않고 정리된 노트 형태로 쓴다. 분량은 목표에 맞춘다: 정의 하나면 짧게, 조건·단계·비교 항목이 여럿이면 그 수만큼 모두 쓴다.
- 근거는 아래 [원문]이다. 목표에 필요한데 원문에 없는 부분은 그 자리에 "자료에 없음"이라고만 짧게 밝힌다. 지어내지 않는다.
- 항목이 여럿이면 "1)" "2)"로 나누고, 과정은 순서대로 쓴다. 식은 $...$ 안에 LaTeX로 쓰고 기호의 뜻을 붙인다.
- 원문의 기호와 용어는 바꾸지 않는다. 기준점, 방향, 부호, 단위, 조건을 빠뜨리지 않는다.
- 인사, 서론, 목표를 되풀이하는 첫 문장, "요약하면", 외우기 팁, 후속 질문 같은 덧붙임은 쓰지 않는다.
- 마크다운 기호(#, *, **, -)는 쓰지 않고 평문으로 쓴다.`;
const GoalEx = {
  open:null, run:null, err:null,
  key(d, o){ return Explain.sid(d) + ":" + o.id; },
  isOpen(d, o){ return this.open === this.key(d, o); },
  saved(d, o){ const e = Explain.src[Explain.sid(d)]; return e && e.goals ? e.goals.get(o.id) : undefined; },
  async source(d, o){
    const pages = (o.pages && o.pages.length ? o.pages : [S.reader.page]).slice(0, 3);
    const parts = [];
    for (const p of pages) parts.push(`[원문 p.${p}]\n${String(await pageText(d, p) || "(추출된 글자가 없는 쪽)").slice(0, 4000)}`);
    return parts.join("\n\n");
  },
  prompt(d, o, source, style){
    style = String(style || "").trim();
    return `${GOAL_RULES}
${style ? `\n[학습자가 정한 방식 — 위 규칙과 충돌하면 위 규칙을 따른다]\n${style.slice(0, 1500)}\n` : ""}
[자료] ${d.title}
[학습목표] ${o.statement}${o.quote ? `\n[목표의 근거 구절] ${o.quote}` : ""}

${source}`;
  },
  toggle(d, o){
    const k = this.key(d, o), R = S.reader;
    if (this.open === k){ this.open = null; if (R.active === o.id) R.active = null; render(); return; }
    this.open = k; R.active = o.id; Explain.load(d);
    if (!this.saved(d, o) && !(this.run && this.run.key === k) && !(this.err && this.err.key === k)) this.go(d, o);
    render();
  },
  async go(d, o){
    if (!ask) return;
    const k = this.key(d, o);
    if (this.run && this.run.ctl) this.run.ctl.abort();
    this.err = null;
    const run = this.run = { key:k, text:"", ctl:new AbortController() };
    this.paintAll();
    try{
      const prompt = this.prompt(d, o, await this.source(d, o), promptOf("goal"));
      await ask([{ role:"user", content:prompt }], { signal:run.ctl.signal, onText: ({ text:t }) => { run.text = t; this.paintBody(); } });
      if (this.run !== run) return;
      if (run.text.includes("$") && !katexLib) await ensureKatex();
      this.run = null;
      const out = shown(run.text).trim();
      if (out){
        const e = Explain.src[Explain.sid(d)]; if (e) e.goals.set(o.id, out);
        if (notesOn(d) && notesApi.saveExplanation) notesApi.saveExplanation(Explain.sid(d), (o.pages && o.pages[0]) || S.reader.page, out, o.id).catch(() => {});
      }
    }catch(err){
      if (this.run !== run) return;
      this.run = null;
      if (!(err && err.code === "cancelled")) this.err = { key:k, text:sampleErrorCopy(err) };
    }
    this.paintAll();
  },
  /* 펼친 목표 정리에 그릴 값 (reader/ReaderView.tsx) */
  view(d, o){
    if (!this.isOpen(d, o)) return null;
    const k = this.key(d, o), saved = this.saved(d, o), run = this.run && this.run.key === k ? this.run : null;
    const e = Explain.src[Explain.sid(d)];
    return { text: run ? (shown(run.text) || "정리하는 중…") : saved || "", streaming:!!run, canAsk:!!ask, err: this.err && this.err.key === k ? this.err.text : "",
      loading: !!(e && e.status === "loading"), saved:!!saved, hasItems:d.items.some(it => it.objectiveId === o.id), custom:!!promptOf("goal") };
  },
  paintAll(){ ui.bump(); },
  paintBody(){ ui.bump(); },
};
/* ----- floating question window: lives outside #app so re-renders never reset it.
   Answers need a paid model call, so `ask` stays unset until the user approves wiring it. ----- */
/* ----- 질문 창 (11/11 React로: workspace/reader/ChatWindow.tsx가 그린다). 여기는 대화 상태와 보내기만.
   떠 있는 창(floating) 또는 읽기 곁 패널에 붙은 창(docked). Answers need a paid model call (`ask`). ----- */
const Chat = {
  visible:false, msgs:[], busy:false, ctl:null, err:"", input:"", focusTick:0,
  // 모르는 것 노트: one conversation is one note item; a conversation continued from a card extends that card.
  noteId:null, noteSource:null, noteTitle:"", fromNote:null, base:0, quote:null,
  mode:"normal", docked:false,
  isOpen(){ return this.visible && !this.docked; },
  focus(){ this.focusTick++; ui.bump(); },
  setMode(m){ this.mode = m; ui.bump(); },
  toggle(){ this.isOpen() ? this.close() : this.open(); },
  close(){ if (this.docked) return; if (this.ctl) this.ctl.abort(); this.visible = false; if (S.view === "read") render(); else ui.bump(); },
  open(){
    if (this.docked){ setPanelTab("ask"); this.focus(); return; }
    this.visible = true; if (this.mode === "min") this.mode = "normal";
    ensureKatex().then(ok => { if (ok && this.isOpen()) ui.bump(); });
    this.focusTick++;
    if (S.view === "read") render(); else ui.bump();
  },
  context(){
    const R = S.reader, d = S.decks[R.deckId];
    if (!d) return null;
    return { d, page:R.page, objs:d.objectives.filter(o => o.pages.includes(R.page)) };
  },
  /* 쪽마다 대화: moving to another page puts this conversation away (it is in the notes too) and shows that page's
     own conversation, or an empty window. Not while an answer is streaming in. */
  threads:new Map(), threadKey:null,
  switchThread(c){
    const key = c ? (c.d.sourceCatalogId || c.d.id) + ":" + c.page : null;
    if (!key || key === this.threadKey || this.busy) return;
    if (this.threadKey && this.msgs.length) this.threads.set(this.threadKey, { msgs:this.msgs, noteId:this.noteId, noteSource:this.noteSource, noteTitle:this.noteTitle, fromNote:this.fromNote, base:this.base });
    const saved = this.threads.get(key);
    Object.assign(this, saved ? { ...saved } : { msgs:[], noteId:null, noteSource:null, noteTitle:"", fromNote:null, base:0 }, { err:"", quote:null });
    this.threadKey = key;
  },
  paint(){ ui.bump(); },
  paintSugs(){ ui.bump(); },
  /* 질문 칩: up to 2–3 questions for this page and one next action */
  sugs(c){
    if (!c || this.busy) return { qs:[], act:null };
    const act = pageAction(c), qs = pageSuggestions(c).slice(0, act ? 2 : 3);
    if (!qs.length && !this.msgs.length) qs.push({ label:"이 쪽 쉽게 설명해 줘", why:"" });
    return { qs, act };
  },
  prompt(c, text, style){
    text = String(text || "").slice(0, 6000); style = String(style || "").trim();
    return `너는 학습자가 지금 읽고 있는 자료를 옆에서 도와주는 튜터다.

규칙
- 아래 [지금 보는 쪽]의 원문을 근거로 답한다. 원문에 없는 내용을 덧붙일 때는 그 문장 앞에 "원문 밖 설명:"이라고 밝힌다.
- ChatGPT·Claude 채팅처럼 답한다: 질문과 내용에 맞는 형식을 고른다. 비교는 대상별 표(| 항목 | A | B |)나 대상별 목록, 과정·순서는 번호 단계, 정의는 한 줄 정의 + 쉬운 비유, 역사는 시간 순서, 짧은 질문에는 짧게. 그림을 위에서부터 묘사하지 말고 "그래서 무슨 뜻인지"를 말한다. 학습자는 비전공자다. 길이는 필요한 만큼.
- "줄마다 풀어 달라"는 요청이면 원문 줄을 짧게 인용하고 바로 아래에 쉬운 말 한두 문장을 붙인다.
- 원문의 기호와 용어는 바꾸지 않는다. 기준점, 방향, 부호, 단위, 조건을 빠뜨리지 않는다. 식은 $...$ 안에 LaTeX로 쓴다.
- 질문이 이 쪽과 무관하면 짧게 답하고, 이 쪽과 어떻게 이어지는지 한 문장 덧붙인다.
- 마크다운을 쓴다: **굵게**(핵심어), 목록(- 또는 1.), 표, 짧은 소제목(###). 표 칸 안에는 줄바꿈을 넣지 않는다.
${NEXT_RULE}
${style ? `\n[학습자가 정한 답변 방식 — 위 규칙과 충돌하면 위 규칙을 따른다]\n${style.slice(0, 1500)}\n` : ""}
[자료] ${c.d.title}
[지금 보는 쪽 p.${c.page}]
${text || "(이 쪽은 추출된 글자가 없다. 이미지 위주의 쪽일 수 있다.)"}
${c.objs.length ? `\n[이 쪽의 학습목표]\n${c.objs.map(o => "- " + o.statement).join("\n")}` : ""}
`;
  },
  reset(keepOpen){
    if (this.ctl) this.ctl.abort();
    Object.assign(this, { msgs:[], err:"", noteId:null, noteSource:null, noteTitle:"", fromNote:null, base:0, quote: keepOpen ? this.quote : null });
    if (!keepOpen) ui.bump();
  },
  /* 질문 창에 넣기: the dragged text becomes a quote chip on the next question */
  quoteIn(text){
    this.quote = text;
    if (this.docked){ setPanelTab("ask"); this.focus(); return; }
    if (!this.isOpen()) this.open(); else this.focus();
  },
  /* 질문 창에서 계속: carry a card's answer and turns into the window; new turns go back to that card */
  continueNote(d, note){
    this.reset(true);
    this.msgs = [{ role:"assistant", content:note.answer ? note.answer.lead : "" }, ...note.thread.map(t => ({ role:t.role, content:t.text, quote:t.quote || null }))];
    Object.assign(this, { base:this.msgs.length, noteId:note.id, noteSource:d.sourceCatalogId, fromNote:note.quote, noteTitle:`‘${note.quote}’ 카드` });
    this.open();
  },
  openTalk(d, note){
    this.reset(true);
    this.msgs = note.thread.map(t => ({ role:t.role, content:t.text, quote:t.quote || null, page:t.role === "user" ? t.page : undefined }));
    Object.assign(this, { base:0, noteId:note.id, noteSource:d.sourceCatalogId, noteTitle:note.quote });
    this.open();
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
      putNote(c.d, note); ui.bump();
      // The window's title already shows the note; no toast or re-render (it pulled the screen away mid-question).
    }catch{ /* the answer is already on screen; saving is retried with the next turn */ }
  },
  async send(text){
    const q = String(text ?? this.input).trim() || (this.quote ? "이 부분 설명해 줘" : ""); if (!q || this.busy) return;
    const c = this.context();
    if (!c) return;
    if (!ask){ this.err = "질문 답변은 아직 연결하지 않았어요. 유료 호출이라 확인을 받은 뒤 붙일 예정이에요."; ui.bump(); return; }
    if (S.session) S.session.viewed.add(c.d.id + ":" + c.page);   // asking about a page during practice counts as help
    this.input = ""; this.err = "";
    if (this.noteId && this.noteSource !== c.d.sourceCatalogId) this.reset(true);   // another material: a new conversation
    this.msgs.push({ role:"user", content:q, page:c.page, quote:this.quote });
    this.quote = null;
    const reply = { role:"assistant", content:"", page:c.page }; this.msgs.push(reply);
    this.busy = true; this.ctl = new AbortController(); ui.bump();
    const history = this.msgs.slice(0, -1).slice(-12).map(m => ({ role:m.role, content: m.role === "user" ? `${m.page ? `(p.${m.page}를 보며) ` : ""}${m.quote ? `[원문 인용] “${m.quote}”\n` : ""}${m.content}` : m.content })).filter(m => m.content);
    const ctext = await pageText(c.d, c.page);
    const turns = [{ role:"user", content:this.prompt(c, ctext, promptOf("chat")) }, ...history];
    try{
      await ask(turns, { ...(picturePage(c.d, ctext) ? { pageImage:{ sourceId:c.d.sourceCatalogId, page:c.page } } : {}), signal:this.ctl.signal, onText: ({ text }) => { reply.content = text; ui.bump(); } });
      const sp = splitNext(reply.content); reply.content = sp.body; reply.next = sp.next;
      if (JSON.stringify(reply.content).includes("$") && !katexLib){ await ensureKatex(); }
      this.saveTalk(c);
    }catch(e){
      if (e && e.text) reply.content = shown(e.text);
      if (!(e && e.code === "cancelled")) this.err = sampleErrorCopy(e);
      if (!reply.content) this.msgs.pop();
    }finally{ this.busy = false; this.ctl = null; ui.bump(); }
  },
  stop(){ if (this.ctl) this.ctl.abort(); },
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
    const res = await notesApi.ask({ sourceId:d.sourceCatalogId, page, quote, sentence, pageText:text, title:d.title, purpose:d.purpose || null, style: promptOf("ask") || null });
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
  try{ putNote(d, await notesApi.follow({ sourceId:d.sourceCatalogId, noteId:note.id, question:q, pageText: await pageText(d, note.page), title:d.title, style: promptOf("follow") || null })); }
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
// 11/11 React로: 고른 글 메뉴는 reader/ReaderOverlays.tsx가 그린다. 여기는 무엇을 골랐는지(NT.sel)와 누를 것들.
let selTimer = null;
function hideSel(){ if (NT.sel){ NT.sel = null; ui.bump(); } }
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
function selActions(){
  const info = NT.sel; if (!info) return [];
  const d = S.decks[info.deckId]; if (!d) return [];
  const canNote = notesOn(d), chatOpen = Chat.isOpen() || Chat.docked;
  const known = canNote ? findPhrase(d, info.text) : null;
  const anchor = { deckId:d.id, page:info.page, yRatio:info.yRatio };
  const clear = () => { try{ window.getSelection().removeAllRanges(); }catch(e){} };
  const out = [];
  if (canNote){
    out.push(known && known.status === "answered"
      ? { label:"저장된 답 보기", run: () => { clear(); hideSel(); openNote(d, known.id, true); } }
      : { label:"물어보기", key:"Enter", run: () => { clear(); askPhrase(d, info.page, info.text, anchor); } });
    if (!known) out.push({ label:"모름 표시", title:"답은 나중에, 모른다는 표시만", run: () => { clear(); markPhrase(d, info.page, info.text); } });
  }
  if (chatOpen) out.push({ label:"질문 창에 넣기", run: () => { clear(); hideSel(); Chat.quoteIn(info.text); } });
  return out;
}
function showSel(){
  const info = readSelection(); if (!info){ hideSel(); return; }
  const d = S.decks[info.deckId]; if (!d) return;
  if (!notesOn(d) && !(Chat.isOpen() || Chat.docked)){ hideSel(); return; }
  const r = info.rect, below = r.top < 64;
  NT.sel = { ...info, below, x:Math.min(Math.max(r.left + r.width / 2, 110), innerWidth - 110), y: below ? r.bottom + 8 : r.top - 8 };
  ui.bump();
}
on(document, "mouseup", (e) => { if (e.target.closest && e.target.closest(".selpop")) return; setTimeout(showSel, 0); });
on(document, "selectionchange", () => {
  clearTimeout(selTimer);
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed){ const pop = document.querySelector(".selpop"); if (NT.sel && !(pop && pop.matches(":hover"))) hideSel(); return; }
  if (matchMedia("(hover:none)").matches) selTimer = setTimeout(showSel, 450);   // touch: no mouseup after handles move
});
on(window, "scroll", () => { if (NT.sel) hideSel(); }, { passive:true });
on(document, "keydown", (e) => {
  if (!NT.sel || e.isComposing) return;
  if (e.key === "Escape"){ hideSel(); return; }
  if (e.key === "Enter"){ const a = selActions()[0]; if (a){ e.preventDefault(); a.run(); } }
});

/* 답 카드·모르는 것 서랍은 11/11 React로(reader/NoteCard.tsx, reader/NotesDrawer.tsx). */
/* 목차 (서랍의 두 번째 탭): the material's own AI outline from generation — unit → part → goal — with where I got stuck.
   Red dot = 모르는 것 notes on those pages; "틀림" = a weak goal. Old-flow materials (no outline) list goals by page. */
function unitState(d, sec){
  const p = pendingOf(d), out = p && p.pending.outline;
  if (!Array.isArray(out)) return null;
  return out.find(u => u.title === sec.title && (u.pages || [])[0] === (sec.pages || [])[0]) || null;
}
/* 목차에 그릴 값: 구역 → 묶음 → 목표 */
function tocView(d){
  const R = S.reader, notes = noteList(d), hidden = new Set(d.hidden || []);
  const notesIn = (pages) => { const set = new Set(pages); return notes.filter(n => set.has(n.page)).length; };
  const span = (pages) => pages.length ? (pages.length > 1 && pages.at(-1) !== pages[0] ? `p.${pages[0]}–${pages.at(-1)}` : `p.${pages[0]}`) : "";
  const here = (pages) => pages.includes(R.page);
  const goal = (o) => { const st = objectiveState(d, o.id), pages = (o.pages || []).slice().sort((a, b) => a - b);
    return { kind:"goal", id:o.id, text:o.statement, here:here(pages), weak:st === "weak", notes:notesIn(pages), span:span(pages), page:pages[0] || R.page }; };
  const outline = Array.isArray(d.outline) && d.outline.length ? d.outline : null;
  if (!outline) return { flat: d.objectives.filter(o => !hidden.has(o.id)).slice().sort((a, b) => (a.pages[0] || 0) - (b.pages[0] || 0)).map(goal), secs:[] };
  return { flat:null, secs: outline.map(sec => {
    const objs = sec.objectives.filter(o => !hidden.has(o.id));
    const allPages = [...new Set([...(sec.pages || []), ...objs.flatMap(o => o.pages || [])])].sort((a, b) => a - b);
    const unit = unitState(d, sec);
    const parts = []; const byPart = new Map();
    for (const o of objs){ const k = o.part || ""; if (!byPart.has(k)){ byPart.set(k, []); parts.push(k); } byPart.get(k).push(o); }
    return { title:sec.title, in:here(allPages), page:allPages[0] || R.page, span:span(allPages), notes:notesIn(allPages), weak:objs.some(o => objectiveState(d, o.id) === "weak"),
      unit: unit && UNIT_LABEL[unit.state] ? { label:UNIT_LABEL[unit.state], held:unit.state === "held" } : null, heldN: unit && unit.state === "ready" && unit.held ? unit.held : 0,
      parts: parts.map(k => { const list = byPart.get(k); const pp = [...new Set(list.flatMap(o => o.pages || []))].sort((a, b) => a - b);
        return { name:k, in:here(pp), page:pp[0] || R.page, span:span(pp), notes:notesIn(pp), weak:list.some(o => objectiveState(d, o.id) === "weak"), goals:list.map(goal) }; }) };
  }) };
}
/* 모르는 것 서랍: ✕, Esc, or a click anywhere outside it closes it */
function closeDrawer(){ if (!NT.drawer) return; NT.drawer = false; if (S.view === "read") render(); else ui.bump(); }
on(document, "keydown", (e) => {
  if (e.key !== "Escape" || e.isComposing) return;
  if (PS.open){ e.preventDefault(); PS.open = false; ui.bump(); return; }
  if (TM.open){ e.preventDefault(); TM.open = false; ui.bump(); return; }
  if (NT.drawer){ e.preventDefault(); closeDrawer(); }
});
on(document, "pointerdown", (e) => {
  if (!NT.drawer || !e.target.closest) return;
  if (e.target.closest("#notesDrawer, [data-notes-toggle], .ncard, .notecard, .selpop, .chatwin")) return;
  closeDrawer();
});
/* Chat-style answers: paragraphs, **bold**, `code`, # headings, - / 1. lists and | tables |, with $…$ math inside.
   A line starting with "원문 밖 설명:" is marked as outside the material. */
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
/* 11/11 한 장 정리를 React로(workspace/OnePageSummary.tsx): renderSummary와 같은 값. */
const summaryApi = {
  snapshot(){
    const all = Object.values(S.decks).filter(d => !d.pending);
    const mats = all.filter(d => !d.example).sort(byTitle);
    if (S.sum.deckId && !S.decks[S.sum.deckId]) S.sum.deckId = "";
    const decks = S.sum.deckId ? [S.decks[S.sum.deckId]] : mats;
    let total = 0, weak = 0, fresh = 0;
    const per = decks.map(d => {
      const secs = summarySections(d);
      const st = new Map(); let asked = new Map();
      if (planner){ try{ const list = (NT.src[d.sourceCatalogId] && NT.src[d.sourceCatalogId].list) || []; for (const id of planner.asked(d, list.map(n => ({ page:n.page, quote:n.quote, askedAt:n.askedAt, kind:n.kind })))) asked.set(id, list.filter(n => (d.objectives.find(o => o.id === id)?.pages || []).includes(n.page)).map(n => n.quote)); }catch(e){ asked = new Map(); } }
      for (const sec of secs) for (const o of sec.objectives){ const v = objectiveState(d, o.id); st.set(o.id, v); total++; if (v === "weak") weak++; else if (v === "new") fresh++; }
      const supportN = (d.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").length;
      const coreOnly = !!(S.plan.prefs && S.plan.prefs.detail && S.plan.prefs.detail[planKey(d)] === "core");
      let gaps = [];
      if (Array.isArray(d.outline) && d.outline.length){
        const covered = new Set(d.outline.flatMap(sec => sec.objectives).flatMap(o => o.pages || []));
        gaps = [...new Set(d.outline.flatMap(sec => sec.pages || []))].filter(n => !covered.has(n)).sort((a, b) => a - b).slice(0, 40).map(n => ({ n, marked:S.gapMarks.has(d.id + ":" + n) }));
      }
      return { id:d.id, title:displayTitle(d), count:st.size, weak:[...st.values()].filter(v => v === "weak").length, supportN, coreOnly, gaps, readPage:d.lastPage || firstPage(d),
        secs: secs.map(sec => ({ title:sec.title, pages: sec.pages && sec.pages.length ? (sec.pages.length > 1 ? `p.${sec.pages[0]}–${sec.pages[sec.pages.length - 1]}` : `p.${sec.pages[0]}`) : "",
          objectives: sec.objectives.filter(o => !S.sum.weakOnly || st.get(o.id) === "weak" || asked.has(o.id)).map(o => ({ id:o.id, part:o.part || "", statement:o.statement, recall:o.recall || "", quote:o.quote || "",
            state:st.get(o.id) || "none", asked: asked.has(o.id) ? asked.get(o.id) : null, support:o.importance === "support", pages:o.pages || [],
            covered: S.sum.hide && !S.sum.shown.has(d.id + ":" + o.id) })) })).filter(sec => sec.objectives.length) };
    });
    return { any:all.length > 0, deckId:S.sum.deckId || "", mats:mats.map(d => ({ id:d.id, title:displayTitle(d) })), total, weak, fresh, weakQs:Math.min(weakList(decks).length, WEAK_MAX),
      weakOnly:!!S.sum.weakOnly, hide:!!S.sum.hide, decks:per, states:SUM_STATE };
  },
  pickDeck: (id) => { S.sum.deckId = id; S.sum.shown = new Set(); render(); },
  toggle: (key) => { S.sum[key] = !S.sum[key]; S.sum.shown = new Set(); render(); },
  weak: () => startWeak(""),
  print: () => window.print(),
  coreOnly: (id) => { const d = S.decks[id]; if (!d) return; const det = prefs().detail || (prefs().detail = {}); const on = det[planKey(d)] === "core";
    const supportN = (d.outline || []).flatMap(sec => sec.objectives).filter(o => o.importance === "support").length;
    if (on) delete det[planKey(d)]; else det[planKey(d)] = "core";
    ledger({ deck:d, signal: on ? "정리: 보조 목표 다시 넣기" : "정리: 핵심만", action: on ? "보조 목표 포함" : `보조 ${supportN}개 뺌`, cause:"지엽" });
    applyFilters(d); savePrefs(); },
  read: (id, page, oid) => openReader(id, page, oid),
  gap: (id, n) => { const d = S.decks[id]; if (!d) return; const key = id + ":" + n; if (S.gapMarks.has(key)){ openReader(id, n); return; }
    S.gapMarks.add(key); ledger({ deck:d, signal:`p.${n} 내용이 빠짐`, action:"빠뜨린 쪽으로 기록(다시 만들기 후보)", cause:"빠뜨림", detail:`p.${n}` }); toast(`p.${n}을 빠진 쪽으로 기록했어요. 다시 누르면 그 쪽을 열어요.`); render(); },
  reveal: (id, oid) => { S.sum.shown.add(id + ":" + oid); render(); },
};
/* 11/11 학습 기록을 React로(workspace/StudyRecords.tsx): renderRecords와 같은 값. */
const recordsApi = {
  snapshot(){
    const decks = Object.values(S.decks).filter(d => !d.pending).sort((a,b) => (a.example?1:0) - (b.example?1:0) || b.createdAt - a.createdAt);
    if (!decks.length) return null;
    if (!S.recordsDeck || !S.decks[S.recordsDeck]) S.recordsDeck = decks[0].id;
    const deck = S.decks[S.recordsDeck];
    const graded = deck.events.filter(e => e.kind === "submit" && !e.assisted && !e.gaveUp && !e.afterReading);
    const st = deck.items.map(it => itemStatus(deck, it));
    const cnt = (k) => st.filter(x => x === k).length;
    const t = now();
    const fixes = (S.patches && S.patches[deck.id]) || [];
    return { id:deck.id, decks:decks.map(d => ({ id:d.id, title:displayTitle(d) })), deleting:S.deleting === deck.id, example:!!deck.example, engine:!!engine,
      counts:{ good:cnt("recent") + cnt("steady"), review:cnt("review"), assisted:cnt("assisted"), read:cnt("readcheck"), fresh:cnt("new") },
      acc: graded.length ? Math.round(graded.filter(e => e.correct).length / graded.length * 100) : null, graded:graded.length,
      rows: deck.items.map((it, idx) => {
        const o = deck.objectives.find(x => x.id === it.objectiveId);
        const evs = deck.events.filter(e => e.item === it.id && e.kind !== "reveal" && e.kind !== "report").slice(-14);
        const sc = deck.sched[it.id]; const status = STATUS[st[idx]];
        return { id:it.id, title:o ? o.statement : it.prompt, page:it.page, format:FORMAT_LABEL[it.format], objectiveId:it.objectiveId || "", status:status.label, cls:status.cls,
          trail: evs.map(e => { const ok = e.kind === "submit" ? e.correct : e.rating === "remembered"; return { cls: e.assisted ? "h" : e.afterReading ? (ok ? "c" : "r") : e.kind === "rate" ? (ok ? "s" : "r") : ok ? "g" : "r", t:new Date(e.t).toLocaleString("ko-KR") }; }),
          next: sc && sc.seen ? (sc.due <= t ? "지금" : fmtWhen(sc.due)) : "–" };
      }),
      hidden: deck.objectives.filter(o => (deck.hidden || []).includes(o.id)).map(o => ({ id:o.id, statement:o.statement, pages:o.pages.join(",") })),
      reported: (deck.allItems || []).filter(it => deck.reported && deck.reported[it.id]).map(it => ({ id:it.id, prompt:it.prompt, page:it.page, reason:deck.reported[it.id].reason })),
      fixes: fixes.map(f => { const it = (deck.allItems || []).find(x => x.id === f.itemId); return { id:f.id, label: f.kind === "accept" ? `정답 추가 · ${f.answer}` : "떠올리기 카드로",
        at:new Date(f.at).toLocaleString("ko-KR", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }), prompt: it ? it.prompt.slice(0, 160) : "" }; }) };
  },
  pick: (id) => { S.recordsDeck = id; S.deleting = null; render(); },
  askReset: (on) => { S.deleting = on ? S.recordsDeck : null; render(); },
  reset: () => { const deck = S.decks[S.recordsDeck]; deck.events = []; deck.sched = {}; Store.save(deck); S.deleting = null; render(); },
  read: (page, oid) => openReader(S.recordsDeck, page, oid),
  unhide: (oid) => { const deck = S.decks[S.recordsDeck]; deck.hidden = deck.hidden.filter(x => x !== oid); applyFilters(deck); Store.save(deck); render(); },
  unreport: (iid) => { const deck = S.decks[S.recordsDeck]; delete deck.reported[iid]; applyFilters(deck); Store.save(deck); render(); },
  remake: () => remakeReported(S.decks[S.recordsDeck]),
  unpatch: async (fid) => { const deck = S.decks[S.recordsDeck]; const f = ((S.patches && S.patches[deck.id]) || []).find(x => x.id === fid); if (!f) return;
    try{ await env.quality.unpatch(deck.id, f.id, { at:stamp(), deck:deck.title, item:f.itemId, signal:"고친 것 되돌리기", action: f.kind === "accept" ? `정답 추가 취소 ${f.answer}` : "카드 전환 취소", cause: f.kind === "accept" ? "인정답안누락" : "형식선택" });
      toast("되돌렸어요."); loadPatchList(); await reloadDecks(); render(); }catch(e){ toast("되돌리지 못했어요."); } },
};
/* ----- records ----- */
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
/* 목적(핵심 암기·이해·통암기) 고르기는 11/9 사용자 결정으로 뺐다. 엔진에는 기본 core로 간다. */
/* 기출 고르기는 11/8 사용자 "기출분석 기능은 없애자"로 뺐다(엔진의 pastExamSourceIds는 남아 있지만 화면에서 고를 수 없다). */
// 문제도 바로 만들기 (11/6 사용자 "문제 만들기 자동으로 바로 만들기 걸고 수동 체크 가능하게"): on by default, the last choice remembered.
/* 11/8 사용자 "문제 만들기는 당분간 수동으로, 자동으로 만들지 않게": 기본은 꺼짐(지식까지만, 문제는 자료 지도의 [문제 만들기]).
   예전 열쇠(dejipgi.autoQuestions)에 켜짐이 남아 있어도 따르지 않게 새 열쇠를 쓴다. 켜기는 체크 상자로 그대로. */
function freshBuilder(){ return { pages:[], sourceName:"", from:1, to:1, purpose:"core", note:"", readImages:true, deep:false, deepFast:false, autoQuestions:false, lecture:false, engine:"recaller", survey:{}, busy:false, status:"", error:"", file:null, pdfDoc:null, sections:[], picked:[], pastExamSourceIds:[], pastExamSources:null, pastExamOpen:false }; }
/* Range picking without any AI call: the PDF's own bookmarks, or each page's first line when it has none. */

/* 저장한 웹 글 → 자료 (11/9 사용자 "자료로 합쳐", 글만일 때): 서버가 글을 PDF로 인쇄해(Recaller 앱의 인쇄 창) 돌려주면
   그 PDF를 고른 것처럼 읽는다. 그 뒤는 PDF와 같다. 이미지 포함은 확장 프로그램이 페이지를 PDF로 뽑는다(아직). */

/* pending material: readable now, questions later */
function pendingDeck(rec){
  return { id:rec.id, pending:rec, title:rec.title, sourceName:rec.sourceName, sourceCatalogId:rec.sourceId, pageCount:rec.pageCount,
    createdAt:rec.createdAt, example:false, items:[], allItems:[], objectives:[], pages:[], events:[], sched:{}, hidden:[], reported:{}, lastPage:rec.lastPage || 0, skipped:[] };
}
function savePending(){ Store.savePending(Object.values(S.decks).filter(d => d.pending).map(d => ({ ...d.pending, outline:undefined, knowledge:undefined, making:undefined, lastPage:d.lastPage }))); }
/* 만들면서 바로 읽기: the material being made that this deck is (the pending deck itself, or the real deck its first units became). */
function pendingOf(d){
  if (!d) return null;
  if (d.pending) return d;
  return Object.values(S.decks).find(x => x.pending && x.pending.artifactId === d.id && x.pending.status !== "ready") || null;
}
/* The plan's outline and goals show on the pending deck before any question exists (목차, 이 쪽의 목표). */
function applyPendingOutline(d){
  const out = d.pending.outline;
  if (!Array.isArray(out) || !out.length) return;
  d.outline = out.map(sec => ({ title:sec.title, pages:sec.pages, objectives:sec.objectives }));
  d.objectives = out.flatMap(sec => sec.objectives.map(o => ({ ...o, pages:(o.pages && o.pages.length ? o.pages : sec.pages) })));
}
/* The unit the learner is on goes first in the making queue. */
let focusTimer = null, focusSent = "";
function tellFocus(){
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    const d = S.decks[S.reader.deckId], p = pendingOf(d);
    if (!p || !engine || !engine.focus || !["running", "authoring", "confirm", "waiting"].includes(p.pending.status)) return;
    const k = p.pending.requestId + ":" + S.reader.page; if (k === focusSent) return;
    focusSent = k; engine.focus(p.pending.requestId, S.reader.page).catch(() => {});
  }, 1200);
}
const UNIT_LABEL = { waiting:"만들 차례", making:"만드는 중", held:"보류" };
/* 새 자료 넣기(React, NewMaterial.tsx)의 [기억 정리 시작]: 바닐라 startMaterial과 같은 일을 화면이 고른 값으로. 실패하면 던져서 화면이 보여 준다. */
async function startFromNewMaterial(o, doc){
  if (!engine) throw new Error("이 화면에서는 생성 요청을 보낼 수 없어요.");
  const res = await engine.start({ file:o.file, from:o.from, to:o.to, purpose:o.purpose, note:o.note, readImages:o.readImages, ...(o.engine !== "v2" ? { engine:o.engine } : {}),
    ...(o.engine === "recaller" ? { autoQuestions:o.autoQuestions !== false, ...(o.lecture ? { lecture:true } : {}) } : {}), ...(o.engine === "recaller" && o.deep ? { deep:true, ...(o.deepFast ? { deepDrafts:2 } : {}) } : {}),
    ...((o.engine === "v5" || o.engine === "alpha") && Object.values(o.survey || {}).some(Boolean) ? { survey:o.survey } : {}) });
  const rec = { id:"pending:" + res.requestId, requestId:res.requestId, sourceId:res.sourceId, title:o.sourceName.replace(/\.pdf$/i, ""), sourceName:o.sourceName,
    pageCount:o.pageCount, from:o.from, to:o.to, purpose:o.purpose, note:o.note, createdAt:now(), status:"waiting", message:"" };
  const deck = pendingDeck(rec);
  S.decks[deck.id] = deck;
  if (doc) S.pdf[deck.id] = { status:"ready", doc, canv:{}, aspect: await docAspect(doc) };
  savePending();
  // 다음에 열 때는 빈 화면부터: 새 자료 넣기 화면을 새로 만든다.
  S.createKey = (S.createKey || 0) + 1;
  const toMap = env.mountView && /^(pending:)?gen_/.test(deck.id);
  toast(toMap ? "기억 정리를 시작했어요. 정리되는 대로 자료 지도에 채워져요." : "문제 만들기를 시작했어요. 그동안 읽어 두세요.");
  if (toMap){ setView("practice"); render(); MaterialMapView.open(deck); } else openReader(deck.id, rec.from);
  pollPending();
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
const PENDING_LABEL = { waiting:"시작 대기", running:"자료 파악 중", confirm:"목표 확인 필요", paused:"잠시 멈춤", authoring:"문제 만드는 중", cards:"기억 정리됨", ready:"준비됨", failed:"실패" };
let pollTimer = null;
async function pollPending(){
  clearTimeout(pollTimer);
  if (disposed || !engine) return;
  // "cards": knowledge organized, no questions until the learner asks (문제 만들기 starts polling again).
  const list = Object.values(S.decks).filter(d => d.pending && d.pending.status !== "failed" && d.pending.status !== "cards");
  if (!list.length) return;
  let changed = false, ready = false, grew = false;
  for (const d of list){
    let next;
    try{ next = await engine.check(d.pending.requestId); }
    catch(e){ next = { status:d.pending.status, message:(e && e.message) || "상태를 확인하지 못했어요." }; }
    if (disposed) return;
    if (next.status !== d.pending.status || (next.message || "") !== d.pending.message) changed = true;
    const outSig = JSON.stringify(next.outline || null);
    if (outSig !== JSON.stringify(d.pending.outline || null)){ changed = true; d.pending.outline = next.outline; applyPendingOutline(d); }
    if (next.knowledge) d.pending.knowledge = next.knowledge;
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
/* 문제 만들기 (사용자 10/30): a material made without questions ("cards") goes on to them; true once started. */
async function makeQuestions(d){
  const pd = pendingOf(d); if (!pd || !engine || !engine.questions) return false;
  const p = pd.pending; if (p.making) return false;
  p.making = true; render();
  try{
    await engine.questions(p.requestId);
    Object.assign(p, { status:"authoring", message:"문제 만드는 중" });
    savePending(); pollPending();
    toast("문제를 만들기 시작했어요. 만들어지는 대로 연습에 붙어요.");
    return true;
  }catch(e){ toast((e && e.message) || "문제 만들기를 시작하지 못했어요."); return false; }
  finally{ p.making = false; render(); }
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
    syncSubjects();
  }, (e) => {
    if (disposed) return;
    if (!Object.keys(S.decks).length){ const ex = exampleDeck(); Store.restore(ex); S.decks[ex.id] = ex; }
    S.lib = { status:"error", error:(e && e.message) || "Recaller 문제를 불러오지 못했어요." };
  }).then(() => { if (!disposed && !S.session) render(); });
}
Store.init();
S.plan = Store.plan();
for (const rec of Store.pendingList()) if (rec && rec.id && rec.requestId) S.decks[rec.id] = pendingDeck(rec);
// 11/11 화면은 전부 React 한 덩어리(StudyApp.tsx)가 #app에 그린다. 메뉴 탭·머리 단추·알림도 거기서.
const stopApp = env.mountApp(document.getElementById("app"), { ui, api:shellApi });
render();
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
const firstLoad = reloadDecks().then(() => { if (!disposed) for (const d of realDecks()) loadNotes(d); });
loadPatchList();
// Bring in records saved on another computer, then send this browser's records back.
const pulled = Store.pull().then((changed) => {
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
// The one-time tidy needs both this browser's and the other computer's records, so it waits for the two.
// Only a browser that has been studied in decides by itself (a fresh browser has no records and would put everything away).
const hasRecords = () => Object.entries(Store.all()).some(([k, v]) => k !== Store.PLAN && v && Array.isArray(v.events) && v.events.length);
Promise.all([firstLoad, pulled]).then(() => { if (!disposed && Store.mode === "local" && !tidyDone() && hasRecords()) tidyExperiments(true); }, () => {});

return () => {
  disposed = true;
  listeners.abort();
  if (Chat.ctl) Chat.ctl.abort();
  clearTimeout(pollTimer);
  for (const P of Object.values(S.pdf)) if (P.doc) P.doc.destroy();
  clearInterval(TB.timer); clearTimeout(toastTimer);
  MaterialMapView.close();
  try{ stopApp(); }catch(e){}
  delete root.dataset.view;
};
}
