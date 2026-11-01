import { readFileSync, writeFileSync } from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const pdfjs = await import(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
const [pdf, out] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)) }).promise;
const OPS = pdfjs.OPS; const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
const pages: any[] = []; const seen = new Map<string, Set<number>>();
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1 }); const ops = await page.getOperatorList();
  let ctm = [1,0,0,1,0,0]; const st: number[][] = []; const pics: any[] = [];
  const t = (m: number[], a: number[]) => [m[0]*a[0]+m[2]*a[1], m[1]*a[0]+m[3]*a[1], m[0]*a[2]+m[2]*a[3], m[1]*a[2]+m[3]*a[3], m[0]*a[4]+m[2]*a[5]+m[4], m[1]*a[4]+m[3]*a[5]+m[5]];
  ops.fnArray.forEach((fn: number, i: number) => { const a = ops.argsArray[i];
    if (fn === OPS.save) st.push(ctm); else if (fn === OPS.restore) ctm = st.pop() ?? [1,0,0,1,0,0];
    else if (fn === OPS.transform) ctm = t(ctm, a); else if (fn === OPS.paintFormXObjectBegin) { st.push(ctm); if (Array.isArray(a?.[0])) ctm = t(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = st.pop() ?? [1,0,0,1,0,0];
    else if (paint.has(fn)) { const xs=[ctm[4],ctm[0]+ctm[4],ctm[2]+ctm[4],ctm[0]+ctm[2]+ctm[4]], ys=[ctm[5],ctm[1]+ctm[5],ctm[3]+ctm[5],ctm[1]+ctm[3]+ctm[5]];
      const b=[Math.max(0,Math.min(...xs)),Math.max(0,Math.min(...ys)),Math.min(vp.width,Math.max(...xs)),Math.min(vp.height,Math.max(...ys))];
      const area=Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1])/(vp.width*vp.height); const id=String(a?.[0] ?? `inline-${i}`);
      pics.push({ id, area: +area.toFixed(4), box: b.map((v,k)=>+(k%2? 1 - v/vp.height : v/vp.width).toFixed(3)) }); (seen.get(id) ?? seen.set(id,new Set()).get(id)!).add(n); } });
  pages.push({ n, pics }); page.cleanup();
}
for (const p of pages) for (const x of p.pics) x.on = seen.get(x.id)!.size;
writeFileSync(out, JSON.stringify(pages));
for (const p of pages) { const tiny = p.pics.filter((x: any) => x.area > 0 && x.area < 0.01), tmpl = p.pics.filter((x: any) => x.area >= 0.01 && x.on >= 3);
  console.log(p.n, "pics", p.pics.length, "tiny<1%", tiny.length, tiny.map((x: any) => x.area).join(","), "| repeated>=3pg", tmpl.map((x: any) => `${x.area}@${x.on}`).join(",")); }
