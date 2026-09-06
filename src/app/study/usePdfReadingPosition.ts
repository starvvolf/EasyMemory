"use client";

import {
  getPdfReadingPosition,
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
        const position = await getPdfReadingPosition(sourceId);
        if (cancelled) return;
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
