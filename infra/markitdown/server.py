"""Thin HTTP wrapper around Microsoft markitdown.

Two routes, mirroring the Gotenberg sidecar's surface:

  GET  /health   -> {"status": "ok"}            (compose healthcheck + /ready probe)
  POST /convert  -> {"markdown": "...", "title": "..."}   (multipart `file`)

The Node ingestion worker produces the document BYTES (a MinIO-stored upload,
or a URL it fetched itself) and POSTs them here; this service does no network
I/O of its own. Conversion failures return 422 so the caller can fall back to
its legacy pdfjs / html-strip path.
"""

import os
import tempfile

from fastapi import FastAPI, File, HTTPException, UploadFile
from markitdown import MarkItDown

app = FastAPI(title="markitdown-sidecar")

# enable_plugins=False — only the built-in converters, no third-party plugins.
_md = MarkItDown(enable_plugins=False)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    # markitdown picks its converter from the file extension, so preserve the
    # original suffix on the temp file. /tmp is a writable tmpfs in prod.
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        result = _md.convert(tmp_path)
        return {"markdown": result.text_content or "", "title": result.title}
    except HTTPException:
        raise
    except Exception as exc:  # unsupported / corrupt / converter error
        raise HTTPException(status_code=422, detail=f"conversion failed: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
