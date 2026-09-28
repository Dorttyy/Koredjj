#!/usr/bin/env python3
"""
Backend API Test Suite for LinguaConnect Admin Console (Round 9)
Tests new admin endpoints: rooms management, broadcast, signups
"""

import requests
import sys
import time

# Backend URL from frontend/.env
BASE_URL = "https://apk-build-debug-1.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@lingua.app"
ADMIN_PASSWORD = "Admin1234!"
NON_ADMIN_EMAIL = "mei@demo.com"
NON_ADMIN_PASSWORD = "Demo1234!"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def log_test(test_name, passed, details=""):
    """Log test result with color coding"""
    status = f"{GREEN}✅ PASSED{RESET}" if passed else f"{RED}❌ FAILED{RESET}"
    print(f"\n{status} - {test_name}")
    if details:
        print(f"  {details}")
    return passed

def login(email, password):
    """Login and return token"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    if response.status_code == 200:
        return response.json().get("token")
    return None

# ============================================================================
# TEST 1: GET /api/admin/rooms
# ============================================================================

def test_admin_rooms_as_admin(admin_token):
    """Test 1a: GET /api/admin/rooms as admin returns 200 with array"""
    print(f"\n{YELLOW}=== Test 1a: GET /api/admin/rooms as admin ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/rooms",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/rooms as admin returns 200",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        ), None
    
    data = response.json()
    
    # Verify it's an array
    if not isinstance(data, list):
        return log_test(
            "GET /api/admin/rooms returns array",
            False,
            f"Expected array, got: {type(data)}"
        ), None
    
    # Verify each item has required fields
    if len(data) > 0:
        room = data[0]
        required_fields = ["id", "title", "language", "topic", "is_live", "is_private", 
                          "member_count", "host_name", "host_email", "created_at"]
        missing_fields = [f for f in required_fields if f not in room]
        
        if missing_fields:
            return log_test(
                "GET /api/admin/rooms items have all required fields",
                False,
                f"Missing fields: {missing_fields}"
            ), None
        
        # Check if live rooms are sorted first
        live_rooms = [r for r in data if r.get("is_live")]
        ended_rooms = [r for r in data if not r.get("is_live")]
        
        # If we have both live and ended rooms, verify live ones come first
        if live_rooms and ended_rooms:
            first_live_idx = data.index(live_rooms[0])
            first_ended_idx = data.index(ended_rooms[0])
            sorted_correctly = first_live_idx < first_ended_idx
            
            details = f"Found {len(data)} rooms ({len(live_rooms)} live, {len(ended_rooms)} ended). "
            details += f"Live rooms sorted first: {sorted_correctly}"
        else:
            details = f"Found {len(data)} rooms ({len(live_rooms)} live, {len(ended_rooms)} ended)"
        
        return log_test(
            "GET /api/admin/rooms as admin returns 200 with array of rooms",
            True,
            details
        ), data
    else:
        return log_test(
            "GET /api/admin/rooms as admin returns 200 with array",
            True,
            "Found 0 rooms (empty array)"
        ), data

def test_admin_rooms_as_non_admin(non_admin_token):
    """Test 1b: GET /api/admin/rooms as non-admin returns 403"""
    print(f"\n{YELLOW}=== Test 1b: GET /api/admin/rooms as non-admin ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/rooms",
        headers={"Authorization": f"Bearer {non_admin_token}"}
    )
    
    passed = response.status_code == 403
    return log_test(
        "GET /api/admin/rooms as non-admin returns 403",
        passed,
        f"Status: {response.status_code}"
    )

def test_admin_rooms_without_auth():
    """Test 1c: GET /api/admin/rooms without auth returns 401"""
    print(f"\n{YELLOW}=== Test 1c: GET /api/admin/rooms without auth ==={RESET}")
    
    response = requests.get(f"{BASE_URL}/admin/rooms")
    
    passed = response.status_code == 401
    return log_test(
        "GET /api/admin/rooms without auth returns 401",
        passed,
        f"Status: {response.status_code}"
    )

# ============================================================================
# TEST 2: POST /api/admin/rooms/{room_id}/end
# ============================================================================

def test_admin_force_end_room(admin_token, non_admin_token):
    """Test 2: Create room as mei, force-end as admin, verify is_live=false"""
    print(f"\n{YELLOW}=== Test 2: POST /api/admin/rooms/{{room_id}}/end ==={RESET}")
    
    # Step 1: Create room as mei (non-admin)
    print(f"  {BLUE}Step 1: Creating room as mei...{RESET}")
    create_response = requests.post(
        f"{BASE_URL}/rooms",
        headers={"Authorization": f"Bearer {non_admin_token}"},
        json={
            "title": "Admin End Test",
            "language": "en",
            "topic": "Small Talk",
            "mode": "chat",
            "is_private": False,
            "background": 0
        }
    )
    
    if create_response.status_code != 201:
        return log_test(
            "Create room as mei for force-end test",
            False,
            f"Status: {create_response.status_code}, Response: {create_response.text}"
        ), None
    
    room_id = create_response.json().get("id")
    print(f"  ✓ Created room: {room_id}")
    
    # Step 2: Force-end room as admin
    print(f"  {BLUE}Step 2: Force-ending room as admin...{RESET}")
    end_response = requests.post(
        f"{BASE_URL}/admin/rooms/{room_id}/end",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if end_response.status_code != 200:
        return log_test(
            "POST /api/admin/rooms/{room_id}/end as admin",
            False,
            f"Status: {end_response.status_code}, Response: {end_response.text}"
        ), room_id
    
    end_data = end_response.json()
    
    # Verify response has ok:true and is_live:false
    has_ok = end_data.get("ok") is True
    has_is_live_false = end_data.get("is_live") is False
    
    if not (has_ok and has_is_live_false):
        return log_test(
            "POST /api/admin/rooms/{room_id}/end returns {ok:true, is_live:false}",
            False,
            f"Response: {end_data}"
        ), room_id
    
    print(f"  ✓ Room ended: {end_data}")
    
    # Step 3: Verify GET /api/admin/rooms shows is_live=false
    print(f"  {BLUE}Step 3: Verifying room is_live=false in admin rooms list...{RESET}")
    rooms_response = requests.get(
        f"{BASE_URL}/admin/rooms",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if rooms_response.status_code != 200:
        return log_test(
            "Verify room ended in admin rooms list",
            False,
            f"Could not fetch admin rooms: {rooms_response.status_code}"
        ), room_id
    
    rooms = rooms_response.json()
    ended_room = next((r for r in rooms if r["id"] == room_id), None)
    
    if not ended_room:
        return log_test(
            "Verify room appears in admin rooms list",
            False,
            f"Room {room_id} not found in admin rooms list"
        ), room_id
    
    is_live_false = ended_room.get("is_live") is False
    
    return log_test(
        "POST /api/admin/rooms/{room_id}/end successfully ends room",
        is_live_false,
        f"Room is_live: {ended_room.get('is_live')}"
    ), room_id

def test_admin_end_unknown_room(admin_token):
    """Test 2b: POST /api/admin/rooms/{unknown_id}/end returns 404"""
    print(f"\n{YELLOW}=== Test 2b: Force-end unknown room ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/admin/rooms/unknown-room-id-12345/end",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    passed = response.status_code == 404
    return log_test(
        "POST /api/admin/rooms/{unknown_id}/end returns 404",
        passed,
        f"Status: {response.status_code}"
    )

# ============================================================================
# TEST 3: DELETE /api/admin/rooms/{room_id}
# ============================================================================

def test_admin_delete_room(admin_token, room_id):
    """Test 3: Delete room as admin, verify 200, then 404 on second delete"""
    print(f"\n{YELLOW}=== Test 3: DELETE /api/admin/rooms/{{room_id}} ==={RESET}")
    
    if not room_id:
        return log_test(
            "DELETE room test",
            False,
            "No room_id available from previous test"
        )
    
    # First delete - should succeed
    print(f"  {BLUE}Step 1: Deleting room {room_id}...{RESET}")
    delete_response = requests.delete(
        f"{BASE_URL}/admin/rooms/{room_id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if delete_response.status_code != 200:
        return log_test(
            "DELETE /api/admin/rooms/{room_id} first delete",
            False,
            f"Status: {delete_response.status_code}, Response: {delete_response.text}"
        )
    
    delete_data = delete_response.json()
    has_ok = delete_data.get("ok") is True
    
    if not has_ok:
        return log_test(
            "DELETE /api/admin/rooms/{room_id} returns {ok:true}",
            False,
            f"Response: {delete_data}"
        )
    
    print(f"  ✓ First delete succeeded: {delete_data}")
    
    # Second delete - should return 404
    print(f"  {BLUE}Step 2: Attempting second delete (should fail with 404)...{RESET}")
    second_delete_response = requests.delete(
        f"{BASE_URL}/admin/rooms/{room_id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    passed = second_delete_response.status_code == 404
    
    return log_test(
        "DELETE /api/admin/rooms/{room_id} - first succeeds (200), second fails (404)",
        passed,
        f"First delete: 200, Second delete: {second_delete_response.status_code}"
    )

# ============================================================================
# TEST 4: GET /api/admin/signups?days=7
# ============================================================================

def test_admin_signups(admin_token):
    """Test 4: GET /api/admin/signups?days=7 returns 7 entries, days=50 clamps to 30"""
    print(f"\n{YELLOW}=== Test 4a: GET /api/admin/signups?days=7 ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/signups?days=7",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/signups?days=7",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    # Verify it's an array
    if not isinstance(data, list):
        return log_test(
            "GET /api/admin/signups returns array",
            False,
            f"Expected array, got: {type(data)}"
        )
    
    # Verify exactly 7 entries
    if len(data) != 7:
        return log_test(
            "GET /api/admin/signups?days=7 returns exactly 7 entries",
            False,
            f"Expected 7 entries, got: {len(data)}"
        )
    
    # Verify each entry has {date, count}
    for entry in data:
        if "date" not in entry or "count" not in entry:
            return log_test(
                "Each signup entry has {date, count}",
                False,
                f"Missing fields in entry: {entry}"
            )
    
    # Verify dates are ascending
    dates = [entry["date"] for entry in data]
    dates_sorted = dates == sorted(dates)
    
    if not dates_sorted:
        return log_test(
            "Signup dates are in ascending order",
            False,
            f"Dates not sorted: {dates}"
        )
    
    # Verify last date is today (UTC)
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()
    last_date = dates[-1]
    
    ends_today = last_date == today
    
    details = f"Found {len(data)} entries, dates ascending: {dates_sorted}, ends today ({today}): {ends_today}"
    
    return log_test(
        "GET /api/admin/signups?days=7 returns 7 entries, ascending, ending today",
        True,
        details
    )

def test_admin_signups_clamp(admin_token):
    """Test 4b: GET /api/admin/signups?days=50 clamps to 30 entries"""
    print(f"\n{YELLOW}=== Test 4b: GET /api/admin/signups?days=50 (clamp to 30) ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/signups?days=50",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/signups?days=50",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    # Verify exactly 30 entries (clamped)
    passed = len(data) == 30
    
    return log_test(
        "GET /api/admin/signups?days=50 clamps to 30 entries",
        passed,
        f"Expected 30 entries, got: {len(data)}"
    )

# ============================================================================
# TEST 5: POST /api/admin/broadcast
# ============================================================================

def test_admin_broadcast_as_admin(admin_token):
    """Test 5a: POST /api/admin/broadcast as admin returns 201 with {sent: N}"""
    print(f"\n{YELLOW}=== Test 5a: POST /api/admin/broadcast as admin ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/admin/broadcast",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "title": "Test Broadcast",
            "message": "Hello everyone!"
        }
    )
    
    if response.status_code != 201:
        return log_test(
            "POST /api/admin/broadcast as admin returns 201",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    # Verify response has {sent: N} where N > 0
    has_sent = "sent" in data
    sent_count = data.get("sent", 0)
    sent_positive = sent_count > 0
    
    if not has_sent:
        return log_test(
            "POST /api/admin/broadcast returns {sent: N}",
            False,
            f"Missing 'sent' field in response: {data}"
        )
    
    if not sent_positive:
        return log_test(
            "POST /api/admin/broadcast sent count > 0",
            False,
            f"Expected sent > 0, got: {sent_count}"
        )
    
    return log_test(
        "POST /api/admin/broadcast as admin returns 201 with {sent: N} where N > 0",
        True,
        f"Sent to {sent_count} users"
    )

def test_admin_broadcast_as_non_admin(non_admin_token):
    """Test 5b: POST /api/admin/broadcast as non-admin returns 403"""
    print(f"\n{YELLOW}=== Test 5b: POST /api/admin/broadcast as non-admin ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/admin/broadcast",
        headers={"Authorization": f"Bearer {non_admin_token}"},
        json={
            "title": "Test Broadcast",
            "message": "Hello everyone!"
        }
    )
    
    passed = response.status_code == 403
    return log_test(
        "POST /api/admin/broadcast as non-admin returns 403",
        passed,
        f"Status: {response.status_code}"
    )

def test_admin_broadcast_missing_title(admin_token):
    """Test 5c: POST /api/admin/broadcast with missing title returns 422"""
    print(f"\n{YELLOW}=== Test 5c: POST /api/admin/broadcast missing title ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/admin/broadcast",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "message": "Hello everyone!"
        }
    )
    
    passed = response.status_code == 422
    return log_test(
        "POST /api/admin/broadcast missing title returns 422",
        passed,
        f"Status: {response.status_code}"
    )

def test_admin_broadcast_notification_appears(non_admin_token):
    """Test 5d: Login as mei and verify announcement notification appears"""
    print(f"\n{YELLOW}=== Test 5d: Verify broadcast notification in mei's feed ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/notifications",
        headers={"Authorization": f"Bearer {non_admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/notifications as mei",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    notifications = data.get("notifications", [])
    
    # Find announcement notification with "Test Broadcast" in text
    announcement = None
    for notif in notifications:
        if notif.get("type") == "announcement" and "Test Broadcast" in notif.get("text", ""):
            announcement = notif
            break
    
    if not announcement:
        return log_test(
            "Broadcast notification appears in mei's feed",
            False,
            f"No announcement with 'Test Broadcast' found in {len(notifications)} notifications"
        )
    
    # Verify actor exists and is admin (by name, since email is not exposed in user_card)
    actor = announcement.get("actor")
    actor_name = actor.get("name") if actor else None
    is_admin_actor = actor is not None and actor_name == "Admin"
    
    return log_test(
        "Broadcast notification appears in mei's feed with type='announcement' and actor=admin",
        is_admin_actor,
        f"Found announcement notification, actor name: {actor_name}"
    )

# ============================================================================
# TEST 6: Smoke tests for existing admin endpoints
# ============================================================================

def test_smoke_admin_stats(admin_token):
    """Test 6a: GET /api/admin/stats returns all 10 fields"""
    print(f"\n{YELLOW}=== Test 6a: Smoke - GET /api/admin/stats ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/stats",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/stats",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    required_fields = [
        "total_users", "vip_users", "banned_users", "new_users_today", "online_now",
        "total_moments", "total_messages", "total_conversations", "live_rooms", "coins_in_circulation"
    ]
    
    missing_fields = [f for f in required_fields if f not in data]
    
    if missing_fields:
        return log_test(
            "GET /api/admin/stats returns all 10 fields",
            False,
            f"Missing fields: {missing_fields}"
        )
    
    return log_test(
        "GET /api/admin/stats returns all 10 fields",
        True,
        f"All fields present: {list(data.keys())}"
    )

def test_smoke_admin_users(admin_token):
    """Test 6b: GET /api/admin/users returns list"""
    print(f"\n{YELLOW}=== Test 6b: Smoke - GET /api/admin/users ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/users",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    if not isinstance(data, list):
        return log_test(
            "GET /api/admin/users returns list",
            False,
            f"Expected list, got: {type(data)}"
        )
    
    return log_test(
        "GET /api/admin/users returns list",
        True,
        f"Found {len(data)} users"
    )

def test_smoke_admin_market(admin_token):
    """Test 6c: GET /api/admin/market returns items"""
    print(f"\n{YELLOW}=== Test 6c: Smoke - GET /api/admin/market ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/market",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/market",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    if not isinstance(data, list):
        return log_test(
            "GET /api/admin/market returns list",
            False,
            f"Expected list, got: {type(data)}"
        )
    
    return log_test(
        "GET /api/admin/market returns items",
        True,
        f"Found {len(data)} market items"
    )

def test_smoke_admin_config(admin_token):
    """Test 6d: GET /api/admin/config returns config"""
    print(f"\n{YELLOW}=== Test 6d: Smoke - GET /api/admin/config ==={RESET}")
    
    response = requests.get(
        f"{BASE_URL}/admin/config",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        return log_test(
            "GET /api/admin/config",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    if not isinstance(data, dict):
        return log_test(
            "GET /api/admin/config returns dict",
            False,
            f"Expected dict, got: {type(data)}"
        )
    
    return log_test(
        "GET /api/admin/config returns config",
        True,
        f"Config keys: {list(data.keys())}"
    )

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all admin endpoint tests"""
    print(f"\n{'='*70}")
    print(f"  LinguaConnect Admin Console Backend API Tests (Round 9)")
    print(f"  Backend: {BASE_URL}")
    print(f"{'='*70}")
    
    results = []
    
    # Login as admin
    print(f"\n{BLUE}Logging in as admin ({ADMIN_EMAIL})...{RESET}")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        print(f"\n{RED}FATAL: Could not login as admin. Aborting.{RESET}")
        sys.exit(1)
    print(f"  ✓ Admin logged in")
    
    # Login as non-admin (mei)
    print(f"\n{BLUE}Logging in as non-admin ({NON_ADMIN_EMAIL})...{RESET}")
    non_admin_token = login(NON_ADMIN_EMAIL, NON_ADMIN_PASSWORD)
    if not non_admin_token:
        print(f"\n{RED}FATAL: Could not login as non-admin. Aborting.{RESET}")
        sys.exit(1)
    print(f"  ✓ Non-admin logged in")
    
    # TEST 1: GET /api/admin/rooms
    test1a_result, rooms_data = test_admin_rooms_as_admin(admin_token)
    results.append(test1a_result)
    results.append(test_admin_rooms_as_non_admin(non_admin_token))
    results.append(test_admin_rooms_without_auth())
    
    # TEST 2: POST /api/admin/rooms/{room_id}/end
    test2_result, room_id = test_admin_force_end_room(admin_token, non_admin_token)
    results.append(test2_result)
    results.append(test_admin_end_unknown_room(admin_token))
    
    # TEST 3: DELETE /api/admin/rooms/{room_id}
    results.append(test_admin_delete_room(admin_token, room_id))
    
    # TEST 4: GET /api/admin/signups
    results.append(test_admin_signups(admin_token))
    results.append(test_admin_signups_clamp(admin_token))
    
    # TEST 5: POST /api/admin/broadcast
    results.append(test_admin_broadcast_as_admin(admin_token))
    results.append(test_admin_broadcast_as_non_admin(non_admin_token))
    results.append(test_admin_broadcast_missing_title(admin_token))
    results.append(test_admin_broadcast_notification_appears(non_admin_token))
    
    # TEST 6: Smoke tests
    results.append(test_smoke_admin_stats(admin_token))
    results.append(test_smoke_admin_users(admin_token))
    results.append(test_smoke_admin_market(admin_token))
    results.append(test_smoke_admin_config(admin_token))
    
    # Summary
    print(f"\n{'='*70}")
    print(f"  TEST SUMMARY")
    print(f"{'='*70}")
    
    passed = sum(results)
    total = len(results)
    
    print(f"\n  Total Tests: {total}")
    print(f"  {GREEN}Passed: {passed}{RESET}")
    print(f"  {RED}Failed: {total - passed}{RESET}")
    
    if passed == total:
        print(f"\n  {GREEN}✅ ALL TESTS PASSED{RESET}")
        sys.exit(0)
    else:
        print(f"\n  {RED}❌ SOME TESTS FAILED{RESET}")
        sys.exit(1)

if __name__ == "__main__":
    main()
