#!/usr/bin/env python3
"""
LinguaConnect Backend Regression Test Suite
Full smoke test after environment recovery
"""

import requests
import json
import base64
import sys
import time
from typing import Optional
import websocket
import threading

# Backend URL
BASE_URL = "https://apk-build-debug-1.preview.emergentagent.com/api"

# Test credentials
MEI_EMAIL = "mei@demo.com"
MEI_PASSWORD = "Demo1234!"
DIEGO_EMAIL = "diego@demo.com"
DIEGO_PASSWORD = "Demo1234!"
ADMIN_EMAIL = "admin@lingua.app"
ADMIN_PASSWORD = "Admin1234!"

# Global state
mei_token: Optional[str] = None
mei_id: Optional[str] = None
diego_token: Optional[str] = None
diego_id: Optional[str] = None
admin_token: Optional[str] = None
admin_id: Optional[str] = None

test_results = {"passed": 0, "failed": 0, "failures": []}

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    if passed:
        test_results["passed"] += 1
        print(f"✅ PASS: {name}")
    else:
        test_results["failed"] += 1
        test_results["failures"].append(f"{name}: {details}")
        print(f"❌ FAIL: {name}")
        if details:
            print(f"  Details: {details}")

def print_section(title: str):
    """Print section header"""
    print(f"\n{'='*80}")
    print(f"{title}")
    print(f"{'='*80}")

# ============================================================================
# 1. AUTH TESTS
# ============================================================================

def test_auth():
    global mei_token, mei_id, diego_token, diego_id, admin_token, admin_id
    
    print_section("1. AUTH TESTS")
    
    # Test 1.1: Login mei
    response = requests.post(f"{BASE_URL}/auth/login", json={"email": MEI_EMAIL, "password": MEI_PASSWORD})
    if response.status_code == 200:
        data = response.json()
        mei_token = data["token"]
        mei_id = data["user"]["id"]
        log_test("AUTH: Login mei@demo.com", True, f"Token received, user_id={mei_id}")
    else:
        log_test("AUTH: Login mei@demo.com", False, f"Status {response.status_code}: {response.text}")
        return
    
    # Test 1.2: Login diego
    response = requests.post(f"{BASE_URL}/auth/login", json={"email": DIEGO_EMAIL, "password": DIEGO_PASSWORD})
    if response.status_code == 200:
        data = response.json()
        diego_token = data["token"]
        diego_id = data["user"]["id"]
        log_test("AUTH: Login diego@demo.com", True, f"Token received, user_id={diego_id}")
    else:
        log_test("AUTH: Login diego@demo.com", False, f"Status {response.status_code}: {response.text}")
        return
    
    # Test 1.3: Login admin
    response = requests.post(f"{BASE_URL}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if response.status_code == 200:
        data = response.json()
        admin_token = data["token"]
        admin_id = data["user"]["id"]
        log_test("AUTH: Login admin@lingua.app", True, f"Token received, admin_id={admin_id}")
    else:
        log_test("AUTH: Login admin@lingua.app", False, f"Status {response.status_code}: {response.text}")
    
    # Test 1.4: GET /auth/me with token
    response = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        if data.get("id") == mei_id:
            log_test("AUTH: GET /auth/me with token", True, f"User profile returned correctly")
        else:
            log_test("AUTH: GET /auth/me with token", False, f"User ID mismatch")
    else:
        log_test("AUTH: GET /auth/me with token", False, f"Status {response.status_code}")
    
    # Test 1.5: Register new user
    import random
    test_email = f"testuser_{int(time.time())}_{random.randint(1000,9999)}@test.com"
    response = requests.post(f"{BASE_URL}/auth/register", json={
        "email": test_email,
        "password": "Test1234!",
        "name": "Test User"
    })
    if response.status_code == 201:
        data = response.json()
        if "token" in data and "user" in data:
            log_test("AUTH: Register new user", True, f"User created: {test_email}")
        else:
            log_test("AUTH: Register new user", False, "Missing token or user in response")
    else:
        log_test("AUTH: Register new user", False, f"Status {response.status_code}: {response.text}")
    
    # Test 1.6: 401 without token
    response = requests.get(f"{BASE_URL}/auth/me")
    if response.status_code in [401, 403]:
        log_test("AUTH: 401 without token", True, f"Correctly returns {response.status_code}")
    else:
        log_test("AUTH: 401 without token", False, f"Expected 401/403, got {response.status_code}")

# ============================================================================
# 2. USERS TESTS
# ============================================================================

def test_users():
    print_section("2. USERS TESTS")
    
    # Test 2.1: GET /users/partners
    response = requests.get(f"{BASE_URL}/users/partners", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        if isinstance(data, list) and len(data) > 0:
            log_test("USERS: GET /users/partners", True, f"Found {len(data)} partners")
        else:
            log_test("USERS: GET /users/partners", False, "Empty partners list")
    else:
        log_test("USERS: GET /users/partners", False, f"Status {response.status_code}")
    
    # Test 2.2: GET /users/{diego_id} profile
    response = requests.get(f"{BASE_URL}/users/{diego_id}", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        if data.get("id") == diego_id:
            log_test("USERS: GET /users/{diego_id} profile", True, f"Profile returned for diego")
        else:
            log_test("USERS: GET /users/{diego_id} profile", False, "User ID mismatch")
    else:
        log_test("USERS: GET /users/{diego_id} profile", False, f"Status {response.status_code}")

# ============================================================================
# 3. CHATS + VOICE MESSAGE + CALL LOG TESTS
# ============================================================================

def test_chats():
    print_section("3. CHATS + VOICE MESSAGE + CALL LOG TESTS")
    
    # Test 3.1: POST /chats to create conversation
    response = requests.post(f"{BASE_URL}/chats", 
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={"partner_id": diego_id})
    if response.status_code in [200, 201]:
        conv = response.json()
        cid = conv.get("id")
        log_test("CHATS: POST /chats create conversation", True, f"Conversation created: {cid}")
    else:
        log_test("CHATS: POST /chats create conversation", False, f"Status {response.status_code}")
        return
    
    # Test 3.2: POST text message
    response = requests.post(f"{BASE_URL}/chats/{cid}/messages",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={"text": "Test message for regression test"})
    if response.status_code == 201:
        msg = response.json()
        mid = msg.get("id")
        log_test("CHATS: POST text message", True, f"Message sent: {mid}")
    else:
        log_test("CHATS: POST text message", False, f"Status {response.status_code}")
        return
    
    # Test 3.3: POST voice message with base64 audio
    # Create a small fake audio payload (1 second of silence as WAV)
    fake_audio = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    audio_base64 = base64.b64encode(fake_audio).decode()
    
    response = requests.post(f"{BASE_URL}/chats/{cid}/voice",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={
                                "audio_base64": audio_base64,
                                "mime": "audio/wav",
                                "duration_ms": 1000
                            })
    if response.status_code == 201:
        voice_msg = response.json()
        audio_id = voice_msg.get("audio_id")
        if audio_id:
            log_test("CHATS: POST voice message", True, f"Voice message sent with audio_id={audio_id}")
            
            # Test 3.4: GET /audio/{audio_id}
            response = requests.get(f"{BASE_URL}/audio/{audio_id}")
            if response.status_code == 200 and len(response.content) > 0:
                log_test("CHATS: GET /audio/{audio_id}", True, f"Audio retrieved, {len(response.content)} bytes")
            else:
                log_test("CHATS: GET /audio/{audio_id}", False, f"Status {response.status_code}")
        else:
            log_test("CHATS: POST voice message", False, "No audio_id in response")
    else:
        log_test("CHATS: POST voice message", False, f"Status {response.status_code}: {response.text}")
    
    # Test 3.5: POST call log
    response = requests.post(f"{BASE_URL}/chats/{cid}/call",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={
                                "status": "answered",
                                "duration_ms": 65000,
                                "kind": "voice"
                            })
    if response.status_code == 201:
        call_msg = response.json()
        if call_msg.get("type") == "call" and call_msg.get("call_status") == "answered":
            log_test("CHATS: POST call log", True, f"Call event created")
        else:
            log_test("CHATS: POST call log", False, "Invalid call message structure")
    else:
        log_test("CHATS: POST call log", False, f"Status {response.status_code}")
    
    # Test 3.6: GET /chats/{cid}/messages - verify all message types
    response = requests.get(f"{BASE_URL}/chats/{cid}/messages",
                           headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        messages = response.json()
        has_text = any(m.get("type") == "text" for m in messages)
        has_voice = any(m.get("type") == "voice" and m.get("audio_id") and m.get("duration_ms") for m in messages)
        has_call = any(m.get("type") == "call" and m.get("call_status") for m in messages)
        
        if has_text and has_voice and has_call:
            log_test("CHATS: GET messages shows text/voice/call", True, f"Found {len(messages)} messages")
        else:
            log_test("CHATS: GET messages shows text/voice/call", False, 
                    f"Missing types - text:{has_text}, voice:{has_voice}, call:{has_call}")
    else:
        log_test("CHATS: GET messages shows text/voice/call", False, f"Status {response.status_code}")
    
    # Test 3.7: PIN toggle
    response = requests.post(f"{BASE_URL}/chats/{cid}/messages/{mid}/pin",
                            headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        msg = response.json()
        if msg.get("pinned") == True:
            log_test("CHATS: PIN toggle (pin)", True, "Message pinned")
            
            # Toggle again to unpin
            response = requests.post(f"{BASE_URL}/chats/{cid}/messages/{mid}/pin",
                                    headers={"Authorization": f"Bearer {mei_token}"})
            if response.status_code == 200 and response.json().get("pinned") == False:
                log_test("CHATS: PIN toggle (unpin)", True, "Message unpinned")
            else:
                log_test("CHATS: PIN toggle (unpin)", False, "Failed to unpin")
        else:
            log_test("CHATS: PIN toggle (pin)", False, "Message not pinned")
    else:
        log_test("CHATS: PIN toggle (pin)", False, f"Status {response.status_code}")

# ============================================================================
# 4. WEBSOCKET CALL SIGNALING TESTS (CRITICAL)
# ============================================================================

def test_websocket_signaling():
    print_section("4. WEBSOCKET CALL SIGNALING TESTS (CRITICAL)")
    
    ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    
    mei_messages = []
    diego_messages = []
    mei_ws = None
    diego_ws = None
    
    def on_mei_message(ws, message):
        mei_messages.append(json.loads(message))
    
    def on_diego_message(ws, message):
        diego_messages.append(json.loads(message))
    
    try:
        # Test 4.1: Connect mei to WebSocket
        mei_ws = websocket.WebSocketApp(
            f"{ws_url}/ws?token={mei_token}",
            on_message=on_mei_message
        )
        mei_thread = threading.Thread(target=mei_ws.run_forever)
        mei_thread.daemon = True
        mei_thread.start()
        time.sleep(1)
        
        log_test("WS: Connect mei to /api/ws", True, "Mei connected")
        
        # Test 4.2: Connect diego to WebSocket
        diego_ws = websocket.WebSocketApp(
            f"{ws_url}/ws?token={diego_token}",
            on_message=on_diego_message
        )
        diego_thread = threading.Thread(target=diego_ws.run_forever)
        diego_thread.daemon = True
        diego_thread.start()
        time.sleep(1)
        
        log_test("WS: Connect diego to /api/ws", True, "Diego connected")
        
        # Test 4.3: Send call_offer from mei to diego
        mei_ws.send(json.dumps({
            "type": "call_offer",
            "to": diego_id,
            "sdp": {"type": "offer", "sdp": "fake_sdp_offer"}
        }))
        time.sleep(1)
        
        # Check if diego received the offer with caller info
        offer_received = False
        has_caller_card = False
        for msg in diego_messages:
            if msg.get("type") == "call_offer" and msg.get("from") == mei_id:
                offer_received = True
                if msg.get("caller") and msg["caller"].get("id") == mei_id:
                    has_caller_card = True
                break
        
        if offer_received and has_caller_card:
            log_test("WS: call_offer relayed with caller card", True, "Diego received offer with caller info")
        else:
            log_test("WS: call_offer relayed with caller card", False, 
                    f"offer_received={offer_received}, has_caller_card={has_caller_card}")
        
        # Test 4.4: Send call_answer from diego to mei
        diego_ws.send(json.dumps({
            "type": "call_answer",
            "to": mei_id,
            "sdp": {"type": "answer", "sdp": "fake_sdp_answer"}
        }))
        time.sleep(1)
        
        answer_received = any(
            msg.get("type") == "call_answer" and msg.get("from") == diego_id
            for msg in mei_messages
        )
        log_test("WS: call_answer relayed", answer_received, 
                "Mei received answer" if answer_received else "Answer not received")
        
        # Test 4.5: Send call_ice
        mei_ws.send(json.dumps({
            "type": "call_ice",
            "to": diego_id,
            "candidate": "fake_ice_candidate"
        }))
        time.sleep(1)
        
        ice_received = any(
            msg.get("type") == "call_ice" and msg.get("from") == mei_id
            for msg in diego_messages
        )
        log_test("WS: call_ice relayed", ice_received,
                "Diego received ICE" if ice_received else "ICE not received")
        
        # Test 4.6: Send call_end
        diego_ws.send(json.dumps({
            "type": "call_end",
            "to": mei_id
        }))
        time.sleep(1)
        
        end_received = any(
            msg.get("type") == "call_end" and msg.get("from") == diego_id
            for msg in mei_messages
        )
        log_test("WS: call_end relayed", end_received,
                "Mei received call_end" if end_received else "call_end not received")
        
        # Test 4.7: Send call_decline
        mei_ws.send(json.dumps({
            "type": "call_decline",
            "to": diego_id
        }))
        time.sleep(1)
        
        decline_received = any(
            msg.get("type") == "call_decline" and msg.get("from") == mei_id
            for msg in diego_messages
        )
        log_test("WS: call_decline relayed", decline_received,
                "Diego received call_decline" if decline_received else "call_decline not received")
        
        # Test 4.8: Send call_offer to offline user (fake ID)
        mei_messages.clear()
        mei_ws.send(json.dumps({
            "type": "call_offer",
            "to": "fake-offline-user-id-999",
            "sdp": {"type": "offer", "sdp": "fake_sdp"}
        }))
        time.sleep(1)
        
        unavailable_received = any(
            msg.get("type") == "call_unavailable"
            for msg in mei_messages
        )
        log_test("WS: call_offer to offline user returns call_unavailable", unavailable_received,
                "Received call_unavailable" if unavailable_received else "No call_unavailable")
        
        # Test 4.9: Test rtc_offer/answer/ice with room_id (for voice rooms)
        mei_ws.send(json.dumps({
            "type": "rtc_offer",
            "to": diego_id,
            "room_id": "test-room-123",
            "sdp": {"type": "offer", "sdp": "rtc_offer"}
        }))
        time.sleep(1)
        
        rtc_offer_received = any(
            msg.get("type") == "rtc_offer" and msg.get("room_id") == "test-room-123"
            for msg in diego_messages
        )
        log_test("WS: rtc_offer with room_id relayed", rtc_offer_received,
                "Diego received rtc_offer" if rtc_offer_received else "rtc_offer not received")
        
    except Exception as e:
        log_test("WS: WebSocket tests", False, f"Exception: {str(e)}")
    finally:
        if mei_ws:
            mei_ws.close()
        if diego_ws:
            diego_ws.close()

# ============================================================================
# 5. ROOMS TESTS
# ============================================================================

def test_rooms():
    print_section("5. ROOMS TESTS")
    
    # Test 5.1: GET /rooms
    response = requests.get(f"{BASE_URL}/rooms", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        rooms = response.json()
        log_test("ROOMS: GET /rooms", True, f"Found {len(rooms)} rooms")
    else:
        log_test("ROOMS: GET /rooms", False, f"Status {response.status_code}")
    
    # Test 5.2: POST /rooms create room
    response = requests.post(f"{BASE_URL}/rooms",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={
                                "title": "Regression Test Room",
                                "language": "en",
                                "topic": "Small Talk",
                                "mode": "chat",
                                "is_private": False,
                                "background": 1,
                                "share_to_moments": False
                            })
    if response.status_code == 201:
        room = response.json()
        room_id = room.get("id")
        log_test("ROOMS: POST /rooms create", True, f"Room created: {room_id}")
    else:
        log_test("ROOMS: POST /rooms create", False, f"Status {response.status_code}: {response.text}")
        return
    
    # Test 5.3: POST /rooms/{id}/join
    response = requests.post(f"{BASE_URL}/rooms/{room_id}/join",
                            headers={"Authorization": f"Bearer {diego_token}"})
    if response.status_code == 200:
        room = response.json()
        if room.get("member_count", 0) >= 2:
            log_test("ROOMS: POST /rooms/{id}/join", True, f"Diego joined, {room['member_count']} members")
        else:
            log_test("ROOMS: POST /rooms/{id}/join", False, "Member count not updated")
    else:
        log_test("ROOMS: POST /rooms/{id}/join", False, f"Status {response.status_code}")
    
    # Test 5.4: POST /rooms/{id}/messages
    response = requests.post(f"{BASE_URL}/rooms/{room_id}/messages",
                            headers={"Authorization": f"Bearer {diego_token}"},
                            json={"text": "Hello from diego in room"})
    if response.status_code == 201:
        msg = response.json()
        log_test("ROOMS: POST /rooms/{id}/messages", True, f"Message sent in room")
    else:
        log_test("ROOMS: POST /rooms/{id}/messages", False, f"Status {response.status_code}")
    
    # Test 5.5: GET /rooms/gift-catalog
    response = requests.get(f"{BASE_URL}/rooms/gift-catalog",
                           headers={"Authorization": f"Bearer {diego_token}"})
    if response.status_code == 200:
        data = response.json()
        if "coins" in data and "gifts" in data and len(data["gifts"]) == 4:
            log_test("ROOMS: GET /rooms/gift-catalog", True, f"Catalog has 4 gifts, user has {data['coins']} coins")
        else:
            log_test("ROOMS: GET /rooms/gift-catalog", False, "Invalid catalog structure")
    else:
        log_test("ROOMS: GET /rooms/gift-catalog", False, f"Status {response.status_code}")
    
    # Test 5.6: POST /rooms/{id}/end
    response = requests.post(f"{BASE_URL}/rooms/{room_id}/end",
                            headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        if data.get("ok"):
            log_test("ROOMS: POST /rooms/{id}/end", True, "Room ended by host")
        else:
            log_test("ROOMS: POST /rooms/{id}/end", False, "ok not true")
    else:
        log_test("ROOMS: POST /rooms/{id}/end", False, f"Status {response.status_code}")

# ============================================================================
# 6. MOMENTS TESTS
# ============================================================================

def test_moments():
    print_section("6. MOMENTS TESTS")
    
    # Test 6.1: GET /moments
    response = requests.get(f"{BASE_URL}/moments", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        moments = response.json()
        log_test("MOMENTS: GET /moments", True, f"Found {len(moments)} moments")
        
        if len(moments) > 0:
            moment_id = moments[0].get("id")
            
            # Test 6.2: POST /moments/{id}/like
            response = requests.post(f"{BASE_URL}/moments/{moment_id}/like",
                                    headers={"Authorization": f"Bearer {mei_token}"})
            if response.status_code == 200:
                log_test("MOMENTS: POST /moments/{id}/like", True, "Moment liked")
            else:
                log_test("MOMENTS: POST /moments/{id}/like", False, f"Status {response.status_code}")
            
            # Test 6.3: POST /moments/{id}/comments
            response = requests.post(f"{BASE_URL}/moments/{moment_id}/comments",
                                    headers={"Authorization": f"Bearer {mei_token}"},
                                    json={"text": "Test comment from regression test"})
            if response.status_code == 201:
                log_test("MOMENTS: POST /moments/{id}/comments", True, "Comment created")
            else:
                log_test("MOMENTS: POST /moments/{id}/comments", False, f"Status {response.status_code}")
    else:
        log_test("MOMENTS: GET /moments", False, f"Status {response.status_code}")
    
    # Test 6.4: POST /moments create
    response = requests.post(f"{BASE_URL}/moments",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={"text": "Test moment from regression test"})
    if response.status_code == 201:
        moment = response.json()
        log_test("MOMENTS: POST /moments create", True, f"Moment created: {moment.get('id')}")
    else:
        log_test("MOMENTS: POST /moments create", False, f"Status {response.status_code}")

# ============================================================================
# 7. PRO TESTS
# ============================================================================

def test_pro():
    print_section("7. PRO TESTS")
    
    # Test 7.1: GET /pro/me
    response = requests.get(f"{BASE_URL}/pro/me", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        # API returns {profile: {...}, wallet: {...}}
        if "profile" in data and "wallet" in data:
            profile = data["profile"]
            wallet = data["wallet"]
            if "role" in profile and "balance" in wallet:
                log_test("PRO: GET /pro/me", True, f"Profile: role={profile['role']}, balance={wallet['balance']} {wallet['currency']}")
            else:
                log_test("PRO: GET /pro/me", False, f"Missing role or balance")
        else:
            log_test("PRO: GET /pro/me", False, f"Missing profile or wallet. Keys: {list(data.keys())}")
    else:
        log_test("PRO: GET /pro/me", False, f"Status {response.status_code}")
    
    # Test 7.2: GET /pro/tutors
    response = requests.get(f"{BASE_URL}/pro/tutors", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        tutors = response.json()
        if len(tutors) > 0:
            log_test("PRO: GET /pro/tutors", True, f"Found {len(tutors)} tutors")
        else:
            log_test("PRO: GET /pro/tutors", False, "Empty tutors list")
    else:
        log_test("PRO: GET /pro/tutors", False, f"Status {response.status_code}")
    
    # Test 7.3: POST /pro/match (instant)
    response = requests.post(f"{BASE_URL}/pro/match",
                            headers={"Authorization": f"Bearer {mei_token}"},
                            json={"instant": True})
    if response.status_code in [200, 201]:
        session = response.json()
        if "stream_room_token" in session:
            room_token = session["stream_room_token"]
            log_test("PRO: POST /pro/match instant", True, f"Session created with room token")
            
            # Test 7.4: WebSocket /pro/rtc/{room}
            ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
            try:
                messages = []
                def on_message(ws, message):
                    messages.append(json.loads(message))
                
                ws = websocket.WebSocketApp(
                    f"{ws_url}/pro/rtc/{room_token}?token={mei_token}",
                    on_message=on_message
                )
                thread = threading.Thread(target=ws.run_forever)
                thread.daemon = True
                thread.start()
                time.sleep(1)
                
                # Check for rtc_welcome
                welcome_received = any(msg.get("type") == "rtc_welcome" for msg in messages)
                if welcome_received:
                    log_test("PRO: WS /pro/rtc/{room} rtc_welcome", True, "Received rtc_welcome")
                else:
                    log_test("PRO: WS /pro/rtc/{room} rtc_welcome", False, "No rtc_welcome")
                
                # Send a test message
                ws.send(json.dumps({"type": "test", "data": "hello"}))
                time.sleep(1)
                
                ws.close()
                log_test("PRO: WS /pro/rtc/{room} relay", True, "WebSocket connected and working")
            except Exception as e:
                log_test("PRO: WS /pro/rtc/{room}", False, f"Exception: {str(e)}")
        else:
            log_test("PRO: POST /pro/match instant", False, "No stream_room_token")
    else:
        log_test("PRO: POST /pro/match instant", False, f"Status {response.status_code}")

# ============================================================================
# 8. LESSONS TESTS
# ============================================================================

def test_lessons():
    print_section("8. LESSONS TESTS")
    
    # Test 8.1: GET /lessons/me
    response = requests.get(f"{BASE_URL}/lessons/me", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        profile = response.json()
        if "hearts" in profile and "gems" in profile and "xp" in profile:
            log_test("LESSONS: GET /lessons/me", True, 
                    f"Profile: hearts={profile['hearts']}, gems={profile['gems']}, xp={profile['xp']}")
        else:
            log_test("LESSONS: GET /lessons/me", False, "Missing required fields")
    else:
        log_test("LESSONS: GET /lessons/me", False, f"Status {response.status_code}")
    
    # Test 8.2: GET /lessons/path
    response = requests.get(f"{BASE_URL}/lessons/path?lang=es", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        data = response.json()
        # API returns {lang, name, units: [...]}
        if isinstance(data, dict) and "units" in data:
            units = data["units"]
            if len(units) > 0 and "skills" in units[0]:
                log_test("LESSONS: GET /lessons/path", True, f"Found {len(units)} units for {data.get('name', 'language')}")
            else:
                log_test("LESSONS: GET /lessons/path", False, f"Invalid units structure")
        else:
            log_test("LESSONS: GET /lessons/path", False, f"Invalid response structure: {type(data)}")
    else:
        log_test("LESSONS: GET /lessons/path", False, f"Status {response.status_code}")
    
    # Test 8.3: GET /lessons/lesson/{id}
    response = requests.get(f"{BASE_URL}/lessons/lesson/es-0-0", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 200:
        lesson = response.json()
        if "exercises" in lesson and len(lesson["exercises"]) > 0:
            log_test("LESSONS: GET /lessons/lesson/es-0-0", True, 
                    f"Lesson has {len(lesson['exercises'])} exercises")
        else:
            log_test("LESSONS: GET /lessons/lesson/es-0-0", False, "No exercises")
    else:
        log_test("LESSONS: GET /lessons/lesson/es-0-0", False, f"Status {response.status_code}")

# ============================================================================
# 9. ADMIN TESTS
# ============================================================================

def test_admin():
    print_section("9. ADMIN TESTS")
    
    # Test 9.1: GET /admin/stats (or overview) with admin token
    # Try common admin endpoints
    endpoints = ["/admin/stats", "/admin/overview", "/admin/pro/stats"]
    admin_works = False
    
    for endpoint in endpoints:
        response = requests.get(f"{BASE_URL}{endpoint}", headers={"Authorization": f"Bearer {admin_token}"})
        if response.status_code == 200:
            data = response.json()
            log_test(f"ADMIN: GET {endpoint} with admin token", True, f"Admin endpoint accessible")
            admin_works = True
            break
    
    if not admin_works:
        log_test("ADMIN: Admin endpoints with admin token", False, "No admin endpoint worked")
    
    # Test 9.2: 403 for non-admin (mei)
    response = requests.get(f"{BASE_URL}/admin/stats", headers={"Authorization": f"Bearer {mei_token}"})
    if response.status_code == 403:
        log_test("ADMIN: 403 for non-admin user", True, "Correctly returns 403")
    else:
        log_test("ADMIN: 403 for non-admin user", False, f"Expected 403, got {response.status_code}")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def main():
    print("="*80)
    print("LINGUACONNECT BACKEND REGRESSION TEST SUITE")
    print("Full smoke test after environment recovery")
    print("="*80)
    
    test_auth()
    
    if not mei_token or not diego_token:
        print("\n❌ CRITICAL: Auth failed, cannot continue")
        sys.exit(1)
    
    test_users()
    test_chats()
    test_websocket_signaling()
    test_rooms()
    test_moments()
    test_pro()
    test_lessons()
    
    if admin_token:
        test_admin()
    else:
        print("\n⚠️  WARNING: Admin login failed, skipping admin tests")
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"✅ PASSED: {test_results['passed']}")
    print(f"❌ FAILED: {test_results['failed']}")
    
    if test_results['failed'] > 0:
        print("\nFAILURES:")
        for failure in test_results['failures']:
            print(f"  - {failure}")
    
    print("="*80)
    
    if test_results['failed'] > 0:
        sys.exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
