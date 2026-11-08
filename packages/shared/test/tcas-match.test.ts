import { describe, expect, it } from 'vitest';
import {
  buildTcasMatchIndex,
  extractSpecialization,
  findOwnProgrammeMatch,
} from '../src/ingestion/tcas-match';

const index = buildTcasMatchIndex([
  { id: 'eng-me', nameTh: 'หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล', majors: [], facultyNameTh: 'คณะวิศวกรรมศาสตร์' },
  { id: 'sci-math', nameTh: 'คณิตศาสตร์', majors: [], facultyNameTh: 'คณะวิทยาศาสตร์' },
  { id: 'sport-x', nameTh: 'วิทยาศาสตร์การกีฬา', majors: [], facultyNameTh: 'คณะวิทยาศาสตร์การกีฬา' },
]);

describe('tcas own-programme matcher', () => {
  it('matches faculty + programme exactly', () => {
    expect(findOwnProgrammeMatch(index, 'คณะวิทยาศาสตร์', 'คณิตศาสตร์', '')?.id).toBe('sci-math');
  });
  it('bridges abbreviated TCAS names via สาขาวิชา', () => {
    expect(
      findOwnProgrammeMatch(index, 'คณะวิศวกรรมศาสตร์', 'วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี', '')?.id,
    ).toBe('eng-me');
  });
  it('does not cross-match a faculty that is a prefix of another', () => {
    expect(findOwnProgrammeMatch(index, 'คณะวิทยาศาสตร์', 'วิทยาศาสตร์การกีฬา', '')).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(findOwnProgrammeMatch(index, 'คณะวิศวกรรมศาสตร์', 'นิติศาสตร์', '')).toBeNull();
  });
  it('extracts specializations', () => {
    expect(extractSpecialization('คณิตศาสตร์ - วท.บ. 4 ปี')).toBe('คณิตศาสตร์');
  });
});
