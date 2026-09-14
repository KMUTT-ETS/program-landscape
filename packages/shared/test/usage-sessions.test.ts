import { describe, expect, it } from 'vitest';
import { actionFamily, groupSessions, medianDwellMs, SESSION_GAP_MS } from '../src/usage';

const t = (min: number) => new Date(Date.UTC(2026, 8, 14, 0, min));

describe('groupSessions', () => {
  it('starts a new session after a gap of more than 30 minutes', () => {
    expect(SESSION_GAP_MS).toBe(30 * 60_000);
    const views = [t(0), t(5), t(20), t(60), t(65)].map((at, i) => ({ at, path: `/p${i}` }));
    const sessions = groupSessions(views);
    expect(sessions.map((s) => s.views.length)).toEqual([3, 2]);
    expect(sessions[0]!.startedAt).toEqual(t(0));
    expect(sessions[1]!.startedAt).toEqual(t(60));
  });
  it('treats exactly 30 minutes as the same session', () => {
    expect(
      groupSessions([
        { at: t(0), path: '/a' },
        { at: t(30), path: '/b' },
      ]),
    ).toHaveLength(1);
  });
  it('sorts unsorted input by time', () => {
    const s = groupSessions([
      { at: t(65), path: '/b' },
      { at: t(0), path: '/a' },
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]!.views[0]!.path).toBe('/a');
  });
  it('returns nothing for no views', () => {
    expect(groupSessions([])).toEqual([]);
  });
  it('starts a new session one millisecond past the gap', () => {
    const later = new Date(t(0).getTime() + SESSION_GAP_MS + 1);
    expect(
      groupSessions([
        { at: t(0), path: '/a' },
        { at: later, path: '/b' },
      ]),
    ).toHaveLength(2);
  });
  it('does not reorder the caller array', () => {
    const views = [
      { at: t(65), path: '/b' },
      { at: t(0), path: '/a' },
    ];
    groupSessions(views);
    expect(views.map((v) => v.path)).toEqual(['/b', '/a']);
  });
});

describe('medianDwellMs', () => {
  it('is the median time-to-next-view within a session, last view excluded', () => {
    // gaps: 5, 15 min in session 1; session 2 has one view -> no dwell
    const views = [t(0), t(5), t(20), t(60)].map((at) => ({ at, path: '/x' }));
    expect(medianDwellMs(groupSessions(views))).toBe(10 * 60_000);
  });
  it('is null when no view has a successor', () => {
    expect(medianDwellMs(groupSessions([{ at: t(0), path: '/x' }]))).toBeNull();
  });
  it('takes the odd-count median and sorts gaps numerically, not lexicographically', () => {
    const base = t(0).getTime();
    // gaps 90s / 600s / 120s — as strings these sort "120000","600000","90000"
    const views = [0, 90_000, 690_000, 810_000].map((o) => ({
      at: new Date(base + o),
      path: '/x',
    }));
    expect(medianDwellMs(groupSessions(views))).toBe(120_000);
  });
});

describe('actionFamily', () => {
  it('maps audit actions to the families the dashboard shows', () => {
    expect(actionFamily('program.export_detail_pdf')).toBe('export');
    expect(actionFamily('pdf.generate')).toBe('export');
    expect(actionFamily('cockpit.brief')).toBe('ai-brief');
    expect(actionFamily('scenario.run')).toBe('scenario');
    expect(actionFamily('decision.approve')).toBe('decision');
    expect(actionFamily('program.run_pipeline_bulk')).toBe('pipeline');
    expect(actionFamily('jobthai.batch.upload')).toBe('upload');
    expect(actionFamily('trend_document.upload')).toBe('upload');
    expect(actionFamily('trend_document.from_url')).toBe('upload');
    expect(actionFamily('program.run_digest')).toBe('pipeline');
    expect(actionFamily('scholar.fetch.self')).toBe('pipeline');
    expect(actionFamily('milestone.create')).toBe('decision');
    expect(actionFamily('program.regenerate_narrative')).toBe('ai-brief');
  });
  // `decision.approve` above is illustrative, not a real audit action —
  // approval goes through `POST /decisions/:id/status` (action
  // `decision.status`, body carries the target status). Assert the real
  // spelling too so the `/^decision/` rule is checked against something that
  // actually appears in apps/api/src/decisions/decisions.controller.ts.
  it('maps the real decision-workflow action to the decision family', () => {
    expect(actionFamily('decision.status')).toBe('decision');
  });
  it('returns null for housekeeping actions that are not usage', () => {
    expect(actionFamily('auth.signin.ok')).toBeNull();
    expect(actionFamily('update_theme')).toBeNull();
    expect(actionFamily('impersonation_start')).toBeNull();
  });
  it('buckets anything else as other', () => {
    expect(actionFamily('ai_model_override.set')).toBe('other');
  });
});
