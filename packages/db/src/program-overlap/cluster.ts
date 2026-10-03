// program-overlap.v1 — ordering for the heatmap and the outlined groups.
// Pure. Average-linkage agglomerative clustering on distance = 100 − similarity;
// the leaf order of the merge tree puts overlapping programmes side by side.
//
// Naive average linkage is O(n³) (n merges, each scanning every cluster pair
// and every member pair). At about 110 programmes per level that is a few
// million similarity lookups — well under a second — so no priority queue or
// nearest-neighbour chain is worth its complexity here.

type Cluster = { ids: string[] };

export function averageLinkageOrder(ids: readonly string[], similarity: (a: string, b: string) => number): string[] {
  let clusters: Cluster[] = [...ids].sort().map((id) => ({ ids: [id] }));
  const dist = (x: Cluster, y: Cluster): number => {
    let s = 0;
    for (const a of x.ids) for (const b of y.ids) s += 100 - similarity(a, b);
    return s / (x.ids.length * y.ids.length);
  };
  while (clusters.length > 1) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i]!, clusters[j]!);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    const merged: Cluster = { ids: [...clusters[bi]!.ids, ...clusters[bj]!.ids] };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.splice(bi, 0, merged);
  }
  return clusters[0]?.ids ?? [];
}

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
