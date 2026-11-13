# Personal data (PDPA)

## What counts

National ID (13 digits), passport number, a person's name together with a student or staff ID, phone numbers, personal email, home address, and sensitive data — health, religion, financial details of a person.

## Rules

- **Fixtures:** start from the sample's *shape*, invent every value. Codes like `PRACTICE-01`, names like `Test Person`, round invented numbers. Never copy a real response, even partly.
- **Schemas:** list only the fields you map. A field you do not declare is never held.
- **`toRows`:** drop personal fields; when a dataset needs a person-level fact as a count, aggregate at source (e.g. headcount per programme), never pass identities.
- **Logs and metadata:** `ctx.log` with counts and positions only; never log a record. Run metadata is written without cell values by design — keep it that way.
- **Chat and commits:** show field *names* from a probe, not values. If a sample the human pasted contains personal data, say so and do not repeat it.
- **Docs:** the data-source page holds the mapping table and quirks, never example values.
