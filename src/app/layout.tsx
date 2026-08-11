import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 암기자료 변환기",
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
      <body>{children}</body>
    </html>
  );
}
