import DejipgiStudy from "./DejipgiStudy";
import type { Metadata } from "next";

// "홈 화면에 추가" on a tablet opens without the address bar where the browser allows it (standalone).
export const metadata: Metadata = { title: "Recaller · 되짚기", manifest: "/study-manifest", appleWebApp: { capable: true, title: "되짚기", statusBarStyle: "default" } };

export default function Page() {
  return <DejipgiStudy />;
}
