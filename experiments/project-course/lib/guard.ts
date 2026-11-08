/**
 * 다른 출처 막기(11/9 보안 점검: 4100은 요청이 어디서 왔는지 보지 않아, 같은 컴퓨터에서 연 아무 웹 사이트나
 * 자료 비우기 · 명령 [실행] 같은 요청을 보낼 수 있었고, 주소를 127.0.0.1로 돌리는 수법(DNS 리바인딩)이면 대화도 읽을 수 있었다)
 * - Host가 이 컴퓨터 주소가 아니면 거절(리바인딩)
 * - 읽기(GET) 말고는 Origin이 있으면 이 컴퓨터의 Recaller 주소(4100 · 앱 3000)여야 하고, 브라우저가 다른 사이트라고 알리면 거절
 *   (VS Code 확장 · 앱 서버 · 코스 서버 자신은 Origin 없이 부른다)
 */
export function blockedRequest(method: string, headers: Record<string, string | string[] | undefined>): string | null {
  const host = String(headers.host ?? "");
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return "이 컴퓨터 주소로만 열 수 있어요.";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const origin = String(headers.origin ?? "");
  if (origin && origin !== "null" && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):(4100|3000)$/i.test(origin)) return "다른 사이트에서 온 요청은 받지 않아요.";
  if (origin === "null" || headers["sec-fetch-site"] === "cross-site") return "다른 사이트에서 온 요청은 받지 않아요.";
  return null;
}
