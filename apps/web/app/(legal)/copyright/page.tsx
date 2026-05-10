import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Copyright · KKU Curriculum Landscape' };

const LAST_UPDATED = '10 May 2026';

export default function CopyrightPage() {
  return (
    <LegalPage
      titleEn="Copyright"
      titleTh="ลิขสิทธิ์"
      lastUpdated={LAST_UPDATED}
      bodyEn={
        <>
          <p>
            <strong>Copyright © Khon Kaen University. All rights reserved.</strong>
          </p>
          <p>
            The KKU Curriculum Landscape (also known as <em>Curriculum Compass</em> /
            <em> ทักษทัศน์</em>) is a strategic decision-support web application for the
            Khon Kaen University Council and top management. The platform was conceived,
            designed, and developed by{' '}
            <strong>Asst. Prof. Dr. Denpong Soodphakdee</strong>, Vice President for
            Education and Digital, Khon Kaen University.
          </p>
          <p>
            Pursuant to{' '}
            <strong>Section 9 of the Copyright Act B.E. 2537 (1994)</strong> of Thailand,
            copyright in works created in the course of employment vests in the
            employer unless otherwise agreed in writing. As Dr. Denpong was acting in
            the capacity of his employment with Khon Kaen University when he conceived
            and developed this platform, the copyright is held by{' '}
            <strong>Khon Kaen University</strong>.
          </p>
          <h3>Scope of copyright</h3>
          <p>
            All elements of this platform are protected by copyright, including but not
            limited to:
          </p>
          <ul>
            <li>Source code, build configuration, and infrastructure scripts</li>
            <li>
              User interface designs, layouts, visualisations, and design tokens
            </li>
            <li>Database schema, methodology specifications, and data models</li>
            <li>
              Documentation, including AI prompts, methodology compendia, and user
              guides
            </li>
            <li>Branding, logos, illustrations, and iconography</li>
          </ul>
          <p>
            Third-party libraries used by this platform remain the property of their
            respective copyright holders and are used in accordance with their licenses.
          </p>
          <h3>Permitted use</h3>
          <p>
            This platform is licensed for internal use by Khon Kaen University staff,
            students, the University Council, and authorised partners. No part of this
            platform — including its source code, content, or any derivative work — may
            be reproduced, redistributed, sold, or sublicensed without the express
            written permission of Khon Kaen University.
          </p>
          <h3>Data ownership</h3>
          <p>
            Data ingested into this platform from KKU systems and external sources
            remains the property of its originating party. Aggregated and derived
            outputs (health scores, methodology indicators, AI-generated narratives) are
            produced under the platform's methodology versions and are owned by Khon
            Kaen University.
          </p>
          <h3>Attribution</h3>
          <p>
            When citing or referencing this platform in academic, governmental, or
            internal publications, please use:
          </p>
          <blockquote>
            Soodphakdee, D. (2026). <em>KKU Curriculum Landscape (Curriculum
            Compass / ทักษทัศน์)</em>. Khon Kaen University.
          </blockquote>
          <h3>Contact</h3>
          <p>
            For copyright queries, partnership requests, or licensing enquiries:{' '}
            <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
      bodyTh={
        <>
          <p>
            <strong>
              สงวนลิขสิทธิ์ © มหาวิทยาลัยขอนแก่น สงวนสิทธิ์ทุกประการ
            </strong>
          </p>
          <p>
            แพลตฟอร์ม KKU Curriculum Landscape (หรือเรียกว่า{' '}
            <em>Curriculum Compass</em> / <em>ทักษทัศน์</em>) เป็นเว็บแอปพลิเคชัน
            สนับสนุนการตัดสินใจเชิงกลยุทธ์สำหรับสภามหาวิทยาลัยและผู้บริหารระดับสูง
            ของมหาวิทยาลัยขอนแก่น แพลตฟอร์มนี้ได้รับการ ริเริ่ม ออกแบบ และพัฒนา โดย{' '}
            <strong>ผศ. ดร. เด่นพงษ์ สุดภักดี</strong> รองอธิการบดี
            ฝ่ายการศึกษาและดิจิทัล มหาวิทยาลัยขอนแก่น
          </p>
          <p>
            ตาม <strong>มาตรา 9 แห่งพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537</strong> งาน
            ที่สร้างสรรค์ในระหว่างการจ้างแรงงานให้ลิขสิทธิ์เป็นของผู้ว่าจ้าง
            เว้นแต่จะได้ตกลงเป็นหนังสือเป็นอย่างอื่น เนื่องจาก ผศ. ดร. เด่นพงษ์
            ปฏิบัติงานในฐานะลูกจ้างของมหาวิทยาลัยขอนแก่นในขณะที่ริเริ่มและพัฒนา
            แพลตฟอร์มนี้ ลิขสิทธิ์จึงเป็นของ <strong>มหาวิทยาลัยขอนแก่น</strong>
          </p>
          <h3>ขอบเขตของลิขสิทธิ์</h3>
          <p>
            องค์ประกอบทุกส่วนของแพลตฟอร์มนี้ได้รับความคุ้มครองตามกฎหมายลิขสิทธิ์
            รวมถึงแต่ไม่จำกัดเพียง:
          </p>
          <ul>
            <li>ซอร์สโค้ด การตั้งค่าการ build และสคริปต์โครงสร้างพื้นฐาน</li>
            <li>การออกแบบส่วนติดต่อผู้ใช้ การจัดวาง การแสดงผลข้อมูล และโทเคนการออกแบบ</li>
            <li>โครงสร้างฐานข้อมูล ข้อกำหนดเชิงระเบียบวิธี และแบบจำลองข้อมูล</li>
            <li>เอกสาร รวมถึงคำสั่ง AI คู่มือเชิงระเบียบวิธี และคู่มือผู้ใช้</li>
            <li>เครื่องหมายการค้า โลโก้ ภาพประกอบ และไอคอน</li>
          </ul>
          <p>
            ไลบรารีของบุคคลที่สามที่ใช้ในแพลตฟอร์มนี้ยังคงเป็นทรัพย์สินของเจ้าของลิขสิทธิ์
            แต่ละรายและใช้ภายใต้เงื่อนไขของใบอนุญาตของไลบรารีนั้น ๆ
          </p>
          <h3>การอนุญาตให้ใช้</h3>
          <p>
            แพลตฟอร์มนี้ได้รับอนุญาตให้ใช้งานภายในมหาวิทยาลัยขอนแก่นโดยบุคลากร นักศึกษา
            สภามหาวิทยาลัย และพันธมิตรที่ได้รับอนุญาตเท่านั้น ห้ามมิให้ทำซ้ำ เผยแพร่
            จำหน่าย หรืออนุญาตให้ผู้อื่นใช้งานส่วนใดส่วนหนึ่งของแพลตฟอร์ม รวมถึงซอร์สโค้ด
            เนื้อหา หรืองานต่อยอด โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษรอย่างชัดเจนจาก
            มหาวิทยาลัยขอนแก่น
          </p>
          <h3>ความเป็นเจ้าของข้อมูล</h3>
          <p>
            ข้อมูลที่นำเข้าสู่แพลตฟอร์มนี้จากระบบของ มข. และแหล่งภายนอก
            ยังคงเป็นทรัพย์สินของผู้เป็นเจ้าของแหล่งข้อมูลนั้น ๆ
            ผลลัพธ์ที่สังเคราะห์และต่อยอด (คะแนนสุขภาพหลักสูตร ตัวชี้วัด
            เชิงระเบียบวิธี และเรื่องเล่าที่ AI สร้างขึ้น)
            ผลิตขึ้นภายใต้เวอร์ชันระเบียบวิธีของแพลตฟอร์มและเป็นทรัพย์สินของ
            มหาวิทยาลัยขอนแก่น
          </p>
          <h3>การอ้างอิง</h3>
          <p>
            เมื่ออ้างถึงแพลตฟอร์มนี้ในผลงานวิชาการ ราชการ หรือสิ่งพิมพ์ภายใน โปรดใช้
            รูปแบบ:
          </p>
          <blockquote>
            เด่นพงษ์ สุดภักดี (2569). <em>KKU Curriculum Landscape (ทักษทัศน์)</em>.
            มหาวิทยาลัยขอนแก่น.
          </blockquote>
          <h3>ติดต่อ</h3>
          <p>
            สำหรับการสอบถามเรื่องลิขสิทธิ์ คำขอความร่วมมือ หรือการขออนุญาตใช้งาน:{' '}
            <a href="mailto:denpong@kku.ac.th">denpong@kku.ac.th</a>
          </p>
        </>
      }
    />
  );
}
