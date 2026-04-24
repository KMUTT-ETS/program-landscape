'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
} from '@kku/ui';
import { Search, FileText, FilePlus2 } from 'lucide-react';

export interface ProgramListRow {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL';
  status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
  curriculumYearBE: number | null;
  totalCredits: number | null;
  isRevision: boolean;
  faculty: { id: string; code: string; nameEn: string; nameTh: string } | null;
  department: { id: string; code: string; nameEn: string; nameTh: string } | null;
  documents: Array<{
    id: string;
    role: string;
    curriculumYearBE: number | null;
    pdfDocument: { id: string; originalFilename: string; processingStatus: string };
  }>;
  pendingExtractions: Array<{ id: string; reviewStatus: string }>;
  updatedAt: string;
}

interface Props {
  rows: ProgramListRow[];
  total: number;
  faculties: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  initialFilters: {
    q?: string;
    facultyId?: string;
    level?: string;
    status?: string;
  };
}

const LEVEL_LABEL: Record<ProgramListRow['level'], string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
};

const STATUS_TONE: Record<
  ProgramListRow['status'],
  'success' | 'warning' | 'neutral'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  SUNSET: 'neutral',
};

export function ProgramsListClient({
  rows,
  total,
  faculties,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [q, setQ] = React.useState(initialFilters.q ?? '');
  const [facultyId, setFacultyId] = React.useState(initialFilters.facultyId ?? '');
  const [level, setLevel] = React.useState(initialFilters.level ?? '');
  const [status, setStatus] = React.useState(initialFilters.status ?? '');

  const applyFilters = (next: Partial<typeof initialFilters>) => {
    const params = new URLSearchParams();
    const merged = { q, facultyId, level, status, ...next };
    if (merged.q) params.set('q', merged.q);
    if (merged.facultyId) params.set('facultyId', merged.facultyId);
    if (merged.level) params.set('level', merged.level);
    if (merged.status) params.set('status', merged.status);
    router.push(`/admin/programs?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm" tone="quiet">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters({});
          }}
        >
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-tertiary" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Code, name (TH or EN)"
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Faculty</Label>
            <select
              value={facultyId}
              onChange={(e) => {
                setFacultyId(e.target.value);
                applyFilters({ facultyId: e.target.value });
              }}
              className="rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm"
            >
              <option value="">All faculties</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Level</Label>
            <select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                applyFilters({ level: e.target.value });
              }}
              className="rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm"
            >
              <option value="">All levels</option>
              <option value="BACHELOR">Bachelor</option>
              <option value="MASTER">Master</option>
              <option value="DOCTORAL">Doctoral</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                applyFilters({ status: e.target.value });
              }}
              className="rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="SUNSET">Sunset</option>
            </select>
          </div>
        </form>
      </Card>

      <div className="flex items-center justify-between text-sm text-text-secondary">
        <span>
          <span className="font-tabular text-text-primary">{rows.length}</span>
          {' '}
          showing of{' '}
          <span className="font-tabular text-text-primary">{total}</span> programs
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No programs match these filters"
          description="Try clearing filters, or create a new program."
          action={
            <Button asChild>
              <Link href="/admin/programs/new">
                <FilePlus2 className="h-4 w-4" aria-hidden />
                New program
              </Link>
            </Button>
          }
        />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-2 text-left">Code</th>
                  <th className="px-4 py-2 text-left">Program</th>
                  <th className="px-4 py-2 text-left">Faculty · Dept</th>
                  <th className="px-4 py-2 text-left">Level</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Curric. year</th>
                  <th className="px-4 py-2 text-left">PDF</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((r) => {
                  const current = r.documents.find((d) => d.role === 'CURRENT_CURRICULUM');
                  const pending = r.pendingExtractions.length;
                  return (
                    <tr key={r.id} className="hover:bg-surface-1">
                      <td className="px-4 py-2 font-tabular font-medium text-text-primary">{r.code}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col">
                          <Link
                            href={`/admin/programs/${r.id}`}
                            className="font-medium text-text-primary hover:underline"
                          >
                            {r.nameEn}
                          </Link>
                          <span className="text-xs text-text-secondary">{r.nameTh}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">
                        <div className="flex flex-col">
                          <span>{r.faculty?.nameEn ?? '—'}</span>
                          {r.department && (
                            <span className="text-xs text-text-tertiary">{r.department.nameEn}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">{LEVEL_LABEL[r.level]}</td>
                      <td className="px-4 py-2">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                      </td>
                      <td className="px-4 py-2 font-tabular text-text-secondary">
                        {r.curriculumYearBE ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {current ? (
                          <Badge tone="info">
                            <FileText className="h-3 w-3" aria-hidden /> current
                          </Badge>
                        ) : (
                          <Badge tone="neutral">none</Badge>
                        )}
                        {pending > 0 && (
                          <Badge tone="warning" className="ml-1">
                            {pending} to review
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/programs/${r.id}`}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
