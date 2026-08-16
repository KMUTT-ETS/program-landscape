import * as React from 'react';

import { formatCount, formatGpa } from '../format';
import type { ProgramDetailData } from '../schema';

// §? — Course list. Reference-table shape — a table in the body, no chart
// leading it, no appendix entry (nothing here belongs in the "exact
// figures" back-matter; this table already IS the exact figures).
//
// This is the one section the pre-rebuild `template.tsx` dropped entirely
// despite `courses` being present in its schema (11 references, rendered 0
// times — see the plan's "Current state, measured" table). Getting course
// codes and names onto the page is this batch's single most user-visible
// fix.
//
// `courses.rows` is already filtered upstream to courses with a real,
// non-null `classGpa` (see schema.ts's field comment) — `total` is that
// visible count, `extractedCount` is the unfiltered curriculum row count,
// so the caption can honestly say "showing X of Y" rather than imply every
// curriculum course has a graded-GPA figure.
const LEDE_TH =
  'ตารางนี้แสดงรายวิชาในหลักสูตรพร้อมค่าเฉลี่ยเกรด (GPA) และจำนวนนักศึกษาที่มีผลการเรียน ' +
  'คำนวณจากข้อมูลผลการเรียนจริงของแต่ละรายวิชา';

export function renderCoursesSection(data: ProgramDetailData): React.ReactElement | null {
  const { courses } = data;
  if (!courses) return null;

  const windowLabel =
    courses.windowYearsBE.start !== null && courses.windowYearsBE.end !== null
      ? `BE ${courses.windowYearsBE.start}–${courses.windowYearsBE.end}`
      : 'window unknown';

  return (
    <section>
      <div className="section-opener">
        <div>
          <span className="section-kicker">Curriculum</span>
          <h2 className="section-title">Course list</h2>
        </div>
      </div>
      <p className="chart-lede" lang="th">
        {LEDE_TH}
      </p>

      {courses.rows.length === 0 ? (
        <p className="muted">
          No courses with graded-GPA data extracted yet (0 of {formatCount(courses.extractedCount)}{' '}
          curriculum courses, method {courses.methodVersion}).
        </p>
      ) : (
        <>
          <p className="caption">
            Showing {formatCount(courses.total)} of {formatCount(courses.extractedCount)} curriculum
            courses with graded-GPA data · {windowLabel} · semesters{' '}
            {courses.semestersApplied.join(', ')}
          </p>
          <table className="course-list">
            <thead>
              <tr>
                <th>Code</th>
                <th>Course</th>
                <th className="numeric">Credits</th>
                <th className="numeric">Classes</th>
                <th className="numeric">Graded</th>
                <th className="numeric">Class GPA</th>
              </tr>
            </thead>
            <tbody>
              {courses.rows.map((c) => (
                <tr key={c.courseCode}>
                  <td>{c.courseCode}</td>
                  <td>
                    {c.courseNameTh || c.courseNameEn || '—'}
                    {c.courseNameTh && c.courseNameEn && (
                      <>
                        <br />
                        <span className="muted" lang="en">
                          {c.courseNameEn}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="numeric">{formatCount(c.credits)}</td>
                  <td className="numeric">{formatCount(c.classCount)}</td>
                  <td className="numeric">{formatCount(c.gradedCount)}</td>
                  <td className="numeric">{formatGpa(c.classGpa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="caption">
        <strong>Source</strong> program-courses-extract · {data.dateLabel} · <strong>Method</strong>{' '}
        {courses.methodVersion}
      </p>
    </section>
  );
}
