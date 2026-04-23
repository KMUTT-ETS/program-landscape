// ═════════════════════════════════════════════════════════════════════
// Analyst safety guardrails (prompt 11)
//
// Heuristic-based. A real ML-backed classifier is out of scope for v1.
// Rules here catch the common obvious cases; the system prompt catches
// the rest. Philosophy: fail closed on clear matches, pass through
// borderline cases and let the model's system-prompt-bound behaviour
// handle nuance.
// ═════════════════════════════════════════════════════════════════════

export const ANALYST_SAFETY_VERSION = 'analyst-safety.v1';

export type SafetyCategory =
  | 'personal-info'
  | 'salary-or-performance'
  | 'prompt-injection'
  | 'external-content-request'
  | 'decision-commitment';

export interface SafetyVerdict {
  refuse: boolean;
  categories: SafetyCategory[];
  explanation: string;
  version: typeof ANALYST_SAFETY_VERSION;
}

// Patterns that match clear refuse-categories. Case-insensitive.
const REFUSAL_PATTERNS: Array<{ cat: SafetyCategory; patterns: RegExp[]; explanation: string }> = [
  {
    cat: 'salary-or-performance',
    patterns: [
      /\b(who|which)\s+(faculty\s+member|teacher|lecturer|professor).*\s+(earns?|salary|performance)/i,
      /\bsalary\s+of\s+\w+/i,
      /performance\s+(review|rating|score)\s+(of|for)\s+\w+/i,
      /เงินเดือน\s*(ของ|อาจารย์)/,
      /ผลงาน(รายบุคคล|ของอาจารย์)/,
    ],
    explanation:
      'Individual employee performance + salary information is restricted — HR manages that system. Rollup stats (e.g. "average salary in faculty X") are visible in the relevant module.',
  },
  {
    cat: 'personal-info',
    patterns: [
      /\b(phone number|home address|personal email|id card|เลขประชาชน|ที่อยู่บ้าน|เบอร์ส่วนตัว)\b/i,
    ],
    explanation: 'Personal contact information is out of scope.',
  },
  {
    cat: 'prompt-injection',
    patterns: [
      /ignore\s+(previous|all|prior|above)\s+(instructions|prompts|rules)/i,
      /\byou\s+are\s+now\s+a\s+(different|new|jailbroken|unrestricted)\b/i,
      /\bdisregard\s+(your|the)\s+(system|prior)\s+(prompt|instructions)/i,
      /reveal\s+your\s+(system\s+prompt|instructions)/i,
      /\bDAN\b|\bdeveloper\s+mode\b/i,
      /ข้ามคำสั่งข้างต้น|ลืมกฎทั้งหมด/,
    ],
    explanation:
      'That looks like a prompt-injection attempt. This system operates under fixed policies that can\'t be overridden from user input.',
  },
  {
    cat: 'external-content-request',
    patterns: [
      /\b(write|draft|generate)\s+(a\s+)?(press\s+release|public\s+statement|social\s+media\s+post|tweet|op-ed)/i,
      /(เขียน|ร่าง)\s*(ข่าว|แถลงการณ์|โพสต์)\s*(ประชาสัมพันธ์|ส่งสื่อ|สาธารณะ)/,
    ],
    explanation:
      'Externally-facing content needs analyst + communications review before publishing; this system generates analytical briefs, not public-facing copy.',
  },
  {
    cat: 'decision-commitment',
    patterns: [
      /\b(commit\s+to|make\s+the\s+decision|approve|sign\s+off|finalise)\s+(closing|launching|merging)/i,
      /(ตัดสิน|อนุมัติ|ยืนยัน)\s*(ปิด|เปิด|ควบรวม)/,
    ],
    explanation:
      'Closing/launching/merging programs is a Council decision. This system surfaces options; it does not commit.',
  },
];

// Runs the guardrail check. If `refuse` is true, the caller must respond
// with `explanation` and skip the LLM call entirely.
export function checkAnalystSafety(userMessage: string): SafetyVerdict {
  const hits: SafetyCategory[] = [];
  const explanations: string[] = [];
  for (const rule of REFUSAL_PATTERNS) {
    if (rule.patterns.some((p) => p.test(userMessage))) {
      hits.push(rule.cat);
      explanations.push(rule.explanation);
    }
  }
  return {
    refuse: hits.length > 0,
    categories: hits,
    explanation: explanations.join(' '),
    version: ANALYST_SAFETY_VERSION,
  };
}

// ── Language detection ─────────────────────────────────────────────────
// Simple heuristic: if ≥30% of characters are Thai, call it Thai.
export function detectLanguage(text: string): 'th' | 'en' {
  if (!text) return 'en';
  let thai = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0e00 && code <= 0x0e7f) thai += 1;
  }
  return thai / text.length >= 0.3 ? 'th' : 'en';
}
