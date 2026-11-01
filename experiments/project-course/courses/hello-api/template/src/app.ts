// 부품: 경로 목록 — 이 서버가 받는 요청이 한눈에 보이는 곳. "메서드 + 주소"마다 처리 함수 하나.
import { Router } from "./router.ts";
import * as hello from "./routes/hello.ts";
// <from 2>
import * as notes from "./routes/notes.ts";
// </from>

export const router = new Router();

router.add("GET", "/hello", hello.greet);
// <from 2>
router.add("GET", "/notes", notes.list);
router.add("POST", "/notes", notes.add);
// </from>
