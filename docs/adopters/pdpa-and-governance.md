# PDPA and governance

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/adopters/pdpa-and-governance.md)

**Outcome.** You know which PDPA obligations become yours and which design decisions already carry them.

**This system holds student and staff personal data.** Not aggregates — individual records: hashed citizen IDs, names, birth years, employment history, education qualifications, course evaluations.

## KKU's approval does not transfer to you

The PDPA postures documented throughout this codebase — the column projections in each connector, the hashing at the boundary, the `HAVING COUNT(*) >= 5` small-cell suppression, the legal-basis analysis in `docs/pdpa.md` — were approved by **KKU's** Data Protection Officer for **KKU's** processing. Your institution is a separate data controller under the PDPA. You need your own DPO sign-off, on your own data inventory, before you process anything.

`docs/pdpa.md` and `docs/dsar-workflow.md` are your **starting posture**, not a transferable approval. Read them as "here is a design that a Thai university's DPO has already found acceptable, and here is the reasoning" — then have your own DPO review it against what you are actually doing.

## What the documents contain

`docs/pdpa.md`: roles (controller/processor), a personal-data inventory, legal-basis analysis per data category, how each data-subject right under §30–36 is served, cross-border transfer analysis (relevant because AI calls leave Thailand), audit-log retention, data-minimisation checkpoints, incident response, annual review.

`docs/dsar-workflow.md`: the operational workflow for access requests — intake, admin export flow, identity verification, rectification, erasure, objection to automated decision-making, and record-keeping.

## Design decisions that carry the PDPA weight

Preserve these when you write your own connectors:

- **Aggregate at source.** The SQL `GROUP BY` and `HAVING` clauses run on the source server; per-person rows never cross the wire.
- **Hash at the boundary.** `hashCitizenId()` runs in `transform()`; raw citizen IDs never persist.
- **Downcast dates.** Birth dates become birth years.
- **Explicit projections.** Every connector lists its columns; nothing is `SELECT *`. The projection *is* the trust boundary, and each connector's header comment says so.
- **Read-only service accounts**, never superusers.

Cross-border transfer deserves specific attention: every AI call sends data outside Thailand: to Google or Anthropic, or through OpenRouter to whichever vendor serves the model you chose. `docs/pdpa.md` § *Cross-border data transfer* covers KKU's analysis. Your DPO may reach a different conclusion, and if they require in-country inference the `AiService` abstraction is where you would swap the provider — OpenRouter is a working provider but routes abroad too; the in-country option (`intelsphere`) is still a stub that throws, so that would be real work.

## The readiness gates

`docs/readiness-checklist.md` defines twelve gates that any output must clear before it is Council-facing. A gate failure blocks the affected output and surfaces an in-app banner rather than silently shipping a caveated number. **Gate 11** is the one adopters most often skip: a real connector needs **30 days of green history** before it can drive a Council number. Plan for that delay rather than discovering it the week before your first Council presentation.

## Next step

Continue with [PDPA](../pdpa.md).
