import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side PDF text reading (source evidence, auto-executor) needs pdf.js to find its worker file on disk.
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
