---
layout: home
hero:
  name: Program Landscape
  text: Developer manual for adopting institutions
  tagline: Fork it, point it at your own data and run it, without losing the provenance and audit trail that make its numbers trustworthy.
  actions:
    - theme: brand
      text: Start with the adopter guide
      link: /adopters/README
    - theme: alt
      text: Getting started
      link: /tutorials/getting-started
features:
  - title: Start
    details: What the platform is, the licence, the architecture and how the scores fit together.
    link: /adopters/README
  - title: Adapt your data
    details: The connector contract, the source catalogue and one spec per data source.
    link: /data-sources
  - title: Run it
    details: Pack-and-ship deployment, backups and disaster recovery.
    link: /backup-dr
  - title: Reference
    details: Every pnpm script and environment variable, generated from the repository on each build.
    link: /_generated/scripts
---

Program Landscape is a decision-support platform for university councils. It scores academic programmes against demand, finances, quality and future skills, and every number carries its sources, freshness and methodology version.

The code is licensed **CC BY-NC-SA 4.0**: attribution and ShareAlike are obligations and commercial use is not permitted, and the licence covers neither KKU's trademarks nor its data. Read [Licensing](./licensing.md) before you publish anything built from it.

This site renders the repository's `docs/` folder in place. To change a page, edit its Markdown file in the repository. Pages marked *Generated* are rebuilt from their source on every build.
