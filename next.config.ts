import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 2026-11-02 A (협업/결과보고/점검_UIUX화면연결_A_20261102.md 22번): 화면 아래 개발 표시(N)를 숨긴다. 서버를 다시 켜면 적용.
  devIndicators: false,
  // 엔진 실험 서버 (scripts/run-engine-lab.mjs) runs next to the main one from the same folder, with its own build folder.
  // Its own tsconfig too, so the two servers don't keep rewriting the same file (each start writes its build folder in).
  // Route lab servers (scripts/run-lab.mjs) name their own tsconfig the same way.
  ...(process.env.RECALLER_NEXT_DIST_DIR ? { distDir: process.env.RECALLER_NEXT_DIST_DIR, typescript: { tsconfigPath: process.env.RECALLER_NEXT_TSCONFIG || "tsconfig.engine.json" } } : {}),
  // Server-side PDF text reading (source evidence, auto-executor) needs pdf.js to find its worker file on disk.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
