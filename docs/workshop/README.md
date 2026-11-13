# Workshop: set up Program Deep-Dive

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/README.md)

A two-day hands-on workshop (23–24 November), with a pre-workshop online on
16 November, for the IT staff of a university that adopts Program Landscape. You start from a clean laptop and finish with the Program
Deep-Dive running on it. Use these pages in the room, step by step, or on your
own afterwards: each page works without a facilitator.

## Who this is for

IT staff who are comfortable with a terminal and with code, and who have not
seen this codebase before. You need no knowledge of the app itself.

## What you will have at the end

- The app running on your laptop, with you signed in as its administrator.
- The Deep-Dive of one of your own programmes, from real, mixed or mock data,
  computed by the real pipeline with your own AI key.
- A connector and a new Deep-Dive analysis that you wrote with an AI coding
  assistant.

## Your data

On Day 1 you load one of your own programmes from real exports (path A), real
exports with generated gaps (path B), or a mock set generated for your
university with `pnpm workshop:mock` (path C). See the
[early notice](./early-notice.md#pick-your-data-path).
Remove personal data first: no national ID numbers, no birth dates.

## Schedule

| Block | Session | Exit check |
|---|---|---|
| Before (by 19 Nov) | Before the day: install, first start, your data | Readiness form sent |
| Day 1 09:00–10:30 | 1–2. Environment, architecture and source | App running, signed in as administrator |
| Day 1 10:45–12:00 | 3. University data (your own A/B/C data) | Pipeline running before lunch |
| Day 1 13:00–14:30 | 4. Hands-on integration with AI | Deep-Dive shows your programme; API connector run lands rows (page coming soon) |
| Day 1 14:45–16:00 | 5. AI-assisted curriculum analytics | Your new analysis shows with provenance (page coming soon) |
| Day 2 09:00–12:00 | Joint lectures with your executive | — |
| Day 2 13:00–14:30 | 6. Testing, validation and security | Test Record filled |
| Day 2 14:45–15:30 | Prototype demonstration | Demo given in your pod |
| Day 2 15:30–16:00 | Team sync and 90-day plan | Plan drafted with your executive |

## Pages

Sessions 4 and 5 are still in preparation, so the pages go from session 3
straight to session 6.

| Page | When |
|---|---|
| [Early notice](./early-notice.md) | As soon as your team is confirmed |
| [Before the day](./00-before-the-day.md) | At home, before the readiness deadline (19 Nov) |
| [Session 1: environment and AI tools](./01-environment-and-ai-tools.md) | Day 1 |
| [Session 2: architecture and source code](./02-architecture-and-source.md) | Day 1 |
| [Session 3: university data](./03-university-data.md) | Day 1 |
| [Session 6: testing and security](./06-testing-and-security.md) | Day 2 |
| [Troubleshooting](./troubleshooting.md) | Any time |
| [Facilitator guide](./facilitator.md) | For the people running the day |

## Before the day

Do the [pre-work](./00-before-the-day.md) at home. It downloads several gigabytes, and the room network
may be slow. Bring a laptop that has passed its ready check.
