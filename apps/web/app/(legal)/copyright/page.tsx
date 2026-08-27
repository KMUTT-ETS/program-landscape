import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Copyright Notice · Program Landscape' };

const EFFECTIVE_DATE_EN = '27 August 2026';
const EFFECTIVE_DATE_TH = '27 สิงหาคม 2569';
const VERSION = '1.1';

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
            This notice concerns the software application known as{' '}
            <strong>“Program Landscape — KKU Curriculum Intelligence Platform”</strong>,
            comprising the web application served at{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>{' '}
            and all related source code, design assets, documentation, configuration,
            data schemas, and derived works (collectively, the <strong>“Work”</strong>).
          </p>
          <p>
            That is the name under which the Work is distributed in source form, and
            the attribution notice required by Article 11 uses it.
          </p>

          <h2>2. Copyright Ownership and Licence</h2>
          <p>
            <strong>Copyright © 2026 Khon Kaen University.</strong>
          </p>
          <p>
            Khon Kaen University, a juristic person established under the Khon Kaen
            University Act B.E. 2509 (1966) and currently governed by the Khon Kaen
            University Act B.E. 2558 (2015), having its principal place of business at
            123 Moo 16, Mittraphap Road, Tambon Nai Mueang, Mueang Khon Kaen District,
            Khon Kaen Province 40002, Kingdom of Thailand (hereinafter{' '}
            <strong>“KKU”</strong>), is the owner of the copyright in the Work.
          </p>
          <p>
            KKU retains that ownership. The Work is nevertheless made available to the
            public under the{' '}
            <strong>
              Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
              Licence (CC BY-NC-SA 4.0)
            </strong>
            , published at{' '}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              https://creativecommons.org/licenses/by-nc-sa/4.0/
            </a>
            . Ownership and licensing are distinct matters: KKU remains the copyright
            owner, and the licence is the permission KKU grants to everyone else.
            Article 7 sets out what that licence grants and the conditions attached to
            it; Articles 6 and 9 set out what it does not reach.
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
          <p>
            The licence granted in Article 7 covers only KKU's own contribution to the
            Work. It does not extend to, and does not purport to relicense, any
            third-party component, dependency, container base image, or font
            distributed with, referenced by, or fetched into the Work. Each remains
            governed solely by its own terms, which you must review before
            redistributing.
          </p>

          <h2>6. Trademarks</h2>
          <p>
            “Khon Kaen University”, “มหาวิทยาลัยขอนแก่น”, “KKU”, the KKU monogram, the
            KKU logo files distributed with the Work, and the KKU institutional seal,
            crest, and coat of arms are trademarks and identifying marks of Khon Kaen
            University. They are <strong>expressly reserved and are not licensed</strong>{' '}
            under CC BY-NC-SA 4.0. A Creative Commons licence grants copyright
            permissions only; Section 2(b)(2) of its legal code states that no
            trademark rights are granted by it.
          </p>
          <p>
            You may use these marks only to give the attribution required by Article
            11, in the plain-text form set out there, and only to state factually that
            your work derives from KKU's. Any other use—in a product name, a logo, a
            domain name, or in any manner that implies endorsement by or affiliation
            with Khon Kaen University—requires the prior written permission of KKU. An
            institution deploying its own instance of the Work must remove or replace
            KKU's marks and logos.
          </p>

          <h2>7. Licence Grant and Conditions</h2>
          <p>
            KKU licenses the Work to the public under CC BY-NC-SA 4.0. Subject to the
            conditions below, that licence grants you a worldwide, royalty-free,
            non-exclusive, irrevocable right to:
          </p>
          <ol>
            <li>
              <strong>Share</strong>—copy and redistribute the Work in any medium or
              format; and
            </li>
            <li>
              <strong>Adapt</strong>—remix, transform, and build upon the Work,
              including by deploying a modified instance of it.
            </li>
          </ol>
          <p>The licence attaches three conditions:</p>
          <ol>
            <li>
              <strong>Attribution (BY)</strong>—you must give appropriate credit in the
              form set out in Article 11, provide a link to the licence, and indicate
              whether you made changes;
            </li>
            <li>
              <strong>NonCommercial (NC)</strong>—you may not use the Work for
              commercial purposes, being use primarily intended for or directed towards
              commercial advantage or monetary compensation;
            </li>
            <li>
              <strong>ShareAlike (SA)</strong>—if you remix, transform, or build upon
              the Work, you must distribute your contributions under CC BY-NC-SA 4.0 or
              a licence designated by Creative Commons as compatible with it.
            </li>
          </ol>
          <p>
            You may not apply legal terms or technological measures that legally
            restrict others from doing anything the licence permits. The complete legal
            code governs; it is distributed with the Work in the file named “LICENSE”
            and published at{' '}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              https://creativecommons.org/licenses/by-nc-sa/4.0/
            </a>
            . Where this notice and the legal code differ, the legal code prevails.
          </p>
          <p>
            The licence is granted without warranties of any kind. Rights it does not
            grant—in particular the trademark and institutional-identity rights
            reserved in Article 6, and all rights in KKU data described in Article
            9—remain fully reserved to KKU.
          </p>

          <h2>8. Access to KKU's Hosted Instance</h2>
          <p>
            The licence in Article 7 is a licence to the Work—the software, its
            documentation, and its design assets. It is not a right of access to the
            instance of the Work that KKU operates at{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>
            , which holds live institutional and personal data.
          </p>
          <p>
            Access to that instance remains restricted to users authorised by
            KKU—being members of the KKU University Council, KKU senior management,
            deans, department heads, KKU staff, students, and partners explicitly
            authorised in writing by KKU—and is governed by the Terms and Conditions of
            Use rather than by this notice. Nothing in the licence entitles any person
            to an account, to the data held in a running instance, or to the outputs
            derived from that data.
          </p>
          <p>
            An institution wishing to use the Work operates its own instance with its
            own data, under the conditions set out in Article 7.
          </p>

          <h2>9. Data Ownership — No KKU Data Is Licensed</h2>
          <p>
            The licence in Article 7 releases code, documentation, and design assets.
            It releases no Khon Kaen University data. The following are expressly
            excluded from the licence and are not made available under it:
          </p>
          <ol>
            <li>
              the curriculum catalogue and the programme documents behind it;
            </li>
            <li>
              student records, cohort data, admissions data, and graduate outcomes;
            </li>
            <li>
              staff and faculty records, compensation data, and research-output
              records;
            </li>
            <li>financial, budget, and tuition data;</li>
            <li>
              evaluation results, health scores, risk assessments, data-quality
              results, AI-generated analyses, and Council decision records derived from
              any of the above; and
            </li>
            <li>any other operational data held in a running instance.</li>
          </ol>
          <p>
            Source data ingested into the Work from KKU institutional systems and
            authorised external sources remains the property of the originating
            party. Derived outputs produced by the Work (including health-score
            indicators, gap analyses, AI-generated narratives, forecasts, and
            benchmark reports) are owned by KKU and carry methodology version stamps
            to support provenance and reproducibility. Personal data held in a running
            instance remains subject to the Personal Data Protection Act B.E. 2562
            (2019) and to the obligations of the operating institution as data
            controller.
          </p>
          <p>
            Reference data that is itself part of the Work—for example the skills
            taxonomy seed distributed with the source—is covered by the licence in
            Article 7.
          </p>

          <h2>10. Moral Rights</h2>
          <p>
            The moral rights of the author of the Work, as recognised under Section
            18 of the Copyright Act B.E. 2537, are acknowledged. Attribution
            requirements are set out in Article 11 below.
          </p>

          <h2>11. Required Attribution</h2>
          <p>
            Attribution is a condition of the licence. If you use, adapt, or
            redistribute the Work, include the following notice in your source
            repository, in your documentation, and on any user-visible “about” or
            credits screen:
          </p>
          <blockquote>
            Based on “Program Landscape — KKU Curriculum Intelligence Platform” by
            Khon Kaen University, used under CC BY-NC-SA 4.0.
            <br />
            https://creativecommons.org/licenses/by-nc-sa/4.0/
          </blockquote>
          <p>
            If you modified the Work, say so, and keep your modifications under CC
            BY-NC-SA 4.0 as ShareAlike requires:
          </p>
          <blockquote>
            This work is a modified version of “Program Landscape — KKU Curriculum
            Intelligence Platform” by Khon Kaen University, used under CC BY-NC-SA
            4.0. Modified by [your institution], [year]. This modified work is
            licensed under CC BY-NC-SA 4.0.
            <br />
            https://creativecommons.org/licenses/by-nc-sa/4.0/
          </blockquote>
          <p>
            Keep the copyright notice in Article 2, this attribution notice, and the
            licence notice intact in redistributions, as Section 3(a) of the legal code
            requires.
          </p>
          <p>
            Citations of the Work in academic, governmental, or institutional
            publications shall use the following form:
          </p>
          <blockquote>
            Soodphakdee, D. (2026). <em>Program Landscape — KKU Curriculum
            Intelligence Platform</em>. Khon Kaen University. Licensed under CC
            BY-NC-SA 4.0.
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
            <strong>“Program Landscape — KKU Curriculum Intelligence Platform”</strong>{' '}
            ประกอบด้วยเว็บแอปพลิเคชันที่เผยแพร่ผ่าน{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>{' '}
            และซอร์สโค้ด สินทรัพย์การออกแบบ เอกสาร การตั้งค่า โครงสร้างฐานข้อมูล
            ตลอดจนงานที่ต่อยอดทั้งหมดที่เกี่ยวข้อง (รวมเรียกว่า{' '}
            <strong>“งาน”</strong>)
          </p>
          <p>
            ชื่อดังกล่าวเป็นชื่อที่ใช้ในการเผยแพร่งานนี้ในรูปแบบซอร์สโค้ด
            และเป็นชื่อที่ข้อความแสดงที่มาตามข้อ 11 กำหนดให้ใช้
          </p>

          <h2>2. ความเป็นเจ้าของลิขสิทธิ์และสัญญาอนุญาต</h2>
          <p>
            <strong>ลิขสิทธิ์ © พ.ศ. 2569 มหาวิทยาลัยขอนแก่น</strong>
          </p>
          <p>
            มหาวิทยาลัยขอนแก่น เป็นนิติบุคคลที่จัดตั้งขึ้นตามพระราชบัญญัติ
            มหาวิทยาลัยขอนแก่น พ.ศ. 2509 และปัจจุบันอยู่ภายใต้พระราชบัญญัติ
            มหาวิทยาลัยขอนแก่น พ.ศ. 2558 มีสำนักงานใหญ่ตั้งอยู่ ณ เลขที่ 123 หมู่ 16
            ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40002 ราชอาณาจักรไทย
            (ต่อไปนี้เรียกว่า <strong>“มข.”</strong>) เป็นเจ้าของลิขสิทธิ์ในงาน
          </p>
          <p>
            มข. ยังคงเป็นเจ้าของลิขสิทธิ์ดังกล่าว อย่างไรก็ดี มข. ได้เผยแพร่งานนี้
            ต่อสาธารณชนภายใต้{' '}
            <strong>
              สัญญาอนุญาตครีเอทีฟคอมมอนส์ แบบแสดงที่มา-ไม่ใช้เพื่อการค้า-
              อนุญาตแบบเดียวกัน 4.0 นานาชาติ (CC BY-NC-SA 4.0)
            </strong>{' '}
            ซึ่งเผยแพร่ที่{' '}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              https://creativecommons.org/licenses/by-nc-sa/4.0/
            </a>{' '}
            ทั้งนี้ ความเป็นเจ้าของลิขสิทธิ์กับการอนุญาตให้ใช้สิทธิเป็นคนละเรื่องกัน
            กล่าวคือ มข. ยังคงเป็นเจ้าของลิขสิทธิ์ ส่วนสัญญาอนุญาตเป็นการที่ มข.
            อนุญาตให้บุคคลอื่นใช้สิทธิ ข้อ 7 กำหนดสิทธิที่ได้รับอนุญาตและเงื่อนไข
            ที่ผูกพัน ส่วนข้อ 6 และข้อ 9 กำหนดสิ่งที่ไม่อยู่ในขอบเขตของสัญญาอนุญาต
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
          <p>
            สัญญาอนุญาตตามข้อ 7 ครอบคลุมเฉพาะส่วนที่ มข. สร้างสรรค์ขึ้นเองเท่านั้น
            มิได้ครอบคลุมและมิได้มีผลเปลี่ยนแปลงสัญญาอนุญาตของส่วนประกอบของบุคคลที่สาม
            แพ็กเกจที่งานเรียกใช้ อิมเมจคอนเทนเนอร์ฐาน หรือฟอนต์ ที่แจกจ่ายมาพร้อมกับงาน
            ที่งานอ้างอิงถึง หรือที่ถูกดึงเข้ามาในงาน ส่วนประกอบเหล่านั้นยังคงอยู่ภายใต้
            ข้อกำหนดของตนเอง ซึ่งท่านต้องตรวจสอบก่อนการเผยแพร่ต่อ
          </p>

          <h2>6. เครื่องหมายการค้า</h2>
          <p>
            “Khon Kaen University”, “มหาวิทยาลัยขอนแก่น”, “KKU”, ตราสัญลักษณ์ KKU
            แฟ้มโลโก้ มข. ที่แจกจ่ายมาพร้อมกับงาน ตราประจำสถาบัน และตราสัญลักษณ์
            ประจำมหาวิทยาลัยขอนแก่น เป็นเครื่องหมายการค้าและเครื่องหมายแสดงตัวตนของ
            มหาวิทยาลัยขอนแก่น เครื่องหมายดังกล่าว<strong>สงวนไว้โดยชัดแจ้งและ
            มิได้อยู่ภายใต้สัญญาอนุญาต</strong> CC BY-NC-SA 4.0 เนื่องจากสัญญาอนุญาต
            ครีเอทีฟคอมมอนส์ให้สิทธิเฉพาะในทางลิขสิทธิ์เท่านั้น และข้อ 2(b)(2)
            ของสัญญาอนุญาตดังกล่าวระบุไว้โดยชัดแจ้งว่ามิได้ให้สิทธิในเครื่องหมายการค้า
          </p>
          <p>
            ท่านอาจใช้เครื่องหมายเหล่านี้ได้เพียงเพื่อการแสดงที่มาตามที่กำหนดไว้ในข้อ 11
            ตามรูปแบบข้อความที่ระบุไว้ในข้อดังกล่าว และเพียงเพื่อระบุข้อเท็จจริงว่างานของ
            ท่านต่อยอดมาจากงานของ มข. เท่านั้น การใช้ประการอื่น ไม่ว่าในชื่อผลิตภัณฑ์
            โลโก้ ชื่อโดเมน หรือในลักษณะที่ทำให้เข้าใจว่ามหาวิทยาลัยขอนแก่นให้การรับรอง
            หรือมีความเกี่ยวข้องด้วย ต้องได้รับอนุญาตเป็นลายลักษณ์อักษรล่วงหน้าจาก มข.
            สถาบันที่นำงานไปติดตั้งใช้งานเองต้องนำเครื่องหมายและโลโก้ของ มข. ออก
            หรือเปลี่ยนเป็นของตน
          </p>

          <h2>7. สิทธิที่ได้รับอนุญาตและเงื่อนไข</h2>
          <p>
            มข. อนุญาตให้สาธารณชนใช้สิทธิในงานภายใต้สัญญาอนุญาต CC BY-NC-SA 4.0
            ภายใต้เงื่อนไขที่กำหนดไว้ด้านล่างนี้ สัญญาอนุญาตดังกล่าวให้สิทธิแก่ท่าน
            เป็นการทั่วไปทั่วโลก โดยปลอดค่าสิทธิ ไม่จำเพาะ และไม่อาจเพิกถอนได้ ดังนี้
          </p>
          <ol>
            <li>
              <strong>การเผยแพร่ (Share)</strong> — ทำซ้ำและเผยแพร่งานต่อ ไม่ว่าในสื่อ
              หรือรูปแบบใด และ
            </li>
            <li>
              <strong>การดัดแปลง (Adapt)</strong> — ปรับปรุง แปลง และต่อยอดจากงาน
              รวมถึงการนำฉบับที่ดัดแปลงแล้วไปติดตั้งใช้งาน
            </li>
          </ol>
          <p>สัญญาอนุญาตกำหนดเงื่อนไขสามประการ ดังนี้</p>
          <ol>
            <li>
              <strong>การแสดงที่มา (BY)</strong> — ท่านต้องระบุที่มาตามรูปแบบที่กำหนด
              ไว้ในข้อ 11 ระบุลิงก์ไปยังสัญญาอนุญาต และแจ้งว่าท่านได้ดัดแปลงงานหรือไม่
            </li>
            <li>
              <strong>ไม่ใช้เพื่อการค้า (NC)</strong> — ท่านจะใช้งานนี้เพื่อวัตถุประสงค์
              ทางการค้ามิได้ อันหมายถึงการใช้ที่มุ่งประสงค์เป็นสำคัญต่อประโยชน์ทางการค้า
              หรือค่าตอบแทนอันเป็นตัวเงิน
            </li>
            <li>
              <strong>อนุญาตแบบเดียวกัน (SA)</strong> — หากท่านปรับปรุง แปลง หรือต่อยอด
              จากงาน ท่านต้องเผยแพร่ส่วนที่ท่านสร้างสรรค์ขึ้นภายใต้สัญญาอนุญาต
              CC BY-NC-SA 4.0 หรือสัญญาอนุญาตที่ครีเอทีฟคอมมอนส์กำหนดให้ใช้ร่วมกันได้
            </li>
          </ol>
          <p>
            ท่านจะกำหนดข้อความทางกฎหมายหรือใช้มาตรการทางเทคโนโลยีอันเป็นการจำกัดมิให้
            ผู้อื่นกระทำการที่สัญญาอนุญาตนี้ยอมให้กระทำมิได้ ข้อความสัญญาอนุญาตฉบับเต็ม
            เป็นฉบับที่ใช้บังคับ โดยแจกจ่ายมาพร้อมกับงานในแฟ้มชื่อ “LICENSE” และเผยแพร่ที่{' '}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              https://creativecommons.org/licenses/by-nc-sa/4.0/
            </a>{' '}
            หากประกาศฉบับนี้ขัดหรือแย้งกับข้อความสัญญาอนุญาตฉบับเต็ม
            ให้ถือตามสัญญาอนุญาตฉบับเต็ม
          </p>
          <p>
            การอนุญาตนี้ไม่มีการรับประกันใด ๆ ทั้งสิ้น สิทธิที่มิได้อนุญาตไว้
            โดยเฉพาะอย่างยิ่งสิทธิในเครื่องหมายการค้าและเครื่องหมายแสดงตัวตนของสถาบัน
            ตามข้อ 6 และสิทธิทั้งปวงในข้อมูลของ มข. ตามข้อ 9 ยังคงสงวนไว้แก่ มข.
            ทุกประการ
          </p>

          <h2>8. การเข้าถึงระบบที่ มข. เป็นผู้ให้บริการ</h2>
          <p>
            สัญญาอนุญาตตามข้อ 7 เป็นการอนุญาตให้ใช้สิทธิในงาน อันได้แก่ ซอฟต์แวร์
            เอกสาร และสินทรัพย์การออกแบบ มิใช่สิทธิในการเข้าถึงระบบที่ มข.
            เปิดให้บริการอยู่ที่{' '}
            <a href="https://program-landscape.kku.ac.th">
              https://program-landscape.kku.ac.th
            </a>{' '}
            ซึ่งจัดเก็บข้อมูลของสถาบันและข้อมูลส่วนบุคคลที่ใช้งานจริง
          </p>
          <p>
            การเข้าถึงระบบดังกล่าวยังคงจำกัดเฉพาะผู้ใช้ที่ได้รับอนุญาตจาก มข. ได้แก่
            สมาชิกสภามหาวิทยาลัยขอนแก่น ผู้บริหารระดับสูง คณบดี หัวหน้าภาควิชา บุคลากร
            นักศึกษา และพันธมิตรที่ได้รับอนุญาตเป็นลายลักษณ์อักษรจาก มข. โดยอยู่ภายใต้
            ข้อกำหนดและเงื่อนไขการใช้งาน มิใช่ภายใต้ประกาศฉบับนี้ ทั้งนี้
            ไม่มีข้อความใดในสัญญาอนุญาตที่ก่อให้เกิดสิทธิแก่ผู้ใดในการมีบัญชีผู้ใช้
            ในการเข้าถึงข้อมูลที่จัดเก็บอยู่ในระบบที่เปิดให้บริการ
            หรือในผลลัพธ์ที่ได้จากข้อมูลนั้น
          </p>
          <p>
            สถาบันที่ประสงค์จะใช้งานนี้ ให้ติดตั้งและให้บริการระบบของตนเองด้วยข้อมูล
            ของตนเอง ภายใต้เงื่อนไขตามข้อ 7
          </p>

          <h2>9. ความเป็นเจ้าของข้อมูล — ไม่มีการอนุญาตให้ใช้ข้อมูลของ มข.</h2>
          <p>
            สัญญาอนุญาตตามข้อ 7 เป็นการเผยแพร่ซอร์สโค้ด เอกสาร และสินทรัพย์การออกแบบ
            มิได้เป็นการเผยแพร่ข้อมูลใด ๆ ของมหาวิทยาลัยขอนแก่น สิ่งต่อไปนี้ได้รับ
            การยกเว้นโดยชัดแจ้งจากสัญญาอนุญาต และมิได้จัดให้ใช้ภายใต้สัญญาอนุญาตดังกล่าว:
          </p>
          <ol>
            <li>ฐานข้อมูลหลักสูตรและเอกสารหลักสูตรที่เป็นต้นทาง;</li>
            <li>
              ระเบียนนักศึกษา ข้อมูลรุ่นการศึกษา ข้อมูลการรับเข้าศึกษา
              และข้อมูลภาวะการมีงานทำของบัณฑิต;
            </li>
            <li>
              ระเบียนบุคลากรและอาจารย์ ข้อมูลค่าตอบแทน และระเบียนผลงานวิจัย;
            </li>
            <li>ข้อมูลการเงิน งบประมาณ และค่าธรรมเนียมการศึกษา;</li>
            <li>
              ผลการประเมิน คะแนนสุขภาพหลักสูตร ผลการประเมินความเสี่ยง
              ผลการตรวจสอบคุณภาพข้อมูล บทวิเคราะห์ที่ AI สร้างขึ้น
              และบันทึกมติสภามหาวิทยาลัยที่ได้มาจากข้อมูลข้างต้น; และ
            </li>
            <li>ข้อมูลการดำเนินงานอื่นใดที่จัดเก็บอยู่ในระบบที่เปิดให้บริการ</li>
          </ol>
          <p>
            ข้อมูลต้นทางที่นำเข้าสู่งานจากระบบของ มข. และแหล่งภายนอกที่ได้รับอนุญาต
            ยังคงเป็นทรัพย์สินของผู้เป็นเจ้าของแหล่งข้อมูล ผลลัพธ์ที่งานสังเคราะห์ขึ้น
            (รวมถึงตัวชี้วัดสุขภาพหลักสูตร การวิเคราะห์ช่องว่าง เรื่องเล่าที่ AI
            สร้างขึ้น การพยากรณ์ และรายงานเปรียบเทียบ) เป็นทรัพย์สินของ มข.
            และมีตราเวอร์ชันระเบียบวิธีกำกับเพื่อสนับสนุนการสืบค้นที่มาและความสามารถ
            ในการทำซ้ำผลลัพธ์ ข้อมูลส่วนบุคคลที่จัดเก็บอยู่ในระบบที่เปิดให้บริการยังคง
            อยู่ภายใต้พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
            และภาระหน้าที่ของสถาบันผู้ให้บริการในฐานะผู้ควบคุมข้อมูลส่วนบุคคล
          </p>
          <p>
            ข้อมูลอ้างอิงที่เป็นส่วนหนึ่งของงานเอง เช่น ชุดข้อมูลตั้งต้นของ
            อนุกรมวิธานทักษะที่แจกจ่ายมาพร้อมกับซอร์สโค้ด อยู่ภายใต้สัญญาอนุญาตตามข้อ 7
          </p>

          <h2>10. ธรรมสิทธิ์ (Moral Rights)</h2>
          <p>
            มข. รับรองธรรมสิทธิ์ของผู้สร้างสรรค์งานตามมาตรา 18
            แห่งพระราชบัญญัติลิขสิทธิ์ พ.ศ. 2537 ข้อกำหนดการระบุที่มาปรากฏใน
            ข้อ 11 ของประกาศฉบับนี้
          </p>

          <h2>11. การระบุที่มาที่ต้องปฏิบัติ</h2>
          <p>
            การแสดงที่มาเป็นเงื่อนไขของสัญญาอนุญาต หากท่านใช้ ดัดแปลง หรือเผยแพร่งานต่อ
            ท่านต้องแสดงข้อความต่อไปนี้ไว้ในคลังซอร์สโค้ดของท่าน ในเอกสารประกอบ
            และในหน้าจอ “เกี่ยวกับ” หรือหน้าจอแสดงเครดิตที่ผู้ใช้มองเห็นได้:
          </p>
          <blockquote>
            Based on “Program Landscape — KKU Curriculum Intelligence Platform” by
            Khon Kaen University, used under CC BY-NC-SA 4.0.
            <br />
            https://creativecommons.org/licenses/by-nc-sa/4.0/
          </blockquote>
          <p>
            หากท่านได้ดัดแปลงงาน ท่านต้องแจ้งข้อเท็จจริงดังกล่าว และต้องเผยแพร่
            ส่วนที่ดัดแปลงภายใต้สัญญาอนุญาต CC BY-NC-SA 4.0 ตามเงื่อนไข
            อนุญาตแบบเดียวกัน ดังนี้:
          </p>
          <blockquote>
            This work is a modified version of “Program Landscape — KKU Curriculum
            Intelligence Platform” by Khon Kaen University, used under CC BY-NC-SA
            4.0. Modified by [ชื่อสถาบันของท่าน], [ปี]. This modified work is licensed
            under CC BY-NC-SA 4.0.
            <br />
            https://creativecommons.org/licenses/by-nc-sa/4.0/
          </blockquote>
          <p>
            ในการเผยแพร่ต่อ ท่านต้องคงข้อความแสดงลิขสิทธิ์ตามข้อ 2
            ข้อความแสดงที่มาข้างต้น และข้อความแจ้งสัญญาอนุญาตไว้ครบถ้วน
            ตามที่ข้อ 3(a) ของสัญญาอนุญาตฉบับเต็มกำหนด
          </p>
          <p>
            การอ้างอิงถึงงานในผลงานวิชาการ ราชการ หรือสถาบัน ให้ใช้รูปแบบดังนี้:
          </p>
          <blockquote>
            เด่นพงษ์ สุดภักดี (2569). <em>Program Landscape — KKU Curriculum
            Intelligence Platform</em>. มหาวิทยาลัยขอนแก่น. เผยแพร่ภายใต้สัญญาอนุญาต
            CC BY-NC-SA 4.0.
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
