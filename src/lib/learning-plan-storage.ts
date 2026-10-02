import type { LearningPlan } from "./learning-planner.ts";

const STORAGE_KEY = "study-forge-learning-plans-v1";

export function loadLearningPlans(): LearningPlan[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(isLearningPlan);
  } catch {
    return [];
  }
}

export function saveLearningPlans(plans: LearningPlan[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

function isLearningPlan(value: unknown): value is LearningPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<LearningPlan>;
  return typeof plan.id === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(plan.date ?? "")
    && typeof plan.deckId === "string"
    && typeof plan.quantity === "number"
    && plan.quantity > 0
    && typeof plan.note === "string"
    && typeof plan.completed === "boolean"
    && typeof plan.createdAt === "string"
    && typeof plan.updatedAt === "string";
}
