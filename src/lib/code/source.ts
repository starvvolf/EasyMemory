// 주소로 문제 가져오기 (2026-10-28, docs/DECISIONS.md "코드 문제 받아오기"·"강의 글 → 문제 묶음"): the learner gives a
// blog or problem page address, or a Baekjoon number; this turns it into the text the problem maker reads. The app reads
// the page itself and the model sees only that text (사용자 선택 10/28: "1번 해보고 안 되면 바꿔").
//  - A Baekjoon number or address → the Internet Archive copy of the original (BOJ is closed).
//  - Any other page → its text. When the page points at exactly one Baekjoon problem, that original comes first
//    (출처는 아카이브 → 없으면 블로그); otherwise the page itself is the source.
//  - A page that is blocked, gone or empty is tried once more from the Internet Archive.
// Nothing here is saved to the public repository: the text goes to the problem maker, which keeps it in the data folder.
import { archivedBojProblem, archivedUrl, decodeEntities, htmlToText, type Fetcher, type Original } from "./archive.ts";
import { askJson, S } from "../assist/model.ts";
import { CodeError } from "./problems.ts";
import { note } from "./progress.ts";

export type Page = { url: string; title: string; text: string; links: string[] };
export type Resolved = { lesson: string; title: string; url: string; via: "boj-archive" | "page" | "page-archive" | "blog"; boj?: string;
  /** The archived Baekjoon original, when there is one: the independent solution can start from it at once. */ original?: Original };

const PAGE_TEXT_CAP = 30_000;
const absolute = (href: string, base: string) => { try { return new URL(decodeEntities(href), base).toString(); } catch { return ""; } };

/** Addresses that show more in another form: a Naver blog post as its inner frame, a GitHub file as raw text. */
export function readableUrl(url: string) {
  const naver = /^https?:\/\/(?:m\.)?blog\.naver\.com\/([^/?#]+)\/(\d+)/.exec(url);
  if (naver) return `https://blog.naver.com/PostView.naver?blogId=${naver[1]}&logNo=${naver[2]}`;
  return url.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, "https://raw.githubusercontent.com/$1/$2/").replace(/[?&]utm_[^&#]*/g, "").replace(/\?$/, "");
}

/** One page: its title, its text (lines and exponents kept) and the links in it. */
export async function fetchPage(url: string, fetcher: Fetcher = fetch): Promise<Page> {
  const response = await fetcher(url, { headers: { "user-agent": "Mozilla/5.0 (Recaller study importer)", accept: "text/html,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  const raw = (await response.text()).slice(0, 3_000_000);
  if (!/html/i.test(response.headers.get("content-type") ?? "") && !/<html|<body|<div/i.test(raw.slice(0, 2000))) return { url, title: url.split("/").pop() ?? url, text: raw.slice(0, PAGE_TEXT_CAP), links: [] };
  const title = htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? "");
  const body = /<article[\s\S]*<\/article>/i.exec(raw)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(raw)?.[0] ?? raw;
  const links = [...new Set([...body.matchAll(/<a\b[^>]*href="([^"#][^"]*)"/gi)].map((m) => absolute(m[1], url)).filter(Boolean))].slice(0, 300);
  return { url, title, text: htmlToText(body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, PAGE_TEXT_CAP), links };
}

/** Why a fetched page can't be used, or "" when it can. */
export function unusable(page: Page) {
  const head = page.text.slice(0, 3000);
  if (/captcha|로봇이 아닙니다|접근이 차단|로그인이 필요|please log ?in|cf-chl/i.test(head)) return "캡차나 로그인 화면이 나와요";
  if (/삭제된 (게시)?글|존재하지 않는 (게시)?글|page not found|404 not found/i.test(page.text.slice(0, 2000))) return "삭제됐거나 없는 글이에요";
  if (page.text.replace(/\s+/g, "").length < 200) return "글이 거의 없어요 (화면을 스크립트로만 그리는 페이지일 수 있어요)";
  return "";
}

/** The one Baekjoon problem a page is about (its address in the links, or "백준 1234" / "BOJ 1234" in the title), if exactly one. */
export function bojNumberOf(page: Page) {
  const fromLinks = new Set(page.links.flatMap((l) => { const m = /acmicpc\.net\/problem\/(\d{3,6})\b/.exec(l); return m ? [m[1]] : []; }));
  const fromTitle = /(?:백준|BOJ|boj|baekjoon)[^\d\n]{0,16}?(\d{3,6})\b/i.exec(page.title)?.[1];
  if (fromTitle && (!fromLinks.size || fromLinks.has(fromTitle))) return fromTitle;
  return fromLinks.size === 1 ? [...fromLinks][0] : undefined;
}

export const lessonOf = (o: Original, number: string) => [`[받아 온 문제] BOJ ${number}번: ${o.title}`, `문제\n${o.statement}`, `입력\n${o.inputText}`, `출력\n${o.outputText}`,
  ...o.examples.flatMap((ex, i) => [`예제 입력 ${i + 1}\n${ex.input}`, `예제 출력 ${i + 1}\n${ex.output}`])].join("\n\n");

/** An address or a Baekjoon number → the text to make a problem from. Refused (422) with a reason a learner can act on. */
/** 글을 못 읽음(막힌 페이지 · 사본 없음): 화면이 "비슷한 문제 가져오기 / 캡처나 글 넣기"를 묻는다(11/16 사용자). reason은 짧은 이유. */
export class UnreadableSource extends CodeError {
  reason: string;
  constructor(reason: string, message: string) { super(422, message); this.reason = reason; }
}

/** 이유를 이어지는 말로: "페이지를 열지 못했어요 (fetch failed)" → "페이지가 열리지 않고" */
const whyShort = (why: string) => /캡차|로그인/.test(why) ? "캡차나 로그인 화면이 나오고" : /삭제|없는 글/.test(why) ? "삭제됐거나 없는 글이고"
  : /거의 없어요/.test(why) ? "페이지에 글이 거의 없고(스크립트로만 그리는 페이지)" : "페이지가 열리지 않고";

export async function resolveSource(input: string, fetcher: Fetcher = fetch): Promise<Resolved> {
  const text = input.trim();
  const boj = /^(\d{3,6})$/.exec(text)?.[1] ?? /acmicpc\.net\/problem\/(\d{3,6})\b/.exec(text)?.[1];
  if (boj && !/^https?:\/\/(?!(?:www\.)?acmicpc\.net)/i.test(text)) {
    note(`백준 ${boj}번 원문을 인터넷 아카이브에서 찾고 있어요`);
    const original = await archivedBojProblem(boj, fetcher).catch(() => null);
    if (original) note(`원문을 찾았어요: ${original.title}`);
    if (!original) throw new UnreadableSource(`인터넷 아카이브에 백준 ${boj}번 원문 사본이 없어서`, `백준 ${boj}번 원문을 인터넷 아카이브에서 찾지 못했어요. 그 문제를 푼 블로그 주소를 넣거나 문제 글을 붙여 넣어 주세요.`);
    return { lesson: lessonOf(original, boj), title: `BOJ ${boj} ${original.title}`, url: original.url, via: "boj-archive", boj, original };
  }
  if (!/^https?:\/\//i.test(text)) throw new CodeError(400, "http(s)로 시작하는 주소나 백준 문제 번호를 넣어 주세요.");
  const url = readableUrl(text);
  let page: Page | null = null, why = "", via: Resolved["via"] = "page";
  note(`페이지를 읽고 있어요: ${(() => { try { return new URL(text).host; } catch { return text.slice(0, 40); } })()}`);
  try { page = await fetchPage(url, fetcher); why = unusable(page); }
  catch (e) { why = `페이지를 열지 못했어요 (${(e as Error).message})`; }
  if (!page || why) {
    note("페이지가 안 열려서 인터넷 아카이브 사본을 찾고 있어요");
    const copy = await archivedUrl(text, fetcher).catch(() => null);
    const archived = copy ? await fetchPage(copy, fetcher).catch(() => null) : null;
    if (!archived || unusable(archived)) throw new UnreadableSource(`${whyShort(why)} 인터넷 아카이브 사본도 없어서`, `${why}. 인터넷 아카이브 사본도 없어서 가져오지 못했어요. 글을 복사해서 붙여 넣어 주세요.`);
    page = { ...archived, url: text }; via = "page-archive";
  }
  // A page about one Baekjoon problem: the archived original is the answer key, when there is one.
  const number = bojNumberOf(page);
  if (number) {
    note(`이 글이 다루는 백준 ${number}번 원문을 찾고 있어요`);
    const original = await archivedBojProblem(number, fetcher).catch(() => null);
    if (original) return { lesson: `${lessonOf(original, number)}\n\n[참고: 이 문제를 다룬 글 ${text}]\n${page.text.slice(0, 8000)}`, title: `BOJ ${number} ${original.title}`, url: original.url, via: "boj-archive", boj: number, original };
  }
  return { lesson: `[가져온 글] ${page.title}\n${text}\n\n${page.text}`, title: page.title || text, url: text, via };
}

// 블로그에서 문제 글 찾기 (11/18 사용자 "백준이나 그런 사이트에서 찾았는데 없으면 블로그에서 찾아서 가져오게 해, 그래도 없으면 다른 선택지"):
// 문제 사이트(백준 원문 · 문제 페이지 · 아카이브)로 못 읽었을 때만 AI 웹 검색 1번으로 그 문제를 옮겨 적은 블로그 글 주소를 받고,
// 코드가 차례로 열어 입력 · 출력이 들어 있는 첫 글을 쓴다. 찾은 글은 데이터 폴더에만 남는다(공개 저장소에 올리지 않음).
export const BLOG_SYSTEM = `알고리즘 문제 하나의 원문(문제 설명 · 입력 · 출력 · 예제)을 옮겨 적은 블로그 글을 웹 검색으로 찾는다.
- 실제로 있는 글 주소만 적는다. 지어내지 않는다.
- 문제 사이트 자체(acmicpc.net, programmers.co.kr, codeforces.com 등)는 빼고, 블로그 · 풀이 글(티스토리, velog, 네이버 블로그, GitHub 등)만.
- 문제 설명 · 입력 · 출력 · 예제를 그대로 옮겨 적었을 가능성이 높은 글부터, 최대 5개.
- 같은 문제가 아닌 글(비슷한 다른 문제)은 넣지 않는다.`;
const BLOG_SCHEMA = S.obj({ posts: S.arr(S.obj({ url: S.str, title: S.str })) });
export type BlogAsk = (system: string, user: string) => Promise<{ posts: Array<{ url: string; title: string }> }>;
const blogAsk: BlogAsk = (system, user) => askJson("code:blog-find", system, user, BLOG_SCHEMA, { webSearch: true });
const PROBLEM_SITES = /(^|\.)(acmicpc\.net|programmers\.co\.kr|codeforces\.com|atcoder\.jp|swexpertacademy\.com|leetcode\.com|softeer\.ai)$/i;

/** 코드가 본다: 문제 글처럼 보이나(입력 · 출력이 다 있고 짧지 않음). */
export const looksLikeProblem = (text: string) => text.replace(/\s+/g, "").length >= 300 && /입력|input/i.test(text) && /출력|output/i.test(text);

/** 문제 사이트로 못 읽은 문제를 블로그 글에서 찾는다. 못 찾으면 null. what = 문제를 알 수 있는 말(번호 · 이름 · 주소). */
export async function problemFromBlogs(what: string, ask: BlogAsk = blogAsk, fetcher: Fetcher = fetch): Promise<Resolved | null> {
  const q = what.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!q) return null;
  note("문제 사이트에서 못 찾아서, 그 문제 글이 있는 블로그를 찾고 있어요");
  const reply = await ask(BLOG_SYSTEM, `[찾을 문제] ${q}`).catch(() => ({ posts: [] }));
  const seen = new Set<string>();
  const urls = (reply.posts ?? []).map((x) => (x.url ?? "").trim()).filter((u) => {
    let host = ""; try { host = new URL(u).host; } catch { return false; }
    const key = u.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (!/^https?:\/\//i.test(u) || PROBLEM_SITES.test(host) || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 5);
  if (!urls.length) { note("문제 글이 있는 블로그를 찾지 못했어요"); return null; }
  for (const url of urls) {
    const host = (() => { try { return new URL(url).host; } catch { return url.slice(0, 40); } })();
    note(`블로그 글을 읽고 있어요: ${host}`);
    const page = await fetchPage(readableUrl(url), fetcher).catch(() => null);
    if (!page || unusable(page) || !looksLikeProblem(page.text)) continue;
    note(`블로그 글에서 문제를 찾았어요: ${page.title || host}`);
    return { lesson: `[블로그에서 가져온 문제 글] ${page.title}\n${url}\n\n${page.text}`, title: page.title || q, url, via: "blog" };
  }
  note(`블로그 글 ${urls.length}개를 열어 봤지만 문제 글이 없었어요`);
  return null;
}
