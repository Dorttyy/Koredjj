"""Offline M2M100 text inference. No network requests, API keys or paid fallback."""
import asyncio
import os
from pathlib import Path
import re
import regex

from dotenv import load_dotenv
from optional_deps import require_optional

load_dotenv()
ROOT = Path(os.getenv("CAPTION_MODEL_ROOT", Path(__file__).parent / "caption_models")) / "translation"
_model = None
_tokenizer = None
_detector = None
_traditional = None
_simplified = None
_gate = asyncio.Semaphore(1)
# Keep complete emoji/ZWJ/flag/keycap spans verbatim: the neural vocabulary may
# drop these non-linguistic tokens. Preserve their original position/spacing.
_LITERALS = regex.compile(
    r"(\r\n|\r|\n|[0-9#*]\ufe0f?\u20e3|"
    r"(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0f)+)"
)


def supported_languages() -> set[str]:
    vocab = ROOT / "shared_vocabulary.txt"
    if not vocab.is_file():
        return set()
    return {line.strip()[2:-2] for line in vocab.read_text().splitlines()
            if re.fullmatch(r"__[a-z]{2,3}__", line.strip())}


SUPPORTED = supported_languages()


def refresh_supported() -> set[str]:
    """Re-read the vocabulary after the weights are provisioned at runtime, so a
    container that started without the model can use it without a restart."""
    global SUPPORTED
    SUPPORTED = supported_languages()
    return SUPPORTED


def model_code(code: str) -> str:
    return "zh" if code.startswith("zh") else "pt" if code == "pt-BR" else code


def load():
    global _model, _tokenizer, _detector, _traditional, _simplified
    if _model is not None:
        return
    ctranslate2, sentencepiece = require_optional("ctranslate2", "sentencepiece")
    from langid.langid import LanguageIdentifier, model
    from opencc import OpenCC

    translator = ctranslate2.Translator(str(ROOT), device="cpu", compute_type="int8",
                                        inter_threads=1, intra_threads=2)
    _tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(ROOT / "spm.128k.model"))
    _detector = LanguageIdentifier.from_modelstring(model, norm_probs=True)
    _traditional, _simplified = OpenCC("s2t"), OpenCC("t2s")
    _model = translator


def _chunks(tokens: list[str]):
    """Every source token is consumed; never let CT2 silently truncate a message."""
    while tokens:
        cut = min(256, len(tokens))
        if cut < len(tokens):
            boundaries = [i for i in range(cut // 2, cut) if tokens[i].startswith("▁")]
            if boundaries:
                cut = boundaries[-1]
        yield tokens[:cut]
        tokens = tokens[cut:]


def process(text: str, source: str, target: str) -> tuple[str, str]:
    if not any(char.isalpha() for char in text):
        return text, source
    if not SUPPORTED:
        # Missing model assets are an operational failure, not an unknown language.
        raise RuntimeError("Local translation model vocabulary is unavailable")
    target_code = model_code(target)
    if target_code not in SUPPORTED or (source != "auto" and model_code(source) not in SUPPORTED):
        return text, source
    load()
    try:
        source_code = _detector.classify(text)[0] if source == "auto" else model_code(source)
    except (ValueError, IndexError, ZeroDivisionError):
        return text, "auto"
    if source_code not in SUPPORTED:
        return text, source_code
    if source_code == target_code:
        value = text
    else:
        pieces = []
        # Repeated sentence chunks within THIS request need inference only once.
        # This is not a cross-user cache and is discarded after this call.
        chunk_results: dict[tuple[str, ...], str] = {}
        beam = 2 if len(text) > 1200 else 4
        for part in _LITERALS.split(text):
            if not any(char.isalpha() for char in part):
                pieces.append(part)
                continue
            leading, trailing = part[:len(part) - len(part.lstrip())], part[len(part.rstrip()):]
            tokens = _tokenizer.encode(part.strip(), out_type=str)
            translated = []
            for chunk in _chunks(tokens):
                chunk_key = tuple(chunk)
                if chunk_key in chunk_results:
                    translated.append(chunk_results[chunk_key])
                    continue
                result = _model.translate_batch(
                    [[f"__{source_code}__", *chunk]], target_prefix=[[f"__{target_code}__"]],
                    beam_size=beam, max_decoding_length=512, max_input_length=0,
                )[0].hypotheses[0]
                if len(result) >= 512:
                    raise RuntimeError("Translation exceeded its output budget; no partial result returned")
                chunk_results[chunk_key] = _tokenizer.decode(result[1:]).strip()
                translated.append(chunk_results[chunk_key])
            value = " ".join(translated)
            if not value:
                raise RuntimeError("Empty local model translation")
            pieces.append(leading + value + trailing)
        value = "".join(pieces)
    if target_code == "zh":
        value = (_traditional if target == "zh-TW" else _simplified).convert(value)
    return value, source_code


async def translate(text: str, source: str, target: str) -> tuple[str, str]:
    await asyncio.wait_for(_gate.acquire(), timeout=15)
    # A disconnected/timed-out request must NOT release capacity while CPU still runs.
    job = asyncio.create_task(asyncio.to_thread(process, text, source, target))
    def done(task):
        _gate.release()
        if not task.cancelled():
            task.exception()
    job.add_done_callback(done)
    return await asyncio.shield(job)