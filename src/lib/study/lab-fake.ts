import type { LabConfig } from "./lab-contract.ts";
/** Fixed local fixture, not a simulation of extraction quality on arbitrary PDFs. */
export async function labFakeReply(stage: string, user: string, fileName: string, scenario: LabConfig["scenario"], attempt: number) {
    await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? 0 : 700));
    const quote = "Then all nodes that are 1 edge from u.";
    const replies: Record<string, unknown> = {
        analyze: { outlineText: `@file ${fileName}\n# 너비 우선 탐색 [1]` },
        "concept-tree": { treeText: `너비 우선 탐색\n- 방문 순서 — 가까운 노드부터 방문 (p.1)\n- 큐 — 선입선출로 거리 순서를 유지 (p.1)` },
        "learning-design": { learningDesignText: ["--- LEARNING 1 ---", "개념: 2, 3", "학습내용: BFS의 큐와 가까운 노드부터 방문하는 순서", "학습목표: BFS의 큐와 방문 순서 관계를 설명할 수 있다.", "성공기준: 가까운 노드부터 방문하는 순서를 말한다.", `근거: ${quote}`, "종류: 관계", "이유: 큐와 방문 순서의 관계가 핵심이다.", "중요도: 3"].join("\n") },
        "activity-design": { activityDesignText: ["--- DESIGN 1 ---", "학습대상: 1", "관련개념: 전체", "관계: 직접", "보여줄 것: BFS는 어떤 노드부터 방문하는가", "감출 것: 가까운 노드", "응답: 짧은답", "채점: 정확", "단서: 보통", "문제방식: 빈칸", "풀이방식: 해당없음", "이유: 방문 순서를 직접 회상한다.", "제한:"].join("\n") },
        cards: { cardsText: ["--- CARD 1 ---", "유형: 빈칸", "질문: BFS는 ____부터 방문한다.", "정답: 가까운 노드", "해설: 거리 순서로 방문한다.", `근거: ${quote}`].join("\n") },
    };
    if (stage === "concept-tree" && scenario === "retry" && attempt === 1)
        return JSON.stringify({ treeText: "너비 우선 탐색\n- 방문 순서 — 가까운 노드부터 방문\n- 큐 — 선입선출 (p.1)" });
    if (stage === "learning-design" && scenario === "warning" && attempt === 1)
        return JSON.stringify({ learningDesignText: "invalid JSON" });
    if (stage !== "authoring")
        return JSON.stringify(replies[stage]);
    const raw = /\[출제 패킷\]\n([\s\S]*?)\n\[\/출제 패킷\]/.exec(user)?.[1];
    const packet = JSON.parse(raw ?? "{}") as {
        items: Array<Record<string, unknown>>;
    };
    return JSON.stringify({ schemaVersion: "problem-authoring-v1", id: "lab-fake-doc", title: "너비 우선 탐색",
        questions: packet.items.map((source, i) => ({ id: `question-${i + 1}`, source, page: { width: 760, height: 260 }, blocks: [
                { id: `prompt-${i}`, kind: "text", frame: { x: 40, y: 30, width: 680, height: 50 }, text: "BFS는 어떤 노드부터 방문하는가?" },
                { id: `blank-${i}`, kind: "blank", frame: { x: 40, y: 95, width: 680, height: 50 }, responseId: `r${i}`, promptBefore: "답:", promptAfter: "" },
                { id: `reveal-${i}`, kind: "answer-reveal", frame: { x: 40, y: 160, width: 680, height: 60 }, responseIds: [`r${i}`] },
            ], responses: [{ id: `r${i}`, kind: "short-text", acceptedAnswers: ["가까운 노드"], grading: "exact-normalized", explanation: "거리 순서로 방문한다." }] })),
    });
}
