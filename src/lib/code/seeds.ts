// 기본 코드 문제: original problems on the first topics of an algorithm course (탐색, 누적 합, 투 포인터), written for
// Recaller (not copied from any judge). Test inputs come from a fixed random seed; outputs come from the reference.
import type { Lang } from "./run.ts";

export type Seed = {
  id: string; title: string; statement: string; inputText: string; outputText: string; kind: "full" | "blank";
  exampleInputs: string[]; testInputs: () => string[]; reference: string; knowledge: string[]; folder: string;
  templates?: Partial<Record<Lang, string>>; timeLimitMs?: number;
};

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const distinct = (r: () => number, n: number, lo: number, hi: number) => { const s = new Set<number>(); while (s.size < n) s.add(int(r, lo, hi)); return [...s]; };

const READ_JS = "const d = require(\"fs\").readFileSync(0, \"utf8\").trim().split(/\\s+/).map(Number);\nlet p = 0;\n";

export const SEEDS: Seed[] = [
  {
    id: "cp_seed_find_cards", title: "가진 카드 확인하기", kind: "full", folder: "알고리즘/이분 탐색", knowledge: ["이분 탐색", "정렬"],
    statement: "정수가 하나씩 적힌 카드 N장을 가지고 있다. 정수 M개가 주어질 때, 각 정수가 적힌 카드를 가지고 있는지 확인하자.\n\nN과 M이 커서 하나하나 다 비교하면 늦다. 카드를 정렬해 두고 절반씩 버리며 찾는 방법을 떠올려 보자.",
    inputText: "첫 줄에 N (1 ≤ N ≤ 200,000)\n둘째 줄에 카드에 적힌 정수 N개 (절댓값 10억 이하, 서로 다름)\n셋째 줄에 M (1 ≤ M ≤ 200,000)\n넷째 줄에 확인할 정수 M개",
    outputText: "확인할 정수마다 가지고 있으면 1, 없으면 0을 공백으로 구분해 한 줄에 출력한다.",
    exampleInputs: ["5\n6 3 2 10 -10\n8\n10 9 -5 2 3 4 5 -10\n", "1\n7\n3\n7 8 -7\n"],
    testInputs: () => {
      const r = rng(11); const out: string[] = [];
      for (const [n, m, span] of [[1, 1, 5], [3, 5, 5], [10, 10, 20], [100, 100, 150], [2000, 2000, 5000], [200000, 200000, 1_000_000_000]] as const) {
        const a = distinct(r, n, -span, span); const q = Array.from({ length: m }, () => r() < 0.5 ? a[int(r, 0, n - 1)] : int(r, -span, span));
        out.push(`${n}\n${a.join(" ")}\n${m}\n${q.join(" ")}\n`);
      }
      return out;
    },
    reference: `${READ_JS}const n = d[p++]; const a = d.slice(p, p + n); p += n; const m = d[p++];\nconst s = new Set(a); const out = [];\nfor (let i = 0; i < m; i++) out.push(s.has(d[p++]) ? 1 : 0);\nconsole.log(out.join(" "));\n`,
  },
  {
    id: "cp_seed_first_at_least", title: "처음으로 x 이상인 자리", kind: "full", folder: "알고리즘/이분 탐색", knowledge: ["lower_bound", "이분 탐색"],
    statement: "오름차순으로 정렬된 수열 A가 있다 (같은 수가 여러 번 나올 수 있다). 질문마다 정수 x가 주어지면, A에서 x 이상인 수가 처음 나오는 위치를 0부터 세어 출력하자. 그런 수가 없으면 N을 출력한다.\n\n같은 수가 여러 개일 때 어느 쪽 끝을 찾는지, 그리고 찾는 범위의 끝을 어디로 잡는지가 핵심이다.",
    inputText: "첫 줄에 N (1 ≤ N ≤ 100,000)\n둘째 줄에 오름차순으로 정렬된 정수 N개 (0 이상 10억 이하)\n셋째 줄에 Q (1 ≤ Q ≤ 100,000)\n이어서 Q줄에 x",
    outputText: "질문마다 한 줄에 위치를 출력한다.",
    exampleInputs: ["6\n1 3 3 3 7 9\n5\n3\n0\n4\n9\n10\n"],
    testInputs: () => {
      const r = rng(23); const out: string[] = [];
      for (const [n, q, span] of [[1, 3, 3], [5, 8, 4], [20, 30, 10], [1000, 1000, 300], [100000, 100000, 1_000_000_000]] as const) {
        const a = Array.from({ length: n }, () => int(r, 0, span)).sort((x, y) => x - y);
        const xs = Array.from({ length: q }, () => r() < 0.4 ? a[int(r, 0, n - 1)] : int(r, 0, span + 1));
        out.push(`${n}\n${a.join(" ")}\n${q}\n${xs.join("\n")}\n`);
      }
      return out;
    },
    reference: `${READ_JS}const n = d[p++]; const a = d.slice(p, p + n); p += n; const q = d[p++]; const out = [];\nfor (let i = 0; i < q; i++) { const x = d[p++]; let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] >= x) hi = mid; else lo = mid + 1; } out.push(lo); }\nconsole.log(out.join("\\n"));\n`,
  },
  {
    id: "cp_seed_range_sum", title: "구간 합 빠르게 구하기", kind: "full", folder: "알고리즘/누적 합", knowledge: ["누적 합", "자료형 범위(오버플로)"],
    statement: "수 N개가 주어지고, 질문마다 l번째부터 r번째 수까지의 합을 구해야 한다. 질문이 많으므로 매번 더하면 늦다.\n\n미리 앞에서부터의 합을 만들어 두면 질문 하나를 뺄셈 한 번으로 답할 수 있다. 합이 얼마나 커질 수 있는지도 계산해 보자.",
    inputText: "첫 줄에 N과 Q (1 ≤ N, Q ≤ 100,000)\n둘째 줄에 정수 N개 (각각 1 이상 1,000,000 이하)\n이어서 Q줄에 l r (1 ≤ l ≤ r ≤ N)",
    outputText: "질문마다 한 줄에 합을 출력한다.",
    exampleInputs: ["5 3\n5 4 3 2 1\n1 3\n2 4\n5 5\n"],
    testInputs: () => {
      const r = rng(37); const out: string[] = [];
      for (const [n, q, top] of [[1, 1, 10], [5, 5, 10], [50, 50, 100], [100000, 100000, 1_000_000]] as const) {
        const a = Array.from({ length: n }, () => int(r, 1, top));
        const qs = Array.from({ length: q }, (_, i) => { if (i === 0) return `1 ${n}`; const l = int(r, 1, n); return `${l} ${int(r, l, n)}`; });
        out.push(`${n} ${q}\n${a.join(" ")}\n${qs.join("\n")}\n`);
      }
      return out;
    },
    reference: `${READ_JS}const n = d[p++], q = d[p++]; const s = new Array(n + 1).fill(0);\nfor (let i = 1; i <= n; i++) s[i] = s[i - 1] + d[p++];\nconst out = []; for (let i = 0; i < q; i++) { const l = d[p++], r = d[p++]; out.push(s[r] - s[l - 1]); }\nconsole.log(out.join("\\n"));\n`,
  },
  {
    id: "cp_seed_pair_sum", title: "합이 X인 두 수", kind: "full", folder: "알고리즘/투 포인터", knowledge: ["투 포인터", "정렬"],
    statement: "서로 다른 양의 정수 N개와 정수 X가 주어진다. 두 수를 골라 합이 X가 되는 쌍이 몇 개인지 세자 (순서만 다른 쌍은 하나로 센다).\n\n정렬한 뒤 양 끝에서 두 위치를 좁혀 오면 모든 쌍을 보지 않고도 셀 수 있다.",
    inputText: "첫 줄에 N (1 ≤ N ≤ 100,000)\n둘째 줄에 서로 다른 정수 N개 (1 이상 1,000,000 이하)\n셋째 줄에 X (1 ≤ X ≤ 2,000,000)",
    outputText: "쌍의 개수를 출력한다.",
    exampleInputs: ["9\n5 12 7 10 9 1 2 3 11\n13\n"],
    testInputs: () => {
      const r = rng(41); const out: string[] = [];
      for (const [n, span] of [[1, 10], [2, 10], [10, 30], [1000, 3000], [100000, 1_000_000]] as const) {
        const a = distinct(r, n, 1, span); const x = r() < 0.7 ? a[int(r, 0, n - 1)] + a[int(r, 0, n - 1)] : int(r, 1, span * 2);
        out.push(`${n}\n${a.join(" ")}\n${x}\n`);
      }
      return out;
    },
    reference: `${READ_JS}const n = d[p++]; const a = d.slice(p, p + n).sort((x, y) => x - y); p += n; const x = d[p++];\nlet i = 0, j = n - 1, c = 0; while (i < j) { const s = a[i] + a[j]; if (s === x) { c++; i++; j--; } else if (s < x) i++; else j--; }\nconsole.log(c);\n`,
  },
  {
    id: "cp_seed_blank_search", title: "빈칸 채우기: 이분 탐색", kind: "blank", folder: "알고리즘/이분 탐색", knowledge: ["이분 탐색", "탐색 범위의 경계"],
    statement: "오름차순으로 정렬된 서로 다른 정수 N개에서 질문마다 x의 위치(0부터)를 찾고, 없으면 -1을 출력하는 코드다.\n\n빈칸(____) 세 곳을 채워 완성하자. 반복이 언제 멈춰야 하는지, mid를 확인한 뒤 범위를 어떻게 줄여야 같은 곳을 다시 보지 않는지가 핵심이다.",
    inputText: "첫 줄에 N (1 ≤ N ≤ 100,000)\n둘째 줄에 정렬된 서로 다른 정수 N개\n셋째 줄에 Q\n넷째 줄에 x Q개",
    outputText: "질문마다 한 줄에 위치 또는 -1을 출력한다.",
    exampleInputs: ["5\n1 4 6 9 12\n4\n6 1 12 5\n"],
    testInputs: () => {
      const r = rng(53); const out: string[] = [];
      for (const [n, q, span] of [[1, 3, 3], [2, 5, 5], [7, 10, 20], [1000, 1000, 5000], [100000, 100000, 1_000_000_000]] as const) {
        const a = distinct(r, n, -span, span).sort((x, y) => x - y);
        const xs = Array.from({ length: q }, (_, i) => i === 0 ? a[0] : i === 1 ? a[n - 1] : r() < 0.5 ? a[int(r, 0, n - 1)] : int(r, -span - 1, span + 1));
        out.push(`${n}\n${a.join(" ")}\n${q}\n${xs.join(" ")}\n`);
      }
      return out;
    },
    reference: `${READ_JS}const n = d[p++]; const a = d.slice(p, p + n); p += n; const q = d[p++]; const out = [];\nfor (let k = 0; k < q; k++) { const x = d[p++]; let st = 0, en = n - 1, ans = -1; while (st <= en) { const mid = (st + en) >> 1; if (a[mid] === x) { ans = mid; break; } else if (a[mid] < x) st = mid + 1; else en = mid - 1; } out.push(ans); }\nconsole.log(out.join("\\n"));\n`,
    templates: {
      cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    int n; cin >> n;\n    vector<int> a(n);\n    for (auto& x : a) cin >> x;\n    int q; cin >> q;\n    while (q--) {\n        int x; cin >> x;\n        int st = 0, en = n - 1, ans = -1;\n        while (____) {                 // 빈칸 1: 언제까지 찾을까?\n            int mid = (st + en) / 2;\n            if (a[mid] == x) { ans = mid; break; }\n            else if (a[mid] < x) ____;  // 빈칸 2\n            else ____;                  // 빈칸 3\n        }\n        cout << ans << '\\n';\n    }\n    return 0;\n}\n",
      python: "import sys\ninput = sys.stdin.readline\n\nn = int(input())\na = list(map(int, input().split()))\nq = int(input())\nout = []\nfor x in map(int, input().split()):\n    st, en, ans = 0, n - 1, -1\n    while ____:                # 빈칸 1: 언제까지 찾을까?\n        mid = (st + en) // 2\n        if a[mid] == x:\n            ans = mid\n            break\n        elif a[mid] < x:\n            ____               # 빈칸 2\n        else:\n            ____               # 빈칸 3\n    out.append(ans)\nprint(\"\\n\".join(map(str, out)))\n",
      javascript: "const d = require(\"fs\").readFileSync(0, \"utf8\").trim().split(/\\s+/).map(Number);\nlet p = 0;\nconst n = d[p++]; const a = d.slice(p, p + n); p += n; const q = d[p++];\nconst out = [];\nfor (let k = 0; k < q; k++) {\n  const x = d[p++];\n  let st = 0, en = n - 1, ans = -1;\n  while (____) {                 // 빈칸 1: 언제까지 찾을까?\n    const mid = (st + en) >> 1;\n    if (a[mid] === x) { ans = mid; break; }\n    else if (a[mid] < x) ____;   // 빈칸 2\n    else ____;                   // 빈칸 3\n  }\n  out.push(ans);\n}\nconsole.log(out.join(\"\\n\"));\n",
      csharp: "using System;\nusing System.Text;\n\nclass Program {\n    static void Main() {\n        string[] t = Console.In.ReadToEnd().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);\n        int p = 0;\n        int n = int.Parse(t[p++]);\n        int[] a = new int[n];\n        for (int i = 0; i < n; i++) a[i] = int.Parse(t[p++]);\n        int q = int.Parse(t[p++]);\n        var sb = new StringBuilder();\n        while (q-- > 0) {\n            int x = int.Parse(t[p++]);\n            int st = 0, en = n - 1, ans = -1;\n            while (____) {                 // 빈칸 1: 언제까지 찾을까?\n                int mid = (st + en) / 2;\n                if (a[mid] == x) { ans = mid; break; }\n                else if (a[mid] < x) ____;  // 빈칸 2\n                else ____;                  // 빈칸 3\n            }\n            sb.Append(ans).Append('\\n');\n        }\n        Console.Write(sb.ToString());\n    }\n}\n",
    },
  },
];
