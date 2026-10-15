// Explicit one-operation API driver. Checkpoints stay in the private quality-loop folder.
import { mkdir, readFile, rename, writeFile, access, readdir, realpath } from "node:fs/promises";
import path from "node:path";

process.loadEnvFile(".env.local");
const base = "http://127.0.0.1:3100";
const root = process.env.STUDY_FORGE_DATA_DIR;
if (!root || !path.isAbsolute(root)) throw new Error("An absolute private data directory is required.");
if (path.basename(process.cwd()) !== "EasyMemory-quality") throw new Error("Quality worktree required.");
const privateRoot = path.join(root, "품질루프");
const [action, genId, argument, ...flags] = process.argv.slice(2);
if (!/^(judge|fork)$/.test(action ?? "") || !/^gen_[a-f0-9]{32}$/.test(genId ?? "")) throw new Error("Usage: judge <genId> <tag> --confirmed | fork <genId> <design|author> <tag> --confirmed");
const from = action === "fork" ? argument : null;
const tag = action === "fork" ? flags.shift() : argument;
if (!tag || !/^[a-z0-9-]+$/.test(tag) || !flags.includes("--confirmed")) throw new Error("A safe tag and explicit --confirmed are required.");
if (from && !["design", "author"].includes(from)) throw new Error("Invalid fork phase.");
const isolateOnly = flags.includes("--isolate-only");
const dryRun = flags.includes("--dry-run");
if ((isolateOnly && action !== "fork") || (dryRun && !isolateOnly)) throw new Error("Isolation flags require an existing fork checkpoint.");
const file = path.join(privateRoot, `${tag}.json`);
type Job = { action: string; source: string; from: string | null; startedAt: string; id?: string; target?: string; status: string; calls: number; updatedAt?: string; result?: unknown; score?: unknown; error?: string };
type RemoteState = { id: string; status: string; calls: number; createdAt: string; forkOf?: { genId: string; from: string }; input?: { origin?: string }; summary?: unknown };
type ApiData = { runs: RemoteState[]; run: RemoteState; gen: RemoteState; score: { counts: unknown } };
async function save(job: Job) {
    job.updatedAt = new Date().toISOString();
    await mkdir(privateRoot, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(job, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
}
async function stopped() {
    try { await access(path.join(privateRoot, "STOP")); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
async function api(endpoint: string, body?: unknown): Promise<ApiData> {
    const response = await fetch(`${base}/api/lab/gen${endpoint}`, {
        method: body ? "POST" : "GET", signal: AbortSignal.timeout(180000),
        headers: { Origin: base, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`API ${response.status}: ${data.message ?? "request failed"}`);
    return data;
}
async function isolateCompletedFork(job: Job) {
    if (job.action !== "fork" || job.status !== "done" || !job.id || job.target !== job.id || job.id === job.source || !/^gen_[a-f0-9]{32}$/.test(job.id)) throw new Error("Only this driver's completed fork can be isolated.");
    const dataDirectory = await realpath(root!);
    const storage = await realpath(path.join(dataDirectory, "study-gen"));
    const checkpointDirectory = await realpath(privateRoot);
    if (path.dirname(storage) !== dataDirectory || path.dirname(checkpointDirectory) !== dataDirectory) throw new Error("Data subdirectory escaped the configured root.");
    const directory = await realpath(path.join(storage, job.id));
    const stateFile = await realpath(path.join(directory, "state.json"));
    if (path.dirname(directory) !== storage || stateFile !== path.join(directory, "state.json")) throw new Error("Fork storage escaped its expected directory.");
    const original = await readFile(stateFile, "utf8");
    const state = JSON.parse(original) as RemoteState;
    const recorded = job.result as RemoteState | undefined;
    if (state.id !== job.id || recorded?.id !== job.id || state.status !== "done" || state.calls !== job.calls || state.createdAt !== recorded.createdAt || !Number.isFinite(Date.parse(job.startedAt)) || !Number.isFinite(Date.parse(state.createdAt)) || Date.parse(state.createdAt) < Date.parse(job.startedAt) || state.forkOf?.genId !== job.source || state.forkOf.from !== job.from || !state.input || typeof state.input !== "object" || Array.isArray(state.input)) throw new Error("Fork ownership or terminal state could not be verified.");
    if ((state.input.origin ?? "lab") === "lab") {
        job.result = state;
        console.log(JSON.stringify({ event: "already-isolated", tag, id: job.id }));
        return;
    }
    if (state.input.origin !== "study") throw new Error("Unknown fork origin.");
    // Never hide a run that has acquired a user's study record or manual patch.
    let recordFiles: string[];
    try { recordFiles = await readdir(path.join(root!, "study-records")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; recordFiles = []; }
    for (const name of recordFiles.filter(name => name.endsWith(".json"))) {
        const value = JSON.parse(await readFile(path.join(root!, "study-records", name), "utf8")) as { records?: Record<string, unknown> };
        if (!value.records || typeof value.records !== "object" || Array.isArray(value.records)) throw new Error("Study record format could not be verified.");
        if (Object.hasOwn(value.records, job.id)) throw new Error("Fork has a user study record; leave it unchanged.");
    }
    try {
        const patches = JSON.parse(await readFile(path.join(root!, "study-quality", "patches.json"), "utf8")) as Record<string, unknown>;
        if (!patches || typeof patches !== "object" || Array.isArray(patches) || Object.hasOwn(patches, job.id)) throw new Error("Fork has patches or patch format is unknown; leave it unchanged.");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    console.log(JSON.stringify({ event: dryRun ? "isolation-dry-run" : "isolating", tag, id: job.id }));
    if (dryRun) return;
    const backup = path.join(checkpointDirectory, `${tag}-origin-before.json`);
    try { await writeFile(backup, original, { flag: "wx", mode: 0o600 }); }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(backup, "utf8") !== original) throw e;
    }
    if (await readFile(stateFile, "utf8") !== original) throw new Error("Fork changed during isolation; leave it unchanged.");
    state.input.origin = "lab";
    const temporary = `${stateFile}.quality-${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, stateFile);
    job.result = state;
}
let job: Job;
try { job = JSON.parse(await readFile(file, "utf8")); }
catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    job = { action, source: genId, from, startedAt: new Date().toISOString(), status: "new", calls: 0 };
}
if (job.action !== action || job.source !== genId || job.from !== from) throw new Error("Tag already belongs to another operation.");
if (await stopped()) throw new Error("STOP exists; no submission.");
if (isolateOnly) {
    if (!job.id) throw new Error("Isolation requires an existing completed checkpoint; no submission.");
    await isolateCompletedFork(job);
    if (!dryRun) await save(job);
    process.exit(0);
}
try {
    if (!job.id && job.status === "submitting") {
        // Recover an uncertain POST outcome instead of submitting another paid job.
        const candidates = action === "judge" ? (await api(`/${genId}/judge`)).runs : (await api("")).runs.filter(r => r.forkOf?.genId === genId && r.forkOf?.from === from);
        const own = candidates.filter(r => Date.parse(r.createdAt) >= Date.parse(job.startedAt));
        if (own.length !== 1) throw new Error("Uncertain submission; inspect the saved checkpoint before another POST.");
        job.id = own[0].id; job.target = action === "judge" ? genId : job.id;
        await save(job);
    }
    if (!job.id) {
        if (action === "fork") {
            const parent = (await api(`/${genId}`)).gen;
            if (!parent.input || (parent.input.origin ?? "lab") !== "lab") throw new Error("Quality forks require an isolated lab parent; no submission.");
        }
        job.status = "submitting"; await save(job);
        const response = action === "judge" ? await api(`/${genId}/judge`, { kind: "judge", confirmed: true }) : await api(`/${genId}/fork`, { from, autoConfirm: true, confirmed: true });
        job.id = action === "judge" ? response.run.id : response.gen.id;
        job.target = action === "judge" ? genId : job.id;
        await save(job);
        console.log(JSON.stringify({ event: "submitted", tag, id: job.id }));
    }
    let previous = "";
    while (true) {
        const response = action === "judge" ? await api(`/${genId}/judge/${job.id}`) : await api(`/${job.id}`);
        const state = action === "judge" ? response.run : response.gen;
        job.status = state.status; job.calls = state.calls; job.result = state;
        await save(job);
        const progress = `${state.status}:${state.calls}`;
        if (progress !== previous) { console.log(JSON.stringify({ event: "progress", tag, id: job.id, status: state.status, calls: state.calls })); previous = progress; }
        if (!["queued", "running"].includes(state.status)) break;
        if (await stopped()) { console.log("STOP observed; no new submissions. Existing API job is still running."); break; }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (job.status === "done") {
        if (action === "fork") await isolateCompletedFork(job);
        job.score = (await api(`/${job.target}/score`)).score;
        await save(job);
    }
    const result = job.result as RemoteState;
    console.log(JSON.stringify({ event: "finished", tag, id: job.id, status: job.status, calls: job.calls, summary: result?.summary, counts: (job.score as ApiData["score"])?.counts }));
    if (job.status !== "done") process.exitCode = 2;
} catch (e) {
    job.error = e instanceof Error ? e.message : String(e);
    await save(job);
    throw e;
}
