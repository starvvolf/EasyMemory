const pages = require(process.argv[2]); const scan = require(process.argv[3]).rows; const AR = 16/9;
// boxes as top-left fractions [x0,y0,x1,y1]; box from pics.mts is [x0, 1-y0(bottom→top)...] so fix:
const fix = (b) => [b[0], Math.min(b[1], b[3]), b[2], Math.max(b[1], b[3])];
const area = (b) => Math.max(0, b[2]-b[0]) * Math.max(0, b[3]-b[1]);
const near = (a, b, gx, gy) => a[0]-gx <= b[2] && b[0]-gx <= a[2] && a[1]-gy <= b[3] && b[1]-gy <= a[3];
for (const p of pages) {
  const route = scan.find((r) => r.page === p.n).route;
  let boxes = p.pics.filter((x) => x.area >= 0.01).map((x) => fix(x.box));
  const ar = process.argv[4] ? +process.argv[4] : AR; const gx = 0.02, gy = 0.02 * ar;
  for (let m = true; m;) { m = false; outer: for (let i = 0; i < boxes.length; i++) for (let j = i+1; j < boxes.length; j++) if (near(boxes[i], boxes[j], gx, gy)) { const a = boxes[i], b = boxes[j]; boxes[i] = [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]; boxes.splice(j,1); m = true; break outer; } }
  boxes = boxes.map((b) => [b[0]-0.015, b[1]-0.015, b[2]+0.015, b[3]+0.015]);
  const tiny = p.pics.filter((x) => x.area > 0 && x.area < 0.01).map((x) => ({ ...x, b: fix(x.box) }));
  const lost = tiny.filter((t) => !boxes.some((b) => t.b[0] >= b[0] && t.b[1] >= b[1] && t.b[2] <= b[2] && t.b[3] <= b[3]));
  if (tiny.length) console.log(`p.${p.n} ${route} tiny ${tiny.length} → 크롭 밖 ${lost.length}`, lost.map((t) => `${t.area}@[${t.b.map((v)=>v.toFixed(2))}]`).join(" "));
}
