// Reads the article on the page (only when the Recaller panel asks) and passes on what the learner drags over.
(() => {
  if (window.__recallerContent) return;
  window.__recallerContent = true;

  /** The block with the most paragraph text: <article> when there is one, otherwise the densest container. */
  function articleRoot() {
    const articles = [...document.querySelectorAll("article")].filter((a) => a.innerText.length > 400);
    if (articles.length) return articles.sort((a, b) => b.innerText.length - a.innerText.length)[0];
    const scores = new Map();
    for (const p of document.querySelectorAll("p")) {
      const text = p.innerText.trim();
      if (text.length < 40) continue;
      for (let el = p.parentElement, depth = 0; el && depth < 3; el = el.parentElement, depth++) scores.set(el, (scores.get(el) || 0) + text.length / (depth + 1));
    }
    let best = document.body, top = 0;
    for (const [el, score] of scores) if (score > top) { top = score; best = el; }
    return best;
  }
  function readArticle() {
    const root = articleRoot();
    const skip = "nav, header, footer, aside, script, style, noscript, form, button, figure figcaption, [aria-hidden='true'], .ad, .ads, .advertisement, .comment, .comments";
    const parts = [];
    for (const el of root.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre, td")) {
      if (el.closest(skip)) continue;
      if (el.tagName === "LI" && el.closest("p")) continue;
      const text = el.innerText.replace(/\s+\n/g, "\n").trim();
      if (text.length < 2) continue;
      parts.push(/^H\d$/.test(el.tagName) ? `## ${text}` : el.tagName === "PRE" ? "```\n" + text + "\n```" : text);
    }
    const text = parts.join("\n\n").slice(0, 120000);
    const title = (document.querySelector("meta[property='og:title']") || {}).content || document.querySelector("h1")?.innerText || document.title;
    return { title: String(title).trim().slice(0, 300), url: location.href, text, selection: String(getSelection() || "").trim().slice(0, 4000) };
  }
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "getArticle") { reply(readArticle()); return true; }
    return false;
  });
  let timer = null;
  document.addEventListener("mouseup", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = String(getSelection() || "").trim();
      if (text.length >= 2 && text.length <= 4000) chrome.runtime.sendMessage({ type: "selection", text, url: location.href }).catch(() => undefined);
    }, 250);
  });
})();
