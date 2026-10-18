"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MainBoardEditor({ initialSource }: { initialSource: string }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/project-status/main-board", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: source }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      setMessage("저장했습니다.");
      setIsEditing(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsEditing((current) => !current);
            setMessage("");
          }}
          className="rounded-md border border-[#B3BAC5] bg-white px-3 py-2 text-sm font-bold text-[#172B4D] hover:bg-[#F4F5F7]"
        >
          {isEditing ? "편집 닫기" : "메인 보드 편집"}
        </button>
        {message ? <p className="text-sm font-bold text-[#216E4E]">{message}</p> : null}
      </div>

      {isEditing ? (
        <div className="mt-4 rounded-lg border border-[#B3BAC5] bg-[#FAFBFC] p-3">
          <p className="mb-2 text-xs font-bold text-[#6B778C]">
            제목은 ##, 항목은 - 로 시작하면 보기 화면에서 구분되어 표시됩니다.
          </p>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="min-h-72 w-full resize-y rounded-md border border-[#DCDFE4] bg-white p-3 font-mono text-sm leading-6 outline-none focus:border-[#0C66E4]"
            aria-label="메인 보드 Markdown 편집"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSource(initialSource);
                setIsEditing(false);
                setMessage("");
              }}
              className="rounded-md px-3 py-2 text-sm font-bold text-[#44546F] hover:bg-[#EBECF0]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || !source.trim()}
              className="rounded-md bg-[#0C66E4] px-4 py-2 text-sm font-black text-white hover:bg-[#0055CC] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "저장 중..." : "MD 파일에 저장"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
