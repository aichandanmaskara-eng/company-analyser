"""Financial data layer: search, download, normalise and cache Yahoo Finance data.

Talks to Yahoo Finance's JSON services directly (via curl_cffi) — no pandas/yfinance needed,
which keeps the server small, quick to deploy, and unaffected by Windows Smart App Control.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests as http

from .yahoo_keys import KEYS

CACHE_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data_cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
FRESH_HOURS = 12            # results are published quarterly; half a day is plenty fresh
SEARCH_TTL = 24 * 3600
FX_TTL = 3600

Q1, Q2 = "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"
SYMBOL_RE = re.compile(r"^[A-Za-z0-9&^\-]{1,15}(\.[A-Za-z]{1,3})?$")
EXCH_RANK = {"NSI": 0, "NSE": 0, "BSE": 1, "BOM": 1}
INFO_MAP = {  # quoteSummary module -> {our key: Yahoo key}
    "price": {"longName": "longName", "shortName": "shortName", "currency": "currency", "exchange": "exchangeName",
              "regularMarketPrice": "regularMarketPrice", "marketCap": "marketCap"},
    "summaryDetail": {"previousClose": "previousClose", "trailingPE": "trailingPE", "forwardPE": "forwardPE",
                      "dividendYield": "dividendYield", "payoutRatio": "payoutRatio", "beta": "beta",
                      "fiftyTwoWeekHigh": "fiftyTwoWeekHigh", "fiftyTwoWeekLow": "fiftyTwoWeekLow"},
    "defaultKeyStatistics": {"priceToBook": "priceToBook", "enterpriseValue": "enterpriseValue",
                             "enterpriseToEbitda": "enterpriseToEbitda", "enterpriseToRevenue": "enterpriseToRevenue",
                             "bookValue": "bookValue", "trailingEps": "trailingEps", "sharesOutstanding": "sharesOutstanding"},
    "financialData": {"financialCurrency": "financialCurrency", "currentPrice": "currentPrice",
                      "returnOnEquity": "returnOnEquity", "returnOnAssets": "returnOnAssets", "profitMargins": "profitMargins"},
    "assetProfile": {"sector": "sector", "industry": "industry", "website": "website", "longBusinessSummary": "longBusinessSummary",
                     "fullTimeEmployees": "fullTimeEmployees", "country": "country", "city": "city"},
}


class DataError(Exception):
    """A problem worth showing to the user (not found, rate-limited, …)."""


# ---------------------------------------------------------------- Yahoo client
class Yahoo:
    def __init__(self):
        self._lock = threading.RLock()
        self._session = None
        self._crumb = None

    def _s(self):
        if self._session is None:
            self._session = http.Session(impersonate="chrome", timeout=20)
        return self._session

    def get(self, url: str, params: dict | None = None, crumb: bool = False) -> dict:
        with self._lock:
            for attempt in range(2):
                p = dict(params or {})
                if crumb:
                    p["crumb"] = self._get_crumb(refresh=attempt > 0)
                try:
                    r = self._s().get(url, params=p)
                except Exception as exc:
                    raise DataError("Could not reach Yahoo Finance — check the internet connection.") from exc
                if r.status_code == 429:
                    raise DataError("Yahoo Finance is busy (rate-limited). Please wait a minute and try again.")
                if r.status_code in (401, 403) and crumb and attempt == 0:
                    continue  # stale cookie/crumb — renew once
                if r.status_code == 404:
                    return {}
                if r.status_code >= 400:
                    raise DataError(f"Yahoo Finance returned an error ({r.status_code}).")
                return r.json()
        return {}

    def _get_crumb(self, refresh: bool = False) -> str:
        if self._crumb and not refresh:
            return self._crumb
        s = self._s()
        try:
            s.get("https://fc.yahoo.com", allow_redirects=True)
        except Exception:
            pass  # the cookie is set even when this page itself errors
        crumb = s.get(f"{Q1}/v1/test/getcrumb").text.strip()
        if not crumb or "<" in crumb or len(crumb) > 40:
            raise DataError("Yahoo Finance did not accept the request. Please try again shortly.")
        self._crumb = crumb
        return crumb


Y = Yahoo()
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_search_cache: dict[str, tuple[float, list]] = {}
_fx_cache: dict[str, tuple[float, float]] = {}


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _num(v):
    if isinstance(v, dict):
        v = v.get("raw")
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


_TITLE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
title = lambda key: _TITLE.sub(" ", key)   # "NetPPE" -> "Net PPE", "TotalRevenue" -> "Total Revenue"


def _cache_path(symbol: str) -> Path:
    return CACHE_DIR / (re.sub(r"[^A-Za-z0-9._-]", "_", symbol.upper()) + ".json")


# ---------------------------------------------------------------- search
def search(query: str, limit: int = 10) -> list[dict]:
    q = query.strip()[:60]
    if not q:
        return []
    hit = _search_cache.get(q.lower())
    if hit and time.time() - hit[0] < SEARCH_TTL:
        return hit[1]
    js = Y.get(f"{Q2}/v1/finance/search", {"q": q, "quotesCount": limit, "newsCount": 0, "listsCount": 0})
    out = []
    for item in js.get("quotes", []):
        sym = item.get("symbol")
        if not sym or item.get("quoteType") not in ("EQUITY", None):
            continue
        out.append({"symbol": sym, "name": item.get("longname") or item.get("shortname") or sym,
                    "exchange": item.get("exchDisp") or item.get("exchange") or "",
                    "rank": EXCH_RANK.get(item.get("exchange"), 1 if sym.endswith((".NS", ".BO")) else 2)})
    out.sort(key=lambda d: d["rank"])
    _search_cache[q.lower()] = (time.time(), out)
    return out


def resolve(query: str) -> tuple[str, str | None]:
    """Company name or ticker -> (symbol, note). Prefers the NSE/BSE listing."""
    q = query.strip()
    if SYMBOL_RE.match(q) and "." in q:
        return q.upper(), None
    hits = search(q)
    if not hits:
        if SYMBOL_RE.match(q):
            return q.upper(), None
        raise DataError(f"No listed company found for “{query}”. Try the ticker, e.g. INFY.NS")
    exact = [h for h in hits if h["symbol"].split(".")[0].upper() == q.upper()]
    best = exact[0] if exact else hits[0]
    return best["symbol"], f"Matched “{query}” → {best['name']} ({best['symbol']})"


# ---------------------------------------------------------------- download
def _statement(symbol: str, stmt: str, freq: str) -> dict:
    types = ",".join(freq + k for k in KEYS[stmt])
    js = Y.get(f"{Q2}/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}",
               {"symbol": symbol, "type": types, "period1": 493590046, "period2": int(time.time())})
    series = {}
    for res in (js.get("timeseries") or {}).get("result") or []:
        key = ((res.get("meta") or {}).get("type") or [""])[0]
        pts = [p for p in res.get(key) or [] if p and p.get("asOfDate")]
        if pts:
            series[key[len(freq):]] = {p["asOfDate"]: _num(p.get("reportedValue")) for p in pts}
    periods = sorted({d for s in series.values() for d in s})
    items = {}
    for k in KEYS[stmt]:  # keep Yahoo's statement order
        if k in series:
            vals = [series[k].get(d) for d in periods]
            if any(v is not None for v in vals):
                items[title(k)] = vals
    return {"periods": periods, "items": items}


def _info(symbol: str, meta: dict) -> dict:
    info = {}
    try:
        js = Y.get(f"{Q2}/v10/finance/quoteSummary/{symbol}", {"modules": ",".join(INFO_MAP)}, crumb=True)
        res = ((js.get("quoteSummary") or {}).get("result") or [{}])[0] or {}
        for module, fields in INFO_MAP.items():
            block = res.get(module) or {}
            for ours, theirs in fields.items():
                v = block.get(theirs)
                v = v.get("raw") if isinstance(v, dict) else v
                if v not in (None, "", {}):
                    info.setdefault(ours, v)
    except DataError:
        pass  # fall back to the basic details in the price chart
    for ours, theirs in (("currency", "currency"), ("regularMarketPrice", "regularMarketPrice"), ("longName", "longName"),
                         ("shortName", "shortName"), ("fiftyTwoWeekHigh", "fiftyTwoWeekHigh"),
                         ("fiftyTwoWeekLow", "fiftyTwoWeekLow"), ("exchange", "exchangeName")):
        if meta.get(theirs) not in (None, ""):
            info.setdefault(ours, meta[theirs])
    info.setdefault("currentPrice", info.get("regularMarketPrice"))
    if isinstance(info.get("longBusinessSummary"), str):
        info["longBusinessSummary"] = info["longBusinessSummary"][:900]
    return {k: v for k, v in info.items() if v is not None}


def _download(symbol: str) -> dict:
    chart = Y.get(f"{Q2}/v8/finance/chart/{symbol}", {"range": "5y", "interval": "1mo"})
    res = ((chart.get("chart") or {}).get("result") or [None])[0]
    if not res:
        raise DataError(f"“{symbol}” was not found on Yahoo Finance. Check the ticker (NSE: .NS, BSE: .BO).")
    meta = res.get("meta") or {}
    closes = (((res.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    price = [[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), round(c, 2)]
             for t, c in zip(res.get("timestamp") or [], closes) if _num(c) is not None]
    info = _info(symbol, meta)
    data = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "source": "Yahoo Finance",
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "info": info,
        "annual": {s: _statement(symbol, s, "annual") for s in ("income", "balance", "cashflow")},
        "quarterly": {s: _statement(symbol, s, "quarterly") for s in ("income", "balance", "cashflow")},
        "price": price,
    }
    if not data["annual"]["income"]["periods"] and not data["quarterly"]["income"]["periods"]:
        raise DataError(f"No financial statements are published on Yahoo Finance for {symbol}.")
    return data


def get_company(query: str, refresh: bool = False, prefer_cache: bool = False) -> dict:
    q = query.strip()
    if not q or len(q) > 60:
        raise DataError("Please enter a company name or ticker.")
    symbol, note = (q.upper(), None) if _cache_path(q).exists() else resolve(q)
    path = _cache_path(symbol)
    with _lock_for(symbol):  # one download per company at a time, however many users ask
        if path.exists() and not refresh:
            age_h = (time.time() - path.stat().st_mtime) / 3600
            if prefer_cache or age_h < FRESH_HOURS:
                data = json.loads(path.read_text(encoding="utf-8"))
                data["fromCache"] = True
                return data
        try:
            data = _download(symbol)
        except Exception as exc:
            if path.exists():  # serve the last good copy instead of failing
                data = json.loads(path.read_text(encoding="utf-8"))
                data["fromCache"] = True
                data["warning"] = f"Live download failed; showing the copy from {data.get('fetchedAt', '?')[:10]}."
                return data
            if isinstance(exc, DataError):
                raise
            raise DataError(f"Could not download {symbol} ({exc.__class__.__name__}).") from exc
        path.write_text(json.dumps(data), encoding="utf-8")
    if note:
        data["note"] = note
    return data


def recent(limit: int = 20) -> list[dict]:
    out = []
    for p in sorted(CACHE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out.append({"symbol": d["symbol"], "name": d.get("name", d["symbol"]), "fetchedAt": d.get("fetchedAt")})
        except Exception:
            continue
    return out


def fx_rate(frm: str, to: str) -> float:
    frm, to = frm.upper()[:3], to.upper()[:3]
    if not (frm.isalpha() and to.isalpha()):
        raise DataError("Invalid currency code")
    if frm == to:
        return 1.0
    key = frm + to
    hit = _fx_cache.get(key)
    if hit and time.time() - hit[0] < FX_TTL:
        return hit[1]
    js = Y.get(f"{Q2}/v8/finance/chart/{key}=X", {"range": "5d", "interval": "1d"})
    res = ((js.get("chart") or {}).get("result") or [None])[0]
    rate = _num(((res or {}).get("meta") or {}).get("regularMarketPrice"))
    if not rate:
        raise DataError(f"Exchange rate {frm}/{to} unavailable")
    _fx_cache[key] = (time.time(), rate)
    return rate
