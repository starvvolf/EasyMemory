import { randomUUID } from "node:crypto";

import { FULL_RUN_STAGES, runFullEval } from "../../scripts/eval-full-runner.ts";

function initialStages() {
  return Object.fromEntries(FULL_RUN_STAGES.map((stage) => [stage, { status: "waiting", message: null }]));
}

export class GenerationLabRunExecutor {
  constructor(options = {}) {
    this.run = options.run ?? runFullEval;
    this.jobs = new Map();
    this.activeJobId = null;
  }

  isRunning() {
    return this.activeJobId !== null;
  }

  get(jobId) {
    return this.jobs.get(jobId) ?? null;
  }

  start(input) {
    if (this.activeJobId) throw new Error("다른 실험이 실행 중입니다.");
    const jobId = randomUUID();
    const job = {
      jobId,
      status: "running",
      fileName: input.fileName,
      fileSize: input.pdfBytes.length,
      learningGoal: input.learningGoal,
      stages: initialStages(),
      activeStage: null,
      runId: null,
      caseId: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.jobs.set(jobId, job);
    this.activeJobId = jobId;

    Promise.resolve().then(async () => {
      try {
        const result = await this.run({
          ...input,
          onEvent: async (event) => {
            job.activeStage = event.stage;
            job.stages[event.stage] = { status: event.status, message: event.message ?? null };
          },
        });
        job.status = "completed";
        job.runId = result.runId;
        job.caseId = result.caseId;
      } catch (error) {
        job.status = "failed";
        job.runId = error?.runId ?? null;
        job.caseId = error?.caseId ?? null;
        job.activeStage = error?.stage ?? job.activeStage;
        job.error = error instanceof Error ? error.message : String(error);
      } finally {
        job.completedAt = new Date().toISOString();
        this.activeJobId = null;
      }
    });

    return job;
  }
}
