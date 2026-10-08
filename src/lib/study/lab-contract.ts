import { z } from "zod";
export const labStageList = [
    { key: "analyze", label: "분석" }, { key: "concept-tree", label: "개념 구조" },
    { key: "learning-design", label: "학습 설계" }, { key: "activity-design", label: "활동 설계" },
    { key: "cards", label: "카드" }, { key: "authoring", label: "출제" },
];
export const labSettingsSchema = z.object({
    model: z.enum(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna"]),
    effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]),
}).refine((s) => !(s.model === "gpt-6-luna" && s.effort === "ultra"), "luna는 ultra를 지원하지 않습니다.");
export const labConfigSchema = z.strictObject({
    provider: z.enum(["chatgpt", "fake"]), stepMode: z.boolean(),
    stages: z.partialRecord(z.enum(["analyze", "concept-tree", "learning-design", "activity-design", "cards", "authoring"]), labSettingsSchema).default({}),
    note: z.string().max(2000).default(""),
    scenario: z.enum(["success", "retry", "warning"]).default("success"),
});
export type LabConfig = z.infer<typeof labConfigSchema>;
export type CallRecord = {
    n: number;
    purpose: string;
    attempt: number;
    model: string;
    effort: string;
    startedAt: string;
    ms: number;
    ok: boolean;
    system: string;
    user: string;
    reply: string | null;
    error: string | null;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
    input: {
        pagesSent: number[];
        pagesCut: number[];
        charsSent: number;
    };
};
export function redactCallText(text: string) {
    return text.replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
        .replace(/^(\s*(?:authorization|cookie|set-cookie)\s*:\s*).*$/gim, "$1[REDACTED]")
        .replace(/(["'](?:access_token|refresh_token|id_token|authorization|cookie|api[_-]?key)["']\s*:\s*")[^"\r\n]*(")/gi, "$1[REDACTED]$2")
        .replace(/((?:access_token|refresh_token|id_token|authorization|cookie|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s"',}\n]+/gi, "$1[REDACTED]");
}
