import { z } from "zod";

export const JSON_ENGINE_STAGES = ["analyze", "plan", "recall", "prepare", "cards"] as const;
export type JsonEngineStage = typeof JSON_ENGINE_STAGES[number];

const structureTags = ["절차", "목록", "관계", "비교", "수치", "공식", "예외", "틀"] as const;
const knowledgeTypes = [
  "vocabulary", "fact", "concept", "relationship", "procedure", "formula",
  "speaking_pattern", "writing_pattern", "problem_solving_pattern", "example", "other",
] as const;

const sourceRefSchema = z.object({
  fileName: z.string(),
  pageNumbers: z.array(z.number().int().min(1)),
}).strict();

export const analyzeSchema = z.object({
  documentType: z.string(),
  summary: z.string(),
  keyTopics: z.array(z.string()),
  outline: z.array(z.object({
    heading: z.string(),
    points: z.array(z.string()),
  }).strict()),
  sourceOutline: z.object({
    title: z.string(),
    summary: z.string(),
    nodes: z.array(z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      order: z.number().int().min(1),
      title: z.string(),
      summary: z.string(),
      sourceRefs: z.array(sourceRefSchema),
      sourceEvidence: z.string(),
      selectedByDefault: z.boolean(),
      structureTags: z.array(z.enum(structureTags)).max(4),
      importance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }).strict()).min(1).max(120),
  }).strict(),
  suggestedRole: z.string(),
}).strict();

export const planSchema = z.object({
  summary: z.string(),
  learningGoal: z.string(),
  selectionRationale: z.string(),
  areas: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    learningValue: z.string(),
    sourceScope: z.array(z.string()).min(1),
  }).strict()).min(1).max(12),
  exclusions: z.array(z.string()),
  maxLearningUnitCount: z.number().int().min(1).max(200),
}).strict();

const recallVariantSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  slotMode: z.enum(["template", "filled_example"]),
  exampleSource: z.enum(["source", "generated"]),
  preservePlaceholders: z.boolean(),
  sample: z.object({
    title: z.string(),
    cue: z.string(),
    target: z.string(),
    supportingInfo: z.string(),
  }).strict(),
}).strict();

export const recallSchema = z.object({
  question: z.string(),
  recommendedOptionId: z.string(),
  options: z.array(z.object({
    id: z.string(),
    title: z.string(),
    cue: z.string(),
    target: z.string(),
    unit: z.string(),
    instruction: z.string(),
    mode: z.enum(["flashcard", "cloze", "translation"]),
    variants: z.array(recallVariantSchema).length(2),
  }).strict()).min(2).max(3),
}).strict();

export const prepareSchema = z.object({
  detectedGoal: z.string(),
  sourceType: z.enum(["concept", "comparison", "script", "definition", "mixed"]),
  keyTopics: z.array(z.string()),
  recommendedStrategy: z.string(),
  extractedMaterial: z.string(),
  primaryKnowledgeType: z.enum(knowledgeTypes),
  learningUnits: z.array(z.object({
    id: z.string(),
    sourceId: z.string(),
    sourcePage: z.number().int().min(0),
    sourceRange: z.string(),
    sourceText: z.string(),
    knowledgeType: z.enum(knowledgeTypes),
    fixedPart: z.string(),
    variableSlots: z.array(z.object({ name: z.string(), example: z.string() }).strict()),
    generalizedForm: z.string(),
    target: z.string(),
    operation: z.enum(["recall", "reconstruct", "discriminate", "apply"]),
    successCriterion: z.string(),
    rationale: z.string(),
  }).strict()).min(1),
}).strict();

export const cardSchema = z.object({
  type: z.enum(["flashcard", "cloze", "translation"]),
  activityType: z.enum(["flashcard", "true_false", "multiple_choice", "structure_recall"]),
  front: z.string(),
  back: z.string(),
  clozeText: z.string(),
  answer: z.string(),
  answers: z.array(z.string()),
  options: z.array(z.string()),
  correctOptionIndex: z.number().int(),
  correctBoolean: z.boolean(),
  structureNodes: z.array(z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    correctLabel: z.string(),
  }).strict()),
  structureRecallMode: z.enum(["word_bank", "free_input"]),
  recommendationReason: z.string(),
  hint: z.string(),
  tags: z.array(z.string()),
  basis: z.string(),
  learningUnitId: z.string(),
  objectiveId: z.string(),
  blueprintId: z.string(),
  strategy: z.enum(["production", "recognition", "concept", "contrast", "procedure", "application"]),
  sourceId: z.string(),
  sourcePage: z.number().int().min(0),
  sourceRange: z.string(),
  rationale: z.string(),
  difficulty: z.number().int().min(1).max(5),
  qualityPassed: z.boolean(),
  qualityNotes: z.array(z.string()),
  qualityStatus: z.enum(["not_run", "passed", "failed", "waived"]),
  explanation: z.string(),
}).strict();

export const cardsSchema = z.object({ cards: z.array(cardSchema).min(1) }).strict();

export const stageSchemas = {
  analyze: analyzeSchema,
  plan: planSchema,
  recall: recallSchema,
  prepare: prepareSchema,
  cards: cardsSchema,
} satisfies Record<JsonEngineStage, z.ZodType>;

export type AnalyzeOutput = z.infer<typeof analyzeSchema>;
export type PlanOutput = z.infer<typeof planSchema>;
export type RecallOutput = z.infer<typeof recallSchema>;
export type PrepareOutput = z.infer<typeof prepareSchema>;
export type CardsOutput = z.infer<typeof cardsSchema>;

export function responseJsonSchema(stage: JsonEngineStage) {
  const schema = z.toJSONSchema(stageSchemas[stage], { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
