import type {
  ExtractionRecord,
  PdfContext,
  PdfExtractor,
  PdfSourceCategory,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// Real Thai-text curriculum extractor for KKU มคอ.2 documents.
//
// pdfjs-dist's Thai-text extraction varies wildly by font. Some render
// tone marks ("ข้อมูล"), others flatten them ("ขอมูล"), and some split
// digit glyphs ("25 6 5"). To keep the regex set tractable we normalize
// the text ONCE (strip tone marks U+0E47..U+0E4E; collapse digit spaces;
// collapse whitespace) and author patterns against the normalized form
// via a `thRe` helper that applies the same tone-mark stripping to the
// pattern source — so Thai literals in code stay readable but match both
// font variants.
//
// Emits a CURRICULUM_SPEC payload compatible with the widened schema in
// @kku/shared. Method version `heuristic-v1`.
// ─────────────────────────────────────────────────────────────────────────

// Strip Thai tone marks + thanthakhat from a pattern source so `thRe`
// matches against normalized text. Range U+0E47..U+0E4E covers mai ek/
// tho/tri/chattawa/thanthakhat/nikhahit/yamakkan — the set pdfjs drops.
function thRe(src: string, flags?: string): RegExp {
  return new RegExp(src.replace(/[็-๎]/g, ''), flags);
}

function normalizeThaiText(raw: string): string {
  return raw
    .replace(/[็-๎]/g, '') // tone marks + thanthakhat
    // pdfjs sometimes maps unrecognised Thai glyphs to BMP Private-Use
    // characters (e.g. U+F70A/U+F70B for alternate mai ek/tho forms in
    // some embedded fonts). They appear inline and break regex matching;
    // stripping the entire BMP PUA is safe — real content never lives
    // there.
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/(\d)\s+(?=\d)/g, '$1') // "25 6 5" → "2565"
    .replace(/\s+/g, ' ')
    .trim();
}

// ToC on page 3 enumerates every "หมวดที่ N" entry — slicing at the first
// "หมวดที่ 2" cuts off Section 1 entirely. Anchor on "หมวดที่ 1" and slice
// to the NEXT "หมวดที่ 2" after ≥500 chars of content.
function sliceSection1(normalizedText: string): string {
  const startRe = thRe('หมวดที่\\s*1[\\.\\s]', 'g');
  let startIdx = -1;
  for (const m of normalizedText.matchAll(startRe)) {
    const after = normalizedText.slice(m.index, m.index + 400);
    if (!thRe('หมวดที่\\s*2').test(after)) {
      startIdx = m.index;
      break;
    }
  }
  const tail = startIdx >= 0 ? normalizedText.slice(startIdx) : normalizedText;
  const endMatch = thRe('หมวดที่\\s*2[\\.\\s]').exec(tail);
  if (endMatch && endMatch.index > 500) {
    return tail.slice(0, endMatch.index);
  }
  return tail.slice(0, 25_000);
}

function squash(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Field extractors — each returns undefined when not confident.
// ─────────────────────────────────────────────────────────────────────────

function extractProgramNames(text: string): { nameTh?: string; nameEn?: string } {
  const out: { nameTh?: string; nameEn?: string } = {};
  const th = thRe(
    'ภาษาไทย\\s*[:：]\\s*(หลักสูตร[^\\n\\r]+?)(?=\\s*(?:ภาษาอังกฤษ|2\\.|ชื่อปริญญา))',
  ).exec(text);
  if (th) out.nameTh = squash(th[1]);
  const en =
    /ภาษาอังกฤษ\s*[:：]\s*((?:[A-Za-z][A-Za-z .,()/'-]*){3,})/.exec(text);
  if (en) out.nameEn = squash(en[1]);
  return out;
}

function extractDegreeNames(text: string): {
  degreeNameTh?: string;
  degreeNameEn?: string;
  degreeAbbrTh?: string;
  degreeAbbrEn?: string;
} {
  const out: {
    degreeNameTh?: string;
    degreeNameEn?: string;
    degreeAbbrTh?: string;
    degreeAbbrEn?: string;
  } = {};
  // Degree names sit in a compact block: no more than ~60 chars each.
  // The lookahead anchors (ชื่อย่อ / ชื่อเต็ม) don't always fire when
  // pdfjs merges spacing unexpectedly, so additionally cap the capture
  // length to prevent runaway matches into the next field.
  const nameTh = thRe(
    'ชื่อเต็ม\\s*\\(\\s*ภาษาไทย\\s*\\)\\s*[:：]\\s*([^\\n\\r]{1,80}?)(?=\\s*(?:ชื่อย่อ|ชื่อเต็ม|3\\.|\\d+\\s*\\.\\s*วิชาเอก|\\(ภาษาอังกฤษ\\)))',
  ).exec(text);
  if (nameTh) out.degreeNameTh = squash(nameTh[1]);
  const abbrTh = thRe(
    'ชื่อย่อ\\s*\\(\\s*ภาษาไทย\\s*\\)\\s*[:：]\\s*([^\\n\\r]{1,60}?)(?=\\s*(?:ชื่อเต็ม|ชื่อย่อ|3\\.|\\(ภาษาอังกฤษ\\)))',
  ).exec(text);
  if (abbrTh) out.degreeAbbrTh = squash(abbrTh[1]);
  const nameEn = thRe(
    'ชื่อเต็ม\\s*\\(\\s*ภาษาอังกฤษ\\s*\\)\\s*[:：]\\s*([^\\n\\r]{1,80}?)(?=\\s*(?:ชื่อย่อ|3\\.))',
  ).exec(text);
  if (nameEn) out.degreeNameEn = squash(nameEn[1]);
  const abbrEn = thRe(
    'ชื่อย่อ\\s*\\(\\s*ภาษาอังกฤษ\\s*\\)\\s*[:：]?\\s*([A-Za-z][A-Za-z. ()]{1,60})',
  ).exec(text);
  if (abbrEn) out.degreeAbbrEn = squash(abbrEn[1]);
  return out;
}

function extractMajors(text: string): string[] {
  // "3. วิชาเอก" through "4. จำนวนหน่วยกิต" or similar; stop at the next
  // numbered section ("4.").
  const m = thRe('3\\.\\s*วิชาเอก([\\s\\S]{0,1500}?)(?=4\\.\\s*จำนวน|4\\.\\s*จํานวน)').exec(text);
  if (!m) return [];
  const block = m[1] ?? '';
  if (thRe('ไม่มี').test(block)) return [];
  const entries = [...block.matchAll(/\d+\.\s*([^\d\n]+?)(?=\s*\d+\.|$)/g)];
  const list = entries
    .map((e) => squash(e[1]).replace(/[()]/g, ''))
    .filter(
      (s) =>
        s &&
        !thRe('^วิชาเอก$').test(s) &&
        !thRe('^ไม่มี').test(s) &&
        s.length < 200,
    );
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

function extractTotalCredits(text: string): number | undefined {
  // "ไม่น้อยกว่า N หน่วยกิต" — pick the MAX across plan variants.
  const matches = [
    ...text.matchAll(thRe('ไม่น้อยกว่า\\s*(\\d{2,3})\\s*หน่วย\\s*กิต', 'g')),
  ];
  if (!matches.length) return undefined;
  const numbers = matches
    .map((m) => Number(m[1]))
    .filter((n) => n > 20 && n < 500);
  if (!numbers.length) return undefined;
  return Math.max(...numbers);
}

function extractDurationYears(text: string): number | undefined {
  // "หลักสูตรระดับปริญญาตรี ทางวิชาการ 4 ปี"
  const m = thRe('หลักสูตรระดับปริญญาตรี[^\\n\\r]*?(\\d)\\s*ปี').exec(text);
  return m ? Number(m[1]) : undefined;
}

function extractProgramPlans(text: string): string[] {
  const plans = new Set<string>();
  // Masters: "แผน ก แบบ ก1" / "แผน ก แบบ ก2" / "แผน ข"
  for (const m of text.matchAll(thRe('แผน\\s*([กขฃค])\\s*แบบ\\s*(ก\\d|ข\\d)', 'g'))) {
    plans.add(`แผน ${m[1]} แบบ ${m[2]}`.trim());
  }
  // Doctoral: "แบบ 1.1 / 1.2 / 2.1 / 2.2"
  for (const m of text.matchAll(thRe('แบบ\\s*([12]\\.[12])', 'g'))) {
    plans.add(`แบบ ${m[1]}`);
  }
  return [...plans];
}

function extractLanguage(text: string): 'TH' | 'EN' | 'MIXED' | undefined {
  const m = thRe(
    '5\\s*\\.\\s*2\\s*ภาษาที่ใช้\\s*([^\\n\\r]+?)(?=\\s*5\\s*\\.\\s*3|การรับเข้าศึกษา)',
  ).exec(text);
  const block = m?.[1] ?? text.slice(0, 4000);
  if (thRe('ภาษาไทย\\s*และ\\s*ภาษาอังกฤษ|ภาษาไทยและภาษาอังกฤษ').test(block)) {
    return 'MIXED';
  }
  if (thRe('^\\s*ภาษาอังกฤษ').test(block)) return 'EN';
  if (thRe('ภาษาไทย').test(block)) return 'TH';
  return undefined;
}

function extractAdmissionScope(
  text: string,
): 'TH_ONLY' | 'TH_AND_INTL' | 'INTL_ONLY' | undefined {
  const m = thRe(
    '5\\s*\\.\\s*3\\s*การรับเข้าศึกษา\\s*([^\\n\\r]+?)(?=\\s*5\\s*\\.\\s*4|ความร่วมมือ)',
  ).exec(text);
  const block = m?.[1] ?? '';
  if (!block) return undefined;
  if (thRe('ชาวต่างประเทศ|ต่างชาติ|ต่างประเทศ').test(block)) {
    if (thRe('นักศึกษาไทย').test(block)) return 'TH_AND_INTL';
    return 'INTL_ONLY';
  }
  if (thRe('นักศึกษาไทย').test(block)) return 'TH_ONLY';
  return undefined;
}

function extractLevel(
  abbrTh: string | undefined,
  nameTh: string | undefined,
): 'BACHELOR' | 'MASTER' | 'DOCTORAL' | undefined {
  const src = `${nameTh ?? ''} ${abbrTh ?? ''}`;
  // Match against raw text too, in case tone marks are gone.
  if (thRe('ดุษฎีบัณฑิต|ปร\\.\\s*ด\\.|Ph\\.\\s*D\\.|Doctor of').test(src) ||
      /Ph\.\s*D\./i.test(src)) return 'DOCTORAL';
  if (thRe('มหาบัณฑิต|\\.\\s*ม\\.|Master of').test(src)) return 'MASTER';
  if (thRe('บัณฑิต\\b|\\.\\s*บ\\.|Bachelor of').test(src)) return 'BACHELOR';
  return undefined;
}

function extractCurriculumYearBE(
  text: string,
  coverTail: string,
): number | undefined {
  const revRe = thRe('หลักสูตรปรับปรุง\\s*พ\\s*\\.\\s*ศ\\s*\\.\\s*(25\\d{2})');
  for (const src of [text, coverTail]) {
    const m = revRe.exec(src);
    if (m) return Number(m[1]);
  }
  const coverHead = coverTail.slice(0, 1200);
  const fb = thRe('หลักสูตร[^\\n]{0,80}?พ\\s*\\.\\s*ศ\\s*\\.\\s*(25\\d{2})').exec(
    coverHead,
  );
  return fb ? Number(fb[1]) : undefined;
}

function extractRevision(text: string): boolean {
  return thRe('หลักสูตรปรับปรุง').test(text);
}

function extractPreviousYearBE(
  text: string,
  coverTail: string,
): number | undefined {
  // "ปีที่เริ่มใช้หลักสูตรเดิม พ.ศ. 25XX"
  const re = thRe('ปีที่เริ่มใช้หลักสูตรเดิม\\s*พ\\s*\\.\\s*ศ\\s*\\.\\s*(25\\d{2})');
  for (const src of [coverTail, text]) {
    const m = re.exec(src);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function extractOpening(text: string): {
  openingYear?: number;
  openingSemester?: number;
} {
  const m = thRe(
    'เปิดสอน\\s*ภาค(?:การ)?ศึกษาที่\\s*(\\d)\\s*ปีการศึกษา\\s*(25\\d{2})',
  ).exec(text);
  if (!m) return {};
  return { openingSemester: Number(m[1]), openingYear: Number(m[2]) };
}

const APPROVAL_PATTERNS: Array<{
  body:
    | 'FACULTY_COMMITTEE'
    | 'UNIVERSITY_SCREENING'
    | 'ACADEMIC_COUNCIL'
    | 'UNIVERSITY_COUNCIL'
    | 'GRADUATE_SCHOOL';
  pattern: string;
}> = [
  {
    body: 'FACULTY_COMMITTEE',
    pattern:
      'คณะกรรมการประจ(?:ำ|\\s)?คณะ[^\\n\\r]{0,120}?(?:ในการประชุมครั้งที่|ครั้งที่)\\s*(\\d+\\/\\d{4})\\s*(?:เมื่อ)?\\s*(?:วันที่)?\\s*([0-9ก-๙\\s.]+?(?:พ\\s*\\.\\s*ศ\\s*\\.\\s*)?25\\d{2})',
  },
  {
    body: 'UNIVERSITY_SCREENING',
    pattern:
      '(?:คณะกรรมการ)?กลั่นกรองหลักสูตร[^\\n\\r]{0,120}?ครั้งที่\\s*(\\d+\\/\\d{4})\\s*(?:วันที่)?\\s*([0-9ก-๙\\s.]+?(?:พ\\s*\\.\\s*ศ\\s*\\.\\s*)?25\\d{2})',
  },
  {
    body: 'ACADEMIC_COUNCIL',
    pattern:
      'สภาวิชาการ[^\\n\\r]{0,120}?ครั้งที่\\s*(\\d+\\/\\d{4})\\s*(?:วันที่)?\\s*([0-9ก-๙\\s.]+?(?:พ\\s*\\.\\s*ศ\\s*\\.\\s*)?25\\d{2})',
  },
  {
    body: 'UNIVERSITY_COUNCIL',
    pattern:
      'สภามหาวิทยาลัย[^\\n\\r]{0,120}?ครั้งที่\\s*(\\d+\\/\\d{4})\\s*(?:วันที่)?\\s*([0-9ก-๙\\s.]+?(?:พ\\s*\\.\\s*ศ\\s*\\.\\s*)?25\\d{2})',
  },
  {
    body: 'GRADUATE_SCHOOL',
    pattern:
      'บัณฑิตวิทยาลัย[^\\n\\r]{0,120}?ครั้งที่\\s*(\\d+\\/\\d{4})\\s*(?:วันที่)?\\s*([0-9ก-๙\\s.]+?(?:พ\\s*\\.\\s*ศ\\s*\\.\\s*)?25\\d{2})',
  },
];

function extractApprovals(text: string): Array<{
  body: string;
  meetingNo?: string;
  meetingDate?: string;
}> {
  const out: Array<{ body: string; meetingNo?: string; meetingDate?: string }> = [];
  for (const p of APPROVAL_PATTERNS) {
    const m = thRe(p.pattern).exec(text);
    if (!m) continue;
    out.push({
      body: p.body,
      meetingNo: squash(m[1]),
      meetingDate: squash(m[2]),
    });
  }
  return out;
}

function extractFaculty(text: string): string | undefined {
  const m = thRe(
    '(?:วิทยาเขต\\s*\\/\\s*คณะ\\s*\\/\\s*ภาควิชา|คณะ)\\s*[:：]?\\s*(คณะ[^\\n\\r]+?)(?=\\s*(?:และ|หมวดที่|1\\.|$))',
  ).exec(text.slice(0, 3000));
  if (!m) return undefined;
  const trimmed = squash(m[1]).replace(/\s*หมวดที่?.*$/, '').trim();
  return trimmed || undefined;
}

function extractCareers(text: string): string[] {
  // "8. อาชีพที่สามารถประกอบได้หลังสำเร็จการศึกษา" up to "9. ชื่อ-สกุล"
  // Anchor tolerantly — "ที่" and "ได้" + "สำเร็จ" may lose tone marks.
  const m = thRe(
    '8\\.\\s*อาชีพที่สามารถประกอบได้?[^\\n\\r]*?\\s([\\s\\S]+?)(?=\\s*9\\s*\\.\\s*(?:ชื่อ|สกุล))',
  ).exec(text);
  if (!m) return [];
  const block = squash(m[1]);
  const split = block
    .split(thRe('[,;]|\\sเช่น\\s|\\sและ\\s|\\sหรือ\\s|\\sรวมทั้ง\\s|\\sนอกจากนี้\\s', 'g'))
    .map((s) => squash(s).replace(/^[-–—·]\s*|:$/g, ''))
    .filter(
      (s) =>
        s &&
        s.length > 2 &&
        s.length < 200 &&
        !thRe('^(สามารถประกอบอาชีพ|ในภาคเอกชน|ส่วนใน|สายงาน|ภาครัฐ|สวน)').test(s),
    );
  return split.slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────
// Extractor
// ─────────────────────────────────────────────────────────────────────────

export class CurriculumHeuristicExtractor implements PdfExtractor {
  readonly name = 'Thai มคอ.2 header extractor';
  readonly extractionType = 'CURRICULUM_SPEC' as const;
  readonly appliesTo: readonly PdfSourceCategory[] = ['CURRICULUM'];
  readonly methodVersion = 'heuristic-v1';

  async extract(ctx: PdfContext): Promise<ExtractionRecord[]> {
    if (!ctx.fullText || ctx.fullText.length < 200) {
      return [
        {
          extractionType: this.extractionType,
          targetEntityType: 'Program',
          payload: { programNameTh: ctx.originalFilename.replace(/\.pdf$/i, '') },
          confidence: 0,
          reasoning:
            'No extractable text in PDF (likely scanned or image-only). OCR pass is needed before fields can be parsed.',
          proposedLinks: [],
        },
      ];
    }

    const normalized = normalizeThaiText(ctx.fullText);
    const coverTail = normalized.slice(0, 3000);
    const section1 = sliceSection1(normalized);

    const names = extractProgramNames(section1);
    const degree = extractDegreeNames(section1);
    const majors = extractMajors(section1);
    const totalCredits = extractTotalCredits(section1);
    const durationYears = extractDurationYears(section1);
    const programPlans = extractProgramPlans(section1);
    const language = extractLanguage(section1);
    const admissionScope = extractAdmissionScope(section1);
    const level = extractLevel(degree.degreeAbbrTh, degree.degreeNameTh);
    const curriculumYearBE = extractCurriculumYearBE(section1, coverTail);
    const isRevision = extractRevision(coverTail);
    const previousCurriculumYearBE = extractPreviousYearBE(section1, coverTail);
    const opening = extractOpening(section1);
    const approvalHistory = extractApprovals(section1);
    const facultyNameTh = extractFaculty(coverTail);
    const careersTh = extractCareers(section1);

    const payload = {
      programNameTh:
        names.nameTh ?? ctx.originalFilename.replace(/\.pdf$/i, ''),
      programNameEn: names.nameEn,
      facultyNameTh,
      level,
      totalCredits,
      durationYears,
      curriculumYear: curriculumYearBE,
      degreeNameTh: degree.degreeNameTh,
      degreeNameEn: degree.degreeNameEn,
      degreeAbbrTh: degree.degreeAbbrTh,
      degreeAbbrEn: degree.degreeAbbrEn,
      majors,
      programPlans,
      language,
      admissionScope,
      isRevision,
      previousCurriculumYearBE,
      openingYear: opening.openingYear,
      openingSemester: opening.openingSemester,
      approvalHistory,
      careersTh,
      courses: [],
    };

    const core = [
      names.nameTh,
      names.nameEn,
      degree.degreeNameTh,
      degree.degreeAbbrTh,
      level,
      totalCredits,
      curriculumYearBE,
      opening.openingYear,
      approvalHistory.length >= 3 ? 'ok' : undefined,
      careersTh.length > 0 ? 'ok' : undefined,
    ];
    const present = core.filter(Boolean).length;
    const confidence = Math.min(0.95, present / core.length);

    const missing = [
      !names.nameTh && 'programNameTh',
      !names.nameEn && 'programNameEn',
      !degree.degreeNameTh && 'degreeNameTh',
      !level && 'level',
      !totalCredits && 'totalCredits',
      !curriculumYearBE && 'curriculumYearBE',
      approvalHistory.length < 3 && 'approvalHistory',
      careersTh.length === 0 && 'careersTh',
    ].filter(Boolean);

    return [
      {
        extractionType: this.extractionType,
        targetEntityType: 'Program',
        payload,
        confidence,
        reasoning:
          `Parsed Section-1 via heuristic-v1. Recovered ${present}/${core.length} core fields.` +
          (missing.length
            ? ` Missing: ${missing.join(', ')}.`
            : ' All core fields present.'),
        proposedLinks: [],
      },
    ];
  }
}
