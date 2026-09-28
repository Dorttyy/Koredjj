#!/usr/bin/env python3
"""
Backend API Test Suite for Round 28 - HelloTalk-style upgrades
Tests: MOMENTS VOICE CLIPS, AI IMAGE ENDPOINTS, ROOM RENAME
"""

import requests
import sys
import base64
import time
from typing import Optional

# Backend URL from frontend/.env
BASE_URL = "https://apk-build-debug-1.preview.emergentagent.com/api"

# Test credentials
MEI_EMAIL = "mei@demo.com"
MEI_PASSWORD = "Demo1234!"
DIEGO_EMAIL = "diego@demo.com"
DIEGO_PASSWORD = "Demo1234!"

# Global state
mei_token: Optional[str] = None
diego_token: Optional[str] = None
diego_id: Optional[str] = None
mei_id: Optional[str] = None

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    if not passed:
        print(f"\n❌ TEST FAILED: {name}")
        sys.exit(1)

def login(email: str, password: str) -> tuple[str, str]:
    """Login and return (token, user_id)"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    if response.status_code != 200:
        log_test(f"Login {email}", False, f"Status {response.status_code}: {response.text}")
    data = response.json()
    return data["token"], data["user"]["id"]

def generate_small_audio_base64() -> str:
    """Generate a small valid base64 audio string (simulated webm)"""
    # This is a minimal valid base64 string representing audio data
    # In reality, this would be actual audio bytes, but for testing we use a small payload
    audio_bytes = b"RIFF" + b"\x00" * 100  # Minimal RIFF header + some data
    return base64.b64encode(audio_bytes).decode()

def generate_small_png_base64() -> str:
    """Generate a small valid PNG base64 string (100x100 red square with text)"""
    # Minimal PNG: 1x1 red pixel
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    )
    # For a more realistic test, we'll use a slightly larger payload
    # This is a 1x1 red pixel PNG, but we'll repeat it to make it larger
    larger_png = png_bytes * 10  # Make it a bit larger
    return base64.b64encode(larger_png).decode()

# ============================================================================
# 1) MOMENTS VOICE CLIPS TESTS
# ============================================================================

def test_moments_voice_clip_with_text():
    """Test POST /api/moments with text + audio_base64"""
    global mei_token
    
    audio_b64 = generate_small_audio_base64()
    
    response = requests.post(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "text": "clip test",
            "audio_base64": audio_b64,
            "audio_mime": "audio/webm",
            "audio_duration_ms": 2500
        }
    )
    
    if response.status_code != 201:
        log_test("MOMENTS VOICE: Create with text + audio", False, 
                f"Status {response.status_code}: {response.text}")
    
    moment = response.json()
    
    # Verify audio_url starts with /api/audio/
    audio_url = moment.get("audio_url")
    if not audio_url or not audio_url.startswith("/api/audio/"):
        log_test("MOMENTS VOICE: Create with text + audio", False, 
                f"audio_url should start with /api/audio/, got: {audio_url}")
    
    # Verify audio_duration_ms
    if moment.get("audio_duration_ms") != 2500:
        log_test("MOMENTS VOICE: Create with text + audio", False, 
                f"audio_duration_ms should be 2500, got: {moment.get('audio_duration_ms')}")
    
    log_test("MOMENTS VOICE: Create with text + audio", True, 
            f"audio_url={audio_url}, audio_duration_ms=2500")
    
    return moment["id"], audio_url

def test_moments_voice_clip_in_feed(moment_id: str):
    """Test GET /api/moments includes audio_url + audio_duration_ms"""
    global mei_token
    
    response = requests.get(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if response.status_code != 200:
        log_test("MOMENTS VOICE: Verify in feed", False, 
                f"Status {response.status_code}: {response.text}")
    
    moments = response.json()
    target_moment = next((m for m in moments if m["id"] == moment_id), None)
    
    if not target_moment:
        log_test("MOMENTS VOICE: Verify in feed", False, 
                f"Moment {moment_id} not found in feed")
    
    if not target_moment.get("audio_url"):
        log_test("MOMENTS VOICE: Verify in feed", False, 
                "audio_url missing in feed")
    
    if not target_moment.get("audio_duration_ms"):
        log_test("MOMENTS VOICE: Verify in feed", False, 
                "audio_duration_ms missing in feed")
    
    log_test("MOMENTS VOICE: Verify in feed", True, 
            f"audio_url and audio_duration_ms present")

def test_moments_audio_retrieval(audio_url: str):
    """Test GET audio_url returns bytes"""
    global mei_token
    
    # Remove /api prefix if present since BASE_URL already includes /api
    if audio_url.startswith("/api/"):
        audio_path = audio_url[4:]  # Remove /api
    else:
        audio_path = audio_url
    
    response = requests.get(
        f"{BASE_URL}{audio_path}",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if response.status_code != 200:
        log_test("MOMENTS VOICE: Retrieve audio bytes", False, 
                f"Status {response.status_code}: {response.text}")
    
    if len(response.content) == 0:
        log_test("MOMENTS VOICE: Retrieve audio bytes", False, 
                "Audio content is empty")
    
    log_test("MOMENTS VOICE: Retrieve audio bytes", True, 
            f"Retrieved {len(response.content)} bytes")

def test_moments_audio_only():
    """Test POST /api/moments with ONLY audio (no text/photo/poll)"""
    global mei_token
    
    audio_b64 = generate_small_audio_base64()
    
    response = requests.post(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "text": "",  # Empty text
            "audio_base64": audio_b64,
            "audio_mime": "audio/webm",
            "audio_duration_ms": 1500
        }
    )
    
    if response.status_code != 201:
        log_test("MOMENTS VOICE: Audio only (no text)", False, 
                f"Status {response.status_code}: {response.text}")
    
    moment = response.json()
    
    if not moment.get("audio_url"):
        log_test("MOMENTS VOICE: Audio only (no text)", False, 
                "audio_url missing")
    
    log_test("MOMENTS VOICE: Audio only (no text)", True, 
            f"Created moment with only audio")
    
    return moment["id"]

def test_moments_invalid_audio_base64():
    """Test POST /api/moments with invalid audio_base64"""
    global mei_token
    
    response = requests.post(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "text": "test",
            "audio_base64": "!!!notbase64!!!",
            "audio_mime": "audio/webm",
            "audio_duration_ms": 1000
        }
    )
    
    if response.status_code != 400:
        log_test("MOMENTS VOICE: Invalid audio_base64", False, 
                f"Expected 400, got {response.status_code}")
    
    log_test("MOMENTS VOICE: Invalid audio_base64", True, 
            "Correctly returns 400")

def test_moments_no_content():
    """Test POST /api/moments with no content at all"""
    global mei_token
    
    response = requests.post(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "text": ""
        }
    )
    
    if response.status_code != 400:
        log_test("MOMENTS VOICE: No content", False, 
                f"Expected 400, got {response.status_code}")
    
    log_test("MOMENTS VOICE: No content", True, 
            "Correctly returns 400")

# ============================================================================
# 2) AI IMAGE ENDPOINTS TESTS
# ============================================================================

def setup_image_message() -> tuple[str, str]:
    """Setup: Create conversation and upload image message. Returns (conversation_id, image_id)"""
    global mei_token, diego_id
    
    # Create conversation
    response = requests.post(
        f"{BASE_URL}/chats",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"partner_id": diego_id}
    )
    if response.status_code not in [200, 201]:
        log_test("AI IMAGE SETUP: Create conversation", False, 
                f"Status {response.status_code}: {response.text}")
    
    conv = response.json()
    cid = conv["id"]
    
    # Upload image message
    png_b64 = generate_small_png_base64()
    
    response = requests.post(
        f"{BASE_URL}/chats/{cid}/image",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "image_base64": png_b64,
            "mime": "image/png"
        }
    )
    
    if response.status_code != 201:
        log_test("AI IMAGE SETUP: Upload image", False, 
                f"Status {response.status_code}: {response.text}")
    
    msg = response.json()
    image_id = msg.get("image_id")
    
    if not image_id:
        log_test("AI IMAGE SETUP: Upload image", False, 
                "image_id missing in response")
    
    log_test("AI IMAGE SETUP: Upload image", True, 
            f"cid={cid}, image_id={image_id}")
    
    return cid, image_id

def test_ai_image_vocab(image_id: str):
    """Test POST /api/ai/image-vocab with real LLM (allow up to 60s)"""
    global mei_token
    
    print("  ⏳ Calling real LLM gpt-5.2 vision (may take up to 60s)...")
    
    response = requests.post(
        f"{BASE_URL}/ai/image-vocab",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"media_id": image_id},
        timeout=60  # Allow up to 60 seconds
    )
    
    if response.status_code != 200:
        log_test("AI IMAGE: image-vocab", False, 
                f"Status {response.status_code}: {response.text}")
    
    data = response.json()
    
    # Verify response structure
    if "words" not in data:
        log_test("AI IMAGE: image-vocab", False, 
                "Missing 'words' key in response")
    
    if not isinstance(data["words"], list):
        log_test("AI IMAGE: image-vocab", False, 
                f"'words' should be a list, got {type(data['words'])}")
    
    # Check each word has required fields
    for word in data["words"]:
        if not isinstance(word, dict):
            log_test("AI IMAGE: image-vocab", False, 
                    f"Each word should be a dict, got {type(word)}")
        if "word" not in word or "translation" not in word:
            log_test("AI IMAGE: image-vocab", False, 
                    f"Word missing required fields: {word}")
    
    # Accept empty list if LLM returns none, but report content
    word_count = len(data["words"])
    log_test("AI IMAGE: image-vocab", True, 
            f"Returned {word_count} words: {data['words'][:3] if word_count > 0 else 'empty list'}")

def test_ai_image_text(image_id: str):
    """Test POST /api/ai/image-text with target_language"""
    global mei_token
    
    print("  ⏳ Calling real LLM gpt-5.2 vision (may take up to 60s)...")
    
    response = requests.post(
        f"{BASE_URL}/ai/image-text",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "media_id": image_id,
            "target_language": "bn"
        },
        timeout=60  # Allow up to 60 seconds
    )
    
    if response.status_code != 200:
        log_test("AI IMAGE: image-text", False, 
                f"Status {response.status_code}: {response.text}")
    
    data = response.json()
    
    # Verify response structure
    if "text" not in data or "translation" not in data:
        log_test("AI IMAGE: image-text", False, 
                f"Missing required keys. Got: {data.keys()}")
    
    if not isinstance(data["text"], str) or not isinstance(data["translation"], str):
        log_test("AI IMAGE: image-text", False, 
                f"text and translation should be strings")
    
    # May be empty if image has no text
    log_test("AI IMAGE: image-text", True, 
            f"text='{data['text'][:50] if data['text'] else '(empty)'}', translation='{data['translation'][:50] if data['translation'] else '(empty)'}'")

def test_ai_image_vocab_nonexistent():
    """Test POST /api/ai/image-vocab with nonexistent media_id"""
    global mei_token
    
    response = requests.post(
        f"{BASE_URL}/ai/image-vocab",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"media_id": "nonexistent-image-id-999"}
    )
    
    if response.status_code != 404:
        log_test("AI IMAGE: image-vocab nonexistent", False, 
                f"Expected 404, got {response.status_code}")
    
    log_test("AI IMAGE: image-vocab nonexistent", True, 
            "Correctly returns 404")

def test_ai_image_no_token():
    """Test AI endpoints without token"""
    
    response = requests.post(
        f"{BASE_URL}/ai/image-vocab",
        json={"media_id": "test"}
    )
    
    if response.status_code not in [401, 403]:
        log_test("AI IMAGE: No token", False, 
                f"Expected 401/403, got {response.status_code}")
    
    log_test("AI IMAGE: No token", True, 
            f"Correctly returns {response.status_code}")

# ============================================================================
# 3) ROOM RENAME TESTS
# ============================================================================

def test_room_rename_as_host():
    """Test POST /api/rooms/{id}/title as host"""
    global mei_token
    
    # Create room as mei (host)
    response = requests.post(
        f"{BASE_URL}/rooms",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={
            "title": "Rename Test",
            "language": "en"
        }
    )
    
    if response.status_code != 201:
        log_test("ROOM RENAME SETUP: Create room", False, 
                f"Status {response.status_code}: {response.text}")
    
    room = response.json()
    room_id = room["id"]
    
    log_test("ROOM RENAME SETUP: Create room", True, 
            f"room_id={room_id}")
    
    # Rename room as host
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/title",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"title": "Renamed Room"}
    )
    
    if response.status_code != 200:
        log_test("ROOM RENAME: As host", False, 
                f"Status {response.status_code}: {response.text}")
    
    data = response.json()
    
    if not data.get("ok"):
        log_test("ROOM RENAME: As host", False, 
                f"Expected ok=true, got {data}")
    
    if data.get("title") != "Renamed Room":
        log_test("ROOM RENAME: As host", False, 
                f"Expected title='Renamed Room', got {data.get('title')}")
    
    log_test("ROOM RENAME: As host", True, 
            f"ok=true, title='Renamed Room'")
    
    # Verify new title in GET room
    response = requests.get(
        f"{BASE_URL}/rooms/{room_id}",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if response.status_code != 200:
        log_test("ROOM RENAME: Verify new title", False, 
                f"Status {response.status_code}: {response.text}")
    
    room = response.json()
    
    if room.get("title") != "Renamed Room":
        log_test("ROOM RENAME: Verify new title", False, 
                f"Expected title='Renamed Room', got {room.get('title')}")
    
    log_test("ROOM RENAME: Verify new title", True, 
            f"GET /rooms/{room_id} shows new title")
    
    return room_id

def test_room_rename_as_non_host(room_id: str):
    """Test POST /api/rooms/{id}/title as non-host (should fail)"""
    global diego_token
    
    # Diego joins room
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/join",
        headers={"Authorization": f"Bearer {diego_token}"}
    )
    
    if response.status_code != 200:
        log_test("ROOM RENAME SETUP: Diego joins", False, 
                f"Status {response.status_code}: {response.text}")
    
    log_test("ROOM RENAME SETUP: Diego joins", True, 
            "Diego joined room")
    
    # Diego tries to rename (should fail)
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/title",
        headers={"Authorization": f"Bearer {diego_token}"},
        json={"title": "Hacked"}
    )
    
    if response.status_code != 403:
        log_test("ROOM RENAME: As non-host", False, 
                f"Expected 403, got {response.status_code}")
    
    log_test("ROOM RENAME: As non-host", True, 
            "Correctly returns 403")

def test_room_rename_empty_title(room_id: str):
    """Test POST /api/rooms/{id}/title with empty title"""
    global mei_token
    
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/title",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"title": ""}
    )
    
    if response.status_code != 422:
        log_test("ROOM RENAME: Empty title", False, 
                f"Expected 422, got {response.status_code}")
    
    log_test("ROOM RENAME: Empty title", True, 
            "Correctly returns 422")

def test_room_cleanup(room_id: str):
    """Cleanup: End room"""
    global mei_token
    
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/end",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if response.status_code != 200:
        log_test("ROOM CLEANUP: End room", False, 
                f"Status {response.status_code}: {response.text}")
    
    log_test("ROOM CLEANUP: End room", True, 
            f"Room {room_id} ended")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def main():
    global mei_token, diego_token, diego_id, mei_id
    
    print("=" * 80)
    print("ROUND 28 - BACKEND API TEST SUITE")
    print("HelloTalk-style upgrades: Moments Voice Clips, AI Image, Room Rename")
    print("=" * 80)
    print()
    
    # Setup
    print("SETUP: Login users")
    print("-" * 80)
    mei_token, mei_id = login(MEI_EMAIL, MEI_PASSWORD)
    log_test("Login as mei@demo.com", True, f"Token: {mei_token[:20]}...")
    
    diego_token, diego_id = login(DIEGO_EMAIL, DIEGO_PASSWORD)
    log_test("Login as diego@demo.com", True, f"Diego ID: {diego_id}")
    print()
    
    # 1) MOMENTS VOICE CLIPS TESTS
    print("1) MOMENTS VOICE CLIPS TESTS")
    print("-" * 80)
    moment_id, audio_url = test_moments_voice_clip_with_text()
    test_moments_voice_clip_in_feed(moment_id)
    test_moments_audio_retrieval(audio_url)
    audio_only_moment_id = test_moments_audio_only()
    test_moments_invalid_audio_base64()
    test_moments_no_content()
    print(f"  📝 Created moment IDs for cleanup: {moment_id}, {audio_only_moment_id}")
    print()
    
    # 2) AI IMAGE ENDPOINTS TESTS
    print("2) AI IMAGE ENDPOINTS TESTS (using real LLM gpt-5.2 vision)")
    print("-" * 80)
    conversation_id, image_id = setup_image_message()
    test_ai_image_vocab(image_id)
    test_ai_image_text(image_id)
    test_ai_image_vocab_nonexistent()
    test_ai_image_no_token()
    print()
    
    # 3) ROOM RENAME TESTS
    print("3) ROOM RENAME TESTS")
    print("-" * 80)
    room_id = test_room_rename_as_host()
    test_room_rename_as_non_host(room_id)
    test_room_rename_empty_title(room_id)
    test_room_cleanup(room_id)
    print()
    
    print("=" * 80)
    print("✅ ALL TESTS PASSED!")
    print("=" * 80)
    print()
    print("SUMMARY:")
    print(f"  • Moments voice clips: 6/6 tests passed")
    print(f"  • AI image endpoints: 4/4 tests passed")
    print(f"  • Room rename: 4/4 tests passed")
    print(f"  • Total: 14/14 tests passed")
    print()
    print(f"📝 Note: Created moment IDs for reference (no delete endpoint needed):")
    print(f"  - {moment_id}")
    print(f"  - {audio_only_moment_id}")

if __name__ == "__main__":
    main()
