// 시험용 가짜 코스 생성 답(PC_FAKE_AI=1). 인사 서버와 같은 2단계: 관문을 실제로 지나는 코드를 돌려준다.
// 첫 시도는 일부러 검사가 느슨한 답을 줘서 관문의 "틀린 완성을 못 잡음" → 다시 만들기 길도 시험한다(목표에 "느슨"이 있을 때).
const HELLO_START = `// 부품: 인사 — GET /hello?name=이름 에 "안녕, 이름"으로 답한다.
import type { Ctx } from "../router.ts";
import { sendJson } from "../http.ts";

export function greet({ res, query }: Ctx) {
  const name = query.get("name");
  // TODO(1단계): 이름이 없으면 400, 있으면 "안녕, 이름"
  sendJson(res, 200, { message: "안녕" });
}
`;
const HELLO_SOLVED = HELLO_START.replace(`  // TODO(1단계): 이름이 없으면 400, 있으면 "안녕, 이름"
  sendJson(res, 200, { message: "안녕" });`, `  if (!name) {
    sendJson(res, 400, { error: "name을 붙여 주세요" });
    return;
  }
  sendJson(res, 200, { message: \`안녕, \${name}\` });`);
const APP1 = `import { Router } from "./router.ts";
import * as hello from "./routes/hello.ts";

export const router = new Router();
router.add("GET", "/hello", hello.greet);
`;
const APP2 = APP1.replace(`import * as hello from "./routes/hello.ts";`, `import * as hello from "./routes/hello.ts";\nimport * as notes from "./routes/notes.ts";`) + `router.add("GET", "/notes", notes.list);\nrouter.add("POST", "/notes", notes.add);\n`;
const NOTES_START = `import type { Ctx } from "../router.ts";
import { readJson, sendJson } from "../http.ts";

const notes: { id: number; text: string }[] = [];

export function list({ res }: Ctx) {
  sendJson(res, 200, notes);
}

export async function add({ req, res }: Ctx) {
  const input = await readJson(req);
  const note = { id: notes.length + 1, text: String(input.text ?? "") };
  // TODO(2단계): 새 글을 notes 배열에 넣는다
  sendJson(res, 201, note);
}
`;
const NOTES_SOLVED = NOTES_START.replace("  // TODO(2단계): 새 글을 notes 배열에 넣는다\n", "  notes.push(note);\n");

let loose = 0;
export function fakeGen(purpose: string, user: string) {
  if (purpose === "gen-plan") return { title: "인사와 방명록 API", summary: "이름으로 인사하고 방명록을 남기는 작은 서버", scopeNote: "", stages: [{ title: "이름 불러 인사하기", goal: "/hello?name=이름 에 인사" }, { title: "방명록 남기기", goal: "POST /notes로 남긴 글이 목록에 보이게" }] };
  const n = Number(/\[이번 단계\] (\d+)단계/.exec(user)?.[1] ?? 1);
  const common = { needs: [{ q: "주소에서 이름만 꺼내야겠죠?", answer: "주소의 ? 뒤를 쿼리라고 해요. JavaScript에서는 URLSearchParams의 get으로 꺼내요.", concept: "쿼리", snippet: 'const q = new URLSearchParams("name=건희");\nq.get("name")', file: "src/app.ts", anchor: "router.add" }],
    tries: [{ method: "GET", path: "/hello?name=건희", body: "" }], pair: ["조각 1", "조각 2"], explainQ: "왜 그럴까요?" };
  if (n === 1) {
    const strict = !/느슨/.test(user) || /지난번 관문/.test(user) || loose++ > 0;
    return { ...common, title: "이름 불러 인사하기", goal: "/hello?name=건희 → 안녕, 건희", intro: "지금은 누가 와도 그냥 \"안녕\"이에요.",
      concepts: [{ id: "query", name: "쿼리", essentials: "주소 ? 뒤의 이름=값" }, { id: "status", name: "상태 코드", essentials: "200 잘 됨, 400 보낸 쪽 잘못" }],
      startFiles: [{ path: "src/app.ts", content: APP1 }, { path: "src/routes/hello.ts", content: HELLO_START }],
      solvedFiles: [{ path: "src/routes/hello.ts", content: HELLO_SOLVED }],
      fix: { text: "이름이 없으면 400, 있으면 \"안녕, 이름\"으로", file: "src/routes/hello.ts", anchor: "TODO(1단계)" },
      checks: [
        { title: "이름으로 인사", concepts: ["query"], steps: [{ req: "GET /hello?name=Kim", body: "", status: 200, json: strict ? '{"message":"안녕, Kim"}' : "", listHas: "" }] },
        { title: "이름 없으면 400", concepts: ["status"], steps: [{ req: "GET /hello", body: "", status: 400, json: "", listHas: "" }] }],
      mutants: [{ path: "src/routes/hello.ts", content: HELLO_SOLVED.replace("`안녕, ${name}`", '"안녕"') }],
      predict: { q: "지금 /hello?name=건희를 보내면?", options: ["안녕, 건희", "안녕", "404"], answer: 1, why: "이름을 꺼내기만 하고 안 써요." } };
  }
  return { ...common, title: "방명록 남기기", goal: "POST /notes로 남긴 글이 목록에 보이게", intro: "201이라고 답하는데 목록이 비어 있어요.",
    concepts: [{ id: "memory", name: "메모리 배열", essentials: "서버가 켜져 있는 동안만 남는다" }],
    startFiles: [{ path: "src/app.ts", content: APP2 }, { path: "src/routes/notes.ts", content: NOTES_START }],
    solvedFiles: [{ path: "src/routes/notes.ts", content: NOTES_SOLVED }],
    fix: { text: "새 글을 notes 배열에 넣기(push)", file: "src/routes/notes.ts", anchor: "TODO(2단계)" },
    checks: [{ title: "남긴 글이 목록에 보인다", concepts: ["memory"], steps: [
      { req: "POST /notes", body: '{"text":"다녀가요"}', status: 201, json: '{"text":"다녀가요"}', listHas: "" },
      { req: "GET /notes", body: "", status: 200, json: "", listHas: '{"text":"다녀가요"}' }] }],
    mutants: [{ path: "src/routes/notes.ts", content: NOTES_START }],
    needs: [{ q: "남긴 글을 어딘가 모아 둬야겠죠?", answer: "배열에 넣어 둬요. 배열 끝에 넣는 함수는 push예요.", concept: "배열 push", snippet: "const a = [];\na.push(1);\na", file: "src/routes/notes.ts", anchor: "const notes" }],
    tries: [{ method: "POST", path: "/notes", body: '{"text":"처음"}' }, { method: "GET", path: "/notes", body: "" }],
    predict: { q: "글을 남기고 목록을 보면?", options: ["글이 보인다", "빈 목록"], answer: 1, why: "넣지 않으니까요." } };
}
