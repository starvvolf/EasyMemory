"use client";
// 기억 화면 조각 (11/12 A 정리): 예전 기억 창(KnowledgeWindow, 11/11부터 안 열림)에서 지금 화면이 쓰는 것만 옮겨 왔다.
// StateChip(앎·졸업 표시) · tidyLine(카드 모양 뜻을 한 줄로) · MaterialRow(자료 목록 한 줄) · MaterialArticle(웹 글 자료의 글 지도).
import { useEffect, useState } from "react";
import { call, errorText, go, later, STATE_LABEL, type KState } from "./api";
import { ArticleMap, type SourceView } from "./ArticleStudy";

const stateClass: Record<KState, string> = { met: "met", unknown: "bad", known: "good" };

export function StateChip({ state, graduated }: { state: KState; graduated?: boolean }) {
  // 11/9 사용자 "만남/몰랐음도 일단 다 숨겨봐": 앎·졸업만 글자로 보인다.
  if (!graduated && (state === "met" || state === "unknown")) return null;
  return <span className={`chip ws-st ${stateClass[state]}`}>{graduated ? "졸업" : STATE_LABEL[state]}</span>;
}

// [경계] 2026-11-02 A (점검_UIUX화면연결 12번): PDF 카드 모양이 그대로 들어온 뜻("A vs B: 기준=a/b; …", "기준=a/b")을
// 읽는 꼴로, 줄 끝에서 잘린 수식($가 홀수)은 잘린 수식째 뺀다. 저장된 글은 그대로 두고 보여 줄 때만.
const SHAPE_KV = /^[^=\n$]{0,23}[^\s=]=[^\s=]/;
/** Split on "/" outside $…$ (a formula's own slash stays). */
function slashSplit(v: string) { const out: string[] = []; let cur = "", math = false; for (const ch of v) { if (ch === "$") math = !math; if (ch === "/" && !math) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; }
function kvLines(rest: string, a?: string, b?: string) {
  return rest.split(/;\s*(?=[^=;]{1,24}=)/).map((seg) => {
    const i = seg.indexOf("="); if (i < 0) return seg.trim();
    const k = seg.slice(0, i).trim(), v = seg.slice(i + 1).trim(), parts = slashSplit(v);
    if (a && b && parts.length === 2) return `- **${k}** · ${a}: ${parts[0]} / ${b}: ${parts[1]}`;
    return `- **${k}**: ${parts.join(" / ")}`;
  }).join("\n");
}
function tidyMeaning(text: string) {
  const t = text.trim();
  const vs = /^([^\n]{1,60}?) vs ([^\n]{1,60}?):\s*([\s\S]+)$/.exec(t);
  if (vs && SHAPE_KV.test(vs[3])) return `${vs[1]}와(과) ${vs[2]}\n${kvLines(vs[3], vs[1], vs[2])}`;
  if (SHAPE_KV.test(t) && !/[.다]\s/.test(t.split("=")[0])) return kvLines(t);
  return t;
}
export function tidyLine(text: string) {
  let t = tidyMeaning(text).replace(/^- /gm, "").replace(/\*\*/g, "").replace(/\n+/g, " · ");
  if ((t.match(/\$/g) ?? []).length % 2) t = t.slice(0, t.lastIndexOf("$")).trimEnd() + " …";
  return t;
}

export type MaterialRow = { key: string; group: "material" | "project" | "code"; kind: string; title: string; items: number; itemIds: string[]; lastAt: string; keys: string[];
  folderId: string | null; genId?: string; sourceId?: string; stages?: Array<{ name: string; itemIds: string[] }> };

/** 웹 글 자료: its 글 지도 (질문·흐름·핵심·개념어), the same one the 웹 글 screen shows. */
export function MaterialArticle({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [source, setSource] = useState<SourceView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => later(() => void call<{ source: SourceView }>(`/api/knowledge/source/${id}`).then((r) => setSource(r.source)).catch((e) => setError(errorText(e)))), [id]);
  if (error) return <p className="ws-err">{error}</p>;
  if (!source) return <p className="small muted">글 지도를 불러오는 중…</p>;
  if (!source.map) return <div className="stack"><p className="small muted">이 글은 글 지도 전에 읽은 글이에요.</p><button className="btn small" onClick={() => go("web", { id })}>웹 글 화면에서 열기</button></div>;
  return <div className="stack"><ArticleMap source={source} onChanged={(s) => { setSource(s); onChanged(); }} /><button className="linkish small" onClick={() => go("web", { id })}>웹 글 화면에서 열기 (확인 문제·원문)</button></div>;
}
