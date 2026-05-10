import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Disclaimer · KKU Curriculum Landscape' };

const LAST_UPDATED = '10 May 2026';

export default function DisclaimerPage() {
  return (
    <LegalPage
      titleEn="Disclaimer"
      titleTh="คำชี้แจง"
      lastUpdated={LAST_UPDATED}
      bodyEn={
        <>
          <p>
            The KKU Curriculum Landscape is a strategic decision-support platform.
            Outputs are <strong>advisory</strong> and intended to inform — not replace —
            the judgement of the University Council, top management, deans, department
            heads, and analysts.
          </p>

          <h3>Data quality</h3>
          <p>
            The platform integrates data from KKU institutional systems (Registry, HR,
            Finance, Publications) and external sources (KMITL Skill Mapping, OpenAlex,
            and others). Each data source carries:
          </p>
          <ul>
            <li>A freshness timestamp shown on every chart and metric;</li>
            <li>A provenance drawer documenting the source, fetch cadence, and known caveats;</li>
            <li>A methodology version stamp on every derived indicator.</li>
          </ul>
          <p>
            Some sources are still in their <strong>30-day green-history evaluation
            window</strong>. Their outputs are clearly flagged as preview-quality. They
            should not be cited in binding decisions until the evaluation period has
            cleared.
          </p>

          <h3>AI-generated content</h3>
          <p>
            The platform's AI Analyst, expertise summaries, and trend briefs are
            produced by large language models. These models can:
          </p>
          <ul>
            <li>Misinterpret nuanced data, especially Thai-language text;</li>
            <li>Generalise from limited samples;</li>
            <li>Occasionally fabricate plausible-sounding but inaccurate details (hallucination).</li>
          </ul>
          <p>
            Every AI output carries a confidence score and source citations. Users must
            verify AI-generated content against the underlying methodology and source
            data before acting on it. The platform's safety guardrails refuse certain
            request categories (personal information, salary, prompt-injection
            patterns); refusals are logged for governance review.
          </p>

          <h3>Methodology versions</h3>
          <p>
            Every metric carries a methodology version (e.g. <em>health-score.v1</em>,{' '}
            <em>forecasting.v1</em>). Documentation lives in the <code>docs/methodologies/</code>{' '}
            tree and is versioned in git. When a methodology evolves, prior outputs are
            preserved and new outputs are stamped with the new version — historical
            comparability is intentional, but cross-version comparisons require care.
          </p>

          <h3>Forecasting and projections</h3>
          <p>
            Demand forecasts, scenario projections, and confidence bands are based on
            the methodology version current at the time of computation. They are{' '}
            <strong>visual indicators of uncertainty, not coverage guarantees</strong>.
            Actual outcomes may diverge materially due to policy shifts, demographic
            changes, market conditions, or external shocks not captured in the model.
          </p>

          <h3>Benchmarking and peer comparison</h3>
          <p>
            Peer comparisons across institutions and countries draw on subject
            taxonomies that are not perfectly aligned (THE, QS, SCImago, and KKU's
            internal department structure use different schemas). Comparisons are
            best-effort and the basis for each comparison is surfaced in the
            provenance drawer. Treat comparisons as directional, not literal.
          </p>

          <h3>Personal data</h3>
          <p>
            Personal data is processed in accordance with the Personal Data Protection
            Act B.E. 2562 (PDPA). Faculty employee numbers are hashed at the source
            wherever possible; aggregate cells with fewer than 5 individuals are
            suppressed. Public profile sharing is opt-in and never enabled by default.
          </p>

          <h3>External sources and translations</h3>
          <p>
            Where the platform displays text translated from Thai to English (or vice
            versa), translations are best-effort and may not preserve every nuance of
            the original. The original-language text remains authoritative for legal
            and academic purposes.
          </p>

          <h3>No endorsement</h3>
          <p>
            References to third-party tools, libraries, and data sources do not
            constitute endorsement. Their inclusion reflects technical fit at the time
            of integration.
          </p>

          <h3>Use of decisions captured in the Decision Workspace</h3>
          <p>
            Decisions, milestones, and outcome reviews recorded in the Decision
            Workspace are internal records. They are not legal instruments unless
            separately formalised through the University's official decision-making
            channels.
          </p>
        </>
      }
      bodyTh={
        <>
          <p>
            แพลตฟอร์ม KKU Curriculum Landscape เป็นเครื่องมือสนับสนุนการตัดสินใจ
            เชิงกลยุทธ์ ผลลัพธ์มีลักษณะเป็น <strong>คำแนะนำ</strong>
            มีจุดประสงค์เพื่อประกอบการพิจารณาของสภามหาวิทยาลัย ผู้บริหารระดับสูง
            คณบดี หัวหน้าภาควิชา และนักวิเคราะห์ ไม่ใช่เพื่อทดแทนการวินิจฉัย
          </p>

          <h3>คุณภาพของข้อมูล</h3>
          <p>
            แพลตฟอร์มเชื่อมต่อข้อมูลจากระบบของ มข. (ทะเบียน บุคลากร การเงิน ผลงานตีพิมพ์)
            และแหล่งภายนอก (KMITL Skill Mapping, OpenAlex และอื่น ๆ) แหล่งข้อมูลแต่ละแห่ง
            มี:
          </p>
          <ul>
            <li>ตราเวลาความสดใหม่แสดงบนกราฟและตัวชี้วัดทุกชิ้น</li>
            <li>แผงข้อมูลที่มา (provenance) ระบุแหล่งที่มา ความถี่ในการดึงข้อมูล และข้อจำกัดที่ทราบ</li>
            <li>ตราเวอร์ชันระเบียบวิธีบนตัวชี้วัดที่สังเคราะห์ขึ้นทุกชิ้น</li>
          </ul>
          <p>
            แหล่งข้อมูลบางแหล่งยังอยู่ใน{' '}
            <strong>ระยะเวลาประเมินคุณภาพ 30 วัน (green-history)</strong>{' '}
            ผลลัพธ์ของแหล่งดังกล่าวถูกระบุไว้อย่างชัดเจนว่าเป็นคุณภาพแสดงตัวอย่าง
            ไม่ควรนำไปอ้างอิงในการตัดสินใจที่มีผลผูกพันจนกว่าจะผ่านระยะประเมินแล้ว
          </p>

          <h3>เนื้อหาที่สร้างโดย AI</h3>
          <p>
            AI Analyst สรุปความเชี่ยวชาญ และบทสรุปแนวโน้มในแพลตฟอร์มนี้สร้างขึ้นโดย
            โมเดลภาษาขนาดใหญ่ ซึ่งอาจ:
          </p>
          <ul>
            <li>ตีความข้อมูลที่ละเอียดอ่อนผิดพลาด โดยเฉพาะข้อความภาษาไทย</li>
            <li>สรุปจากตัวอย่างที่จำกัด</li>
            <li>สร้างเนื้อหาที่ฟังดูสมเหตุสมผลแต่ไม่ถูกต้องเป็นครั้งคราว (hallucination)</li>
          </ul>
          <p>
            ผลลัพธ์ AI ทุกชิ้นมีคะแนนความเชื่อมั่นและการอ้างอิงแหล่งที่มา ผู้ใช้
            ต้องตรวจสอบเทียบกับวิธีการและข้อมูลต้นทางก่อนนำไปใช้ ระบบป้องกัน
            ของแพลตฟอร์มจะปฏิเสธคำขอบางประเภท (ข้อมูลส่วนบุคคล เงินเดือน
            รูปแบบ prompt injection) และบันทึกการปฏิเสธไว้เพื่อการตรวจสอบ
          </p>

          <h3>เวอร์ชันของระเบียบวิธี</h3>
          <p>
            ตัวชี้วัดทุกชิ้นมีตราเวอร์ชันระเบียบวิธี (เช่น <em>health-score.v1</em>,{' '}
            <em>forecasting.v1</em>) เอกสารระเบียบวิธีอยู่ภายใต้ตัวชี้วัดทุกชิ้น
            <code>docs/methodologies/</code> และมีการจัดเวอร์ชันใน git เมื่อระเบียบวิธี
            พัฒนา ผลลัพธ์เดิมจะถูกเก็บรักษาไว้และผลลัพธ์ใหม่จะมีตราเวอร์ชันใหม่
            การเปรียบเทียบในประวัติยังคงทำได้ แต่การเปรียบเทียบข้ามเวอร์ชันต้อง
            ใช้ความระมัดระวัง
          </p>

          <h3>การพยากรณ์และการคาดการณ์</h3>
          <p>
            การพยากรณ์อุปสงค์ การคาดการณ์สถานการณ์จำลอง และช่วงความเชื่อมั่น
            อ้างอิงเวอร์ชันระเบียบวิธีที่ใช้ ณ เวลาคำนวณ ผลลัพธ์เหล่านี้เป็น{' '}
            <strong>เครื่องบ่งชี้ความไม่แน่นอนเชิงภาพ ไม่ใช่การรับประกันความครอบคลุม</strong>
            ผลลัพธ์จริงอาจคลาดเคลื่อนอย่างมีนัยสำคัญจากการเปลี่ยนแปลงเชิงนโยบาย
            ประชากรศาสตร์ ภาวะตลาด หรือเหตุภายนอกที่ไม่ได้ถูกครอบคลุมในแบบจำลอง
          </p>

          <h3>การเปรียบเทียบกับสถาบันคู่เทียบ</h3>
          <p>
            การเปรียบเทียบข้ามสถาบันและประเทศใช้การจำแนกประเภทวิชาที่ไม่ได้สอดคล้อง
            อย่างสมบูรณ์ (THE, QS, SCImago และโครงสร้างภาควิชาภายในของ มข.
            ใช้ระบบจำแนกที่แตกต่างกัน) การเปรียบเทียบจึงเป็นความพยายามที่ดีที่สุด
            และฐานของการเปรียบเทียบจะปรากฏในแผงข้อมูลที่มา
            ควรพิจารณาผลการเปรียบเทียบในเชิงทิศทาง ไม่ใช่ในเชิงตัวเลขเด็ดขาด
          </p>

          <h3>ข้อมูลส่วนบุคคล</h3>
          <p>
            ข้อมูลส่วนบุคคลได้รับการประมวลผลตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล
            พ.ศ. 2562 (PDPA) เลขประจำตัวบุคลากรถูก hash ที่แหล่งกำเนิดเมื่อทำได้
            ตารางผลรวมที่มีจำนวนน้อยกว่า 5 คนจะถูกระงับการแสดงผล
            การแบ่งปันโปรไฟล์สาธารณะเป็นแบบสมัครใจและปิดเป็นค่าเริ่มต้นเสมอ
          </p>

          <h3>แหล่งภายนอกและคำแปล</h3>
          <p>
            ในส่วนที่แพลตฟอร์มแสดงข้อความที่แปลจากภาษาไทยเป็นภาษาอังกฤษ (หรือกลับกัน)
            คำแปลเป็นความพยายามที่ดีที่สุดและอาจไม่รักษาความหมายดั้งเดิมไว้ทุกแง่มุม
            ข้อความในภาษาดั้งเดิมถือเป็นข้อมูลอ้างอิงทางกฎหมายและทางวิชาการ
          </p>

          <h3>การไม่รับรองคุณภาพ</h3>
          <p>
            การกล่าวอ้างถึงเครื่องมือ ไลบรารี และแหล่งข้อมูลของบุคคลที่สามไม่ถือเป็น
            การรับรองคุณภาพ การรวมไว้สะท้อนเพียงความเหมาะสมทางเทคนิคในขณะนำเข้า
          </p>

          <h3>การใช้ข้อมูลในระบบบันทึกการตัดสินใจ</h3>
          <p>
            การตัดสินใจ ขั้นความก้าวหน้า และการทบทวนผลลัพธ์ที่บันทึกไว้ในระบบ Decision
            Workspace เป็นบันทึกภายในเท่านั้น ไม่ถือเป็นเอกสารทางกฎหมายเว้นแต่จะได้รับ
            การจัดทำอย่างเป็นทางการผ่านช่องทางการตัดสินใจของมหาวิทยาลัยแยกต่างหาก
          </p>
        </>
      }
    />
  );
}
