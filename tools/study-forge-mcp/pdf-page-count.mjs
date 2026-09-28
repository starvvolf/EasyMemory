import { Buffer } from "node:buffer";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
if (bytes.length < 8 || bytes.length > 50 * 1024 * 1024) process.exit(2);

try {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  const document = await loadingTask.promise;
  const count = document.numPages;
  await loadingTask.destroy();
  if (!Number.isInteger(count) || count < 1 || count > 500) process.exit(3);
  process.stdout.write(String(count));
} catch {
  process.exit(4);
}
