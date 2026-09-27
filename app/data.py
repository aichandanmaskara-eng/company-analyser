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
from datetime import datetime, timedelta, timezone
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
        # Two ways to obtain the session cookie; the second (a normal quote page) often works where the first is refused
        for warm in ("https://fc.yahoo.com", "https://finance.yahoo.com/quote/AAPL/"):
            try:
                s.get(warm, allow_redirects=True)
            except Exception:
                pass  # the cookie is set even when this page itself errors
            try:
                crumb = s.get(f"{Q1}/v1/test/getcrumb").text.strip()
            except Exception:
                crumb = ""
            if crumb and "<" not in crumb and len(crumb) <= 40:
                self._crumb = crumb
                return crumb
        print("⚠️  Yahoo Finance refused the crumb request (common on cloud servers)", flush=True)
        raise DataError("Yahoo Finance did not accept the request. Please try again shortly.")


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
def _statement(symbol: str, stmt: str, freq: str, currencies: set | None = None) -> dict:
    types = ",".join(freq + k for k in KEYS[stmt])
    js = Y.get(f"{Q2}/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}",
               {"symbol": symbol, "type": types, "period1": 493590046, "period2": int(time.time())})
    series = {}
    for res in (js.get("timeseries") or {}).get("result") or []:
        key = ((res.get("meta") or {}).get("type") or [""])[0]
        pts = [p for p in res.get(key) or [] if p and p.get("asOfDate")]
        if pts:
            series[key[len(freq):]] = {p["asOfDate"]: _num(p.get("reportedValue")) for p in pts}
            if currencies is not None:
                currencies.update(p["currencyCode"] for p in pts if p.get("currencyCode"))
    periods = sorted({d for s in series.values() for d in s})
    items = {}
    for k in KEYS[stmt]:  # keep Yahoo's statement order
        if k in series:
            vals = [series[k].get(d) for d in periods]
            if any(v is not None for v in vals):
                items[title(k)] = vals
    return {"periods": periods, "items": items}


VALUATION = {"MarketCap": "marketCap", "EnterpriseValue": "enterpriseValue", "PeRatio": "trailingPE",
             "ForwardPeRatio": "forwardPE", "PbRatio": "priceToBook", "PsRatio": "priceToSales", "PegRatio": "pegRatio",
             "EnterprisesValueEBITDARatio": "enterpriseToEbitda", "EnterprisesValueRevenueRatio": "enterpriseToRevenue"}


def _valuation(symbol: str) -> dict:
    """Latest valuation measures (market cap, P/E, P/B, EV/EBITDA, …) — a service that needs no crumb,
    so it also works from cloud servers where Yahoo refuses the quoteSummary service."""
    now = int(time.time())
    js = Y.get(f"{Q2}/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}",
               {"symbol": symbol, "type": ",".join("trailing" + k for k in VALUATION),
                "period1": now - 400 * 86400, "period2": now})
    out = {}
    for res in (js.get("timeseries") or {}).get("result") or []:
        key = ((res.get("meta") or {}).get("type") or [""])[0]
        pts = [p for p in res.get(key) or [] if p and _num(p.get("reportedValue")) is not None]
        if pts and key.startswith("trailing") and key[8:] in VALUATION:
            out[VALUATION[key[8:]]] = _num(max(pts, key=lambda p: p["asOfDate"])["reportedValue"])
    return out


def _profile(symbol: str) -> dict:
    """Sector / industry from the search service (no crumb needed)."""
    js = Y.get(f"{Q2}/v1/finance/search", {"q": symbol, "quotesCount": 5, "newsCount": 0, "listsCount": 0})
    q = next((x for x in js.get("quotes", []) if (x.get("symbol") or "").upper() == symbol.upper()), {})
    return {k: v for k, v in {"sector": q.get("sectorDisp") or q.get("sector"), "industry": q.get("industryDisp") or q.get("industry"),
                              "longName": q.get("longname"), "exchange": q.get("exchDisp")}.items() if v}


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
    # Valuation measures always come from the crumb-free timeseries service: it works from cloud servers (where
    # quoteSummary is refused) and handles companies that report in another currency correctly — quoteSummary
    # divides a rupee enterprise value by dollar EBITDA for e.g. Infosys (EV/EBITDA 903× instead of 8×).
    try:
        info.update(_valuation(symbol))
    except DataError:
        pass
    if not info.get("sector") or not info.get("industry"):
        try:
            for k, v in _profile(symbol).items():
                if not info.get(k):
                    info[k] = v
        except DataError:
            pass
    if isinstance(info.get("longBusinessSummary"), str):
        info["longBusinessSummary"] = info["longBusinessSummary"][:900]
    return {k: v for k, v in info.items() if v is not None}


def _download(symbol: str) -> dict:
    chart = Y.get(f"{Q2}/v8/finance/chart/{symbol}", {"range": "5y", "interval": "1mo", "events": "div"})
    res = ((chart.get("chart") or {}).get("result") or [None])[0]
    if not res:
        raise DataError(f"“{symbol}” was not found on Yahoo Finance. Check the ticker (NSE: .NS, BSE: .BO).")
    meta = res.get("meta") or {}
    closes = (((res.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    price = [[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), round(c, 2)]
             for t, c in zip(res.get("timestamp") or [], closes) if _num(c) is not None]
    currencies: set = set()
    annual = {s: _statement(symbol, s, "annual", currencies) for s in ("income", "balance", "cashflow")}
    quarterly = {s: _statement(symbol, s, "quarterly", currencies) for s in ("income", "balance", "cashflow")}
    info = _info(symbol, meta)
    if not info.get("financialCurrency") and len(currencies) == 1:  # e.g. Infosys reports in USD, trades in INR
        info["financialCurrency"] = next(iter(currencies))
    if info.get("dividendYield") is None:  # trailing-12-month dividends ÷ current price
        cutoff = time.time() - 365 * 86400
        divs = [_num(d.get("amount")) for d in ((res.get("events") or {}).get("dividends") or {}).values()
                if (d.get("date") or 0) >= cutoff]
        px = _num(info.get("currentPrice"))
        if divs and px:
            info["dividendYield"] = round(sum(v for v in divs if v) / px, 6)
    data = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "source": "Yahoo Finance",
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "info": info,
        "annual": annual,
        "quarterly": quarterly,
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


# ---------------------------------------------------------------- analyst & broker views
EXTRA_TTL = 6 * 3600
_extra_cache: dict[str, tuple[float, dict]] = {}


def _cached(key: str, fn):
    hit = _extra_cache.get(key)
    if hit and time.time() - hit[0] < EXTRA_TTL:
        return hit[1]
    out = fn()
    if out.get("available"):
        _extra_cache[key] = (time.time(), out)
    return out


def _iso(ts) -> str | None:
    try:
        return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return None


def analyst(symbol: str) -> dict:
    """Consensus rating, price targets, rating trend, estimates and firm-level rating changes (Yahoo Finance)."""
    symbol = symbol.strip().upper()
    if not SYMBOL_RE.match(symbol):
        raise DataError("Invalid symbol")

    def build():
        out = {"symbol": symbol, "available": False, "developments": []}
        try:
            js = Y.get(f"{Q2}/v10/finance/quoteSummary/{symbol}",
                       {"modules": "financialData,recommendationTrend,upgradeDowngradeHistory,earningsTrend,price"}, crumb=True)
            res = ((js.get("quoteSummary") or {}).get("result") or [{}])[0] or {}
            fd, pr = res.get("financialData") or {}, res.get("price") or {}
            trend = [{k: int(_num(t.get(k)) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")} | {"period": t.get("period")}
                     for t in (res.get("recommendationTrend") or {}).get("trend") or []]
            changes = [{"date": _iso(h.get("epochGradeDate")), "firm": h.get("firm"), "to": h.get("toGrade"), "from": h.get("fromGrade"),
                        "action": h.get("action"), "target": _num(h.get("currentPriceTarget")), "priorTarget": _num(h.get("priorPriceTarget"))}
                       for h in ((res.get("upgradeDowngradeHistory") or {}).get("history") or [])[:40]]
            est = []
            for t in (res.get("earningsTrend") or {}).get("trend") or []:
                e, rv = t.get("earningsEstimate") or {}, t.get("revenueEstimate") or {}
                if _num(e.get("avg")) is None and _num(rv.get("avg")) is None:
                    continue
                est.append({"period": t.get("period"), "endDate": t.get("endDate"), "epsAvg": _num(e.get("avg")), "epsLow": _num(e.get("low")),
                            "epsHigh": _num(e.get("high")), "epsAnalysts": _num(e.get("numberOfAnalysts")), "epsGrowth": _num(e.get("growth")),
                            "yearAgoEps": _num(e.get("yearAgoEps")), "revAvg": _num(rv.get("avg")), "revAnalysts": _num(rv.get("numberOfAnalysts")),
                            "revGrowth": _num(rv.get("growth"))})
            out.update({
                "available": bool(_num(fd.get("numberOfAnalystOpinions")) or trend or changes or est),
                "currency": pr.get("currency") or fd.get("financialCurrency"),
                "currentPrice": _num(fd.get("currentPrice")) or _num(pr.get("regularMarketPrice")),
                "targetMean": _num(fd.get("targetMeanPrice")), "targetMedian": _num(fd.get("targetMedianPrice")),
                "targetHigh": _num(fd.get("targetHighPrice")), "targetLow": _num(fd.get("targetLowPrice")),
                "analysts": _num(fd.get("numberOfAnalystOpinions")), "recommendationKey": fd.get("recommendationKey"),
                "recommendationMean": _num(fd.get("recommendationMean")), "trend": trend, "changes": changes, "estimates": est})
            if not out["available"]:
                out["reason"] = "No analyst coverage is published for this stock on Yahoo Finance."
        except DataError as exc:
            out["reason"] = f"Analyst consensus is unavailable right now — {exc}"
        try:  # recent significant developments (no crumb needed)
            js = Y.get(f"{Q2}/ws/insights/v2/finance/insights", {"symbol": symbol})
            devs = ((js.get("finance") or {}).get("result") or {}).get("sigDevs") or []
            out["developments"] = [{"date": d.get("date"), "headline": d.get("headline")} for d in devs[:10] if d.get("headline")]
        except DataError:
            pass
        return out

    return _cached("analyst|" + symbol, build)


# ---------------------------------------------------------------- exchange filings (BSE): presentations, transcripts, …
BSE_API = "https://api.bseindia.com/BseIndiaAPI/api"
BSE_HEADERS = {"Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com", "Accept": "application/json, text/plain, */*"}
BSE_ATTACH = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/"  # holds recent and older documents ("AttachLive" drops older ones)
_VAGUE = re.compile(r"please refer|enclosed|attached herewith|^presentation attached", re.I)


def _filing_title(x: dict) -> str:
    head = (x.get("HEADLINE") or "").strip()
    subj = re.sub(r"^Announcement under Regulation 30 \(LODR\)\s*-\s*", "", (x.get("NEWSSUB") or "").strip(), flags=re.I)
    return subj if (not head or len(head) < 30 or _VAGUE.search(head)) and subj else head or subj
_bse_lock = threading.Lock()
_bse_session = None


def _bse_get(path: str, params: dict):
    global _bse_session
    with _bse_lock:
        if _bse_session is None:
            _bse_session = http.Session(impersonate="chrome", timeout=25)
        try:
            r = _bse_session.get(f"{BSE_API}/{path}", params=params, headers=BSE_HEADERS)
        except Exception as exc:
            raise DataError("Could not reach BSE (bseindia.com).") from exc
    if r.status_code >= 400:
        raise DataError(f"BSE returned an error ({r.status_code}).")
    return r


def bse_code(symbol: str, name: str = "") -> str | None:
    base = symbol.split(".")[0].upper()
    if base.isdigit():
        return base
    for text in (base, " ".join(name.split()[:2])):
        if not text.strip():
            continue
        html = _bse_get("PeerSmartSearch/w", {"Type": "SS", "text": text}).text
        for m in re.finditer(r"liclick\('(\d+)','([^']*)'\)", html):
            span = re.search(r"<span>(.*?)</span>", html[m.end():m.end() + 500], re.S)
            tokens = re.sub(r"<[^>]+>|&nbsp;|\\[nrt]", " ", span.group(1)).split() if span else []
            if tokens and tokens[0].upper() == base:
                return m.group(1)
    return None


FILING_KINDS = [  # (kind, test on sub-category, test on headline)
    ("presentation", lambda sc: sc == "investor presentation", lambda h: "presentation" in h),
    ("transcript", lambda sc: sc == "earnings call transcript", lambda h: "transcript" in h),
    ("recording", lambda sc: False, lambda h: ("audio" in h or "video" in h or "webcast" in h) and ("call" in h or "meet" in h or "recording" in h)),
    ("meet", lambda sc: sc == "analyst / investor meet", lambda h: "analyst" in h and ("meet" in h or "call" in h)),
    ("annual", lambda sc: sc == "annual report", lambda h: "annual report" in h),
    ("results", lambda sc: sc == "financial results", lambda h: "financial results" in h),
]


def filings(symbol: str, name: str = "", years: int = 2) -> dict:
    """Investor presentations, earnings-call transcripts, recordings, analyst meets and results filed on BSE."""
    symbol = symbol.strip().upper()
    if not SYMBOL_RE.match(symbol):
        raise DataError("Invalid symbol")
    if not symbol.endswith((".NS", ".BO")):
        return {"symbol": symbol, "available": False,
                "reason": "Exchange filings (presentations, transcripts) are available for companies listed on NSE / BSE."}

    def build():
        code = bse_code(symbol, name)
        if not code:
            return {"symbol": symbol, "available": False, "reason": "Could not find this company's BSE scrip code."}
        today = datetime.now()
        start = today - timedelta(days=365 * years)
        items, seen, rows_all = [], set(), []
        for y in range(years):  # BSE accepts date ranges of at most one year
            to_d, from_d = today - timedelta(days=365 * y), today - timedelta(days=365 * (y + 1) - 1)
            for page in range(1, 9):
                r = _bse_get("AnnSubCategoryGetData/w", {"pageno": page, "strCat": "-1", "strPrevDate": from_d.strftime("%Y%m%d"),
                                                         "strScrip": code, "strSearch": "P", "strToDate": to_d.strftime("%Y%m%d"),
                                                         "strType": "C", "subcategory": "-1"})
                try:
                    rows = r.json().get("Table") or []
                except ValueError as exc:
                    raise DataError("BSE returned an unexpected response.") from exc
                rows_all.extend(rows)
                if len(rows) < 50:
                    break
        for x in rows_all:
            head = _filing_title(x)
            sc, h = (x.get("SUBCATNAME") or "").strip().lower(), (head + " " + (x.get("HEADLINE") or "")).lower()
            kind = next((k for k, by_sc, by_h in FILING_KINDS if by_sc(sc)), None) or \
                next((k for k, by_sc, by_h in FILING_KINDS if by_h(h)), None)
            att = (x.get("ATTACHMENTNAME") or "").strip()
            key = (att or head, (x.get("NEWS_DT") or "")[:10])
            if not kind or key in seen:
                continue
            seen.add(key)
            items.append({"date": (x.get("NEWS_DT") or "")[:10], "kind": kind, "title": head, "category": x.get("SUBCATNAME"),
                          "url": BSE_ATTACH + att if att else None})
        items.sort(key=lambda i: i["date"], reverse=True)
        return {"symbol": symbol, "available": True, "bseCode": code, "items": items, "from": start.strftime("%Y-%m-%d")}

    return _cached("filings|" + symbol, build)
