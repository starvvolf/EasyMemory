import { readFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const { createCanvas, loadImage } = await import(pathToFileURL(path.join(process.cwd(), "node_modules/@napi-rs/canvas/index.js")).href);
const a = JSON.parse(readFileSync(process.argv[2], "utf8")); const imgs = a.blocks.filter((b: any) => b.kind === "img");
for (let k = 0; k < imgs.length; k++) { const b = imgs[k]; const im = await loadImage(Buffer.from(b.dataUrl.split(",")[1], "base64"));
  const W = 96, H = Math.max(1, Math.round(96 * im.height / im.width)); const c = createCanvas(W, H); const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data; const set = new Set<number>(); let white = 0;
  for (let i = 0; i < d.length; i += 4) { set.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++; }
  console.log(`#${k + 1}\t${b.w}x${b.h}\tratio ${(b.w / b.h).toFixed(2)}\t${b.gif ? "GIF" : ""}\tcolors ${set.size}\twhite ${(white / (W * H) * 100).toFixed(0)}%\t${b.text.slice(0, 30)}`); }
