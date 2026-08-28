import type {
  ConceptTreeNode,
  ConceptTreeSourceFile,
  ConceptTreeSourceRef,
} from "./types.ts";

type ParsedLine = {
  depth: number;
  title: string;
  relation: string;
  description: string;
  sourceRefs: ConceptTreeSourceRef[];
};

const MAX_NODES = 200;
const MAX_DEPTH = 6;

export function parseConceptTreeOutline(
  outlineText: string,
  files: ConceptTreeSourceFile[] = [],
) {
  const lines = outlineText
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) throw new Error("개념트리 내용이 비어 있습니다.");
  if (lines.length > MAX_NODES) {
    throw new Error(`개념트리는 최대 ${MAX_NODES}개 노드까지 만들 수 있습니다.`);
  }

  const parsed = lines.map((line, index) => parseLine(line, index, files));
  if (parsed[0].depth !== 0) throw new Error("첫 줄에는 최상위 개념 하나를 적어야 합니다.");
  if (parsed.slice(1).some((line) => line.depth === 0)) {
    throw new Error("최상위 개념은 하나만 둘 수 있습니다.");
  }

  const nodes: ConceptTreeNode[] = [];
  const parentAtDepth = new Map<number, ConceptTreeNode>();
  const siblingCounts = new Map<string, number>();
  const siblingTitles = new Set<string>();

  for (const [index, line] of parsed.entries()) {
    if (line.depth > MAX_DEPTH) {
      throw new Error(`개념트리 깊이는 최대 ${MAX_DEPTH}단계까지 허용됩니다.`);
    }
    const parent = line.depth === 0 ? null : parentAtDepth.get(line.depth - 1);
    if (line.depth > 0 && !parent) {
      throw new Error(`${index + 1}번째 줄이 중간 단계를 건너뛰었습니다.`);
    }
    const parentKey = parent?.id ?? "root";
    const normalizedTitle = normalize(line.title);
    const siblingKey = `${parentKey}:${normalizedTitle}`;
    if (siblingTitles.has(siblingKey)) {
      throw new Error(`같은 위치에 중복된 개념이 있습니다: ${line.title}`);
    }
    siblingTitles.add(siblingKey);
    const order = (siblingCounts.get(parentKey) ?? 0) + 1;
    siblingCounts.set(parentKey, order);
    const node: ConceptTreeNode = {
      id: `concept-${String(index + 1).padStart(3, "0")}`,
      parentId: parent?.id ?? null,
      order,
      depth: line.depth,
      title: line.title,
      relation: line.relation,
      description: line.description,
      sourceRefs: line.sourceRefs,
    };
    nodes.push(node);
    parentAtDepth.set(line.depth, node);
    for (const depth of [...parentAtDepth.keys()]) {
      if (depth > line.depth) parentAtDepth.delete(depth);
    }
  }

  return nodes;
}

function parseLine(
  rawLine: string,
  index: number,
  files: ConceptTreeSourceFile[],
): ParsedLine {
  const leading = rawLine.match(/^ */)?.[0].length ?? 0;
  const trimmed = rawLine.trim();
  const bullet = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
  const depth = index === 0 && !bullet ? 0 : Math.floor(leading / 2) + 1;
  if (index > 0 && !bullet) {
    throw new Error(`${index + 1}번째 줄은 '- 개념어' 형식으로 적어야 합니다.`);
  }
  if (leading % 2 !== 0) {
    throw new Error(`${index + 1}번째 줄의 들여쓰기는 두 칸 단위여야 합니다.`);
  }
  let body = (bullet?.[1] ?? trimmed).trim();
  const source = parseSourceHint(body, files);
  body = source.body;

  const relationMatch = body.match(/^\[([^\]]+)]\s*(.+)$/);
  const relation = cleanText(relationMatch?.[1] ?? "", 40, "관계");
  body = relationMatch?.[2]?.trim() ?? body;
  const descriptionParts = body.split(/\s+[—–]\s+/, 2);
  const title = cleanText(descriptionParts[0] ?? "", 100, "개념어");
  const description = cleanText(descriptionParts[1] ?? "", 300, "설명");
  if (!title) throw new Error(`${index + 1}번째 줄의 개념어가 비어 있습니다.`);

  return { depth, title, relation, description, sourceRefs: source.refs };
}

function parseSourceHint(body: string, files: ConceptTreeSourceFile[]) {
  const match = body.match(/\s*\((?:(.+?)\s+)?p\.?\s*(\d+(?:\s*[-,]\s*\d+)*)\)\s*$/i);
  if (!match) return { body, refs: [] as ConceptTreeSourceRef[] };
  const hintedName = match[1]?.trim();
  const fileName = hintedName || (files.length === 1 ? files[0].fileName : "");
  if (!fileName) {
    throw new Error("PDF가 여러 개이면 페이지 앞에 파일명을 함께 적어야 합니다.");
  }
  const known = files.find((file) => file.fileName === fileName);
  if (files.length > 0 && !known) throw new Error(`등록되지 않은 PDF 파일명입니다: ${fileName}`);
  const pageNumbers = expandPageNumbers(match[2]);
  if (known?.pageCount && pageNumbers.some((page) => page > known.pageCount!)) {
    throw new Error(`${fileName}의 전체 페이지보다 큰 출처 페이지가 있습니다.`);
  }
  return {
    body: body.slice(0, match.index).trim(),
    refs: [{ fileName, pageNumbers }],
  };
}

function expandPageNumbers(value: string) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end < start || end - start > 50) throw new Error("출처 페이지 범위가 올바르지 않습니다.");
      for (let page = start; page <= end; page += 1) pages.add(page);
      continue;
    }
    const page = Number(part.trim());
    if (!Number.isInteger(page) || page < 1) throw new Error("출처 페이지가 올바르지 않습니다.");
    pages.add(page);
  }
  return [...pages].sort((left, right) => left - right);
}

function cleanText(value: string, maximumLength: number, label: string) {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length > maximumLength) throw new Error(`${label}은 ${maximumLength}자 이내로 적어야 합니다.`);
  return clean;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}
