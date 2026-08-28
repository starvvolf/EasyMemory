"use client";

import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  Layers3,
  ListChecks,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Sparkles,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import PdfReviewViewer from "./PdfReviewViewer";
import type { Deck, PdfAnalysisResponse, PdfAnalysisResult } from "@/lib/types";
import type {
  StudyProject,
  StudyProjectDetail,
  StudyProjectSource,
  StudyProjectSummary,
} from "@/lib/study-project-types";

type ReaderState = {
  source: StudyProjectSource;
  file: File;
};

type StudyProjectLibraryProps = {
  decks: Deck[];
  onCreateFromSources: (
    files: File[],
    project: StudyProject,
    cachedAnalysis: PdfAnalysisResponse | null,
  ) => void;
  onStartStudy: (deck: Deck) => void;
  creationPanel?: ReactNode;
  isCreationOpen?: boolean;
  onCancelCreation?: () => void;
};

const learningIcons = [Layers3, ListChecks, TextCursorInput, BookOpen, FileText, Sparkles];

export default function StudyProjectLibrary({
  decks,
  onCreateFromSources,
  onStartStudy,
  creationPanel,
  isCreationOpen = false,
  onCancelCreation,
}: StudyProjectLibraryProps) {
  const [projects, setProjects] = useState<StudyProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudyProjectDetail | null>(null);
  const [projectName, setProjectName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [reader, setReader] = useState<ReaderState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"sources" | "learning">("sources");
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<string[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadProject = async (projectId: string) => {
    const response = await fetch(`/api/study-projects/${projectId}`);
    const data = (await response.json()) as StudyProjectDetail & {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(data.message || data.error || "프로젝트를 불러오지 못했습니다.");
    }
    setSelectedProjectId(projectId);
    setDetail(data);
    setSelectedSourceIds((current) =>
      current.filter((id) => data.sources.some((source) => source.id === id)),
    );
  };

  const loadProjects = async (preferredProjectId?: string | null) => {
    const response = await fetch("/api/study-projects");
    const data = (await response.json()) as {
      projects?: StudyProjectSummary[];
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(data.message || data.error || "프로젝트 목록을 불러오지 못했습니다.");
    }

    const nextProjects = data.projects || [];
    setProjects(nextProjects);

    const projectId = preferredProjectId ?? selectedProjectId;
    if (projectId && nextProjects.some((project) => project.id === projectId)) {
      await loadProject(projectId);
      return;
    }

    setSelectedProjectId(null);
    setDetail(null);
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        await loadProjects(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "프로젝트를 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    void initialize();
    // 첫 진입에서는 프로젝트를 자동으로 열지 않고 폴더 캔버스를 보여준다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;

    setBusyMessage("프로젝트를 만들고 있습니다.");
    setError("");
    try {
      const response = await fetch("/api/study-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json()) as {
        project?: StudyProjectSummary;
        error?: string;
        message?: string;
      };
      if (!response.ok || !data.project) {
        throw new Error(data.message || data.error || "프로젝트를 만들지 못했습니다.");
      }
      setProjectName("");
      setIsCreatingProject(false);
      await loadProjects(data.project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setBusyMessage("");
    }
  };

  const openProject = async (projectId: string) => {
    setBusyMessage("프로젝트를 여는 중입니다.");
    setError("");
    try {
      await loadProject(projectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setBusyMessage("");
    }
  };

  const closeProject = () => {
    if (isCreationOpen) onCancelCreation?.();
    setSelectedProjectId(null);
    setDetail(null);
    setSelectedSourceIds([]);
    setReader(null);
    setChatDraft("");
    setChatMessages([]);
    setIsChatOpen(false);
    setError("");
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message) return;
    setChatMessages((current) => [...current, message]);
    setChatDraft("");
    setIsChatOpen(true);
  };

  const uploadSources = async (files: FileList | null) => {
    if (!selectedProjectId || !files?.length) return;

    setBusyMessage("PDF를 프로젝트에 추가하고 있습니다.");
    setError("");
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append("pdfs", file);

      const response = await fetch(`/api/study-projects/${selectedProjectId}/sources`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.message || data.error || "PDF를 추가하지 못했습니다.");
      }
      await loadProjects(selectedProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF를 추가하지 못했습니다.");
    } finally {
      setBusyMessage("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteSource = async (source: StudyProjectSource) => {
    if (!window.confirm(`'${source.fileName}'을 프로젝트에서 삭제할까요?`)) return;

    setBusyMessage("PDF를 삭제하고 있습니다.");
    setError("");
    try {
      const response = await fetch(`/api/study-sources/${source.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string; message?: string };
        throw new Error(data.message || data.error || "PDF를 삭제하지 못했습니다.");
      }
      setSelectedSourceIds((current) => current.filter((id) => id !== source.id));
      await loadProjects(selectedProjectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF를 삭제하지 못했습니다.");
    } finally {
      setBusyMessage("");
    }
  };

  const openSource = async (source: StudyProjectSource) => {
    setBusyMessage("PDF를 여는 중입니다.");
    setError("");
    try {
      const response = await fetch(`/api/study-sources/${source.id}`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string; message?: string };
        throw new Error(data.message || data.error || "PDF 파일을 불러오지 못했습니다.");
      }
      const blob = await response.blob();
      setReader({ source, file: new File([blob], source.fileName, { type: "application/pdf" }) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF 파일을 불러오지 못했습니다.");
    } finally {
      setBusyMessage("");
    }
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  };

  const createFromSelectedSources = async () => {
    if (!detail) return;
    const selectedSources = detail.sources.filter((source) => selectedSourceIds.includes(source.id));
    if (!selectedSources.length) {
      setError("문제를 만들 PDF를 먼저 선택하세요.");
      return;
    }

    setBusyMessage("선택한 PDF를 준비하고 있습니다.");
    setError("");
    try {
      const files = await Promise.all(
        selectedSources.map(async (source) => {
          const response = await fetch(`/api/study-sources/${source.id}`);
          if (!response.ok) {
            const data = (await response.json()) as { error?: string; message?: string };
            throw new Error(data.message || data.error || `${source.fileName}을 불러오지 못했습니다.`);
          }
          const blob = await response.blob();
          return new File([blob], source.fileName, { type: "application/pdf" });
        }),
      );

      onCreateFromSources(
        files,
        detail.project,
        buildCachedProjectAnalysis(selectedSources),
      );
      setMobilePanel("learning");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PDF를 준비하지 못했습니다.");
    } finally {
      setBusyMessage("");
    }
  };

  const folderCanvas = (
    <>
      <div className="flex min-h-10 items-center justify-end">
        {isCreatingProject ? (
          <form
            onSubmit={createProject}
            className="flex w-full max-w-sm items-center gap-2 rounded-2xl border border-[#3B3F3C] bg-[#242725] p-2 shadow-sm"
          >
            <input
              autoFocus
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="프로젝트 이름"
              className="min-w-0 flex-1 bg-transparent px-2 text-sm font-medium text-[#F0F2EF] outline-none placeholder:text-[#898E89]"
            />
            <button
              type="button"
              onClick={() => {
                setProjectName("");
                setIsCreatingProject(false);
              }}
              className="grid h-8 w-8 place-items-center rounded-xl text-[#A5A9A4] transition hover:bg-[#222523] hover:text-[#F0F2EF]"
              aria-label="프로젝트 만들기 취소"
            >
              <X size={15} />
            </button>
            <button
              type="submit"
              disabled={!projectName.trim() || Boolean(busyMessage)}
              className="h-8 rounded-xl bg-[#ECEEEB] px-3 text-xs font-semibold text-[#202321] transition hover:bg-[#D5D8D4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              만들기
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsCreatingProject(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#3B3F3C] bg-[#242725] px-3 text-xs font-semibold text-[#B2B6B1] shadow-sm transition hover:border-[#5A5F5A] hover:bg-[#222523]"
          >
            <Plus size={14} />
            새 프로젝트
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid min-h-56 place-items-center text-sm text-[#A5A9A4]">프로젝트를 불러오는 중...</div>
      ) : projects.length ? (
        <div className="mt-8 flex flex-wrap content-start items-start gap-x-3 gap-y-6">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => void openProject(project.id)}
              className="group flex w-28 flex-col items-center rounded-2xl px-2 py-2 text-center outline-none transition hover:bg-[#222523] focus-visible:ring-2 focus-visible:ring-[#A5A9A4]"
              aria-label={`${project.name} 프로젝트 열기`}
            >
              <span className="grid h-14 w-16 place-items-center rounded-[15px] border border-[#3B3F3C] bg-[#242725] text-[#B2B6B1] shadow-[0_1px_2px_rgba(32,35,33,0.04),0_5px_12px_rgba(32,35,33,0.04)] transition group-hover:-translate-y-0.5 group-hover:border-[#5A5F5A] group-hover:text-[#F0F2EF] group-hover:shadow-[0_2px_4px_rgba(32,35,33,0.05),0_8px_18px_rgba(32,35,33,0.06)]">
                <Folder size={28} strokeWidth={1.55} />
              </span>
              <span className="mt-2.5 line-clamp-2 w-full text-[13px] font-medium leading-5 text-[#B2B6B1] group-hover:text-[#F0F2EF]">
                {project.name}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreatingProject(true)}
          className="mt-10 flex h-32 w-28 flex-col items-center justify-center rounded-2xl border border-dashed border-[#5A5F5A] text-[#A5A9A4] transition hover:border-[#AEB2AD] hover:bg-[#222523] hover:text-[#F0F2EF]"
        >
          <Plus size={20} />
          <span className="mt-2 text-xs font-medium">첫 프로젝트</span>
        </button>
      )}
    </>
  );

  const projectDecks = detail
    ? decks.filter(
        (deck) =>
          deck.projectId === detail.project.id ||
          (!deck.projectId && deck.subject.trim() === detail.project.name.trim()),
      )
    : [];

  const projectDetail = detail ? (
    <div className="relative flex min-h-[max(680px,calc(100dvh-150px))] flex-col overflow-hidden rounded-2xl border border-[#303030] bg-[#161616] text-[#E8E8E8] md:min-h-[max(650px,calc(100dvh-160px))]">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(event) => void uploadSources(event.target.files)}
      />

      <header className="flex min-h-[54px] shrink-0 items-center gap-3 border-b border-[#2B2B2B] bg-[#1B1B1B] px-3 md:px-4">
        <button
          type="button"
          onClick={closeProject}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[#8B8B8B] transition hover:bg-[#292929] hover:text-[#E8E8E8]"
          aria-label="프로젝트 목록으로 돌아가기"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-px text-[9px] tracking-[0.1em] text-[#696969]">PROJECT</p>
          <h3 className="truncate text-[15px] font-medium text-[#E8E8E8]">{detail.project.name}</h3>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-[#8B8B8B] transition hover:bg-[#292929] hover:text-[#E8E8E8]"
          aria-label="프로젝트 메뉴"
        >
          <MoreHorizontal size={16} />
        </button>
      </header>

      <nav className="grid shrink-0 grid-cols-2 gap-[5px] border-b border-[#393D3A] bg-[#222523] p-[7px] md:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel("sources")}
          className={`h-9 rounded-[9px] text-[10px] transition ${
            mobilePanel === "sources" ? "bg-[#ECEEEB] text-[#202321]" : "text-[#AFB3AE]"
          }`}
        >
          소스
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("learning")}
          className={`h-9 rounded-[9px] text-[10px] transition ${
            mobilePanel === "learning" ? "bg-[#ECEEEB] text-[#202321]" : "text-[#AFB3AE]"
          }`}
        >
          학습
        </button>
      </nav>

      <div className="grid min-h-[569px] flex-1 md:min-h-[586px] md:grid-cols-[minmax(240px,0.82fr)_minmax(340px,1.18fr)]">
        <section
          className={`${mobilePanel === "sources" ? "block" : "hidden"} min-w-0 bg-[#1B1B1B] pb-[66px] md:block`}
        >
          <div className="flex h-11 items-center justify-between border-b border-[#393D3A] px-[13px]">
            <h4 className="text-xs font-medium text-[#F0F2EF]">소스</h4>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 px-1.5 text-[9px] text-[#B2B6B1] transition hover:text-[#F0F2EF]"
            >
              <Plus size={12} />
              추가
            </button>
          </div>

          <div className="py-[3px]">
            {detail.sources.length ? (
              detail.sources.map((source) => {
                const selected = selectedSourceIds.includes(source.id);
                return (
                  <div
                    key={source.id}
                    className={`group relative grid h-[30px] grid-cols-[auto_16px_minmax(0,1fr)] items-center gap-[7px] px-[13px] transition ${
                      selected ? "bg-[#2D312E]" : "hover:bg-[#2D312E]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSourceSelection(source.id)}
                      className="h-3 w-3 accent-[#ECEEEB]"
                      aria-label={`${source.fileName} 선택`}
                    />
                    <FileText size={14} className="text-[#A5A9A4]" />
                    <button
                      type="button"
                      onClick={() => void openSource(source)}
                      className="min-w-0 truncate pr-5 text-left text-[10px] text-[#F0F2EF]"
                    >
                      {source.fileName}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSource(source)}
                      className="absolute right-2 grid h-6 w-6 place-items-center rounded-md bg-[#2D312E] text-[#A5A9A4] opacity-0 transition hover:text-[#F0F2EF] group-hover:opacity-100 focus:opacity-100"
                      aria-label={`${source.fileName} 삭제`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-[30px] w-full items-center gap-[7px] px-[13px] text-left text-[10px] text-[#A5A9A4] transition hover:bg-[#2D312E]"
              >
                <Plus size={12} />
                PDF 추가
              </button>
            )}
          </div>
        </section>

        <section
          className={`${mobilePanel === "learning" ? "block" : "hidden"} min-w-0 bg-[#1E1E1E] pb-[66px] md:block md:border-l md:border-[#2B2B2B]`}
        >
          <div className="flex h-11 items-center justify-between border-b border-[#393D3A] px-[13px]">
            <h4 className="text-xs font-medium text-[#F0F2EF]">학습</h4>
            {!isCreationOpen ? (
              <button
                type="button"
                onClick={() => void createFromSelectedSources()}
                disabled={!selectedSourceIds.length || Boolean(busyMessage)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#393939] bg-[#222222] px-2.5 text-[10px] text-[#B5B5B5] transition hover:bg-[#292929] hover:text-[#E8E8E8] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Plus size={12} />
                학습 만들기
              </button>
            ) : null}
          </div>

          <div className="py-[3px]">
            {projectDecks.length ? (
              projectDecks.map((deck, index) => {
                const LearningIcon = learningIcons[index % learningIcons.length];
                return (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() => onStartStudy(deck)}
                    className="grid h-[52px] w-full grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 border-b border-[#303030] px-[13px] text-left transition hover:bg-[#292929]"
                  >
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-[#292929] text-[#B5B5B5]">
                      <LearningIcon size={16} strokeWidth={1.65} />
                    </span>
                    <span className="min-w-0 truncate text-[12px] text-[#E8E8E8]">{deck.title}</span>
                  </button>
                );
              })
            ) : (
              <div className="flex h-[45px] items-center border-b border-[#353936] px-[15px] text-[10px] text-[#A5A9A4]">
                학습 없음
              </div>
            )}
          </div>
        </section>
      </div>

      {isCreationOpen && creationPanel ? (
        <>
          <div className="absolute inset-[54px_0_0] z-20 bg-black/50 backdrop-blur-[2px]" />
          <section className="sf-creation-dialog absolute left-1/2 top-1/2 z-30 flex h-[min(760px,calc(100%-28px))] w-[min(1080px,calc(100%-28px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[#383838] bg-[#1E1E1E] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
            <header className="flex min-h-[58px] shrink-0 items-center justify-between border-b border-[#303030] px-5">
              <div>
                <p className="text-[10px] text-[#777777]">새 학습</p>
                <h4 className="mt-0.5 text-[15px] font-medium text-[#E8E8E8]">학습 만들기</h4>
              </div>
              <button
                type="button"
                onClick={onCancelCreation}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-[#858585] transition hover:bg-[#292929] hover:text-[#E8E8E8]"
                aria-label="학습 만들기 닫기"
              >
                <X size={15} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{creationPanel}</div>
          </section>
        </>
      ) : null}

      <form
        onSubmit={submitChat}
        className="absolute bottom-3 left-2.5 right-2.5 z-10 grid min-h-[46px] grid-cols-[18px_minmax(0,1fr)_32px] items-center gap-2 rounded-[14px] border border-[#393939] bg-[#222222] py-1.5 pl-3 pr-[7px] shadow-[0_10px_26px_rgba(0,0,0,0.24)] md:left-[16%] md:right-[16%]"
      >
        <MessageCircle size={15} className="text-[#A6AAA5]" />
        <input
          value={chatDraft}
          onChange={(event) => {
            setChatDraft(event.target.value);
            if (event.target.value) setIsChatOpen(true);
          }}
          placeholder="이 프로젝트에 질문하세요"
          className="min-w-0 border-0 bg-transparent text-[11px] text-[#F0F2EF] outline-none placeholder:text-[#898E89]"
          aria-label="프로젝트에 질문"
        />
        <button
          type="submit"
          className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#ECEEEB] text-[#202321]"
          aria-label="질문 보내기"
        >
          <ArrowUp size={14} />
        </button>
      </form>

      {isChatOpen ? (
        <section className="absolute bottom-0 left-0 right-0 z-20 flex h-[80%] flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-[#484C48] bg-[#242725] shadow-[0_-18px_50px_rgba(32,35,33,0.14)] md:left-[4%] md:right-[4%] md:rounded-t-[22px]">
          <header className="flex min-h-[58px] shrink-0 items-center gap-2.5 border-b border-[#393D3A] px-3.5 pl-[18px]">
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-[8px] tracking-[0.15em] text-[#A5A9A4]">PROJECT CHAT</p>
              <h4 className="truncate text-[13px] font-medium text-[#F0F2EF]">{detail.project.name}</h4>
            </div>
            <button
              type="button"
              onClick={() => setIsChatOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#464A46] text-[#F0F2EF]"
              aria-label="채팅 접기"
            >
              <ChevronDown size={15} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-5 md:px-[10%] md:py-[22px]">
            {chatMessages.length ? (
              <div className="flex flex-col gap-3">
                {chatMessages.map((message, index) => (
                  <div
                    key={`${message}-${index}`}
                    className="ml-auto max-w-[76%] rounded-[13px] rounded-br-[3px] bg-[#303431] px-3 py-2.5 text-[10px] leading-5 text-[#F0F2EF]"
                  >
                    {message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[9px] text-[#A5A9A4]">선택한 소스 {selectedSourceIds.length}개</p>
                <h4 className="mt-[7px] text-lg font-medium text-[#F0F2EF]">자료에서 무엇을 찾을까요?</h4>
              </div>
            )}
          </div>

          <form
            onSubmit={submitChat}
            className="absolute bottom-2.5 left-3 right-3 grid min-h-[46px] grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-[14px] border border-[#4B4F4B] bg-[#2A2E2B] py-1.5 pl-[13px] pr-[7px] md:bottom-3 md:left-[8%] md:right-[8%]"
          >
            <input
              autoFocus
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="질문을 입력하세요"
              className="min-w-0 border-0 bg-transparent text-[11px] text-[#F0F2EF] outline-none placeholder:text-[#898E89]"
              aria-label="열린 채팅에 질문"
            />
            <button
              type="submit"
              className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#ECEEEB] text-[#202321]"
              aria-label="질문 보내기"
            >
              <ArrowUp size={14} />
            </button>
          </form>
        </section>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="min-h-[480px]">
      {error ? (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="오류 닫기">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {busyMessage ? (
        <div className="mb-5 flex items-center gap-2 text-xs font-medium text-[#A5A9A4]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#B2B6B1]" />
          {busyMessage}
        </div>
      ) : null}

      {detail ? projectDetail : folderCanvas}

      {reader ? (
        <SourceReader
          reader={reader}
          analysis={reader.source.analysis?.result}
          onClose={() => setReader(null)}
        />
      ) : null}
    </section>
  );
}

function buildCachedProjectAnalysis(
  sources: StudyProjectSource[],
): PdfAnalysisResponse | null {
  const analyzed = sources.map((source) => ({
    source,
    result: source.analysis?.result ?? source.readingAnalysis?.result,
  }));
  if (analyzed.some((item) => !item.result)) return null;

  const files = analyzed.map(({ source, result }) => ({
    ...(result as PdfAnalysisResult),
    fileName: source.fileName,
  }));
  const outlines = analyzed.flatMap(({ source, result }) =>
    result?.sourceOutline ? [{ source, outline: result.sourceOutline }] : [],
  );
  if (!outlines.length) return { files };

  return {
    files,
    sourceOutline: {
      title: outlines.length === 1 ? outlines[0].outline.title : "선택한 자료 구조",
      summary: outlines.map(({ outline }) => outline.summary).filter(Boolean).join(" "),
      nodes: outlines.flatMap(({ source, outline }) =>
        outline.nodes.map((node) => ({
          ...node,
          id: `${source.id}:${node.id}`,
          parentId: node.parentId ? `${source.id}:${node.parentId}` : null,
          sourceRefs: node.sourceRefs.map((reference) => ({
            ...reference,
            fileName: reference.fileName || source.fileName,
          })),
        })),
      ),
    },
  };
}

function SourceReader({
  reader,
  analysis,
  onClose,
}: {
  reader: ReaderState;
  analysis?: PdfAnalysisResult;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/45 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-[#3B3F3C] bg-[#242725] shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#393D3A] bg-[#242725] px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#F0F2EF]">{reader.source.fileName}</p>
            <p className="mt-0.5 text-[11px] text-[#A5A9A4]">{formatBytes(reader.source.size)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#464A46] text-[#B2B6B1] transition hover:bg-[#222523] hover:text-[#F0F2EF]"
            aria-label="PDF 닫기"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-0 overflow-auto bg-[#222523] p-3 sm:p-5">
            <PdfReviewViewer files={[reader.file]} />
          </div>
          <aside className="hidden overflow-auto border-l border-[#393D3A] p-5 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A5A9A4]">Analysis</p>
            {analysis ? (
              <>
                <p className="mt-3 text-sm leading-6 text-[#B2B6B1]">{analysis.summary}</p>
                <div className="mt-5 space-y-2">
                  {analysis.keyTopics.map((topic) => (
                    <div key={topic} className="rounded-xl bg-[#222523] px-3 py-2 text-xs text-[#B2B6B1]">
                      {topic}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-[#A5A9A4]">아직 분석 정보가 없습니다.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
