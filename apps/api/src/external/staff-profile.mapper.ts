// StaffProfile (the builder's shape, shared with /profile) → the staff-profile.v1
// wire shape, filtered to what this client was granted. Pure: no I/O.
import type { StaffProfile } from '@kku/db';
import {
  formatApa,
  STAFF_PROFILE_SECTIONS,
  type StaffProfileResponseData,
  type StaffProfileSection,
} from '@kku/shared';

const RANK_ABBREV: Record<StaffProfile['rank'], { th: string; en: string }> = {
  PROF: { th: 'ศ.', en: 'Prof.' },
  ASSOC_PROF: { th: 'รศ.', en: 'Assoc. Prof.' },
  ASST_PROF: { th: 'ผศ.', en: 'Asst. Prof.' },
  LECTURER: { th: 'อ.', en: 'Lect.' },
};

export interface StaffProfileGrant {
  allowedSections: readonly string[];
  allowEmailLookup: boolean;
}

export interface MappedStaffProfile {
  data: StaffProfileResponseData;
  included: Array<'person' | StaffProfileSection>;
  withheld: StaffProfileSection[];
}

export function toStaffProfileResponse(p: StaffProfile, grant: StaffProfileGrant): MappedStaffProfile {
  const granted = new Set(grant.allowedSections);
  const data: StaffProfileResponseData = {
    person: {
      facultyMemberId: p.facultyMemberId,
      isActive: p.isActive,
      title: {
        th: p.basic.rankLabelTh,
        en: p.basic.rankLabelEn,
        abbrevTh: RANK_ABBREV[p.rank].th,
        abbrevEn: RANK_ABBREV[p.rank].en,
      },
      name: { th: p.nameTh, en: p.nameEn },
      displayName: { th: p.basic.fullNameTh, en: p.basic.fullNameEn },
      email: grant.allowEmailLookup ? p.kkuEmail : null,
      identifiers: {
        orcid: p.basic.orcid,
        scopusAuthorId: p.basic.scopusAuthorId,
        openalexAuthorId: p.basic.openalexAuthorId,
        scholarProfileId: p.basic.scholarProfileId,
      },
    },
  };

  if (granted.has('affiliation')) {
    data.affiliation = {
      faculty: { th: p.basic.facultyNameTh, en: p.basic.facultyNameEn },
      department: { th: p.basic.departmentNameTh, en: p.basic.departmentNameEn },
      programmes: p.curriculum.map((c) => ({
        code: c.code,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        level: c.level,
        role: c.role,
      })),
    };
  }

  if (granted.has('education')) {
    data.education = p.education.map((e) => ({
      qualification: e.qualification,
      level: e.level,
      major: e.major,
      institute: e.institute,
      countryCode: e.countryCode,
      yearBE: e.year,
      source: e.source,
    }));
  }

  if (granted.has('teaching')) {
    const t = p.teaching;
    data.teaching = {
      available: t.available,
      windowYearsBE: t.windowYearsBE,
      totals: {
        studentsTaught: t.kpis.totalStudentsTaught,
        sections: t.kpis.totalSections,
        distinctCourses: t.kpis.totalDistinctCourses,
        activeSemesters: t.kpis.activeSemesters,
        avgContactHrsPerWeek: t.kpis.avgContactHrsPerWeekActive,
      },
      byYear: t.byYear.map((y) => ({
        yearBE: y.acadYearBE,
        sections: y.sections,
        studentsTaught: y.studentsTaught,
        contactHrsPerWeek: y.contactHrsPerWeekTotal,
      })),
      courses: t.topCourses.map((c) => ({
        code: c.courseCode,
        nameTh: c.courseNameTh,
        nameEn: c.courseNameEn,
        sections: c.sections,
        studentsTaught: c.studentsTaught,
        firstYearBE: c.firstYearBE,
        lastYearBE: c.lastYearBE,
      })),
    };
  }

  if (granted.has('research')) {
    data.research = { basis: p.researchBasis, ...p.research };
  }

  if (granted.has('publications')) {
    data.publications = [...p.publications]
      .sort(
        (a, b) =>
          b.year - a.year ||
          b.citations - a.citations ||
          (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
      )
      .map((pub) => ({
        year: pub.year,
        title: pub.title,
        venue: pub.venue,
        type: pub.type,
        citations: pub.citations,
        source: pub.source ?? null,
        doi: pub.doi,
        scopusId: pub.scopusId,
        pmid: pub.pmid,
        scholarPaperId: pub.scholarPaperId ?? null,
        authors: pub.authors.map((a) => ({ family: a.family, given: a.given, initials: a.initials })),
        authorsComplete: pub.authorsAreComplete,
        apa: formatApa(pub),
      }));
  }

  const included = STAFF_PROFILE_SECTIONS.filter((s) => granted.has(s));
  return {
    data,
    included: ['person', ...included],
    withheld: STAFF_PROFILE_SECTIONS.filter((s) => !granted.has(s)),
  };
}
