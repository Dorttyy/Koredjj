"""One-time public model provisioning; never download weights in an API request.

M2M100 (Meta, MIT), community CT2 int8 conversion; Whisper (OpenAI, MIT),
Systran CT2 conversion. Pin revisions and record SHA256 for every artifact.
No torch, external inference provider or API key required.
"""
import hashlib
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from optional_deps import require_optional

load_dotenv()
BASE = Path(os.getenv("CAPTION_MODEL_ROOT", Path(__file__).parent / "caption_models"))
MODELS = [
    ("translation", "JustFrederik/m2m_100_418m_ct2_int8", "1aeed44db4dd61a486bba44acf54c76507082a2c"),
    ("speech", "Systran/faster-whisper-base", "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"),
]


def provision():
    (huggingface_hub,) = require_optional("huggingface_hub")
    HfApi, snapshot_download = huggingface_hub.HfApi, huggingface_hub.snapshot_download
    manifest = {}
    for name, repo, revision in MODELS:
        sha = revision or HfApi().model_info(repo).sha
        path = Path(snapshot_download(repo, revision=sha, local_dir=BASE / name,
                                     allow_patterns=["*.json", "*.bin", "*.txt", "*.model", "README.md", "LICENSE*"]))
        hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in path.iterdir() if p.is_file()}
        manifest[name] = {"repo": repo, "revision": sha, "license": "MIT (upstream)", "sha256": hashes}
        print(f"Provisioned {name}: {sha}", flush=True)
    (BASE / "manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    provision()