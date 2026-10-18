/* eslint-disable @typescript-eslint/no-require-imports */
const vscode = require("vscode");
const { createStudyForgeClient } = require("./client");
const { registerLearningWorkspace } = require("./learning-workspace");

const projectIdKey = "studyForge.projectId";
const projectNameKey = "studyForge.projectName";

function activate(context) {
  registerLearningWorkspace(vscode, context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.command = "studyForge.connectProject";
  context.subscriptions.push(status);

  function updateStatus() {
    const name = context.workspaceState.get(projectNameKey);
    status.text = name ? `$(book) Study Forge: ${name}` : "$(debug-disconnect) Study Forge 연결";
    status.tooltip = name ? "연결된 학습 프로젝트 변경" : "Study Forge 프로젝트 연결";
    status.show();
  }

  context.subscriptions.push(vscode.commands.registerCommand("studyForge.connectProject", async () => {
    try {
      const client = getClient();
      const projects = await client.listProjects();
      if (!projects.length) {
        void vscode.window.showInformationMessage("Study Forge에서 먼저 학습 프로젝트를 만드세요.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        projects.map((project) => ({ label: project.name, description: `PDF ${project.sourceCount}개`, project })),
        { placeHolder: "이 코드 폴더와 연결할 Study Forge 프로젝트" },
      );
      if (!picked) return;
      await context.workspaceState.update(projectIdKey, picked.project.id);
      await context.workspaceState.update(projectNameKey, picked.project.name);
      updateStatus();
      void vscode.window.showInformationMessage(`${picked.project.name} 프로젝트와 연결했습니다.`);
    } catch (error) {
      showError(error);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("studyForge.submitSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage("GPT에게 보여줄 코드를 먼저 선택하세요.");
      return;
    }
    const projectId = context.workspaceState.get(projectIdKey);
    if (!projectId) {
      void vscode.window.showInformationMessage("먼저 ‘Study Forge: 프로젝트 연결’을 실행하세요.");
      return;
    }
    try {
      const client = getClient();
      const session = await client.getActiveSession(projectId);
      if (!session) {
        void vscode.window.showInformationMessage("Study Forge에서 이 프로젝트의 코딩 학습 세션을 시작하세요.");
        return;
      }
      const document = editor.document;
      const selectedCode = document.getText(editor.selection);
      const startLine = Math.max(0, editor.selection.start.line - 20);
      const endLine = Math.min(document.lineCount - 1, editor.selection.end.line + 20);
      const surroundingCode = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const filePath = workspaceFolder
        ? vscode.workspace.asRelativePath(document.uri, false)
        : document.fileName;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Study Forge에 코드를 제출하는 중" },
        () => client.submitCode(session.id, {
          filePath,
          language: document.languageId,
          selectedCode,
          surroundingCode,
          authoringMode: "unspecified",
        }),
      );
      void vscode.window.showInformationMessage(
        `제출했습니다. GPT에서 “현재 코딩 제출 검토해줘”라고 요청하세요.${workspaceFolder ? "" : " 파일 경로는 로컬 전체 경로로 기록되었습니다."}`,
      );
    } catch (error) {
      showError(error);
    }
  }));

  updateStatus();
}

function getClient() {
  const serverUrl = vscode.workspace.getConfiguration("studyForge").get("serverUrl");
  return createStudyForgeClient(serverUrl);
}

function showError(error) {
  const message = error instanceof Error ? error.message : "Study Forge에 연결하지 못했습니다.";
  void vscode.window.showErrorMessage(message);
}

function deactivate() {}

module.exports = { activate, deactivate };
