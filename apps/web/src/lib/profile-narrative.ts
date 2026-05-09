// Server-side helper for the profile-page expertise narrative. Wraps
// AiService with the expertise-narrative prompt template + falls
// back to a deterministic placeholder when no LLM key is configured.
//
// Imported only by the /api/profile-narrative route handler — never
// pulled into client code.

import {
  createAiService,
  buildExpertiseNarrativeMessages,
  ExpertiseNarrativeSchema,
  EXPERTISE_NARRATIVE_VERSION,
  type AiProviderId,
  type ExpertiseNarrative,
  type ExpertiseNarrativeInput,
} from '@kku/shared';
import { PrismaAiInferenceRecorder } from '@kku/db';

interface AiCallContext {
  userId: string;
  facultyMemberId: string | null;
}

export async function generateExpertiseNarrative(
  input: ExpertiseNarrativeInput,
  context: AiCallContext,
): Promise<ExpertiseNarrative> {
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const apiKeys = {
    google: process.env.GOOGLE_AI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };
  const hasKey =
    (providerId === 'google' && !!apiKeys.google) ||
    (providerId === 'anthropic' && !!apiKeys.anthropic) ||
    (providerId === 'openrouter' && !!apiKeys.openrouter);

  if (!hasKey) {
    return placeholderNarrative(input);
  }

  const recorder = new PrismaAiInferenceRecorder();
  const ai = createAiService({ recorder, providerId, apiKeys });

  try {
    const result = await ai.extractStructured(
      {
        ctx: {
          module: 'profile',
          kind: 'expertise-narrative',
          userId: context.userId,
        },
        messages: buildExpertiseNarrativeMessages(input),
        methodVersion: EXPERTISE_NARRATIVE_VERSION,
        maxOutputTokens: 1500,
      },
      ExpertiseNarrativeSchema,
    );
    return result.parsed;
  } catch (err) {
    // AI call failed — return the placeholder rather than a 500 so the
    // profile page degrades gracefully. The error is surfaced to the
    // caller through console.error; the AiInference row (if any was
    // started) carries the failure for the audit log.
    console.error('expertise-narrative generation failed', err);
    return placeholderNarrative(input);
  }
}

function placeholderNarrative(input: ExpertiseNarrativeInput): ExpertiseNarrative {
  const themes = inferFallbackThemes(input.publicationTitles);
  const themesTh = themes.length > 0 ? themes.join(', ') : 'ไม่สามารถระบุได้';
  const themesEn = themes.length > 0 ? themes.join(', ') : 'unable to determine';

  const narrativeTh =
    `จากชื่อผลงานตีพิมพ์ ความเชี่ยวชาญที่สังเกตได้ครอบคลุม ${themesTh} ` +
    `(หมายเหตุ: บทสรุปนี้สร้างจากข้อมูลพื้นฐานเท่านั้น เนื่องจากระบบ AI ยังไม่ได้กำหนดค่า — ติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานการสรุปอัตโนมัติ)`;

  const narrativeEn =
    `Based on publication titles, observable expertise spans ${themesEn}. ` +
    `(Note: this summary is generated from basic record data only — the AI service is not yet configured. Contact the system administrator to enable automatic narrative generation.)`;

  return {
    narrativeTh,
    narrativeEn,
    expertiseKeywordsEn: themes.slice(0, 5),
    expertiseKeywordsTh: themes.slice(0, 5),
    confidence: 0,
  };
}

/**
 * Heuristic theme extraction for the no-AI fallback. Looks at the
 * top publication titles for repeated multi-word phrases and surfaces
 * the longest few. NOT a substitute for a real LLM summary — purely
 * a "give the page something to render" placeholder.
 */
function inferFallbackThemes(titles: string[]): string[] {
  if (titles.length === 0) return [];
  const stopwords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'with', 'to',
    'by', 'at', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
    'this', 'that', 'these', 'those', 'using', 'based', 'study', 'analysis',
    'method', 'approach', 'system', 'systems', 'effect', 'effects', 'role',
    'novel', 'new', 'high', 'low',
  ]);
  const counts = new Map<string, number>();
  for (const title of titles.slice(0, 30)) {
    const words = title
      .toLowerCase()
      .replace(/[^a-z\s\-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !stopwords.has(w));
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}
