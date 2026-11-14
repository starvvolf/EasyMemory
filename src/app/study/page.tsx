import StudyShell from "./StudyShell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Recaller" };

export default function Page() {
  return <StudyShell />;
}
