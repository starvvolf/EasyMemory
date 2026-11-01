// 부품: 인사 — GET /hello?name=이름 에 "안녕, 이름"으로 답한다.
import type { Ctx } from "../router.ts";
import { sendJson } from "../http.ts";

export function greet({ res, query }: Ctx) {
  // 주소의 ? 뒤에 붙은 값(쿼리)에서 name을 꺼낸다. 없으면 null.
  const name = query.get("name");
  // <swap 1>
  if (!name) {
    sendJson(res, 400, { error: "name을 붙여서 보내 주세요. 예: /hello?name=건희" });
    return;
  }
  sendJson(res, 200, { message: `안녕, ${name}` });
  // <start>
  // TODO(1단계): 이름이 없으면 400으로 알려 주고, 있으면 "안녕, 이름"으로 답한다.
  sendJson(res, 200, { message: "안녕" });
  // </swap>
}
