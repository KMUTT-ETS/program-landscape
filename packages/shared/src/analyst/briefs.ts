// ═════════════════════════════════════════════════════════════════════
// Pre-built Council briefs (prompt 11)
//
// Each brief is a templated agent prompt that routes to the tool-use
// executor. The analyst service wraps the result into a Scenario Pack
// PDF via existing templates so the output is Council-ready from day one.
// ═════════════════════════════════════════════════════════════════════

export const ANALYST_BRIEFS_VERSION = 'analyst-briefs.v1';

export interface BriefTemplate {
  slug: string;
  // UI-facing English label.
  name: string;
  descriptionEn: string;
  descriptionTh: string;
  // The prompt given to the tool-use agent. Agent expands with tool calls
  // to fill in specifics. Language: agent answers in Thai (these briefs
  // are Council-facing and Council works primarily in Thai).
  prompt: string;
  // Which tools the agent should strongly prefer for this brief.
  preferredTools: string[];
  // Which PDF template to render the result as.
  pdfTemplate: 'council-pack' | 'scenario-pack' | 'weekly-trend-digest' | 'program-brief';
  // Whether this brief needs a scope/scopeId parameter at invocation time.
  requiresScopeArg: boolean;
}

export const ANALYST_BRIEFS: BriefTemplate[] = [
  {
    slug: 'state-of-the-portfolio',
    name: 'State of the portfolio — current quarter',
    descriptionEn: 'Full-portfolio health snapshot with dimension scores, trends, and call-outs for Council.',
    descriptionTh: 'ภาพรวมสุขภาพของพอร์ตหลักสูตรทั้งหมดของ KKU — คะแนน 5 มิติ แนวโน้ม และประเด็นเด่น',
    prompt:
      'สร้างรายงาน "State of the KKU Portfolio" ประจำไตรมาสปัจจุบัน ให้ครอบคลุม (1) สุขภาพโดยรวมของ 297 หลักสูตรด้วย health-score 5 มิติ, (2) ค่าผิดปกติ 5 อันดับ (ทั้งสูงและต่ำ), (3) แนวโน้มที่น่าสนใจในช่วง 90 วันล่าสุด, (4) สัญญาณเตือน 3 อย่าง. เรียกใช้เครื่องมือเพื่อดึงตัวเลขจริง ไม่แต่งขึ้น',
    preferredTools: ['query_programs', 'query_trends', 'query_gaps', 'get_methodology'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: false,
  },
  {
    slug: 'programs-at-risk',
    name: 'Programs at risk — Council pre-read',
    descriptionEn: 'Bottom 10 programs by health score with drivers + recommended interventions.',
    descriptionTh: 'หลักสูตร 10 รายการที่มีความเสี่ยงสูงสุด พร้อมสาเหตุและแนวทางการปรับ',
    prompt:
      'แสดง 10 หลักสูตรที่มี health-score ต่ำสุด เรียงลำดับ. สำหรับแต่ละหลักสูตร อธิบาย (1) คะแนนแต่ละมิติ, (2) ตัวขับเคลื่อนหลักของความเสี่ยง, (3) เครื่องมือ run_quick_scenario เพื่อจำลองผลหากลดจำนวนรับลง 30%. จบด้วย option A (ลด intake), option B (เปลี่ยนแปลงหลักสูตร), option C (ควบรวม)',
    preferredTools: ['query_programs', 'get_program', 'run_quick_scenario'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: false,
  },
  {
    slug: 'top-strategic-opportunities',
    name: 'Top 5 strategic opportunities this year',
    descriptionEn: 'AI-ranked opportunities synthesising gap data + trends + peer benchmarks.',
    descriptionTh: '5 โอกาสเชิงกลยุทธ์สูงสุดประจำปีจากการวิเคราะห์ช่องว่างและแนวโน้ม',
    prompt:
      'รวบรวมโอกาสเชิงกลยุทธ์ 5 อันดับแรกของ KKU ปีนี้ โดยอ้างอิงข้อมูลจาก query_gaps (dimension=opportunities), query_trends, และ compare_peers. สำหรับแต่ละโอกาส: (1) ขนาดความต้องการ, (2) ความสอดคล้องกับจุดแข็ง KKU, (3) ความเป็นไปได้ในการลงทุน, (4) risk ที่ต้องจับตา',
    preferredTools: ['query_gaps', 'query_trends', 'compare_peers'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: false,
  },
  {
    slug: 'faculty-scorecard',
    name: 'Faculty-level scorecard',
    descriptionEn: 'Scope-aware scorecard for one faculty — programs, health, trends, peers.',
    descriptionTh: 'scorecard ระดับคณะ — หลักสูตร สุขภาพ แนวโน้ม คู่เทียบ',
    prompt:
      'สร้าง scorecard สำหรับคณะที่ระบุ (scope=faculty, scopeId=<id>). ให้ครอบคลุม (1) จำนวนหลักสูตร + แนวโน้มรับเข้าศึกษา 5 ปี, (2) health-score ระดับคณะ, (3) คู่เทียบ ASEAN 3 มหาวิทยาลัย, (4) trend signals ที่กระทบคณะนี้ 90 วันล่าสุด',
    preferredTools: ['query_programs', 'query_trends', 'compare_peers', 'get_program'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: true,
  },
  {
    slug: 'demographic-stress',
    name: 'Demographic stress test summary',
    descriptionEn: 'What happens to the portfolio under Thailand\'s 2030 18–22 cohort projection.',
    descriptionTh: 'สรุปผลการทดสอบความเครียดทางประชากร (cohort 18-22 ปี ในปี 2030)',
    prompt:
      'สรุปผลการทดสอบความเครียดทางประชากร ใช้ run_quick_scenario kind=rebalance พร้อม assumptions.demographicShockPct=-0.1 (5 ปี). ระบุ (1) โปรแกรมที่ได้รับผลกระทบรุนแรงที่สุด, (2) delta รายได้รวม + กำไรสุทธิ, (3) Monte Carlo 80% band, (4) 3 option สำหรับ Council',
    preferredTools: ['run_quick_scenario', 'query_programs', 'get_methodology'],
    pdfTemplate: 'scenario-pack',
    requiresScopeArg: false,
  },
  {
    slug: 'northeast-strategic-alignment',
    name: 'Northeast Thailand strategic alignment',
    descriptionEn: 'How KKU\'s portfolio aligns with Northeast (Isaan) development priorities.',
    descriptionTh: 'ความสอดคล้องของพอร์ตหลักสูตร KKU กับยุทธศาสตร์ภาคอีสาน',
    prompt:
      'วิเคราะห์ความสอดคล้องของหลักสูตร KKU กับยุทธศาสตร์ภาคอีสาน ใช้ query_gaps (region=Northeast), query_trends (signalType=POLICY), และ search_policy_docs สำหรับนโยบาย NESDC/NXPO ที่กล่าวถึงอีสาน. สรุป (1) จุดแข็งที่สอดคล้อง, (2) ช่องว่างที่ควรเติม, (3) นโยบายที่ควรติดตาม',
    preferredTools: ['query_gaps', 'query_trends', 'search_policy_docs'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: false,
  },
  {
    slug: 'sector-deep-dive',
    name: 'Sector deep-dive (BCG / S-curve)',
    descriptionEn: '1-page deep dive per BCG or S-curve sector.',
    descriptionTh: 'การวิเคราะห์เชิงลึก 1 หน้าต่อภาค BCG หรือ S-curve',
    prompt:
      'สร้างบทวิเคราะห์เชิงลึก 1 หน้าสำหรับภาคที่ระบุ. ใช้ query_gaps (dimension=sectors) และ query_trends. ให้ครอบคลุม (1) ตัวชี้วัด headline, (2) ความคืบหน้า 3 ปี, (3) หลักสูตร KKU ที่เกี่ยวข้อง, (4) นโยบาย/แนวโน้มล่าสุด 3 ชิ้น',
    preferredTools: ['query_gaps', 'query_trends', 'query_programs', 'search_policy_docs'],
    pdfTemplate: 'council-pack',
    requiresScopeArg: false,
  },
];

export function getBriefTemplate(slug: string): BriefTemplate | undefined {
  return ANALYST_BRIEFS.find((b) => b.slug === slug);
}
