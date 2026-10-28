// 부품: 경로 목록 — 메모 API.
import { Router } from "./router.ts";
import { sendJson } from "./http.ts";
import * as memos from "./routes/memos.ts";
import * as users from "./routes/users.ts";

export const router = new Router();

router.add("GET", "/health", ({ res }) => sendJson(res, 200, { ok: true }));
router.add("GET", "/memos", memos.list);
router.add("POST", "/memos", memos.create);
router.add("GET", "/memos/:id", memos.get);
router.add("DELETE", "/memos/:id", memos.remove);
router.add("POST", "/signup", users.signup);
router.add("POST", "/login", users.login);
router.add("POST", "/logout", users.logout);
router.add("GET", "/me", users.me);
