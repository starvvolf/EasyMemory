// 시험용 가짜 AI (PC_FAKE_AI=1). 호출 없이 AI 경로(대화·힌트)가 화면까지 도는지 본다. 횟수에 세지 않는다.
import { setFakeAi } from "./ai.ts";

export function installFakeAi() {
  setFakeAi((purpose, user) => {
    if (purpose === "intake") {
      const known = JSON.parse(/\[지금까지 안 것\]\n(.*)/.exec(user)?.[1] ?? "{}");
      const turn = Number(/\[턴\] (\d+)/.exec(user)?.[1] ?? 0);
      const profile = { goal: "", level: -1, languages: [] as string[], time: "", aiShare: "" };
      if (/프론트|앱|게임/.test(user)) {
        return { reply: "프론트엔드 코스는 아직 준비되지 않았어요. 대신 화면이 부르는 서버 쪽을 먼저 만들어 보면 이후에 도움이 돼요.", next: "ask",
          question: { id: "level", text: "지금 어느 정도인가요?", options: ["언어 문법만 배웠다", "작은 프로그램은 혼자 만들어 봤다", "웹 서버를 따라 만들어 봤다"], multi: false }, profile, request: "프론트엔드 코스" };
      }
      if (known.level === undefined) return { reply: "좋아요, 목표를 알겠어요.", next: "ask", question: { id: "level", text: "지금 어느 정도인가요?", options: ["언어 문법만 배웠다", "작은 프로그램은 혼자 만들어 봤다", "웹 서버를 따라 만들어 봤다", "웹 서버를 혼자 만들어 봤다"], multi: false }, profile, request: "" };
      if (!known.languages) return { reply: "알겠어요.", next: "ask", question: { id: "languages", text: "써 본 언어를 골라 주세요.", options: ["JavaScript / TypeScript", "Python", "Java"], multi: true }, profile, request: "" };
      if (!known.time || turn < 3) return { reply: "고마워요.", next: "ask", question: { id: "time", text: "하루에 얼마나 쓸 수 있나요?", options: ["30분", "1시간", "2시간 이상"], multi: false }, profile, request: "" };
      return { reply: "충분히 알았어요.", next: "diagnose", question: { id: "x", text: "", options: [], multi: false }, profile, request: "" };
    }
    if (purpose.startsWith("agent")) {
      const step = Number(purpose.slice(5));
      const q = /\[학습자 질문\] (.*)/.exec(user)?.[1] ?? "";
      const A = (o: unknown) => JSON.stringify(o);
      if (/고쳐/.test(q)) {
        return [
          { say: "먼저 지금 상태를 직접 확인해 볼게요.", tool: "send_request", args: A({ method: "GET", path: "/nothing" }) },
          { say: "답장이 없네요. 서버 파일을 읽어 볼게요.", tool: "read_file", args: A({ path: "src/server.ts", from: 15, to: 32 }) },
          { say: "맞는 경로가 없을 때 답장하는 줄이 비어 있어요. 부탁하셨으니 고칠게요.", tool: "edit_file", args: A({ path: "src/server.ts", find: "    // TODO(1단계): 맞는 경로가 없을 때도 응답을 보내야 한다.", replace: "    if (found.allowed.length) {\n      sendJson(res, 405, { error: \"허용되지 않은 메서드예요.\" }, { allow: found.allowed.join(\", \") });\n      return;\n    }\n    sendJson(res, 404, { error: \"없는 주소예요.\" });", why: "맞는 경로가 없을 때 404/405 답장을 보내도록" }) },
          { say: "고쳤으니 검사로 확인해 볼게요.", tool: "run_checks", args: "{}" },
          { say: "모두 통과했어요. 핵심은 '맞는 경로가 없어도 답장은 꼭 보낸다'예요. 제가 고친 거라 이번 단계는 직접 통과로 치지 않아요. 되돌리고 직접 써 보셔도 돼요.", tool: "none", args: "{}" },
        ][step];
      }
      return [
        { say: "어디에 무엇이 있는지부터 볼게요.", tool: "list_files", args: "{}" },
        { say: "서버 파일을 읽어 볼게요.", tool: "read_file", args: A({ path: "src/server.ts", from: 15, to: 32 }) },
        { say: "실제로 없는 주소에 편지를 보내 볼게요.", tool: "send_request", args: A({ method: "GET", path: "/nothing" }) },
        { say: "답장이 오지 않아요. 원인이 되는 줄을 VS Code에 열어 드릴게요.", tool: "open_in_editor", args: A({ path: "src/server.ts", line: 23, note: "맞는 경로가 없을 때 여기서 아무것도 안 해요" }) },
        { say: "정리하면, 라우터가 맡은 함수를 못 찾으면 서버가 답장을 안 쓰고 끝나요. 열어 드린 줄 아래에 404 답장을 보내는 한 줄을 직접 써 보세요.", tool: "none", args: "{}" },
      ][step];
    }
    if (purpose === "tutor") return "좋은 질문이에요! 라우터는 우체국의 분류 담당 같은 거예요. 편지에 적힌 주소와 방식(GET, DELETE…)을 보고 어느 처리 함수에게 넘길지 정해요. 우리 코드에서는 [[src/router.ts:20]] 의 match가 그 일을 해요.\n\n그럼 아까 하던 것으로 돌아가 볼게요.";
    if (purpose.startsWith("hint")) return `(가짜 AI 힌트 ${purpose.slice(4)}단계) 검사 결과의 기대와 실제를 비교해 보세요.`;
    return "";
  });
}
