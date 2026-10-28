// 부품: 경로 목록 — 이 서버가 받는 요청 전체가 한눈에 보이는 곳.
import { Router } from "./router.ts";
import { sendJson } from "./http.ts";
// <from 2>
import * as posts from "./routes/posts.ts";
// </from>
// <from 4>
import * as users from "./routes/users.ts";
// </from>

export const router = new Router();

router.add("GET", "/health", ({ res }) => sendJson(res, 200, { ok: true }));
// <from 2>
router.add("GET", "/posts", posts.list);
router.add("POST", "/posts", posts.create);
router.add("GET", "/posts/:id", posts.get);
router.add("PATCH", "/posts/:id", posts.update);
router.add("DELETE", "/posts/:id", posts.remove);
// </from>
// <from 4>
router.add("POST", "/signup", users.signup);
router.add("POST", "/login", users.login);
router.add("POST", "/logout", users.logout);
router.add("GET", "/me", users.me);
// </from>
