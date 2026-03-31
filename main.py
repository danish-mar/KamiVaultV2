"""
Gemini Document Gateway — Batch Processing API
Converts PDFs/images → JPEG → Gemini 2.0 Flash → structured JSON
"""

import os
from pathlib import Path
import io
import gc
import re
import json
import time
import logging
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import psutil
from PIL import Image
from pdf2image import convert_from_bytes
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv
from google import genai
from google.genai import types

# ──────────────────────────────────────────────
# Load .env
# ──────────────────────────────────────────────
load_dotenv()

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
MODEL           = "gemini-1.5-flash"
JPEG_QUALITY    = 85
DPI             = 200
MAX_WORKERS     = 5
MEM_WARN_PCT    = 75
MEM_PAUSE_PCT   = 88
MEM_PAUSE_SLEEP = 8

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s │ %(levelname)s │ %(message)s")
log = logging.getLogger("gemini-gateway")

# ──────────────────────────────────────────────
# Gemini client (lazy init)
# ──────────────────────────────────────────────
_client = None


def get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client

# ──────────────────────────────────────────────
# FastAPI app
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Gemini Document Gateway",
    description="Batch document processing via Google Gemini 2.0 Flash",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the test UI."""
    return (BASE_DIR / "static" / "index.html").read_text()


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def memory_guard():
    """Pause execution if system memory usage exceeds threshold."""
    pct = psutil.virtual_memory().percent
    if pct >= MEM_WARN_PCT:
        log.warning("Memory at %.1f%%", pct)
    if pct >= MEM_PAUSE_PCT:
        log.warning("Memory critical (%.1f%%) — pausing %ds and collecting garbage", pct, MEM_PAUSE_SLEEP)
        gc.collect()
        time.sleep(MEM_PAUSE_SLEEP)


def file_to_jpeg_bytes(file_bytes: bytes, filename: str) -> bytes:
    """Convert a PDF (first page) or image file to JPEG bytes."""
    lower = filename.lower()

    if lower.endswith(".pdf"):
        pages = convert_from_bytes(file_bytes, dpi=DPI, first_page=1, last_page=1)
        img = pages[0]
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        img.close()
        return buf.getvalue()
    else:
        # Image file — open, convert to RGB JPEG
        img = Image.open(io.BytesIO(file_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY)
        img.close()
        return buf.getvalue()


def gemini_call(
    img_bytes: bytes,
    instructions: str,
    example_json: Optional[str],
    filename: str,
    retries: int = 3,
) -> dict:
    """Send image + prompt to Gemini and parse the JSON response with retries."""

    # Build prompt
    final_prompt = instructions
    if example_json:
        final_prompt += f"\n\nReturn ONLY valid JSON, no markdown, matching this shape:\n{example_json}"
    else:
        final_prompt += "\n\nReturn ONLY valid JSON. No markdown fences."

    last_raw = ""

    for attempt in range(1, retries + 1):
        try:
            log.info("[%s] Gemini call attempt %d/%d", filename, attempt, retries)

            response = get_client().models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_text(text=final_prompt),
                    types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                ],
            )

            raw = response.text.strip()
            last_raw = raw

            # Strip markdown fences if present
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```\s*$", "", raw)

            parsed = json.loads(raw)
            log.info("[%s] ✓ Parsed successfully", filename)
            return {"filename": filename, "success": True, "data": parsed}

        except json.JSONDecodeError:
            log.warning("[%s] JSON parse failed (attempt %d) — retrying in 2s", filename, attempt)
            time.sleep(2)

        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                log.warning("[%s] Rate limited (attempt %d) — sleeping 30s", filename, attempt)
                time.sleep(30)
            else:
                log.error("[%s] Error (attempt %d): %s — retrying in 3s", filename, attempt, err_str)
                time.sleep(3)

    log.error("[%s] ✗ All %d retries exhausted", filename, retries)
    return {"filename": filename, "success": False, "error": "extraction_failed", "raw": last_raw}


def process_single_file(
    file_bytes: bytes,
    filename: str,
    instructions: str,
    example_json: Optional[str],
) -> dict:
    """Full pipeline for one file: guard → convert → call → cleanup."""
    try:
        memory_guard()
        img_bytes = file_to_jpeg_bytes(file_bytes, filename)
        result = gemini_call(img_bytes, instructions, example_json, filename)
    except Exception as e:
        log.error("[%s] Pipeline error: %s", filename, e)
        result = {"filename": filename, "success": False, "error": str(e), "raw": ""}
    finally:
        gc.collect()
    return result


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────
@app.post("/process/batch")
async def process_batch(
    files: list[UploadFile] = File(...),
    instructions: str = Form(...),
    example_json: Optional[str] = Form(None),
):
    """Process a batch of PDFs/images through Gemini and return structured JSON."""
    if not files:
        return JSONResponse(status_code=400, content={"success": False, "error": "No files provided"})

    log.info("Batch request: %d file(s)", len(files))

    # Read all file bytes upfront (they're in memory via multipart anyway)
    file_data = []
    for f in files:
        raw_bytes = await f.read()
        file_data.append((raw_bytes, f.filename or "unknown"))

    results = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {}
        for raw_bytes, fname in file_data:
            future = pool.submit(process_single_file, raw_bytes, fname, instructions, example_json)
            futures[future] = fname
            time.sleep(0.3)  # stagger submissions

        for future in as_completed(futures):
            results.append(future.result())

    processed = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])

    return {
        "success": True,
        "total": len(results),
        "processed": processed,
        "failed": failed,
        "results": results,
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "model": MODEL}
