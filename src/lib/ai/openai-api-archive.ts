/**
 * 보관용 OpenAI Responses API 전송기.
 *
 * Study Forge의 활성 생성 경로에서는 사용하지 않는다. Codex App Server 전환 전의
 * API-key 방식으로 되돌려 비교하거나 별도 브랜치에서 복구할 때만 참고한다.
 */
export async function callArchivedOpenAIJson(input: {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: Array<{ filename: string; mimeType: string; base64: string }>;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      reasoning: { effort: input.reasoningEffort },
      input: [
        { role: "system", content: input.system },
        {
          role: "user",
          content:
            input.files && input.files.length > 0
              ? [
                  ...input.files.map((file) => ({
                    type: "input_file",
                    filename: file.filename,
                    file_data: `data:${file.mimeType};base64,${file.base64}`,
                  })),
                  { type: "input_text", text: input.user },
                ]
              : input.user,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error("Archived OpenAI Responses API request failed");
  return data;
}
