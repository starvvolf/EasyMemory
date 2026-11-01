// 부품: 서버 — 요청을 받아 라우터로 넘기고, 맞는 곳이 없으면 404로 답한다.
import { createServer } from "node:http";
import { router } from "./app.ts";
import { HttpError, sendJson } from "./http.ts";

const port = Number(process.env.PORT || 4101);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    const found = router.match(req.method ?? "GET", url.pathname);
    if (found.handler) {
      await found.handler({ req, res, params: found.params, query: url.searchParams });
      return;
    }
    sendJson(res, 404, { error: "없는 주소예요." });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "서버 오류" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`인사 서버: http://127.0.0.1:${port}`));
