// Small Thai -> English glossary for faculty, department and programme names.
//
// `translate(text)` returns an English string, or null when any part of the text is
// not covered. English output never contains Thai characters; callers use a neutral
// placeholder on null. Thai compounds are head-first ("วิศวกรรม" + "คอมพิวเตอร์"),
// English head-last, so the words of one clause are reversed.

const WORDS: Record<string, string> = {
    // head nouns / fields
    'วิศวกรรม': 'Engineering', 'วิศวกรรมศาสตร์': 'Engineering', 'วิทยาศาสตร์': 'Science',
    'เทคโนโลยี': 'Technology', 'สถาปัตยกรรมศาสตร์': 'Architecture', 'สถาปัตยกรรม': 'Architecture',
    'บริหารธุรกิจ': 'Business Administration', 'การบัญชี': 'Accounting', 'บัญชี': 'Accounting',
    'เศรษฐศาสตร์': 'Economics', 'นิติศาสตร์': 'Law', 'รัฐศาสตร์': 'Political Science',
    'รัฐประศาสนศาสตร์': 'Public Administration', 'มนุษยศาสตร์': 'Humanities',
    'สังคมศาสตร์': 'Social Sciences', 'ศึกษาศาสตร์': 'Education', 'ครุศาสตร์': 'Education',
    'เกษตรศาสตร์': 'Agriculture', 'แพทยศาสตร์': 'Medicine', 'ทันตแพทยศาสตร์': 'Dentistry',
    'เภสัชศาสตร์': 'Pharmacy', 'พยาบาลศาสตร์': 'Nursing', 'สาธารณสุขศาสตร์': 'Public Health',
    'สัตวแพทยศาสตร์': 'Veterinary Medicine', 'เทคนิคการแพทย์': 'Medical Technology',
    'ศิลปกรรมศาสตร์': 'Fine and Applied Arts', 'ศิลปศาสตร์': 'Liberal Arts',
    'ศิลปะ': 'Arts', 'การออกแบบ': 'Design', 'ออกแบบ': 'Design', 'ภูมิสถาปัตยกรรม': 'Landscape Architecture',
    'การจัดการ': 'Management', 'จัดการ': 'Management', 'การตลาด': 'Marketing',
    'การเงิน': 'Finance', 'การท่องเที่ยว': 'Tourism', 'การโรงแรม': 'Hotel', 'โลจิสติกส์': 'Logistics',
    'นิเทศศาสตร์': 'Communication Arts', 'การสื่อสาร': 'Communication', 'สื่อสาร': 'Communication',
    'สารสนเทศ': 'Information', 'สารสนเทศศาสตร์': 'Information Science', 'ข้อมูล': 'Data',
    'วิทยาการ': 'Science', 'วิทยาการคอมพิวเตอร์': 'Computer Science', 'คอมพิวเตอร์': 'Computer',
    'ปัญญาประดิษฐ์': 'Artificial Intelligence', 'ซอฟต์แวร์': 'Software', 'เครือข่าย': 'Network',
    'ไซเบอร์': 'Cyber', 'ความมั่นคง': 'Security', 'สถิติ': 'Statistics', 'คณิตศาสตร์': 'Mathematics',
    'ฟิสิกส์': 'Physics', 'เคมี': 'Chemistry', 'ชีววิทยา': 'Biology', 'ชีวเคมี': 'Biochemistry',
    'จุลชีววิทยา': 'Microbiology', 'ชีวภาพ': 'Biological', 'ชีวการแพทย์': 'Biomedical',
    'สิ่งแวดล้อม': 'Environmental', 'พลังงาน': 'Energy', 'ทดแทน': 'Renewable',
    'วัสดุ': 'Materials', 'โลหะ': 'Metallurgical', 'ปิโตรเลียม': 'Petroleum', 'ธรณีวิทยา': 'Geology',
    'ภูมิศาสตร์': 'Geography', 'จิตวิทยา': 'Psychology', 'สังคมวิทยา': 'Sociology',
    'มานุษยวิทยา': 'Anthropology', 'ประวัติศาสตร์': 'History', 'ปรัชญา': 'Philosophy',
    'ภาษา': 'Language', 'ภาษาอังกฤษ': 'English', 'ภาษาไทย': 'Thai', 'ภาษาจีน': 'Chinese',
    'ภาษาญี่ปุ่น': 'Japanese', 'ภาษาเกาหลี': 'Korean', 'วรรณคดี': 'Literature', 'วรรณกรรม': 'Literature',
    'บรรณารักษศาสตร์': 'Library Science', 'ดนตรี': 'Music', 'นาฏศิลป์': 'Dance', 'ศิลปะการแสดง': 'Performing Arts',
    'ภาพยนตร์': 'Film', 'ภาพเคลื่อนไหว': 'Animation', 'มีเดียอาตส์': 'Media Arts', 'มีเดีย': 'Media',
    'ดิจิทัล': 'Digital', 'นวัตกรรม': 'Innovation', 'กราฟิก': 'Graphic', 'เกม': 'Game',
    // engineering fields
    'ไฟฟ้า': 'Electrical', 'เครื่องกล': 'Mechanical', 'โยธา': 'Civil', 'เคมีวิศวกรรม': 'Chemical',
    'อุตสาหการ': 'Industrial', 'อุตสาหกรรม': 'Industrial', 'อิเล็กทรอนิกส์': 'Electronics',
    'โทรคมนาคม': 'Telecommunication', 'สื่อสารโทรคมนาคม': 'Telecommunication', 'ไฟฟ้าสื่อสาร': 'Electrical Communication',
    'เมคคาทรอนิกส์': 'Mechatronics', 'หุ่นยนต์': 'Robotics', 'อัตโนมัติ': 'Automation',
    'ควบคุม': 'Control', 'เครื่องมือวัด': 'Instrumentation', 'เครื่องมือ': 'Instrument', 'วัด': 'Measurement',
    'ระบบ': 'System', 'ระบบไฟฟ้า': 'Electrical System', 'กำลัง': 'Power', 'การผลิต': 'Production',
    'ผลิต': 'Production', 'ยานยนต์': 'Automotive', 'อากาศยาน': 'Aerospace', 'การบิน': 'Aviation',
    'เหมืองแร่': 'Mining', 'ทรัพยากร': 'Resources', 'ธรณี': 'Geo', 'สำรวจ': 'Survey', 'ชลประทาน': 'Irrigation',
    'ขนส่ง': 'Transportation', 'การก่อสร้าง': 'Construction', 'ก่อสร้าง': 'Construction',
    'อาหาร': 'Food', 'การเกษตร': 'Agricultural', 'เกษตร': 'Agricultural', 'พืช': 'Plant', 'สัตว์': 'Animal',
    'ประมง': 'Fisheries', 'ป่าไม้': 'Forestry', 'อุตสาหกรรมเกษตร': 'Agro-Industry',
    'กีฬา': 'Sports', 'การกีฬา': 'Sports', 'สุขภาพ': 'Health', 'การแพทย์': 'Medical', 'ทางการแพทย์': 'Medical',
    'กายภาพบำบัด': 'Physical Therapy', 'รังสี': 'Radiology', 'สาธารณสุข': 'Public Health',
    'ชุมชน': 'Community', 'การพัฒนา': 'Development', 'พัฒนา': 'Development', 'ประยุกต์': 'Applied',
    'ศาสตร์': 'Science', 'เทคนิค': 'Technical', 'เทคโนโลยีสารสนเทศ': 'Information Technology',
    'อุตสาหกรรมบริการ': 'Service Industry', 'บริการ': 'Service', 'ธุรกิจ': 'Business', 'บริหาร': 'Administration',
    'การศึกษา': 'Education', 'ปฐมวัย': 'Early Childhood', 'ประถมศึกษา': 'Primary', 'มัธยมศึกษา': 'Secondary',
    'นานาชาติ': 'International', 'ระหว่างประเทศ': 'International', 'ความสัมพันธ์': 'Relations',
    'อุตสาหกรรมและเทคโนโลยี': 'Industrial Technology', 'สหกิจศึกษา': 'Cooperative Education',
    'ทั่วไป': 'General', 'พื้นฐาน': 'Basic', 'สังคม': 'Social', 'วัฒนธรรม': 'Culture', 'ท้องถิ่น': 'Local',
    'การสอน': 'Teaching', 'สอน': 'Teaching', 'แนะแนว': 'Guidance', 'การวัดผล': 'Assessment',
    'ธุรกิจดิจิทัล': 'Digital Business', 'การค้า': 'Trade', 'การพาณิชย์': 'Commerce',
    'นิติ': 'Legal', 'ระบบสารสนเทศ': 'Information Systems', 'เรขศิลป์': 'Graphic Arts', 'ผลิตภัณฑ์': 'Product',
    'แฟชั่น': 'Fashion', 'สิ่งทอ': 'Textile', 'เซรามิก': 'Ceramics', 'พลาสติก': 'Plastics', 'ยาง': 'Rubber',
    'ภายใน': 'Interior', 'ผังเมือง': 'Urban Planning', 'ชีวสารสนเทศ': 'Bioinformatics',
    'การวิจัย': 'Research', 'วิจัย': 'Research', 'การดูแล': 'Care', 'ผู้สูงอายุ': 'Elderly',
    'แพทย์': 'Medical', 'แผนไทย': 'Thai Traditional Medicine', 'ประยุกต์ทางการแพทย์': 'Applied Medical',
    'ทัศนศิลป์': 'Visual Arts', 'ศิลปกรรม': 'Fine Arts', 'วิชาชีพ': 'Professional',
};
// whole phrases that are not compositional
const PHRASES: Record<string, string> = {
    'วิทยาลัยนานาชาติ': 'International College',
    'วิทยาลัยการคอมพิวเตอร์': 'College of Computing',
    'วิทยาลัยการปกครองท้องถิ่น': 'College of Local Administration',
    'วิทยาลัยการบิน': 'College of Aviation',
    'หลักสูตรนานาชาติ': 'International Programme',
    'หลักสูตรภาษาอังกฤษ': 'English Programme',
    'หลักสูตรภาษาไทย': 'Thai Programme',
};
const ALL: Record<string, string> = { ...WORDS, ...PHRASES };
// Longest first so a compound wins over its parts; ties broken alphabetically for determinism.
const KEYS: string[] = Object.keys(ALL).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
const THAI = /[\u0e00-\u0e7f]/;
const SPLIT = /(\s+|[()\-\u2013/]|และ)/;

export function hasThai(s: string): boolean {
  return THAI.test(s);
}

/** One clause with no spaces, parentheses, hyphens or `และ`. */
function segment(seg: string): string | null {
  const chars = Array.from(seg);
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const rest = chars.slice(i).join('');
    const key = KEYS.find((k) => rest.startsWith(k));
    if (key !== undefined) {
      out.push(ALL[key]!);
      i += Array.from(key).length;
      continue;
    }
    if (hasThai(chars[i]!)) return null;
    let j = i;
    while (j < chars.length && !hasThai(chars[j]!)) {
      const tail = chars.slice(j).join('');
      if (KEYS.some((k) => tail.startsWith(k))) break;
      j++;
    }
    out.push(chars.slice(i, j).join(''));
    i = j;
  }
  // collapse repeats such as "Engineering" + "Engineering"
  const res: string[] = [];
  for (const w of out) if (res.length === 0 || res[res.length - 1] !== w) res.push(w);
  return res.reverse().join(' ');
}

export function translate(textIn: string): string | null {
  const text = textIn.trim();
  if (!text) return null;
  if (Object.prototype.hasOwnProperty.call(PHRASES, text)) return PHRASES[text]!;
  const out: string[] = [];
  for (const p of text.split(SPLIT)) {
    if (p === '' || /^\s+$/.test(p)) continue;
    if (p === 'และ') out.push('and');
    else if (p === '(' || p === ')') out.push(p);
    else if (p === '-' || p === '\u2013') out.push('-');
    else if (p === '/') out.push('/');
    else {
      const t = PHRASES[p] ?? segment(p);
      if (t === null) return null;
      out.push(t);
    }
  }
  let s = '';
  for (const tok of out) {
    if (tok === '(') s += (s ? ' ' : '') + '(';
    else if (tok === ')') s += ')';
    else if (tok === '-' || tok === '/') s += ` ${tok} `;
    else if (!s || s.endsWith('(') || s.endsWith(' - ') || s.endsWith(' / ')) s += tok;
    else s += ' ' + tok;
  }
  return s.split(/\s+/).filter(Boolean).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
}

export function facultyEn(nameTh: string): string | null {
  const prefixes: Array<[string, string]> = [
    ['คณะ', 'Faculty of '],
    ['วิทยาลัย', 'College of '],
    ['สำนักวิชา', 'School of '],
    ['สถาบัน', 'Institute of '],
  ];
  if (Object.prototype.hasOwnProperty.call(PHRASES, nameTh)) return PHRASES[nameTh]!;
  for (const [prefix, en] of prefixes) {
    if (nameTh.startsWith(prefix)) {
      const rest = translate(nameTh.slice(prefix.length));
      return rest === null ? null : en + rest;
    }
  }
  return translate(nameTh);
}
