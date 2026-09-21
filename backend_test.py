"""
Backend API tests for Push Notification verification (Mello app)
Tests the /register-push endpoint contract and verifies that push being
unconfigured (placeholder key) NEVER breaks core user flows.
"""
import requests
import json

BASE_URL = "https://a262db76-d3a4-4af7-b8eb-159ac940d21b.preview.emergentagent.com/api"

# Test credentials
DEMO_EMAIL = "demo@demo.com"
DEMO_PASSWORD = "Demo1234!"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    print()

def test_push_notifications():
    print("=" * 80)
    print("PUSH NOTIFICATION BACKEND VERIFICATION")
    print("=" * 80)
    print()
    
    # Step 1: Login to get auth token
    print("Step 1: Login to get auth token...")
    login_resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    
    if login_resp.status_code != 200:
        print_test(
            "Login",
            False,
            f"Status: {login_resp.status_code}, Body: {login_resp.text}"
        )
        return
    
    login_data = login_resp.json()
    token = login_data.get("token")
    user_id = login_data.get("user_id")
    
    print_test(
        "Login",
        True,
        f"User ID: {user_id}"
    )
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test 1: POST /register-push WITHOUT Authorization header -> expect 401
    print("Test 1: POST /register-push WITHOUT Authorization header...")
    resp1 = requests.post(
        f"{BASE_URL}/register-push",
        json={
            "platform": "android",
            "device_token": "abcdefghijklmnop1234",
            "user_id": ""
        }
    )
    
    print_test(
        "Test 1: /register-push without auth -> 401",
        resp1.status_code == 401,
        f"Status: {resp1.status_code}, Body: {resp1.text[:200]}"
    )
    
    # Test 2: POST /register-push WITH Bearer token -> expect 503 with message about awaiting native build
    print("Test 2: POST /register-push WITH Bearer token (placeholder key)...")
    resp2 = requests.post(
        f"{BASE_URL}/register-push",
        headers=headers,
        json={
            "platform": "android",
            "device_token": "abcdefghijklmnop1234567890",
            "user_id": ""
        }
    )
    
    is_503 = resp2.status_code == 503
    has_correct_message = False
    if is_503:
        try:
            body = resp2.json()
            detail = body.get("detail", "")
            has_correct_message = "awaiting" in detail.lower() and "native build" in detail.lower()
        except:
            pass
    
    print_test(
        "Test 2: /register-push with auth -> 503 with correct message (EXPECTED behavior)",
        is_503 and has_correct_message,
        f"Status: {resp2.status_code}, Body: {resp2.text[:200]}"
    )
    
    # Test 3a: POST /register-push with device_token too short -> expect 422
    print("Test 3a: POST /register-push with device_token too short...")
    resp3a = requests.post(
        f"{BASE_URL}/register-push",
        headers=headers,
        json={
            "platform": "android",
            "device_token": "x",
            "user_id": ""
        }
    )
    
    print_test(
        "Test 3a: /register-push with device_token too short -> 422",
        resp3a.status_code == 422,
        f"Status: {resp3a.status_code}, Body: {resp3a.text[:200]}"
    )
    
    # Test 3b: POST /register-push with invalid platform -> expect 422
    print("Test 3b: POST /register-push with invalid platform 'windows'...")
    resp3b = requests.post(
        f"{BASE_URL}/register-push",
        headers=headers,
        json={
            "platform": "windows",
            "device_token": "abcdefghijklmnop1234567890",
            "user_id": ""
        }
    )
    
    print_test(
        "Test 3b: /register-push with platform 'windows' -> 422",
        resp3b.status_code == 422,
        f"Status: {resp3b.status_code}, Body: {resp3b.text[:200]}"
    )
    
    # Test 4: CRITICAL - Send message to another user -> MUST return 201, NOT 500
    print("Test 4: CRITICAL - Send message (push unconfigured must NOT break message send)...")
    
    # First, get list of partners to find another user
    print("  Getting partners list...")
    partners_resp = requests.get(
        f"{BASE_URL}/users/partners",
        headers=headers
    )
    
    if partners_resp.status_code != 200:
        print_test(
            "Test 4: Get partners",
            False,
            f"Status: {partners_resp.status_code}, Body: {partners_resp.text[:200]}"
        )
        return
    
    partners = partners_resp.json()
    if not partners or len(partners) == 0:
        print_test(
            "Test 4: Get partners",
            False,
            "No partners found in the system"
        )
        return
    
    # Find a partner (prefer liwei@demo.com if present, else use first partner)
    other_user = None
    for p in partners:
        if p.get("email") == "liwei@demo.com":
            other_user = p
            break
    
    if not other_user:
        other_user = partners[0]
    
    other_id = other_user.get("id")
    other_name = other_user.get("name", "Unknown")
    
    print(f"  Found partner: {other_name} (ID: {other_id})")
    
    # Create or get conversation
    print("  Creating/getting conversation...")
    conv_resp = requests.post(
        f"{BASE_URL}/chats",
        headers=headers,
        json={"partner_id": other_id}
    )
    
    if conv_resp.status_code not in [200, 201]:
        print_test(
            "Test 4: Create conversation",
            False,
            f"Status: {conv_resp.status_code}, Body: {conv_resp.text[:200]}"
        )
        return
    
    conv_data = conv_resp.json()
    conversation_id = conv_data.get("id")
    
    print(f"  Conversation ID: {conversation_id}")
    
    # Send a message - THIS IS THE CRITICAL TEST
    print("  Sending message (this MUST succeed even with push unconfigured)...")
    msg_resp = requests.post(
        f"{BASE_URL}/chats/{conversation_id}/messages",
        headers=headers,
        json={"text": "hello push test"}
    )
    
    is_success = msg_resp.status_code == 201
    is_not_500 = msg_resp.status_code != 500
    
    print_test(
        "Test 4: CRITICAL - Send message with push unconfigured -> 201 (NOT 500)",
        is_success and is_not_500,
        f"Status: {msg_resp.status_code}, Body: {msg_resp.text[:300] if not is_success else 'Message sent successfully'}"
    )
    
    if not is_success:
        print("⚠️  CRITICAL BUG: Message send failed when push is unconfigured!")
        print(f"    This means push failure is NOT properly wrapped in try/except")
        print()
    
    # Test 5: Follow another user -> expect success (200 or 201), NOT 500
    print("Test 5: Follow user (push unconfigured must NOT break follow)...")
    follow_resp = requests.post(
        f"{BASE_URL}/users/{other_id}/follow",
        headers=headers
    )
    
    is_follow_success = follow_resp.status_code in [200, 201]
    is_follow_not_500 = follow_resp.status_code != 500
    
    # Note: If already following, might get 200 with following=false (toggle off)
    # That's still a success - the key is it's NOT a 500
    print_test(
        "Test 5: Follow user with push unconfigured -> 200/201 (NOT 500)",
        is_follow_success and is_follow_not_500,
        f"Status: {follow_resp.status_code}, Body: {follow_resp.text[:200]}"
    )
    
    if not is_follow_success:
        print("⚠️  CRITICAL BUG: Follow action failed when push is unconfigured!")
        print(f"    This means push failure is NOT properly wrapped in try/except")
        print()
    
    # Summary
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print()
    print("Expected behavior with EMERGENT_PUSH_KEY='placeholder':")
    print("  ✓ /register-push returns 503 (correct - awaiting native build credentials)")
    print("  ✓ Core flows (message send, follow) MUST succeed (push wrapped in try/except)")
    print()
    print("Test Results:")
    print(f"  Test 1 (no auth -> 401): {'✅ PASS' if resp1.status_code == 401 else '❌ FAIL'}")
    print(f"  Test 2 (with auth -> 503): {'✅ PASS' if is_503 and has_correct_message else '❌ FAIL'}")
    print(f"  Test 3a (short token -> 422): {'✅ PASS' if resp3a.status_code == 422 else '❌ FAIL'}")
    print(f"  Test 3b (invalid platform -> 422): {'✅ PASS' if resp3b.status_code == 422 else '❌ FAIL'}")
    print(f"  Test 4 (message send -> 201): {'✅ PASS' if is_success and is_not_500 else '❌ FAIL'}")
    print(f"  Test 5 (follow -> 200/201): {'✅ PASS' if is_follow_success and is_follow_not_500 else '❌ FAIL'}")
    print()
    
    all_passed = (
        resp1.status_code == 401 and
        is_503 and has_correct_message and
        resp3a.status_code == 422 and
        resp3b.status_code == 422 and
        is_success and is_not_500 and
        is_follow_success and is_follow_not_500
    )
    
    if all_passed:
        print("🎉 ALL TESTS PASSED - Push notification backend behavior is correct!")
    else:
        print("⚠️  SOME TESTS FAILED - See details above")
    print()

if __name__ == "__main__":
    test_push_notifications()
