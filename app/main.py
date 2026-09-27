"""Company Analyser Online — FastAPI server.

Local / Wi-Fi:  python run_local.py
Cloud:          uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import os
import socket
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import data

STATIC = Path(__file__).resolve().parent.parent / "static"
LOCAL_MODE = os.environ.get("CA_LOCAL") == "1"   # set by run_local.py; enables the Wi-Fi address/QR code
PORT = int(os.environ.get("PORT", "8000"))

app = FastAPI(title="Company Analyser Online", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# ---------------------------------------------------------------- light abuse protection for a public server
_hits: dict[str, deque] = defaultdict(deque)
LIMITS = {"/api/company": (30, 600), "/api/search": (120, 600), "/api/fx": (60, 600),
          "/api/analyst": (40, 600), "/api/filings": (30, 600)}  # requests per window (s)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


@app.middleware("http")
async def guard(request: Request, call_next):
    limit = LIMITS.get(request.url.path)
    if limit:
        n, window = limit
        q = _hits[f"{_client_ip(request)}|{request.url.path}"]
        now = time.time()
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= n:
            return JSONResponse({"error": "Too many requests — please wait a few minutes."}, status_code=429)
        q.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def _error(exc: Exception, code: int = 400) -> JSONResponse:
    msg = str(exc) if isinstance(exc, data.DataError) else "Something went wrong. Please try again."
    return JSONResponse({"error": msg}, status_code=code)


def _lan_urls() -> list[str]:
    if not LOCAL_MODE:
        return []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the Wi-Fi interface
        ip = s.getsockname()[0]
        s.close()
        return [f"http://{ip}:{PORT}/"] if not ip.startswith("127.") else []
    except OSError:
        return []


# ---------------------------------------------------------------- API
@app.get("/api/status")
def status():
    return {"app": "Company Analyser Online", "online": True, "cached": data.recent(), "lan": _lan_urls()}


@app.get("/api/search")
async def search(q: str = Query("", max_length=60)):
    try:
        return await run_in_threadpool(data.search, q)
    except Exception as exc:
        return _error(exc)


@app.get("/api/company")
async def company(q: str = Query("", max_length=60), refresh: int = 0, cached: int = 0):
    try:
        return await run_in_threadpool(data.get_company, q, bool(refresh), bool(cached))
    except data.DataError as exc:
        return _error(exc, 404)
    except Exception as exc:
        return _error(exc, 500)


@app.get("/api/fx")
async def fx(frm: str = Query("USD", alias="from", max_length=3), to: str = Query("INR", max_length=3)):
    try:
        return {"rate": await run_in_threadpool(data.fx_rate, frm, to)}
    except Exception as exc:
        return _error(exc)


@app.get("/api/analyst")
async def analyst(symbol: str = Query("", max_length=20)):
    try:
        return await run_in_threadpool(data.analyst, symbol)
    except Exception as exc:
        return _error(exc)


@app.get("/api/filings")
async def filings(symbol: str = Query("", max_length=20), name: str = Query("", max_length=120)):
    try:
        return await run_in_threadpool(data.filings, symbol, name)
    except Exception as exc:
        return _error(exc)


@app.get("/healthz")
def health():
    return {"ok": True}


# ---------------------------------------------------------------- web app
@app.get("/sw.js")
def service_worker():  # must be served from the root so it can control the whole app
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
