// Task 7 stub — Task 8 replaces the bodies with the real per-field signal
// mapping (global skill growth via KMITL, trend signals via affected
// programmes / new initiatives). The shapes are the contract `gap-map.ts`
// already consumes, so filling them in is body-only.

export interface FieldGlobalSignal {
  skills: Array<{ skillId: string; nameEn: string; nameTh: string; growthPct: number }>;
  scope: 'THAILAND' | 'GLOBAL' | null;
}

export interface FieldTrendSignal {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}

export async function globalSignalForFields(
  _fieldIds: string[],
  _occupationIdsByField: Map<string, string[]>,
): Promise<Map<string, FieldGlobalSignal>> {
  return new Map();
}

export async function trendSignalsForFields(
  _fields: Array<{ fieldId: string; programIds: string[]; occupationNames: string[] }>,
): Promise<Map<string, FieldTrendSignal[]>> {
  return new Map();
}
