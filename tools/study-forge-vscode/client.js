function createStudyForgeClient(baseUrl, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("이 VS Code 환경에서 HTTP 요청을 사용할 수 없습니다.");
  const root = String(baseUrl || "").replace(/\/$/, "");

  async function request(path, options) {
    const response = await fetchImpl(`${root}${path}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Study Forge 요청을 처리하지 못했습니다.");
    return data;
  }

  return {
    async listProjects() {
      return (await request("/api/study-projects")).projects;
    },
    async getActiveSession(projectId) {
      return (await request(`/api/study-projects/${encodeURIComponent(projectId)}/coding-session`)).session;
    },
    async submitCode(sessionId, submission) {
      return (await request(`/api/coding-sessions/${encodeURIComponent(sessionId)}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      })).submission;
    },
  };
}

module.exports = { createStudyForgeClient };
