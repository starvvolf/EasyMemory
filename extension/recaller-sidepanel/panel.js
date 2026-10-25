// The panel shows Recaller's /ext page from the local server and passes messages between it and the page in the tab:
// the article on request, what the learner drags, and "the tab changed".
const ORIGIN = "http://127.0.0.1:3000";
const frame = document.getElementById("app");
const down = document.getElementById("down");

async function connect() {
  try {
    const res = await fetch(`${ORIGIN}/api/local-experiment/status`, { cache: "no-store" });
    const data = await res.json();
    if (!data.active) throw new Error("not local");
    down.style.display = "none"; frame.hidden = false;
    if (!frame.src) frame.src = `${ORIGIN}/ext`;
  } catch {
    frame.hidden = true; down.style.display = "block";
  }
}
document.getElementById("retry").addEventListener("click", connect);
connect();

const toFrame = (msg) => frame.contentWindow && frame.contentWindow.postMessage(msg, ORIGIN);
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }

window.addEventListener("message", async (event) => {
  if (event.origin !== ORIGIN || event.source !== frame.contentWindow) return;
  const msg = event.data || {};
  if (msg.type === "recaller:need-article") {
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) { toFrame({ type: "recaller:article", error: "이 탭은 읽을 수 없어요. 웹 글이 열린 탭에서 열어 주세요." }); return; }
    try { const article = await chrome.tabs.sendMessage(tab.id, { type: "getArticle" }); toFrame({ type: "recaller:article", ...article }); }
    catch { toFrame({ type: "recaller:article", error: "글을 읽지 못했어요. 탭을 새로 고침한 뒤 다시 시도해 주세요." }); }
  }
});
chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "selection") toFrame({ type: "recaller:selection", text: msg.text, url: msg.url, ask: Boolean(msg.ask) }); });
chrome.tabs.onActivated.addListener(() => toFrame({ type: "recaller:tab-changed" }));
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.status === "complete" && tab.active) toFrame({ type: "recaller:tab-changed" }); });
