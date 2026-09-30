import type { StaffProfile } from '@kku/db';

export function staffProfileFixture(over: Partial<StaffProfile> = {}): StaffProfile {
  return {
    facultyMemberId: 'fm1',
    isActive: true,
    rank: 'ASSOC_PROF',
    nameTh: 'สมชาย ใจดี',
    nameEn: 'Somchai Jaidee',
    kkuEmail: 'somchai@kku.ac.th',
    basic: {
      fullNameTh: 'รศ. ดร. สมชาย ใจดี',
      fullNameEn: 'Assoc. Prof. Dr. Somchai Jaidee',
      rankLabelTh: 'รองศาสตราจารย์',
      rankLabelEn: 'Associate Professor',
      facultyNameTh: 'คณะวิทยาศาสตร์',
      facultyNameEn: 'Faculty of Science',
      departmentNameTh: null,
      departmentNameEn: null,
      orcid: null,
      scopusAuthorId: '123',
      openalexAuthorId: null,
      scholarProfileId: null,
    },
    education: [
      { qualification: 'Ph.D.', level: 'ปริญญาเอก', major: 'Chemistry', institute: 'MIT', countryCode: 'US', year: 2548, source: 'unicon-ds2003' },
    ],
    research: {
      totalPapers: 3, totalCitations: 30, hIndex: 2, peakYear: 2024, peakYearCount: 2,
      topVenues: [{ venue: 'J. Chem', count: 2 }], earliestYear: 2020, latestYear: 2024, yearsActive: 5,
    },
    researchBasis: 'library',
    curriculum: [
      { programId: 'p1', code: 'KKU-SEQ-0001', nameTh: 'เคมี', nameEn: 'Chemistry', level: 'BACHELOR', facultyNameTh: 'คณะวิทยาศาสตร์', facultyNameEn: 'Faculty of Science', role: 'CORE' },
    ],
    publications: [
      { id: 'a', year: 2020, title: 'Beta', venue: null, citations: 5, doi: null, scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [{ family: 'Jaidee', given: 'Somchai', initials: null }], authorsAreComplete: true, source: 'kku-publications:scopus', scholarPaperId: null },
      { id: 'b', year: 2024, title: 'Alpha', venue: 'J. Chem', citations: 3, doi: '10.1/x', scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [], authorsAreComplete: false, source: 'live:scopus', scholarPaperId: null },
      { id: 'c', year: 2024, title: 'Gamma', venue: 'J. Chem', citations: 22, doi: null, scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [], authorsAreComplete: false, source: 'google-scholar', scholarPaperId: 'sp1' },
    ],
    publicationsCache: 'hit',
    publicationsFetchedAt: '2026-09-29T02:10:00.000Z',
    teaching: {
      available: true,
      windowYearsBE: { from: 2565, to: 2569 },
      kpis: { totalSections: 4, totalDistinctCourses: 2, activeSemesters: 3, avgContactHrsPerWeekActive: 6, totalStudentsTaught: 180 },
      byYear: [{ acadYearBE: 2569, sections: 2, contactHrsPerWeekTotal: 12, studentsTaught: 90 }],
      topCourses: [{ courseCode: 'SC101', courseNameTh: 'เคมี 1', courseNameEn: 'Chem 1', sections: 3, studentsTaught: 150, firstYearBE: 2565, lastYearBE: 2569 }],
      expertiseAreas: [],
    },
    talent: null,
    ...over,
  };
}
