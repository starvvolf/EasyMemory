import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Study Forge",
  description:
    "학습 자료를 플래시카드, 빈칸 문제, 영작 리콜 카드로 변환하고 저장해 학습합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
