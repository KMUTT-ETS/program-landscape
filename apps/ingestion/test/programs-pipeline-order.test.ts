import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Execution order of the per-program pipeline IS the source order of the
// `shouldRun('<phase>')` blocks (there is no dependency graph), so the order is
// asserted on the source: a first run must write the risk assessment before the
// strategic narrative reads it.
const SRC = readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'programs-pipeline.ts'), 'utf8');
const at = (phase: string): number => SRC.indexOf(`if (shouldRun('${phase}')) {`);

describe('programs-pipeline execution order', () => {
  it('runs risk analysis (phase 8) before the strategic narrative (phase 7)', () => {
    expect(at('phase8')).toBeGreaterThan(-1);
    expect(at('phase7')).toBeGreaterThan(-1);
    expect(at('phase8')).toBeLessThan(at('phase7'));
  });
  it('still runs overlap before risk analysis and the narrative last', () => {
    expect(at('phaseOV')).toBeLessThan(at('phase8'));
    expect(at('phase7')).toBeGreaterThan(at('phaseCR'));
  });
});
