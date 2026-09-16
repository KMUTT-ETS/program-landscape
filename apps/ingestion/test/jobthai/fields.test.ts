import { describe, expect, it, vi } from 'vitest';
import { parseFieldsArgs, refreshJobFields, type FieldsDeps } from '../../src/jobthai/fields';

describe('parseFieldsArgs', () => {
  it('is a dry run by default and accepts only --apply', () => {
    expect(parseFieldsArgs([])).toEqual({ apply: false });
    expect(parseFieldsArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseFieldsArgs(['--dryrun'])).toThrow(/unknown flag/);
    expect(() => parseFieldsArgs(['--apply', '--force'])).toThrow(/unknown flag/);
  });
});

function deps(overrides: Partial<FieldsDeps> = {}): FieldsDeps {
  return {
    collectRaw: vi.fn(async () => [
      { raw: 'บัญชี', mentions: 812 },
      { raw: 'ไฟฟ้า', mentions: 900 },
      { raw: 'rare', mentions: 2 },
    ]),
    listExisting: vi.fn(async () => [
      { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' as const },
    ]),
    clusterBatch: vi.fn(async () => ({
      newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }],
      unassigned: [],
      confidence: 0.8,
      reasoning: 'ok',
    })),
    listProgrammes: vi.fn(async () => [
      { id: 'p1', code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering', level: 'BACHELOR', skills: [] },
      // No synonym matches this name, so the rule leaves it to the model.
      { id: 'p2', code: 'KKU-SEQ-0002', nameTh: 'ศิลปศาสตรบัณฑิต สาขาการเงิน', nameEn: 'Finance', level: 'BACHELOR', skills: ['Auditing'] },
    ]),
    listApprovedAssignmentProgramIds: vi.fn(async () => []),
    assignBatch: vi.fn(async () => ({
      programs: [{ programId: 'p2', fields: [{ slug: 'accounting', confidence: 0.9 }] }],
      confidence: 0.9,
      reasoning: 'ok',
    })),
    writeTaxonomy: vi.fn(async () => ({ created: 1, extended: 0 })),
    writeAssignments: vi.fn(async () => ({ created: 2, refreshed: 0, kept: 0 })),
    refreshMentionCounts: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('refreshJobFields', () => {
  it('dry run: plans everything, calls the model, writes nothing', async () => {
    const d = deps();
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(d.clusterBatch).toHaveBeenCalledTimes(1);
    expect(d.writeTaxonomy).not.toHaveBeenCalled();
    expect(d.writeAssignments).not.toHaveBeenCalled();
    expect(d.refreshMentionCounts).not.toHaveBeenCalled();
    expect(s.applied).toBe(false);
    expect(s.taxonomy.batches).toBe(1);
    expect(s.taxonomy.creates).toBe(1);
    expect(s.taxonomy.synonymAdds).toBe(0);
    expect(s.taxonomy.dropped).toBe(0);
    expect(s.taxonomy.abstained).toBe(0);
    expect(s.taxonomy.rejectedField).toBe(0);
    expect(s.taxonomy.missing).toBe(0);
    expect(s.taxonomy.absorbed).toBe(1); // 'ไฟฟ้า' is already a synonym
    expect(s.taxonomy.other).toEqual({ kinds: 1, mentions: 2 });
    // p1 matched by the rule (synonym 'ไฟฟ้า' inside its Thai name); only p2 went to the model.
    expect(s.assignments.rule).toBe(1);
    expect(d.assignBatch).toHaveBeenCalledTimes(1);
    const firstInput = (d.assignBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { programs: Array<{ id: string }>; fields: Array<{ slug: string }> };
    expect(firstInput.programs.map((p) => p.id)).toEqual(['p2']);
    // The dry-run vocabulary already carries the field created in this run.
    expect(firstInput.fields.map((f) => f.slug).sort()).toEqual(['accounting', 'electrical-engineering']);
    expect(s.assignments.ai).toBe(1);
    expect(s.assignments.aiBatches).toBe(1);
    expect(s.assignments.droppedUnknownSlug).toBe(0);
  });

  it('apply: writes taxonomy, assignments and mention counts, stamped with the run', async () => {
    const d = deps();
    // After the taxonomy write the vocabulary is re-read so real ids replace the pending ones.
    (d.listExisting as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' },
      ])
      .mockResolvedValueOnce([
        { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' },
        { id: 'f2', slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี'], reviewStatus: 'PROPOSED' },
      ]);
    const s = await refreshJobFields({ apply: true, runId: 'run1', log: () => undefined }, d);
    expect(s.applied).toBe(true);
    expect(d.writeTaxonomy).toHaveBeenCalledWith(
      expect.objectContaining({ creates: [expect.objectContaining({ slug: 'accounting', synonyms: ['บัญชี'] })] }),
      'run1',
    );
    expect(d.refreshMentionCounts).toHaveBeenCalled();
    expect(d.listExisting).toHaveBeenCalledTimes(2);
    expect(d.writeAssignments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ programId: 'p1', fieldId: 'f1', source: 'rule', confidence: null }),
        expect.objectContaining({ programId: 'p2', fieldId: 'f2', source: 'ai', confidence: 0.9 }),
      ]),
      'run1',
    );
    const rows = (d.writeAssignments as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{ fieldId: string }>;
    expect(rows.some((r) => r.fieldId.startsWith('pending-'))).toBe(false);
  });

  it('a second run with nothing new makes no model call for the taxonomy', async () => {
    const d = deps({
      listExisting: vi.fn(async () => [
        { id: 'f1', slug: 'electrical-engineering', nameTh: 'x', nameEn: 'x', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' as const },
        { id: 'f2', slug: 'accounting', nameTh: 'x', nameEn: 'x', synonyms: ['บัญชี'], reviewStatus: 'PROPOSED' as const },
      ]),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(d.clusterBatch).not.toHaveBeenCalled();
    expect(s.taxonomy.batches).toBe(0);
    expect(s.taxonomy.creates).toBe(0);
    expect(s.taxonomy.absorbed).toBe(2);
  });

  it('skips programmes that already hold an APPROVED assignment', async () => {
    const d = deps({ listApprovedAssignmentProgramIds: vi.fn(async () => ['p2']) });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(d.assignBatch).not.toHaveBeenCalled();
    expect(s.assignments.rule).toBe(1);
    expect(s.assignments.ai).toBe(0);
    expect(s.assignments.aiBatches).toBe(0);
  });

  it('drops AI slugs outside the vocabulary and caps at three fields per programme', async () => {
    const d = deps({
      assignBatch: vi.fn(async () => ({
        programs: [{ programId: 'p2', fields: [{ slug: 'no-such', confidence: 0.9 }, { slug: 'accounting', confidence: 0.7 }] }],
        confidence: 0.5,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(s.assignments.ai).toBe(1);
    expect(s.assignments.droppedUnknownSlug).toBe(1);
  });

  it('ignores AI answers for programmes that were not in the batch', async () => {
    const d = deps({
      assignBatch: vi.fn(async () => ({
        programs: [
          { programId: 'p2', fields: [{ slug: 'accounting', confidence: 0.7 }] },
          { programId: 'ghost', fields: [{ slug: 'accounting', confidence: 0.9 }] },
        ],
        confidence: 0.5,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(s.assignments.ai).toBe(1);
  });

  it('counts strings the model declined to attach as abstained', async () => {
    const d = deps({
      clusterBatch: vi.fn(async () => ({
        newFields: [],
        assignments: [],
        unassigned: [{ raw: 'บัญชี', reason: 'a job title, not a field' }],
        confidence: 0.6,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(s.taxonomy.creates).toBe(0);
    expect(s.taxonomy.dropped).toBe(1);
    expect(s.taxonomy.abstained).toBe(1);
    expect(s.taxonomy.missing).toBe(0);
  });

  it('counts batch strings the model omitted entirely as missing', async () => {
    const d = deps({
      clusterBatch: vi.fn(async () => ({
        newFields: [],
        assignments: [],
        unassigned: [],
        confidence: 0.3,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(s.taxonomy.creates).toBe(0);
    expect(s.taxonomy.dropped).toBe(0);
    expect(s.taxonomy.missing).toBe(1);
  });

  it('counts a synonym aimed at a rejected field as rejectedField', async () => {
    const d = deps({
      listExisting: vi.fn(async () => [
        { id: 'f1', slug: 'electrical-engineering', nameTh: 'x', nameEn: 'x', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' as const },
        { id: 'f9', slug: 'bookkeeping', nameTh: 'x', nameEn: 'x', synonyms: [], reviewStatus: 'REJECTED' as const },
      ]),
      clusterBatch: vi.fn(async () => ({
        newFields: [],
        assignments: [{ raw: 'บัญชี', fieldSlug: 'bookkeeping' }],
        unassigned: [],
        confidence: 0.6,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    // Rejected rows are never sent as anchors …
    const input = (d.clusterBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { anchors: Array<{ slug: string }> };
    expect(input.anchors.map((a) => a.slug)).toEqual(['electrical-engineering']);
    // … and never receive synonyms.
    expect(s.taxonomy.synonymAdds).toBe(0);
    expect(s.taxonomy.dropped).toBe(1);
    expect(s.taxonomy.rejectedField).toBe(1);
  });
});
