"use client";

import {
  getPdfReadingPositionState,
  savePdfReadingPosition,
} from "@/lib/storage";
import { useCallback, useEffect, useRef, useState } from "react";

export function usePdfReadingPosition(
  sourceId: string,
  fallbackPage = 1,
  restoreLastPage = true,
) {
  const [initialPage, setInitialPage] = useState(fallbackPage);
  const [isLoadingPosition, setIsLoadingPosition] = useState(true);
  const [positionError, setPositionError] = useState("");
  const revisionRef = useRef<number | undefined>(undefined);
  const savedPageRef = useRef(fallbackPage);
  const canSaveRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPosition() {
      try {
        const state = await getPdfReadingPositionState(sourceId);
        if (cancelled) return;
        if (state.state === "import_required") {
          savedPageRef.current = fallbackPage;
          canSaveRef.current = false;
          setInitialPage(fallbackPage);
          setPositionError(
            "이 PDF는 아직 계정 저장소에 없습니다. 명시적으로 가져온 뒤 읽기 위치를 저장할 수 있습니다.",
          );
          return;
        }

        const position = state.position;
        revisionRef.current = position?.revision;
        savedPageRef.current = position?.page ?? fallbackPage;
        canSaveRef.current = true;
        setInitialPage(restoreLastPage ? position?.page ?? fallbackPage : fallbackPage);
        setPositionError("");
      } catch (caught) {
        if (cancelled) return;
        savedPageRef.current = fallbackPage;
        canSaveRef.current = false;
        setInitialPage(fallbackPage);
        setPositionError(
          caught instanceof Error ? caught.message : "마지막 읽기 위치를 불러오지 못했습니다.",
        );
      } finally {
        if (!cancelled) setIsLoadingPosition(false);
      }
    }

    void loadPosition();
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [fallbackPage, restoreLastPage, sourceId]);

  const handlePageChange = useCallback((changedSourceId: string, page: number) => {
    if (
      !canSaveRef.current ||
      changedSourceId !== sourceId ||
      page === savedPageRef.current
    ) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      void savePdfReadingPosition(sourceId, page, revisionRef.current)
        .then((position) => {
          revisionRef.current = position.revision;
          savedPageRef.current = position.page;
          setPositionError("");
        })
        .catch((caught) => {
          canSaveRef.current = false;
          setPositionError(
            caught instanceof Error ? caught.message : "마지막 읽기 위치를 저장하지 못했습니다.",
          );
        });
    }, 600);
  }, [sourceId]);

  return { initialPage, isLoadingPosition, positionError, handlePageChange };
}
