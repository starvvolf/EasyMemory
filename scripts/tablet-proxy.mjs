// 태블릿 모드 (docs/DECISIONS.md 2026-10-18): the app stays bound to 127.0.0.1:3000. This small gate listens on the
// home network (port 3001) and passes requests through only for devices paired with a 6-digit code shown on the
// computer. Requests reach the app as if from the computer itself, so the gate must stay strict:
// - private network addresses only; paired devices only (token cookie, stored as a hash per computer);
// - the pairing API and the ChatGPT sign-in routes are never reachable through it.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

export const TABLET_PORT = 3001;
const COOKIE = "rc_tablet";
const BLOCKED = [/^\/api\/tablet(\/|$)/, /^\/api\/auth\/chatgpt(\/|$)/];

export const tabletDir = (projectRoot) => path.join(projectRoot, ".study-forge-data", "tablet");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 1)); renameSync(tmp, file); };

/** Private (home network) or loopback addresses; IPv4-mapped IPv6 included. */
export function privateAddress(address = "") {
  const a = address.replace(/^::ffff:/, "");
  if (a === "::1" || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return /^(fc|fd|fe80)/i.test(a);
}

function cookieOf(header = "", name) {
  for (const part of header.split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return v.join("="); }
  return null;
}
const withoutCookie = (header = "", name) => header.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith(`${name}=`)).join("; ");

export function pairedDevice(dir, token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const h = hash(token);
  return readJson(path.join(dir, "devices.json"), []).some((d) => d.hash === h);
}

/** Checks a pairing code (one active code, 10 minutes, 5 tries). Returns a new device token on success. */
export function redeemCode(dir, code, userAgent = "") {
  const file = path.join(dir, "code.json");
  const current = readJson(file, null);
  if (!current || Date.now() > current.expires || !/^\d{6}$/.test(String(code))) return null;
  const ok = timingSafeEqual(Buffer.from(hash(String(code))), Buffer.from(current.hash));
  if (!ok) {
    current.tries = (current.tries ?? 0) + 1;
    writeJson(file, current.tries >= 5 ? { ...current, expires: 0 } : current);
    return null;
  }
  writeJson(file, { ...current, expires: 0 });
  const token = randomBytes(32).toString("hex");
  const devices = readJson(path.join(dir, "devices.json"), []);
  devices.push({ hash: hash(token), name: String(userAgent).slice(0, 120), at: new Date().toISOString() });
  writeJson(path.join(dir, "devices.json"), devices.slice(-10));
  return token;
}

const page = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>되짚기 · 태블릿 연결</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F6;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#17191F}
.box{background:#fff;border-radius:18px;padding:28px 26px;width:min(380px,90vw);box-shadow:0 6px 24px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 6px}p{color:#666C78;font-size:14px;line-height:1.6;margin:0 0 16px}
input{width:100%;box-sizing:border-box;font-size:28px;letter-spacing:.35em;text-align:center;padding:12px;border:1px solid #CDD1D9;border-radius:12px}
button{margin-top:14px;width:100%;padding:13px;border:0;border-radius:12px;background:#3D4BE0;color:#fff;font-size:16px;font-weight:700}.err{color:#D23F28}</style></head>
<body><div class="box">${body}</div></body></html>`;
const pairPage = (error) => page(`<h1>태블릿 연결</h1><p>컴퓨터의 되짚기 화면 위쪽 <b>태블릿</b> 버튼을 누르면 나오는 6자리 코드를 넣어 주세요.</p>
${error ? `<p class="err">${error}</p>` : ""}<form method="post" action="/tablet/pair"><input name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="one-time-code" autofocus required><button>연결</button></form>`);

export function startTabletProxy({ projectRoot, port = TABLET_PORT, target = 3000, log = console } = {}) {
  const dir = tabletDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const send = (res, status, html, headers = {}) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(html); };
  const forwardHeaders = (req) => {
    const headers = { ...req.headers, host: `127.0.0.1:${target}` };
    for (const key of Object.keys(headers)) if (key.startsWith("x-forwarded-")) delete headers[key];
    if (headers.origin) headers.origin = `http://127.0.0.1:${target}`;
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${target}`);
    if (headers.cookie) { const rest = withoutCookie(headers.cookie, COOKIE); if (rest) headers.cookie = rest; else delete headers.cookie; }
    return headers;
  };

  const server = http.createServer((req, res) => {
    if (!privateAddress(req.socket.remoteAddress)) return send(res, 403, page("<h1>연결할 수 없어요</h1><p>같은 와이파이에서만 열 수 있어요.</p>"));
    const url = new URL(req.url ?? "/", "http://tablet");
    if (url.pathname === "/tablet/pair") {
      if (req.method === "GET") return send(res, 200, pairPage(""));
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; if (body.length > 2000) req.destroy(); });
        req.on("end", () => {
          const code = new URLSearchParams(body).get("code") ?? "";
          const token = redeemCode(dir, code.trim(), req.headers["user-agent"]);
          if (!token) return send(res, 401, pairPage("코드가 맞지 않거나 시간이 지났어요. 컴퓨터에서 새 코드를 받아 주세요."));
          send(res, 303, "", { Location: "/study", "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` });
        });
        return;
      }
    }
    if (!pairedDevice(dir, cookieOf(req.headers.cookie, COOKIE))) return send(res, 303, "", { Location: "/tablet/pair" });
    if (BLOCKED.some((re) => re.test(url.pathname))) return send(res, 403, page("<h1>컴퓨터에서만 할 수 있어요</h1><p>이 기능은 컴퓨터 화면에서 사용해 주세요.</p>"));
    const upstream = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: forwardHeaders(req) }, (up) => {
      const headers = { ...up.headers };
      if (typeof headers.location === "string") headers.location = headers.location.replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${target}`), "");
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) send(res, 502, page("<h1>앱이 꺼져 있어요</h1><p>컴퓨터에서 <b>Recaller 시작</b>을 눌러 주세요.</p>")); else res.end(); });
    req.pipe(upstream);
  });

  // Live reload and other websockets: same checks, then a raw pipe with the rewritten request head.
  server.on("upgrade", (req, socket, head) => {
    if (!privateAddress(req.socket.remoteAddress) || !pairedDevice(dir, cookieOf(req.headers.cookie, COOKIE))) return socket.destroy();
    const url = new URL(req.url ?? "/", "http://tablet");
    if (BLOCKED.some((re) => re.test(url.pathname))) return socket.destroy();
    const up = net.connect(target, "127.0.0.1", () => {
      const headers = forwardHeaders(req);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)).join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
  });

  server.on("error", (error) => log.warn(`[태블릿] ${port}번 포트를 열지 못했어요: ${error.message}. 태블릿 모드 없이 계속해요.`));
  server.listen(port, "0.0.0.0", () => log.log(`[태블릿] 같은 와이파이의 태블릿에서 ${port}번 포트로 열 수 있어요(연결 코드 필요).`));
  return server;
}

