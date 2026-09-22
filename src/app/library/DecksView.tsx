"use client";

import { countDueReviews } from "@/lib/spaced-repetition";
import type { StudyProject } from "@/lib/study-project-types";
import type { Deck,DeckBoardColumn,PdfAnalysisResponse,StudyAttempt,StudySession } from "@/lib/types";
import { DndContext,DragOverlay,KeyboardSensor,PointerSensor,closestCorners,useDraggable,useDroppable,useSensor,useSensors,type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { BookOpen,GripVertical,Info,Pencil,Plus,Trash2 } from "lucide-react";
import { useState,type ReactNode } from "react";
import { CompactDeckList } from "../CompactLearningLists";
import { EmptyState,getLearningActivityMixLabel,inputClassName } from "../study-forge-shared";
import StudyProjectLibrary from "../StudyProjectLibrary";

export function DecksView({
  projectsOnly,
  decks,
  sessions,
  attempts,
  createFromProjectSources,
  projectCreationPanel,
  isProjectCreationOpen,
  cancelProjectCreation,
  renamingDeckId,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  moveDeck,
  deleteDeck,
  openDetail,
  goCreate,
}: {
  projectsOnly?: boolean;
  decks: Deck[];
  sessions: StudySession[];
  attempts: StudyAttempt[];
  createFromProjectSources: (
    files: File[],
    project: StudyProject,
    cachedAnalysis: PdfAnalysisResponse | null,
  ) => void;
  projectCreationPanel?: ReactNode;
  isProjectCreationOpen?: boolean;
  cancelProjectCreation?: () => void;
  renamingDeckId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  moveDeck: (id: string, column: DeckBoardColumn) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
  goCreate: () => void;
}) {
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [mobileStatusFilter, setMobileStatusFilter] = useState<
    "all" | DeckBoardColumn
  >("all");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (projectsOnly) {
    return (
      <StudyProjectLibrary
        decks={decks}
        sessions={sessions}
        attempts={attempts}
        onCreateFromSources={createFromProjectSources}
        onStartStudy={startStudy}
        creationPanel={projectCreationPanel}
        isCreationOpen={isProjectCreationOpen}
        onCancelCreation={cancelProjectCreation}
      />
    );
  }

  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  const mobileDecks = [...decks]
    .filter(
      (deck) =>
        (mobileStatusFilter === "all" || deck.boardColumn === mobileStatusFilter) &&
        `${deck.title} ${deck.subject} ${deck.tags.join(" ")}`
          .toLocaleLowerCase("ko-KR")
          .includes(searchQuery.trim().toLocaleLowerCase("ko-KR")),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeckId(null);
    const column = event.over?.data.current?.column as
      | DeckBoardColumn
      | undefined;
    if (column) moveDeck(String(event.active.id), column);
  };

  return (
    <div className="space-y-6">
      <StudyProjectLibrary
        decks={decks}
        sessions={sessions}
        attempts={attempts}
        onCreateFromSources={createFromProjectSources}
        onStartStudy={startStudy}
        creationPanel={projectCreationPanel}
        isCreationOpen={isProjectCreationOpen}
        onCancelCreation={cancelProjectCreation}
      />

      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#5A5F5A] pb-5">
        <div>
          <p className="text-sm font-black text-[#F0F2EF]">내 학습자료 {decks.length}개</p>
          <p className="mt-1 text-xs text-[#A6AAA5]">
            생성한 문제와 원문, 학습 기록을 자료별로 보관합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLayout(layout === "list" ? "board" : "list")} className="border border-[#5A5F5A] px-3 py-2 text-xs font-black text-[#B2B6B1] hover:bg-[#2D312E]">
            {layout === "list" ? "상태 보드 보기" : "목록으로 보기"}
          </button>
          <button
            type="button"
            onClick={goCreate}
            className="inline-flex items-center gap-2 bg-[#ECEEEB] px-4 py-2.5 text-sm font-black text-[#202321] hover:bg-[#D5D8D4]"
          >
            <Plus size={17} />
            새 자료 생성
          </button>
        </div>
      </div>

      {decks.length === 0 ? (
        <EmptyState
          title="아직 생성한 문제가 없습니다."
          body="프로젝트에서 PDF를 선택해 문제를 만들거나 새 자료를 바로 생성하세요."
          actionLabel="새 자료 생성"
          onAction={goCreate}
        />
      ) : null}

      <div className={layout === "list" && decks.length > 0 ? "space-y-4" : "hidden"}>
        <div className="grid gap-3 border-y border-[#3B3F3C] py-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="block">
            <span className="sr-only">학습자료 검색</span>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="자료명, 과목, 태그 검색" className="w-full border-0 bg-transparent px-2 py-2 text-sm text-[#F0F2EF] outline-none placeholder:text-[#898E89]" />
          </label>
          <label className="block">
          <span className="sr-only">진행 상태</span>
          <select
            value={mobileStatusFilter}
            onChange={(event) =>
              setMobileStatusFilter(
                event.target.value as "all" | DeckBoardColumn,
              )
            }
            className="w-full border-0 border-l border-[#3B3F3C] bg-transparent px-3 py-2 text-sm font-bold text-[#B2B6B1] outline-none"
          >
            <option value="all">전체 덱 ({decks.length})</option>
            {deckBoardColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.title} ({decks.filter((deck) => deck.boardColumn === column.id).length})
              </option>
            ))}
          </select>
          </label>
        </div>

        <div className="border-t-2 border-[#F0F2EF]">
          <CompactDeckList
            decks={mobileDecks}
            onStartStudy={startStudy}
            onOpenDetail={openDetail}
            onRename={startRename}
            onDelete={deleteDeck}
            onChangeStatus={moveDeck}
            renamingDeckId={renamingDeckId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onSaveRename={saveRename}
            onCancelRename={cancelRename}
          />
          {mobileDecks.length === 0 ? (
            <p className="border border-dashed border-[#5A5F5A] bg-[#242725] p-8 text-center text-sm text-[#A6AAA5]">
              이 상태에 해당하는 덱이 없습니다.
            </p>
          ) : null}
        </div>
      </div>

      <div className={layout === "board" && decks.length > 0 ? "block" : "hidden"}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event) => setActiveDeckId(String(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDeckId(null)}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {deckBoardColumns.map((column) => (
            <DeckBoardList
              key={column.id}
              column={column}
              decks={decks.filter((deck) => deck.boardColumn === column.id)}
              renamingDeckId={renamingDeckId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              startRename={startRename}
              cancelRename={cancelRename}
              saveRename={saveRename}
              startStudy={startStudy}
              deleteDeck={deleteDeck}
              openDetail={openDetail}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDeck ? <DeckCardPreview deck={activeDeck} /> : null}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}

const deckBoardColumns: Array<{
  id: DeckBoardColumn;
  title: string;
  description: string;
  accent: string;
}> = [
  {
    id: "new",
    title: "새 덱",
    description: "아직 학습을 시작하지 않은 덱",
    accent: "bg-[#ECEEEB]",
  },
  {
    id: "learning",
    title: "학습 중",
    description: "현재 인출 연습을 진행하는 덱",
    accent: "bg-[#E2B203]",
  },
  {
    id: "completed",
    title: "완료",
    description: "모든 카드를 알고 있는 덱",
    accent: "bg-[#22A06B]",
  },
];

export function DeckBoardList({
  column,
  decks,
  renamingDeckId,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  deleteDeck,
  openDetail,
}: {
  column: (typeof deckBoardColumns)[number];
  decks: Deck[];
  renamingDeckId: string | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `deck-column-${column.id}`,
    data: { column: column.id },
  });
  const orderedDecks = [...decks].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <section
      ref={setNodeRef}
      className={`min-h-[32rem] rounded-lg border bg-[#222523] p-3 transition-colors ${
        isOver ? "border-[#AEB2AD] bg-[#2D312E]" : "border-[#393D3A]"
      }`}
    >
      <header className="mb-3 flex items-start justify-between gap-3 px-1 py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${column.accent}`} />
            <h3 className="font-black text-[#F0F2EF]">{column.title}</h3>
            <span className="rounded-full bg-[#222523] px-2 py-0.5 text-xs font-bold text-[#B2B6B1]">
              {decks.length}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#A6AAA5]">
            {column.description}
          </p>
        </div>
      </header>

      <div className="space-y-3">
        {orderedDecks.map((deck) => (
          <DeckBoardCard
            key={deck.id}
            deck={deck}
            renaming={renamingDeckId === deck.id}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            startRename={startRename}
            cancelRename={cancelRename}
            saveRename={saveRename}
            startStudy={startStudy}
            deleteDeck={deleteDeck}
            openDetail={openDetail}
          />
        ))}
        {orderedDecks.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-[#4B4F4B] px-4 text-center text-xs leading-5 text-[#A5A9A4]">
            덱 카드를 이 열로 옮길 수 있습니다.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function DeckBoardCard({
  deck,
  renaming,
  renameValue,
  setRenameValue,
  startRename,
  cancelRename,
  saveRename,
  startStudy,
  deleteDeck,
  openDetail,
  draggable = true,
}: {
  deck: Deck;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (deck: Deck) => void;
  cancelRename: () => void;
  saveRename: (deck: Deck) => Promise<void>;
  startStudy: (deck: Deck) => void;
  deleteDeck: (id: string) => void;
  openDetail: (deck: Deck) => void;
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deck.id, disabled: !draggable });
  const knownCount = deck.cards.filter((card) => card.status === "known").length;
  const dueCount = countDueReviews(deck.cards);
  const progress =
    deck.cards.length === 0
      ? 0
      : Math.round((knownCount / deck.cards.length) * 100);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`${draggable ? "rounded-md border border-[#3B3F3C] bg-[#242725] shadow-sm" : "border-0 bg-transparent"} transition ${
        isDragging ? "opacity-30" : draggable ? "hover:border-[#5A5F5A] hover:shadow-md" : ""
      }`}
    >
      <div className={`flex items-start gap-1 ${draggable ? "p-2 pb-0" : "p-0"}`}>
        {draggable ? (
          <button
            type="button"
            className="mt-0.5 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-[#A5A9A4] hover:bg-[#2D312E] hover:text-[#F0F2EF] active:cursor-grabbing"
            aria-label={`${deck.title} 이동`}
            title="드래그하여 이동"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={17} />
          </button>
        ) : null}
        {renaming ? (
          <div className="min-w-0 flex-1 space-y-2 pb-2">
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className={inputClassName}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveRename(deck);
                if (event.key === "Escape") cancelRename();
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveRename(deck)}
                className="rounded bg-[#ECEEEB] px-3 py-1.5 text-xs font-black text-[#202321]"
              >
                저장
              </button>
              <button
                type="button"
                onClick={cancelRename}
                className="rounded px-3 py-1.5 text-xs font-bold text-[#B2B6B1] hover:bg-[#2D312E]"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startStudy(deck)}
            className={`min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ECEEEB] ${draggable ? "rounded px-1 pb-3" : "py-1"}`}
          >
            <span className={`block truncate font-black text-[#F0F2EF] ${draggable ? "text-sm" : "text-base"}`}>
              {deck.title}
            </span>
            <span className="mt-1 block truncate text-xs text-[#B2B6B1]">
              {deck.subject || "과목 없음"} · {getLearningActivityMixLabel(deck.cards, deck.mode)}
            </span>
            <span className="mt-3 flex items-center justify-between text-[11px] font-bold text-[#A6AAA5]">
              <span>{deck.cards.length}개 카드</span>
              <span>{dueCount > 0 ? `오늘 복습 ${dueCount}개` : `${progress}%`}</span>
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden bg-[#3B3F3C]">
              <span
                className="block h-full bg-[#ECEEEB] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </span>
          </button>
        )}
      </div>

      {!renaming ? (
        <footer className={`flex items-center justify-between ${draggable ? "border-t border-[#3B3F3C] px-2 py-1.5" : "mt-2"}`}>
          <span className="px-1 text-[11px] text-[#A5A9A4]">
            {new Date(deck.updatedAt).toLocaleDateString("ko-KR")}
          </span>
          <div className="flex items-center gap-0.5">
            <DeckActionButton label="학습 시작" onClick={() => startStudy(deck)}>
              <BookOpen size={15} />
            </DeckActionButton>
            <DeckActionButton label="상세 정보" onClick={() => openDetail(deck)}>
              <Info size={15} />
            </DeckActionButton>
            <DeckActionButton label="이름 수정" onClick={() => startRename(deck)}>
              <Pencil size={15} />
            </DeckActionButton>
            <DeckActionButton label="삭제" danger onClick={() => deleteDeck(deck.id)}>
              <Trash2 size={15} />
            </DeckActionButton>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

export function DeckActionButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded ${
        danger
          ? "text-[#B2B6B1] hover:bg-[#FFECEB] hover:text-[#F87171]"
          : "text-[#A6AAA5] hover:bg-[#2D312E] hover:text-[#F0F2EF]"
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function DeckCardPreview({ deck }: { deck: Deck }) {
  return (
    <div className="w-72 rounded-md border border-[#AEB2AD] bg-[#2A2E2B] p-4 shadow-2xl">
      <p className="truncate text-sm font-black text-[#F0F2EF]">{deck.title}</p>
      <p className="mt-1 text-xs text-[#B2B6B1]">
        {deck.cards.length}개 카드 · {deck.subject || "과목 없음"}
      </p>
    </div>
  );
}
