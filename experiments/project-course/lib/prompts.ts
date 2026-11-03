// 고칠 수 있는 프롬프트(11/4 사용자 "앞서 한 대화 내역만 고정으로 붙게 하고, 다른 건 다 수정 가능하게"):
// 튜터에게 가는 것 중 대화 내역(앞부분 요약 · 최근 대화 · 지난 질문 뒤 화면)만 코드가 그대로 붙이고,
// 나머지(고정 지시문 · 첫 차례 맥락 · 매 차례 맥락 · [막혔어요] 규칙 · 코스 생성 지시 · 파일 붙이기)는 실험방에서 글로 고친다.
// 맥락 틀은 {자리표시}로 값을 넣는다. 값이 빈 자리만 남은 줄은 빠진다. 저장하면 다음 답부터 바로 쓰인다(.data/control/prompts.json)
import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA, update } from "./store.ts";

const FILE = () => path.join(DATA, "control", "prompts.json");
let cache: Record<string, string> | null = null;
function load() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(FILE(), "utf8")); } catch { cache = {}; }
  return cache!;
}

/** 고친 값이 있으면 그것, 없으면 기본값 */
export function promptOf(key: string, def: string) {
  const v = load()[key];
  return typeof v === "string" && v.trim() ? v : def;
}
export const changed = (key: string) => { const v = load()[key]; return typeof v === "string" && !!v.trim(); };

/** 저장(빈 글이면 기본값으로 되돌림) */
export async function setPrompt(key: string, text: string) {
  const t = String(text ?? "").slice(0, 40000);
  await update<Record<string, string>>(FILE(), {}, (s) => { if (t.trim()) s[key] = t; else delete s[key]; });
  cache = null;
  return promptOf(key, "");
}

/** {자리표시}를 값으로 바꾼다. 그 줄의 자리표시가 모두 비면 줄째 뺀다. 모르는 {이름}은 그대로 둔다 */
export function render(tpl: string, vars: Record<string, string>) {
  const lines = tpl.split("\n").map((line) => {
    const keys = [...line.matchAll(/\{([^{}\n]+)\}/g)].map((m) => m[1]).filter((k) => k in vars);
    const out = line.replace(/\{([^{}\n]+)\}/g, (all, k) => (k in vars ? vars[k] : all));
    // 그 줄의 자리표시가 모두 비면 줄째 뺀다("강사 메모: {강사메모}"에서 메모가 없으면 줄이 사라짐)
    return keys.length && keys.every((k) => !String(vars[k] ?? "").trim()) ? null : out;
  });
  return lines.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- 기본 틀(지금까지 코드가 만들던 것과 같은 모양) ---------- */
export const DEFAULT_FIXED = `[코스] {코스이름}
{학습자목표}
{코스순서}

[이번 단계] {단계번호}단계 {단계이름} — {단계목표}
가르칠 것: {가르칠것}
학습자가 직접 고칠 곳: {고칠곳}
강사 메모: {강사메모}
미리 말하지 않을 것: {숨길것}. 그 밖에 왜 그런지는 물으면 설명한다.`;

export const DEFAULT_TURN = `{학습자상태}
{지금위치}
{지금화면}
{개념}
{기초}
{고른코드}
{막혔어요}
{추가지시}`;

/** 실험방에서 보여 줄 고칠 수 있는 것들(기본값은 server가 각 모듈에서 채운다) */
export const EDITABLE: { key: string; label: string; where: string; vars?: string[] }[] = [
  { key: "system", label: "고정 지시문", where: "모델 지시문(instructions) 맨 앞. 튜터의 역할 · 말투 · 도구 쓰는 법 · 가르치는 순서. 바꾸면 그 대화의 캐시는 한 번 안 맞아요." },
  { key: "fixedTpl", label: "첫 차례 맥락 (코스 · 이번 단계)", where: "대화의 첫 메시지와 단계가 바뀔 때 한 번 붙어요.",
    vars: ["코스이름", "학습자목표", "코스순서", "단계번호", "단계이름", "단계목표", "가르칠것", "고칠곳", "강사메모", "숨길것"] },
  { key: "turnTpl", label: "매 차례 맥락", where: "질문할 때마다 대화 뒤, 학습자 말 앞에 붙어요.",
    vars: ["학습자상태", "지금위치", "지금화면", "개념", "기초", "고른코드", "막혔어요", "추가지시"] },
  { key: "stuckRoot", label: "[막혔어요] 처음 막힌 줄 규칙", where: "막혔어요 중, 지금 칸이 처음 막힌 줄일 때 {막혔어요} 안에 들어가요." },
  { key: "stuckChild", label: "[막혔어요] 아래 칸 규칙", where: "막혔어요 중, 아래 칸(기초)일 때 {막혔어요} 안에 들어가요." },
  { key: "files", label: "파일 붙이기", where: "on이면 질문에 나온 파일 · 고칠 파일을 줄 번호와 함께 매 차례 붙여요(바뀐 것만). off면 튜터가 필요할 때 read로 읽어요." },
  { key: "genPlan", label: "코스 생성: 목차 지시", where: "AI 코스를 만들 때 목차를 짜는 호출의 지시문." },
  { key: "genStage", label: "코스 생성: 단계 지시", where: "AI 코스를 만들 때 단계 하나를 만드는 호출의 지시문." },
];
