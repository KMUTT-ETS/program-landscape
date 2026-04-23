import { describe, expect, it, vi, beforeEach } from 'vitest';

// Guards the most important rule in the deep-dive surface: COUNCIL
// visibility is aggregates-only. Salaries (when we persist them in
// prompt 14) and names must be redacted.

const mocks = vi.hoisted(() => ({
  programFacultyFindMany: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      programFaculty: { findMany: mocks.programFacultyFindMany },
    },
  };
});

import { programFaculty } from '../src/program-deep-dive';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('programFaculty — role-gated visibility', () => {
  const mockMembers = [
    {
      facultyMember: {
        id: 'fm-1',
        rank: 'ASSOC_PROF',
        nameEn: 'John Doe',
        nameTh: 'จอห์น โด',
        employeeCode: 'EMP-001',
        academicQualification: 'PhD',
        specialization: 'AI',
        dateOfBirth: new Date('1975-01-01'),
        hireDate: new Date('2005-01-01'),
        retirementDate: new Date('2035-12-31'),
        isActive: true,
      },
    },
    {
      facultyMember: {
        id: 'fm-2',
        rank: 'LECTURER',
        nameEn: 'Jane Smith',
        nameTh: 'เจน สมิธ',
        employeeCode: 'EMP-002',
        academicQualification: 'MSc',
        specialization: 'ML',
        dateOfBirth: new Date('1985-06-15'),
        hireDate: new Date('2015-08-01'),
        retirementDate: new Date('2045-06-14'),
        isActive: true,
      },
    },
  ];

  it('full visibility returns names + specialisation + employeeCode', async () => {
    mocks.programFacultyFindMany.mockResolvedValue(mockMembers);
    const r = await programFaculty('p-1', 'full');
    expect(r.totalActive).toBe(2);
    expect(r.members[0]?.nameEn).toBe('John Doe');
    expect(r.members[0]?.nameTh).toBe('จอห์น โด');
    expect(r.members[0]?.specialization).toBe('AI');
    expect(r.members[0]?.employeeCode).toBe('EMP-001');
  });

  it('aggregates-only (COUNCIL) strips names + specialisation + employeeCode but keeps ranks + retirement', async () => {
    // Prisma is smart enough to return nulls for fields we skipped in
    // the select, but we still have to prove the TS function doesn't
    // leak them back to the caller. The real protection is at the
    // Prisma select layer; this test asserts the fallthrough.
    const redactedMembers = mockMembers.map((m) => ({
      facultyMember: {
        ...m.facultyMember,
        nameEn: false as unknown as string,
        nameTh: false as unknown as string,
        employeeCode: false as unknown as string,
        specialization: false as unknown as string,
        hireDate: false as unknown as Date,
      },
    }));
    mocks.programFacultyFindMany.mockResolvedValue(redactedMembers);
    const r = await programFaculty('p-1', 'aggregates-only');
    for (const m of r.members) {
      expect(m.nameEn).toBe(null);
      expect(m.nameTh).toBe(null);
      expect(m.employeeCode).toBe(null);
      expect(m.specialization).toBe(null);
      // Ranks + retirementDate ARE visible to Council.
      expect(m.rank).toBeTruthy();
    }
    expect(r.successionRiskPct).toBeGreaterThanOrEqual(0);
  });
});
