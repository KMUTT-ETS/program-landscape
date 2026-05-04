'use client';

import * as React from 'react';
import { Card } from '@kku/ui';
import { DrillDownPivot, type DrillRow } from '../drill-down-pivot';
import type { FacultyByProgramResponse } from '../types';

interface Props {
  data: FacultyByProgramResponse;
}

export function FacultyByProgramClient({ data }: Props) {
  const totalPrograms = data.faculties.reduce((a, f) => a + f.programCount, 0);
  const programsBelowMin = data.faculties.reduce((a, f) => a + f.programsBelowMin, 0);

  // Map the 3-level tree (Faculty → Level → Program) into the
  // generic DrillRow[] shape used by the shared pivot component.
  const rows: DrillRow[] = data.faculties.map((f) => ({
    label: f.facultyName,
    metrics: {
      type3: f.teachType3,
      type2: f.teachType2,
      distinct: f.distinctStaff,
      students: f.studentCount,
      ratio: f.studentsPerStaff,
      programs: f.programCount,
      below: f.programsBelowMin,
    },
    children: f.levels.map((l) => ({
      label: l.programLevel,
      metrics: {
        type3: l.teachType3,
        type2: l.teachType2,
        distinct: l.distinctStaff,
        students: l.studentCount,
        ratio: l.studentsPerStaff,
        programs: l.programCount,
        below: l.programsBelowMin,
      },
      children: l.programs.map((p) => ({
        label: p.programName,
        emphasis: !p.meetsResponsibleMin ? 'warn' : undefined,
        metrics: {
          type3: p.teachType3,
          type2: p.teachType2,
          distinct: p.distinctStaff,
          students: p.studentCount,
          ratio: p.studentsPerStaff,
          programs: 1,
          below: p.meetsResponsibleMin ? 0 : 1,
        },
      })),
    })),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile label="Programs with assigned staff" value={totalPrograms.toLocaleString('en-US')} />
        <KpiTile
          label="Programs short on responsible faculty"
          value={programsBelowMin.toLocaleString('en-US')}
          tone={programsBelowMin > 0 ? 'warn' : undefined}
        />
        <KpiTile
          label="Faculties with programs at risk"
          value={data.faculties.filter((f) => f.programsBelowMin > 0).length.toLocaleString('en-US')}
        />
      </div>

      <Card>
        <h3 className="text-sm font-semibold">Faculty → Level → Program</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Click a row to drill in. Click any column header to sort. Programs with fewer than 5
          อาจารย์ผู้รับผิดชอบหลักสูตร are highlighted amber.
        </p>
        <p className="mt-2 text-[0.7rem] text-text-tertiary leading-relaxed">
          <strong className="text-text-primary">ผู้รับผิดชอบ</strong> — the 5-person committee responsible for the curriculum.{' '}
          <strong className="text-text-primary">ประจำหลักสูตร</strong> — curriculum lecturers (typically the same people as ผู้รับผิดชอบ).{' '}
          <strong className="text-text-primary">Unique people</strong> — distinct humans involved, deduped across roles.
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rows={rows}
            columns={[
              { key: 'type3', label: 'ผู้รับผิดชอบ', format: 'int' },
              { key: 'type2', label: 'ประจำหลักสูตร', format: 'int' },
              { key: 'distinct', label: 'Unique people', format: 'int' },
              { key: 'students', label: 'Students', format: 'int' },
              { key: 'ratio', label: 'Students / teacher', format: 'decimal1' },
              { key: 'programs', label: 'Programs', format: 'int' },
              { key: 'below', label: 'At risk', format: 'int' },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <Card>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className={`mt-1 font-tabular text-2xl font-semibold ${tone === 'warn' ? 'text-warning' : ''}`}>
        {value}
      </div>
    </Card>
  );
}
