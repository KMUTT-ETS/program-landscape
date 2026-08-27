import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Disclaimer · Program Landscape' };

const EFFECTIVE_DATE_EN = '11 May 2026';
const VERSION = '1.0';

export default function DisclaimerPage() {
  return (
    <LegalPage
      titleEn="Disclaimer"
      titleTh="คำชี้แจงและข้อจำกัดความรับผิด"
      lastUpdated={`Effective ${EFFECTIVE_DATE_EN} · Version ${VERSION}`}
      bodyEn={
        <>
          <h2>1. Purpose of This Disclaimer</h2>
          <p>
            This Disclaimer (the <strong>“Disclaimer”</strong>) qualifies the use of
            content made available through the Program Landscape platform
            (the <strong>“Platform”</strong>) operated by Khon Kaen University
            (<strong>“KKU”</strong>). It forms an integral part of, and shall be
            read together with, the <a href="/terms">Terms and Conditions of Use</a>{' '}
            and the <a href="/copyright">Copyright Notice</a>.
          </p>

          <h2>2. Advisory Nature of Content</h2>
          <p>
            <strong>2.1.</strong> The Platform is a decision-support tool. All
            analytical outputs—including health scores, lifecycle verdicts, gap
            analyses, scenario projections, peer comparisons, AI-generated
            narratives, and Council-pack documents—are <strong>advisory</strong>{' '}
            and intended to inform, not replace, the professional judgement of the
            University Council, senior management, deans, department heads, and
            authorised analysts.
          </p>
          <p>
            <strong>2.2.</strong> No output of the Platform constitutes a binding
            instrument, regulatory determination, financial recommendation,
            medical advice, or other professional advice.
          </p>

          <h2>3. Data Quality and Provenance</h2>
          <p>
            <strong>3.1.</strong> The Platform integrates data from KKU institutional
            systems (Registry, Human Resources, Finance, Publications) and authorised
            external sources (including, without limitation, KMITL Skill Mapping,
            OpenAlex, PubMed, and the KKU Publications mirror).
          </p>
          <p>
            <strong>3.2.</strong> Each chart and metric in the Platform displays a
            freshness timestamp; a provenance panel records the source identifier,
            ingestion cadence, methodology version, and known caveats.
          </p>
          <p>
            <strong>3.3.</strong> Connectors that have not yet completed a
            <strong> 30-day green-history evaluation period</strong> are flagged
            within the Platform as <em>preview-quality</em>. Their outputs shall
            not be cited in binding governance decisions until the evaluation
            period is satisfied and any required sign-offs (including from the
            Data Protection Officer or Finance Committee, as applicable) have
            been recorded.
          </p>

          <h2>4. AI-Generated Content; Hallucination Risk</h2>
          <p>
            <strong>4.1.</strong> AI-generated content is produced by third-party
            large language models acting under structured prompts and configured
            safety guardrails. Such models may:
          </p>
          <ol>
            <li>misinterpret nuanced data, particularly Thai-language text;</li>
            <li>over-generalise from limited samples;</li>
            <li>
              occasionally produce plausible-sounding but factually inaccurate
              content (commonly referred to as “hallucination”);
            </li>
            <li>vary in output across versions of the underlying model.</li>
          </ol>
          <p>
            <strong>4.2.</strong> Every AI-generated output is accompanied by a
            machine-estimated confidence score and citations to the underlying
            data. The reviewer is responsible for verifying AI-generated content
            against primary sources before reliance.
          </p>
          <p>
            <strong>4.3.</strong> KKU does not warrant the absence of bias or error
            in AI-generated outputs and disclaims all liability for reliance on
            such outputs save where prohibited by law.
          </p>

          <h2>5. Methodology Versions</h2>
          <p>
            <strong>5.1.</strong> Every derived metric carries a methodology
            version (for example, <em>health-score.v1</em>,{' '}
            <em>forecasting.v1</em>, <em>cost-allocation.v0</em>). Methodology
            documentation is maintained under version control in the KKU
            repository.
          </p>
          <p>
            <strong>5.2.</strong> When a methodology evolves, historical outputs
            are preserved; new outputs are stamped with the new version. Cross-
            version comparisons require careful interpretation and should not be
            performed without methodological review.
          </p>

          <h2>6. Forecasting and Scenario Projections</h2>
          <p>
            <strong>6.1.</strong> Demand forecasts, scenario projections, and
            confidence bands are derived from the methodology version current at
            the time of computation and from the data then available.
          </p>
          <p>
            <strong>6.2.</strong> Confidence bands are visual indicators of
            uncertainty; they are not statistical coverage guarantees. Actual
            outcomes may diverge materially from forecasts due to policy shifts,
            demographic changes, market conditions, regulatory changes, or other
            factors not captured by the model.
          </p>

          <h2>7. Benchmarking and Peer Comparison</h2>
          <p>
            Cross-institutional and cross-jurisdictional benchmarking draws on
            subject taxonomies that are not perfectly aligned (including, without
            limitation, those of Times Higher Education, QS, SCImago, and KKU's
            internal department structure). The basis for each comparison is
            surfaced within the Platform's provenance panel. Comparisons shall be
            treated as directional indicators rather than literal equivalences.
          </p>

          <h2>8. Personal Data and Aggregation</h2>
          <p>
            <strong>8.1.</strong> The Platform processes Personal Data in
            accordance with the Personal Data Protection Act B.E. 2562 (2019) (the{' '}
            <strong>“PDPA”</strong>). KKU is the data controller.
          </p>
          <p>
            <strong>8.2.</strong> Where feasible, employee identifiers are hashed
            at source. Aggregate cells representing fewer than five individuals
            are suppressed (k-anonymity threshold of 5).
          </p>
          <p>
            <strong>8.3.</strong> The public-profile sharing feature is opt-in by
            default and never enabled without express user action.
          </p>

          <h2>9. Translations</h2>
          <p>
            Where the Platform displays text translated from Thai to English or
            vice versa, translations are provided on a best-effort basis and may
            not capture every nuance of the original. The original-language text
            remains authoritative for legal, academic, and regulatory purposes.
          </p>

          <h2>10. Third-Party Content and Links</h2>
          <p>
            References to third-party tools, libraries, data sources, or external
            URLs are provided for information only. Inclusion does not constitute
            endorsement, recommendation, or warranty of any kind. KKU is not
            responsible for the content, accuracy, or availability of third-party
            sources.
          </p>

          <h2>11. Information Currency</h2>
          <p>
            Information on the Platform is updated on cadences appropriate to
            each source. KKU does not warrant that any particular output is
            current at any given moment. Reviewers should refer to the freshness
            timestamp displayed on each chart and metric.
          </p>

          <h2>12. Decision Workspace Records</h2>
          <p>
            Decisions, milestones, approvers, and outcome reviews recorded in
            the Platform's Decision Workspace constitute internal institutional
            records only. They do not constitute legal instruments unless and
            until separately formalised through the official decision-making
            channels of KKU.
          </p>

          <h2>13. Reliance at User's Own Risk</h2>
          <p>
            Any reliance on Platform content is at the User's own risk. KKU shall
            not be liable for any action or omission taken in reliance on Platform
            content, save where such liability cannot lawfully be excluded.
          </p>

          <h2>14. Updates to This Disclaimer</h2>
          <p>
            KKU may revise this Disclaimer from time to time. Material revisions
            will be announced through the Platform. The effective date and version
            number above identify the current version.
          </p>

          <h2>15. Contact</h2>
          <p>For queries relating to this Disclaimer, please contact:</p>
          <p>
            Office of the Vice President for Education and Digital
            <br />
            Khon Kaen University
            <br />
            123 Moo 16, Mittraphap Road
            <br />
            Tambon Nai Mueang, Mueang Khon Kaen District
            <br />
            Khon Kaen Province 40002, Thailand
            <br />
            Email: <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
      bodyTh={
        <>
          <h2>1. วัตถุประสงค์ของคำชี้แจง</h2>
          <p>
            คำชี้แจงนี้ (<strong>“คำชี้แจง”</strong>) เป็นเงื่อนไขเพิ่มเติมในการใช้
            เนื้อหาที่จัดให้ผ่านแพลตฟอร์ม Program Landscape
            (<strong>“แพลตฟอร์ม”</strong>) ดำเนินการโดยมหาวิทยาลัยขอนแก่น
            (<strong>“มข.”</strong>) คำชี้แจงนี้เป็นส่วนหนึ่งของและให้อ่านประกอบกับ{' '}
            <a href="/terms">ข้อกำหนดและเงื่อนไขการใช้งาน</a> และ{' '}
            <a href="/copyright">ประกาศลิขสิทธิ์</a>
          </p>

          <h2>2. ลักษณะที่เป็นเพียงคำแนะนำของเนื้อหา</h2>
          <p>
            <strong>2.1.</strong> แพลตฟอร์มเป็นเครื่องมือสนับสนุนการตัดสินใจ
            ผลลัพธ์การวิเคราะห์ทั้งหมด รวมถึงคะแนนสุขภาพหลักสูตร การประเมินวงจรชีวิต
            การวิเคราะห์ช่องว่าง การคาดการณ์สถานการณ์จำลอง การเปรียบเทียบกับสถาบัน
            คู่เทียบ เรื่องเล่าที่ AI สร้างขึ้น และเอกสารชุดประชุมสภามหาวิทยาลัย
            มีลักษณะเป็น <strong>คำแนะนำ</strong> มีจุดประสงค์เพื่อประกอบ
            การพิจารณาของสภามหาวิทยาลัย ผู้บริหารระดับสูง คณบดี หัวหน้าภาควิชา
            และนักวิเคราะห์ที่ได้รับอนุญาต ไม่ใช่เพื่อทดแทนการวินิจฉัยทางวิชาชีพ
          </p>
          <p>
            <strong>2.2.</strong> ผลลัพธ์ของแพลตฟอร์มไม่ถือเป็นเอกสารที่มีผลผูกพัน
            คำวินิจฉัยทางกฎระเบียบ คำแนะนำทางการเงิน คำแนะนำทางการแพทย์
            หรือคำแนะนำทางวิชาชีพอื่น ๆ
          </p>

          <h2>3. คุณภาพและที่มาของข้อมูล</h2>
          <p>
            <strong>3.1.</strong> แพลตฟอร์มเชื่อมต่อข้อมูลจากระบบของ มข. (สำนัก
            ทะเบียนและประมวลผล กองทรัพยากรบุคคล สำนักการเงิน คลังผลงานตีพิมพ์)
            และแหล่งภายนอกที่ได้รับอนุญาต (รวมถึงแต่ไม่จำกัดเพียง KMITL Skill
            Mapping, OpenAlex, PubMed และฐานข้อมูลผลงานตีพิมพ์ของ มข.)
          </p>
          <p>
            <strong>3.2.</strong> กราฟและตัวชี้วัดทุกชิ้นบนแพลตฟอร์มแสดงตราเวลา
            ความสดใหม่ แผงข้อมูลที่มาจะระบุตัวระบุแหล่งที่มา ความถี่การนำเข้าข้อมูล
            เวอร์ชันระเบียบวิธี และข้อจำกัดที่ทราบ
          </p>
          <p>
            <strong>3.3.</strong> ตัวเชื่อมต่อข้อมูลที่ยังไม่ผ่าน{' '}
            <strong>ระยะเวลาประเมินคุณภาพ 30 วัน</strong> จะถูกระบุไว้ภายในแพลตฟอร์ม
            ว่าเป็น <em>คุณภาพแสดงตัวอย่าง</em> ห้ามนำผลลัพธ์ดังกล่าวไปอ้างอิงในการ
            ตัดสินใจกำกับดูแลที่มีผลผูกพันจนกว่าจะผ่านระยะประเมินและได้รับการ
            ลงนามรับรองที่จำเป็น (รวมถึงจากเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล
            หรือคณะกรรมการการเงิน ตามแต่กรณี)
          </p>

          <h2>4. เนื้อหาที่สร้างโดย AI; ความเสี่ยงในการสร้างเนื้อหาที่ไม่ถูกต้อง</h2>
          <p>
            <strong>4.1.</strong> เนื้อหาที่ AI สร้างขึ้นผลิตโดยโมเดลภาษาขนาดใหญ่
            ของบุคคลที่สามที่ทำงานภายใต้คำสั่งที่ออกแบบไว้และระบบป้องกัน
            ที่กำหนดค่าไว้ โมเดลดังกล่าวอาจ:
          </p>
          <ol>
            <li>ตีความข้อมูลที่ละเอียดอ่อนผิดพลาด โดยเฉพาะข้อความภาษาไทย;</li>
            <li>สรุปจากตัวอย่างที่จำกัดในลักษณะกว้างเกินไป;</li>
            <li>
              ผลิตเนื้อหาที่ฟังดูสมเหตุสมผลแต่ไม่ถูกต้องตามข้อเท็จจริงเป็นครั้งคราว
              (ที่เรียกกันว่า “hallucination”);
            </li>
            <li>ให้ผลลัพธ์ที่แตกต่างกันในแต่ละเวอร์ชันของโมเดลพื้นฐาน</li>
          </ol>
          <p>
            <strong>4.2.</strong> ผลลัพธ์ที่ AI สร้างขึ้นทุกชิ้นมีคะแนนความเชื่อมั่น
            ที่ประมาณการโดยเครื่องและการอ้างอิงข้อมูลต้นทาง ผู้ตรวจสอบมีหน้าที่
            ตรวจสอบเนื้อหาดังกล่าวเทียบกับแหล่งข้อมูลปฐมภูมิก่อนนำไปใช้
          </p>
          <p>
            <strong>4.3.</strong> มข. ไม่รับรองการปราศจากอคติหรือข้อผิดพลาดใน
            ผลลัพธ์ที่ AI สร้างขึ้น และปฏิเสธความรับผิดทั้งหมดสำหรับการนำผลลัพธ์
            ดังกล่าวไปใช้ เว้นแต่กรณีที่กฎหมายห้ามมิให้ยกเว้นความรับผิด
          </p>

          <h2>5. เวอร์ชันของระเบียบวิธี</h2>
          <p>
            <strong>5.1.</strong> ตัวชี้วัดที่สังเคราะห์ขึ้นทุกชิ้นมีตราเวอร์ชัน
            ระเบียบวิธี (เช่น <em>health-score.v1</em>, <em>forecasting.v1</em>,{' '}
            <em>cost-allocation.v0</em>) เอกสารระเบียบวิธีถูกจัดเก็บภายใต้ระบบ
            ควบคุมเวอร์ชันในคลังโค้ดของ มข.
          </p>
          <p>
            <strong>5.2.</strong> เมื่อระเบียบวิธีพัฒนาขึ้น ผลลัพธ์ในประวัติ
            จะถูกเก็บรักษาไว้และผลลัพธ์ใหม่จะมีตราเวอร์ชันใหม่ การเปรียบเทียบ
            ข้ามเวอร์ชันต้องใช้การตีความอย่างระมัดระวังและไม่ควรกระทำโดย
            ปราศจากการพิจารณาทางระเบียบวิธี
          </p>

          <h2>6. การพยากรณ์และการคาดการณ์สถานการณ์จำลอง</h2>
          <p>
            <strong>6.1.</strong> การพยากรณ์อุปสงค์ การคาดการณ์สถานการณ์จำลอง
            และช่วงความเชื่อมั่น คำนวณจากเวอร์ชันระเบียบวิธีและข้อมูลที่มีอยู่
            ณ เวลาที่คำนวณ
          </p>
          <p>
            <strong>6.2.</strong> ช่วงความเชื่อมั่นเป็นเครื่องบ่งชี้ความไม่แน่นอน
            เชิงภาพ ไม่ใช่การรับประกันความครอบคลุมเชิงสถิติ ผลลัพธ์จริงอาจ
            คลาดเคลื่อนอย่างมีนัยสำคัญจากการพยากรณ์เนื่องจากการเปลี่ยนแปลง
            เชิงนโยบาย ประชากรศาสตร์ ภาวะตลาด การเปลี่ยนแปลงทางกฎระเบียบ
            หรือปัจจัยอื่นที่ไม่ได้ครอบคลุมในแบบจำลอง
          </p>

          <h2>7. การเปรียบเทียบกับสถาบันคู่เทียบ</h2>
          <p>
            การเปรียบเทียบข้ามสถาบันและข้ามเขตอำนาจอาศัยระบบจำแนกประเภทวิชา
            ที่ไม่ได้สอดคล้องกันอย่างสมบูรณ์ (รวมถึงแต่ไม่จำกัดเพียงระบบของ Times
            Higher Education, QS, SCImago และโครงสร้างภาควิชาภายในของ มข.)
            ฐานของการเปรียบเทียบแต่ละกรณีปรากฏในแผงข้อมูลที่มาของแพลตฟอร์ม
            ผลการเปรียบเทียบควรถือเป็นเครื่องบ่งชี้ทิศทาง ไม่ใช่ความเท่าเทียม
            เชิงตัวเลขเด็ดขาด
          </p>

          <h2>8. ข้อมูลส่วนบุคคลและการรวมข้อมูล</h2>
          <p>
            <strong>8.1.</strong> แพลตฟอร์มประมวลผลข้อมูลส่วนบุคคลตาม
            พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (<strong>“PDPA”</strong>)
            มข. เป็นผู้ควบคุมข้อมูล
          </p>
          <p>
            <strong>8.2.</strong> เมื่อทำได้ ตัวระบุของบุคลากรจะถูก hash
            ที่ต้นทาง ตารางผลรวมที่มีจำนวนน้อยกว่าห้าคน (เกณฑ์การไม่ระบุตัวตน
            แบบ k-anonymity เท่ากับ 5) จะถูกระงับการแสดงผล
          </p>
          <p>
            <strong>8.3.</strong> คุณสมบัติการแบ่งปันโปรไฟล์สาธารณะเป็นแบบสมัครใจ
            โดยปิดเป็นค่าเริ่มต้นและไม่เปิดใช้งานโดยปราศจากการกระทำที่ชัดแจ้ง
            ของผู้ใช้
          </p>

          <h2>9. คำแปล</h2>
          <p>
            ในกรณีที่แพลตฟอร์มแสดงข้อความที่แปลจากภาษาไทยเป็นภาษาอังกฤษ
            หรือกลับกัน คำแปลจัดให้บนพื้นฐานความพยายามที่ดีที่สุดและอาจไม่ถ่ายทอด
            ทุกแง่มุมของภาษาต้นฉบับ ข้อความในภาษาดั้งเดิมถือเป็นข้อมูลอ้างอิงทาง
            กฎหมาย วิชาการ และกฎระเบียบ
          </p>

          <h2>10. เนื้อหาและลิงก์ของบุคคลที่สาม</h2>
          <p>
            การกล่าวอ้างถึงเครื่องมือ ไลบรารี แหล่งข้อมูล หรือ URL ภายนอก
            ของบุคคลที่สาม จัดให้เพื่อเป็นข้อมูลเท่านั้น การรวมไว้ไม่ถือเป็น
            การรับรอง การแนะนำ หรือการรับประกันใด ๆ มข. ไม่รับผิดชอบต่อ
            เนื้อหา ความถูกต้อง หรือความพร้อมใช้งานของแหล่งของบุคคลที่สาม
          </p>

          <h2>11. ความเป็นปัจจุบันของข้อมูล</h2>
          <p>
            ข้อมูลบนแพลตฟอร์มได้รับการอัปเดตในจังหวะที่เหมาะสมกับแหล่งที่มา
            แต่ละแห่ง มข. ไม่รับประกันว่าผลลัพธ์ใด ๆ จะเป็นปัจจุบัน ณ ขณะใดขณะหนึ่ง
            ผู้ตรวจสอบควรพิจารณาตราเวลาความสดใหม่ที่แสดงบนกราฟและตัวชี้วัด
            แต่ละชิ้น
          </p>

          <h2>12. บันทึกในระบบ Decision Workspace</h2>
          <p>
            การตัดสินใจ ขั้นความก้าวหน้า ผู้อนุมัติ และการทบทวนผลลัพธ์ที่บันทึก
            ไว้ในระบบ Decision Workspace ของแพลตฟอร์มเป็นเพียงบันทึกภายในของสถาบัน
            เท่านั้น ไม่ถือเป็นเอกสารทางกฎหมายจนกว่าจะได้รับการจัดทำอย่างเป็น
            ทางการผ่านช่องทางการตัดสินใจของ มข. แยกต่างหาก
          </p>

          <h2>13. การพึ่งพาโดยรับความเสี่ยงเอง</h2>
          <p>
            การพึ่งพาเนื้อหาของแพลตฟอร์มเป็นความเสี่ยงของผู้ใช้เอง มข. จะไม่
            รับผิดชอบต่อการกระทำหรือการละเว้นใด ๆ ที่อาศัยเนื้อหาของแพลตฟอร์ม
            เว้นแต่ความรับผิดดังกล่าวจะไม่อาจยกเว้นได้ตามกฎหมาย
          </p>

          <h2>14. การปรับปรุงคำชี้แจงฉบับนี้</h2>
          <p>
            มข. อาจปรับปรุงคำชี้แจงฉบับนี้เป็นครั้งคราว การปรับปรุงที่มีนัยสำคัญ
            จะประกาศผ่านแพลตฟอร์ม วันที่มีผลบังคับใช้และหมายเลขเวอร์ชันด้านบน
            เป็นการระบุเวอร์ชันปัจจุบัน
          </p>

          <h2>15. การติดต่อ</h2>
          <p>สำหรับข้อสอบถามเกี่ยวกับคำชี้แจงฉบับนี้ โปรดติดต่อ:</p>
          <p>
            สำนักงานรองอธิการบดีฝ่ายการศึกษาและดิจิทัล
            <br />
            มหาวิทยาลัยขอนแก่น
            <br />
            เลขที่ 123 หมู่ 16 ถนนมิตรภาพ
            <br />
            ตำบลในเมือง อำเภอเมืองขอนแก่น
            <br />
            จังหวัดขอนแก่น 40002 ประเทศไทย
            <br />
            อีเมล: <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
    />
  );
}
