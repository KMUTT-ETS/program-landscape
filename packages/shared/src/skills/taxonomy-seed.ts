// Representative skills taxonomy seed — ~60 entries across the sectors
// the modules 05-12 actually reach into. NOT the full 500 ESCO skills
// (that's a separate data-load chore since ESCO ships as RDF). What's
// here is enough to:
//   - seed the /skills explorer with a non-empty tree
//   - let the course-skill extractor have realistic candidates
//   - give the BCG / S-curve demand-gap analyses a real vocabulary
//
// Structure: 5 top-level categories, 2-3 levels deep. Codes are
// kku-taxonomy-prefixed so they're distinct from ESCO codes when we
// merge real ESCO in.
//
// The seeder in packages/db/prisma/seed.ts iterates this list and
// resolves parent codes → IDs, so the tree can be declared flat.

export type SkillSeedSource = 'KKU' | 'ESCO' | 'TPQI';

export interface SkillSeedEntry {
  code: string;
  nameEn: string;
  nameTh: string;
  category: string;
  parentCode?: string;
  taxonomySource: SkillSeedSource;
}

export const SKILL_TAXONOMY_SEED: SkillSeedEntry[] = [
  // ── Computing & digital (root + subtree) ─────────────────────────────
  { code: 'KKU-CS',        nameEn: 'Computing & digital', nameTh: 'คอมพิวเตอร์และดิจิทัล', category: 'computing', taxonomySource: 'KKU' },
  { code: 'KKU-CS-PROG',   nameEn: 'Programming',           nameTh: 'การเขียนโปรแกรม',        category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-PY',     nameEn: 'Python programming',    nameTh: 'การเขียนโปรแกรมภาษาไพธอน', category: 'computing', parentCode: 'KKU-CS-PROG', taxonomySource: 'KKU' },
  { code: 'KKU-CS-WEB',    nameEn: 'Web development',       nameTh: 'การพัฒนาเว็บ',            category: 'computing', parentCode: 'KKU-CS-PROG', taxonomySource: 'KKU' },
  { code: 'KKU-CS-DSAL',   nameEn: 'Data structures & algorithms', nameTh: 'โครงสร้างข้อมูลและอัลกอริทึม', category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-DB',     nameEn: 'Databases',             nameTh: 'ฐานข้อมูล',              category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-AI',     nameEn: 'Artificial intelligence', nameTh: 'ปัญญาประดิษฐ์',       category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-ML',     nameEn: 'Machine learning',      nameTh: 'การเรียนรู้ของเครื่อง',    category: 'computing', parentCode: 'KKU-CS-AI', taxonomySource: 'KKU' },
  { code: 'KKU-CS-DL',     nameEn: 'Deep learning',         nameTh: 'การเรียนรู้เชิงลึก',       category: 'computing', parentCode: 'KKU-CS-ML', taxonomySource: 'KKU' },
  { code: 'KKU-CS-DATA',   nameEn: 'Data engineering',      nameTh: 'วิศวกรรมข้อมูล',         category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-SEC',    nameEn: 'Cybersecurity',         nameTh: 'ความมั่นคงไซเบอร์',       category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-CLOUD',  nameEn: 'Cloud computing',       nameTh: 'การประมวลผลแบบกลุ่มเมฆ',   category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },
  { code: 'KKU-CS-IOT',    nameEn: 'Internet of Things',    nameTh: 'อินเทอร์เน็ตของสรรพสิ่ง',   category: 'computing', parentCode: 'KKU-CS', taxonomySource: 'KKU' },

  // ── Engineering & manufacturing ─────────────────────────────────────
  { code: 'KKU-ENG',       nameEn: 'Engineering & manufacturing', nameTh: 'วิศวกรรมและการผลิต', category: 'engineering', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-MECH',  nameEn: 'Mechanical engineering', nameTh: 'วิศวกรรมเครื่องกล',       category: 'engineering', parentCode: 'KKU-ENG', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-ELEC',  nameEn: 'Electrical engineering', nameTh: 'วิศวกรรมไฟฟ้า',           category: 'engineering', parentCode: 'KKU-ENG', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-IND',   nameEn: 'Industrial engineering', nameTh: 'วิศวกรรมอุตสาหการ',       category: 'engineering', parentCode: 'KKU-ENG', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-AUTO',  nameEn: 'Automation & robotics',  nameTh: 'ระบบอัตโนมัติและหุ่นยนต์', category: 'engineering', parentCode: 'KKU-ENG', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-MECHATRON', nameEn: 'Mechatronics',       nameTh: 'เมคคาทรอนิกส์',           category: 'engineering', parentCode: 'KKU-ENG-AUTO', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-CAD',   nameEn: 'CAD / CAM',              nameTh: 'การออกแบบด้วยคอมพิวเตอร์', category: 'engineering', parentCode: 'KKU-ENG-MECH', taxonomySource: 'KKU' },
  { code: 'KKU-ENG-CIVIL', nameEn: 'Civil engineering',      nameTh: 'วิศวกรรมโยธา',            category: 'engineering', parentCode: 'KKU-ENG', taxonomySource: 'KKU' },

  // ── Life sciences & health ──────────────────────────────────────────
  { code: 'KKU-LS',        nameEn: 'Life sciences & health', nameTh: 'วิทยาศาสตร์ชีวภาพและสุขภาพ', category: 'life-sciences', taxonomySource: 'KKU' },
  { code: 'KKU-LS-BIO',    nameEn: 'Biology',                nameTh: 'ชีววิทยา',                category: 'life-sciences', parentCode: 'KKU-LS', taxonomySource: 'KKU' },
  { code: 'KKU-LS-MOLBIO', nameEn: 'Molecular biology',      nameTh: 'ชีววิทยาโมเลกุล',          category: 'life-sciences', parentCode: 'KKU-LS-BIO', taxonomySource: 'KKU' },
  { code: 'KKU-LS-GENOM',  nameEn: 'Genomics',               nameTh: 'จีโนมิกส์',                category: 'life-sciences', parentCode: 'KKU-LS-MOLBIO', taxonomySource: 'KKU' },
  { code: 'KKU-LS-MED',    nameEn: 'Medicine',               nameTh: 'แพทยศาสตร์',              category: 'life-sciences', parentCode: 'KKU-LS', taxonomySource: 'KKU' },
  { code: 'KKU-LS-PHARM',  nameEn: 'Pharmacy',               nameTh: 'เภสัชศาสตร์',             category: 'life-sciences', parentCode: 'KKU-LS', taxonomySource: 'KKU' },
  { code: 'KKU-LS-NURSE',  nameEn: 'Nursing',                nameTh: 'การพยาบาล',               category: 'life-sciences', parentCode: 'KKU-LS', taxonomySource: 'KKU' },
  { code: 'KKU-LS-PUBH',   nameEn: 'Public health',          nameTh: 'สาธารณสุข',               category: 'life-sciences', parentCode: 'KKU-LS', taxonomySource: 'KKU' },
  { code: 'KKU-LS-BIOINF', nameEn: 'Bioinformatics',         nameTh: 'ชีวสารสนเทศ',             category: 'life-sciences', parentCode: 'KKU-LS-GENOM', taxonomySource: 'KKU' },

  // ── Agriculture & food ──────────────────────────────────────────────
  // (BCG bioeconomy focus — critical to KKU's regional role)
  { code: 'KKU-AG',        nameEn: 'Agriculture & food',     nameTh: 'เกษตรและอาหาร',           category: 'agriculture', taxonomySource: 'KKU' },
  { code: 'KKU-AG-CROP',   nameEn: 'Crop science',           nameTh: 'วิทยาศาสตร์พืชไร่',        category: 'agriculture', parentCode: 'KKU-AG', taxonomySource: 'KKU' },
  { code: 'KKU-AG-ANIMAL', nameEn: 'Animal science',         nameTh: 'สัตวศาสตร์',              category: 'agriculture', parentCode: 'KKU-AG', taxonomySource: 'KKU' },
  { code: 'KKU-AG-SOIL',   nameEn: 'Soil science',           nameTh: 'ปฐพีวิทยา',               category: 'agriculture', parentCode: 'KKU-AG', taxonomySource: 'KKU' },
  { code: 'KKU-AG-FOOD',   nameEn: 'Food science',           nameTh: 'วิทยาศาสตร์การอาหาร',     category: 'agriculture', parentCode: 'KKU-AG', taxonomySource: 'KKU' },
  { code: 'KKU-AG-FOODPROC', nameEn: 'Food processing',       nameTh: 'การแปรรูปอาหาร',          category: 'agriculture', parentCode: 'KKU-AG-FOOD', taxonomySource: 'KKU' },
  { code: 'KKU-AG-PRECISION', nameEn: 'Precision agriculture', nameTh: 'เกษตรแม่นยำ',            category: 'agriculture', parentCode: 'KKU-AG-CROP', taxonomySource: 'KKU' },

  // ── Business, economy, administration ───────────────────────────────
  { code: 'KKU-BUS',       nameEn: 'Business & economy',     nameTh: 'บริหารธุรกิจและเศรษฐศาสตร์', category: 'business', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-MGT',   nameEn: 'Management',             nameTh: 'การจัดการ',               category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-MKT',   nameEn: 'Marketing',              nameTh: 'การตลาด',                 category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-DIGMKT', nameEn: 'Digital marketing',     nameTh: 'การตลาดดิจิทัล',          category: 'business', parentCode: 'KKU-BUS-MKT', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-FIN',   nameEn: 'Finance',                nameTh: 'การเงิน',                 category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-ACCT',  nameEn: 'Accounting',             nameTh: 'การบัญชี',                category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-ECON',  nameEn: 'Economics',              nameTh: 'เศรษฐศาสตร์',             category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-ENT',   nameEn: 'Entrepreneurship',       nameTh: 'การเป็นผู้ประกอบการ',       category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-PUBADM', nameEn: 'Public administration', nameTh: 'รัฐประศาสนศาสตร์',         category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },
  { code: 'KKU-BUS-HRM',   nameEn: 'Human resource management', nameTh: 'การบริหารทรัพยากรบุคคล', category: 'business', parentCode: 'KKU-BUS', taxonomySource: 'KKU' },

  // ── Education ──────────────────────────────────────────────────────
  { code: 'KKU-EDU',       nameEn: 'Education',              nameTh: 'ศึกษาศาสตร์',             category: 'education', taxonomySource: 'KKU' },
  { code: 'KKU-EDU-PED',   nameEn: 'Pedagogy',               nameTh: 'การสอน',                  category: 'education', parentCode: 'KKU-EDU', taxonomySource: 'KKU' },
  { code: 'KKU-EDU-CURRIC', nameEn: 'Curriculum design',     nameTh: 'การออกแบบหลักสูตร',        category: 'education', parentCode: 'KKU-EDU', taxonomySource: 'KKU' },
  { code: 'KKU-EDU-STEM',  nameEn: 'STEM education',         nameTh: 'การศึกษาวิทยาศาสตร์',      category: 'education', parentCode: 'KKU-EDU', taxonomySource: 'KKU' },

  // ── Cross-cutting / transferable ────────────────────────────────────
  { code: 'KKU-GEN',       nameEn: 'General transferable',   nameTh: 'ทักษะทั่วไป',             category: 'transferable', taxonomySource: 'KKU' },
  { code: 'KKU-GEN-CRIT',  nameEn: 'Critical thinking',      nameTh: 'การคิดวิเคราะห์',          category: 'transferable', parentCode: 'KKU-GEN', taxonomySource: 'KKU' },
  { code: 'KKU-GEN-COMM',  nameEn: 'Communication',          nameTh: 'การสื่อสาร',              category: 'transferable', parentCode: 'KKU-GEN', taxonomySource: 'KKU' },
  { code: 'KKU-GEN-TEAM',  nameEn: 'Teamwork',               nameTh: 'การทำงานเป็นทีม',          category: 'transferable', parentCode: 'KKU-GEN', taxonomySource: 'KKU' },
  { code: 'KKU-GEN-PROJ',  nameEn: 'Project management',     nameTh: 'การบริหารโครงการ',         category: 'transferable', parentCode: 'KKU-GEN', taxonomySource: 'KKU' },
  { code: 'KKU-GEN-RESEARCH', nameEn: 'Research methodology', nameTh: 'ระเบียบวิธีวิจัย',         category: 'transferable', parentCode: 'KKU-GEN', taxonomySource: 'KKU' },

  // ── Thailand-specific / BCG-sector ─────────────────────────────────
  { code: 'KKU-TH-BCG',    nameEn: 'BCG economy',            nameTh: 'เศรษฐกิจ BCG',            category: 'thailand-policy', taxonomySource: 'KKU' },
  { code: 'KKU-TH-BIOECO', nameEn: 'Bio-economy',            nameTh: 'เศรษฐกิจชีวภาพ',           category: 'thailand-policy', parentCode: 'KKU-TH-BCG', taxonomySource: 'KKU' },
  { code: 'KKU-TH-CIRCULAR', nameEn: 'Circular economy',     nameTh: 'เศรษฐกิจหมุนเวียน',        category: 'thailand-policy', parentCode: 'KKU-TH-BCG', taxonomySource: 'KKU' },
  { code: 'KKU-TH-GREEN',  nameEn: 'Green economy',          nameTh: 'เศรษฐกิจสีเขียว',          category: 'thailand-policy', parentCode: 'KKU-TH-BCG', taxonomySource: 'KKU' },
];
