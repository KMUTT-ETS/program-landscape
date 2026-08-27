# Licensing — releasing Program Landscape under a content licence

**Status:** engineering guidance, written 2026-08-27 against `main`.

> **This is not legal advice.** It is an engineering briefing note for Khon Kaen University's legal office and for adopting institutions. It describes how a software project behaves under a Creative Commons licence, where the gaps are, and what is conventionally added to close them. Every recommendation in it is a suggestion for counsel to accept, modify, or reject. **KKU's legal office makes the final call.**

**The decision is made and it stands.** Program Landscape is released under **CC BY-NC-SA 4.0** (see [`LICENSE`](../LICENSE)). This document does not relitigate that. Its purpose is to set out what good practice looks like when a *software* project ships under a *content* licence, and what to add so that KKU's intent actually holds in practice.

---

## Table of contents

1. [The short version](#1-the-short-version)
2. [Why the fit is imperfect](#2-why-the-fit-is-imperfect)
3. [What to add so the intent holds](#3-what-to-add-so-the-intent-holds)
4. [Software-native alternatives, for comparison](#4-software-native-alternatives-for-comparison)
5. [What this repository already does right](#5-what-this-repository-already-does-right)
6. [Checklist before external release](#6-checklist-before-external-release)

---

## 1. The short version

CC BY-NC-SA 4.0 gets KKU most of what it wants: adopters must credit KKU, must keep derivatives open under the same terms, and may not commercialise the work. For the parts of this repository that are genuinely *content* — `docs/`, the methodology papers, the design tokens, the written prompts — it is a good, well-understood, internationally recognised licence.

For the parts that are *code*, it leaves four specific gaps. Creative Commons themselves say so:

> "We recommend against using Creative Commons licenses for software. Instead, we strongly encourage you to use one of the very good software licenses which are already available."
> — Creative Commons FAQ, *Can I apply a Creative Commons license to software?*

The gaps are not fatal and they are not reasons to reverse the decision. They are reasons to **add four short documents alongside the licence**: a patent grant, a published interpretation of "NonCommercial", a source-availability clause, and a contribution policy. Sections 2 and 3 explain each one.

The cost of not adding them is not that the licence fails immediately. It is that the first time a dispute arises — an adopter's spin-off, a contributor's patent, a hosted derivative with no source — KKU discovers the licence did not say what everyone assumed it said.

---

## 2. Why the fit is imperfect

Four gaps, each with a concrete failure it permits.

### 2.1 No patent grant

Apache-2.0 §3, GPL-3.0 §11, and PolyForm's patent terms all do the same thing: every contributor who holds a patent covering their contribution grants everyone downstream a licence to that patent, and loses the grant if they sue over it. **CC BY-NC-SA has no equivalent.** Section 2(b)(1) of the legal code says patent rights are "not licensed" — the omission is explicit, not accidental.

**What that permits.** A contributor — an employee, a contractor, a partner university, a vendor — contributes code covered by a patent they or their employer holds. Later, they assert that patent against an adopting university that is running the very code they contributed. Nothing in CC BY-NC-SA stops them. The adopter's only defence is whatever implied licence a Thai court is willing to read in, which is not a position anyone should want to be in.

**Likelihood here.** Low but not zero. This is a data-integration and analytics platform; the patent-dense areas of software are elsewhere. But the mitigation is cheap and the exposure runs indefinitely.

### 2.2 No source-code obligation

This is the gap most likely to surprise people, because "ShareAlike" sounds like it covers it.

ShareAlike (Section 3(b)) requires that when you share an **Adapted Work**, you licence it under a compatible licence and pass on the same terms. That is a licence-terms obligation. **It is not a source-code obligation.** CC BY-NC-SA has no concept of "Corresponding Source" — the machinery GPL-3.0 §1 uses to define exactly what must accompany a binary. It does add one narrow anti-lockdown rule at 3(a)(4): you may not impose technological measures that restrict recipients' exercise of the licensed rights.

**What that permits.** An adopter forks Program Landscape, makes substantial improvements, builds a Docker image, and distributes only the image — or, more likely, deploys it as an internal hosted service for a consortium of universities and distributes nothing at all. The derivative is nominally under CC BY-NC-SA, and the recipients have the right to modify it, but they have not been given the source with which to do so. That is almost certainly not what KKU means by "share alike".

The hosted case is worse. Like every licence except the AGPL family, CC BY-NC-SA is triggered by **distribution**, not by making software available over a network. An adopter can host a heavily modified fork indefinitely, serve it to thousands of users, and never trigger any obligation at all.

**Likelihood here.** High. Program Landscape is a web application. Hosted-only derivatives are the normal deployment shape for this kind of software, not an edge case.

### 2.3 ShareAlike's scope is undefined for linking

For prose or a photograph, "is this an adaptation?" is usually answerable. For code it is a technical question about boundaries: static linking, dynamic linking, importing a package, calling an HTTP API, running as a separate process, deploying in the same container.

The GPL family has spent thirty years accumulating answers — the FSF's published positions, the LGPL's explicit linking carve-out, GPL-3.0 §13's Affero interoperation clause, and a body of practice that lawyers can reason from. **CC has none of that for code, because CC licences were not written with code in mind.**

**What that permits — or rather, leaves unresolved.** An adopter writes a new NestJS module that imports `@kku/db` and `@kku/shared`, and publishes it as a proprietary internal package. Adaptation, or an independent work that merely uses an interface? Genuinely unclear. Now consider the more realistic case in this architecture: an adopter runs Program Landscape unmodified and writes a separate service that calls its REST API. Almost certainly not an adaptation — but "almost certainly" is doing a lot of work, and neither party has a text to point at.

**Likelihood here.** High, structurally. This is a pnpm monorepo of eight workspace packages with explicit connector interfaces. It is *designed* to be extended by importing its packages and implementing its interfaces. The adopter guide actively instructs adopters to write their own connectors against `packages/shared` contracts. Every one of those connectors sits in the undefined zone.

### 2.4 "NonCommercial" is genuinely ambiguous in a university context

CC defines NonCommercial as "not primarily intended for or directed towards commercial advantage or monetary compensation" (Section 1(k)). For an individual sharing a photograph, workable. For a public university, the term does not resolve.

Consider what an adopting Thai university actually does, all of it routine:

| Activity | Commercial? |
|---|---|
| Running the platform to plan its own programme portfolio, funded by tuition | Almost certainly not — but tuition *is* monetary compensation for education |
| Using it in a contract-research project for a government agency | Unclear. The project is funded and produces a deliverable |
| Using it in a consultancy engagement for another university, for a fee | Probably yes |
| Using outputs in a paid executive-education or short course | Unclear |
| A university spin-off company offering it as a hosted service | Yes |
| A university-owned company using it for internal planning | Unclear |
| A private (for-profit) Thai university running it internally | Unclear, and this is the sharpest case — the *institution* is commercial even when the *use* is internal administration |

**This is not a theoretical risk. It is the central practical risk of this licence choice**, because the intended adopters are universities, and universities do every item on that list. The last row matters especially: Thailand has a substantial private higher-education sector, and CC's own guidance notes that the nature of the *user* is not determinative — but it does not say the nature of the user is irrelevant either.

CC's own FAQ acknowledges the difficulty and declines to resolve it, pointing licensors instead toward stating their own intent. Which is exactly what section 3.2 below recommends.

**Consequence if left unaddressed.** Adopters resolve the ambiguity themselves, in one of two ways. Cautious institutions over-comply — they decline to adopt at all, or exclude uses KKU would have been perfectly happy with, which defeats the point of releasing the platform. Less cautious ones under-comply and KKU has no clean remedy short of a lawsuit it does not want. Either way, the ambiguity costs KKU something.

---

## 3. What to add so the intent holds

In priority order. Items 1 and 2 are the ones that matter most; 5 and 6 are hygiene that gets harder the longer it is deferred.

### 3.1 An explicit patent grant (priority: high)

Publish a **patent rider** alongside `LICENSE`, modelled on Apache-2.0 §3. The Apache clause is the industry-standard drafting, has been reviewed by many legal teams, and can be adapted without inventing new language. Its two operative halves:

- **The grant.** Each contributor grants a perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent licence to make, use, and distribute the work, limited to claims that the contributor's own contribution necessarily infringes.
- **The defensive termination.** If you initiate patent litigation alleging the work infringes, your patent licence under this instrument terminates.

Two drafting notes for counsel:

- Adapt the scope so it does not accidentally grant rights broader than the copyright licence itself. Apache-2.0 permits commercial use; CC BY-NC-SA does not. The patent grant should be scoped to use permitted by the CC licence, or KKU has granted patent rights for commercial use it did not otherwise permit.
- The rider must bind **contributors**, not only KKU. That means it has to be tied to the contribution policy in 3.4 — a rider KKU publishes unilaterally binds KKU alone, which addresses only part of the risk.

**Deliverable:** `PATENTS.md` in the repository root, referenced from `LICENSE` and from the contribution policy.

### 3.2 A published interpretation of "NonCommercial" (priority: high)

This is the highest-value item in this document, and the cheapest.

An ambiguous licence term that the **licensor has interpreted publicly and in advance** is far safer than one left for a court. It is evidence of the parties' understanding, adopters can rely on it, and it costs KKU one page.

Publish a short statement — as `docs/noncommercial-policy.md`, referenced from `LICENSE` — saying plainly what KKU does and does not consider commercial **for this work**. A workable starting point for counsel to edit:

> **Permitted (KKU does not consider these commercial use of this work):**
> - Use by any educational institution, public or private, to plan, evaluate, or administer its own academic programme portfolio, including where that institution is funded by tuition fees.
> - Use by a government body, ministry, or accreditation agency in its public functions.
> - Use in academic research and in publications arising from it.
> - Use in teaching, including in courses for which the institution charges tuition.
> - Internal deployment on infrastructure the institution owns, leases, or contracts, including a cloud provider paid at commercial rates.
>
> **Not permitted without separate written permission from KKU:**
> - Selling, sublicensing, or renting the work or any adaptation of it.
> - Offering the work or an adaptation as a hosted or managed service for a fee.
> - Bundling the work or an adaptation into a commercial product or a paid consultancy deliverable.
> - Using the work to produce analyses sold to third parties.
> - Use by a commercial entity that is not an educational institution, other than a contractor acting on an institution's behalf and under its control.
>
> **Ask us.** Anything not listed — contract research, executive education, a university spin-off, a consortium service — is not automatically prohibited. Write to the licensing contact in `LICENSE`. KKU intends to grant such permission where the use serves Thai higher education.

Two things make this statement work. First, the **contractor carve-out**: adopters will hire vendors, and without it every implementation contract is arguably a violation. Second, the **"ask us" clause with a stated disposition to say yes** — it converts an ambiguity that adopters resolve silently and defensively into a conversation KKU gets to have.

### 3.3 A source-availability clause (priority: medium-high)

If KKU wants derivatives to remain genuinely open — and the ShareAlike choice implies it does — say so explicitly, because §2.2 shows the licence does not.

Add a clause, as a condition of the licence grant, requiring that anyone distributing an adaptation **or operating one as a network service** make the complete corresponding source available to recipients or users, under CC BY-NC-SA 4.0, for as long as they distribute or operate it.

Drafting notes:

- Borrow GPL-3.0 §1's definition of "Corresponding Source". Do not invent one — the definition is where the difficulty lives, and GPL's has been tested.
- Decide deliberately whether to include the **network-use trigger** (the AGPL-3.0 §13 idea). Given that this is a web application and hosted-only derivatives are the likely shape, KKU probably wants it. It is also the most burdensome thing on adopters, so it is a genuine policy choice, not a technicality.
- A publicly readable repository satisfying the clause is the simplest compliance path and worth naming as the recommended one.

**Deliverable:** a section in `LICENSE`'s header or a separate `SOURCE-AVAILABILITY.md`, referenced from `LICENSE`.

### 3.4 A contribution policy — DCO or CLA (priority: medium)

The adopter guide anticipates adopters sending fixes upstream. Today there is no instrument under which KKU can accept them. Without one, every merged external contribution leaves KKU holding code whose provenance and licensing status are unclear — which is exactly the thing that blocks a future relicensing or a dual-licensing arrangement.

Two options:

| | **DCO** (Developer Certificate of Origin) | **CLA** (Contributor Licence Agreement) |
|---|---|---|
| What it is | A one-line `Signed-off-by:` in each commit certifying the contributor has the right to submit it | A signed agreement granting KKU a licence (or assigning copyright) plus an explicit patent grant |
| Friction | Very low — `git commit -s` | High — a signature step before a first contribution |
| Gives KKU | Certification of provenance | Provenance, a broad licence, a patent grant, and the ability to relicense later |
| Used by | Linux, most of CNCF | Apache, Google, most corporate-backed projects |

**Recommendation:** start with the **DCO**, because friction suppresses contribution and the flow of upstream fixes is worth more early than the optionality a CLA preserves. Move to a CLA only if KKU foresees relicensing or dual-licensing. Whichever is chosen, it must carry the patent grant from 3.1 — that is the mechanism by which the grant binds contributors rather than only KKU.

**Deliverable:** `CONTRIBUTING.md` stating the policy, plus a DCO check in `.github/workflows/pr.yml`.

### 3.5 SPDX headers and a NOTICE file (priority: medium)

Licence information that lives only in a root `LICENSE` file does not survive the way code actually travels — a copied file, a vendored package, a pasted snippet.

**SPDX headers.** Add to source files KKU authored:

```ts
// SPDX-License-Identifier: CC-BY-NC-SA-4.0
// SPDX-FileCopyrightText: 2026 Khon Kaen University
```

`CC-BY-NC-SA-4.0` is the correct SPDX identifier. Applying it is mechanical (`reuse annotate`, or a codemod), and it makes the repository machine-auditable by the standard tooling adopters' own compliance teams will use.

Scope it deliberately: KKU-authored source under `apps/`, `packages/`, and `scripts/`. Not generated files (`packages/db/prisma/generated/`), not vendored assets, not lockfiles, not migration SQL emitted by Prisma.

**NOTICE file.** A root `NOTICE` carrying the copyright line, the licence identifier, the attribution string, the trademark reservation, and a pointer to third-party licences. It is the conventional place adopters look, and Apache-style tooling propagates it automatically.

### 3.6 A dependency licence audit before release (priority: medium, but do it first in time)

This repository has a large dependency tree — a pnpm monorepo with eight workspace packages, a Next.js app, a NestJS API, an ingestion service with native database drivers, plus container images for PostgreSQL, Redis, MinIO, Gotenberg, and nginx. **KKU should know what is in it before publishing, not after.**

Run, and record the output as a release artefact:

```bash
pnpm licenses list --json > dependency-licenses.json
npx license-checker-rseidelsohn --summary   # or a comparable tool
```

What to look for, in order of concern:

- **Copyleft in the runtime tree.** GPL or AGPL in a *runtime* dependency is the finding that would actually change plans. Dev-only dependencies are far lower risk but should still be identified and labelled as such.
- **Non-commercial or field-of-use restrictions** in a dependency. Rare, but they compound with KKU's own NC term and can make redistribution impossible.
- **Custom or unrecognised licences**, and packages with **no licence field at all** — the latter means "all rights reserved" by default, not "public domain".
- **Container base images**, which the JavaScript tooling above will not see at all. Check the Dockerfiles under `apps/*/Dockerfile.prod` and `infra/` separately.
- **Fonts**, separately again. TH Sarabun New has its own terms and is deliberately not committed (`infra/gotenberg/README.md`); IBM Plex is OFL; the bundled Sarabun files under `apps/web/public/fonts/sarabun/` should be confirmed as OFL.

Then publish the result. A `THIRD-PARTY-LICENSES.md` generated from that audit is the artefact adopters' compliance teams will ask for, and generating it once is much easier than answering the question repeatedly.

---

## 4. Software-native alternatives, for comparison

**Presented for KKU legal's information, not as advocacy.** The CC BY-NC-SA decision stands. These are recorded so that if the question is reopened — at a version 2.0, or if an adopter's counsel raises it — the options are already on the table with their trade-offs stated.

### PolyForm Noncommercial 1.0.0

**What it gives.** A licence purpose-built for software that restricts use to non-commercial purposes. Drafted in plain English by a team of experienced software lawyers, deliberately short, and structured the way software licences are structured — it addresses source, distribution, and remedies as software concepts. It is the closest true equivalent to "BY-NC" for code, and its non-commercial definition ("any purpose other than commercial advantage or private monetary compensation") is written with software use in mind.

**What it costs.** **No ShareAlike.** Derivatives need not stay open, which is a substantial part of what KKU chose CC BY-NC-SA for. Also much less recognised than Creative Commons — a Thai university's legal office will know what CC BY-NC-SA is and may never have heard of PolyForm. Not OSI-approved (by design — non-commercial licences cannot be). Little case law.

### AGPL-3.0

**What it gives.** The strongest, best-tested copyleft available, and it closes §2.2 and §2.3 outright. Real corresponding-source obligations, an explicit patent grant with defensive termination (§11), decades of interpretation for the linking question, and the §13 network clause that reaches hosted derivatives — directly relevant for a web application. OSI-approved, FSF-endorsed, widely understood.

**What it costs.** **It does not restrict commercial use at all**, so it fails KKU's NonCommercial requirement outright. Anyone could take Program Landscape, host it commercially, and sell it — provided they released their source. If NC is a firm requirement, AGPL is out. Worth noting only because if KKU's underlying goal is "derivatives must stay open" rather than "nobody may profit", AGPL achieves that goal considerably better than CC BY-NC-SA does.

### Split licensing — a software licence for code, CC BY-NC-SA for content

**What it gives.** Each part of the repository gets a licence designed for what it actually is. Creative Commons themselves recommend this arrangement. It is also **the option that fits this repository unusually well**, because the split is already visible in the directory structure:

| Part of the repo | What it actually is | Licence that fits |
|---|---|---|
| `apps/`, `packages/` (source) | Software | PolyForm Noncommercial, or AGPL-3.0 + an NC rider |
| `docs/`, including `docs/methodologies/` | Written analytical work — the health-score, forecasting, scenario-engine and risk-scoring methodologies are genuinely papers | CC BY-NC-SA 4.0 |
| `packages/design` tokens, `apps/web/public/brand` (non-KKU-mark assets) | Design assets | CC BY-NC-SA 4.0 |
| `packages/shared/src/ai/prompts/` | Written prompts — content, arguably | CC BY-NC-SA 4.0 |
| KKU marks and logos | Trademarks | Not licensed. Reserved (already the position in `LICENSE`) |

The methodology documents are the strongest argument for this arrangement. `docs/methodologies/health-score.md` and its siblings are the intellectual contribution most worth protecting under a content licence, and they are the part CC BY-NC-SA fits without any of the four gaps in §2 applying.

**What it costs.** Two licences means a boundary, and boundaries generate questions: which licence covers a Zod schema that encodes a methodology? A React component whose only content is a methodology table? SPDX headers (§3.5) make the boundary machine-readable and are effectively a prerequisite. It is also more to explain to adopters — although arguably less to explain than the four ambiguities in §2.

---

## 5. What this repository already does right

Worth recording, so that a future review does not redo settled work:

- **`LICENSE` reserves KKU's trademarks explicitly.** CC does not cover marks, and most projects that adopt a CC licence never notice.
- **Third-party components are carved out explicitly**, so no adopter can reasonably read CC BY-NC-SA as reaching `node_modules` or the fonts.
- **No KKU data is licensed**, stated plainly and enumerated. For a platform whose entire value is the analysis of sensitive institutional data, this is the clause that prevents the most serious category of misunderstanding.
- **The licensing contact is a role address, not a maintainer's personal address** — currently a marked placeholder for KKU to fill in. Personal addresses in licence files stop working when the person moves on, and a licence outlives its maintainers.
- **TH Sarabun New font files are deliberately not committed** (`infra/gotenberg/README.md`), and the Docker build fails loudly without them. Licensing hygiene enforced by the build, which is the only kind that survives.
- **`SECURITY.md` already routes vulnerability reports to a role address** (`security@kku.ac.th`), and `LICENSE` points at it so the two contacts do not get confused.
- **`docs/adopters/README.md` chapter 2 states the licence obligations** in the terms an adopting developer actually needs, and points at this document for their legal office.

---

## 6. Checklist before external release

For whoever runs the release. Ordered by dependency, not by importance.

| # | Item | Owner | Blocking? |
|---|---|---|---|
| 1 | Fill in the licensing contact placeholder in `LICENSE` with a real role address | KKU admin | **Yes** |
| 2 | Run the dependency licence audit (§3.6); resolve any copyleft or NC-incompatible finding in the runtime tree | Engineering | **Yes** |
| 3 | Publish `THIRD-PARTY-LICENSES.md` from that audit | Engineering | **Yes** |
| 4 | Publish the NonCommercial interpretation (§3.2) | KKU legal | Strongly recommended |
| 5 | Publish the patent rider (§3.1) | KKU legal | Strongly recommended |
| 6 | Decide on the source-availability clause, including the network-use trigger (§3.3) | KKU legal | Recommended |
| 7 | Publish `CONTRIBUTING.md` with DCO, and add a DCO check to CI (§3.4) | Engineering + legal | Recommended |
| 8 | Add SPDX headers to KKU-authored source; add `NOTICE` (§3.5) | Engineering | Recommended |
| 9 | Confirm no remaining file describes the project as internal, proprietary, or confidential | Engineering | **Yes** |
| 10 | Confirm the rebranding checklist in `docs/adopters/README.md` chapter 11 is accurate against the current tree | Engineering | Recommended |
| 11 | Have KKU legal review this document and record their decisions against each item in §3 | KKU legal | **Yes** |

---

## References

- CC BY-NC-SA 4.0 legal code — <https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode> (reproduced verbatim in [`LICENSE`](../LICENSE))
- Creative Commons FAQ, *Can I apply a Creative Commons license to software?* — <https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software>
- Creative Commons FAQ, *What does "NonCommercial" mean?* — <https://creativecommons.org/faq/#does-my-use-violate-the-noncommercial-clause-of-the-licenses>
- Apache-2.0 §3, patent grant — <https://www.apache.org/licenses/LICENSE-2.0#patent>
- GPL-3.0 §1, "Corresponding Source" — <https://www.gnu.org/licenses/gpl-3.0.html#section1>
- AGPL-3.0 §13, network use — <https://www.gnu.org/licenses/agpl-3.0.html#section13>
- PolyForm Noncommercial 1.0.0 — <https://polyformproject.org/licenses/noncommercial/1.0.0/>
- Developer Certificate of Origin 1.1 — <https://developercertificate.org/>
- SPDX licence list — <https://spdx.org/licenses/>
- REUSE Software specification (SPDX header tooling) — <https://reuse.software/>

**Related in this repository:** [`LICENSE`](../LICENSE) · [`docs/adopters/README.md`](adopters/README.md) chapter 2 · [`SECURITY.md`](../SECURITY.md) · [`docs/pdpa.md`](pdpa.md)
