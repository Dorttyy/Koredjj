"""Key-less, no-cost online translation fallback (MyMemory public API).

The app's primary translator is the bundled offline M2M100 model, which is free
and unlimited but needs ~600 MB of weights on disk. A freshly provisioned
container (or a fork of the workspace) starts WITHOUT those weights, which used
to make every translate button fail with a 503. This module is the safety net:
a free, no-API-key HTTP translator that keeps the feature working while the
local model is missing or cannot handle a language pair.

No account, key or payment is involved. Nothing is sent except the text being
translated and the language pair.
"""
import asyncio
import logging
import re

import httpx

ENDPOINT = "https://api.mymemory.translated.net/get"
# MyMemory rejects a single `q` longer than 500 bytes; stay comfortably under.
MAX_CHUNK = 420
TIMEOUT = httpx.Timeout(15.0, connect=8.0)
logger = logging.getLogger(__name__)

# The API answers 200 with the error inside `translatedText`, e.g.
# "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY".
_API_ERROR = re.compile(
    r"MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|PLEASE SELECT TWO DISTINCT"
    r"|NO QUERY SPECIFIED|IS AN INVALID TARGET LANGUAGE",
    re.IGNORECASE,
)

# MyMemory expects RFC-3066-ish codes; only a few of ours need mapping.
_ALIASES = {"zh": "zh-CN", "zh-TW": "zh-TW", "zh-CN": "zh-CN", "pt": "pt-PT", "pt-BR": "pt-BR"}

_identifier = None
_detect_lock = asyncio.Lock()


def _api_code(code: str) -> str:
    return _ALIASES.get(code, code.split("-")[0] if len(code) > 3 else code)


async def detect_language(text: str) -> str:
    """Local, offline language detection (langid) — the fallback API needs an
    explicit source language and we must never guess "en" for everything."""
    global _identifier
    async with _detect_lock:
        if _identifier is None:
            from langid.langid import LanguageIdentifier, model

            _identifier = await asyncio.to_thread(
                LanguageIdentifier.from_modelstring, model, norm_probs=True
            )
    code, _confidence = await asyncio.to_thread(_identifier.classify, text)
    return code


def _chunks(text: str) -> list[str]:
    """Split on paragraph/sentence/word boundaries so nothing is truncated."""
    parts: list[str] = []
    for block in re.split(r"(\n+)", text):
        if not block:
            continue
        if len(block) <= MAX_CHUNK:
            parts.append(block)
            continue
        remaining = block
        while len(remaining) > MAX_CHUNK:
            window = remaining[:MAX_CHUNK]
            cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
            if cut < MAX_CHUNK // 3:
                cut = window.rfind(" ")
            cut = cut + 1 if cut > 0 else MAX_CHUNK
            parts.append(remaining[:cut])
            remaining = remaining[cut:]
        if remaining:
            parts.append(remaining)
    return parts or [text]


async def _translate_chunk(client: httpx.AsyncClient, chunk: str, pair: str) -> str:
    if not any(char.isalpha() for char in chunk):
        return chunk
    response = await client.get(ENDPOINT, params={"q": chunk, "langpair": pair})
    response.raise_for_status()
    payload = response.json()
    value = str((payload.get("responseData") or {}).get("translatedText") or "")
    status = payload.get("responseStatus")
    if not value or _API_ERROR.search(value):
        raise RuntimeError(f"Free translation API refused the request (status {status})")
    if str(status) not in {"200", "0"}:
        raise RuntimeError(f"Free translation API error (status {status})")
    return value


async def translate(text: str, source: str, target: str) -> tuple[str, str]:
    """Return `(translated_text, source_language)`; raises on any failure so the
    caller can fall back further."""
    detected = await detect_language(text) if source == "auto" else source
    source_code, target_code = _api_code(detected), _api_code(target)
    if source_code == target_code:
        return text, detected
    pair = f"{source_code}|{target_code}"
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": "Mello/1.0"}) as client:
        pieces = [await _translate_chunk(client, chunk, pair) for chunk in _chunks(text)]
    value = "".join(pieces).strip()
    if not value:
        raise RuntimeError("Free translation API returned an empty result")
    logger.info("Free API translation served (%s -> %s)", source_code, target_code)
    return value, detected
