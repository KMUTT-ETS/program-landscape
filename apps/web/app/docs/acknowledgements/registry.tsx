import type { ReactNode } from 'react';
import type { DataSourceMarkSlug } from '@/components/data-source-mark';

// ─────────────────────────────────────────────────────────────────────────────
// Acknowledgements registry — the one place an external contributor to
// Program Landscape is recorded. /docs/acknowledgements renders this list.
//
// Adding a contributor is one commit: append an entry to ENTRIES here; if it
// has a logo, add it to DATA_SOURCE_MARKS with the image under
// apps/web/public/brand/ (never hotlinked — CSP is img-src 'self'); optionally
// write the long form at docs/acknowledgements/<slug>.md and set detailUrl.
// The exported ACKNOWLEDGEMENTS list is sorted most-recent-first
// automatically, so append order doesn't matter. The registry test asserts
// both languages, unique slugs, a known logo and an in-repo detailUrl.
//
// `body` is content, not a UI label, so it is bilingual — the same exemption
// the methodology paper uses. `body` is the SHORT form shown in-app;
// `detailUrl` points at the long-form markdown. The two are not expected to
// be identical, and the markdown is only reachable by people with repository
// access, so the page shows the link to admin-grade users only.
// ─────────────────────────────────────────────────────────────────────────────

export type AcknowledgementKind = 'data-provider' | 'partner' | 'funder';

export interface Acknowledgement {
  /** Stable anchor id: /docs/acknowledgements#<slug>. */
  slug: string;
  kind: AcknowledgementKind;
  name: string;
  /** Reuses the brand mark shown beside the contributor's data in the app. */
  logo?: DataSourceMarkSlug;
  /** ISO date the contribution began. */
  since: string;
  /** One line for the list. */
  contributes: { en: string; th: string };
  /** The acknowledgement and what the contribution enables. */
  body: { en: ReactNode; th: ReactNode };
  /** Long-form record on GitHub. */
  detailUrl?: string;
}

export const KIND_LABEL: Record<AcknowledgementKind, string> = {
  'data-provider': 'Data provider',
  partner: 'Partner',
  funder: 'Funder',
};

const GITHUB_DOCS = 'https://github.com/khon-kaen-university/program-landscape/blob/main/docs/acknowledgements/';

const ENTRIES: readonly Acknowledgement[] = [
  {
    slug: 'jobthai',
    kind: 'data-provider',
    name: 'JobThai',
    logo: 'jobthai',
    since: '2026-09-13',
    contributes: {
      en: 'Thai job postings — the platform’s view of domestic labour-market demand: which fields of study employers ask for, at which level, in which province and industry.',
      th: 'ประกาศรับสมัครงานในไทย — มุมมองอุปสงค์ตลาดแรงงานในประเทศของระบบ: นายจ้างต้องการสาขาวิชาใด ระดับวุฒิใด ในจังหวัดและอุตสาหกรรมใด',
    },
    body: {
      en: (
        <>
          <p>
            Khon Kaen University gratefully acknowledges <strong>JobThai</strong> for providing the
            job-posting data that gives Program Landscape its view of domestic labour-market demand.
          </p>
          <p>
            Before this contribution, the platform’s picture of what employers need came from
            aggregated, career-level skill statistics. JobThai’s postings added something no other
            source in the system provides: employers’ own words about which fields of study they want
            graduates to hold, at which education level, in which province and industry. That is the
            most direct evidence available of the link between a university programme and the jobs
            its graduates enter, and it now informs how the platform scores programme relevance
            (domestic demand is weighted more heavily than global demand — see Methodology), which
            skill gaps it reports to university leadership, and which occupations each programme is
            shown to feed in the Program Deep-Dive.
          </p>
          <p>
            Because Program Landscape is made available to Thai universities, this contribution
            reaches beyond Khon Kaen University. JobThai intends to make its data available to other
            universities that use this application under a future memorandum of understanding with
            the Council of University Presidents of Thailand (CUPT, ที่ประชุมอธิการบดีแห่งประเทศไทย —
            ทปอ.), not yet concluded, so that each can run the same analysis on its own programmes.
          </p>
        </>
      ),
      th: (
        <>
          <p>
            มหาวิทยาลัยขอนแก่นขอขอบคุณ <strong>JobThai</strong> ที่ได้มอบข้อมูลประกาศรับสมัครงาน
            ซึ่งทำให้ Program Landscape สามารถมองเห็นความต้องการของตลาดแรงงานในประเทศได้อย่างเป็นรูปธรรม
          </p>
          <p>
            ก่อนหน้านี้ ภาพความต้องการของนายจ้างในระบบมาจากสถิติทักษะระดับอาชีพแบบสรุปรวม
            ข้อมูลของ JobThai เพิ่มสิ่งที่ไม่มีแหล่งอื่นในระบบให้ได้: ถ้อยคำของนายจ้างเองว่าต้องการผู้สำเร็จการศึกษาสาขาวิชาใด
            ในระดับวุฒิการศึกษาใด ในจังหวัดและอุตสาหกรรมใด ซึ่งเป็นหลักฐานที่ชัดเจนที่สุดของความเชื่อมโยงระหว่างหลักสูตรกับงานที่บัณฑิตเข้าสู่
            และปัจจุบันใช้ประกอบการประเมินความสอดคล้องของหลักสูตร (อุปสงค์ในประเทศได้รับน้ำหนักมากกว่าอุปสงค์ต่างประเทศ — ดูระเบียบวิธี)
            การรายงานช่องว่างทักษะต่อผู้บริหาร และการแสดงอาชีพที่แต่ละหลักสูตรป้อนบัณฑิตเข้าสู่ใน Program Deep-Dive
          </p>
          <p>
            เนื่องจาก Program Landscape เปิดให้มหาวิทยาลัยไทยนำไปใช้ได้ การสนับสนุนนี้จึงเป็นประโยชน์เกินกว่ามหาวิทยาลัยขอนแก่น
            JobThai มีเจตนาจะเปิดให้มหาวิทยาลัยอื่นที่ใช้ระบบนี้เข้าถึงข้อมูลได้ ภายใต้บันทึกข้อตกลงความร่วมมือ (MOU)
            กับที่ประชุมอธิการบดีแห่งประเทศไทย (ทปอ.) ที่จะจัดทำขึ้นในอนาคต เพื่อให้แต่ละมหาวิทยาลัยวิเคราะห์หลักสูตรของตนเองด้วยวิธีเดียวกัน
          </p>
        </>
      ),
    },
    detailUrl: `${GITHUB_DOCS}jobthai.md`,
  },
  {
    slug: 'job-108',
    kind: 'data-provider',
    name: 'Job-108',
    logo: 'job-108',
    since: '2026-09-20',
    contributes: {
      en: 'Thai government and state-enterprise recruitment announcements — the platform’s view of public-sector labour demand, alongside JobThai’s private-sector view.',
      th: 'ประกาศรับสมัครงานของหน่วยงานรัฐและรัฐวิสาหกิจไทย — มุมมองอุปสงค์แรงงานภาครัฐของระบบ คู่กับมุมมองภาคเอกชนจาก JobThai',
    },
    body: {
      en: (
        <>
          <p>
            Khon Kaen University acknowledges <strong>job-108.com</strong>, whose published government
            and state-enterprise recruitment announcements let Program Landscape read Thai public-sector
            demand as its own market rather than folding it silently into the private-sector picture.
          </p>
          <p>
            Every field-of-study row on the Gap Analyzer can be read against three denominators — the
            private sector alone, the government sector alone, or both markets blended, which is the
            platform’s default precisely because excluding the state would bias the map against exactly
            the nursing, public-health, teaching and agriculture programmes a regional university exists
            to feed. Government rows carry no occupation classification, so they inform the field-of-study
            layer only, not the occupation-level detail JobThai supplies.
          </p>
        </>
      ),
      th: (
        <>
          <p>
            มหาวิทยาลัยขอนแก่นขอขอบคุณ <strong>job-108.com</strong> ที่เผยแพร่ประกาศรับสมัครงานของหน่วยงานรัฐและรัฐวิสาหกิจ
            ซึ่งทำให้ Program Landscape สามารถมองเห็นอุปสงค์แรงงานภาครัฐของไทยเป็นตลาดของตนเองได้
            แทนที่จะรวมเข้ากับภาพภาคเอกชนโดยไม่แยกแยะ
          </p>
          <p>
            แต่ละแถวสาขาวิชาในตัววิเคราะห์ช่องว่างสามารถอ่านเทียบกับฐานได้สามแบบ — ภาคเอกชนอย่างเดียว ภาครัฐอย่างเดียว
            หรือผสมทั้งสองตลาด ซึ่งเป็นค่าตั้งต้นของระบบเพราะการตัดภาครัฐออกจะทำให้แผนที่มีอคติต่อหลักสูตรพยาบาล
            สาธารณสุข ครุศาสตร์ และเกษตรศาสตร์ ซึ่งเป็นพันธกิจหลักของมหาวิทยาลัยภูมิภาค
            ประกาศภาครัฐไม่มีการจำแนกตามอาชีพ จึงใช้ประกอบชั้นสาขาวิชาเท่านั้น ไม่ใช่รายละเอียดระดับอาชีพที่ JobThai ให้
          </p>
        </>
      ),
    },
  },
];

/** Sorted most-recent `since` first. */
export const ACKNOWLEDGEMENTS: ReadonlyArray<Readonly<Acknowledgement>> = [...ENTRIES].sort((a, b) =>
  b.since.localeCompare(a.since),
);
