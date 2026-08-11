"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api";

type SelectionMode = "sentence" | "paragraph";

type TextGroup = {
  id: string;
  text: string;
  elements: HTMLElement[];
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
};

export default function PdfReviewViewer({ files }: PdfReviewViewerProps) {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const safeActiveFileIndex = Math.min(activeFileIndex, files.length - 1);
  const activeFile = files[safeActiveFileIndex];

  if (!activeFile) {
    return null;
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
      />
    </section>
  );
}

function PdfDocumentViewer({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<Map<string, TextGroup>>(new Map());
  const ocrWorkerPromiseRef = useRef<Promise<OcrWorker> | null>(null);
  const ocrProgressHandlerRef = useRef<(progress: number) => void>(() => {});
  const ocrCacheRef = useRef<Map<number, OcrCacheEntry>>(new Map());
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
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

  useEffect(() => {
    return () => {
      const workerPromise = ocrWorkerPromiseRef.current;
      if (workerPromise) {
        void workerPromise.then((worker) => worker.terminate());
      }
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
        setPageNumber(1);
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
  }, [file]);

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
      groupsRef.current.clear();
      textLayerContainer.replaceChildren();

      try {
        const pdfjs = await import("pdfjs-dist");
        const page = await document!.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
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

          setOcrGroups(
            createOcrGroups(
              pageNumber,
              mode,
              cachedOcr,
              viewport.width,
              viewport.height,
            ),
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
        attachGroupEvents(
          groups,
          setHoveredGroupId,
          setSelectedGroupIds,
          setSelectedTexts,
        );
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
  }, [document, mode, pageNumber, scale]);

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

  return (
    <div>
      <div className="border-b border-[#DCDFE4] bg-[#FFFFFF] px-4 py-3">
        <p className="truncate text-sm font-black text-[#172B4D]">{file.name}</p>
        <p className="mt-1 text-xs text-[#44546F]">
          텍스트에 마우스를 올리고 클릭하면 선택됩니다.
        </p>
      </div>

      <div className="grid h-[calc(100dvh-10rem)] min-h-[44rem] grid-cols-[4rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_18rem] lg:grid-cols-[4.5rem_minmax(0,1fr)_22rem] lg:grid-rows-1">
        <aside className="flex min-h-0 flex-col gap-4 border-r border-[#DCDFE4] bg-[#F1F2F4] p-2">
          <div className="space-y-1" aria-label="선택 단위">
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
          </div>

          <div className="space-y-1 border-t border-[#DCDFE4] pt-3">
            <p className="px-1 text-center text-[10px] font-bold text-[#7A869A]">
              배율
            </p>
            <button
              type="button"
              onClick={() => setScale((value) => Math.min(2, value + 0.25))}
              disabled={isOcrRunning}
              className={toolbarButtonClassName}
              aria-label="확대"
              title="확대"
            >
              +
            </button>
            <span className="block py-1 text-center text-[10px] font-bold text-[#44546F]">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((value) => Math.max(0.75, value - 0.25))}
              disabled={isOcrRunning}
              className={toolbarButtonClassName}
              aria-label="축소"
              title="축소"
            >
              -
            </button>
          </div>

        </aside>

        <div className="min-h-0 overflow-auto bg-[#DFE1E6] p-4">
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
              {ocrGroups.length > 0 ? (
                <div className="pdf-ocr-layer" aria-label="OCR 선택 영역">
                  {ocrGroups.flatMap((group) =>
                    group.boxes.map((box, boxIndex) => (
                      <button
                        key={`${group.id}-${boxIndex}`}
                        type="button"
                        aria-label={group.text}
                        title={group.text}
                        onMouseEnter={() => setHoveredGroupId(group.id)}
                        onMouseLeave={() => setHoveredGroupId(null)}
                        onClick={() => toggleSelection(group.id, group.text)}
                        className={`pdf-ocr-box ${
                          selectedGroupIds.includes(group.id)
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
                    )),
                  )}
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

        <aside className="col-span-2 min-h-0 overflow-y-auto border-t border-[#DCDFE4] bg-[#F1F2F4] p-4 lg:col-span-1 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-[#172B4D]">선택한 내용</h3>
            {selectedTexts.length > 0 ? (
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

          {selectedTexts.length > 0 ? (
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
      className={`w-full rounded px-1 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-[#0C66E4] text-white"
          : "text-[#44546F] hover:text-[#172B4D]"
      }`}
    >
      {children}
    </button>
  );
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
  if (!previous.hasEOL) {
    return false;
  }

  const previousY = previous.transform[5];
  const currentY = current.transform[5];
  const verticalGap = Math.abs(previousY - currentY);
  const lineHeight = Math.max(previous.height, current.height, 1);
  const indentation = Math.abs(current.transform[4] - paragraphStartX);

  return verticalGap > lineHeight * 1.55 || indentation > lineHeight * 2.25;
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
  "w-full rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-1 py-2 text-xs font-black text-[#172B4D] hover:bg-[#E9EBEE] disabled:cursor-not-allowed disabled:opacity-40";

const pageButtonClassName =
  "rounded-md border border-[#DCDFE4] bg-[#F1F2F4] px-3 py-2 text-xs font-black text-[#172B4D] hover:bg-[#E9EBEE] disabled:cursor-not-allowed disabled:opacity-40";
