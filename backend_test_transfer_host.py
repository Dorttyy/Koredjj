#!/usr/bin/env python3
"""
Backend API Test Suite for LinguaConnect Room Transfer Host Feature
Tests POST /api/rooms/{room_id}/transfer-host endpoint and related regression scenarios
"""

import requests
import sys
import time

# Backend URL from frontend/.env
BASE_URL = "https://apk-build-debug-1.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
MEI_EMAIL = "mei@demo.com"
MEI_PASSWORD = "Demo1234!"
DIEGO_EMAIL = "diego@demo.com"
DIEGO_PASSWORD = "Demo1234!"

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

def login_user(email, password):
    """Login and return token and user_id"""
    print(f"\n{BLUE}→ Logging in as {email}...{RESET}")
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    if response.status_code == 200:
        data = response.json()
        token = data.get("token")
        
        # Get user_id from /auth/me endpoint
        me_response = requests.get(
            f"{BASE_URL}/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        user_id = None
        if me_response.status_code == 200:
            user_id = me_response.json().get("id")
        
        print(f"  ✓ Logged in: {email} (ID: {user_id})")
        return token, user_id
    else:
        print(f"  ✗ Login failed: {response.status_code} - {response.text}")
        return None, None

def create_room(token, title, share_to_moments=False):
    """Create a room and return room_id"""
    print(f"\n{BLUE}→ Creating room '{title}'...{RESET}")
    response = requests.post(
        f"{BASE_URL}/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": title,
            "language": "en",
            "topic": "Small Talk",
            "mode": "chat",
            "is_private": False,
            "background": 0,
            "share_to_moments": share_to_moments
        }
    )
    if response.status_code == 201:
        data = response.json()
        room_id = data.get("id")
        print(f"  ✓ Room created: {room_id}")
        return room_id
    else:
        print(f"  ✗ Room creation failed: {response.status_code} - {response.text}")
        return None

def join_room(token, room_id):
    """Join a room"""
    print(f"\n{BLUE}→ Joining room {room_id}...{RESET}")
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/join",
        headers={"Authorization": f"Bearer {token}"}
    )
    if response.status_code == 200:
        print(f"  ✓ Joined room")
        return True
    else:
        print(f"  ✗ Join failed: {response.status_code} - {response.text}")
        return False

def get_room(token, room_id):
    """Get room details"""
    response = requests.get(
        f"{BASE_URL}/rooms/{room_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    if response.status_code == 200:
        return response.json()
    return None

def test_scenario_1_2(mei_token, diego_token):
    """Test Scenario 1-2: Mei creates room, Diego joins"""
    print(f"\n{YELLOW}=== Scenario 1-2: Room Creation and Join ==={RESET}")
    
    room_id = create_room(mei_token, "Transfer Host Test Room")
    if not room_id:
        return log_test("Scenario 1-2: Room creation", False, "Failed to create room"), None
    
    join_success = join_room(diego_token, room_id)
    if not join_success:
        return log_test("Scenario 1-2: Diego joins room", False, "Failed to join room"), room_id
    
    return log_test("Scenario 1-2: Room creation and join", True, f"Room ID: {room_id}"), room_id

def test_scenario_3(diego_token, diego_id, room_id):
    """Test Scenario 3: Non-host tries to transfer host -> EXPECT 403"""
    print(f"\n{YELLOW}=== Scenario 3: Non-host Transfer Attempt ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/transfer-host",
        headers={"Authorization": f"Bearer {diego_token}"},
        json={"user_id": diego_id}
    )
    
    passed = response.status_code == 403
    detail = ""
    if response.status_code == 403:
        try:
            detail = response.json().get("detail", "")
            passed = passed and "Only the host can transfer the room" in detail
        except:
            pass
    
    return log_test(
        "Scenario 3: Non-host gets 403 when trying to transfer host",
        passed,
        f"Status: {response.status_code}, Detail: {detail}"
    )

def test_scenario_4(mei_token, room_id):
    """Test Scenario 4: Host transfers to non-existent user -> EXPECT 404"""
    print(f"\n{YELLOW}=== Scenario 4: Transfer to Non-existent User ==={RESET}")
    
    fake_user_id = "non-existent-user-id-12345"
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/transfer-host",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"user_id": fake_user_id}
    )
    
    passed = response.status_code == 404
    detail = ""
    if response.status_code == 404:
        try:
            detail = response.json().get("detail", "")
            passed = passed and "Member not in room" in detail
        except:
            pass
    
    return log_test(
        "Scenario 4: Transfer to non-existent user returns 404",
        passed,
        f"Status: {response.status_code}, Detail: {detail}"
    )

def test_scenario_5(mei_token, mei_id, room_id):
    """Test Scenario 5: Host transfers to self -> EXPECT 400"""
    print(f"\n{YELLOW}=== Scenario 5: Transfer to Self ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/transfer-host",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"user_id": mei_id}
    )
    
    passed = response.status_code == 400
    detail = ""
    if response.status_code == 400:
        try:
            detail = response.json().get("detail", "")
            passed = passed and "You are already the host" in detail
        except:
            pass
    
    return log_test(
        "Scenario 5: Transfer to self returns 400",
        passed,
        f"Status: {response.status_code}, Detail: {detail}"
    )

def test_scenario_6(mei_token, diego_token, mei_id, diego_id, room_id):
    """Test Scenario 6: Successful transfer from Mei to Diego -> EXPECT 200"""
    print(f"\n{YELLOW}=== Scenario 6: Successful Host Transfer ==={RESET}")
    
    response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/transfer-host",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"user_id": diego_id}
    )
    
    if response.status_code != 200:
        return log_test(
            "Scenario 6: Successful host transfer",
            False,
            f"Status: {response.status_code}, Response: {response.text}"
        )
    
    data = response.json()
    
    # Verify host is now Diego
    host_is_diego = data.get("host", {}).get("id") == diego_id
    
    # Verify Diego has role "host" in members
    diego_member = None
    mei_member = None
    for member in data.get("members", []):
        if member.get("id") == diego_id:
            diego_member = member
        if member.get("id") == mei_id:
            mei_member = member
    
    diego_is_host_role = diego_member and diego_member.get("role") == "host"
    mei_is_speaker_role = mei_member and mei_member.get("role") == "speaker"
    
    passed = host_is_diego and diego_is_host_role and mei_is_speaker_role
    
    details = f"Host ID: {data.get('host', {}).get('id')}, "
    details += f"Diego role: {diego_member.get('role') if diego_member else 'NOT FOUND'}, "
    details += f"Mei role: {mei_member.get('role') if mei_member else 'NOT FOUND'}"
    
    return log_test(
        "Scenario 6: Host successfully transferred to Diego",
        passed,
        details
    )

def test_scenario_7(mei_token, diego_token, diego_id, room_id):
    """Test Scenario 7: Mei leaves, room continues with Diego as host"""
    print(f"\n{YELLOW}=== Scenario 7: Old Host Leaves, Room Continues ==={RESET}")
    
    # Mei leaves the room
    print(f"\n{BLUE}→ Mei leaving room...{RESET}")
    leave_response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/leave",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if leave_response.status_code != 200:
        return log_test(
            "Scenario 7: Mei leaves room",
            False,
            f"Leave failed: {leave_response.status_code}"
        )
    
    print(f"  ✓ Mei left room")
    
    # Get room details to verify it's still live with Diego as host
    room_data = get_room(diego_token, room_id)
    
    if not room_data:
        return log_test(
            "Scenario 7: Room continues after old host leaves",
            False,
            "Could not fetch room details"
        )
    
    is_live = room_data.get("is_live")
    host_id = room_data.get("host", {}).get("id")
    
    passed = is_live == True and host_id == diego_id
    
    return log_test(
        "Scenario 7: Room continues with Diego as host after Mei leaves",
        passed,
        f"is_live: {is_live}, host_id: {host_id}"
    )

def test_scenario_8(mei_token):
    """Test Scenario 8: Host leaves without transfer -> room ends"""
    print(f"\n{YELLOW}=== Scenario 8: Host Leaves Without Transfer (Regression) ==={RESET}")
    
    # Create a new room
    room_id = create_room(mei_token, "Host Leave Test Room")
    if not room_id:
        return log_test("Scenario 8: Room creation", False, "Failed to create room")
    
    # Mei leaves (as host, with no other members to transfer to)
    print(f"\n{BLUE}→ Mei (host) leaving room without transfer...{RESET}")
    leave_response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/leave",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if leave_response.status_code != 200:
        return log_test(
            "Scenario 8: Host leaves",
            False,
            f"Leave failed: {leave_response.status_code}"
        )
    
    print(f"  ✓ Mei left room")
    
    # Try to get room details - should be 404 or is_live=false
    room_data = get_room(mei_token, room_id)
    
    # Room should either not exist (404) or be ended (is_live=false)
    if room_data is None:
        # 404 - room not found (acceptable)
        passed = True
        details = "Room returned 404 (room ended/deleted)"
    else:
        # Room exists, check if is_live is false
        is_live = room_data.get("is_live")
        passed = is_live == False
        details = f"is_live: {is_live}"
    
    return log_test(
        "Scenario 8: Room ends when host leaves without transfer",
        passed,
        details
    )

def test_scenario_9(mei_token):
    """Test Scenario 9: POST /api/rooms/{id}/end by host still works (regression)"""
    print(f"\n{YELLOW}=== Scenario 9: Host End Room (Regression) ==={RESET}")
    
    # Create a new room
    room_id = create_room(mei_token, "End Room Test")
    if not room_id:
        return log_test("Scenario 9: Room creation", False, "Failed to create room")
    
    # End the room
    print(f"\n{BLUE}→ Mei ending room...{RESET}")
    end_response = requests.post(
        f"{BASE_URL}/rooms/{room_id}/end",
        headers={"Authorization": f"Bearer {mei_token}"}
    )
    
    if end_response.status_code != 200:
        return log_test(
            "Scenario 9: POST /api/rooms/{id}/end",
            False,
            f"Status: {end_response.status_code}, Response: {end_response.text}"
        )
    
    data = end_response.json()
    ok = data.get("ok")
    
    # Verify room is ended - GET may return 404 since get_live_room only returns live rooms
    room_data = get_room(mei_token, room_id)
    
    # Room should either not be accessible (404/None) or show is_live=false
    if room_data is None:
        # 404 - room not accessible (acceptable, GET only returns live rooms)
        passed = ok == True
        details = f"ok: {ok}, room not accessible after end (expected)"
    else:
        # Room exists, check if is_live is false
        is_live = room_data.get("is_live")
        passed = ok == True and is_live == False
        details = f"ok: {ok}, is_live: {is_live}"
    
    return log_test(
        "Scenario 9: POST /api/rooms/{id}/end works correctly",
        passed,
        details
    )

def main():
    """Run all transfer-host tests"""
    print(f"\n{'='*70}")
    print(f"  LinguaConnect Room Transfer Host Backend API Tests")
    print(f"  Backend: {BASE_URL}")
    print(f"{'='*70}")
    
    results = []
    
    # Login both users
    print(f"\n{YELLOW}=== Setup: Login Users ==={RESET}")
    mei_token, mei_id = login_user(MEI_EMAIL, MEI_PASSWORD)
    diego_token, diego_id = login_user(DIEGO_EMAIL, DIEGO_PASSWORD)
    
    if not mei_token or not diego_token:
        print(f"\n{RED}FATAL: Could not login users. Aborting.{RESET}")
        sys.exit(1)
    
    # Scenario 1-2: Create room and join
    test1_result, room_id = test_scenario_1_2(mei_token, diego_token)
    results.append(test1_result)
    
    if not room_id:
        print(f"\n{RED}FATAL: Could not create room. Aborting remaining tests.{RESET}")
        sys.exit(1)
    
    # Scenario 3: Non-host tries to transfer
    results.append(test_scenario_3(diego_token, diego_id, room_id))
    
    # Scenario 4: Transfer to non-existent user
    results.append(test_scenario_4(mei_token, room_id))
    
    # Scenario 5: Transfer to self
    results.append(test_scenario_5(mei_token, mei_id, room_id))
    
    # Scenario 6: Successful transfer
    results.append(test_scenario_6(mei_token, diego_token, mei_id, diego_id, room_id))
    
    # Scenario 7: Old host leaves, room continues
    results.append(test_scenario_7(mei_token, diego_token, diego_id, room_id))
    
    # Scenario 8: Host leaves without transfer -> room ends
    results.append(test_scenario_8(mei_token))
    
    # Scenario 9: POST /api/rooms/{id}/end still works
    results.append(test_scenario_9(mei_token))
    
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
        return 0
    else:
        print(f"\n  {RED}❌ SOME TESTS FAILED{RESET}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
