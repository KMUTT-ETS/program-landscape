import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms and Conditions of Use · Program Landscape',
};

const EFFECTIVE_DATE_EN = '27 August 2026';
const EFFECTIVE_DATE_TH = '27 สิงหาคม 2569';
const VERSION = '1.1';

export default function TermsPage() {
  return (
    <LegalPage
      titleEn="Terms and Conditions of Use"
      titleTh="ข้อกำหนดและเงื่อนไขการใช้งาน"
      lastUpdatedEn={`Effective ${EFFECTIVE_DATE_EN} · Version ${VERSION}`}
      lastUpdatedTh={`มีผลบังคับใช้ ${EFFECTIVE_DATE_TH} · เวอร์ชัน ${VERSION}`}
      bodyEn={
        <>
          <h2>1. Parties and Acceptance</h2>
          <p>
            <strong>1.1.</strong> These Terms and Conditions of Use (the{' '}
            <strong>“Terms”</strong>) constitute a binding agreement between{' '}
            <strong>Khon Kaen University</strong>, a juristic person established under
            the Khon Kaen University Act B.E. 2509 (1966) and presently governed by
            the Khon Kaen University Act B.E. 2558 (2015), having its principal place
            of business at 123 Moo 16, Mittraphap Road, Tambon Nai Mueang, Mueang
            Khon Kaen District, Khon Kaen Province 40002, Thailand (hereinafter{' '}
            <strong>“KKU”</strong>, <strong>“we”</strong>, <strong>“us”</strong>, or{' '}
            <strong>“our”</strong>) and you, the user of the Program Landscape
            platform (hereinafter <strong>“you”</strong> or <strong>“User”</strong>).
          </p>
          <p>
            <strong>1.2.</strong> By signing in to, accessing, or otherwise using the
            Platform (as defined below), you confirm that you have read, understood,
            and agree to be bound by these Terms, the{' '}
            <a href="/copyright">Copyright Notice</a>, and the{' '}
            <a href="/disclaimer">Disclaimer</a>. If you do not agree to any provision
            of these Terms, you must not access or use the Platform.
          </p>

          <h2>2. Definitions</h2>
          <p>In these Terms, unless the context otherwise requires:</p>
          <ul>
            <li>
              <strong>“Platform”</strong> means the Program Landscape web
              application served at https://program-landscape.kku.ac.th, together
              with all related source code, content, documentation, and services
              delivered through it.
            </li>
            <li>
              <strong>“Authorised User”</strong> means a member of the KKU University
              Council, KKU senior management, a dean, a department head, a member of
              KKU staff or student body, or a partner explicitly authorised by KKU
              in writing.
            </li>
            <li>
              <strong>“Content”</strong> means all data, text, charts, narratives,
              forecasts, AI-generated outputs, methodology documents, and any other
              material made available through the Platform.
            </li>
            <li>
              <strong>“Personal Data”</strong> has the meaning given to it in the
              Personal Data Protection Act B.E. 2562 (2019) of Thailand (the{' '}
              <strong>“PDPA”</strong>).
            </li>
            <li>
              <strong>“Council-Ready Output”</strong> means a Platform output
              expressly designated within the Platform as suitable for use in
              binding governance decisions and not marked as preview-quality.
            </li>
          </ul>

          <h2>3. Eligibility and Account Security</h2>
          <p>
            <strong>3.1.</strong> Access to the Platform is restricted to Authorised
            Users authenticated via KKU Single Sign-On (SSO) or, in limited
            development contexts, by pre-provisioned credentials issued by an
            administrator.
          </p>
          <p>
            <strong>3.2.</strong> You are responsible for safeguarding your
            credentials. You shall not share, transfer, sell, or permit the use of
            your account by any other person. You shall promptly notify KKU of any
            actual or suspected unauthorised access.
          </p>
          <p>
            <strong>3.3.</strong> KKU may suspend or terminate access at any time,
            without notice, where required to protect the integrity of the Platform
            or to comply with applicable law.
          </p>

          <h2>4. Permitted Use</h2>
          <p>
            <strong>4.1.</strong> KKU grants you a limited, non-exclusive,
            non-transferable, revocable licence to access and use the Platform solely
            for the internal governance, academic, research, and operational
            purposes of KKU.
          </p>
          <p>
            <strong>4.2.</strong> You shall use the Platform in good faith, with due
            diligence, and in accordance with applicable laws, KKU regulations,
            and these Terms.
          </p>
          <p>
            <strong>4.3.</strong> These Terms govern your use of the instance of the
            Platform operated by KKU. They do not restrict the rights granted to the
            public in the Platform's source code, documentation, and design assets
            under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0
            International Licence (CC BY-NC-SA 4.0), which are set out in the{' '}
            <a href="/copyright">Copyright Notice</a>. Conversely, those rights do not
            in themselves confer any right of access to this instance or to the
            Content held in it.
          </p>

          <h2>5. Prohibited Conduct</h2>
          <p>You shall not, and shall not attempt to:</p>
          <ol>
            <li>
              circumvent, disable, or interfere with security features, access
              controls, audit logging, or rate limits;
            </li>
            <li>
              scrape, harvest, or extract data from the Platform by automated means
              not authorised in writing by KKU;
            </li>
            <li>
              reverse-engineer, decompile, or disassemble any third-party component of
              the Platform, or any component whose own licence does not permit it,
              except to the extent expressly permitted by law and not capable of being
              waived; this restriction does not apply to the source code that KKU
              publishes under CC BY-NC-SA 4.0, which you may study, adapt, and
              redistribute in accordance with that licence;
            </li>
            <li>
              introduce viruses, worms, trojan horses, ransomware, or other malicious
              code, or perform any denial-of-service or load-amplification activity;
            </li>
            <li>
              upload, transmit, or distribute through the Platform any unlawful,
              defamatory, obscene, infringing, or fraudulent material;
            </li>
            <li>
              use Content obtained from the Platform to misrepresent, supplant, or
              circumvent the institutional decision-making processes of KKU;
            </li>
            <li>
              process Personal Data through the Platform in a manner inconsistent
              with the PDPA or with the lawful purposes for which the data were
              collected.
            </li>
          </ol>

          <h2>6. Intellectual Property</h2>
          <p>
            <strong>6.1.</strong> All intellectual property rights in the Platform
            are owned by KKU or its licensors. Use of the Platform does not transfer
            to you any right, title, or interest in such intellectual property,
            except for the limited licence granted in Article 4.
          </p>
          <p>
            <strong>6.2.</strong> The basis of copyright ownership is set out in the{' '}
            <a href="/copyright">Copyright Notice</a>, which forms an integral part of
            these Terms.
          </p>
          <p>
            <strong>6.3.</strong> KKU licenses the Platform's source code,
            documentation, and design assets to the public under CC BY-NC-SA 4.0, while
            remaining their copyright owner. That licence does not extend to KKU's
            trademarks and institutional identity, to third-party components, or to any
            KKU data; those exclusions are set out in the Copyright Notice. Article 4.1
            remains the sole basis on which you may access this instance of the
            Platform.
          </p>

          <h2>7. AI-Generated Content; Advisory Nature</h2>
          <p>
            <strong>7.1.</strong> The Platform employs large language models and
            related techniques to summarise, classify, and reason over institutional
            data. AI-generated content is advisory in nature and carries
            machine-estimated confidence scores together with source citations.
          </p>
          <p>
            <strong>7.2.</strong> AI-generated content shall not be relied upon for
            any binding decision without independent verification against the
            underlying methodology and source data. KKU does not warrant the
            accuracy, completeness, or fitness for any particular purpose of any
            AI-generated content.
          </p>
          <p>
            <strong>7.3.</strong> Outputs designated within the Platform as{' '}
            <em>preview-quality</em>, low-confidence, or carrying low data
            completeness shall not be cited in binding governance decisions.
          </p>

          <h2>8. Public Profile Sharing</h2>
          <p>
            <strong>8.1.</strong> The Platform offers an opt-in feature permitting
            Authorised Users to publish a personal academic profile at a public
            URL. By enabling this feature, you provide your express consent to the
            public display of the profile information specified at the time of
            enablement.
          </p>
          <p>
            <strong>8.2.</strong> You may withdraw consent at any time by disabling
            the feature within the Platform; the public URL will return a not-found
            response from the time of withdrawal forward.
          </p>

          <h2>9. Personal Data and Privacy</h2>
          <p>
            <strong>9.1.</strong> KKU is the data controller in respect of Personal
            Data processed through the Platform within the meaning of the PDPA.
          </p>
          <p>
            <strong>9.2.</strong> Personal Data is processed in accordance with the
            PDPA on the lawful bases of legitimate interest, performance of public
            tasks of KKU, and, where applicable, your consent.
          </p>
          <p>
            <strong>9.3.</strong> You may exercise your rights under the PDPA
            (including rights of access, rectification, erasure, restriction,
            objection, and data portability, subject to applicable exceptions) by
            contacting the address set out in Article 18.
          </p>
          <p>
            <strong>9.4.</strong> The Platform maintains audit logs of authentication
            events, data mutations, AI inferences, PDF generations, and export
            events to support governance, security, and accountability. You
            acknowledge such logging by use of the Platform.
          </p>

          <h2>10. Confidentiality</h2>
          <p>
            <strong>10.1.</strong> Content accessed through the Platform—including
            Personal Data relating to students and staff, programme-level financial and
            cost analysis, evaluation and data-quality results, draft and unpublished
            University Council material, and any other Content marked as confidential
            or which by its nature ought reasonably to be regarded as
            confidential—shall not be disclosed by you to any third party other than in
            the proper performance of your duties to KKU.
          </p>
          <p>
            <strong>10.2.</strong> Your confidentiality obligation survives
            termination of your access to the Platform.
          </p>
          <p>
            <strong>10.3.</strong> This Article applies to Content. It does not apply
            to the Platform's source code, documentation, and design assets, which KKU
            publishes under CC BY-NC-SA 4.0 and which are therefore not confidential.
            Publication of the software does not make the Content of any running
            instance public and does not release you from this Article.
          </p>

          <h2>11. No Professional Advice</h2>
          <p>
            Content provided through the Platform does not constitute legal,
            financial, accounting, regulatory, medical, or other professional
            advice. You should seek qualified professional advice before relying on
            any Platform output for purposes outside KKU's internal governance.
          </p>

          <h2>12. Disclaimer of Warranties</h2>
          <p>
            <strong>12.1.</strong> THE PLATFORM IS PROVIDED ON AN “AS IS” AND “AS
            AVAILABLE” BASIS, WITHOUT WARRANTY OF ANY KIND, EXPRESS, IMPLIED, OR
            STATUTORY, INCLUDING WITHOUT LIMITATION ANY WARRANTY OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY,
            RELIABILITY, OR UNINTERRUPTED OPERATION.
          </p>
          <p>
            <strong>12.2.</strong> KKU does not warrant that the Platform will meet
            your requirements, that defects will be corrected, or that the
            Platform or its underlying infrastructure is free of viruses or other
            harmful components.
          </p>

          <h2>13. Limitation of Liability</h2>
          <p>
            <strong>13.1.</strong> To the fullest extent permitted by the laws of
            the Kingdom of Thailand, neither KKU nor its officers, employees,
            agents, or contractors shall be liable for any indirect, incidental,
            special, exemplary, punitive, or consequential damages, or for any loss
            of profits, revenue, data, or goodwill, arising out of or in connection
            with your use of, or inability to use, the Platform, whether based in
            contract, tort, statute, or any other legal theory.
          </p>
          <p>
            <strong>13.2.</strong> Nothing in these Terms limits or excludes
            liability for fraud, wilful misconduct, gross negligence, or any
            liability that cannot lawfully be limited or excluded.
          </p>

          <h2>14. Indemnification</h2>
          <p>
            You shall indemnify, defend, and hold harmless KKU and its officers,
            employees, agents, and contractors from and against any claims,
            liabilities, damages, losses, and expenses (including reasonable
            attorneys' fees) arising out of or related to your breach of these
            Terms, your misuse of the Platform, or your violation of any law or
            third-party right.
          </p>

          <h2>15. Force Majeure</h2>
          <p>
            KKU shall not be liable for any failure or delay in performance under
            these Terms caused by an event beyond its reasonable control,
            including acts of God, war, terrorism, civil unrest, pandemic,
            governmental order, labour dispute, failure of utilities, internet
            outage, or third-party service failure.
          </p>

          <h2>16. Suspension and Termination</h2>
          <p>
            KKU may, with or without notice, suspend or terminate your access to
            the Platform in whole or in part where (a) you have breached these
            Terms, (b) such action is required by law or by KKU policy, or (c) the
            continued operation of the Platform requires such action. Termination
            does not affect any accrued rights or obligations.
          </p>

          <h2>17. Modifications</h2>
          <p>
            KKU may amend these Terms at any time. Material amendments will be
            announced through the Platform. Your continued use after the effective
            date of an amendment constitutes acceptance of the amended Terms.
          </p>

          <h2>18. Notices</h2>
          <p>Notices to KKU shall be in writing and addressed to:</p>
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

          <h2>19. Governing Law and Jurisdiction</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of
            the Kingdom of Thailand, without regard to its conflict-of-laws
            principles. Any dispute arising out of or in connection with these
            Terms shall be subject to the exclusive jurisdiction of the courts
            of Khon Kaen Province, Thailand.
          </p>

          <h2>20. Severability; Entire Agreement; Waiver; Language</h2>
          <p>
            <strong>20.1. Severability.</strong> If any provision of these Terms is
            held invalid or unenforceable, the remaining provisions shall continue
            in full force and effect.
          </p>
          <p>
            <strong>20.2. Entire agreement.</strong> These Terms, together with the
            Copyright Notice and the Disclaimer, constitute the entire agreement
            between the parties with respect to the Platform and supersede all
            prior understandings.
          </p>
          <p>
            <strong>20.3. No waiver.</strong> Failure by KKU to enforce any
            provision shall not be a waiver of that or any other provision.
          </p>
          <p>
            <strong>20.4. Language.</strong> These Terms are issued in English and
            Thai. In the event of any inconsistency, the Thai version shall
            prevail to the extent permitted by Thai law.
          </p>
        </>
      }
      bodyTh={
        <>
          <h2>1. คู่สัญญาและการตกลง</h2>
          <p>
            <strong>1.1.</strong> ข้อกำหนดและเงื่อนไขการใช้งานฉบับนี้ (ต่อไปนี้เรียกว่า{' '}
            <strong>“ข้อกำหนด”</strong>) เป็นข้อตกลงที่มีผลผูกพันระหว่าง{' '}
            <strong>มหาวิทยาลัยขอนแก่น</strong> ซึ่งเป็นนิติบุคคลที่จัดตั้งขึ้นตาม
            พระราชบัญญัติมหาวิทยาลัยขอนแก่น พ.ศ. 2509 และปัจจุบันอยู่ภายใต้
            พระราชบัญญัติมหาวิทยาลัยขอนแก่น พ.ศ. 2558 มีสำนักงานใหญ่ตั้งอยู่ ณ
            เลขที่ 123 หมู่ 16 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น
            จังหวัดขอนแก่น 40002 ประเทศไทย (ต่อไปนี้เรียกว่า <strong>“มข.”</strong>{' '}
            หรือ <strong>“เรา”</strong>) ฝ่ายหนึ่ง กับท่านในฐานะผู้ใช้แพลตฟอร์ม
            Program Landscape (ต่อไปนี้เรียกว่า <strong>“ท่าน”</strong> หรือ{' '}
            <strong>“ผู้ใช้”</strong>) อีกฝ่ายหนึ่ง
          </p>
          <p>
            <strong>1.2.</strong> การลงชื่อเข้าใช้ การเข้าถึง หรือการใช้แพลตฟอร์ม
            (ตามที่นิยามไว้ด้านล่าง) ถือว่าท่านได้อ่าน เข้าใจ และตกลงผูกพันตามข้อกำหนด
            ฉบับนี้ <a href="/copyright">ประกาศลิขสิทธิ์</a> และ{' '}
            <a href="/disclaimer">คำชี้แจง</a> หากท่านไม่ตกลงตามข้อใดข้อหนึ่ง ขอให้
            ท่านระงับการเข้าถึงและการใช้แพลตฟอร์ม
          </p>

          <h2>2. คำนิยาม</h2>
          <p>ในข้อกำหนดฉบับนี้ เว้นแต่บริบทจะกำหนดเป็นอย่างอื่น:</p>
          <ul>
            <li>
              <strong>“แพลตฟอร์ม”</strong> หมายถึง เว็บแอปพลิเคชัน Program Landscape
              ที่เผยแพร่ผ่าน https://program-landscape.kku.ac.th
              พร้อมด้วยซอร์สโค้ด เนื้อหา เอกสาร และบริการที่เกี่ยวข้องทั้งหมด
            </li>
            <li>
              <strong>“ผู้ใช้ที่ได้รับอนุญาต”</strong> หมายถึง สมาชิกสภามหาวิทยาลัย
              ขอนแก่น ผู้บริหารระดับสูงของ มข. คณบดี หัวหน้าภาควิชา บุคลากร นักศึกษา
              หรือพันธมิตรที่ได้รับอนุญาตเป็นลายลักษณ์อักษรจาก มข.
            </li>
            <li>
              <strong>“เนื้อหา”</strong> หมายถึง ข้อมูล ข้อความ แผนภูมิ เรื่องเล่า
              การพยากรณ์ ผลลัพธ์ที่ AI สร้างขึ้น เอกสารระเบียบวิธี และวัสดุ
              อื่นใดที่จัดให้ผ่านแพลตฟอร์ม
            </li>
            <li>
              <strong>“ข้อมูลส่วนบุคคล”</strong> มีความหมายตามพระราชบัญญัติคุ้มครอง
              ข้อมูลส่วนบุคคล พ.ศ. 2562 (<strong>“PDPA”</strong>)
            </li>
            <li>
              <strong>“ผลลัพธ์พร้อมต่อสภามหาวิทยาลัย”</strong> หมายถึง ผลลัพธ์ของ
              แพลตฟอร์มที่ได้รับการระบุไว้อย่างชัดเจนภายในแพลตฟอร์มว่าเหมาะสมสำหรับ
              การตัดสินใจกำกับดูแลที่มีผลผูกพัน และไม่ได้ถูกระบุว่าเป็นคุณภาพ
              แสดงตัวอย่าง
            </li>
          </ul>

          <h2>3. คุณสมบัติของผู้ใช้และความปลอดภัยของบัญชี</h2>
          <p>
            <strong>3.1.</strong> การเข้าถึงแพลตฟอร์มจำกัดเฉพาะผู้ใช้ที่ได้รับ
            อนุญาตซึ่งยืนยันตัวตนผ่านระบบ Single Sign-On (SSO) ของ มข. หรือใน
            บริบทการพัฒนาที่จำกัด ผ่านบัญชีที่ผู้ดูแลระบบจัดให้ล่วงหน้า
          </p>
          <p>
            <strong>3.2.</strong> ท่านมีหน้าที่รักษาความปลอดภัยของบัญชีผู้ใช้
            ห้ามแบ่งปัน โอน ขาย หรืออนุญาตให้บุคคลอื่นใช้บัญชีของท่าน ท่านต้องแจ้ง
            ให้ มข. ทราบโดยทันทีหากมีการเข้าถึงโดยไม่ได้รับอนุญาตหรือสงสัยว่ามี
          </p>
          <p>
            <strong>3.3.</strong> มข. อาจระงับหรือยุติการเข้าถึงเมื่อใดก็ได้
            โดยมิต้องแจ้งให้ทราบล่วงหน้า เมื่อจำเป็นเพื่อรักษาความสมบูรณ์ของ
            แพลตฟอร์มหรือปฏิบัติตามกฎหมาย
          </p>

          <h2>4. การใช้งานที่ได้รับอนุญาต</h2>
          <p>
            <strong>4.1.</strong> มข. อนุญาตให้ท่านมีสิทธิแบบจำกัด ไม่จำเพาะ
            ไม่อาจโอนได้ และเพิกถอนได้ ในการเข้าถึงและใช้แพลตฟอร์มเพื่อวัตถุประสงค์
            ด้านธรรมาภิบาล การศึกษา การวิจัย และการบริหารงานภายในของ มข. เท่านั้น
          </p>
          <p>
            <strong>4.2.</strong> ท่านต้องใช้แพลตฟอร์มโดยสุจริต ใช้ความระมัดระวัง
            ตามสมควร และปฏิบัติตามกฎหมาย ระเบียบของ มข. และข้อกำหนดฉบับนี้
          </p>
          <p>
            <strong>4.3.</strong> ข้อกำหนดฉบับนี้ใช้บังคับกับการที่ท่านใช้แพลตฟอร์ม
            ฉบับที่ มข. เป็นผู้ให้บริการ มิได้จำกัดสิทธิที่ มข. อนุญาตให้สาธารณชน
            ใช้ในซอร์สโค้ด เอกสาร และสินทรัพย์การออกแบบของแพลตฟอร์ม ภายใต้สัญญาอนุญาต
            ครีเอทีฟคอมมอนส์ แบบแสดงที่มา-ไม่ใช้เพื่อการค้า-อนุญาตแบบเดียวกัน 4.0
            นานาชาติ (CC BY-NC-SA 4.0) ตามที่กำหนดไว้ใน{' '}
            <a href="/copyright">ประกาศลิขสิทธิ์</a> ในทางกลับกัน สิทธิดังกล่าว
            โดยลำพังมิได้ก่อให้เกิดสิทธิในการเข้าถึงแพลตฟอร์มฉบับนี้
            หรือเนื้อหาที่จัดเก็บอยู่ในแพลตฟอร์มแต่อย่างใด
          </p>

          <h2>5. การกระทำที่ห้าม</h2>
          <p>ท่านจะไม่กระทำการ หรือพยายามกระทำการดังต่อไปนี้:</p>
          <ol>
            <li>
              หลบเลี่ยง ทำให้ใช้การไม่ได้ หรือรบกวนระบบรักษาความปลอดภัย ระบบควบคุม
              การเข้าถึง การบันทึกการตรวจสอบ หรือการจำกัดอัตราคำขอ;
            </li>
            <li>
              เก็บเกี่ยว สกัด หรือขุดข้อมูลจากแพลตฟอร์มด้วยวิธีอัตโนมัติที่ มข.
              มิได้อนุญาตเป็นลายลักษณ์อักษร;
            </li>
            <li>
              ทำวิศวกรรมย้อนกลับ ถอดประกอบ หรือถอดรหัสส่วนประกอบของบุคคลที่สาม
              ในแพลตฟอร์ม หรือส่วนประกอบใดที่สัญญาอนุญาตของส่วนประกอบนั้นมิได้ยอมให้
              กระทำ เว้นแต่กฎหมายอนุญาตและสิทธินั้นไม่อาจสละได้ ทั้งนี้ ข้อห้ามนี้
              ไม่ใช้บังคับกับซอร์สโค้ดที่ มข. เผยแพร่ภายใต้สัญญาอนุญาต CC BY-NC-SA 4.0
              ซึ่งท่านอาจศึกษา ดัดแปลง และเผยแพร่ต่อได้ตามสัญญาอนุญาตดังกล่าว;
            </li>
            <li>
              นำเข้ามัลแวร์ เวิร์ม ม้าโทรจัน แรนซัมแวร์ หรือก่อภาระโจมตี
              ปฏิเสธการให้บริการ หรือขยายภาระโหลด;
            </li>
            <li>
              อัปโหลด ส่งต่อ หรือเผยแพร่ผ่านแพลตฟอร์มซึ่งวัตถุที่ผิดกฎหมาย หมิ่นประมาท
              ลามกอนาจาร ละเมิดสิทธิ หรือฉ้อโกง;
            </li>
            <li>
              ใช้เนื้อหาที่ได้จากแพลตฟอร์มเพื่อบิดเบือน แทนที่ หรือหลบเลี่ยง
              กระบวนการตัดสินใจของสถาบันของ มข.;
            </li>
            <li>
              ประมวลผลข้อมูลส่วนบุคคลผ่านแพลตฟอร์มในลักษณะที่ขัดกับ PDPA
              หรือกับวัตถุประสงค์อันชอบด้วยกฎหมายที่เก็บข้อมูลมา
            </li>
          </ol>

          <h2>6. ทรัพย์สินทางปัญญา</h2>
          <p>
            <strong>6.1.</strong> สิทธิในทรัพย์สินทางปัญญาทั้งหมดในแพลตฟอร์ม
            เป็นของ มข. หรือผู้ออกใบอนุญาตให้แก่ มข. การใช้แพลตฟอร์มไม่ก่อให้เกิด
            การโอนสิทธิ ชื่อ หรือผลประโยชน์ใด ๆ ในทรัพย์สินทางปัญญาดังกล่าวให้แก่
            ท่าน เว้นแต่สิทธิแบบจำกัดที่อนุญาตในข้อ 4
          </p>
          <p>
            <strong>6.2.</strong> ฐานความเป็นเจ้าของลิขสิทธิ์ปรากฏใน{' '}
            <a href="/copyright">ประกาศลิขสิทธิ์</a> ซึ่งถือเป็นส่วนหนึ่งของ
            ข้อกำหนดฉบับนี้
          </p>
          <p>
            <strong>6.3.</strong> มข. อนุญาตให้สาธารณชนใช้สิทธิในซอร์สโค้ด เอกสาร
            และสินทรัพย์การออกแบบของแพลตฟอร์ม ภายใต้สัญญาอนุญาต CC BY-NC-SA 4.0
            โดย มข. ยังคงเป็นเจ้าของลิขสิทธิ์ในสิ่งดังกล่าว สัญญาอนุญาตนี้มิได้
            ครอบคลุมถึงเครื่องหมายการค้าและเครื่องหมายแสดงตัวตนของสถาบันของ มข.
            ส่วนประกอบของบุคคลที่สาม หรือข้อมูลใด ๆ ของ มข. โดยข้อยกเว้นดังกล่าว
            กำหนดไว้ในประกาศลิขสิทธิ์ ทั้งนี้ ข้อ 4.1 ยังคงเป็นฐานเพียงประการเดียว
            ที่ให้ท่านเข้าถึงแพลตฟอร์มฉบับนี้ได้
          </p>

          <h2>7. เนื้อหาที่สร้างโดย AI; ลักษณะเป็นคำแนะนำ</h2>
          <p>
            <strong>7.1.</strong> แพลตฟอร์มใช้โมเดลภาษาขนาดใหญ่และเทคนิคที่
            เกี่ยวข้องเพื่อสรุป จำแนก และประมวลผลเหตุผลจากข้อมูลของสถาบัน เนื้อหา
            ที่ AI สร้างขึ้นมีลักษณะเป็นคำแนะนำและมีคะแนนความเชื่อมั่นที่
            ประมาณการโดยเครื่อง พร้อมการอ้างอิงแหล่งที่มา
          </p>
          <p>
            <strong>7.2.</strong> ห้ามนำเนื้อหาที่ AI สร้างขึ้นไปใช้ในการตัดสินใจ
            ที่มีผลผูกพันโดยไม่ตรวจสอบเทียบกับวิธีการและข้อมูลต้นทางอย่างเป็นอิสระ
            มข. ไม่รับรองความถูกต้อง ความครบถ้วน หรือความเหมาะสมต่อวัตถุประสงค์
            เฉพาะใด ๆ ของเนื้อหาที่ AI สร้างขึ้น
          </p>
          <p>
            <strong>7.3.</strong> ผลลัพธ์ที่ระบุไว้ภายในแพลตฟอร์มว่าเป็น{' '}
            <em>คุณภาพแสดงตัวอย่าง</em> มีคะแนนความเชื่อมั่นต่ำ หรือมีความสมบูรณ์
            ของข้อมูลต่ำ ห้ามนำไปอ้างอิงในการตัดสินใจกำกับดูแลที่มีผลผูกพัน
          </p>

          <h2>8. การแบ่งปันโปรไฟล์สาธารณะ</h2>
          <p>
            <strong>8.1.</strong> แพลตฟอร์มมีคุณสมบัติแบบสมัครใจที่อนุญาตให้ผู้ใช้
            ที่ได้รับอนุญาตเผยแพร่โปรไฟล์ทางวิชาการส่วนบุคคลผ่าน URL สาธารณะ การเปิด
            ใช้คุณสมบัตินี้ถือเป็นการให้ความยินยอมอย่างชัดแจ้งในการแสดงข้อมูล
            โปรไฟล์ที่ระบุไว้ ณ เวลาที่เปิดใช้
          </p>
          <p>
            <strong>8.2.</strong> ท่านสามารถถอนความยินยอมได้ทุกเมื่อโดยปิด
            คุณสมบัตินี้ภายในแพลตฟอร์ม URL สาธารณะจะตอบสถานะ “ไม่พบ”
            ตั้งแต่เวลาถอนความยินยอมเป็นต้นไป
          </p>

          <h2>9. ข้อมูลส่วนบุคคลและความเป็นส่วนตัว</h2>
          <p>
            <strong>9.1.</strong> มข. เป็นผู้ควบคุมข้อมูลส่วนบุคคลที่ประมวลผลผ่าน
            แพลตฟอร์มตามความหมายของ PDPA
          </p>
          <p>
            <strong>9.2.</strong> มข. ประมวลผลข้อมูลส่วนบุคคลตาม PDPA โดย
            อาศัยฐานทางกฎหมายว่าด้วยประโยชน์โดยชอบด้วยกฎหมาย การปฏิบัติหน้าที่
            สาธารณะของ มข. และเมื่อมีกรณีจำเป็น ความยินยอมของท่าน
          </p>
          <p>
            <strong>9.3.</strong> ท่านอาจใช้สิทธิภายใต้ PDPA (รวมถึงสิทธิในการ
            เข้าถึง แก้ไข ลบ จำกัด คัดค้าน และการโอนย้ายข้อมูล โดยมีข้อยกเว้น
            ตามที่กฎหมายกำหนด) โดยติดต่อตามที่อยู่ในข้อ 18
          </p>
          <p>
            <strong>9.4.</strong> แพลตฟอร์มมีการบันทึกการตรวจสอบเหตุการณ์ยืนยัน
            ตัวตน การเปลี่ยนแปลงข้อมูล การเรียกใช้ AI การสร้าง PDF และการส่งออก
            เพื่อสนับสนุนการกำกับดูแล ความปลอดภัย และความรับผิดชอบ การใช้
            แพลตฟอร์มถือว่าท่านรับทราบการบันทึกดังกล่าว
          </p>

          <h2>10. ความลับ</h2>
          <p>
            <strong>10.1.</strong> เนื้อหาที่เข้าถึงผ่านแพลตฟอร์ม อันรวมถึงข้อมูล
            ส่วนบุคคลของนักศึกษาและบุคลากร การวิเคราะห์ทางการเงินและต้นทุนระดับหลักสูตร
            ผลการประเมินและผลการตรวจสอบคุณภาพข้อมูล เอกสารสภามหาวิทยาลัยที่ยังเป็นร่าง
            หรือยังมิได้เผยแพร่ ตลอดจนเนื้อหาอื่นใดที่ระบุว่าเป็นข้อมูลลับ หรือซึ่งโดย
            สภาพแล้วควรถือเป็นความลับ จะต้องไม่เปิดเผยต่อบุคคลที่สามที่ไม่ใช่
            การปฏิบัติหน้าที่ตามภาระงานต่อ มข. โดยชอบ
          </p>
          <p>
            <strong>10.2.</strong> หน้าที่รักษาความลับของท่านมีผลต่อเนื่องหลังจาก
            สิ้นสุดการเข้าถึงแพลตฟอร์ม
          </p>
          <p>
            <strong>10.3.</strong> ข้อนี้ใช้บังคับกับเนื้อหา มิได้ใช้บังคับกับ
            ซอร์สโค้ด เอกสาร และสินทรัพย์การออกแบบของแพลตฟอร์ม ซึ่ง มข. เผยแพร่ภายใต้
            สัญญาอนุญาต CC BY-NC-SA 4.0 และจึงมิใช่ข้อมูลลับ ทั้งนี้
            การเผยแพร่ซอฟต์แวร์ดังกล่าวมิได้ทำให้เนื้อหาในระบบที่เปิดให้บริการ
            กลายเป็นข้อมูลสาธารณะ และมิได้ปลดเปลื้องท่านจากหน้าที่ตามข้อนี้
          </p>

          <h2>11. ไม่ใช่คำปรึกษาทางวิชาชีพ</h2>
          <p>
            เนื้อหาที่จัดให้ผ่านแพลตฟอร์มไม่ถือเป็นคำปรึกษาทางกฎหมาย การเงิน
            การบัญชี กฎระเบียบ การแพทย์ หรือคำปรึกษาทางวิชาชีพอื่น ๆ
            ท่านควรขอคำปรึกษาจากผู้ประกอบวิชาชีพที่มีคุณสมบัติเหมาะสมก่อนใช้
            ผลลัพธ์ของแพลตฟอร์มเพื่อวัตถุประสงค์นอกเหนือจากการกำกับดูแลภายในของ มข.
          </p>

          <h2>12. ข้อปฏิเสธการรับประกัน</h2>
          <p>
            <strong>12.1.</strong> แพลตฟอร์มให้บริการในลักษณะ “ตามสภาพ” และ
            “ตามที่มีให้” โดยไม่มีการรับประกันใด ๆ ทั้งโดยชัดแจ้ง โดยปริยาย หรือ
            ตามกฎหมาย รวมถึงโดยไม่จำกัดเพียงการรับประกันความสามารถในการขาย
            ความเหมาะสมต่อวัตถุประสงค์เฉพาะ การไม่ละเมิดสิทธิ ความถูกต้อง
            ความน่าเชื่อถือ หรือการทำงานต่อเนื่อง
          </p>
          <p>
            <strong>12.2.</strong> มข. ไม่รับประกันว่าแพลตฟอร์มจะตอบสนองความ
            ต้องการของท่าน ข้อบกพร่องจะได้รับการแก้ไข หรือแพลตฟอร์มหรือ
            โครงสร้างพื้นฐานปลอดจากไวรัสหรือส่วนประกอบที่เป็นอันตราย
          </p>

          <h2>13. ข้อจำกัดความรับผิด</h2>
          <p>
            <strong>13.1.</strong> เท่าที่กฎหมายแห่งราชอาณาจักรไทยอนุญาต
            มข. และเจ้าหน้าที่ ลูกจ้าง ตัวแทน หรือผู้รับเหมาของ มข. จะไม่รับผิด
            ต่อความเสียหายทางอ้อม ความเสียหายโดยอุบัติเหตุ ความเสียหายพิเศษ
            ความเสียหายเชิงตัวอย่าง ความเสียหายเชิงลงโทษ หรือความเสียหายต่อเนื่อง
            หรือต่อการสูญเสียกำไร รายได้ ข้อมูล หรือชื่อเสียงทางการค้า ที่เกิด
            จากหรือเกี่ยวข้องกับการใช้หรือไม่สามารถใช้แพลตฟอร์ม ไม่ว่าจะอาศัย
            ฐานสัญญา ละเมิด กฎหมาย หรือทฤษฎีทางกฎหมายอื่นใด
          </p>
          <p>
            <strong>13.2.</strong> ข้อกำหนดนี้ไม่จำกัดหรือยกเว้นความรับผิดต่อ
            การฉ้อโกง การกระทำโดยจงใจ ความประมาทอย่างร้ายแรง หรือความรับผิด
            ที่ไม่อาจจำกัดหรือยกเว้นได้ตามกฎหมาย
          </p>

          <h2>14. การชดใช้ค่าเสียหาย</h2>
          <p>
            ท่านตกลงจะชดใช้ ป้องกัน และทำให้ มข. ตลอดจนเจ้าหน้าที่ ลูกจ้าง
            ตัวแทน และผู้รับเหมา ปลอดจากการเรียกร้อง ความรับผิด ความเสียหาย
            การสูญเสีย และค่าใช้จ่าย (รวมค่าธรรมเนียมทนายความตามสมควร) ที่เกิด
            จากการที่ท่านละเมิดข้อกำหนดฉบับนี้ การใช้แพลตฟอร์มในทางที่ผิด
            หรือการละเมิดกฎหมายหรือสิทธิของบุคคลที่สาม
          </p>

          <h2>15. เหตุสุดวิสัย</h2>
          <p>
            มข. จะไม่ต้องรับผิดต่อการไม่ปฏิบัติหรือการล่าช้าในการปฏิบัติตาม
            ข้อกำหนดที่เกิดจากเหตุการณ์ที่อยู่นอกเหนือการควบคุมตามสมควร รวมถึง
            เหตุสุดวิสัย สงคราม การก่อการร้าย ความไม่สงบ การระบาด คำสั่งของรัฐ
            ข้อพิพาทแรงงาน การขาดสาธารณูปโภค การขัดข้องของอินเทอร์เน็ต หรือ
            ความล้มเหลวของบริการของบุคคลที่สาม
          </p>

          <h2>16. การระงับและการยุติ</h2>
          <p>
            มข. อาจระงับหรือยุติการเข้าถึงแพลตฟอร์มของท่านทั้งหมดหรือบางส่วน
            ไม่ว่าจะมีหรือไม่มีการแจ้งล่วงหน้า เมื่อ (ก) ท่านละเมิดข้อกำหนดฉบับนี้
            (ข) การกระทำดังกล่าวจำเป็นตามกฎหมายหรือนโยบายของ มข. หรือ
            (ค) การดำเนินงานของแพลตฟอร์มจำเป็นต้องดำเนินการดังกล่าว การยุติ
            ไม่กระทบสิทธิหรือหน้าที่ที่เกิดขึ้นแล้ว
          </p>

          <h2>17. การแก้ไข</h2>
          <p>
            มข. อาจแก้ไขข้อกำหนดฉบับนี้เมื่อใดก็ได้ การแก้ไขที่มีนัยสำคัญจะ
            ประกาศผ่านแพลตฟอร์ม การใช้งานต่อหลังวันที่การแก้ไขมีผลบังคับใช้
            ถือเป็นการยอมรับข้อกำหนดที่แก้ไขแล้ว
          </p>

          <h2>18. การส่งคำบอกกล่าว</h2>
          <p>การส่งคำบอกกล่าวถึง มข. ให้ส่งเป็นลายลักษณ์อักษรไปยังที่อยู่ดังนี้:</p>
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

          <h2>19. กฎหมายที่ใช้บังคับและเขตอำนาจศาล</h2>
          <p>
            ข้อกำหนดฉบับนี้อยู่ภายใต้บังคับและตีความตามกฎหมายแห่งราชอาณาจักรไทย
            โดยไม่นำหลักการขัดกันของกฎหมายมาใช้ ข้อพิพาทใด ๆ ที่เกิดจากหรือ
            เกี่ยวข้องกับข้อกำหนดนี้ อยู่ในเขตอำนาจของศาลในจังหวัดขอนแก่นแต่
            เพียงผู้เดียว
          </p>

          <h2>20. การแยกส่วน; ข้อตกลงทั้งหมด; การไม่สละสิทธิ; ภาษา</h2>
          <p>
            <strong>20.1. การแยกส่วน.</strong> หากข้อความใดในข้อกำหนดถูกถือว่า
            ไม่สมบูรณ์หรือบังคับใช้ไม่ได้ ข้อความที่เหลือยังคงมีผลใช้บังคับเต็มที่
          </p>
          <p>
            <strong>20.2. ข้อตกลงทั้งหมด.</strong> ข้อกำหนดฉบับนี้ ประกอบกับ
            ประกาศลิขสิทธิ์และคำชี้แจง เป็นข้อตกลงทั้งหมดระหว่างคู่สัญญาเกี่ยวกับ
            แพลตฟอร์ม และมีผลแทนที่ความเข้าใจก่อนหน้าทั้งหมด
          </p>
          <p>
            <strong>20.3. การไม่สละสิทธิ.</strong> การที่ มข. ไม่บังคับใช้ข้อ
            ใดข้อหนึ่ง ไม่ถือเป็นการสละสิทธิในข้อนั้นหรือข้ออื่นใด
          </p>
          <p>
            <strong>20.4. ภาษา.</strong> ข้อกำหนดฉบับนี้จัดทำเป็นภาษาอังกฤษ
            และภาษาไทย หากมีข้อความขัดแย้งกัน ให้ฉบับภาษาไทยมีผลเหนือกว่า
            เท่าที่กฎหมายไทยอนุญาต
          </p>
        </>
      }
    />
  );
}
