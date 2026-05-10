import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms & Conditions · KKU Curriculum Landscape',
};

const LAST_UPDATED = '10 May 2026';

export default function TermsPage() {
  return (
    <LegalPage
      titleEn="Terms and Conditions"
      titleTh="ข้อกำหนดและเงื่อนไขการใช้งาน"
      lastUpdated={LAST_UPDATED}
      bodyEn={
        <>
          <p>
            By signing in to or using the KKU Curriculum Landscape platform, you agree
            to the following terms. If you do not agree, you must not use the platform.
          </p>

          <h3>1. Authorised users</h3>
          <p>
            Access is limited to authenticated Khon Kaen University staff, students,
            members of the University Council, and partners explicitly authorised by
            the University. Account credentials are personal — you must not share them.
          </p>

          <h3>2. Acceptable use</h3>
          <p>You agree to:</p>
          <ul>
            <li>Use the platform only for legitimate KKU governance, academic, and operational purposes;</li>
            <li>Treat all data, methodologies, and AI outputs with appropriate confidentiality;</li>
            <li>Not attempt to bypass access controls, scrape data, or reverse-engineer the platform;</li>
            <li>Not introduce malware, perform load attacks, or otherwise interfere with the service;</li>
            <li>Comply with the Personal Data Protection Act B.E. 2562 (PDPA) when handling personal data exposed by the platform.</li>
          </ul>

          <h3>3. Council-readiness disclaimer</h3>
          <p>
            All analytical outputs (health scores, gap analyses, scenarios,
            benchmarking comparisons, AI-generated narratives) are produced under
            documented methodology versions and are intended to <strong>support</strong>{' '}
            decision-making, not to replace professional judgement. Outputs flagged as{' '}
            <em>preview-quality</em> or carrying low data completeness must not be cited
            in binding decisions.
          </p>

          <h3>4. AI-generated content</h3>
          <p>
            The platform uses large language models to summarise and reason over
            curated data. All AI outputs carry confidence scores and source citations.
            AI-generated text is <strong>advisory</strong>; users must verify content
            against the underlying methodology and source data before relying on it for
            consequential decisions.
          </p>

          <h3>5. Data retention and audit</h3>
          <p>
            Every mutation, AI inference, and PDF generation is audit-logged. Sign-in
            events, theme preferences, decision actions, and download events may be
            retained as required for governance purposes. By using the platform you
            acknowledge this logging.
          </p>

          <h3>6. Public profile sharing</h3>
          <p>
            Users may opt in to making their profile publicly accessible at a unique
            URL. By enabling this feature, you consent to the public display of your
            name, rank, faculty, education history, publications, and other professional
            information shown on your profile. You may disable or regenerate the link at
            any time.
          </p>

          <h3>7. No warranty</h3>
          <p>
            The platform is provided <em>as is</em>, without warranty of any kind,
            express or implied. Khon Kaen University does not warrant that the
            platform will be uninterrupted, error-free, or fit for any particular
            purpose.
          </p>

          <h3>8. Limitation of liability</h3>
          <p>
            To the maximum extent permitted by Thai law, neither Khon Kaen University
            nor the platform's authors shall be liable for any indirect, incidental,
            special, or consequential damages arising from the use of, or inability to
            use, the platform.
          </p>

          <h3>9. Modification of terms</h3>
          <p>
            Khon Kaen University reserves the right to modify these terms at any time.
            Material changes will be announced through the platform's notification
            system. Continued use after such changes constitutes acceptance.
          </p>

          <h3>10. Governing law</h3>
          <p>
            These terms are governed by the laws of Thailand. Any dispute shall be
            resolved by the courts of Khon Kaen.
          </p>

          <h3>Contact</h3>
          <p>
            <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
      bodyTh={
        <>
          <p>
            การลงชื่อเข้าใช้หรือใช้งานแพลตฟอร์ม KKU Curriculum Landscape
            ถือว่าท่านได้ตกลงตามข้อกำหนดและเงื่อนไขดังต่อไปนี้
            หากไม่ตกลง ขอให้ท่านงดใช้งานแพลตฟอร์ม
          </p>

          <h3>1. ผู้ได้รับสิทธิใช้งาน</h3>
          <p>
            การเข้าใช้งานจำกัดเฉพาะบุคลากร นักศึกษา สมาชิกสภามหาวิทยาลัย
            และพันธมิตรของมหาวิทยาลัยขอนแก่นที่ได้รับอนุญาตอย่างชัดเจน บัญชีผู้ใช้
            เป็นของส่วนบุคคล ห้ามเปิดเผยรหัสผ่านหรือใช้บัญชีร่วมกับผู้อื่น
          </p>

          <h3>2. การใช้งานที่ยอมรับได้</h3>
          <p>ท่านตกลงที่จะ:</p>
          <ul>
            <li>ใช้แพลตฟอร์มเพื่อภารกิจด้านธรรมาภิบาล การศึกษา และการบริหารของ มข. เท่านั้น</li>
            <li>รักษาความลับของข้อมูล วิธีการ และผลลัพธ์ AI ตามความเหมาะสม</li>
            <li>ไม่พยายามหลบเลี่ยงระบบควบคุมการเข้าถึง สกัดข้อมูล หรือทำวิศวกรรมย้อนกลับ</li>
            <li>ไม่อัปโหลดมัลแวร์ ก่อภาระโจมตี หรือรบกวนการให้บริการ</li>
            <li>ปฏิบัติตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) ในการจัดการข้อมูลส่วนบุคคลที่ปรากฏ</li>
          </ul>

          <h3>3. ข้อจำกัดความพร้อมต่อสภามหาวิทยาลัย</h3>
          <p>
            ผลลัพธ์การวิเคราะห์ทั้งหมด (คะแนนสุขภาพหลักสูตร การวิเคราะห์ช่องว่าง
            สถานการณ์จำลอง การเปรียบเทียบกับสถาบันคู่เทียบ และเรื่องเล่าที่ AI สร้างขึ้น)
            ผลิตขึ้นภายใต้เวอร์ชันระเบียบวิธีที่จัดทำเอกสารไว้ และมีจุดประสงค์เพื่อ
            <strong>สนับสนุน</strong> การตัดสินใจ ไม่ใช่ทดแทนการวินิจฉัยของผู้เชี่ยวชาญ
            ผลลัพธ์ที่ระบุว่าเป็น <em>คุณภาพแสดงตัวอย่าง (preview-quality)</em>{' '}
            หรือมีความสมบูรณ์ของข้อมูลต่ำต้องไม่นำไปอ้างอิงในการตัดสินใจที่มีผลผูกพัน
          </p>

          <h3>4. เนื้อหาที่สร้างโดย AI</h3>
          <p>
            แพลตฟอร์มใช้โมเดลภาษาขนาดใหญ่เพื่อสรุปและประมวลผลเหตุผลจากข้อมูลที่ได้รับการ
            ดูแลคุณภาพ ผลลัพธ์ AI ทุกชิ้นมีคะแนนความเชื่อมั่นและการอ้างอิงแหล่งที่มา
            เนื้อหาที่ AI สร้างขึ้นมีลักษณะเป็น <strong>คำแนะนำ</strong>
            ผู้ใช้ต้องตรวจสอบเทียบกับวิธีการและข้อมูลต้นทางก่อนนำไปใช้ใน
            การตัดสินใจที่มีนัยสำคัญ
          </p>

          <h3>5. การเก็บรักษาข้อมูลและการตรวจสอบ</h3>
          <p>
            การเปลี่ยนแปลงข้อมูล การเรียกใช้ AI และการสร้าง PDF ทุกครั้งจะถูกบันทึก
            ลงระบบตรวจสอบ เหตุการณ์การลงชื่อเข้าใช้ การตั้งค่าธีม การดำเนินการเกี่ยวกับ
            การตัดสินใจ และการดาวน์โหลดอาจถูกเก็บรักษาตามที่จำเป็นเพื่อการกำกับดูแล
            การใช้งานแพลตฟอร์มถือว่าท่านรับทราบการบันทึกดังกล่าว
          </p>

          <h3>6. การแบ่งปันโปรไฟล์สาธารณะ</h3>
          <p>
            ผู้ใช้สามารถเลือกเปิดให้โปรไฟล์ของตนเข้าถึงได้สาธารณะผ่าน URL เฉพาะ
            การเปิดใช้คุณสมบัตินี้ถือว่าท่านยินยอมให้แสดงต่อสาธารณะซึ่งชื่อ ตำแหน่ง
            คณะ ประวัติการศึกษา ผลงานตีพิมพ์ และข้อมูลทางวิชาชีพอื่น ๆ ที่ปรากฏใน
            หน้าโปรไฟล์ของท่าน ท่านสามารถปิดหรือสร้างลิงก์ใหม่ได้ตลอดเวลา
          </p>

          <h3>7. ไม่มีการรับประกัน</h3>
          <p>
            แพลตฟอร์มให้บริการในลักษณะ <em>"ตามสภาพ"</em>{' '}
            โดยไม่มีการรับประกันใด ๆ ทั้งโดยชัดแจ้งและโดยปริยาย มหาวิทยาลัยขอนแก่น
            ไม่รับประกันว่าแพลตฟอร์มจะให้บริการต่อเนื่อง ปราศจากข้อผิดพลาด
            หรือเหมาะสมกับวัตถุประสงค์เฉพาะใด ๆ
          </p>

          <h3>8. ข้อจำกัดความรับผิด</h3>
          <p>
            เท่าที่กฎหมายไทยอนุญาต มหาวิทยาลัยขอนแก่นและผู้พัฒนาแพลตฟอร์ม
            จะไม่รับผิดชอบต่อความเสียหายทางอ้อม ความเสียหายโดยอุบัติเหตุ
            ความเสียหายพิเศษ หรือความเสียหายต่อเนื่อง ที่เกิดจากการใช้งานหรือ
            การไม่สามารถใช้งานแพลตฟอร์ม
          </p>

          <h3>9. การแก้ไขข้อกำหนด</h3>
          <p>
            มหาวิทยาลัยขอนแก่นสงวนสิทธิ์ในการแก้ไขข้อกำหนดและเงื่อนไขเหล่านี้ทุกเมื่อ
            การเปลี่ยนแปลงสำคัญจะประกาศผ่านระบบแจ้งเตือนของแพลตฟอร์ม การใช้งาน
            ต่อหลังการเปลี่ยนแปลงดังกล่าวถือเป็นการยอมรับ
          </p>

          <h3>10. กฎหมายที่ใช้บังคับ</h3>
          <p>
            ข้อกำหนดเหล่านี้อยู่ภายใต้บังคับของกฎหมายไทย ข้อพิพาทใด ๆ
            จะได้รับการพิจารณาโดยศาลในจังหวัดขอนแก่น
          </p>

          <h3>ติดต่อ</h3>
          <p>
            <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
    />
  );
}
