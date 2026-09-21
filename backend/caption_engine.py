"""Bounded local inference. PCM and transcripts are never written to storage."""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
ROOT = Path(os.getenv("CAPTION_MODEL_ROOT", Path(__file__).parent / "caption_models"))
SUPPORTED = set("en es fr de it pt zh ja ko ru ar hi bn tr nl pl sv vi th id el".split())
_speech = None
_translator = None
_tokenizer = None
_gate = asyncio.Semaphore(1)


def ready():
    return all((ROOT / file).is_file() for file in (
        "speech/model.bin", "speech/config.json", "translation/model.bin",
        "translation/config.json", "translation/spm.128k.model"))


def process(pcm: bytes, targets: list[str]):
    global _speech, _translator, _tokenizer
    import ctranslate2
    import numpy as np
    import sentencepiece
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None

    if _speech is None:
        _speech = WhisperModel(str(ROOT / "speech"), device="cpu", compute_type="int8", cpu_threads=2)
    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if np.max(np.abs(audio)) < 0.005:
        return None
    segments, info = _speech.transcribe(audio, beam_size=1, vad_filter=True,
                                      condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.7).strip()
    if not text:
        return None
    source = info.language
    if source not in SUPPORTED:
        raise ValueError("This spoken language is not supported by call captions yet.")
    if _translator is None:
        _translator = ctranslate2.Translator(str(ROOT / "translation"), device="cpu",
                                            compute_type="int8", inter_threads=1, intra_threads=2)
        _tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(ROOT / "translation/spm.128k.model"))
    output = {}
    # CT2 config.json already appends the source EOS token.
    tokens = [f"__{source}__"] + _tokenizer.encode(text, out_type=str)
    for target in set(targets):
        if target not in SUPPORTED:
            raise ValueError("Native-language captions are not supported for this profile language.")
        if target == source:
            output[target] = text
            continue
        result = _translator.translate_batch([tokens], target_prefix=[[f"__{target}__"]],
                                              beam_size=2, max_decoding_length=192)[0]
        output[target] = _tokenizer.decode(result.hypotheses[0][1:])
    return {"original": text, "source_language": source, "translations": output}


async def infer(pcm: bytes, targets: list[str]):
    if not ready():
        raise HTTPException(503, "Local caption models are not installed yet. Audio calls still work.")
    try:
        await asyncio.wait_for(_gate.acquire(), timeout=0.2)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Captions are busy. This audio segment was skipped.")
    job = asyncio.create_task(asyncio.to_thread(process, pcm, targets))
    # Hold the permit until the worker really finishes, even if HTTP disconnects.
    job.add_done_callback(lambda _: _gate.release())
    try:
        return await asyncio.shield(job)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, "Caption processing is temporarily unavailable. Audio calls still work.") from exc