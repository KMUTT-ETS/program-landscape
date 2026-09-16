'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import { Check, GitMerge, Pencil, X } from 'lucide-react';

// @kku/ui has no text-input primitive; the /usage search box uses a plain
// <input> with token classes, and so does this page — classes copied from
// apps/web/app/usage/client.tsx's search input.
const INPUT = 'rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary';

export interface JobFieldRowDto {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  mentionCount: number;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  methodVersion: string;
  programmeCount: number;
  updatedAt: string;
}

export interface ProgramJobFieldRowDto {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: string;
  fieldId: string;
  fieldSlug: string;
  source: string;
  confidence: number | null;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
}

const STATUS_LABEL: Record<JobFieldRowDto['reviewStatus'], { label: string; tone: 'warning' | 'success' | 'outline' }> = {
  PROPOSED: { label: 'Proposed', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'outline' },
};

async function call(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<boolean> {
  const res = await fetch(`/api/admin-job-fields/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    toast.error(j.error?.message ?? `${method} ${path} failed`);
    return false;
  }
  return true;
}

export function JobFieldsReview({ fields: initialFields, assignments: initialAssignments }: { fields: JobFieldRowDto[]; assignments: ProgramJobFieldRowDto[] }): React.JSX.Element {
  const [fields, setFields] = React.useState(initialFields);
  const [assignments, setAssignments] = React.useState(initialAssignments);
  const [selected, setSelected] = React.useState<string | null>(initialFields[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; nameTh: string; nameEn: string } | null>(null);
  const [merging, setMerging] = React.useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = React.useState('');

  const refresh = React.useCallback(async () => {
    const res = await fetch('/api/admin-job-fields');
    if (!res.ok) {
      toast.error('Saved, but the list could not be refreshed — reload the page.');
      return;
    }
    const body = (await res.json()) as { data: { fields: JobFieldRowDto[]; assignments: ProgramJobFieldRowDto[] } };
    setFields(body.data.fields);
    setAssignments(body.data.assignments);
  }, []);

  async function act(key: string, path: string, method: 'POST' | 'PATCH', body?: unknown, done?: string): Promise<boolean> {
    setBusy(key);
    try {
      const ok = await call(path, method, body);
      if (ok) {
        if (done) toast.success(done);
        await refresh();
      }
      return ok;
    } finally {
      setBusy(null);
    }
  }

  const approved = fields.filter((f) => f.reviewStatus === 'APPROVED').length;
  const proposed = fields.filter((f) => f.reviewStatus === 'PROPOSED').length;
  const selectedField = fields.find((f) => f.id === selected) ?? null;
  const selectedAssignments = assignments.filter((a) => a.fieldId === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-default px-4 py-3">
          <div className="text-sm font-medium">Fields · {fields.length}</div>
          <div className="text-xs text-text-tertiary">{approved} approved · {proposed} proposed · {fields.length - approved - proposed} rejected</div>
        </div>
        <ul className="divide-y divide-default">
          {fields.map((f) => (
            <li key={f.id} className={`px-4 py-3 ${selected === f.id ? 'bg-surface-2' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(f.id)}>
                  <div className="truncate text-sm font-medium">{f.nameTh} <span className="text-text-secondary">· {f.nameEn}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.synonyms.map((s) => (
                      <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary">{s}</span>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">{f.mentionCount.toLocaleString()} postings · {f.programmeCount} programmes</div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_LABEL[f.reviewStatus].tone}>{STATUS_LABEL[f.reviewStatus].label}</Badge>
                  <div className="flex gap-1">
                    {f.reviewStatus !== 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-action="approve-field"
                        aria-label="Approve field"
                        title="Approve field"
                        disabled={busy !== null}
                        onClick={() => act(f.id, `${f.id}/approve`, 'POST', undefined, `Approved ${f.nameEn}`)}
                      >
                        <Check className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                    {f.reviewStatus !== 'REJECTED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-action="reject-field"
                        aria-label="Reject field"
                        title="Reject field"
                        disabled={busy !== null}
                        onClick={() => act(f.id, `${f.id}/reject`, 'POST', undefined, `Rejected ${f.nameEn}`)}
                      >
                        <X className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="rename-field"
                      aria-label="Rename field"
                      title="Rename field"
                      disabled={busy !== null}
                      onClick={() => setRenaming({ id: f.id, nameTh: f.nameTh, nameEn: f.nameEn })}
                    >
                      <Pencil className="h-[14px] w-[14px]" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="merge-field"
                      aria-label="Merge field"
                      title="Merge field"
                      disabled={busy !== null}
                      onClick={() => {
                        setMerging(f.id);
                        setMergeTarget('');
                      }}
                    >
                      <GitMerge className="h-[14px] w-[14px]" />
                    </Button>
                  </div>
                </div>
              </div>
              {renaming?.id === f.id && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(f.id, f.id, 'PATCH', { nameTh: renaming.nameTh, nameEn: renaming.nameEn }, 'Renamed').then((ok) => {
                      if (ok) setRenaming(null);
                    });
                  }}
                >
                  <input
                    className={`${INPUT} w-[224px]`}
                    value={renaming.nameTh}
                    onChange={(e) => setRenaming({ ...renaming, nameTh: e.target.value })}
                    placeholder="Thai name"
                    aria-label="Thai name"
                    required
                    minLength={1}
                  />
                  <input
                    className={`${INPUT} w-[224px]`}
                    value={renaming.nameEn}
                    onChange={(e) => setRenaming({ ...renaming, nameEn: e.target.value })}
                    placeholder="English name"
                    aria-label="English name"
                    required
                    minLength={1}
                  />
                  <Button size="sm" type="submit">Save</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              )}
              {merging === f.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    Merge into
                    <select
                      className={`${INPUT} min-w-0 flex-1`}
                      title="Rejected fields are not offered — a merge keeps the stronger status and would revive them."
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                    >
                      <option value="">Choose a field…</option>
                      {fields.filter((g) => g.id !== f.id && g.reviewStatus !== 'REJECTED').map((g) => (
                        <option key={g.id} value={g.id}>{g.nameEn} · {g.nameTh}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    type="button"
                    data-action="merge-confirm"
                    disabled={busy !== null || !mergeTarget}
                    onClick={() => {
                      const into = fields.find((g) => g.id === mergeTarget);
                      if (!into) return;
                      if (!window.confirm(`Merge "${f.nameEn}" into "${into.nameEn}"? Its synonyms and programmes move; the field itself is deleted. This cannot be undone.`)) return;
                      void act(f.id, `${f.id}/merge`, 'POST', { intoId: mergeTarget }, `Merged ${f.nameEn}`).then((ok) => {
                        if (ok) {
                          setSelected(mergeTarget);
                          setMerging(null);
                          setMergeTarget('');
                        }
                      });
                    }}
                  >
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      setMerging(null);
                      setMergeTarget('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          ))}
          {fields.length === 0 && <li className="px-4 py-6 text-sm text-text-tertiary">No fields yet. Run pnpm jobthai:fields --apply after a JobThai upload.</li>}
        </ul>
      </Card>

      <Card className="p-0">
        <div className="border-b border-default px-4 py-3 text-sm font-medium">
          Programmes{selectedField ? ` · ${selectedField.nameEn}` : ''} · {selectedAssignments.length}
        </div>
        <ul className="divide-y divide-default">
          {selectedAssignments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{a.programNameTh} <span className="text-text-secondary">· {a.programNameEn}</span></div>
                <div className="text-xs text-text-tertiary">{a.programCode} · {a.programLevel} · {a.source}{a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)} %` : ''}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={STATUS_LABEL[a.reviewStatus].tone}>{STATUS_LABEL[a.reviewStatus].label}</Badge>
                <div className="flex gap-1">
                  {a.reviewStatus !== 'APPROVED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="approve-assignment"
                      aria-label="Approve assignment"
                      title="Approve assignment"
                      disabled={busy !== null}
                      onClick={() => act(a.id, `assignments/${a.id}/approve`, 'POST', undefined, 'Assignment approved')}
                    >
                      <Check className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                  {a.reviewStatus !== 'REJECTED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="reject-assignment"
                      aria-label="Reject assignment"
                      title="Reject assignment"
                      disabled={busy !== null}
                      onClick={() => act(a.id, `assignments/${a.id}/reject`, 'POST', undefined, 'Assignment rejected')}
                    >
                      <X className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {selectedField && selectedAssignments.length === 0 && (
            <li className="px-4 py-6 text-sm text-text-tertiary">No programme assigned. This field is a white space on the map.</li>
          )}
        </ul>
        {selectedField && (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-default px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('programId') as HTMLInputElement | null);
              const programId = input?.value.trim();
              if (!programId) return;
              void act('add', 'assignments', 'POST', { programId, fieldId: selectedField.id }, 'Programme added').then((ok) => {
                if (ok && input) input.value = '';
              });
            }}
          >
            <input
              name="programId"
              className={`${INPUT} w-[288px]`}
              placeholder="Programme id (from /admin/programs)"
              aria-label="Programme id"
            />
            <Button size="sm" type="submit" disabled={busy !== null}>Add programme</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
