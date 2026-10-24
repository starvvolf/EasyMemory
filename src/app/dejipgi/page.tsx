import DejipgiStudy from "./DejipgiStudy";
import type { Metadata } from "next";

// The previous study app (되짚기), frozen as it was on 2026-10-24 when Recaller 2 took over /study.
// It reads and writes the same data, so materials and records stay shared.
export const metadata: Metadata = { title: "되짚기 (이전 버전)" };

export default function Page() {
  return <DejipgiStudy />;
}
