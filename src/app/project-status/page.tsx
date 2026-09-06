import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import MainBoardEditor from "./MainBoardEditor";

export const dynamic = "force-dynamic";

type DashboardBlock =
  | { type: "subheading"; text: string }
  | { type: "bullet"; text: string }
  | { type: "check"; text: string; checked: boolean }
  | { type: "number"; text: string; number: string }
  | { type: "quote"; text: string }
  | { type: "paragraph"; text: string };

type DashboardSection = {
  title: string;
  blocks: DashboardBlock[];
};

type DashboardDocument = {
  title: string;
  summary: string;
  facts: Record<string, string>;
  sections: DashboardSection[];
};

const accentByTitle: Record<string, string> = {
  "지금 해결하는 문제": "border-l-[#6A6A6A]",
  "현재 제품 상태": "border-l-[#6A6A6A]",
  "확정한 방향": "border-l-[#6A6A6A]",
  "발견된 문제": "border-l-[#6A6A6A]",
  "다음 작업 순서": "border-l-[#6A6A6A]",
  "지금 일부러 하지 않는 것": "border-l-[#6A6A6A]",
  "작업 위치": "border-l-[#6A6A6A]",
};

export default function ProjectStatusPage() {
  const statusSource = fs.readFileSync(
    path.join(process.cwd(), "docs", "CURRENT_STATUS.md"),
    "utf8",
  );
  const mainBoardSource = fs.readFileSync(
    path.join(process.cwd(), "docs", "MAIN_BOARD.md"),
    "utf8",
  );
  const dashboard = parseDashboard(statusSource);
  const mainBoard = parseDashboard(mainBoardSource);

  return (
    <main className="sf-app min-h-screen bg-[#161616] text-[#E8E8E8]">
      <header className="border-b border-[#2B2B2B] bg-[#1B1B1B] text-[#E8E8E8]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-white/70">
              STUDY FORGE
            </p>
            <h1 className="mt-1 text-xl font-black">프로젝트 상황판</h1>
          </div>
          <Link
            href="/"
            className="rounded-md border border-white/30 px-3 py-2 text-sm font-bold hover:bg-white/15"
          >
            앱으로 돌아가기
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        <section className="rounded-xl border border-[#DCDFE4] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-bold text-[#0C66E4]">현재 메인 안건</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">
                {dashboard.facts["현재 단계"] ?? dashboard.title}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#44546F]">
                {dashboard.summary}
              </p>
            </div>
            <span className="w-fit rounded-full bg-[#E9F2FF] px-3 py-1.5 text-xs font-black text-[#0C66E4]">
              {dashboard.facts["최종 갱신"] ?? "갱신일 없음"}
            </span>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <StatusFact label="전체 상태" value={dashboard.facts["전체 상태"]} />
            <StatusFact label="다음 결정" value={dashboard.facts["다음 결정"]} />
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-[#B3BAC5] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black text-[#0C66E4]">직접 쓰는 공간</p>
              <h2 className="mt-1 text-xl font-black">{mainBoard.title}</h2>
            </div>
            <MainBoardEditor initialSource={mainBoardSource} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {mainBoard.sections.map((section) => (
              <div key={section.title} className="rounded-lg bg-[#F4F5F7] p-4">
                <h3 className="text-sm font-black text-[#0C66E4]">{section.title}</h3>
                <div className="mt-3 space-y-2">
                  {section.blocks.map((block, index) => (
                    <DashboardBlockView
                      key={`${block.type}-${index}-${block.text}`}
                      block={block}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 space-y-3">
          {dashboard.sections.map((section) => (
            <details
              key={section.title}
              className={`group rounded-xl border border-[#DCDFE4] border-l-4 bg-white shadow-sm ${
                accentByTitle[section.title] ?? "border-l-[#B3BAC5]"
              }`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
                <h2 className="text-lg font-black">{section.title}</h2>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F1F2F4] text-lg font-black text-[#44546F] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="space-y-3 border-t border-[#EBECF0] px-5 pb-5 pt-4">
                {section.blocks.map((block, index) => (
                  <DashboardBlockView
                    key={`${block.type}-${index}-${block.text}`}
                    block={block}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-[#6B778C]">
          프로젝트 상세는 docs/CURRENT_STATUS.md, 직접 쓰는 메인 보드는
          docs/MAIN_BOARD.md를 읽어 표시합니다.
        </p>
      </div>
    </main>
  );
}

function StatusFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg bg-[#F4F5F7] p-4">
      <p className="text-xs font-black text-[#6B778C]">{label}</p>
      <p className="mt-1 text-sm font-bold leading-6">{value ?? "아직 정해지지 않음"}</p>
    </div>
  );
}

function DashboardBlockView({ block }: { block: DashboardBlock }) {
  if (block.type === "subheading") {
    return <h3 className="pt-2 text-sm font-black text-[#0C66E4]">{block.text}</h3>;
  }
  if (block.type === "quote") {
    return (
      <p className="rounded-lg bg-[#E9F2FF] px-4 py-3 text-sm font-bold leading-6 text-[#0747A6]">
        {block.text}
      </p>
    );
  }
  if (block.type === "check") {
    return (
      <div className="flex gap-3 text-sm leading-6">
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border text-xs font-black ${
            block.checked
              ? "border-[#22A06B] bg-[#E3FCEF] text-[#216E4E]"
              : "border-[#B3BAC5] bg-white text-transparent"
          }`}
        >
          ✓
        </span>
        <span className={block.checked ? "text-[#44546F]" : "font-bold"}>
          {block.text}
        </span>
      </div>
    );
  }
  if (block.type === "number") {
    return (
      <div className="flex gap-3 text-sm leading-6">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#E9F2FF] text-xs font-black text-[#0C66E4]">
          {block.number}
        </span>
        <span>{block.text}</span>
      </div>
    );
  }
  if (block.type === "bullet") {
    return (
      <div className="flex gap-3 text-sm leading-6 text-[#44546F]">
        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7A869A]" />
        <span>{block.text}</span>
      </div>
    );
  }
  return <p className="text-sm leading-6 text-[#44546F]">{block.text}</p>;
}

function parseDashboard(source: string): DashboardDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let title = "Study Forge 상황판";
  let summary = "";
  const facts: Record<string, string> = {};
  const sections: DashboardSection[] = [];
  let currentSection: DashboardSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      currentSection = { title: line.slice(3).trim(), blocks: [] };
      sections.push(currentSection);
      continue;
    }
    if (!currentSection && line.startsWith("> ")) {
      summary = line.slice(2).trim();
      continue;
    }
    if (!currentSection && line.startsWith("- ")) {
      const [label, ...valueParts] = line.slice(2).split(":");
      if (valueParts.length > 0) facts[label.trim()] = valueParts.join(":").trim();
      continue;
    }
    if (!currentSection) continue;

    if (line.startsWith("### ")) {
      currentSection.blocks.push({ type: "subheading", text: line.slice(4).trim() });
    } else if (/^- \[[xX ]\] /.test(line)) {
      currentSection.blocks.push({
        type: "check",
        checked: /^- \[[xX]\]/.test(line),
        text: line.replace(/^- \[[xX ]\] /, ""),
      });
    } else if (/^\d+\. /.test(line)) {
      const match = line.match(/^(\d+)\. (.+)$/);
      if (match) {
        currentSection.blocks.push({ type: "number", number: match[1], text: match[2] });
      }
    } else if (line.startsWith("- ")) {
      currentSection.blocks.push({ type: "bullet", text: line.slice(2).trim() });
    } else if (line.startsWith("> ")) {
      currentSection.blocks.push({ type: "quote", text: line.slice(2).trim() });
    } else {
      currentSection.blocks.push({ type: "paragraph", text: line });
    }
  }

  return { title, summary, facts, sections };
}
