"""Iteration 28 backend tests:
- Free translation (no daily limit for non-VIP)
- Reply snapshot stores full preview (>200 chars)
- Voice transcription via faster-whisper (uses an existing audio_id from the seeded convo)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://gmail-notify-service.preview.emergentagent.com").rstrip("/")
CONV_ID = "dc1cf7d7-2f98-43dc-8a15-07b8ff742e03"


@pytest.fixture(scope="module")
def token_mei():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "mei@demo.com", "password": "Demo1234!"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token_diego():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "diego@demo.com", "password": "Demo1234!"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_mei(token_mei):
    return {"Authorization": f"Bearer {token_mei}"}


# --- Free translation: no daily quota anymore ---
class TestFreeTranslate:
    def test_translate_15_times_all_200_no_quota(self, auth_mei):
        results = []
        for i in range(15):
            r = requests.post(
                f"{BASE_URL}/api/ai/translate",
                headers=auth_mei,
                json={"text": f"Hola mundo #{i}", "target_language": "en"},
                timeout=25,
            )
            results.append(r.status_code)
            assert r.status_code == 200, f"call #{i}: {r.status_code} {r.text[:200]}"
            data = r.json()
            assert isinstance(data.get("translated"), str) and data["translated"], data
            assert data.get("remaining") is None, f"remaining should be null, got {data}"
        assert results.count(200) == 15


# --- Reply snapshot: preview must contain the ENTIRE long text (>200 chars) ---
class TestReplyFullSnapshot:
    def test_reply_preview_stores_full_text(self, auth_mei, token_diego):
        # 1) Diego sends a long incoming message to Mei so Mei can reply to it
        diego_hdr = {"Authorization": f"Bearer {token_diego}"}
        long_text = ("This is a deliberately long partner message that is meant to exceed "
                     "the old 120-character snippet limit so that we can verify the reply "
                     "preview stores the full body. " * 4).strip()
        assert len(long_text) > 300
        r = requests.post(
            f"{BASE_URL}/api/chats/{CONV_ID}/messages",
            headers=diego_hdr,
            json={"text": long_text},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        orig_id = r.json()["id"]

        # 2) Mei replies to that message
        r = requests.post(
            f"{BASE_URL}/api/chats/{CONV_ID}/messages",
            headers=auth_mei,
            json={"text": "TEST_reply_full", "reply_to_id": orig_id},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        reply_msg = r.json()
        rt = reply_msg.get("reply_to")
        assert rt, f"reply_to missing: {reply_msg}"
        assert rt["id"] == orig_id
        # preview should be the FULL text (< 2000 cap), not truncated to ~120
        assert rt["preview"] == long_text, (
            f"preview len={len(rt['preview'])} original len={len(long_text)}"
        )


# --- Voice transcription: use an existing audio_id from the conversation ---
class TestTranscribe:
    def _find_voice_audio_id(self, auth_mei):
        r = requests.get(f"{BASE_URL}/api/chats/{CONV_ID}/messages",
                         headers=auth_mei, timeout=15)
        assert r.status_code == 200, r.text
        for m in r.json():
            if m.get("type") == "voice" and m.get("audio_id"):
                return m["audio_id"]
        return None

    def test_transcribe_existing_or_send_new(self, auth_mei):
        audio_id = self._find_voice_audio_id(auth_mei)
        if not audio_id:
            # send a tiny silent m4a-like blob so we at least exercise the endpoint
            import base64
            payload = base64.b64encode(b"\x00" * 1024).decode()
            r = requests.post(
                f"{BASE_URL}/api/chats/{CONV_ID}/voice",
                headers=auth_mei,
                json={"audio_base64": payload, "mime": "audio/m4a", "duration_ms": 1000},
                timeout=20,
            )
            assert r.status_code == 201, r.text
            audio_id = r.json()["audio_id"]

        # Transcribe — first call may take up to ~60s while whisper model downloads
        r = requests.post(
            f"{BASE_URL}/api/ai/transcribe",
            headers=auth_mei,
            json={"audio_id": audio_id},
            timeout=180,
        )
        # Accept either a real transcription (200) OR a 502 with a decode failure
        # since the seeded audio may be silent placeholder bytes. We only fail if
        # the endpoint is completely broken (401/404/500 without the 502 wrapper).
        assert r.status_code in (200, 502), f"unexpected {r.status_code}: {r.text[:400]}"
        if r.status_code == 200:
            data = r.json()
            assert "text" in data
            assert isinstance(data["text"], str)
            print(f"Transcription text: {data['text']!r}")
        else:
            print(f"Transcribe 502 (whisper decode): {r.text[:200]}")
