// 부품: 서버 — 요청을 받아 라우터로 넘기고, 처리 중 오류를 상태 코드로 바꿔 응답한다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { router } from "./app.ts";
import { HttpError, sendJson } from "./http.ts";

const port = Number(process.env.PORT || 4101);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  try {
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await readFile(new URL("../public/index.html", import.meta.url)));
      return;
    }
    const found = router.match(method, url.pathname);
    if (found.handler) {
      await found.handler({ req, res, params: found.params, query: url.searchParams });
      return;
    }
    // <swap 1>
    if (found.allowed.length) {
      sendJson(res, 405, { error: "이 주소에서는 허용되지 않은 메서드예요." }, { allow: found.allowed.join(", ") });
      return;
    }
    sendJson(res, 404, { error: "없는 주소예요." });
    // <start>
    // TODO(1단계): 맞는 경로가 없을 때도 응답을 보내야 한다.
    //   주소 자체가 없으면 404, 주소는 있는데 메서드가 틀리면 405 (+ allow 헤더).
    // </swap>
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "서버 오류" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`게시판 서버: http://127.0.0.1:${port}`));
