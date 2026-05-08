#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Skill.automationRisk heuristic seed
//
// Pattern-matches Skill.nameEn / Skill.nameTh / Skill.category against three
// buckets (LOW / MEDIUM / HIGH automation risk over a ~10-year horizon).
// Anything that doesn't match a pattern stays UNKNOWN — picked up by the
// AI sweep stage of the risk pipeline (separate script, takes the UNKNOWN
// rows and asks Gemini per-skill for a tier + rationale).
//
// Heuristic source: Frey & Osborne (2013, 2017) "The Future of Employment"
// + WEF "Future of Jobs Report 2023" + ILO sectoral automation studies.
// We deliberately bias toward UNKNOWN over a confident wrong tier — the
// AI sweep is cheap and surfaces edge cases the pattern matcher misses.
//
// HIGH-automation tier (routine cognitive / structured / data-driven):
//   - Data entry, transcription, basic accounting, routine SQL
//   - Document drafting (templated), basic translation
//   - Predictable visual inspection, simple data extraction
//
// LOW-automation tier (judgement / dexterity / interpersonal / creative):
//   - Clinical judgement, surgical procedure, patient-facing care
//   - Leadership, ethics, negotiation, complex coaching
//   - Original research design, novel art creation
//   - High-skill manual dexterity (craft, dental procedure)
//
// MEDIUM-automation tier (partial automation, augmentation likely):
//   - Software engineering (AI augments but doesn't replace yet)
//   - Most engineering design (CAD with AI-assist)
//   - Teaching (course delivery augmented, not replaced)
//   - Diagnostic imaging (AI-assisted reading common already)
//
// Usage:
//   pnpm skills:seed-automation-risk          # apply
//   pnpm skills:seed-automation-risk --dry-run
//   pnpm skills:seed-automation-risk --reset  # reset all to UNKNOWN first
//
// Idempotent. Re-running a second time produces zero updates (every Skill
// already has the heuristic verdict applied).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type AutomationRisk } from '@kku/db';
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const reset = args.has('--reset');

interface Pattern {
  tier: AutomationRisk;
  // English regex (case-insensitive). Matches against nameEn + category.
  en?: RegExp;
  // Thai substring (case-sensitive — Thai has no case). Matches against nameTh.
  th?: string[];
  // Skill category exact match (lowercased).
  cat?: string[];
  reason: string;
}

const PATTERNS: Pattern[] = [
  // ── HIGH automation risk ─────────────────────────────────────────────
  {
    tier: 'HIGH',
    en: /\b(data entry|data\s?entry|typing|transcription|transcribing|word processing)\b/i,
    th: ['การพิมพ์งาน', 'พิมพ์ดีด', 'การถอดเทป'],
    reason: 'Routine clerical — already largely automated by 2025 LLM tools',
  },
  {
    tier: 'HIGH',
    en: /\b(bookkeeping|accounts payable|accounts receivable|payroll processing|tax filing|invoice processing)\b/i,
    th: ['การจัดทำบัญชี', 'การยื่นภาษี', 'งานเอกสารบัญชี'],
    reason: 'Structured accounting workflows — automation-mature',
  },
  {
    tier: 'HIGH',
    en: /\b(basic sql|sql querying|excel formul|spreadsheet|microsoft office|ms\s?office|word processor)\b/i,
    th: ['การใช้โปรแกรม office', 'ไมโครซอฟท์ออฟฟิศ'],
    reason: 'Productivity-tool literacy — table stakes; not a differentiator',
  },
  {
    tier: 'HIGH',
    en: /\b(translation|translating|interpreter)\b/i,
    th: ['การแปลภาษา', 'การแปล'],
    reason: 'Routine translation increasingly automated; specialised legal/medical translation is MEDIUM',
  },
  {
    tier: 'HIGH',
    en: /\b(routine inspection|visual inspection|quality inspection|data labeling|content moderation)\b/i,
    th: ['การตรวจสอบเชิงปริมาณ', 'การตรวจนับ'],
    reason: 'Structured visual / classification work — vision models',
  },
  {
    tier: 'HIGH',
    en: /\b(call cent|customer support|first-line support|help\s?desk|tier\s?1)\b/i,
    th: ['การให้บริการลูกค้าเบื้องต้น', 'คอลเซ็นเตอร์'],
    reason: 'Tier-1 customer support — chatbot maturity',
  },
  {
    tier: 'HIGH',
    en: /\b(content writing|copywriting|blog writing|article writing|social media post)\b/i,
    th: ['การเขียนเนื้อหา', 'คอนเทนต์โซเชียล'],
    reason: 'Generic content writing — LLM-disrupted; brand-strategic writing is MEDIUM',
  },

  // ── MEDIUM automation risk (augmentation, partial replacement) ───────
  {
    tier: 'MEDIUM',
    en: /\b(programming|coding|software engineer|web development|application development|backend|frontend|full\s?stack)\b/i,
    th: ['การเขียนโปรแกรม', 'การพัฒนาซอฟต์แวร์', 'การพัฒนาเว็บ'],
    reason: 'AI coding assistants augment but do not replace; senior engineering judgement holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(graphic design|ui design|ux design|web design|presentation design)\b/i,
    th: ['การออกแบบกราฟิก', 'การออกแบบ ui', 'การออกแบบ ux'],
    reason: 'Generative design tools augment ideation; client/brand judgement holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(financial analysis|financial modeling|investment analysis|portfolio|equity research)\b/i,
    th: ['การวิเคราะห์ทางการเงิน', 'แบบจำลองทางการเงิน'],
    reason: 'Routine FM automated; senior judgement / client-facing advisory holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(marketing|digital marketing|seo|sem|email marketing|advertising|brand)\b/i,
    th: ['การตลาด', 'การตลาดดิจิทัล', 'การตลาดออนไลน์'],
    reason: 'Campaign generation augmented; strategy / brand insight holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(teaching|instruction|lecturing|curriculum design|lesson plan)\b/i,
    th: ['การสอน', 'การจัดการเรียนการสอน', 'การออกแบบหลักสูตร'],
    reason: 'Content delivery augmented (AI tutors); pedagogy + classroom management holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(diagnostic imaging|radiology|medical imaging|pathology imaging|ultrasound interpretation)\b/i,
    th: ['การถ่ายภาพรังสีวินิจฉัย', 'รังสีวินิจฉัย', 'การวินิจฉัยภาพ'],
    reason: 'AI-assisted reading is mature; final diagnostic responsibility remains physician',
  },
  {
    tier: 'MEDIUM',
    en: /\b(legal research|contract review|patent search|due diligence)\b/i,
    th: ['การค้นคว้าทางกฎหมาย', 'การตรวจสอบสัญญา'],
    reason: 'Document review automated; legal strategy / litigation argument holds',
  },
  {
    tier: 'MEDIUM',
    en: /\b(cad|cam|engineering drawing|technical drawing|drafting)\b/i,
    th: ['การเขียนแบบวิศวกรรม', 'การออกแบบด้วยคอมพิวเตอร์'],
    reason: 'Generative CAD tools mature; engineering review and code compliance hold',
  },
  {
    tier: 'MEDIUM',
    en: /\b(machine learning|data science|data analy|data engineer|ml engineer|ai engineer)\b/i,
    th: ['การเรียนรู้ของเครื่อง', 'วิทยาการข้อมูล', 'วิศวกรรมข้อมูล'],
    reason: 'AutoML displaces routine training; novel modelling + production reliability hold',
  },
  {
    tier: 'MEDIUM',
    en: /\b(architecture|architectural design|interior design|landscape architecture)\b/i,
    th: ['สถาปัตยกรรม', 'การออกแบบสถาปัตยกรรม', 'การออกแบบภายใน'],
    reason: 'Generative design tools augment ideation; building code, client and site judgement hold',
  },

  // ── LOW automation risk (judgement-heavy / interpersonal / craft) ────
  {
    tier: 'LOW',
    en: /\b(surgery|surgical|operative procedure|operating theatre|operating room)\b/i,
    th: ['การผ่าตัด', 'ศัลยกรรม', 'ศัลยศาสตร์'],
    reason: 'Real-time tactile + judgement under uncertainty — minimally automatable',
  },
  {
    tier: 'LOW',
    en: /\b(clinical|patient care|nursing care|bedside|patient assessment|clinical reasoning|clinical judg|diagnosis)\b/i,
    th: ['การพยาบาล', 'การดูแลผู้ป่วย', 'การวินิจฉัยทางคลินิก', 'การประเมินผู้ป่วย'],
    reason: 'Patient-facing judgement under uncertainty — ethics + accountability remain human',
  },
  {
    tier: 'LOW',
    en: /\b(dental|dentistry|prosthodont|orthodont|endodont|periodont)\b/i,
    th: ['ทันตกรรม', 'ทันตแพทยศาสตร์', 'ทันตกรรมจัดฟัน', 'ทันตกรรมประดิษฐ์'],
    reason: 'Tactile dental procedures — limited automation horizon',
  },
  {
    tier: 'LOW',
    en: /\b(physiotherap|physical therap|occupational therap|rehabilitation)\b/i,
    th: ['กายภาพบำบัด', 'กิจกรรมบำบัด', 'การฟื้นฟูสมรรถภาพ'],
    reason: 'Hands-on rehabilitation — minimal automation horizon',
  },
  {
    tier: 'LOW',
    en: /\b(veterinary|animal care|veterinarian)\b/i,
    th: ['สัตวแพทย์', 'การดูแลสัตว์'],
    reason: 'Animal handling + judgement — limited automation',
  },
  {
    tier: 'LOW',
    en: /\b(leadership|executive|strategic management|organisational change|organizational change|change management)\b/i,
    th: ['ภาวะผู้นำ', 'การบริหารเชิงกลยุทธ์', 'การจัดการการเปลี่ยนแปลง'],
    reason: 'Senior leadership requires accountability + organisational politics — irreducibly human',
  },
  {
    tier: 'LOW',
    en: /\b(ethics|professional ethics|research ethics|bioethics|legal ethics)\b/i,
    th: ['จริยธรรม', 'จรรยาบรรณวิชาชีพ', 'จริยธรรมการวิจัย'],
    reason: 'Ethical reasoning + accountability — irreducibly human',
  },
  {
    tier: 'LOW',
    en: /\b(counsel|psychotherap|mental health|psychological assessment|child psychology)\b/i,
    th: ['การให้คำปรึกษา', 'จิตบำบัด', 'สุขภาพจิต'],
    reason: 'Therapeutic alliance + interpersonal judgement — irreducibly human',
  },
  {
    tier: 'LOW',
    en: /\b(negotiat|conflict resolution|mediation|diplomatic)\b/i,
    th: ['การเจรจาต่อรอง', 'การไกล่เกลี่ย', 'การทูต'],
    reason: 'High-stakes interpersonal negotiation — irreducibly human',
  },
  {
    tier: 'LOW',
    en: /\b(craft|artisan|fine art|sculptur|painting|original composition)\b/i,
    th: ['ศิลปกรรม', 'หัตถกรรม', 'งานศิลปะดั้งเดิม', 'การประพันธ์ดั้งเดิม'],
    reason: 'Original creative work + craft tradition — augmentation only',
  },
  {
    tier: 'LOW',
    en: /\b(field research|ethnograph|qualitative research|participant observation|action research)\b/i,
    th: ['การวิจัยภาคสนาม', 'การวิจัยเชิงคุณภาพ'],
    reason: 'Fieldwork + interpretive judgement — irreducibly human',
  },
  {
    tier: 'LOW',
    en: /\b(agricultur|farm|crop management|livestock|aquacultur|fishery|forestry|silvicultur)\b/i,
    th: ['การเกษตร', 'การปลูกพืช', 'การเลี้ยงสัตว์', 'การประมง', 'การป่าไม้'],
    reason: 'Field operations + biological judgement — partial mechanisation but supervision human',
  },
];

interface Verdict {
  tier: AutomationRisk;
  reason: string;
}

function classify(skill: { nameEn: string; nameTh: string; category: string | null }): Verdict | null {
  for (const p of PATTERNS) {
    if (p.en && (p.en.test(skill.nameEn) || (skill.category && p.en.test(skill.category)))) {
      return { tier: p.tier, reason: p.reason };
    }
    if (p.th && p.th.some((needle) => skill.nameTh.includes(needle))) {
      return { tier: p.tier, reason: p.reason };
    }
    if (p.cat && skill.category && p.cat.includes(skill.category.toLowerCase())) {
      return { tier: p.tier, reason: p.reason };
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`[seed-automation-risk] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}${reset ? ' (resetting first)' : ''}`);

  if (reset && !dryRun) {
    const r = await prisma.skill.updateMany({ data: { automationRisk: 'UNKNOWN' } });
    console.log(`[seed-automation-risk] reset ${r.count} skills to UNKNOWN`);
  }

  const skills = await prisma.skill.findMany({
    select: { id: true, code: true, nameEn: true, nameTh: true, category: true, automationRisk: true },
  });

  const buckets: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number } = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    UNKNOWN: 0,
  };
  let updated = 0;
  let unchanged = 0;
  const samples: { LOW: string[]; MEDIUM: string[]; HIGH: string[]; UNKNOWN: string[] } = {
    LOW: [],
    MEDIUM: [],
    HIGH: [],
    UNKNOWN: [],
  };

  for (const s of skills) {
    const verdict = classify(s);
    if (!verdict) {
      buckets.UNKNOWN += 1;
      if (samples.UNKNOWN.length < 8) samples.UNKNOWN.push(s.nameEn);
      continue;
    }
    if (verdict.tier === 'UNKNOWN') {
      // Defensive — patterns never emit UNKNOWN, but the type permits it.
      buckets.UNKNOWN += 1;
      continue;
    }
    buckets[verdict.tier] += 1;
    const tierSamples = samples[verdict.tier];
    if (tierSamples.length < 5) tierSamples.push(s.nameEn);

    if (s.automationRisk === verdict.tier) {
      unchanged += 1;
      continue;
    }

    if (!dryRun) {
      await prisma.skill.update({
        where: { id: s.id },
        data: { automationRisk: verdict.tier },
      });
    }
    updated += 1;
  }

  console.log('');
  console.log(`[seed-automation-risk] total skills:  ${skills.length}`);
  console.log(`[seed-automation-risk] LOW:           ${buckets.LOW}    e.g. ${samples.LOW.slice(0, 3).join(', ')}`);
  console.log(`[seed-automation-risk] MEDIUM:        ${buckets.MEDIUM}    e.g. ${samples.MEDIUM.slice(0, 3).join(', ')}`);
  console.log(`[seed-automation-risk] HIGH:          ${buckets.HIGH}    e.g. ${samples.HIGH.slice(0, 3).join(', ')}`);
  console.log(`[seed-automation-risk] UNKNOWN:       ${buckets.UNKNOWN}    e.g. ${samples.UNKNOWN.slice(0, 5).join(', ')}`);
  console.log('');
  console.log(`[seed-automation-risk] updated:       ${updated}`);
  console.log(`[seed-automation-risk] unchanged:     ${unchanged}`);
  if (dryRun) {
    console.log(`[seed-automation-risk] (dry-run — no changes written; rerun without --dry-run to apply)`);
  }
  console.log('');
  console.log(`[seed-automation-risk] UNKNOWN rows will be picked up by the AI sweep stage of the risk pipeline.`);
}

main()
  .catch((err) => {
    console.error('[seed-automation-risk] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
