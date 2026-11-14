import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Recaller",
  description: "읽고 · 풀고 · 만들며 배운 것을 기억으로 쌓고, 잊을 때쯤 다시 묻는 PC 학습 앱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The desktop window (desktop/main.js) marks <html data-shell="desktop"> before React hydrates.
    <html lang="ko" suppressHydrationWarning>
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
