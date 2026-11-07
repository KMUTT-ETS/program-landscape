"""Small Thai -> English glossary for faculty, department and programme names.

`translate(text)` returns an English string, or None when any part of the text
is not covered. English output never contains Thai characters; callers use a
neutral placeholder on None. Thai compounds are head-first ("วิศวกรรม" +
"คอมพิวเตอร์"), English head-last, so the words of one clause are reversed.
"""
from __future__ import annotations

import re

WORDS = {
    # head nouns / fields
    "วิศวกรรม": "Engineering", "วิศวกรรมศาสตร์": "Engineering", "วิทยาศาสตร์": "Science",
    "เทคโนโลยี": "Technology", "สถาปัตยกรรมศาสตร์": "Architecture", "สถาปัตยกรรม": "Architecture",
    "บริหารธุรกิจ": "Business Administration", "การบัญชี": "Accounting", "บัญชี": "Accounting",
    "เศรษฐศาสตร์": "Economics", "นิติศาสตร์": "Law", "รัฐศาสตร์": "Political Science",
    "รัฐประศาสนศาสตร์": "Public Administration", "มนุษยศาสตร์": "Humanities",
    "สังคมศาสตร์": "Social Sciences", "ศึกษาศาสตร์": "Education", "ครุศาสตร์": "Education",
    "เกษตรศาสตร์": "Agriculture", "แพทยศาสตร์": "Medicine", "ทันตแพทยศาสตร์": "Dentistry",
    "เภสัชศาสตร์": "Pharmacy", "พยาบาลศาสตร์": "Nursing", "สาธารณสุขศาสตร์": "Public Health",
    "สัตวแพทยศาสตร์": "Veterinary Medicine", "เทคนิคการแพทย์": "Medical Technology",
    "ศิลปกรรมศาสตร์": "Fine and Applied Arts", "ศิลปศาสตร์": "Liberal Arts",
    "ศิลปะ": "Arts", "การออกแบบ": "Design", "ออกแบบ": "Design", "ภูมิสถาปัตยกรรม": "Landscape Architecture",
    "การจัดการ": "Management", "จัดการ": "Management", "การตลาด": "Marketing",
    "การเงิน": "Finance", "การท่องเที่ยว": "Tourism", "การโรงแรม": "Hotel", "โลจิสติกส์": "Logistics",
    "นิเทศศาสตร์": "Communication Arts", "การสื่อสาร": "Communication", "สื่อสาร": "Communication",
    "สารสนเทศ": "Information", "สารสนเทศศาสตร์": "Information Science", "ข้อมูล": "Data",
    "วิทยาการ": "Science", "วิทยาการคอมพิวเตอร์": "Computer Science", "คอมพิวเตอร์": "Computer",
    "ปัญญาประดิษฐ์": "Artificial Intelligence", "ซอฟต์แวร์": "Software", "เครือข่าย": "Network",
    "ไซเบอร์": "Cyber", "ความมั่นคง": "Security", "สถิติ": "Statistics", "คณิตศาสตร์": "Mathematics",
    "ฟิสิกส์": "Physics", "เคมี": "Chemistry", "ชีววิทยา": "Biology", "ชีวเคมี": "Biochemistry",
    "จุลชีววิทยา": "Microbiology", "ชีวภาพ": "Biological", "ชีวการแพทย์": "Biomedical",
    "สิ่งแวดล้อม": "Environmental", "พลังงาน": "Energy", "ทดแทน": "Renewable",
    "วัสดุ": "Materials", "โลหะ": "Metallurgical", "ปิโตรเลียม": "Petroleum", "ธรณีวิทยา": "Geology",
    "ภูมิศาสตร์": "Geography", "จิตวิทยา": "Psychology", "สังคมวิทยา": "Sociology",
    "มานุษยวิทยา": "Anthropology", "ประวัติศาสตร์": "History", "ปรัชญา": "Philosophy",
    "ภาษา": "Language", "ภาษาอังกฤษ": "English", "ภาษาไทย": "Thai", "ภาษาจีน": "Chinese",
    "ภาษาญี่ปุ่น": "Japanese", "ภาษาเกาหลี": "Korean", "วรรณคดี": "Literature", "วรรณกรรม": "Literature",
    "บรรณารักษศาสตร์": "Library Science", "ดนตรี": "Music", "นาฏศิลป์": "Dance", "ศิลปะการแสดง": "Performing Arts",
    "ภาพยนตร์": "Film", "ภาพเคลื่อนไหว": "Animation", "มีเดียอาตส์": "Media Arts", "มีเดีย": "Media",
    "ดิจิทัล": "Digital", "นวัตกรรม": "Innovation", "กราฟิก": "Graphic", "เกม": "Game",
    # engineering fields
    "ไฟฟ้า": "Electrical", "เครื่องกล": "Mechanical", "โยธา": "Civil", "เคมีวิศวกรรม": "Chemical",
    "อุตสาหการ": "Industrial", "อุตสาหกรรม": "Industrial", "อิเล็กทรอนิกส์": "Electronics",
    "โทรคมนาคม": "Telecommunication", "สื่อสารโทรคมนาคม": "Telecommunication", "ไฟฟ้าสื่อสาร": "Electrical Communication",
    "เมคคาทรอนิกส์": "Mechatronics", "หุ่นยนต์": "Robotics", "อัตโนมัติ": "Automation",
    "ควบคุม": "Control", "เครื่องมือวัด": "Instrumentation", "เครื่องมือ": "Instrument", "วัด": "Measurement",
    "ระบบ": "System", "ระบบไฟฟ้า": "Electrical System", "กำลัง": "Power", "การผลิต": "Production",
    "ผลิต": "Production", "ยานยนต์": "Automotive", "อากาศยาน": "Aerospace", "การบิน": "Aviation",
    "เหมืองแร่": "Mining", "ทรัพยากร": "Resources", "ธรณี": "Geo", "สำรวจ": "Survey", "ชลประทาน": "Irrigation",
    "ขนส่ง": "Transportation", "การก่อสร้าง": "Construction", "ก่อสร้าง": "Construction",
    "อาหาร": "Food", "การเกษตร": "Agricultural", "เกษตร": "Agricultural", "พืช": "Plant", "สัตว์": "Animal",
    "ประมง": "Fisheries", "ป่าไม้": "Forestry", "อุตสาหกรรมเกษตร": "Agro-Industry",
    "กีฬา": "Sports", "การกีฬา": "Sports", "สุขภาพ": "Health", "การแพทย์": "Medical", "ทางการแพทย์": "Medical",
    "กายภาพบำบัด": "Physical Therapy", "รังสี": "Radiology", "สาธารณสุข": "Public Health",
    "ชุมชน": "Community", "การพัฒนา": "Development", "พัฒนา": "Development", "ประยุกต์": "Applied",
    "ศาสตร์": "Science", "เทคนิค": "Technical", "เทคโนโลยีสารสนเทศ": "Information Technology",
    "อุตสาหกรรมบริการ": "Service Industry", "บริการ": "Service", "ธุรกิจ": "Business", "บริหาร": "Administration",
    "การศึกษา": "Education", "ปฐมวัย": "Early Childhood", "ประถมศึกษา": "Primary", "มัธยมศึกษา": "Secondary",
    "นานาชาติ": "International", "ระหว่างประเทศ": "International", "ความสัมพันธ์": "Relations",
    "อุตสาหกรรมและเทคโนโลยี": "Industrial Technology", "สหกิจศึกษา": "Cooperative Education",
    "ทั่วไป": "General", "พื้นฐาน": "Basic", "สังคม": "Social", "วัฒนธรรม": "Culture", "ท้องถิ่น": "Local",
    "การสอน": "Teaching", "สอน": "Teaching", "แนะแนว": "Guidance", "การวัดผล": "Assessment",
    "ธุรกิจดิจิทัล": "Digital Business", "การค้า": "Trade", "การพาณิชย์": "Commerce",
    "นิติ": "Legal", "ระบบสารสนเทศ": "Information Systems", "เรขศิลป์": "Graphic Arts", "ผลิตภัณฑ์": "Product",
    "แฟชั่น": "Fashion", "สิ่งทอ": "Textile", "เซรามิก": "Ceramics", "พลาสติก": "Plastics", "ยาง": "Rubber",
    "ภายใน": "Interior", "ผังเมือง": "Urban Planning", "ชีวสารสนเทศ": "Bioinformatics",
    "การวิจัย": "Research", "วิจัย": "Research", "การดูแล": "Care", "ผู้สูงอายุ": "Elderly",
    "แพทย์": "Medical", "แผนไทย": "Thai Traditional Medicine", "ประยุกต์ทางการแพทย์": "Applied Medical",
    "ทัศนศิลป์": "Visual Arts", "ศิลปกรรม": "Fine Arts", "วิชาชีพ": "Professional",
}
# whole phrases that are not compositional
PHRASES = {
    "วิทยาลัยนานาชาติ": "International College",
    "วิทยาลัยการคอมพิวเตอร์": "College of Computing",
    "วิทยาลัยการปกครองท้องถิ่น": "College of Local Administration",
    "วิทยาลัยการบิน": "College of Aviation",
    "หลักสูตรนานาชาติ": "International Programme",
    "หลักสูตรภาษาอังกฤษ": "English Programme",
    "หลักสูตรภาษาไทย": "Thai Programme",
}
CONNECTOR = "และ"
_KEYS = sorted({**WORDS, **PHRASES}, key=len, reverse=True)
_ALL = {**WORDS, **PHRASES}
_THAI = re.compile(r"[฀-๿]")


def has_thai(s: str) -> bool:
    return bool(_THAI.search(s))


def _segment(seg: str) -> str | None:
    """One clause with no spaces, parentheses, hyphens or `และ`."""
    out: list[str] = []
    i = 0
    while i < len(seg):
        for k in _KEYS:
            if seg.startswith(k, i):
                out.append(_ALL[k])
                i += len(k)
                break
        else:
            ch = seg[i]
            if has_thai(ch):
                return None
            j = i
            while j < len(seg) and not has_thai(seg[j]) and not any(seg.startswith(k, j) for k in _KEYS):
                j += 1
            out.append(seg[i:j])
            i = j
    # collapse repeats such as "Engineering" + "Engineering"
    res: list[str] = []
    for w in out:
        if not res or res[-1] != w:
            res.append(w)
    return " ".join(reversed(res))


_SPLIT = re.compile(r"(\s+|[()\-–/]|และ)")


def translate(text: str) -> str | None:
    text = text.strip()
    if not text:
        return None
    if text in PHRASES:
        return PHRASES[text]
    parts = _SPLIT.split(text)
    out: list[str] = []
    for p in parts:
        if p == "" or p.isspace():
            continue
        if p == "และ":
            out.append("and")
        elif p in "()":
            out.append(p)
        elif p in ("-", "–"):
            out.append("-")
        elif p == "/":
            out.append("/")
        else:
            t = PHRASES.get(p) or _segment(p)
            if t is None:
                return None
            out.append(t)
    s = ""
    for tok in out:
        if tok == "(":
            s += (" " if s else "") + "("
        elif tok == ")":
            s += ")"
        elif tok in ("-", "/"):
            s += f" {tok} "
        elif s.endswith(("(", " - ", " / ")) or not s:
            s += tok
        else:
            s += " " + tok
    return " ".join(s.split()).replace("( ", "(").replace(" )", ")")


def faculty_en(name_th: str) -> str | None:
    for prefix, en in (("คณะ", "Faculty of "), ("วิทยาลัย", "College of "), ("สำนักวิชา", "School of "), ("สถาบัน", "Institute of ")):
        if name_th in PHRASES:
            return PHRASES[name_th]
        if name_th.startswith(prefix):
            rest = translate(name_th[len(prefix):])
            return None if rest is None else en + rest
    return translate(name_th)
