# Self-hosted web fonts

Loaded by `apps/web/app/layout.tsx` through `next/font/local`, so `next build`
never downloads fonts (it used to fetch from Google at build time, and a DNS
failure inside the release build container broke the v2.1.1 build).

| Folder | Files | Source |
|---|---|---|
| `sarabun/` | Regular, Medium, SemiBold, Bold `.ttf` (Thai + Latin) | Google Fonts, Sarabun |
| `inter/` | `Inter-latin-variable.woff2` (wght 400–700) | Google Fonts, Inter v20, latin subset |
| `jetbrains-mono/` | `JetBrainsMono-latin-variable.woff2` (wght 400–600) | Google Fonts, JetBrains Mono v24, latin subset |

All three families are licensed under the SIL Open Font License 1.1.

These are the **screen** fonts only. PDFs use TH Sarabun New inside Gotenberg
(`infra/gotenberg/fonts/`), which is a separate, Cabinet-mandated face.
