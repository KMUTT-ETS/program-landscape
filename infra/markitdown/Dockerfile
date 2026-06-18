# markitdown sidecar — converts PDF / DOCX / XLSX / PPTX / HTML / CSV →
# Markdown for LLM ingestion. Microsoft markitdown (MIT). This mirrors the
# Gotenberg sidecar pattern (see infra/gotenberg/): a small HTTP service the
# ingestion worker calls over HTTP, so Python stays out of the Node images.
#
# Build from repo root:
#   docker compose build markitdown
#
# Doc-extras only (NOT markitdown[all]) — keeps the image lean by avoiding
# the audio-transcription path (torch / whisper). The new formats this
# unlocks are DOCX / XLSX / PPTX / HTML; images are EXIF/metadata only
# (markitdown does no OCR without an LLM, which we deliberately do not wire).
FROM python:3.12-slim

# curl — used by the compose healthcheck.
# libmagic1 — content-type sniffing dependency some markitdown paths use.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libmagic1 \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# pip install runs at BUILD time on the dev box (which has internet) and is
# baked into the image — so the air-gapped prod server (docker load) needs
# no network. Pin markitdown to the 0.1 line; bump deliberately.
RUN pip install \
      "markitdown[pdf,docx,pptx,xlsx]~=0.1.0" \
      "fastapi>=0.110" \
      "uvicorn[standard]>=0.30" \
      "python-multipart>=0.0.9"

WORKDIR /app
COPY server.py /app/server.py

# Drop to an unprivileged user (matches the gotenberg image posture).
RUN useradd --uid 10001 --no-create-home markit
USER markit

EXPOSE 8000

# Single worker is plenty — conversion is short and the ingestion worker
# calls it serially per document. Concurrency is bounded upstream.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
