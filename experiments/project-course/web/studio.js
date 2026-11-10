// 앱 안 편집기(2026-11-11 사용자 "기존 방식 남기고 한번 도입해봐"): /studio.html?run=<id>
// 왼쪽: 그 실습 폴더를 연 VS Code(VSCodium 웹 서버판, 코스 서버가 4103에 켬) · 오른쪽: 지금 튜터 화면(?embed=1) 그대로.
// 처음이면 편집기를 받는 안내(파일 이름 · 받는 곳 · 크기)를 먼저 보이고, 학습자가 [받기]를 눌러야 받는다.
const q = new URLSearchParams(location.search);
const run = (q.get("run") || "").replace(/[^\w]/g, "");
const $ = (s) => document.querySelector(s);
const left = $("#left"), right = $("#right");
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
  return j;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const card = (html) => { left.innerHTML = `<div class="center"><div class="card">${html}</div></div>`; };
const mb = (n) => (n ? `${Math.round(n / 1048576)}MB` : "크기 확인 못 함");

// 오른쪽 튜터: VS Code 탭에 띄우던 것과 같은 화면
right.innerHTML = run ? `<iframe title="튜터" src="/?embed=1&theme=dark#/run/${run}" allow="clipboard-read; clipboard-write"></iframe>` : "";

// 가운데 줄 끌기(너비는 이 PC에 기억)
const W = "recaller.studio.tutorWidth";
try { const w = Number(localStorage.getItem(W)); if (w > 240) right.style.width = `${w}px`; } catch { /* */ }
const grip = $("#grip");
grip.addEventListener("pointerdown", (e) => {
  grip.setPointerCapture(e.pointerId); grip.classList.add("drag"); document.body.classList.add("drag");
  const move = (ev) => { const w = Math.min(Math.max(window.innerWidth - ev.clientX, 260), window.innerWidth - 320); right.style.width = `${w}px`; };
  const up = () => { grip.classList.remove("drag"); document.body.classList.remove("drag"); grip.removeEventListener("pointermove", move); try { localStorage.setItem(W, String(parseInt(right.style.width, 10))); } catch { /* */ } };
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up, { once: true });
});

$("#mine").onclick = async () => {
  try { const r = await api("POST", `/api/runs/${run}/editor`, { float: false }); $("#where").textContent = r.ok === false ? r.message : "내 VS Code에서 열었어요."; }
  catch (e) { $("#where").textContent = e.message; }
};

async function open() {
  if (!run) return card("<p class=\"err\">어느 실습인지 모르겠어요(주소에 run이 없어요).</p>");
  let st;
  try { st = await api("GET", "/api/editor-web"); } catch (e) { return card(`<p class="err">${esc(e.message)}</p>`); }
  if (!st.installed) return st.job && !["끝", "실패"].includes(st.job.phase) ? watch() : askInstall(st);
  try {
    const r = await api("POST", `/api/runs/${run}/editor-web`, {});
    $("#where").textContent = r.folder;
    left.innerHTML = `<iframe title="편집기" src="${esc(r.url)}" allow="clipboard-read; clipboard-write"></iframe>`;
  } catch (e) {
    card(`<h2>편집기를 켜지 못했어요</h2><p class="err">${esc(e.message)}</p><div class="row"><button class="btn primary" id="again">다시 켜기</button><button class="btn" id="mine2">내 VS Code로 열기</button></div>`);
    $("#again").onclick = open; $("#mine2").onclick = () => $("#mine").click();
  }
}
// 처음 한 번 받기: 무엇을 어디서 얼마나 받는지 보이고, 학습자가 눌러야 받는다
function askInstall(st) {
  card(`<h2>앱 안 편집기를 처음 한 번 받아요</h2>
    <p>VS Code와 같은 편집기(VSCodium, 오픈소스)를 이 PC에 받아 두고, 실습할 때 여기 왼쪽에 띄워요. 내 VS Code의 설정 · 확장과는 따로예요.</p>
    <p>파일 <code>${esc(st.asset)}</code> · ${mb(st.size)}<br>받는 곳 <code>${esc(st.source)}</code></p>
    <p>받은 뒤 Python 확장(실행 · 디버그)과 코드 찾기 확장도 Open VSX에서 같이 깔아요.</p>
    <div class="row"><button class="btn primary" id="get">받기</button><button class="btn" id="mine2">대신 내 VS Code로 열기</button></div>`);
  $("#get").onclick = async () => { try { await api("POST", "/api/editor-web/install", {}); watch(); } catch (e) { card(`<p class="err">${esc(e.message)}</p>`); } };
  $("#mine2").onclick = () => $("#mine").click();
}
async function watch() {
  for (;;) {
    let st;
    try { st = await api("GET", "/api/editor-web"); } catch { await new Promise((r) => setTimeout(r, 1500)); continue; }
    const j = st.job;
    if (st.installed && (!j || j.phase === "끝")) return open();
    if (j?.phase === "실패") {
      card(`<h2>받지 못했어요</h2><p class="err">${esc(j.error)}</p><div class="row"><button class="btn primary" id="retry">다시 받기</button><button class="btn" id="mine2">내 VS Code로 열기</button></div>`);
      $("#retry").onclick = async () => { await api("POST", "/api/editor-web/install", {}).catch(() => null); watch(); };
      $("#mine2").onclick = () => $("#mine").click();
      return;
    }
    const pct = j?.total ? Math.round((j.got / j.total) * 100) : 0;
    card(`<h2>편집기 받는 중</h2><p>${esc(j?.phase ?? "준비 중")}${j?.phase === "받는 중" && j.total ? ` · ${mb(j.got)} / ${mb(j.total)}` : ""}</p><div class="prog"><i style="width:${j?.phase === "받는 중" ? pct : 100}%"></i></div>`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
open();
