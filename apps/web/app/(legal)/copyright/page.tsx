import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Copyright Notice · KKU Curriculum Landscape' };

const EFFECTIVE_DATE_EN = '11 May 2026';
const EFFECTIVE_DATE_TH = '11 พฤษภาคม 2569';
const VERSION = '1.0';

export default function CopyrightPage() {
  return (
    <LegalPage
      titleEn="Copyright Notice"
      titleTh="ประกาศลิขสิทธิ์"
      lastUpdated={`${EFFECTIVE_DATE_EN} · Version ${VERSION}`}
      bodyEn={
        <>
          <h2>1. Identification of the Work</h2>
          <p>
            This notice concerns the software application known as the{' '}
            <strong>“KKU Curriculum Landscape”</strong> (internal codenames{' '}
            <em>“Curriculum Compass”</em> and <em>“ทักษทัศน์”</em>), comprising the web
            application served at{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>{' '}
            and all related source code, design assets, documentation, configuration,
            data schemas, and derived works (collectively, the <strong>“Work”</strong>).
          </p>

          <h2>2. Copyright Ownership</h2>
          <p>
            <strong>
              Copyright © 2026 Khon Kaen University. All rights reserved.
            </strong>
          </p>
          <p>
            Khon Kaen University, a juristic person established under the Khon Kaen
            University Act B.E. 2509 (1966) and currently governed by the Khon Kaen
            University Act B.E. 2558 (2015), having its principal place of business at
            123 Moo 16, Mittraphap Road, Tambon Nai Mueang, Mueang Khon Kaen District,
            Khon Kaen Province 40002, Kingdom of Thailand (hereinafter{' '}
            <strong>“KKU”</strong>), is the owner of the copyright in the Work.
          </p>

          <h2>3. Statutory Basis of Ownership</h2>
          <p>
            The Work was conceived, designed, and developed by{' '}
            <strong>Asst. Prof. Dr. Denpong Soodphakdee</strong>, in his capacity as{' '}
            Vice President for Education and Digital of KKU, in the course of his
            employment with KKU. Pursuant to <strong>Section 9 of the Copyright Act
            B.E. 2537 (1994)</strong> of the Kingdom of Thailand, copyright in a work
            created by an employee in the course of employment shall vest in the
            employer, unless otherwise agreed in writing. No contrary written
            agreement exists, and copyright therefore vests in KKU.
          </p>

          <h2>4. Scope of Protected Material</h2>
          <p>
            The copyright in the Work subsists in all original elements, including but
            not limited to:
          </p>
          <ol>
            <li>
              source code, build configuration, container definitions, infrastructure-
              as-code artefacts, and deployment scripts;
            </li>
            <li>
              user interface layouts, visual designs, design tokens, illustrations,
              iconography, and motion specifications;
            </li>
            <li>
              database schemas, data models, methodology specifications, prompt
              templates, and AI configuration;
            </li>
            <li>
              technical documentation, user guides, methodology compendia, and
              internal manuals;
            </li>
            <li>
              compilations, selections, and arrangements of data within the Work
              that constitute original intellectual creations.
            </li>
          </ol>

          <h2>5. Third-Party Components</h2>
          <p>
            The Work incorporates open-source and proprietary third-party components.
            Each such component remains the property of its respective copyright
            holder and is used in accordance with its applicable license terms.
            Inclusion of any third-party component does not constitute endorsement.
          </p>

          <h2>6. Trademarks</h2>
          <p>
            “Khon Kaen University”, “มหาวิทยาลัยขอนแก่น”, “KKU”, the KKU monogram,
            and the KKU institutional seal are trademarks and identifying marks of
            Khon Kaen University. No license to use such marks is granted by this
            notice or by access to the Work.
          </p>

          <h2>7. Reservation of Rights</h2>
          <p>
            All rights in the Work not expressly granted by KKU in writing are
            reserved. No part of the Work may be reproduced, distributed, publicly
            displayed, publicly performed, transmitted, modified, adapted, translated,
            decompiled, reverse-engineered, or used to prepare derivative works,
            except with the prior written permission of KKU or as expressly permitted
            by applicable law.
          </p>

          <h2>8. Permitted Internal Use</h2>
          <p>
            KKU grants to authorised users—being members of the KKU University
            Council, KKU senior management, deans, department heads, KKU staff,
            students, and partners explicitly authorised in writing by KKU—a limited,
            non-exclusive, non-transferable, revocable licence to access and use the
            Work strictly for the internal governance, academic, and operational
            purposes of KKU, subject to the Terms and Conditions of Use.
          </p>

          <h2>9. Data Ownership</h2>
          <p>
            Source data ingested into the Work from KKU institutional systems and
            authorised external sources remains the property of the originating
            party. Derived outputs produced by the Work (including health-score
            indicators, gap analyses, AI-generated narratives, forecasts, and
            benchmark reports) are owned by KKU and carry methodology version stamps
            to support provenance and reproducibility.
          </p>

          <h2>10. Moral Rights</h2>
          <p>
            The moral rights of the author of the Work, as recognised under Section
            18 of the Copyright Act B.E. 2537, are acknowledged. Attribution
            requirements are set out in Article 11 below.
          </p>

          <h2>11. Required Attribution</h2>
          <p>
            Citations of the Work in academic, governmental, or institutional
            publications shall use the following form:
          </p>
          <blockquote>
            Soodphakdee, D. (2026). <em>KKU Curriculum Landscape (Curriculum
            Compass / ทักษทัศน์)</em>. Khon Kaen University.
          </blockquote>

          <h2>12. Infringement Notices</h2>
          <p>
            Notice of alleged infringement of the copyright in the Work, or requests
            relating to licensing, partnerships, or permitted use, shall be addressed
            in writing to:
          </p>
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

          <h2>13. Governing Law</h2>
          <p>
            The copyright in the Work and the interpretation of this notice are
            governed by the laws of the Kingdom of Thailand, including the
            Copyright Act B.E. 2537 (1994) and any amendments thereto.
          </p>
        </>
      }
      bodyTh={
        <>
          <h2>1. การระบุงาน</h2>
          <p>
            ประกาศนี้เกี่ยวข้องกับซอฟต์แวร์แอปพลิเคชันชื่อว่า{' '}
            <strong>“KKU Curriculum Landscape”</strong> (ชื่อรหัสภายใน{' '}
            <em>“Curriculum Compass”</em> และ <em>“ทักษทัศน์”</em>) ประกอบด้วย
            เว็บแอปพลิเคชันที่เผยแพร่ผ่าน{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>{' '}
            และซอร์สโค้ด สินทรัพย์การออกแบบ เอกสาร การตั้งค่า โครงสร้างฐานข้อมูล
            ตลอดจนงานที่ต่อยอดทั้งหมดที่เกี่ยวข้อง (รวมเรียกว่า{' '}
            <strong>“งาน”</strong>)
          </p>

          <h2>2. ความเป็นเจ้าของลิขสิทธิ์</h2>
          <p>
            <strong>
              สงวนลิขสิทธิ์ © พ.ศ. 2569 มหาวิทยาลัยขอนแก่น สงวนสิทธิ์ทุกประการ
            </strong>
          </p>
          <p>
            มหาวิทยาลัยขอนแก่น เป็นนิติบุคคลที่จัดตั้งขึ้นตามพระราชบัญญัติ
            มหาวิทยาลัยขอนแก่น พ.ศ. 2509 และปัจจุบันอยู่ภายใต้พระราชบัญญัติ
            มหาวิทยาลัยขอนแก่น พ.ศ. 2558 มีสำนักงานใหญ่ตั้งอยู่ ณ เลขที่ 123 หมู่ 16
            ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40002 ราชอาณาจักรไทย
            (ต่อไปนี้เรียกว่า <strong>“มข.”</strong>) เป็นเจ้าของลิขสิทธิ์ในงาน
          </p>

          <h2>3. ฐานทางกฎหมายของความเป็นเจ้าของ</h2>
          <p>
            งานนี้ได้รับการ ริเริ่ม ออกแบบ และพัฒนา โดย{' '}
            <strong>ผศ. ดร. เด่นพงษ์ สุดภักดี</strong> ในฐานะรองอธิการบดี
            ฝ่ายการศึกษาและดิจิทัล ของ มข. ในระหว่างการปฏิบัติงานตามสัญญาจ้าง
            ของ มข. ตาม <strong>มาตรา 9 แห่งพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537</strong>
            งานที่สร้างสรรค์โดยลูกจ้างในการทำงานตามสัญญาจ้างให้ลิขสิทธิ์ตกแก่ผู้ว่าจ้าง
            เว้นแต่จะตกลงเป็นหนังสือเป็นอย่างอื่น เนื่องจากไม่มีข้อตกลงเป็นลายลักษณ์อักษร
            อย่างอื่น ลิขสิทธิ์จึงตกแก่ มข.
          </p>

          <h2>4. ขอบเขตของวัตถุที่ได้รับการคุ้มครอง</h2>
          <p>
            ลิขสิทธิ์ในงานครอบคลุมองค์ประกอบดั้งเดิมทั้งหมด รวมถึงแต่ไม่จำกัดเพียง:
          </p>
          <ol>
            <li>
              ซอร์สโค้ด การตั้งค่าการ build การกำหนดคอนเทนเนอร์ infrastructure-as-code
              และสคริปต์การ deploy;
            </li>
            <li>
              การจัดวางส่วนติดต่อผู้ใช้ การออกแบบเชิงภาพ โทเคนการออกแบบ ภาพประกอบ
              ไอคอน และข้อกำหนดการเคลื่อนไหว;
            </li>
            <li>
              โครงสร้างฐานข้อมูล แบบจำลองข้อมูล ข้อกำหนดเชิงระเบียบวิธี เทมเพลตคำสั่ง
              และการกำหนดค่า AI;
            </li>
            <li>
              เอกสารทางเทคนิค คู่มือผู้ใช้ คู่มือเชิงระเบียบวิธี และคู่มือภายใน;
            </li>
            <li>
              การรวบรวม การคัดเลือก และการจัดเรียงข้อมูลภายในงานที่ถือเป็น
              งานสร้างสรรค์ทางปัญญาที่เป็นต้นฉบับ
            </li>
          </ol>

          <h2>5. ส่วนประกอบของบุคคลที่สาม</h2>
          <p>
            งานนี้ได้รวมส่วนประกอบที่เป็นโอเพนซอร์สและทรัพย์สินทางปัญญาของบุคคลที่สาม
            ส่วนประกอบดังกล่าวยังคงเป็นทรัพย์สินของเจ้าของลิขสิทธิ์รายนั้น ๆ และใช้
            ตามข้อกำหนดของใบอนุญาตที่บังคับใช้ การรวมส่วนประกอบของบุคคลที่สามไม่ถือเป็น
            การรับรองคุณภาพ
          </p>

          <h2>6. เครื่องหมายการค้า</h2>
          <p>
            “Khon Kaen University”, “มหาวิทยาลัยขอนแก่น”, “KKU”, ตราสัญลักษณ์ KKU
            และตราประจำสถาบันของมหาวิทยาลัยขอนแก่น เป็นเครื่องหมายการค้าและ
            เครื่องหมายแสดงตัวตนของมหาวิทยาลัยขอนแก่น ประกาศฉบับนี้และการเข้าถึง
            งานไม่ก่อให้เกิดการอนุญาตให้ใช้เครื่องหมายดังกล่าวแต่อย่างใด
          </p>

          <h2>7. สงวนสิทธิ์</h2>
          <p>
            สิทธิทั้งหมดในงานที่ไม่ได้รับการอนุญาตเป็นลายลักษณ์อักษรอย่างชัดเจน
            จาก มข. ขอสงวนไว้ ห้ามทำซ้ำ เผยแพร่ แสดงต่อสาธารณะ จัดให้สาธารณชนเข้าถึง
            ดัดแปลง แปลภาษา ทำวิศวกรรมย้อนกลับ หรือใช้ในการสร้างงานต่อยอด
            ส่วนใดส่วนหนึ่งของงาน เว้นแต่จะได้รับอนุญาตเป็นลายลักษณ์อักษรล่วงหน้า
            จาก มข. หรือเป็นการกระทำที่กฎหมายอนุญาตอย่างชัดแจ้ง
          </p>

          <h2>8. การใช้งานภายในที่ได้รับอนุญาต</h2>
          <p>
            มข. อนุญาตให้ผู้ใช้ที่ได้รับอนุญาต ได้แก่ สมาชิกสภามหาวิทยาลัยขอนแก่น
            ผู้บริหารระดับสูง คณบดี หัวหน้าภาควิชา บุคลากร นักศึกษา
            และพันธมิตรที่ได้รับอนุญาตเป็นลายลักษณ์อักษรจาก มข. ใช้สิทธิแบบจำกัด
            ไม่จำเพาะ ไม่อาจโอนได้ และเพิกถอนได้ ในการเข้าถึงและใช้งานเพื่อ
            วัตถุประสงค์ด้านธรรมาภิบาล การศึกษา และการบริหารงานภายในของ มข. เท่านั้น
            ทั้งนี้ภายใต้ข้อกำหนดและเงื่อนไขการใช้งาน
          </p>

          <h2>9. ความเป็นเจ้าของข้อมูล</h2>
          <p>
            ข้อมูลต้นทางที่นำเข้าสู่งานจากระบบของ มข. และแหล่งภายนอกที่ได้รับอนุญาต
            ยังคงเป็นทรัพย์สินของผู้เป็นเจ้าของแหล่งข้อมูล ผลลัพธ์ที่งานสังเคราะห์ขึ้น
            (รวมถึงตัวชี้วัดสุขภาพหลักสูตร การวิเคราะห์ช่องว่าง เรื่องเล่าที่ AI
            สร้างขึ้น การพยากรณ์ และรายงานเปรียบเทียบ) เป็นทรัพย์สินของ มข.
            และมีตราเวอร์ชันระเบียบวิธีกำกับเพื่อสนับสนุนการสืบค้นที่มาและความสามารถ
            ในการทำซ้ำผลลัพธ์
          </p>

          <h2>10. ธรรมสิทธิ์ (Moral Rights)</h2>
          <p>
            มข. รับรองธรรมสิทธิ์ของผู้สร้างสรรค์งานตามมาตรา 18
            แห่งพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537 ข้อกำหนดการระบุที่มาปรากฏใน
            ข้อ 11 ของประกาศฉบับนี้
          </p>

          <h2>11. การระบุที่มาที่ต้องปฏิบัติ</h2>
          <p>
            การอ้างอิงถึงงานในผลงานวิชาการ ราชการ หรือสถาบัน ให้ใช้รูปแบบดังนี้:
          </p>
          <blockquote>
            เด่นพงษ์ สุดภักดี (2569). <em>KKU Curriculum Landscape (ทักษทัศน์)</em>.
            มหาวิทยาลัยขอนแก่น.
          </blockquote>

          <h2>12. การแจ้งการละเมิด</h2>
          <p>
            การแจ้งกล่าวอ้างการละเมิดลิขสิทธิ์ในงาน หรือคำขอเกี่ยวกับการอนุญาต
            ความร่วมมือ หรือการใช้งานที่ได้รับอนุญาต ให้ส่งเป็นลายลักษณ์อักษรถึง:
          </p>
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

          <h2>13. กฎหมายที่ใช้บังคับ</h2>
          <p>
            ลิขสิทธิ์ในงานและการตีความประกาศฉบับนี้อยู่ภายใต้บังคับของกฎหมาย
            แห่งราชอาณาจักรไทย รวมถึงพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537 และที่แก้ไข
            เพิ่มเติมทุกฉบับ
          </p>
        </>
      }
    />
  );
}
