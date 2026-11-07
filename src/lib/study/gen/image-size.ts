// data: URL(JPEG·PNG)의 가로·세로를 머리에서 읽는다 (11/8 그림 칸: AI가 픽셀 좌표를 줄 때 나눌 크기). 못 읽으면 undefined.
export function imageSize(dataUrl: string): { width: number; height: number } | undefined {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return undefined;
  const b = Buffer.from(dataUrl.slice(comma + 1, comma + 1 + 400_000), "base64");
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return undefined;
}
