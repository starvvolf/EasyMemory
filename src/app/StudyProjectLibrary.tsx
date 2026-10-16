"use client";

import {
  ArrowLeft,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Folder,
  Layers3,
  ListChecks,
  Maximize2,
  Minus,
  MoreHorizontal,
  Network,
  Plus,
  Sparkles,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import PdfReviewViewer from "./PdfReviewViewer";
import { usePdfReadingPosition } from "./study/usePdfReadingPosition";
import type {
  Deck,
  LearningConceptTree,
  PdfAnalysisResponse,
  PdfAnalysisResult,
  StudyAttempt,
  StudySession,
} from "@/lib/types";
import type {
  StudyProject,
  StudyProjectConceptTree,
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
  sessions: StudySession[];
  attempts: StudyAttempt[];
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
  sessions,
  attempts,
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
  const [isTreeOpen, setIsTreeOpen] = useState(false);
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
    setIsTreeOpen(false);
    setError("");
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
          onClick={() => setIsTreeOpen(true)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[#343434] bg-[#202020] px-2.5 text-[10px] text-[#B5B5B5] transition hover:border-[#4A4A4A] hover:bg-[#292929] hover:text-[#F0F0F0]"
          aria-label="프로젝트 학습트리 확인"
        >
          <Network size={13} />
          트리 확인
        </button>
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

      {isTreeOpen ? (
        <>
          <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-[3px]" />
          <section className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#171717] md:inset-3 md:rounded-2xl md:border md:border-[#383838] md:shadow-[0_28px_90px_rgba(0,0,0,0.62)]">
            <header className="flex min-h-[64px] shrink-0 items-center justify-between border-b border-[#303030] px-4 md:px-6">
              <div>
                <p className="text-[9px] tracking-[0.12em] text-[#747474]">PROJECT TREE</p>
                <h4 className="mt-0.5 text-[14px] font-medium text-[#E8E8E8]">{detail.project.name}</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsTreeOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-[#858585] transition hover:bg-[#292929] hover:text-[#E8E8E8]"
                aria-label="학습트리 닫기"
              >
                <X size={15} />
              </button>
            </header>
            <ProjectConceptTree
              key={detail.project.id}
              projectName={detail.project.name}
              conceptTrees={detail.conceptTrees ?? []}
              decks={projectDecks}
              sessions={sessions}
              attempts={attempts}
            />
          </section>
        </>
      ) : null}

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

type TreeProgress = {
  attempts: number;
  correct: number;
  lastCorrect: boolean | null;
};

type TreeAttemptOutcome = {
  correct: boolean;
  completedAt: string;
};

type ProjectForestNode = {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  relation: string;
  treeId: string | null;
  conceptNodeId: string | null;
  treeTitle?: string;
};

type ProjectTreeEntry = {
  id: string;
  title: string;
  tree: LearningConceptTree;
};

function ProjectConceptTree({
  projectName,
  conceptTrees,
  decks,
  sessions,
  attempts,
}: {
  projectName: string;
  conceptTrees: StudyProjectConceptTree[];
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
}) {
  const projectTreeIds = new Set(conceptTrees.map((entry) => entry.id));
  const treeEntries: ProjectTreeEntry[] = [
    ...conceptTrees
      .filter((entry) => entry.tree.nodes.length > 0)
      .map((entry) => ({ id: entry.id, title: entry.tree.title, tree: entry.tree })),
    ...decks
      .filter((deck) => deck.conceptTree?.nodes.length && !projectTreeIds.has(deck.conceptTree.id))
      .map((deck) => ({ id: deck.conceptTree!.id, title: deck.title, tree: deck.conceptTree! })),
  ];
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [closingNodeIds, setClosingNodeIds] = useState<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const closingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => {
    closingTimeoutsRef.current.forEach(clearTimeout);
  }, []);

  if (!treeEntries.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#363636] bg-[#222222] text-[#787878]">
            <Network size={21} />
          </span>
          <p className="mt-4 text-[13px] text-[#C7C7C7]">아직 연결된 학습트리가 없습니다.</p>
          <p className="mt-1.5 text-[10px] leading-5 text-[#747474]">
            개념트리가 포함된 학습을 만들면 이 프로젝트에 자동으로 쌓입니다.
          </p>
        </div>
      </div>
    );
  }

  const sessionDeckIds = new Map(sessions.map((session) => [session.id, session.deckId]));
  const cardsByDeckAndId = new Map(
    decks.flatMap((deck) =>
      deck.cards.map((card) => [`${deck.id}:${card.id}`, { card, deck }] as const),
    ),
  );
  const directOutcomes = new Map<string, Map<string, TreeAttemptOutcome>>();
  for (const attempt of attempts) {
    const deckId = sessionDeckIds.get(attempt.sessionId);
    if (!deckId) continue;
    const cardEntry = cardsByDeckAndId.get(`${deckId}:${attempt.activityId}`);
    if (!cardEntry?.card.conceptNodeIds?.length) continue;
    const correct = attempt.activityType === "graded_problem"
      ? attempt.isCorrect
      : attempt.selfRating === "known";
    const treeIds = cardEntry.deck.conceptTreeIds?.length
      ? cardEntry.deck.conceptTreeIds
      : cardEntry.deck.conceptTree ? [cardEntry.deck.conceptTree.id] : [];
    for (const treeId of treeIds) {
      for (const conceptNodeId of cardEntry.card.conceptNodeIds) {
        const key = `${treeId}:${conceptNodeId}`;
        const outcomes = directOutcomes.get(key) ?? new Map<string, TreeAttemptOutcome>();
        outcomes.set(attempt.id, { correct, completedAt: attempt.completedAt });
        directOutcomes.set(key, outcomes);
      }
    }
  }

  const projectRootId = "project-root";
  const includeProjectRoot = treeEntries.length > 1;
  const forestNodes: ProjectForestNode[] = includeProjectRoot ? [{
      id: projectRootId,
      parentId: null,
      title: projectName,
      description: "프로젝트 학습트리",
      relation: "",
      treeId: null,
      conceptNodeId: null,
    }] : [];
  for (const entry of treeEntries) {
    const tree = entry.tree;
    const knownIds = new Set(tree.nodes.map((node) => node.id));
    for (const node of tree.nodes) {
      forestNodes.push({
        id: `${entry.id}:${node.id}`,
        parentId: node.parentId && knownIds.has(node.parentId)
          ? `${entry.id}:${node.parentId}`
          : includeProjectRoot ? projectRootId : null,
        title: node.title,
        description: node.description,
        relation: node.relation,
        treeId: entry.id,
        conceptNodeId: node.id,
        treeTitle: node.parentId ? undefined : entry.title,
      });
    }
  }

  const children = new Map<string, ProjectForestNode[]>();
  for (const node of forestNodes) {
    if (!node.parentId) continue;
    const items = children.get(node.parentId) ?? [];
    items.push(node);
    children.set(node.parentId, items);
  }
  const aggregateProgress = new Map<string, TreeProgress>();
  const collectProgress = (node: ProjectForestNode): Map<string, TreeAttemptOutcome> => {
    const own = node.treeId && node.conceptNodeId
      ? directOutcomes.get(`${node.treeId}:${node.conceptNodeId}`)
      : undefined;
    const combined = new Map(own ?? []);
    for (const child of children.get(node.id) ?? []) {
      for (const [attemptId, outcome] of collectProgress(child)) {
        combined.set(attemptId, outcome);
      }
    }
    const ordered = [...combined.values()].sort((left, right) =>
      left.completedAt.localeCompare(right.completedAt),
    );
    aggregateProgress.set(node.id, {
      attempts: ordered.length,
      correct: ordered.filter((outcome) => outcome.correct).length,
      lastCorrect: ordered.at(-1)?.correct ?? null,
    });
    return combined;
  };
  const rootNodes = forestNodes.filter((node) => !node.parentId);
  rootNodes.forEach(collectProgress);

  const originalDepth = new Map<string, number>();
  const recordDepth = (node: ProjectForestNode, depth: number) => {
    originalDepth.set(node.id, depth);
    (children.get(node.id) ?? []).forEach((child) => recordDepth(child, depth + 1));
  };
  rootNodes.forEach((node) => recordDepth(node, 0));
  const isExpanded = (node: ProjectForestNode) => {
    if (collapsedNodeIds.has(node.id)) return false;
    return (originalDepth.get(node.id) ?? 0) < 1 || expandedNodeIds.has(node.id);
  };
  const visibleNodes: ProjectForestNode[] = [];
  const visibleDepth = new Map<string, number>();
  const collectVisible = (node: ProjectForestNode, depth: number) => {
    visibleNodes.push(node);
    visibleDepth.set(node.id, depth);
    if (!isExpanded(node)) return;
    (children.get(node.id) ?? []).forEach((child) => collectVisible(child, depth + 1));
  };
  rootNodes.forEach((node) => collectVisible(node, 0));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));

  const positions = new Map<string, { x: number; y: number }>();
  let leafIndex = 0;
  let maxDepth = 0;
  const horizontalGap = 246;
  const verticalGap = 78;
  const placeNode = (node: ProjectForestNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const childNodes = (children.get(node.id) ?? []).filter((child) => visibleIds.has(child.id));
    const childYs = childNodes.map((child) => placeNode(child, depth + 1));
    const y = childYs.length
      ? childYs.reduce((sum, value) => sum + value, 0) / childYs.length
      : 58 + leafIndex++ * verticalGap;
    positions.set(node.id, { x: 120 + depth * horizontalGap, y });
    return y;
  };
  rootNodes.forEach((node) => placeNode(node, 0));
  const width = Math.max(900, 250 + maxDepth * horizontalGap);
  const height = Math.max(520, 116 + Math.max(1, leafIndex - 1) * verticalGap);
  const rootAnchor = { x: 120, y: 260 };
  rootNodes.forEach((node) => positions.set(node.id, rootAnchor));

  const selectedBranch = new Set<string>();
  if (selectedNodeId) {
    let cursor = forestNodes.find((node) => node.id === selectedNodeId);
    while (cursor) {
      selectedBranch.add(cursor.id);
      cursor = cursor.parentId
        ? forestNodes.find((node) => node.id === cursor?.parentId)
        : undefined;
    }
    const addDescendants = (nodeId: string) => {
      for (const child of children.get(nodeId) ?? []) {
        if (!visibleIds.has(child.id)) continue;
        selectedBranch.add(child.id);
        addDescendants(child.id);
      }
    };
    addDescendants(selectedNodeId);
  }

  const isBelowClosingNode = (node: ProjectForestNode) => {
    let cursor = node;
    while (cursor.parentId) {
      if (closingNodeIds.has(cursor.parentId)) return true;
      const parent = forestNodes.find((candidate) => candidate.id === cursor.parentId);
      if (!parent) break;
      cursor = parent;
    }
    return false;
  };

  const fitTree = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextScale = Math.min(1.15, Math.max(0.55, Math.min(
      (canvas.clientWidth - 48) / width,
      (canvas.clientHeight - 48) / height,
    )));
    setScale(nextScale);
    requestAnimationFrame(() => {
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    });
  };

  const toggleNode = (node: ProjectForestNode) => {
    if (closingNodeIds.has(node.id)) return;
    setSelectedNodeId((current) => current === node.id ? null : node.id);
    if (!(children.get(node.id)?.length)) return;
    if (isExpanded(node)) {
      setClosingNodeIds((current) => new Set(current).add(node.id));
      const timeout = setTimeout(() => {
        setCollapsedNodeIds((current) => new Set(current).add(node.id));
        setExpandedNodeIds((current) => {
          const next = new Set(current);
          next.delete(node.id);
          return next;
        });
        setClosingNodeIds((current) => {
          const next = new Set(current);
          next.delete(node.id);
          return next;
        });
      }, 190);
      closingTimeoutsRef.current.push(timeout);
    } else {
      setExpandedNodeIds((current) => new Set(current).add(node.id));
      setCollapsedNodeIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
    }
  };

  const expandAll = () => {
    setClosingNodeIds(new Set());
    setCollapsedNodeIds(new Set());
    setExpandedNodeIds(new Set(
      forestNodes.filter((node) => children.get(node.id)?.length).map((node) => node.id),
    ));
  };

  const collapseAll = () => {
    const collapsible = forestNodes.filter((node) =>
      (originalDepth.get(node.id) ?? 0) > 0 && (children.get(node.id)?.length ?? 0) > 0,
    );
    const ids = new Set(collapsible.map((node) => node.id));
    setSelectedNodeId(null);
    setClosingNodeIds(ids);
    const timeout = setTimeout(() => {
      setExpandedNodeIds(new Set());
      setCollapsedNodeIds(ids);
      setClosingNodeIds(new Set());
    }, 190);
    closingTimeoutsRef.current.push(timeout);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#303030] bg-[#1B1B1B] px-4 py-3 text-[10px] text-[#A0A0A0] md:px-6">
        <TreeLegend color="#747474" label="미학습" />
        <TreeLegend color="#8A4B4B" label="최근 오답" />
        <TreeLegend color="#8A7A45" label="학습 중" />
        <TreeLegend color="#4D7A60" label="안정" />
        <span className="ml-auto">노드를 눌러 가지 열기 · 트리 {treeEntries.length}개 · 개념 {forestNodes.length - (includeProjectRoot ? 1 : 0)}개</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-[10px] border border-[#3C3C3C] bg-[#202020]/95 p-1 shadow-lg">
          <button type="button" onClick={expandAll} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] text-[#C8C8C8] hover:bg-[#303030]" aria-label="트리 모두 펼치기"><ChevronsRight size={13} /><span>다 열기</span></button>
          <button type="button" onClick={collapseAll} className="flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] text-[#C8C8C8] hover:bg-[#303030]" aria-label="트리 모두 접기"><ChevronsLeft size={13} /><span>다 닫기</span></button>
          <span className="mx-1 h-5 w-px bg-[#3B3B3B]" />
          <button type="button" onClick={() => setScale((value) => Math.min(1.6, value + 0.1))} className="grid h-8 w-8 place-items-center rounded-[7px] text-[#C8C8C8] hover:bg-[#303030]" aria-label="트리 확대"><Plus size={14} /></button>
          <button type="button" onClick={() => setScale((value) => Math.max(0.5, value - 0.1))} className="grid h-8 w-8 place-items-center rounded-[7px] text-[#C8C8C8] hover:bg-[#303030]" aria-label="트리 축소"><Minus size={14} /></button>
          <button type="button" onClick={fitTree} className="grid h-8 w-8 place-items-center rounded-[7px] text-[#C8C8C8] hover:bg-[#303030]" aria-label="트리 화면 맞춤"><Maximize2 size={14} /></button>
          <span className="min-w-10 px-1 text-center text-[10px] text-[#8F8F8F]">{Math.round(scale * 100)}%</span>
        </div>
        <div
          ref={canvasRef}
          className={`h-full overflow-auto bg-[radial-gradient(circle_at_center,#2B2B2B_0.8px,transparent_0.9px)] bg-[size:20px_20px] ${isPanning ? "cursor-grabbing select-none" : "cursor-grab"}`}
          onPointerDown={(event) => {
            if ((event.target as Element).closest("[data-tree-node]")) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            panRef.current = { x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
            setIsPanning(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!isPanning || !canvasRef.current) return;
            canvasRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
            canvasRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
          }}
          onPointerUp={(event) => {
            setIsPanning(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => setIsPanning(false)}
        >
          <div style={{ width: width * scale, height: height * scale }}>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="block origin-top-left"
              style={{ transform: `scale(${scale})` }}
              role="img"
              aria-label={`${projectName} 프로젝트 학습트리`}
            >
          {visibleNodes.filter((node) => node.parentId && visibleIds.has(node.parentId)).map((node) => {
            const from = positions.get(node.parentId!)!;
            const to = positions.get(node.id)!;
            const emphasized = !selectedNodeId || (selectedBranch.has(node.id) && selectedBranch.has(node.parentId!));
            const closing = isBelowClosingNode(node);
            return (
              <path
                key={`edge-${node.id}`}
                d={`M ${from.x + 91} ${from.y} C ${from.x + 140} ${from.y}, ${to.x - 140} ${to.y}, ${to.x - 91} ${to.y}`}
                fill="none"
                stroke={emphasized ? "#5D5D5D" : "#303030"}
                strokeWidth={emphasized ? 1.8 : 1.1}
                opacity={closing ? 0 : emphasized ? 1 : 0.36}
                className="sf-tree-edge-enter"
                style={{ transition: "opacity 180ms ease" }}
              />
            );
          })}
          {visibleNodes.map((node) => {
            const position = positions.get(node.id)!;
            const progress = aggregateProgress.get(node.id) ?? { attempts: 0, correct: 0, lastCorrect: null };
            const projectRoot = node.id === projectRootId;
            const appearance = treeNodeAppearance(progress, projectRoot);
            const childCount = children.get(node.id)?.length ?? 0;
            const expanded = isExpanded(node);
            const emphasized = !selectedNodeId || selectedBranch.has(node.id);
            const closing = isBelowClosingNode(node);
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                onClick={() => toggleNode(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") toggleNode(node);
                }}
                aria-label={`${node.title}, ${appearance.label}`}
                data-tree-node={node.conceptNodeId ?? "project"}
                className="cursor-pointer outline-none"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px)`,
                  opacity: closing ? 0 : emphasized ? 1 : 0.32,
                  transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease",
                }}
              >
                <g className="sf-tree-node-enter">
                  <title>{`${node.title}${node.description ? ` — ${node.description}` : ""}`}</title>
                  <rect
                  x="-91"
                  y="-27"
                  width="182"
                  height="54"
                  rx="14"
                  fill={appearance.fill}
                  stroke={selectedNodeId === node.id ? "#F0F0EE" : appearance.stroke}
                  strokeWidth={selectedNodeId === node.id || projectRoot ? 2 : 1.35}
                  />
                  <circle cx="-72" cy="0" r="4.5" fill={appearance.stroke} />
                  <text
                  x="-60"
                  y={node.treeTitle ? -5 : 1}
                  dominantBaseline="middle"
                  fill={appearance.text}
                  fontSize="12"
                  fontWeight="600"
                >
                  {truncateTreeLabel(node.title, 20)}
                  </text>
                  {node.treeTitle ? (
                    <text x="-60" y="13" fill="#929292" fontSize="9">
                      {truncateTreeLabel(node.treeTitle, 25)}
                    </text>
                  ) : null}
                  {childCount ? (
                    <g transform="translate(73, 0)">
                      <circle r="10" fill="#303030" stroke="#606060" />
                      <text textAnchor="middle" dominantBaseline="middle" fill="#D0D0D0" fontSize="12" fontWeight="600">{expanded ? "−" : "+"}</text>
                    </g>
                  ) : null}
                </g>
              </g>
            );
          })}
            </svg>
          </div>
        </div>
        <style>{`
          @keyframes sf-tree-node-enter {
            from { opacity: 0; transform: translateX(-12px) scale(0.97); }
            to { opacity: 1; transform: translateX(0) scale(1); }
          }
          @keyframes sf-tree-edge-enter {
            from { opacity: 0; }
          }
          .sf-tree-node-enter {
            animation: sf-tree-node-enter 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
            transform-box: fill-box;
            transform-origin: center;
          }
          .sf-tree-edge-enter {
            animation: sf-tree-edge-enter 220ms ease both;
          }
          @media (prefers-reduced-motion: reduce) {
            .sf-tree-node-enter, .sf-tree-edge-enter { animation: none; }
          }
        `}</style>
      </div>
    </div>
  );
}

function TreeLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function treeNodeAppearance(progress: TreeProgress, projectRoot: boolean) {
  if (projectRoot) {
    return { fill: "#E7E7E5", stroke: "#F4F4F2", text: "#202020", label: "프로젝트 루트" };
  }
  if (progress.attempts === 0) {
    return { fill: "#242424", stroke: "#565656", text: "#BDBDBD", label: "미학습" };
  }
  if (progress.lastCorrect === false) {
    return { fill: "#352323", stroke: "#8A4B4B", text: "#F0C4C4", label: "최근 오답" };
  }
  if (progress.correct === progress.attempts && progress.attempts >= 2) {
    return { fill: "#213129", stroke: "#4D7A60", text: "#C8E2D0", label: "안정" };
  }
  return { fill: "#332F20", stroke: "#8A7A45", text: "#E7DDAE", label: "학습 중" };
}

function truncateTreeLabel(value: string, maximum = 16) {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
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
  const readingPosition = usePdfReadingPosition(reader.source.id);

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
            {readingPosition.isLoadingPosition ? (
              <p className="p-6 text-center text-sm text-[#A5A9A4]">마지막 읽기 위치를 확인하는 중입니다.</p>
            ) : (
              <>
                {readingPosition.positionError ? (
                  <p className="mb-2 rounded-xl border border-[#5A403A] bg-[#332724] px-3 py-2 text-xs text-[#FFB4A2]">
                    {readingPosition.positionError}
                  </p>
                ) : null}
                <PdfReviewViewer
                  files={[reader.file]}
                  sourceIds={[reader.source.id]}
                  initialPageBySourceId={{
                    [reader.source.id]: readingPosition.initialPage,
                  }}
                  onPageChange={readingPosition.handlePageChange}
                />
              </>
            )}
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
