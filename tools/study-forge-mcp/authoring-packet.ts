import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getExperimentRequest } from "../../src/lib/mcp-experiment-requests.ts";
import { getMcpRunView } from "../../src/lib/mcp-run-view.ts";
import { packetFromCompletedRequest } from "../problem-authoring-lab/request-packet.ts";

export const authoringRunsRoot = () => path.join(process.cwd(), "tools", "problem-authoring-lab", "runs");

/** Fixes a completed five-stage request as the authoring input packet. Shared by the MCP tool and the auto-executor. */
export async function prepareAuthoringPacket(requestId: string) {
  const request = await getExperimentRequest(requestId);
  const run = request.runId ? await getMcpRunView(`mcp:${request.runId}`) : null;
  if (!run || run.executionRequest?.id !== request.id || run.executionRequestStatus !== "completed") {
    throw new Error("완료 요청과 검증된 MCP 실행을 연결할 수 없습니다.");
  }
  const packet = packetFromCompletedRequest(request, run.source.fileSha256);
  const authoringRunId = request.runId!;
  if (!/^chatgpt-request-[a-f0-9]{32}$/.test(authoringRunId)) throw new Error("출제 기록에 사용할 실행 ID가 올바르지 않습니다.");
  const directory = path.join(authoringRunsRoot(), authoringRunId);
  const file = path.join(directory, "source-packet.json");
  await mkdir(directory, { recursive: true });
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  try { await writeFile(file, serialized, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(file, "utf8") !== serialized) throw error;
  }
  return {
    authoringRunId,
    packetPath: `runs/${authoringRunId}/source-packet.json`,
    packet,
    objectiveIds: [...new Set(packet.items.map((item) => item.objectiveId))],
    itemCount: packet.items.length,
  };
}
