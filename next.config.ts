import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 2026-11-02 A (협업/결과보고/점검_UIUX화면연결_A_20261102.md 22번): 화면 아래 개발 표시(N)를 숨긴다. 서버를 다시 켜면 적용.
  devIndicators: false,
  // Server-side PDF text reading (source evidence, auto-executor) needs pdf.js to find its worker file on disk.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
