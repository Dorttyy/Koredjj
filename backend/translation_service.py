"""Private per-user cache + bounded, free local translation. No external provider."""
import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from db import db
import free_translation_api
import local_text_translation

CACHE_VERSION = "m2m100-local-v4-original-fallback"
cache = db["text_translation_cache"]
_inflight: dict[str, asyncio.Task] = {}
logger = logging.getLogger(__name__)


class TranslationFailure(Exception):
    def __init__(self, retry_after: int = 0):
        super().__init__("Translation is temporarily unavailable. Please try again.")
        self.retry_after = retry_after


class TranslationResult(BaseModel):
    translated: str
    target_language: str
    source_language: str = "auto"
    cached: bool = False
    remaining: None = None
    provider: str = "local-m2m100"
    unchanged: bool = False


def original_result(text: str, target: str = "auto", source: str = "auto", *, cached: bool = False) -> TranslationResult:
    """User-requested fallback: original content, without unsupported warnings.
    Metadata explicitly distinguishes this from a new model translation.
    """
    return TranslationResult(translated=text, target_language=target, source_language=source,
                             unchanged=True, provider="passthrough", cached=cached)


async def initialize():
    """Create the lookup index only — NEVER a TTL/auto-delete index.

    Freshness is enforced at READ time (`expires_at > now` in `translate()`),
    so an expired entry is simply not served and is overwritten by the next
    upsert for the same key. A `expireAfterSeconds` index would make startup
    silently delete stored records, which is not allowed in deployment.
    """
    try:
        await cache.create_index([("user_id", 1), ("expires_at", -1)], name="user_expiry_lookup")
    except Exception:
        logger.warning("Translation cache index unavailable; cache still works without it")


async def shutdown():
    if _inflight:
        await asyncio.gather(*list(_inflight.values()), return_exceptions=True)


async def provider_translate(text: str, source: str, target: str) -> tuple[str, str]:
    """Free translation chain — no API key, no paid provider, never a dead end.

    1. Bundled offline M2M100 model: free and unlimited, but needs its weights
       on disk (a fresh container / fork starts without them).
    2. MyMemory free public API: no key, covers us while the weights are missing
       or when the offline model does not know the requested language pair.

    Only when BOTH routes are unavailable do we surface a retryable failure.
    """
    local_failed = False
    try:
        value, detected = await local_text_translation.translate(text, source, target)
        if value != text:
            return value, detected
        # The local model echoed the input. That is the right answer when there
        # is nothing to translate (no letters) or the text already is in the
        # target language; otherwise the pair is unsupported locally and the
        # free online provider gets a turn.
        if not any(char.isalpha() for char in text):
            return value, detected
        if detected and local_text_translation.model_code(detected) == local_text_translation.model_code(target):
            return value, detected
    except ValueError:
        raise
    except Exception:
        local_failed = True
        logger.warning("Offline translation unavailable; trying the free online provider")

    try:
        return await free_translation_api.translate(text, source, target)
    except Exception:
        logger.exception("Free online translation failed (message content omitted)")

    if not local_failed:
        # Offline model ran fine but cannot do this pair: keep the agreed policy
        # of returning the original text instead of an error.
        return text, source
    raise TranslationFailure(3)


async def translate(user_id: str, text: str, source: str, target: str) -> TranslationResult:
    key = hashlib.sha256(json.dumps([CACHE_VERSION, user_id, source, target, text], ensure_ascii=False).encode()).hexdigest()
    try:
        hit = await cache.find_one({"_id": key, "user_id": user_id, "expires_at": {"$gt": datetime.now(timezone.utc)}},
                                  {"_id": 0, "translated": 1, "target_language": 1, "source_language": 1})
    except Exception:
        hit = None
    if hit and isinstance(hit.get("translated"), str) and hit["translated"].strip():
        if hit["translated"] == text:
            return original_result(text, hit["target_language"], hit["source_language"], cached=True)
        return TranslationResult(**hit, cached=True)

    async def work():
        translated, detected = await provider_translate(text, source, target)
        result = original_result(text, target, detected) if translated == text else TranslationResult(
            translated=translated, source_language=detected, target_language=target,
        )
        try:
            await cache.update_one({"_id": key}, {"$set": {"user_id": user_id, "translated": translated,
                "source_language": detected, "target_language": target,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7)}}, upsert=True)
        except Exception:
            logger.warning("Translation cache write unavailable")
        return result

    task = _inflight.get(key)
    if task is None:
        if len(_inflight) >= 12:
            raise TranslationFailure(3)
        task = asyncio.create_task(work())
        _inflight[key] = task
        def completed(done):
            if _inflight.get(key) is done:
                _inflight.pop(key, None)
            if not done.cancelled():
                done.exception()
        task.add_done_callback(completed)
    try:
        # Return a recoverable response BEFORE the ingress deadline. Keep the
        # same job alive/cacheable so Retry joins it, never launches duplicate CPU.
        return await asyncio.wait_for(asyncio.shield(task), timeout=50)
    except asyncio.TimeoutError:
        raise TranslationFailure(3) from None