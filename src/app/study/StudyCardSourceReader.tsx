"use client";

import { loadDeckPdfFiles } from "@/lib/storage";
import type { Card, Deck } from "@/lib/types";
import type { StudyProjectDetail, StudyProjectSource } from "@/lib/study-project-types";
import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import PdfReviewViewer from "../PdfReviewViewer";
import { findExactPdfSourceIndex } from "../pdf-source-navigation";
import { usePdfReadingPosition } from "./usePdfReadingPosition";

type OpenedSource = {
  id: string;
  file: File;
};

export function StudyCardSourceReader({ deck, card }: { deck: Deck; card: Card }) {
  const [openedSource, setOpenedSource] = useState<OpenedSource | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState("");
  const sourceId = card.sourceId?.trim() ?? "";
  const sourcePage = card.sourcePage && card.sourcePage > 0 ? card.sourcePage : 0;

  if (!sourceId || !sourcePage) return null;

  async function openSource() {
    setIsOpening(true);
    setError("");

    try {
      const projectSource = deck.projectId
        ? await findProjectSource(deck.projectId, sourceId)
        : null;

      if (projectSource) {
        const file = await downloadProjectSource(projectSource);
        setOpenedSource({ id: projectSource.id, file });
        return;
      }

      const files = await loadDeckPdfFiles(deck.id);
      const sourceIndex = findExactPdfSourceIndex(
        files.map((file, index) => ({
          id: deck.pdfSourceIds?.[index],
          fileName: file.name,
        })),
        sourceId,
      );

      if (sourceIndex < 0) {
        throw new Error("이 카드에 연결된 원본 PDF를 정확히 찾지 못했습니다.");
      }

      setOpenedSource({
        id: deck.pdfSourceIds?.[sourceIndex] ?? files[sourceIndex].name,
        file: files[sourceIndex],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "원본 PDF를 열지 못했습니다.");
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <>
      <div className="mt-6 border-t border-[#303030] pt-4">
        <button
          type="button"
          onClick={() => void openSource()}
          disabled={isOpening}
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[#3B3B3B] bg-[#202020] px-3 text-xs font-medium text-[#B5B5B5] transition hover:border-[#555] hover:text-[#E8E8E8] disabled:opacity-50"
        >
          <ExternalLink size={14} />
          {isOpening ? "원문 여는 중" : `원문 PDF ${sourcePage}페이지 보기`}
        </button>
        <p className="mt-2 text-[11px] leading-5 text-[#767676]">
          문장 좌표가 없어 원문 페이지 단위로 이동합니다.
        </p>
        {error ? <p className="mt-2 text-xs text-[#FF8F73]">{error}</p> : null}
      </div>

      {openedSource ? (
        <div className="fixed inset-0 z-[90] bg-black/75 p-2 backdrop-blur-sm sm:p-5">
          <section className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[#3B3B3B] bg-[#171717] shadow-2xl">
            <header className="flex min-h-14 items-center justify-between gap-3 border-b border-[#303030] px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[#E8E8E8]">{openedSource.file.name}</p>
                <p className="text-[11px] text-[#858585]">카드 출처 · {sourcePage}페이지</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenedSource(null)}
                aria-label="원문 PDF 닫기"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#A5A5A5] hover:bg-[#282828] hover:text-white"
              >
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-[#222] p-2 sm:p-4">
              <CardPdfReader source={openedSource} page={sourcePage} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CardPdfReader({ source, page }: { source: OpenedSource; page: number }) {
  const readingPosition = usePdfReadingPosition(source.id, page, false);

  if (readingPosition.isLoadingPosition) {
    return <p className="p-6 text-center text-sm text-[#A5A5A5]">읽기 위치를 확인하는 중입니다.</p>;
  }

  return (
    <>
      {readingPosition.positionError ? (
        <p className="mb-2 rounded-lg border border-[#5A403A] bg-[#332724] px-3 py-2 text-xs text-[#FFB4A2]">
          {readingPosition.positionError}
        </p>
      ) : null}
      <PdfReviewViewer
        files={[source.file]}
        sourceIds={[source.id]}
        requestedSource={{ sourceId: source.id, page }}
        onPageChange={readingPosition.handlePageChange}
      />
    </>
  );
}

async function findProjectSource(projectId: string, sourceId: string) {
  const response = await fetch(`/api/study-projects/${projectId}`);
  if (!response.ok) return null;
  const detail = (await response.json()) as StudyProjectDetail;
  const index = findExactPdfSourceIndex(detail.sources, sourceId);
  return index >= 0 ? detail.sources[index] : null;
}

async function downloadProjectSource(source: StudyProjectSource) {
  const response = await fetch(`/api/study-sources/${source.id}`);
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(data?.message || data?.error || "원본 PDF 파일을 불러오지 못했습니다.");
  }
  const blob = await response.blob();
  return new File([blob], source.fileName, {
    type: source.mimeType || "application/pdf",
    lastModified: source.lastModified,
  });
}
