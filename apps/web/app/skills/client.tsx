'use client';

import * as React from 'react';
import { Badge, Card, Input } from '@kku/ui';
import type { SkillNode } from './page';

// Tree + detail layout. Two columns: taxonomy tree (left, scrollable),
// detail (right). Search filters the tree client-side and highlights
// matches; the server already pre-filtered to the current scope.
//
// No server actions here — detail view lazy-fetches from /skills/:id
// via the proxy in /api/admin-skills/[id] (added below).

export function SkillsExplorer({
  initialTree,
  scope,
  scopeId,
}: {
  initialTree: SkillNode[];
  scope: string;
  scopeId: string;
}) {
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SkillDetail | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    // Expand the roots by default.
    return new Set(initialTree.filter((n) => !n.parentSkillId).map((n) => n.id));
  });

  // Precompute children map once.
  const childrenMap = React.useMemo(() => {
    const m = new Map<string | null, SkillNode[]>();
    for (const n of initialTree) {
      const key = n.parentSkillId;
      const arr = m.get(key) ?? [];
      arr.push(n);
      m.set(key, arr);
    }
    return m;
  }, [initialTree]);

  const lowerQuery = query.toLowerCase().trim();
  const matches = (n: SkillNode) => {
    if (!lowerQuery) return true;
    return (
      n.nameEn.toLowerCase().includes(lowerQuery) ||
      n.nameTh.includes(lowerQuery) ||
      n.code.toLowerCase().includes(lowerQuery) ||
      (n.category ?? '').toLowerCase().includes(lowerQuery)
    );
  };

  const onSelect = async (id: string) => {
    setSelected(id);
    setDetail(null);
    try {
      const qs = new URLSearchParams({ scope, ...(scopeId ? { scopeId } : {}) });
      const res = await fetch(`/api/admin-skills/${id}?${qs}`);
      if (res.ok) {
        const body = (await res.json()) as { data: SkillDetail };
        setDetail(body.data);
      }
    } catch {
      // ignore
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: SkillNode, depth: number): React.ReactNode => {
    const kids = childrenMap.get(node.id) ?? [];
    const open = expanded.has(node.id);
    const show = matches(node) || kids.some((k) => subtreeMatches(k, childrenMap, lowerQuery));
    if (!show) return null;
    return (
      <div key={node.id} style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
        <button
          onClick={() => onSelect(node.id)}
          onDoubleClick={() => toggle(node.id)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
            selected === node.id
              ? 'bg-accent-subtle text-accent'
              : 'hover:bg-surface-2'
          }`}
        >
          {kids.length > 0 ? (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              className="inline-flex h-4 w-4 items-center justify-center text-text-tertiary"
            >
              {open ? '▾' : '▸'}
            </span>
          ) : (
            <span className="h-4 w-4" />
          )}
          <span className={`flex-1 truncate ${node.coveredAtScope === false ? 'text-text-tertiary' : ''}`}>
            {node.nameEn}
            <span className="ml-1 text-text-tertiary">· {node.nameTh}</span>
          </span>
          <span className="font-tabular text-xs text-text-tertiary">
            {node.programCount}p · {node.jobCount}j
          </span>
        </button>
        {open && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const roots = childrenMap.get(null) ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <Card padding="none" className="p-3">
        <Input
          placeholder="Search Thai or English…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3"
        />
        <div className="max-h-[70vh] overflow-y-auto">
          {roots.length === 0 ? (
            <div className="p-4 text-sm text-text-tertiary">
              No skills found at this scope.
            </div>
          ) : (
            roots.map((r) => renderNode(r, 0))
          )}
        </div>
      </Card>

      <SkillDetailPane detail={detail} scope={scope} scopeId={scopeId} />
    </div>
  );
}

interface SkillDetail {
  skill: SkillNode;
  parent: { id: string; nameEn: string; nameTh: string } | null;
  children: Array<{ id: string; nameEn: string; nameTh: string }>;
  programCoverage: Array<{
    programId: string;
    programCode: string;
    programNameTh: string;
    programNameEn: string;
    level: string;
    weight: number;
  }>;
  demandSample: Array<{
    postingId: string;
    title: string;
    freshnessDate: string | null;
  }>;
}

function SkillDetailPane({
  detail,
  scope,
  scopeId,
}: {
  detail: SkillDetail | null;
  scope: string;
  scopeId: string;
}) {
  if (!detail) {
    return (
      <Card>
        <div className="p-6 text-sm text-text-tertiary">
          Pick a skill on the left to see coverage + demand at the current scope.
        </div>
      </Card>
    );
  }
  const { skill } = detail;
  const coverage = detail.programCoverage.length;
  const demand = detail.demandSample.length;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{skill.nameEn}</h3>
            <p className="text-sm text-text-secondary">{skill.nameTh}</p>
            <p className="mt-1 text-xs text-text-tertiary">
              {skill.code} · {skill.taxonomySource}
              {skill.category ? ` · ${skill.category}` : ''}
            </p>
          </div>
          <Badge tone={coverage > 0 ? 'success' : 'warning'}>
            {coverage > 0 ? 'covered' : 'gap'}
          </Badge>
        </div>
        {detail.parent && (
          <p className="text-xs text-text-tertiary">
            Parent:{' '}
            <a
              href={`/skills?scope=${scope}&scopeId=${scopeId}`}
              className="underline"
            >
              {detail.parent.nameEn}
            </a>
          </p>
        )}
      </Card>

      <Card>
        <h4 className="mb-2 text-sm font-semibold">
          Program coverage at scope ({coverage})
        </h4>
        {coverage === 0 ? (
          <p className="text-sm text-text-tertiary">
            No program at this scope covers this skill.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.programCoverage.slice(0, 20).map((p) => (
              <li key={p.programId} className="flex items-center justify-between">
                <span className="truncate">
                  <span className="font-mono text-xs text-text-tertiary">{p.programCode}</span>{' '}
                  {p.programNameTh}
                </span>
                <span className="font-tabular text-xs text-text-secondary">
                  w {p.weight.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h4 className="mb-2 text-sm font-semibold">
          Recent demand signal ({demand})
        </h4>
        {demand === 0 ? (
          <p className="text-sm text-text-tertiary">
            No recent job postings reference this skill. Run the JobThai /
            JobsDB connectors to populate.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.demandSample.slice(0, 20).map((j) => (
              <li key={j.postingId} className="flex items-center justify-between">
                <span className="truncate">{j.title}</span>
                <span className="text-xs text-text-tertiary">
                  {j.freshnessDate
                    ? new Date(j.freshnessDate).toLocaleDateString()
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function subtreeMatches(
  node: SkillNode,
  childrenMap: Map<string | null, SkillNode[]>,
  lowerQuery: string,
): boolean {
  if (!lowerQuery) return true;
  if (
    node.nameEn.toLowerCase().includes(lowerQuery) ||
    node.nameTh.includes(lowerQuery) ||
    node.code.toLowerCase().includes(lowerQuery) ||
    (node.category ?? '').toLowerCase().includes(lowerQuery)
  )
    return true;
  const kids = childrenMap.get(node.id) ?? [];
  return kids.some((k) => subtreeMatches(k, childrenMap, lowerQuery));
}
