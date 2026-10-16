export type ConceptTreeSourceMode = "pdf" | "topic";

export type ConceptTreeSourceFile = {
  fileName: string;
  pageCount?: number;
};

export type ConceptTreeSourceRef = {
  fileName: string;
  pageNumbers: number[];
};

export type ConceptTreeNode = {
  id: string;
  parentId: string | null;
  order: number;
  depth: number;
  title: string;
  relation: string;
  description: string;
  sourceRefs: ConceptTreeSourceRef[];
};

export type ConceptTree = {
  id: string;
  runId: string;
  title: string;
  sourceMode: ConceptTreeSourceMode;
  sourceLabel: string;
  topic?: string;
  files: ConceptTreeSourceFile[];
  outlineText: string;
  nodes: ConceptTreeNode[];
  warnings: string[];
  createdAt: string;
};

export type ConceptTreeRun = {
  id: string;
  title: string;
  sourceMode: ConceptTreeSourceMode;
  sourceLabel: string;
  topic?: string;
  files: ConceptTreeSourceFile[];
  instruction: string;
  status: "awaiting_outline" | "completed";
  createdAt: string;
  tree?: ConceptTree;
};
