# Facilitator guide

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/facilitator.md)

For the people running the 1.5-day workshop. Participants follow the session
pages on their own laptops; your job is to keep everyone moving and to rescue
the ones who fall behind.

## Before the day

1. **Two weeks before:** send every participant the link to
   [Before the day](./00-before-the-day.md). Ask them to reply with the output
   of its last section, "Check you are ready".
2. **One week before:** chase anyone who has not replied. A laptop that has not
   run `pnpm setup` at home will spend the morning downloading on the room's
   network, and university-managed laptops often block WSL2 or Docker: find out
   now, not on the day.
3. **A few days before:** start opencode, type `/models`, and confirm there is
   still a free model. The free list changes often.
4. **A few days before:** go through sessions 1, 2, 3 and 6 yourself on a clean
   database with the current `main`, and note how long the pipeline takes and
   what it costs.
5. Prepare a **spare AI key** with a spending cap (see below), and the KMITL
   credentials if your institution has them.
6. Ask participants on the real-data track to bring files with personal data
   already removed. Do not accept files with national IDs or birth dates.

## Early notice e-mail

Send this as soon as ทปอ. confirms the team list (registration closes 10 Nov).
Replace the link and the contact line before sending. It is in Thai because it
goes to every team.

```text
เรียน ทีม AIUI ของมหาวิทยาลัย

ทีมของท่านได้รับการยืนยันเข้าร่วม workshop AIUI วันที่ 23–24 พ.ย. แล้ว
ขอให้เริ่มเตรียม 3 เรื่องตั้งแต่สัปดาห์นี้:

1. เลือกหนึ่งหลักสูตรที่จะใช้สาธิต
2. ขอข้อมูลส่งออกของหลักสูตรนั้นและ PDF เล่มหลักสูตรจากเจ้าของข้อมูลทันที
   (หากไม่ทัน ใช้ข้อมูลจำลองได้ครบทั้งเส้นทาง)
3. ตรวจว่าแล็ปท็อปติดตั้ง WSL2 และ Docker ได้

รายละเอียด: <link to docs/th/workshop/early-notice.md>

การประชุมเตรียมความพร้อมออนไลน์: 16 พ.ย.
ส่งแบบฟอร์มความพร้อม: ภายใน 19 พ.ย. เวลา 18:00 น.

ติดต่อ: [instructor contact]
```

## Room and network

- Power for every laptop for the whole day.
- Internet access to these hosts. Give the list to the network team in advance:

| Host | Used for |
|---|---|
| `generativelanguage.googleapis.com` | Google Gemini (pipeline, embeddings) |
| `openrouter.ai` | OpenRouter, if used |
| `population.un.org` | `un-wpp` connector |
| `www.mytcas.com`, `assets.mytcas.com` | `tcas` connector, real-data track |
| `api.openalex.org` | `openalex-works` connector, real-data track |
| `skill.kmitl.ac.th` | `kmitl-skill-mapping`, if used |
| `opencode.ai` | opencode and its free models |
| `github.com` | Pulling the latest `main` |

Docker images and packages are downloaded in the pre-work, not in the room. If
a participant's pre-work failed, they also need `registry.npmjs.org`,
`registry-1.docker.io` and `deb.debian.org`, and about 6 GB of download.

## Schedule

| Time | Day 1 |
|---|---|
| 09:00 | Welcome. What the app is for, the Deep-Dive in two minutes on your screen. |
| 09:15 | [Session 1](./01-environment-and-ai-tools.md): environment and AI tools. |
| 10:00 | [Session 2](./02-architecture-and-source.md): architecture and source. Everyone claims their administrator before the break. |
| 10:30 | Break. |
| 10:45 | Session 2 continued: trace the Finance section, the rules every change follows. |
| 12:00 | Lunch. |
| 13:00 | [Session 3](./03-university-data.md): organisation profile and uploads. |
| 13:45 | Session 3: attach the PDF and **start the pipeline and `un-wpp` before the break**. |
| 14:30 | Break, while pipelines run. |
| 14:45 | Session 3: Setup checklist, then the Deep-Dive. |
| 15:30 | Real-data track for those with files; others explore the Deep-Dive and its provenance drawers. |
| 16:30 | End of day 1. |

| Time | Day 2 |
|---|---|
| 09:00 | Session 4: hands-on integration with AI (page to come). |
| 10:30 | Break. |
| 10:45 | Session 5: AI-assisted curriculum analytics (page to come). |
| 12:00 | Lunch. |
| 13:00 | [Session 6](./06-testing-and-security.md): testing, validation and security. |
| 14:15 | Wrap-up: what each university does next, questions. |
| 14:30 | End. |

## Long steps and timing

- **The pipeline** takes about 20 to 25 minutes per programme and costs about
  USD 0.40 to 0.80. Make sure every participant starts it before the
  afternoon break of day 1.
- **`un-wpp`** downloads about 68 MB. Twenty laptops starting it at once is
  about 1.4 GB through the room's connection: stagger it by table if the
  network is weak.
- **`pnpm skills:normalise --source=linkedin --auto-promote`** takes about an
  hour and is needed only with KMITL credentials. If you have them, run it on
  your own machine beforehand to learn the time, and have participants start
  it first thing in session 3.
- **Free Google keys** embed about 1,000 course texts a day. The sample
  programme is well under that. A participant who also runs their own large
  programme may hit the limit; the overlap section then uses shared course
  codes only, which is fine for the workshop.

## Recovery plans

| Problem | What to do |
|---|---|
| A participant's key fails or runs out of credit | Lend the spare key. On OpenRouter, create a separate key with a credit limit (for example USD 2) for each person you lend to, and delete it after the day. |
| Pre-work was not done | Start `pnpm setup` at once. Pair the participant with a neighbour for sessions 1 and 2 while it runs. |
| A pipeline fails part way | Run it again. Finished phases are cheap to repeat. |
| A laptop is too slow or freezes | Pair the participant with a neighbour. Sessions 4 and 5 still work in pairs. |
| Something not on the [Troubleshooting](./troubleshooting.md) page | Read the full message with the participant; most refusals name the row, column or setting to fix. |

## After the workshop

- Delete the spare keys you lent.
- Remind real-data participants that their laptops now hold their university's
  data: delete it with "Start over" on each dataset page, or remove the
  database with the rest of the app, unless their institution approved
  keeping it.
- Collect what went wrong and send it to the maintainers, so the pages can be
  corrected before the next workshop.
