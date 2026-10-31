import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
