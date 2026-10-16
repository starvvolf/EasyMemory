import { memoryHttpHandlers } from "@/lib/learner-memory/server";

export const runtime = "nodejs";
export const GET = memoryHttpHandlers.GET;
export const POST = memoryHttpHandlers.POST;
export const PATCH = memoryHttpHandlers.PATCH;
