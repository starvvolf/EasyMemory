"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import type { LearningUnit } from "@/lib/types";
import {
  findPdfMaskTarget,
  matchesPdfEvidence,
} from "@/lib/pdf-mask";

type SelectionMode = "sentence" | "paragraph";

type TextGroup = {
  id: string;
  text: string;
  elements: HTMLElement[];
};

type TextMaskBox = {
  id: string;
  learningUnitId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type OcrBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type OcrWord = {
  text: string;
  bbox: OcrBox;
};

type OcrLine = {
  text: string;
  bbox: OcrBox;
  words: OcrWord[];
};

type OcrParagraph = {
  text: string;
  bbox: OcrBox;
  lines: OcrLine[];
};

type OcrBlock = {
  paragraphs: OcrParagraph[];
};

type OcrGroup = {
  id: string;
  text: string;
  boxes: OcrBox[];
};

type OcrWorker = {
  recognize: (
    image: HTMLCanvasElement,
    options?: Record<string, never>,
    output?: { text?: boolean; blocks?: boolean },
  ) => Promise<{ data: { blocks: OcrBlock[] | null; text: string } }>;
  terminate: () => Promise<unknown>;
};

type OcrCacheEntry = {
  blocks: OcrBlock[];
  width: number;
  height: number;
};

type PdfReviewViewerProps = {
  files: File[];
  learningUnits?: LearningUnit[];
  excludedLearningUnitIds?: string[];
  activeLearningUnitId?: string | null;
  onActiveLearningUnitChange?: (id: string) => void;
  onToggleLearningUnit?: (id: string) => void;
  learningUnitImportance?: Record<string, number>;
  startInMaskMode?: boolean;
  onMaskRating?: (learningUnitId: string, rating: "known" | "review") => void;
};

export default function PdfReviewViewer({
  files,
  learningUnits,
  excludedLearningUnitIds = [],
  activeLearningUnitId = null,
  onActiveLearningUnitChange,
  onToggleLearningUnit,
  learningUnitImportance = {},
  startInMaskMode = false,
  onMaskRating,
}: PdfReviewViewerProps) {
  const [activeFileIndex, setActiveFileIndex] = useState(() => {
    const activeUnit = learningUnits?.find(
      (unit) => unit.id === activeLearningUnitId,
    );
    const index = activeUnit
      ? files.findIndex((file) => matchesSourceFile(file.name, activeUnit.sourceId))
      : -1;
    return index >= 0 ? index : 0;
  });
  const safeActiveFileIndex = Math.min(activeFileIndex, files.length - 1);
  const activeFile = files[safeActiveFileIndex];
  const selectedLearningUnit = learningUnits?.find(
    (unit) => unit.id === activeLearningUnitId,
  );
  const activeFileLearningUnits = learningUnits?.filter(
    (unit) =>
      matchesSourceFile(activeFile?.name ?? "", unit.sourceId) ||
      (safeActiveFileIndex === 0 &&
        !files.some((file) => matchesSourceFile(file.name, unit.sourceId))),
  );

  if (!activeFile) {
    return null;
  }

  function selectLearningUnit(id: string) {
    const unit = learningUnits?.find((item) => item.id === id);
    const fileIndex = unit
      ? files.findIndex((file) => matchesSourceFile(file.name, unit.sourceId))
      : -1;
    if (fileIndex >= 0) setActiveFileIndex(fileIndex);
    onActiveLearningUnitChange?.(id);
  }

  return (
    <section className="mt-4 overflow-hidden rounded-md border border-[#DCDFE4] bg-white shadow-sm">
      {files.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-[#DCDFE4] p-2">
          {files.map((file, index) => (
            <button
              key={`${file.name}-${file.size}`}
              type="button"
              onClick={() => setActiveFileIndex(index)}
              className={`max-w-56 shrink-0 truncate rounded-md px-3 py-2 text-xs font-bold ${
                safeActiveFileIndex === index
                  ? "bg-[#0C66E4] text-white"
                  : "bg-[#FFFFFF] text-[#44546F] hover:text-[#172B4D]"
              }`}
              title={file.name}
            >
              {file.name}
            </button>
          ))}
        </div>
      ) : null}

      <PdfDocumentViewer
        key={`${activeFile.name}-${activeFile.size}-${activeFile.lastModified}`}
        file={activeFile}
        initialPage={
          selectedLearningUnit &&
          matchesSourceFile(activeFile.name, selectedLearningUnit.sourceId)
            ? selectedLearningUnit.sourcePage
            : 1
        }
        learningUnits={activeFileLearningUnits}
        excludedLearningUnitIds={excludedLearningUnitIds}
        activeLearningUnitId={activeLearningUnitId}
        onActiveLearningUnitChange={selectLearningUnit}
        onToggleLearningUnit={onToggleLearningUnit}
        learningUnitImportance={learningUnitImportance}
        startInMaskMode={startInMaskMode}
        onMaskRating={onMaskRating}
      />
    </section>
  );
}

function PdfDocumentViewer({
  file,
  initialPage,
  learningUnits,
  excludedLearningUnitIds,
  activeLearningUnitId,
  onActiveLearningUnitChange,
  onToggleLearningUnit,
  learningUnitImportance,
  startInMaskMode,
  onMaskRating,
}: {
  file: File;
  initialPage: number;
  learningUnits?: LearningUnit[];
  excludedLearningUnitIds: string[];
  activeLearningUnitId: string | null;
  onActiveLearningUnitChange?: (id: string) => void;
  onToggleLearningUnit?: (id: string) => void;
  learningUnitImportance: Record<string, number>;
  startInMaskMode: boolean;
  onMaskRating?: (learningUnitId: string, rating: "known" | "review") => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfViewportRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<Map<string, TextGroup>>(new Map());
  const ocrWorkerPromiseRef = useRef<Promise<OcrWorker> | null>(null);
  const ocrProgressHandlerRef = useRef<(progress: number) => void>(() => {});
  const ocrCacheRef = useRef<Map<number, OcrCacheEntry>>(new Map());
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [renderedScale, setRenderedScale] = useState(1.25);
  const [compactPdfWidth, setCompactPdfWidth] = useState<number | null>(null);
  const [fitToWidth, setFitToWidth] = useState(false);
  const [mode, setMode] = useState<SelectionMode>("sentence");
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedTexts, setSelectedTexts] = useState<
    Array<{ id: string; text: string }>
  >([]);
  const [ocrGroups, setOcrGroups] = useState<OcrGroup[]>([]);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [status, setStatus] = useState("PDF를 여는 중입니다.");
  const [error, setError] = useState("");
  const [matchedLearningUnitIds, setMatchedLearningUnitIds] = useState<string[]>([]);
  const [textMaskBoxes, setTextMaskBoxes] = useState<TextMaskBox[]>([]);
  const [maskPracticeMode, setMaskPracticeMode] = useState(startInMaskMode);
  const [revealedMaskUnitIds, setRevealedMaskUnitIds] = useState<string[]>([]);
  const [renderRevision, setRenderRevision] = useState(0);
  const isLearningUnitReview = Boolean(learningUnits);
  const pageLearningUnits = useMemo(
    () => (learningUnits ?? []).filter((unit) => unit.sourcePage === pageNumber),
    [learningUnits, pageNumber],
  );

  useEffect(() => {
    return () => {
      const workerPromise = ocrWorkerPromiseRef.current;
      if (workerPromise) {
        void workerPromise.then((worker) => worker.terminate());
      }
    };
  }, []);

  useEffect(() => {
    const viewport = pdfViewportRef.current;

    if (!viewport) return;

    const compactQuery = window.matchMedia("(max-width: 1023px)");
    const updateViewport = () => {
      const compact = compactQuery.matches;
      const styles = window.getComputedStyle(viewport);
      const availableWidth =
        viewport.clientWidth -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight);

      setCompactPdfWidth(compact ? Math.max(1, availableWidth) : null);
    };
    const updateLayoutMode = () => {
      setFitToWidth(compactQuery.matches);
      updateViewport();
    };
    const observer = new ResizeObserver(updateViewport);

    observer.observe(viewport);
    compactQuery.addEventListener("change", updateLayoutMode);
    updateLayoutMode();

    return () => {
      observer.disconnect();
      compactQuery.removeEventListener("change", updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: {
      promise: Promise<PDFDocumentProxy>;
      destroy: () => Promise<void>;
    } | null = null;

    async function loadDocument() {
      setError("");
      setStatus("PDF를 여는 중입니다.");

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const bytes = new Uint8Array(await file.arrayBuffer());
        loadingTask = pdfjs.getDocument({ data: bytes });
        const loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        setDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setPageNumber(Math.max(1, Math.min(initialPage, loadedDocument.numPages)));
        setStatus("");
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "PDF를 열지 못했습니다.",
          );
          setStatus("");
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [file, initialPage]);

  useEffect(() => {
    if (!document || !canvasRef.current || !textLayerRef.current) {
      return;
    }

    let cancelled = false;
    let renderTask: {
      cancel: () => void;
      promise: Promise<void>;
    } | null = null;
    let ocrRenderTask: {
      cancel: () => void;
      promise: Promise<void>;
    } | null = null;
    let textLayer: { cancel: () => void } | null = null;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;

    async function renderPage() {
      setError("");
      setStatus(`${pageNumber}페이지를 표시하는 중입니다.`);
      setHoveredGroupId(null);
      setSelectedGroupIds([]);
      setSelectedTexts([]);
      setOcrGroups([]);
      setIsOcrRunning(false);
      setOcrProgress(0);
      setMatchedLearningUnitIds([]);
      setTextMaskBoxes([]);
      setRevealedMaskUnitIds([]);
      groupsRef.current.clear();
      textLayerContainer.replaceChildren();

      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await document!.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const nextScale =
          fitToWidth && compactPdfWidth
            ? Math.min(scale, compactPdfWidth / baseViewport.width)
            : scale;
        const viewport = page.getViewport({ scale: nextScale });
        setRenderedScale(nextScale);
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("PDF 캔버스를 초기화하지 못했습니다.");
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerContainer.style.width = `${viewport.width}px`;
        textLayerContainer.style.height = `${viewport.height}px`;
        textLayerContainer.style.setProperty(
          "--total-scale-factor",
          String(nextScale),
        );

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;

        const textContent = await page.getTextContent();
        const nextTextLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport,
        });
        textLayer = nextTextLayer;
        await nextTextLayer.render();

        if (cancelled) {
          return;
        }

        const hasEmbeddedText = textContent.items.some(
          (item) => "str" in item && item.str.trim().length > 0,
        );

        if (!hasEmbeddedText) {
          setIsOcrRunning(true);
          setStatus("이미지 PDF를 OCR로 읽고 있습니다.");
          ocrProgressHandlerRef.current = (progress) => {
            if (!cancelled) {
              setOcrProgress(progress);
            }
          };

          let cachedOcr = ocrCacheRef.current.get(pageNumber);

          if (!cachedOcr) {
            const ocrViewport = page.getViewport({ scale: 2.4 });
            const ocrCanvas = window.document.createElement("canvas");
            const ocrContext = ocrCanvas.getContext("2d");

            if (!ocrContext) {
              throw new Error("OCR 이미지를 준비하지 못했습니다.");
            }

            ocrCanvas.width = Math.ceil(ocrViewport.width);
            ocrCanvas.height = Math.ceil(ocrViewport.height);
            ocrRenderTask = page.render({
              canvas: ocrCanvas,
              canvasContext: ocrContext,
              viewport: ocrViewport,
            });
            await ocrRenderTask.promise;

            if (!ocrWorkerPromiseRef.current) {
              ocrWorkerPromiseRef.current = createOcrWorker((progress) =>
                ocrProgressHandlerRef.current(progress),
              );
            }

            const worker = await ocrWorkerPromiseRef.current;
            const result = await worker.recognize(
              ocrCanvas,
              {},
              { text: true, blocks: true },
            );
            const blocks = result.data.blocks ?? [];

            if (blocks.length === 0 || !result.data.text.trim()) {
              throw new Error(
                "OCR에서 선택할 수 있는 문장을 찾지 못했습니다.",
              );
            }

            cachedOcr = {
              blocks,
              width: ocrCanvas.width,
              height: ocrCanvas.height,
            };
            ocrCacheRef.current.set(pageNumber, cachedOcr);
          }

          if (cancelled) {
            return;
          }

          const nextOcrGroups = createOcrGroups(
              pageNumber,
              mode,
              cachedOcr,
              viewport.width,
              viewport.height,
            );
          setOcrGroups(nextOcrGroups);
          setMatchedLearningUnitIds(
            pageLearningUnits
              .filter((unit) =>
                nextOcrGroups.some((group) =>
                  matchesPdfEvidence(group.text, unit.sourceText, unit.sourceRange),
                ),
              )
              .map((unit) => unit.id),
          );
          setIsOcrRunning(false);
          setOcrProgress(1);
          setStatus("");
          return;
        }

        const groups = createTextGroups(
          pageNumber,
          mode,
          textContent,
          nextTextLayer.textDivs,
        );
        groupsRef.current = groups;
        setMatchedLearningUnitIds(
          pageLearningUnits
            .filter((unit) =>
              [...groups.values()].some((group) =>
                matchesPdfEvidence(group.text, unit.sourceText, unit.sourceRange),
              ),
            )
            .map((unit) => unit.id),
        );
        setTextMaskBoxes(
          createTextMaskBoxes(groups, pageLearningUnits, textLayerContainer),
        );
        if (!isLearningUnitReview) {
          attachGroupEvents(
            groups,
            setHoveredGroupId,
            setSelectedGroupIds,
            setSelectedTexts,
          );
        }
        setRenderRevision((value) => value + 1);
        setStatus("");
      } catch (renderError) {
        if (
          !cancelled &&
          !(renderError instanceof Error && renderError.name === "RenderingCancelledException")
        ) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "PDF 페이지를 표시하지 못했습니다.",
          );
          setIsOcrRunning(false);
          setStatus("");
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      ocrRenderTask?.cancel();
      textLayer?.cancel();
    };
  }, [
    compactPdfWidth,
    document,
    fitToWidth,
    isLearningUnitReview,
    mode,
    pageLearningUnits,
    pageNumber,
    scale,
  ]);

  useEffect(() => {
    if (!isLearningUnitReview) return;

    for (const unit of pageLearningUnits) {
      const matchedGroups = [...groupsRef.current.values()].filter((group) =>
        matchesPdfEvidence(group.text, unit.sourceText, unit.sourceRange),
      );

      for (const group of matchedGroups) {
        for (const element of group.elements) {
          const isRevealed = revealedMaskUnitIds.includes(unit.id);
          element.classList.toggle("pdf-text-evidence", !maskPracticeMode);
          element.classList.remove(
            "pdf-text-importance-1",
            "pdf-text-importance-2",
            "pdf-text-importance-3",
          );
          if (!maskPracticeMode) {
            element.classList.add(
              `pdf-text-importance-${normalizeImportance(learningUnitImportance[unit.id])}`,
            );
          }
          element.classList.toggle(
            "pdf-text-evidence-active",
            !maskPracticeMode && unit.id === activeLearningUnitId,
          );
          element.classList.remove("pdf-text-mask");
          element.classList.toggle(
            "pdf-text-mask-revealed",
            maskPracticeMode && isRevealed,
          );
          if (maskPracticeMode) {
            element.removeAttribute("role");
            element.removeAttribute("aria-label");
            element.removeAttribute("title");
            element.removeAttribute("tabindex");
            element.onclick = null;
            element.onkeydown = null;
          } else {
            element.setAttribute("role", "button");
            element.tabIndex = 0;
            element.setAttribute("aria-label", "학습 근거 선택");
            element.title = unit.sourceRange;
            element.onclick = (event) => {
              event.preventDefault();
              onActiveLearningUnitChange?.(unit.id);
            };
            element.onkeydown = (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                element.click();
              }
            };
          }
        }
      }
    }
  }, [activeLearningUnitId, isLearningUnitReview, learningUnitImportance, maskPracticeMode, onActiveLearningUnitChange, pageLearningUnits, renderRevision, revealedMaskUnitIds]);

  useEffect(() => {
    for (const group of groupsRef.current.values()) {
      const isHovered = hoveredGroupId === group.id;
      const isSelected = selectedGroupIds.includes(group.id);

      for (const element of group.elements) {
        element.classList.toggle("pdf-text-hovered", isHovered && !isSelected);
        element.classList.toggle("pdf-text-selected", isSelected);
      }
    }
  }, [hoveredGroupId, selectedGroupIds]);

  function toggleSelection(id: string, text: string) {
    setSelectedGroupIds((current) =>
      current.includes(id)
        ? current.filter((groupId) => groupId !== id)
        : [...current, id],
    );
    setSelectedTexts((current) =>
      current.some((selection) => selection.id === id)
        ? current.filter((selection) => selection.id !== id)
        : [...current, { id, text }],
    );
  }

  function removeSelection(id: string) {
    setSelectedGroupIds((current) =>
      current.filter((groupId) => groupId !== id),
    );
    setSelectedTexts((current) =>
      current.filter((selection) => selection.id !== id),
    );
  }

  function selectLearningUnit(id: string) {
    const unit = learningUnits?.find((item) => item.id === id);
    if (unit?.sourcePage && unit.sourcePage !== pageNumber) {
      setPageNumber(unit.sourcePage);
    }
    onActiveLearningUnitChange?.(id);
  }

  return (
    <div>
      <div className="border-b border-[#DCDFE4] bg-[#FFFFFF] px-4 py-3">
        <p className="truncate text-sm font-black text-[#172B4D]">{file.name}</p>
        <p className="mt-1 text-xs text-[#44546F]">
          {isLearningUnitReview
            ? maskPracticeMode
              ? "AI가 선택한 핵심을 가렸습니다. 먼저 답을 떠올린 뒤 박스를 눌러 확인하세요."
              : "추출된 학습 내용의 원문 근거를 표시합니다."
            : "텍스트에 마우스를 올리고 클릭하면 선택됩니다."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:h-[calc(100dvh-10rem)] lg:min-h-[44rem] lg:grid-cols-[4.5rem_minmax(0,1fr)_22rem] lg:grid-rows-1">
        <aside className="flex flex-wrap items-center gap-2 border-b border-[#DCDFE4] bg-[#F1F2F4] p-2 lg:min-h-0 lg:flex-col lg:items-stretch lg:gap-4 lg:border-b-0 lg:border-r">
          {!isLearningUnitReview ? <div className="flex items-center gap-1 lg:block lg:space-y-1" aria-label="선택 단위">
            <p className="px-1 text-center text-[10px] font-bold text-[#7A869A]">
              선택
            </p>
            <ModeButton
              active={mode === "sentence"}
              disabled={isOcrRunning}
              onClick={() => setMode("sentence")}
            >
              문장
            </ModeButton>
            <ModeButton
              active={mode === "paragraph"}
              disabled={isOcrRunning}
              onClick={() => setMode("paragraph")}
            >
              문단
            </ModeButton>
          </div> : null}

          {isLearningUnitReview ? (
            <div className="flex items-center gap-1 lg:block lg:space-y-1" aria-label="PDF 학습 방식">
              <p className="px-1 text-center text-[10px] font-bold text-[#7A869A]">
                학습
              </p>
              <ModeButton
                active={maskPracticeMode}
                disabled={isOcrRunning}
                onClick={() => {
                  setRevealedMaskUnitIds([]);
                  setMaskPracticeMode((active) => !active);
                }}
              >
                가림
              </ModeButton>
            </div>
          ) : null}

          {isLearningUnitReview && !maskPracticeMode ? (
            <div className="hidden space-y-1 border-t border-[#DCDFE4] pt-3 lg:block" aria-label="AI 중요도 범례">
              <p className="text-center text-[10px] font-bold text-[#7A869A]">중요도</p>
              <span className="block rounded bg-[#FFEB99] px-1 py-1 text-center text-[10px] font-black">3 핵심</span>
              <span className="block rounded bg-[#DDEBFF] px-1 py-1 text-center text-[10px] font-black">2 중요</span>
              <span className="block rounded bg-[#E9EBEE] px-1 py-1 text-center text-[10px] font-black">1 참고</span>
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1 lg:ml-0 lg:block lg:space-y-1 lg:border-t lg:border-[#DCDFE4] lg:pt-3">
            <p className="px-1 text-center text-[10px] font-bold text-[#7A869A]">
              배율
            </p>
            <button
              type="button"
              onClick={() => {
                setFitToWidth(false);
                setScale(Math.min(4, renderedScale + 0.25));
              }}
              disabled={isOcrRunning}
              className={toolbarButtonClassName}
              aria-label="확대"
              title="확대"
            >
              +
            </button>
            <span className="block py-1 text-center text-[10px] font-bold text-[#44546F]">
              {Math.round(renderedScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => {
                setFitToWidth(false);
                setScale(Math.max(0.5, renderedScale - 0.25));
              }}
              disabled={isOcrRunning}
              className={toolbarButtonClassName}
              aria-label="축소"
              title="축소"
            >
              -
            </button>
            {compactPdfWidth ? (
              <button
                type="button"
                onClick={() => setFitToWidth(true)}
                disabled={isOcrRunning || fitToWidth}
                className={toolbarButtonClassName}
              >
                맞춤
              </button>
            ) : null}
          </div>

        </aside>

        <div
          ref={pdfViewportRef}
          className="overflow-x-clip bg-[#DFE1E6] p-3 sm:p-4 lg:min-h-0 lg:overflow-auto"
        >
          <div className="sticky top-0 z-20 mb-4 flex justify-center">
            <div className="flex items-center gap-2 rounded-md border border-[#DCDFE4] bg-[#FFFFFF]/95 p-2 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
                disabled={pageNumber <= 1 || isOcrRunning}
                className={pageButtonClassName}
              >
                이전
              </button>
              <span className="min-w-20 text-center text-xs font-black text-[#172B4D]">
                {pageNumber} / {pageCount || "-"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPageNumber((page) => Math.min(pageCount, page + 1))
                }
                disabled={pageNumber >= pageCount || isOcrRunning}
                className={pageButtonClassName}
              >
                다음
              </button>
            </div>
          </div>

          <div className="mx-auto w-fit shadow-xl">
            <div className="relative bg-white">
              <canvas ref={canvasRef} className="block" />
              <div ref={textLayerRef} className="pdf-text-layer" />
              {maskPracticeMode && textMaskBoxes.length > 0 ? (
                <div className="pdf-mask-layer" aria-label="AI 핵심 가림 영역">
                  {textMaskBoxes
                    .filter(
                      (box) => !revealedMaskUnitIds.includes(box.learningUnitId),
                    )
                    .map((box) => (
                      <button
                        key={box.id}
                        type="button"
                        className="pdf-mask-box"
                        aria-label="가린 정답 보기"
                        title="정답 보기"
                        onClick={() => {
                          setRevealedMaskUnitIds((current) => [
                            ...current,
                            box.learningUnitId,
                          ]);
                          onActiveLearningUnitChange?.(box.learningUnitId);
                        }}
                        style={{
                          left: `${box.left}px`,
                          top: `${box.top}px`,
                          width: `${box.width}px`,
                          height: `${box.height}px`,
                        }}
                      />
                    ))}
                </div>
              ) : null}
              {ocrGroups.length > 0 ? (
                <div className="pdf-ocr-layer" aria-label="OCR 선택 영역">
                  {ocrGroups.flatMap((group) => {
                    const matchedUnit = findPdfMaskTarget(
                      group.text,
                      pageLearningUnits,
                    );
                    const isMaskRevealed = Boolean(
                      matchedUnit && revealedMaskUnitIds.includes(matchedUnit.id),
                    );
                    return group.boxes.map((box, boxIndex) => (
                      <button
                        key={`${group.id}-${boxIndex}`}
                        type="button"
                        aria-label={
                          matchedUnit && maskPracticeMode
                            ? isMaskRevealed
                              ? "정답 다시 가리기"
                              : "가린 정답 보기"
                            : group.text
                        }
                        title={
                          matchedUnit && maskPracticeMode
                            ? isMaskRevealed
                              ? "다시 가리기"
                              : "정답 보기"
                            : group.text
                        }
                        onMouseEnter={() => setHoveredGroupId(group.id)}
                        onMouseLeave={() => setHoveredGroupId(null)}
                        onClick={() =>
                          matchedUnit
                            ? maskPracticeMode
                              ? (setRevealedMaskUnitIds((current) =>
                                  current.includes(matchedUnit.id)
                                    ? current.filter((id) => id !== matchedUnit.id)
                                    : [...current, matchedUnit.id],
                                ),
                                onActiveLearningUnitChange?.(matchedUnit.id))
                              : selectLearningUnit(matchedUnit.id)
                            : toggleSelection(group.id, group.text)
                        }
                        className={`pdf-ocr-box ${
                          matchedUnit
                            ? maskPracticeMode
                              ? isMaskRevealed
                                ? "pdf-ocr-mask-revealed"
                                : "pdf-ocr-mask"
                              : `${matchedUnit.id === activeLearningUnitId
                                  ? "pdf-ocr-evidence pdf-ocr-evidence-active"
                                  : "pdf-ocr-evidence"} pdf-ocr-importance-${normalizeImportance(learningUnitImportance[matchedUnit.id])}`
                            : selectedGroupIds.includes(group.id)
                            ? "pdf-ocr-selected"
                            : hoveredGroupId === group.id
                              ? "pdf-ocr-hovered"
                              : ""
                        }`}
                        style={{
                          left: `${box.x0}px`,
                          top: `${box.y0}px`,
                          width: `${Math.max(2, box.x1 - box.x0)}px`,
                          height: `${Math.max(2, box.y1 - box.y0)}px`,
                        }}
                      />
                    ));
                  })}
                </div>
              ) : null}
              {status ? (
                <div className="absolute inset-0 z-10 grid min-h-80 place-items-center bg-white/90 px-4 text-sm font-bold text-[#172B4D]">
                  <div className="w-full max-w-xs text-center">
                    <p>{status}</p>
                    {isOcrRunning ? (
                      <>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#DCDFE4]">
                          <div
                            className="h-full rounded-full bg-[#0C66E4] transition-[width]"
                            style={{
                              width: `${Math.max(4, Math.round(ocrProgress * 100))}%`,
                            }}
                          />
                        </div>
                        <p className="mt-2 text-xs text-[#626F86]">
                          처음 인식할 때는 언어 모델을 준비하느라 시간이 걸릴 수
                          있습니다.
                        </p>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="min-h-0 border-t border-[#DCDFE4] bg-[#F1F2F4] p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-[#172B4D]">
              {isLearningUnitReview
                ? maskPracticeMode
                  ? "가림 학습 항목"
                  : "추출된 학습 내용"
                : "선택한 내용"}
            </h3>
            {!isLearningUnitReview && selectedTexts.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedGroupIds([]);
                  setSelectedTexts([]);
                }}
                className="text-xs font-bold text-[#44546F] hover:text-[#172B4D]"
              >
                전체 해제
              </button>
            ) : null}
          </div>

          {isLearningUnitReview ? (
            <div className="mt-3 space-y-2">
              {(learningUnits ?? []).length > 0 ? (learningUnits ?? []).map((unit) => {
                const excluded = excludedLearningUnitIds.includes(unit.id);
                const isCurrentPage = unit.sourcePage === pageNumber;
                const matched = isCurrentPage && (matchedLearningUnitIds.includes(unit.id) ||
                  ocrGroups.some((group) =>
                    matchesPdfEvidence(group.text, unit.sourceText, unit.sourceRange),
                  ));
                const isMaskRevealed = revealedMaskUnitIds.includes(unit.id);
                return (
                  <article
                    key={unit.id}
                    className={`rounded-md border p-3 ${
                      unit.id === activeLearningUnitId
                        ? "border-[#E2B203] bg-[#FFF7D6]"
                        : "border-[#DCDFE4] bg-white"
                    } ${excluded ? "opacity-55" : ""}`}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => selectLearningUnit(unit.id)}
                    >
                      <p className="text-xs font-black text-[#44546F]">
                        {unit.id} · p.{unit.sourcePage} · {isCurrentPage
                          ? matched
                            ? "원문 위치 확인"
                            : "위치를 찾지 못한 학습 내용"
                          : "눌러서 근거 확인"}
                      </p>
                      {maskPracticeMode && !isMaskRevealed ? (
                        <p className="mt-2 rounded bg-[#F1F2F4] p-2 text-xs font-bold leading-5 text-[#44546F]">
                          정답을 떠올린 뒤 가림 박스나 정답 보기 버튼을 누르세요.
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 text-sm leading-6 text-[#172B4D]">
                            {unit.target || unit.intent || unit.generalizedForm || unit.sourceText}
                          </p>
                          {!maskPracticeMode ? (
                            <p className="mt-2 rounded bg-[#F1F2F4] p-2 text-xs leading-5 text-[#44546F]">
                              원문 근거: {unit.sourceText}
                            </p>
                          ) : null}
                          {unit.operation ? (
                            <p className="mt-2 text-xs font-bold text-[#0C66E4]">
                              해야 할 행동: {getLearningOperationLabel(unit.operation)}
                            </p>
                          ) : null}
                          {unit.successCriterion ? (
                            <p className="mt-1 text-xs leading-5 text-[#626F86]">
                              성공 기준: {unit.successCriterion}
                            </p>
                          ) : null}
                        </>
                      )}
                    </button>
                    {maskPracticeMode && isCurrentPage && matched ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRevealedMaskUnitIds((current) =>
                            current.includes(unit.id)
                              ? current.filter((id) => id !== unit.id)
                              : [...current, unit.id],
                          );
                          onActiveLearningUnitChange?.(unit.id);
                        }}
                        className="mt-2 mr-3 text-xs font-bold text-[#0C66E4]"
                      >
                        {isMaskRevealed ? "다시 가리기" : "정답 보기"}
                      </button>
                    ) : null}
                    {maskPracticeMode && isMaskRevealed && onMaskRating ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => onMaskRating(unit.id, "review")}
                          className="rounded bg-[#FFECEB] px-3 py-1.5 text-xs font-black text-[#AE2E24]"
                        >
                          다시 보기
                        </button>
                        <button
                          type="button"
                          onClick={() => onMaskRating(unit.id, "known")}
                          className="rounded bg-[#D9F2E6] px-3 py-1.5 text-xs font-black text-[#216E4E]"
                        >
                          기억남
                        </button>
                      </div>
                    ) : null}
                    {onToggleLearningUnit ? <button
                      type="button"
                      onClick={() => onToggleLearningUnit?.(unit.id)}
                      className={`mt-2 text-xs font-bold ${
                        excluded ? "text-[#0C66E4]" : "text-[#AE2E24]"
                      }`}
                    >
                      {excluded ? "다시 포함" : "학습에서 제외"}
                    </button> : null}
                  </article>
                );
              }) : (
                <p className="text-sm leading-6 text-[#626F86]">
                  이 페이지에 연결된 학습 내용이 없습니다.
                </p>
              )}
            </div>
          ) : selectedTexts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {selectedTexts.map((selection, index) => (
                <article
                  key={selection.id}
                  className="rounded-md border border-[#0C66E4]/50 bg-[#0C66E4]/10 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black text-[#44546F]">
                      선택 {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeSelection(selection.id)}
                      className="rounded px-2 py-1 text-xs font-bold text-[#AE2E24] hover:bg-[#C9372C]/15 hover:text-[#172B4D]"
                      aria-label={`${index + 1}번 선택 해제`}
                    >
                      해제
                    </button>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#172B4D]">
                    {selection.text}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[#626F86]">
              아직 선택한 문장이 없습니다.
            </p>
          )}

          {error ? (
            <p className="mt-4 rounded-md border border-[#C9372C]/40 bg-[#C9372C]/10 p-3 text-sm font-bold text-[#AE2E24]">
              {error}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

async function createOcrWorker(onProgress: (progress: number) => void) {
  const tesseract = await import("tesseract.js");
  const worker = await tesseract.createWorker(
    ["kor", "eng"],
    tesseract.OEM.LSTM_ONLY,
    {
      logger: (message) => onProgress(message.progress),
    },
  );

  return worker as unknown as OcrWorker;
}

function createOcrGroups(
  pageNumber: number,
  mode: SelectionMode,
  cache: OcrCacheEntry,
  targetWidth: number,
  targetHeight: number,
) {
  const scaleX = targetWidth / cache.width;
  const scaleY = targetHeight / cache.height;
  const paragraphs = cache.blocks.flatMap((block) => block.paragraphs);
  const groups: OcrGroup[] = [];
  let groupIndex = 0;

  const scaleBox = (box: OcrBox): OcrBox => ({
    x0: box.x0 * scaleX,
    y0: box.y0 * scaleY,
    x1: box.x1 * scaleX,
    y1: box.y1 * scaleY,
  });

  if (mode === "paragraph") {
    const lines = paragraphs
      .flatMap((paragraph) => paragraph.lines)
      .filter((line) => line.text.trim())
      .sort((left, right) => {
        const yDifference = left.bbox.y0 - right.bbox.y0;
        return Math.abs(yDifference) > 4
          ? yDifference
          : left.bbox.x0 - right.bbox.x0;
      });
    let currentLines: OcrLine[] = [];

    const finishParagraph = () => {
      if (currentLines.length === 0) {
        return;
      }

      groups.push({
        id: `${pageNumber}-ocr-paragraph-${groupIndex++}`,
        text: currentLines
          .map((line) => line.text.trim())
          .filter(Boolean)
          .join("\n"),
        boxes: currentLines.map((line) => scaleBox(line.bbox)),
      });
      currentLines = [];
    };

    for (const line of lines) {
      const previousLine = currentLines.at(-1);

      if (previousLine && startsNewOcrParagraph(previousLine, line)) {
        finishParagraph();
      }

      currentLines.push(line);
    }

    finishParagraph();
    return groups;
  }

  for (const paragraph of paragraphs) {
    let currentText = "";
    let currentBoxes: OcrBox[] = [];

    const finishSentence = () => {
      if (!currentText.trim() || currentBoxes.length === 0) {
        return;
      }

      groups.push({
        id: `${pageNumber}-ocr-sentence-${groupIndex++}`,
        text: currentText.trim(),
        boxes: currentBoxes.map(scaleBox),
      });
      currentText = "";
      currentBoxes = [];
    };

    for (const line of paragraph.lines) {
      let lineBox: OcrBox | null = null;

      for (const word of line.words) {
        const text = word.text.trim();

        if (!text) {
          continue;
        }

        currentText = joinText(currentText, text);
        lineBox = lineBox
          ? {
              x0: Math.min(lineBox.x0, word.bbox.x0),
              y0: Math.min(lineBox.y0, word.bbox.y0),
              x1: Math.max(lineBox.x1, word.bbox.x1),
              y1: Math.max(lineBox.y1, word.bbox.y1),
            }
          : { ...word.bbox };

        if (endsSentence(text)) {
          currentBoxes.push(lineBox);
          lineBox = null;
          finishSentence();
        }
      }

      if (lineBox) {
        currentBoxes.push(lineBox);
      }
    }

    finishSentence();
  }

  return groups;
}

function startsNewOcrParagraph(previous: OcrLine, current: OcrLine) {
  const previousHeight = previous.bbox.y1 - previous.bbox.y0;
  const currentHeight = current.bbox.y1 - current.bbox.y0;
  const verticalGap = current.bbox.y0 - previous.bbox.y1;
  const referenceHeight = Math.max(previousHeight, currentHeight, 1);

  return verticalGap > referenceHeight * 1.25;
}

function ModeButton({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-w-14 rounded px-2 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 lg:w-full lg:px-1 ${
        active
          ? "bg-[#0C66E4] text-white"
          : "text-[#44546F] hover:text-[#172B4D]"
      }`}
    >
      {children}
    </button>
  );
}

function createTextMaskBoxes(
  groups: Map<string, TextGroup>,
  learningUnits: LearningUnit[],
  container: HTMLElement,
): TextMaskBox[] {
  const containerRect = container.getBoundingClientRect();
  const boxes: TextMaskBox[] = [];

  for (const unit of learningUnits) {
    for (const group of groups.values()) {
      if (!matchesPdfEvidence(group.text, unit.sourceText, unit.sourceRange)) {
        continue;
      }

      group.elements.forEach((element, index) => {
        if (normalizeMaskElementText(element.textContent ?? "").length < 2) {
          return;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        boxes.push({
          id: `${unit.id}-${group.id}-${index}`,
          learningUnitId: unit.id,
          left: Math.max(0, rect.left - containerRect.left - 1),
          top: Math.max(0, rect.top - containerRect.top - 1),
          width: rect.width + 2,
          height: rect.height + 2,
        });
      });
    }
  }

  return boxes;
}

function createTextGroups(
  pageNumber: number,
  mode: SelectionMode,
  textContent: TextContent,
  textDivs: HTMLElement[],
) {
  const textItems = textContent.items.filter(
    (item): item is TextItem => "str" in item,
  );
  const groups = new Map<string, TextGroup>();
  let groupIndex = 0;
  let currentGroup: TextGroup | null = null;
  let previousItem: TextItem | null = null;
  let paragraphStartX = 0;

  textItems.forEach((item, index) => {
    const element = textDivs[index];
    const text = item.str.trim();

    if (!element || !text) {
      return;
    }

    if (mode === "sentence") {
      const startsNewSentenceBlock =
        previousItem !== null &&
        shouldStartNewParagraph(previousItem, item, paragraphStartX);
      if (startsNewSentenceBlock) {
        currentGroup = null;
      }
      const fragments = splitSentenceFragments(item.str);
      const fragmentElements =
        fragments.length > 1
          ? fragments.map((fragment) => {
              const fragmentElement = window.document.createElement("span");
              fragmentElement.className = "pdf-text-fragment";
              fragmentElement.textContent = fragment;
              return fragmentElement;
            })
          : [element];

      if (fragments.length > 1) {
        element.replaceChildren(...fragmentElements);
      }

      fragments.forEach((fragment, fragmentIndex) => {
        const normalizedFragment = fragment.trim();

        if (!normalizedFragment) {
          return;
        }

        if (!currentGroup) {
          currentGroup = {
            id: `${pageNumber}-${mode}-${groupIndex++}`,
            text: "",
            elements: [],
          };
          groups.set(currentGroup.id, currentGroup);
          paragraphStartX = item.transform[4];
        }

        const fragmentElement = fragmentElements[fragmentIndex] ?? element;
        currentGroup.elements.push(fragmentElement);
        currentGroup.text = joinText(
          currentGroup.text,
          normalizedFragment,
        );
        fragmentElement.dataset.pdfGroupId = currentGroup.id;

        if (endsSentence(normalizedFragment)) {
          currentGroup = null;
        }
      });

      previousItem = item;
      return;
    }

    const startsNewParagraph =
      previousItem !== null &&
      shouldStartNewParagraph(previousItem, item, paragraphStartX);

    if (!currentGroup || startsNewParagraph) {
      currentGroup = {
        id: `${pageNumber}-${mode}-${groupIndex++}`,
        text: "",
        elements: [],
      };
      groups.set(currentGroup.id, currentGroup);
      paragraphStartX = item.transform[4];
    }

    currentGroup.elements.push(element);
    currentGroup.text = joinText(currentGroup.text, text);
    element.dataset.pdfGroupId = currentGroup.id;

    previousItem = item;
  });

  return groups;
}

function shouldStartNewParagraph(
  previous: TextItem,
  current: TextItem,
  paragraphStartX: number,
) {
  const previousY = previous.transform[5];
  const currentY = current.transform[5];
  const verticalGap = Math.abs(previousY - currentY);
  const lineHeight = Math.max(previous.height, current.height, 1);
  const indentation = Math.abs(current.transform[4] - paragraphStartX);

  if (verticalGap > lineHeight * 1.55) return true;
  if (!previous.hasEOL) return false;
  return indentation > lineHeight * 2.25;
}

function normalizeMaskElementText(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function endsSentence(text: string) {
  return /[.!?。！？]["')\]}]*$/.test(text);
}

function splitSentenceFragments(text: string) {
  return (
    text.match(/[^.!?。！？]+[.!?。！？]["')\]}]*\s*|[^.!?。！？]+$/g) ?? [
      text,
    ]
  );
}

function joinText(current: string, next: string) {
  if (!current) {
    return next;
  }

  if (/^[,.;:!?%)\]}]/.test(next)) {
    return `${current}${next}`;
  }

  return `${current} ${next}`;
}

function matchesSourceFile(fileName: string, sourceId: string) {
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
  return normalize(fileName) === normalize(sourceId);
}

function getLearningOperationLabel(operation: NonNullable<LearningUnit["operation"]>) {
  return {
    recall: "자료 없이 떠올리기",
    reconstruct: "구조·순서 복원하기",
    discriminate: "조건을 보고 판단하기",
    apply: "새로운 입력에 적용하기",
  }[operation];
}

function normalizeImportance(value: number | undefined): 1 | 2 | 3 {
  if (value === 3) return 3;
  if (value === 1) return 1;
  return 2;
}

function attachGroupEvents(
  groups: Map<string, TextGroup>,
  setHoveredGroupId: (id: string | null) => void,
  setSelectedGroupIds: React.Dispatch<React.SetStateAction<string[]>>,
  setSelectedTexts: React.Dispatch<
    React.SetStateAction<Array<{ id: string; text: string }>>
  >,
) {
  for (const group of groups.values()) {
    for (const element of group.elements) {
      element.addEventListener("mouseenter", () => setHoveredGroupId(group.id));
      element.addEventListener("mouseleave", () => setHoveredGroupId(null));
      element.addEventListener("click", (event) => {
        event.preventDefault();

        setSelectedGroupIds((current) =>
          current.includes(group.id)
            ? current.filter((id) => id !== group.id)
            : [...current, group.id],
        );
        setSelectedTexts((current) =>
          current.some((selection) => selection.id === group.id)
            ? current.filter((selection) => selection.id !== group.id)
            : [...current, { id: group.id, text: group.text }],
        );
      });
    }
  }
}

const toolbarButtonClassName =
  "min-w-10 rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-2 py-2 text-xs font-black text-[#172B4D] hover:bg-[#E9EBEE] disabled:cursor-not-allowed disabled:opacity-40 lg:w-full lg:px-1";

const pageButtonClassName =
  "rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-3 py-2 text-xs font-black text-[#172B4D] hover:bg-[#E9EBEE] disabled:cursor-not-allowed disabled:opacity-40";
