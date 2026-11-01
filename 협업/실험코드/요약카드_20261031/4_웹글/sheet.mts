import { readFileSync, writeFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const { createCanvas, loadImage } = await import(pathToFileURL(path.join(process.cwd(), "node_modules/@napi-rs/canvas/index.js")).href);
const a = JSON.parse(readFileSync(process.argv[2], "utf8")); const imgs = a.blocks.map((b: any, i: number) => ({ ...b, i: i + 1 })).filter((b: any) => b.kind === "img");
const cols = 4, cw = 300, ch = 200, rows = Math.ceil(imgs.length / cols); const half = Math.ceil(rows / 2);
for (const [part, list] of [[1, imgs.slice(0, half * cols)], [2, imgs.slice(half * cols)]] as const) {
  const r = Math.ceil(list.length / cols); const c = createCanvas(cols * cw, r * ch); const g = c.getContext("2d"); g.fillStyle = "white"; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < list.length; k++) { const b = list[k]; const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
    try { const im = await loadImage(Buffer.from(b.dataUrl.split(",")[1], "base64")); const s = Math.min((cw - 10) / im.width, (ch - 30) / im.height); g.drawImage(im, x + 5, y + 25, im.width * s, im.height * s); } catch {}
    g.fillStyle = "red"; g.font = "16px sans-serif"; g.fillText(`#${imgs.indexOf(b) + 1} b${b.i} ${b.w}x${b.h}${b.gif ? " GIF" : ""}`, x + 5, y + 18); g.strokeStyle = "#ccc"; g.strokeRect(x, y, cw, ch); }
  writeFileSync(`${process.argv[3]}/sheet${part}.jpg`, c.toBuffer("image/jpeg", 80));
}
