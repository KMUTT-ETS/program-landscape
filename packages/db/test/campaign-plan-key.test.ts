import { describe, expect, it } from 'vitest';

import { campaignPlanKey } from '../src/campaign-plan-key';

// Planned seats are summed as MAX(plan) PER RECRUITMENT PROGRAMME, because
// a Thai registrar's export repeats one programme's plan across every
// campaign track it runs — summing them naively multiplies the intake.
//
// A spreadsheet-imported row has no recruitment-programme id: the adopter
// states planned seats on the row itself. So each such row has to be its
// own group, or several campaigns in one year would collapse into the
// largest of them.

describe('campaignPlanKey', () => {
  it('groups rows sharing a recruitment programme id', () => {
    const a = campaignPlanKey({ recruitmentProgramId: 'P100', round: '1', campaignName: 'Regular' });
    const b = campaignPlanKey({ recruitmentProgramId: 'P100', round: '3', campaignName: 'Special' });
    expect(a).toBe(b);
  });

  it('keeps imported rows apart, so their plans both count', () => {
    const a = campaignPlanKey({ recruitmentProgramId: null, round: '1', campaignName: 'Regular' });
    const b = campaignPlanKey({ recruitmentProgramId: null, round: '3', campaignName: 'Special' });
    expect(a).not.toBe(b);
  });

  it('treats one imported campaign re-read as the same group', () => {
    const a = campaignPlanKey({ recruitmentProgramId: null, round: '1', campaignName: 'Regular' });
    const b = campaignPlanKey({ recruitmentProgramId: null, round: '1', campaignName: 'Regular' });
    expect(a).toBe(b);
  });

  it('cannot collide a real id with a synthesised one', () => {
    // A registrar id that happens to look like the fallback's shape must
    // not merge with an imported row.
    const real = campaignPlanKey({ recruitmentProgramId: '1|Regular', round: '1', campaignName: 'Regular' });
    const imported = campaignPlanKey({ recruitmentProgramId: null, round: '1', campaignName: 'Regular' });
    expect(real).not.toBe(imported);
  });
});
