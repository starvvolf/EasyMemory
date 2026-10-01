import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
const keys = ["STUDY_FORGE_DATA_DIR", "STUDY_FORGE_CHATGPT_ENCRYPTION_KEY", "STUDY_FORGE_MODEL_PROVIDER", "STUDY_FORGE_NOTE_MODEL", "STUDY_FORGE_NOTE_EFFORT"];
const base = "C:/Users/Public/Documents/ESTsoft/CreatorTemp";
const candidates = [process.cwd(), "C:/Users/jkh01/OneDrive/문서/CD0625",
  ...(existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => path.join(base, item.name)) : [])];
const checkouts = [...new Set(candidates.map((folder) => path.resolve(folder)))].filter((folder) => existsSync(path.join(folder, "package.json"))).map((folder) => {
  const envFiles = readdirSync(folder).filter((file) => /^\.env(?:\.|$)/.test(file)).map((file) => {
    const text = readFileSync(path.join(folder, file), "utf8");
    return { file, configured: Object.fromEntries(keys.map((key) => {
      const value = new RegExp(`^(?:export\\s+)?${key}\\s*=\\s*(.*)$`, "m").exec(text)?.[1]?.trim();
      return [key, Boolean(value && value !== '""' && value !== "''")];
    })) };
  });
  const authDir = path.join(folder, ".study-forge-data", "chatgpt-auth");
  return { checkout: folder, envFiles, defaultAuthDirectoryExists: existsSync(authDir),
    accountFileCount: existsSync(authDir) ? readdirSync(authDir).filter((file) => /^account-.*\.json$/.test(file)).length : 0 };
});
const result = { checkedAt: new Date().toISOString(), homeTokenKeyExists: existsSync(path.join(homedir(), ".study-forge", "chatgpt-token-key")), checkouts };
writeFileSync(path.join(process.cwd(), "협업", "검증_11", "real", "setup-metadata.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
