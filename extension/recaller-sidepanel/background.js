// Recaller 사이드바: the toolbar button opens the side panel; "Recaller에 물어보기" on a selection sends it there.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  chrome.contextMenus.create({ id: "recaller-ask", title: "Recaller에 물어보기", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "recaller-ask" || !tab) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  // The panel may still be opening: say it twice, a moment apart.
  const send = () => chrome.runtime.sendMessage({ type: "selection", text: info.selectionText || "", url: tab.url || "", ask: true }).catch(() => undefined);
  setTimeout(send, 300); setTimeout(send, 1200);
});
