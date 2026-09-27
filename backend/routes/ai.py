import json
import logging
import os
import uuid
import base64 as b64mod
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from auth_utils import CurrentUser
import caption_engine
from config_utils import get_app_config
from db import audio_col, media_col, users_col
from models import CorrectRequest, TranscribeRequest, TranslateRequest, _vip_active
import translation_service
from translation_languages import LANGUAGES, RTL_CODES, normalize_language

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)

def require_llm_key() -> str:
    """Optional AI setup must never prevent account services from starting."""
    key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Optional AI features are not configured for this preview.",
        )
    return key

# Safety net when a language *name* is sent instead of an ISO code.
NAME_TO_CODE = {
    "english": "en", "spanish": "es", "french": "fr", "german": "de",
    "italian": "it", "portuguese": "pt", "russian": "ru", "japanese": "ja",
    "korean": "ko", "chinese": "zh", "arabic": "ar", "hindi": "hi",
    "bengali": "bn", "turkish": "tr", "vietnamese": "vi", "thai": "th",
    "indonesian": "id", "dutch": "nl", "polish": "pl", "urdu": "ur",
}


async def _google_translate(text: str, target: str) -> str:
    """Legacy name retained for callers; all inference is now local/offline."""
    try:
        target = normalize_language(target)
    except ValueError:
        return text
    value, _ = await translation_service.provider_translate(text, "auto", target)
    return value


async def run_llm(system_message: str, text: str) -> str:
    api_key = require_llm_key()
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

    chat = LlmChat(
        api_key=api_key,
        session_id=f"lingua-{uuid.uuid4()}",
        system_message=system_message,
    ).with_model("openai", "gpt-5.2")
    parts: list[str] = []
    async for event in chat.stream_message(UserMessage(text=text)):
        if isinstance(event, TextDelta):
            parts.append(event.content)
        elif isinstance(event, StreamDone):
            break
    return "".join(parts).strip()


def parse_json_response(raw: str) -> dict | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        return json.loads(cleaned.strip())
    except (json.JSONDecodeError, IndexError):
        return None


async def run_llm_image(system_message: str, text: str, image_base64: str) -> str:
    """LLM call that also attaches an image (vision) — used by AI Vocab and
    Extract-text-&-translate on photo messages."""
    api_key = require_llm_key()
    from emergentintegrations.llm.chat import (
        ImageContent,
        LlmChat,
        StreamDone,
        TextDelta,
        UserMessage,
    )

    chat = LlmChat(
        api_key=api_key,
        session_id=f"lingua-img-{uuid.uuid4()}",
        system_message=system_message,
    ).with_model("openai", "gpt-5.2")
    msg = UserMessage(
        text=text, file_contents=[ImageContent(image_base64=image_base64)]
    )
    parts: list[str] = []
    async for event in chat.stream_message(msg):
        if isinstance(event, TextDelta):
            parts.append(event.content)
        elif isinstance(event, StreamDone):
            break
    return "".join(parts).strip()


class ImageAiRequest(BaseModel):
    media_id: str
    target_language: str | None = None
    # AI-lens language overrides (VIP feature in the UI)
    learning_language: str | None = None
    native_language: str | None = None


def _user_langs(current_user: dict) -> tuple[str, str]:
    """(learning, native) language codes with sensible fallbacks."""
    learning = (
        (current_user.get("learning_languages") or [None])[0]
        or current_user.get("learning_language")
        or "en"
    )
    native = current_user.get("native_language") or "en"
    return learning, native


async def _load_image_b64(media_id: str) -> str:
    media = await media_col.find_one({"_id": media_id})
    if not media:
        raise HTTPException(status_code=404, detail="Image not found")
    return b64mod.b64encode(media["data"]).decode()


@router.post("/image-lens")
async def image_lens(body: ImageAiRequest, current_user: CurrentUser):
    """AI Lens: identify THE main object in a photo as a flashcard —
    native word + learning word + pronunciation + meanings + example."""
    # Free users get 3 lens scans per day; VIP is unlimited.
    # A missing optional integration must not consume a user's scan quota.
    require_llm_key()
    if not _vip_active(current_user):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        usage = current_user.get("lens_usage") or {}
        count = usage.get("count", 0) if usage.get("date") == today else 0
        if count >= 3:
            raise HTTPException(
                status_code=403,
                detail="Free users get 3 AI Vocab scans per day — upgrade to VIP for unlimited scans.",
            )
        await users_col.update_one(
            {"_id": current_user["_id"]},
            {"$set": {"lens_usage": {"date": today, "count": count + 1}}},
        )
    img = await _load_image_b64(body.media_id)
    learning, native = _user_langs(current_user)
    if body.learning_language:
        learning = body.learning_language
    if body.native_language:
        native = body.native_language
    system = (
        "You are an AI camera lens inside a language-learning app. "
        "Identify the single most prominent object/concept in the photo."
    )
    prompt = (
        f"Identify the MAIN object in this image. Reply with STRICT JSON only:\n"
        '{"native_word": "<object name in language ' + native + '>", '
        '"learning_word": "<object name in language ' + learning + '>", '
        '"pron": "<IPA or romanized pronunciation of native_word>", '
        '"pos": "<part-of-speech + 1-3 meanings in ' + learning + ", e.g. 'n. penguin; n. path'>\", "
        '"example_native": "<one short example sentence using the word, in ' + native + '>", '
        '"example_learning": "<the same sentence in ' + learning + '>"}'
    )
    try:
        raw = await run_llm_image(system, prompt, img)
    except Exception:
        logger.exception("image-lens LLM failure")
        raise HTTPException(status_code=502, detail="AI is unavailable right now")
    data = parse_json_response(raw)
    if not data or not data.get("native_word"):
        raise HTTPException(status_code=502, detail="AI returned an unexpected answer")
    return {
        "native_word": str(data.get("native_word", "")).strip(),
        "learning_word": str(data.get("learning_word", "")).strip(),
        "pron": str(data.get("pron", "")).strip(),
        "pos": str(data.get("pos", "")).strip(),
        "example_native": str(data.get("example_native", "")).strip(),
        "example_learning": str(data.get("example_learning", "")).strip(),
        "native_language": native,
        "learning_language": learning,
    }


@router.post("/image-vocab")
async def image_vocab(body: ImageAiRequest, current_user: CurrentUser):
    """AI Vocab: identify useful vocabulary for objects/actions in a photo."""
    require_llm_key()
    img = await _load_image_b64(body.media_id)
    learning, native = _user_langs(current_user)
    system = (
        "You are a vocabulary coach inside a language-exchange app. "
        "Given a photo, pick the most useful words a learner should know."
    )
    prompt = (
        f"Look at this image. List 5-8 practical vocabulary words (things, actions or "
        f"descriptions visible in the image) in the language with ISO code '{learning}'. "
        f"For each add a translation into the language with ISO code '{native}'. "
        'Reply with STRICT JSON only: {"words": [{"word": "...", "translation": "..."}]}'
    )
    try:
        raw = await run_llm_image(system, prompt, img)
    except Exception:
        logger.exception("image-vocab LLM failure")
        raise HTTPException(status_code=502, detail="AI is unavailable right now")
    data = parse_json_response(raw)
    if not data or not isinstance(data.get("words"), list):
        raise HTTPException(status_code=502, detail="AI returned an unexpected answer")
    words = [
        {
            "word": str(w.get("word", "")).strip(),
            "translation": str(w.get("translation", "")).strip(),
        }
        for w in data["words"]
        if isinstance(w, dict) and w.get("word")
    ][:8]
    return {"words": words}


@router.post("/image-text")
async def image_text(body: ImageAiRequest, current_user: CurrentUser):
    """Extract text & translate: OCR any text in the photo and translate it."""
    require_llm_key()
    img = await _load_image_b64(body.media_id)
    _, native = _user_langs(current_user)
    try:
        target = normalize_language(body.target_language or native or "en")
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    system = "You are an OCR + translation engine inside a language-exchange app."
    prompt = (
        "Extract ALL readable text from this image exactly as written. Then translate "
        f"it into the language with ISO code '{target}'. If the image contains no text, "
        'return an empty string for both fields. Reply with STRICT JSON only: '
        '{"text": "...", "translation": "..."}'
    )
    try:
        raw = await run_llm_image(system, prompt, img)
    except Exception:
        logger.exception("image-text LLM failure")
        raise HTTPException(status_code=502, detail="AI is unavailable right now")
    data = parse_json_response(raw)
    if data is None:
        raise HTTPException(status_code=502, detail="AI returned an unexpected answer")
    return {
        "text": str(data.get("text", "")).strip(),
        "translation": str(data.get("translation", "")).strip(),
    }


@router.get("/translation-languages")
async def translation_languages():
    return [{"code": code, "name": name, "rtl": code in RTL_CODES} for code, name in LANGUAGES.items()]


@router.post("/translate", response_model=translation_service.TranslationResult)
async def translate(body: TranslateRequest, current_user: CurrentUser):
    target_value = body.target_language or current_user.get("native_language")
    if not target_value:
        return translation_service.original_result(body.text)
    try:
        target = normalize_language(target_value)
        source = normalize_language(body.source_language or "auto", allow_auto=True)
    except ValueError:
        return translation_service.original_result(body.text, target_value, body.source_language or "auto")
    try:
        return await translation_service.translate(current_user["_id"], body.text, source, target)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except translation_service.TranslationFailure as error:
        headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
        raise HTTPException(503, "Translation is temporarily unavailable. Please try again.", headers=headers) from None


@router.post("/correct")
async def correct(body: CorrectRequest, current_user: CurrentUser):
    require_llm_key()
    lang_hint = f" The text is written in {body.language}." if body.language else ""
    system = (
        "You are a friendly language tutor in a language exchange app. "
        f"Correct grammar, spelling and word-choice mistakes in the user's text.{lang_hint} "
        'Respond with ONLY valid JSON: {"corrected": "<corrected text in the same language>", '
        '"explanation": "<one or two short sentences in English explaining the main fixes, '
        "or 'Looks perfect!' if there is nothing to fix>\"}"
    )
    try:
        raw = await run_llm(system, body.text)
    except Exception as e:
        logger.exception("Correction failed")
        raise HTTPException(status_code=502, detail=f"Correction failed: {e}")
    parsed = parse_json_response(raw)
    if parsed and "corrected" in parsed:
        return {"corrected": parsed["corrected"], "explanation": parsed.get("explanation", "")}
    return {"corrected": raw, "explanation": ""}


# --- Free on-device speech-to-text (faster-whisper, no API key) ---
_whisper_model = None


def _get_whisper():
    """Lazily load a free CPU Whisper model (int8), cached across requests.

    Prefers the locally provisioned `caption_models/speech` weights (already on
    disk for call captions, no download); otherwise falls back to the small
    public `tiny` model, which faster-whisper fetches once and caches. Both
    routes are free and need no API key.
    """
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel

            local_dir = caption_engine.ROOT / "speech"
            source = str(local_dir) if (local_dir / "model.bin").is_file() else "tiny"
            _whisper_model = WhisperModel(source, device="cpu", compute_type="int8")
            logger.info("Loaded free speech-to-text model from %s", source)
        except Exception as e:
            logger.warning("Whisper model unavailable: %s", e)
            return None
    return _whisper_model


@router.post("/transcribe")
async def transcribe(body: TranscribeRequest, current_user: CurrentUser):
    """Transcribe a stored voice message to text using a local Whisper model."""
    import asyncio
    import os
    import tempfile

    doc = await audio_col.find_one({"_id": body.audio_id})
    if not doc or not doc.get("data"):
        raise HTTPException(status_code=404, detail="Voice message not found.")
    mime = doc.get("mime", "audio/m4a")
    suffix = ".webm" if "webm" in mime else (".mp3" if "mp3" in mime or "mpeg" in mime else ".m4a")
    data = doc["data"]
    # motor stores bytes as-is; ensure raw bytes
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)

    def _run() -> str:
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(data)
                tmp_path = f.name
            model = _get_whisper()
            if not model:
                raise HTTPException(status_code=503, detail="Audio transcription model is unavailable in this environment.")
            lang = body.language if (body.language and len(body.language) == 2) else None
            segments, _info = model.transcribe(tmp_path, beam_size=1, language=lang)
            return " ".join(seg.text.strip() for seg in segments).strip()
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    try:
        text = await asyncio.to_thread(_run)
    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    return {"text": text}
