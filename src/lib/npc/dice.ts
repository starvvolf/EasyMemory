// 씨앗 주사위: 같은 명세 + 같은 문제 + 같은 씨앗이면 같은 눈(설계 3번 끝). 주사위마다 이름을 붙여서,
// 앞에서 AI 답이 달라져도 뒤의 주사위 눈이 밀리지 않게 한다(예: "react:tool.queue:2").
import { createHash } from "node:crypto";

export type Dice = (name: string) => number;
/** 0 이상 1 미만. 같은 (씨앗, 문제, 명세 id, 이름)이면 늘 같은 값. */
export function dice(seed: number, ...scope: string[]): Dice {
  const base = `${seed}|${scope.join("|")}`;
  return (name: string) => {
    const h = createHash("sha256").update(`${base}|${name}`).digest();
    return h.readUInt32BE(0) / 2 ** 32;
  };
}
/** 무게대로 하나 고르기(무게 0은 안 나옴). 다 0이면 null. */
export function weighted<T>(roll: number, items: Array<[T, number]>): T | null {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return null;
  let x = roll * total;
  for (const [v, w] of items) { if (w <= 0) continue; if ((x -= w) < 0) return v; }
  return items.filter(([, w]) => w > 0).at(-1)![0];
}
