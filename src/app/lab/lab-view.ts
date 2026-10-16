export type ObjectValue = Record<string, unknown>;
export const stageGridColumns = (stages: readonly { key: string }[]) => `repeat(${Math.max(1, Math.min(stages.length, 7))},minmax(0,1fr))`;
export const obj = (x: unknown): ObjectValue => x && typeof x === "object" && !Array.isArray(x) ? x as ObjectValue : {};
export const arr = (x: unknown): ObjectValue[] => Array.isArray(x) ? x.map(obj) : [];
export const str = (x: unknown): string => typeof x === "string" ? x : typeof x === "number" ? String(x) : Array.isArray(x) ? x.map(v => str(v)).join(", ") : "";
export const refs = (x: ObjectValue): number[] => arr(x.sourceRefs).flatMap(r => Array.isArray(r.pageNumbers) ? r.pageNumbers.filter((p): p is number => typeof p === "number") : []);
export function resultNodes(key: string, output: unknown) {
    const o = obj(output);
    if (key === "analyze")
        return arr(o.files).flatMap(f => arr(obj(f.sourceOutline).nodes));
    if (key === "concept-tree")
        return arr(o.nodes || obj(o.conceptTree).nodes);
    return [];
}
export function lineDiff(before: string, after: string) {
    const lines = (text: string) => {
        try { return JSON.stringify(JSON.parse(text), null, 2).split("\n"); }
        catch { return text.split("\n"); }
    };
    const a = lines(before), b = lines(after);
    // Bounded LCS; large replies still produce an honest removed/added view.
    if (a.length * b.length > 1000000)
        return [...a.map(text => ({ kind: "del", text })), ...b.map(text => ({ kind: "add", text }))];
    const grid = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            grid[i][j] = a[i] === b[j] ? 1 + grid[i + 1][j + 1] : Math.max(grid[i + 1][j], grid[i][j + 1]);
    const result: Array<{
        kind: string;
        text: string;
    }> = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            result.push({ kind: "same", text: a[i] });
            i++;
            j++;
        }
        else if (j < b.length && (i === a.length || grid[i][j + 1] >= grid[i + 1][j]))
            result.push({ kind: "add", text: b[j++] });
        else
            result.push({ kind: "del", text: a[i++] });
    }
    return result;
}
