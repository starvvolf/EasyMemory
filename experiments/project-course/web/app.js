// 프로젝트 코스 화면. 빌드 없이 도는 바닐라 JS.
// #/intake/<id> 코스 정하기 · #/run/<id> 코스 진행 · #/run/<id>/summary 결과
const $ = (s, el = document) => el.querySelector(s);
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
  chip.className = "chip " + (ai.mode === "off" ? "" : ai.used >= ai.limit ? "bad" : "acc");
  chip.textContent = ai.mode === "off" ? "AI 꺼짐 · 준비된 힌트" : ai.mode === "fake" ? "AI 가짜(시험용)" : `AI ${ai.used}/${ai.limit}회`;
  chip.title = ai.mode === "app" ? "앱(3000)과 같은 ChatGPT 로그인을 써요. 이 실험의 허용 횟수예요." : "";
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
    if ((m = /^#\/intake\/(\w+)/.exec(hash))) return await renderIntake(m[1]);
    if ((m = /^#\/run\/(\w+)\/summary/.exec(hash))) return await renderSummary(m[1]);
    if ((m = /^#\/run\/(\w+)\/cards/.exec(hash))) return await renderRun(m[1]);
    if ((m = /^#\/run\/(\w+)/.exec(hash))) return await renderRunOrLesson(m[1]);
    if (status?.active) return go(`#/run/${status.active}`);
    renderHome();
  } catch (e) {
    view.replaceChildren(h("div", { class: "empty" }, h("h1", {}, "열지 못했어요"), h("p", {}, e.message), h("button", { class: "btn", onclick: () => go("#/") }, "처음으로")));
  }
}
window.addEventListener("hashchange", route);

function renderHome() {
  view.replaceChildren(h("div", { class: "empty" },
    h("h1", {}, "무엇을 만들면서 배울지 정해 볼까요?"),
    h("p", {}, "몇 가지 묻고 짧은 확인 문제를 푼 뒤, 준비된 코스에서 어디부터 어떻게 할지 계획을 세워요."),
    h("div", { class: "row", style: "justify-content:center;margin-top:16px" },
      h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => { const it = await api("POST", "/api/intake", {}); go(`#/intake/${it.id}`); }) }, "코스 정하기 시작"),
      h("button", { class: "btn", onclick: (e) => busy(e.target, async () => { const it = await api("POST", "/api/intake", { mode: "script" }); go(`#/intake/${it.id}`); }) }, "AI 없이 정하기"))));
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
    if (m.ask && i === lastAskIdx && !it.confirmedRun) box.append(askCard(it, m.ask));
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
  if (ask.kind === "text") return null; // 아래 입력창으로 답한다
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
      h("div", { class: "mut small" }, "직접 하기: 예측 → 없애 보기 → VS Code에서 고치기 → 재검사. 빠르게: 예측만 하고 정답 코드로 넘어갈 수 있음. 건너뛴 단계의 코드는 완성된 상태로 받아요."),
      h("div", { class: "row" }, h("button", { class: "btn primary", onclick: (e) => busy(e.target, async () => {
        const out = await api("POST", `/api/intake/${it.id}/confirm`, { plan });
        toast("작업 폴더를 만들었어요.");
        go(`#/run/${out.runId}`);
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

/* =================== 수업 (대화) =================== */
let lessonCtx = null;
let events = null;
async function renderRunOrLesson(id) {
  const run = await api("GET", `/api/runs/${id}`);
  if (!run.lesson) return renderRun(id);
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

/** 튜터 글: **굵게**, `코드`, 목록, [[파일:줄]] → VS Code 링크 */
function rich(text, ws) {
  const box = h("div", { class: "rich" });
  let list = null;
  for (const line of String(text || "").split("\n")) {
    const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (m) {
      const ordered = /\d/.test(m[2]);
      if (!list || list.tagName !== (ordered ? "OL" : "UL")) { list = h(ordered ? "ol" : "ul"); box.append(list); }
      list.append(h("li", {}, inline(m[3], ws)));
      continue;
    }
    list = null;
    box.append(line.trim() ? h("p", {}, inline(line, ws)) : h("div", { class: "gap" }));
  }
  return box;
}
function inline(text, ws) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[\[([^\]:]+):(\d+)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h("strong", {}, m[1]));
    else if (m[2]) out.push(h("code", { class: "ic" }, m[2]));
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
  } }, h("span", { class: "fi" }, "⌗"), `${file} ${line}번째 줄`);
}

function flashSaved() {
  const b = $(".savebar");
  if (!b) return;
  b.classList.add("hit"); b.textContent = "저장을 봤어요";
  setTimeout(() => b.classList.remove("hit"), 1500);
}

function drawLesson() {
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
    }
    drawLesson();
  });

  const chat = h("div", { class: "lchat" });
  for (const m of msgs) {
    if (m.role === "note") { chat.append(h("div", { class: "lnote" }, m.text)); continue; }
    const row = h("div", { class: `lmsg ${m.role}` });
    if (m.role === "tutor") row.append(h("div", { class: "avatar" }, "R"));
    const col = h("div", { class: "lcol" });
    if (m.text) col.append(m.role === "me" ? h("div", { class: "bubble" }, m.text) : h("div", { class: "bubble" }, rich(m.text, ws)));
    if (m.card) col.append(lessonCard(m.card, run, lesson, send, ws));
    row.append(col);
    chat.append(row);
  }
  if (lesson.busy) chat.append(h("div", { class: "lmsg tutor" }, h("div", { class: "avatar" }, "R"), h("div", { class: "bubble typing" }, h("span"), h("span"), h("span"))));

  const input = h("input", { placeholder: "튜터에게 물어보기 — 예: 라우터가 뭐예요?", "aria-label": "튜터에게 물어보기" });
  const askBtn = h("button", { class: "btn primary", type: "submit" }, "물어보기");
  const form = h("form", { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ""; send({ do: "ask", text: t })({ target: askBtn }); } }, input, askBtn);
  const quick = h("div", { class: "quick" }, pending.map((a) => h("button", { class: `btn ${a.do === "hint" ? "" : "primary"}`, onclick: (e) => {
    if (a.do === "hint" && a.label.includes("정답") && !confirm("정답 줄을 볼까요? 이걸 본 뒤의 통과는 '직접 고침'으로 기록하지 않아요.")) return;
    send({ do: a.do })(e);
  } }, a.label)));
  const savebar = lesson.waiting === "save" ? h("div", { class: "savebar" }, h("span", { class: "pulse" }), "VS Code에서 고치고 저장하면 자동으로 확인해요") : null;

  const dev = lesson.dev || run.dev;
  const side = h("aside", { class: "lside" },
    h("div", { class: "lstage" }, h("span", { class: "chip acc" }, `${lesson.stage}단계`), h("h2", {}, lesson.title)),
    h("div", { class: "lprog" }, Array.from({ length: lesson.beats }, (_, i) => h("span", { class: i < lesson.beat ? "on" : i === lesson.beat ? "cur" : "" }))),
    h("div", { class: "lteach" }, h("div", { class: "mut small" }, "이번에 배울 것"), h("ul", {}, lesson.teach.map((t) => h("li", {}, t)))),
    h("div", { class: "lws" },
      h("div", { class: "mut small" }, "작업 폴더"),
      h("div", { class: "path" }, ws),
      h("div", { class: "row" },
        h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { const r = await api("POST", `/api/runs/${run.id}/editor`); toast(r.ok ? (r.message || "VS Code를 열었어요. 이 창 옆에 나란히 두면 편해요.") : r.message, 7000); }) }, "VS Code로 열기"),
        dev?.running
          ? h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/dev/stop`); lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`); drawLesson(); }) }, "서버 끄기")
          : h("button", { class: "btn small", onclick: (e) => busy(e.target, async () => { await api("POST", `/api/runs/${run.id}/dev/start`); lessonCtx.lesson = await api("GET", `/api/runs/${run.id}/lesson/${run.current}`); drawLesson(); }) }, "서버 켜기")),
      h("div", { class: "row small" }, dev?.running ? h("span", { class: "chip ok" }, "서버 켜짐 :4101") : h("span", { class: "chip" }, "서버 꺼짐"),
        lesson.bridge?.connected ? h("span", { class: "chip ok" }, "VS Code 연결됨") : h("span", { class: "chip", title: "[VS Code로 열기]를 누르면 연결 확장을 깔고 열어요" }, "VS Code 연결 안 됨")),
      lesson.bridge?.connected ? h("div", { class: "seeing small" }, lesson.bridge.file
        ? [h("span", { class: "mut" }, "튜터가 보는 곳 "), h("code", {}, `${lesson.bridge.file}:${lesson.bridge.line}`),
           lesson.bridge.selection ? h("span", { class: "mut" }, ` · ${lesson.bridge.selection.from}~${lesson.bridge.selection.to}줄 선택`) : null,
           lesson.bridge.dirty ? h("span", { class: "chip warn" }, "저장 안 함") : null,
           lesson.bridge.errors ? h("span", { class: "chip bad" }, `빨간 줄 ${lesson.bridge.errors}`) : null]
        : h("span", { class: "mut" }, "작업 폴더 밖 파일을 보고 있어요")) : null),
    h("div", { class: "lmore" },
      h("a", { href: `#/run/${run.id}/cards` }, "단계 카드 화면으로"),
      h("a", { href: `#/run/${run.id}/summary` }, "결과와 기록 후보")));

  const y = window.scrollY, atBottom = window.innerHeight + y >= document.body.scrollHeight - 80;
  view.replaceChildren(h("div", { class: "lesson" }, side, h("main", { class: "lmain" }, chat, h("div", { class: "lfoot" }, savebar, quick, form))));
  if (atBottom || !drawLesson.drawn) window.scrollTo({ top: document.body.scrollHeight });
  drawLesson.drawn = true;
}

function lessonCard(card, run, lesson, send, ws) {
  if (card.type === "choice") {
    const done = card.picked !== undefined;
    return h("div", { class: "lcard" }, h("div", { class: "opts" }, card.options.map((o, i) =>
      h("button", { class: `opt ${done ? (i === card.answer ? "right" : i === card.picked ? "wrong" : "") : ""}`, disabled: done, onclick: (e) => send({ do: "choice", choice: i })(e) }, o))));
  }
  if (card.type === "reply") {
    const head = card.timedOut ? "답장 없음 (3초 기다림)" : card.error ? `연결 실패: ${card.error}` : `${card.status}`;
    const cls = card.timedOut || card.error || card.status >= 500 ? "bad" : card.status >= 400 ? "warn" : "ok";
    return h("div", { class: "lcard reply" },
      h("div", { class: "rline" }, h("span", { class: "mut small" }, "보낸 편지"), h("code", {}, card.request)),
      h("div", { class: "rline" }, h("span", { class: "mut small" }, "답장"), h("span", { class: `chip ${cls}` }, head)),
      Object.keys(card.headers || {}).length ? h("pre", { class: "rbody mut" }, Object.entries(card.headers).map(([k, v]) => `${k}: ${v}`).join("\n")) : null,
      card.body ? h("pre", { class: "rbody" }, card.body) : null);
  }
  if (card.type === "code") return h("div", { class: "lcard code" }, h("div", { class: "mut small" }, fileLink(ws, card.file, card.from), card.to > card.from ? ` ~ ${card.to}번째 줄` : ""), h("pre", { class: "rbody" }, card.code));
  if (card.type === "check") return h("div", { class: "lcard" }, h("div", { class: "mut small" }, "확인 결과"), resultsList(card.result, { group: true }));
  if (card.type === "hint") return h("div", { class: "lcard hint" }, h("div", { class: "mut small" }, `힌트 ${card.level}단계 · ${card.source.startsWith("ai") ? "AI 튜터" : card.source === "solution" ? "준비된 정답 줄" : "준비된 힌트"}`), card.level === 3 ? h("pre", { class: "sol" }, card.text) : rich(card.text, ws));
  if (card.type === "explain") {
    if (card.done) return h("div", { class: "lcard" }, h("div", { class: "mut small" }, "내 설명"), card.done);
    const ta = h("textarea", { class: "explain", placeholder: "내 말로 짧게" });
    return h("div", { class: "lcard" }, ta, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn primary", onclick: (e) => { if (!ta.value.trim()) return toast("한 문장이라도 적어 주세요."); send({ do: "explain", text: ta.value })(e); } }, "적어 두기")));
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
