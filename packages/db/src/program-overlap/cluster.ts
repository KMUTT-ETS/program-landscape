// program-overlap.v1 — overlap groups: the connected components of the pairs
// whose overlap index reaches a threshold (the dashboard KPI "programmes in
// groups"). Pure, union-find.

export interface OverlapGroup { members: string[]; peakIndex: number }

export function overlapGroups(
  ids: readonly string[],
  edges: ReadonlyArray<{ a: string; b: string; index: number | null }>,
  threshold: number,
): OverlapGroup[] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const peak = new Map<string, number>();
  for (const e of edges) {
    if (e.index === null || e.index < threshold || !parent.has(e.a) || !parent.has(e.b)) continue;
    parent.set(find(e.a), find(e.b));
  }
  for (const e of edges) {
    if (e.index === null || e.index < threshold || !parent.has(e.a) || !parent.has(e.b)) continue;
    const r = find(e.a);
    peak.set(r, Math.max(peak.get(r) ?? 0, e.index));
  }
  const byRoot = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    byRoot.set(r, [...(byRoot.get(r) ?? []), id]);
  }
  return [...byRoot.entries()]
    .filter(([, m]) => m.length > 1)
    .map(([r, m]) => ({ members: [...m].sort(), peakIndex: peak.get(r) ?? 0 }))
    .sort((x, y) => y.peakIndex - x.peakIndex || x.members[0]!.localeCompare(y.members[0]!));
}
