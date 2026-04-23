# Custom Gotenberg image — adds TH Sarabun New system-wide so Chromium
# can embed it in PDF output. TH Sarabun New is the Cabinet-mandated font
# for Thai government documents (Cabinet Resolution, 7 September 2010).
#
# Build from repo root:
#   docker compose build gotenberg
#
# The four .ttf files must be placed in ./fonts/ before building. They
# are *not* committed to the repo even though their license permits it —
# see ./README.md for sourcing instructions.

FROM gotenberg/gotenberg:8

USER root

# fonts-thai-tlwg: TLWG's open Thai font pack (fallbacks for any glyph
#   TH Sarabun New happens to be missing).
# fontconfig: provides fc-cache / fc-list used below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-thai-tlwg \
        fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Copy TH Sarabun New — 4 weights. If any of these files is missing from
# ./fonts/ on the host, the build fails here with a clear error.
COPY fonts/THSarabunNew.ttf            /usr/share/fonts/truetype/thsarabun/THSarabunNew.ttf
COPY fonts/THSarabunNew-Bold.ttf       /usr/share/fonts/truetype/thsarabun/THSarabunNew-Bold.ttf
COPY fonts/THSarabunNew-Italic.ttf     /usr/share/fonts/truetype/thsarabun/THSarabunNew-Italic.ttf
COPY fonts/THSarabunNew-BoldItalic.ttf /usr/share/fonts/truetype/thsarabun/THSarabunNew-BoldItalic.ttf

RUN fc-cache -f -v

# Build-time verification: fail loudly if the font didn't register. Without
# this, a font-copy error silently produces an image that renders tofu
# boxes at runtime — the worst possible failure mode for Thai PDFs.
RUN fc-list | grep -ci 'sarabun' | (read n; [ "$n" -ge 4 ] || { \
      echo "FATAL: expected at least 4 Sarabun font faces, found $n"; \
      fc-list | grep -i sarabun || echo "(none)"; \
      exit 1; \
    })

USER gotenberg
