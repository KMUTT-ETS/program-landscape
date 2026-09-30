import { describe, expect, it } from 'vitest';
import { StaffProfileResponseDataSchema } from '@kku/shared';
import { toStaffProfileResponse } from '../src/external/staff-profile.mapper';
import { staffProfileFixture } from './fixtures/staff-profile';

const ALL = ['affiliation', 'education', 'teaching', 'research', 'publications'];
const grant = (allowedSections: string[], allowEmailLookup = true) => ({ allowedSections, allowEmailLookup });

describe('toStaffProfileResponse', () => {
  it('produces a body that satisfies the v1 wire schema', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(ALL));
    expect(StaffProfileResponseDataSchema.safeParse(data).success).toBe(true);
  });

  it('always returns person; returns only granted sections; lists the rest as withheld', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['education']));
    expect(Object.keys(r.data).sort()).toEqual(['education', 'person']);
    expect(r.included).toEqual(['person', 'education']);
    expect(r.withheld).toEqual(['affiliation', 'teaching', 'research', 'publications']);
  });

  it('takes the title abbreviation from the builder, not a table of its own', () => {
    const p = staffProfileFixture();
    p.basic = { ...p.basic, rankAbbrevTh: 'รศ.x', rankAbbrevEn: 'Assoc.x' };
    const { title } = toStaffProfileResponse(p, grant([])).data.person;
    expect(title).toMatchObject({ abbrevTh: 'รศ.x', abbrevEn: 'Assoc.x' });
  });

  it('withholds the staff email unless the client holds email lookup', () => {
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], false)).data.person.email).toBeNull();
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], true)).data.person.email).toBe('somchai@kku.ac.th');
  });

  it('sorts publications by year desc, then citations desc, then title', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications']));
    expect(data.publications!.map((p) => p.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('carries each paper source, the research basis and an APA string', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications', 'research']));
    expect(data.publications![0]).toMatchObject({ source: 'google-scholar', scholarPaperId: 'sp1' });
    expect(data.publications![2]!.apa).toContain('Jaidee');
    expect(data.research!.basis).toBe('library');
  });

  it('maps teaching totals and every course', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['teaching']));
    expect(data.teaching!.totals.studentsTaught).toBe(180);
    expect(data.teaching!.courses).toHaveLength(1);
    expect(data.teaching!.byYear[0]).toEqual({ yearBE: 2569, sections: 2, studentsTaught: 90, contactHrsPerWeek: 12 });
  });
});
