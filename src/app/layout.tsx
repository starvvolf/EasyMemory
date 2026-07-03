import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 암기자료 변환기",
  description: "학습 자료를 암기 가능한 카드와 빈칸 문제로 변환합니다.",
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
