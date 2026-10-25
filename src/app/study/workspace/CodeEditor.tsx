"use client";
// Monaco (the VS Code editor), loaded once from jsDelivr so Recaller needs no extra package. Without a connection the
// editor falls back to a plain text area that still runs and submits.
import { useEffect, useRef, useState } from "react";

const BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";
type MonacoEditor = { getValue(): string; setValue(v: string): void; getModel(): { getValueInRange(r: unknown): string } | null; getSelection(): unknown; dispose(): void;
  onDidChangeModelContent(cb: () => void): void; updateOptions(o: Record<string, unknown>): void; layout(): void };
type Monaco = { editor: { create(el: HTMLElement, o: Record<string, unknown>): MonacoEditor; setModelLanguage(m: unknown, l: string): void; setTheme(t: string): void } };
type Loader = { config(o: unknown): void; (deps: string[], ok: () => void, fail: (e: unknown) => void): void };
const holder = globalThis as unknown as { __monaco?: Promise<Monaco>; monaco?: Monaco; require?: Loader; MonacoEnvironment?: unknown };

function loadMonaco(): Promise<Monaco> {
  if (holder.__monaco) return holder.__monaco;
  holder.__monaco = new Promise<Monaco>((resolve, reject) => {
    holder.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${BASE}/'};importScripts('${BASE}/vs/base/worker/workerMain.js');`)}` };
    const script = document.createElement("script");
    script.src = `${BASE}/vs/loader.js`;
    script.onload = () => {
      const req = holder.require!;
      req.config({ paths: { vs: `${BASE}/vs` } });
      req(["vs/editor/editor.main"], () => resolve(holder.monaco!), reject);
    };
    script.onerror = () => { holder.__monaco = undefined; reject(new Error("편집기를 불러오지 못했어요.")); };
    document.head.appendChild(script);
  });
  return holder.__monaco;
}
const MONACO_LANG: Record<string, string> = { python: "python", javascript: "javascript", cpp: "cpp", csharp: "csharp" };
export type EditorHandle = { selection: () => string; value: () => string };

export function CodeEditor({ value, lang, onChange, handle }: { value: string; lang: string; onChange: (v: string) => void; handle: (h: EditorHandle) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MonacoEditor | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [fallback, setFallback] = useState(false);
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; }, [onChange]);

  useEffect(() => {
    let gone = false;
    const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
    loadMonaco().then((monaco) => {
      if (gone || !host.current) return;
      const ed = monaco.editor.create(host.current, { value, language: MONACO_LANG[lang] ?? "plaintext", theme: dark ? "vs-dark" : "vs", automaticLayout: true, minimap: { enabled: false },
        fontSize: 14, tabSize: 4, scrollBeyondLastLine: false, fontFamily: "ui-monospace, Consolas, Menlo, monospace", renderWhitespace: "selection" });
      ed.onDidChangeModelContent(() => latest.current(ed.getValue()));
      editor.current = ed;
      handle({ value: () => ed.getValue(), selection: () => { const m = ed.getModel(); return m ? m.getValueInRange(ed.getSelection()) : ""; } });
    }).catch(() => { if (!gone) setFallback(true); });
    return () => { gone = true; editor.current?.dispose(); editor.current = null; };
    // The editor is made once; value and language changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const ed = editor.current; if (ed && ed.getValue() !== value) ed.setValue(value); }, [value]);
  useEffect(() => {
    const ed = editor.current; const monaco = holder.monaco;
    if (ed && monaco) monaco.editor.setModelLanguage(ed.getModel(), MONACO_LANG[lang] ?? "plaintext");
  }, [lang]);
  useEffect(() => {
    if (!fallback) return;
    handle({ value: () => area.current?.value ?? "", selection: () => { const a = area.current; return a ? a.value.slice(a.selectionStart, a.selectionEnd) : ""; } });
  }, [fallback, handle]);

  if (fallback) return <textarea ref={area} className="cs-plain" value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} aria-label="코드"
    onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const a = e.currentTarget; const s = a.selectionStart; const next = `${a.value.slice(0, s)}    ${a.value.slice(a.selectionEnd)}`; onChange(next); requestAnimationFrame(() => { a.selectionStart = a.selectionEnd = s + 4; }); } }} />;
  return <div ref={host} className="cs-monaco" aria-label="코드 편집기" />;
}
