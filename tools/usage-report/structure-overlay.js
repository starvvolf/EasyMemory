// 구조도 위 실시간 작업 표시 (2026-11-02 A). 토큰 사용량 서버가 협업/구조도/구조도.html을 /structure로 내줄 때 끝에 붙인다.
// 칸(g.hit[data-k])마다: 지금 고쳐지는 파일 수 · 누가 · 몇 분 전, 겹침(빨강)·누가인지 모름(노랑)·고치는 중(파랑) 테두리.
// 칸을 누르면 원래 세부 구조 위에 "지금 이 칸에서 고치는 것" 목록이 나온다. 모델 호출 없음, 5초마다 /work.json.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const css = document.createElement("style");
  css.textContent = `
    .wk-ring{fill:none;stroke-width:3;pointer-events:none}
    .wk-ring.busy{stroke:#3e8bd6}.wk-ring.warn{stroke:#d39e00;stroke-dasharray:7 4}.wk-ring.bad{stroke:#e5484d}
    .wk-badge rect{rx:9}.wk-badge text{font:600 12px system-ui,"Malgun Gothic",sans-serif;fill:#fff}
    .wk-badge.busy rect{fill:#3e8bd6}.wk-badge.warn rect{fill:#b98600}.wk-badge.bad rect{fill:#e5484d}
    #wk-panel{margin:12px 0;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);font-size:13.5px;line-height:1.5}
    #wk-panel h3{margin:0 0 6px;font-size:14px}#wk-panel .m{opacity:.7}#wk-panel ul{margin:4px 0 0;padding-left:18px}
    #wk-panel .f{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
    #wk-panel .bad{color:#e5484d;font-weight:600}#wk-panel .warn{color:#b98600}#wk-panel .info{opacity:.75}
    #wk-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12.5px;margin:6px 0}
    #wk-top i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}`;
  document.head.append(css);
  const svg = document.querySelector(".canvas svg");
  const hint = document.querySelector(".hint");
  const top = document.createElement("div"); top.id = "wk-top";
  top.innerHTML = `<b>실시간 작업</b><span><i style="background:#3e8bd6"></i>고치는 중</span><span><i style="background:#d39e00"></i>누가인지 모름</span><span><i style="background:#e5484d"></i>겹침</span><span id="wk-when" class="m"></span>`;
  svg?.parentElement?.before(top);
  const panel = document.createElement("section"); panel.id = "wk-panel"; panel.setAttribute("aria-live", "polite");
  (hint || svg?.parentElement)?.after(panel);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mins = (m) => m == null ? "" : m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
  let data = null;
  // 칸마다 첫 상자(그 칸 이름이 있는 상자)에 꼬리표, 그 칸의 모든 상자에 테두리
  const groups = new Map();
  document.querySelectorAll(".hit[data-k]").forEach((g) => { const k = g.dataset.k; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); });
  const layer = document.createElementNS(NS, "g"); layer.setAttribute("id", "wk-layer"); svg?.append(layer);
  function paint() {
    if (!data || !svg) return;
    layer.replaceChildren();
    for (const [k, gs] of groups) {
      const n = data.nodes[k]; if (!n || (!n.count && !n.affected?.length)) continue;
      const lvl = n.count ? n.level : "warn";
      for (const g of gs) {
        const r = g.querySelector("rect"); if (!r) continue;
        const ring = document.createElementNS(NS, "rect");
        for (const a of ["x", "y", "width", "height", "rx"]) ring.setAttribute(a, r.getAttribute(a) || "0");
        ring.setAttribute("x", Number(r.getAttribute("x")) - 3); ring.setAttribute("y", Number(r.getAttribute("y")) - 3);
        ring.setAttribute("width", Number(r.getAttribute("width")) + 6); ring.setAttribute("height", Number(r.getAttribute("height")) + 6);
        ring.setAttribute("class", `wk-ring ${lvl}`); layer.append(ring);
      }
      const r = gs[0].querySelector("rect"); if (!r) continue;
      const who = n.who.length ? n.who.join("·") : "?";
      const label = n.count ? `${who} · ${n.count}개 · ${mins(n.lastMin)}${n.affected?.length ? " · 약속↯" : ""}` : `영향: ${n.affected.join(", ")}`;
      const w = Math.min(260, 16 + [...label].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 12.5 : 7), 0)), x = Number(r.getAttribute("x")) + Number(r.getAttribute("width")) - w + 6, y = Number(r.getAttribute("y")) - 14;
      const b = document.createElementNS(NS, "g"); b.setAttribute("class", `wk-badge ${lvl}`);
      b.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="22"></rect><text x="${x + 8}" y="${y + 15}">${esc(label)}</text>`;
      const t = document.createElementNS(NS, "title"); t.textContent = [...n.files, ...(n.affected?.length ? [`약속 파일 영향: ${n.affected.join(", ")}`] : [])].join("\n"); b.append(t);
      layer.append(b);
    }
    const when = document.getElementById("wk-when");
    if (when) when.textContent = `· ${new Date(data.at).toLocaleTimeString("ko-KR")} 기준 · 커밋 안 된 파일 ${data.files.length}개${data.locks.length ? ` · git 잠금 ${data.locks.length}` : ""}`;
    panelFor(location.hash.slice(1) || "");
  }
  function panelFor(k) {
    if (!data) return;
    const n = data.nodes[k];
    if (!n) {
      const busy = Object.entries(data.nodes).filter(([, x]) => x.count).map(([id, x]) => `${x.name} ${x.count}`);
      panel.innerHTML = `<h3>지금 고쳐지는 곳</h3><p class="m">${busy.length ? esc(busy.join(" · ")) : "구조도 칸에 속한 파일 중 커밋 안 된 것이 없어요."} 칸을 누르면 파일 목록이 나와요.</p>`;
      return;
    }
    const files = data.files.filter((f) => f.nodes.includes(k));
    const contracts = data.contracts.filter((c) => c.nodes.includes(k) && c.changed);
    panel.innerHTML = `<h3>지금 이 칸(${esc(n.name)})에서 고치는 것 · ${files.length}개</h3>` +
      (contracts.length ? `<p class="warn">약속 파일이 고쳐지는 중: ${contracts.map((c) => `${esc(c.name)}(${esc(c.file)})${c.who.length ? ` — ${esc(c.who.join("·"))}` : ""}`).join(", ")} — 이 칸도 영향을 받아요.</p>` : "") +
      (files.length ? `<ul>${files.map((f) => `<li><span class="f">${esc(f.path)}</span> <span class="m">${esc(f.status)} · +${f.plus} −${f.minus} · ${mins(f.ageMin)} · 영역 ${esc(f.area)}</span>` +
        ` · ${f.claims.length ? esc(f.claims.map((c) => `${c.label}${c.session ? ` (${c.session})` : ""}`).join(", ")) : '<span class="warn">누가인지 모름</span>'}` +
        f.flags.filter((x) => x.text !== "누가 고치는지 모름").map((x) => ` <span class="${x.level}">${esc(x.text)}</span>`).join("") + `</li>`).join("")}</ul>` : `<p class="m">커밋 안 된 파일이 없어요.</p>`);
  }
  window.addEventListener("hashchange", () => panelFor(location.hash.slice(1)));
  async function poll() {
    try { data = await (await fetch("/work.json", { cache: "no-store" })).json(); paint(); } catch { /* server gone: keep the last picture */ }
  }
  poll(); setInterval(poll, 5000);
})();
