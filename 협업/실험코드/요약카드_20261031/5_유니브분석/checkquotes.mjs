import fs from 'node:fs';
const pdfjs = await import(process.argv[4]);
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const pages = [];
for (let i = 1; i <= doc.numPages; i++) { const tc = await (await doc.getPage(i)).getTextContent(); pages.push(norm(tc.items.map(x => x.str).join(' '))); }
const qs = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
let ok = 0, near = 0;
for (const [p, q] of qs) { const n = norm(q); const at = pages[p - 1]?.includes(n); const any = pages.findIndex(t => t.includes(n)) + 1; if (at) ok++; else if (any) near++; console.log(at ? 'OK  ' : any ? `ELSE p${any}` : 'MISS', p, q.slice(0, 60)); }
console.log({ pages: doc.numPages, total: qs.length, ok, otherPage: near });
