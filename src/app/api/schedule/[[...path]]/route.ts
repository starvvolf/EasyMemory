import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { addDeadline, addSession, addTodo, deleteDeadline, deleteTodo, getTimer, listDeadlines, listTodos, makeSchedule, pauseTimer, startTimer, stopTimer, updateTodo, week } from "@/lib/schedule/store";

export const runtime = "nodejs";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const url = new URL(request.url);
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);

    if (p[0] === "timer") {
      if (p.length === 1 && m === "GET") return json(await getTimer());
      if (p[1] === "start" && m === "POST") return json(await startTimer(await body(z.object({ label: z.string().max(80).optional(), mode: z.enum(["stopwatch", "pomodoro"]).optional(), targetMin: z.number().int().min(1).max(180).optional(), folderId: z.string().max(40).nullable().optional() }))));
      if (p[1] === "pause" && m === "POST") return json(await pauseTimer());
      if (p[1] === "stop" && m === "POST") return json(await stopTimer());
    }
    if (p[0] === "sessions" && m === "POST") return json({ session: await addSession(await body(z.object({ start: z.string().max(40), minutes: z.number().min(1).max(1440), label: z.string().max(80).optional() }))) });
    if (p[0] === "week" && m === "GET") return json(await week(url.searchParams.get("start") ?? undefined));
    if (p[0] === "todos") {
      if (p.length === 1 && m === "GET") return json({ todos: await listTodos() });
      if (p.length === 1 && m === "POST") { const b = await body(z.object({ text: z.string().min(1).max(200), date: day.nullable().optional() })); return json({ todo: await addTodo(b) }); }
      if (p[1] && m === "PATCH") return json({ todo: await updateTodo(p[1], await body(z.object({ text: z.string().max(200).optional(), date: day.nullable().optional(), done: z.boolean().optional() }))) });
      if (p[1] && m === "DELETE") return json(await deleteTodo(p[1]));
    }
    if (p[0] === "deadlines") {
      if (p.length === 1 && m === "GET") return json({ deadlines: await listDeadlines() });
      if (p.length === 1 && m === "POST") {
        const b = await body(z.object({ title: z.string().max(80).optional(), date: day, folderId: z.string().max(40).nullable().optional(), goalId: z.string().max(40).nullable().optional(), amount: z.number().int().min(0).max(1000).optional(), unit: z.string().max(10).optional(), plan: z.boolean().optional() }));
        const deadline = await addDeadline(b);
        return json({ deadline, ...(b.plan ? { schedule: await makeSchedule(deadline.id) } : {}) });
      }
      if (p[1] && p[2] === "schedule" && m === "POST") return json(await makeSchedule(p[1]));
      if (p[1] && m === "DELETE") return json(await deleteDeadline(p[1]));
    }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
