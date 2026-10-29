// 앱과 같은 ChatGPT 로그인에서 지금 쓸 수 있는 접근 토큰 하나를 받는다(앱 코드를 읽기만 한다).
// 토큰은 메모리에서만 쓰고 파일·화면에 남기지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const APP_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export async function chatGptToken(): Promise<string> {
  process.env.STUDY_FORGE_AUTH_DIR ||= path.join(APP_ROOT, ".study-forge-data");
  if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
    const file = path.join(homedir(), ".study-forge", "chatgpt-token-key");
    if (existsSync(file)) {
      const key = readFileSync(file, "utf8").trim();
      if (/^[a-f0-9]{64}$/i.test(key)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = key;
    }
  }
  const auth = await import(pathToFileURL(path.join(APP_ROOT, "src", "lib", "ai", "chatgpt-auth.ts")).href);
  const assist = await import(pathToFileURL(path.join(APP_ROOT, "src", "lib", "assist", "model.ts")).href);
  return auth.chatGptAccessToken(assist.LOCAL_CALLER.uid);
}
