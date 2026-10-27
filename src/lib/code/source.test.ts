// 주소로 문제 가져오기: a fake network — the archive, a Baekjoon original, blog pages — and what reaches the problem maker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bojNumberOf, readableUrl, resolveSource } from "./source.ts";

const BOJ = (n: string) => `<html><head><title>${n}번: 회사에 있는 사람</title></head><body><span id="problem_title">회사에 있는 사람</span>
<div id="problem_description"><p>출입 기록이 주어질 때 회사에 남아 있는 사람을 구하라. 1 ≤ n ≤ 10<sup>6</sup></p></div>
<div id="problem_input"><p>첫 줄에 n</p></div><div id="problem_output"><p>사전 역순으로 출력</p></div>
<pre id="sample-input-1">4
Baha enter
Askar enter
Baha leave
Artem enter</pre><pre id="sample-output-1">Askar
Artem</pre></body></html>`;
const LONG = "이 글은 해시를 써서 푸는 방법을 설명한다. ".repeat(20);
const html = (title: string, body: string) => new Response(`<html><head><title>${title}</title></head><body><nav>메뉴 메뉴</nav><article>${body}</article></body></html>`, { headers: { "content-type": "text/html" } });

function net(pages: Record<string, () => Response>, archived: Record<string, string> = {}) {
  const seen: string[] = [];
  const fetcher = async (url: string) => {
    seen.push(url);
    const wayback = /archive\.org\/wayback\/available\?url=(.*)$/.exec(url);
    if (wayback) { const u = decodeURIComponent(wayback[1]); const ts = archived[u]; return Response.json({ archived_snapshots: ts ? { closest: { available: true, status: "200", timestamp: ts } } : {} }); }
    const page = pages[url];
    return page ? page() : new Response("없음", { status: 404 });
  };
  return { fetcher, seen };
}
const ARCH = (u: string) => `https://web.archive.org/web/20260426000000id_/${u}`;

test("a Baekjoon number becomes the archived original, examples and all", async () => {
  const { fetcher } = net({ [ARCH("https://www.acmicpc.net/problem/7785")]: () => new Response(BOJ("7785")) }, { "https://www.acmicpc.net/problem/7785": "20260426000000" });
  const got = await resolveSource("7785", fetcher);
  assert.equal(got.via, "boj-archive");
  assert.equal(got.boj, "7785");
  assert.match(got.lesson, /\[받아 온 문제\] BOJ 7785번: 회사에 있는 사람/);
  assert.match(got.lesson, /10\^6/, "exponents survive");
  assert.match(got.lesson, /예제 입력 1\n4\nBaha enter/);
  assert.match(got.lesson, /예제 출력 1\nAskar\nArtem/);
  const viaAddress = await resolveSource("https://www.acmicpc.net/problem/7785", fetcher);
  assert.equal(viaAddress.via, "boj-archive");
});

test("a blog post about one Baekjoon problem: the original comes first, the post rides along", async () => {
  const post = "https://blog.example.com/123";
  const { fetcher } = net({
    [post]: () => html("[백준] 7785 회사에 있는 사람 풀이", `<p>${LONG}</p><a href="https://www.acmicpc.net/problem/7785">문제 링크</a><pre>set을 쓴다</pre>`),
    [ARCH("https://www.acmicpc.net/problem/7785")]: () => new Response(BOJ("7785")),
  }, { "https://www.acmicpc.net/problem/7785": "20260426000000" });
  const got = await resolveSource(post, fetcher);
  assert.equal(got.via, "boj-archive");
  assert.match(got.lesson, /예제 입력 1/);
  assert.match(got.lesson, /\[참고: 이 문제를 다룬 글 https:\/\/blog\.example\.com\/123\]/);
  assert.match(got.lesson, /set을 쓴다/);
  assert.doesNotMatch(got.lesson, /메뉴 메뉴/, "navigation is dropped");
});

test("a lesson page with no single problem: the page text itself", async () => {
  const lesson = "https://blog.example.com/lesson";
  const { fetcher } = net({ [lesson]: () => html("해시 강의", `<p>${LONG}</p><a href="https://www.acmicpc.net/problem/1000">1</a><a href="https://www.acmicpc.net/problem/2000">2</a>`) });
  const got = await resolveSource(lesson, fetcher);
  assert.equal(got.via, "page");
  assert.match(got.lesson, /^\[가져온 글\] 해시 강의/);
  assert.equal(got.url, lesson);
});

test("a blocked or empty page is tried once from the archive; with no copy, the learner is told what to do", async () => {
  const post = "https://blog.example.com/gone";
  const ok = net({ [post]: () => html("x", "<p>로그인이 필요합니다</p>"), [ARCH(post)]: () => html("보관본", `<p>${LONG}</p>`) }, { [post]: "20260426000000" });
  const got = await resolveSource(post, ok.fetcher);
  assert.equal(got.via, "page-archive");
  assert.match(got.lesson, /보관본/);
  const none = net({ [post]: () => html("x", "<p>짧음</p>") });
  await assert.rejects(resolveSource(post, none.fetcher), /글이 거의 없어요.*붙여 넣어 주세요/);
  await assert.rejects(resolveSource("hello", none.fetcher), /주소나 백준 문제 번호/);
  await assert.rejects(resolveSource("99999", none.fetcher), /99999번 원문을 인터넷 아카이브에서 찾지 못했어요/);
});

test("addresses that read better in another form, and how a page names its problem", () => {
  assert.equal(readableUrl("https://blog.naver.com/someone/22334455"), "https://blog.naver.com/PostView.naver?blogId=someone&logNo=22334455");
  assert.equal(readableUrl("https://github.com/a/b/blob/main/x.cpp"), "https://raw.githubusercontent.com/a/b/main/x.cpp");
  const page = (title: string, links: string[] = []) => ({ url: "", title, text: "", links });
  assert.equal(bojNumberOf(page("[BOJ] 1920 수 찾기")), "1920");
  assert.equal(bojNumberOf(page("백준 2805번 나무 자르기")), "2805");
  assert.equal(bojNumberOf(page("풀이", ["https://www.acmicpc.net/problem/1654"])), "1654");
  assert.equal(bojNumberOf(page("풀이", ["https://www.acmicpc.net/problem/1000", "https://www.acmicpc.net/problem/2000"])), undefined);
});
