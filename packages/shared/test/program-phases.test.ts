import { describe, it, expect } from 'vitest';
import {
  formatPhaseCost,
  isProgramPipelinePhase,
  PROGRAM_PHASE_META,
  PROGRAM_PIPELINE_PHASES,
} from '../src/pipeline/program-phases';

// Guard suite for the phase list. The failure this protects against is not
// theoretical: `phaseRE` existed in the pipeline script and in NONE of the
// four other hand-maintained copies for its entire lifetime, so it never ran
// from the admin UI. A phase present in the list but missing from the metadata
// renders as a blank checkbox; metadata for a phase that no longer exists is
// dead weight that quietly lies about what the pipeline can do.
describe('PROGRAM_PIPELINE_PHASES / PROGRAM_PHASE_META', () => {
  it('has metadata for exactly the declared phases — no more, no fewer', () => {
    expect(Object.keys(PROGRAM_PHASE_META).sort()).toEqual(
      [...PROGRAM_PIPELINE_PHASES].sort(),
    );
  });

  it('declares each phase exactly once', () => {
    expect(new Set(PROGRAM_PIPELINE_PHASES).size).toBe(PROGRAM_PIPELINE_PHASES.length);
  });

  it('gives every phase a non-empty label, short label and detail', () => {
    for (const phase of PROGRAM_PIPELINE_PHASES) {
      const meta = PROGRAM_PHASE_META[phase];
      expect(meta.label, `${phase}.label`).not.toBe('');
      expect(meta.shortLabel, `${phase}.shortLabel`).not.toBe('');
      expect(meta.detail, `${phase}.detail`).not.toBe('');
      expect(meta.approxCostUsd, `${phase}.approxCostUsd`).toBeGreaterThanOrEqual(0);
    }
  });

  it('still carries phaseRE and phaseCR — the pair that drifted', () => {
    expect(PROGRAM_PIPELINE_PHASES).toContain('phaseRE');
    expect(PROGRAM_PIPELINE_PHASES).toContain('phaseCR');
    // phaseCR reads the row phaseRE writes; the pickers convey that with a note
    // instead of a dependency engine, so losing the note loses the warning.
    expect(PROGRAM_PHASE_META.phaseCR.dependencyHint).toBeTruthy();
  });

  it('places phaseOV after the narrative and before risk, with its prep hint', () => {
    const i = PROGRAM_PIPELINE_PHASES.indexOf('phaseOV');
    expect(PROGRAM_PIPELINE_PHASES[i - 1]).toBe('phase7');
    expect(PROGRAM_PIPELINE_PHASES[i + 1]).toBe('phase8');
    expect(PROGRAM_PHASE_META.phaseOV.shortLabel).toBe('Programme overlap');
    expect(PROGRAM_PHASE_META.phaseOV.dependencyHint).toMatch(/overlap-prep/);
  });

  it('narrows only real phase ids', () => {
    expect(isProgramPipelinePhase('phaseRE')).toBe(true);
    expect(isProgramPipelinePhase('phase1')).toBe(true);
    expect(isProgramPipelinePhase('notaphase')).toBe(false);
    expect(isProgramPipelinePhase('')).toBe(false);
    expect(isProgramPipelinePhase('PHASE1')).toBe(false);
  });

  it('formats costs the way the launcher has always rendered them', () => {
    expect(formatPhaseCost(0)).toBe('free');
    expect(formatPhaseCost(0.04)).toBe('~$0.04');
    expect(formatPhaseCost(0.2)).toBe('~$0.20');
    expect(formatPhaseCost(0.3)).toBe('~$0.30');
  });
});
