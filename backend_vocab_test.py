#!/usr/bin/env python3
"""
Backend API Testing for Vocab Sub-App
Tests all /api/vocab/* endpoints as specified in the review request
"""

import requests
import json
from typing import Dict, Any, Optional

# Base URL from frontend/.env
BASE_URL = "https://apk-deployment-6.preview.emergentagent.com/api"

# Test credentials
TEST_EMAIL = "mei@demo.com"
TEST_PASSWORD = "Demo1234!"

# Global state
token = None
test_word_id = None
test_tutor_id = None
test_booking_id = None
test_bookmark_target_id = None


def login(email: str, password: str) -> str:
    """Login and return JWT token"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    if response.status_code == 200:
        data = response.json()
        return data.get("token")
    else:
        raise Exception(f"Login failed for {email}: {response.status_code} {response.text}")


def test_auth_setup():
    """Setup: Login as test user"""
    global token
    
    print("\n=== AUTH SETUP ===")
    
    try:
        token = login(TEST_EMAIL, TEST_PASSWORD)
        print(f"✅ Login successful for {TEST_EMAIL}")
        return True
    except Exception as e:
        print(f"❌ Login failed: {e}")
        return False


def test_1_topics_list():
    """Test 1: GET /api/vocab/topics - should return >= 10 topics"""
    print("\n=== TEST 1: GET /api/vocab/topics ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/topics",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    topics = response.json()
    
    if not isinstance(topics, list):
        print(f"❌ Response is not a list: {type(topics)}")
        return False
    
    if len(topics) < 10:
        print(f"❌ Expected >= 10 topics, got {len(topics)}")
        return False
    
    # Verify first topic has required fields
    topic = topics[0]
    required_fields = ["id", "name", "subtitle", "icon", "color", "word_count", "words_learned"]
    missing_fields = [f for f in required_fields if f not in topic]
    
    if missing_fields:
        print(f"❌ Topic missing fields: {missing_fields}")
        return False
    
    print(f"✅ Topics list returned correctly ({len(topics)} topics)")
    print(f"   Sample: {topic['name']} - {topic['subtitle']} ({topic['word_count']} words)")
    return True


def test_2_topic_single():
    """Test 2: GET /api/vocab/topics/medicine - returns single medicine topic"""
    print("\n=== TEST 2: GET /api/vocab/topics/medicine ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/topics/medicine",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    topic = response.json()
    
    if topic.get("id") != "medicine":
        print(f"❌ Expected id='medicine', got '{topic.get('id')}'")
        return False
    
    if topic.get("name") != "Medicine":
        print(f"❌ Expected name='Medicine', got '{topic.get('name')}'")
        return False
    
    required_fields = ["id", "name", "subtitle", "icon", "color", "word_count", "words_learned"]
    missing_fields = [f for f in required_fields if f not in topic]
    
    if missing_fields:
        print(f"❌ Topic missing fields: {missing_fields}")
        return False
    
    print(f"✅ Medicine topic returned correctly")
    print(f"   {topic['name']}: {topic['word_count']} words, {topic['words_learned']} learned")
    return True


def test_3_topic_words():
    """Test 3: GET /api/vocab/topics/medicine/words - returns words with status"""
    global test_word_id
    
    print("\n=== TEST 3: GET /api/vocab/topics/medicine/words ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/topics/medicine/words",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    words = response.json()
    
    if not isinstance(words, list):
        print(f"❌ Response is not a list: {type(words)}")
        return False
    
    if len(words) == 0:
        print(f"❌ Expected words, got empty list")
        return False
    
    # Verify first word has required fields
    word = words[0]
    required_fields = ["id", "term", "translation", "example", "topic_id", "status"]
    missing_fields = [f for f in required_fields if f not in word]
    
    if missing_fields:
        print(f"❌ Word missing fields: {missing_fields}")
        return False
    
    # Check default status is "new"
    if word.get("status") not in ["new", "learning", "known"]:
        print(f"❌ Invalid status: {word.get('status')}")
        return False
    
    # Save word_id for later tests
    test_word_id = word["id"]
    
    print(f"✅ Medicine words returned correctly ({len(words)} words)")
    print(f"   Sample: {word['term']} = {word['translation']}, status={word['status']}")
    return True


def test_4_lessons_list():
    """Test 4: GET /api/vocab/lessons - returns lessons"""
    print("\n=== TEST 4: GET /api/vocab/lessons ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/lessons",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    lessons = response.json()
    
    if not isinstance(lessons, list):
        print(f"❌ Response is not a list: {type(lessons)}")
        return False
    
    if len(lessons) == 0:
        print(f"❌ Expected lessons, got empty list")
        return False
    
    # Verify first lesson has required fields
    lesson = lessons[0]
    required_fields = ["id", "title", "description", "topic_id", "level", "minutes", "xp_reward", "completed"]
    missing_fields = [f for f in required_fields if f not in lesson]
    
    if missing_fields:
        print(f"❌ Lesson missing fields: {missing_fields}")
        return False
    
    print(f"✅ Lessons list returned correctly ({len(lessons)} lessons)")
    print(f"   Sample: {lesson['title']} ({lesson['level']}, {lesson['minutes']} min, {lesson['xp_reward']} XP)")
    return True


def test_5_lessons_filter():
    """Test 5: GET /api/vocab/lessons?level=Advanced - filters by level"""
    print("\n=== TEST 5: GET /api/vocab/lessons?level=Advanced ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/lessons?level=Advanced",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    lessons = response.json()
    
    if not isinstance(lessons, list):
        print(f"❌ Response is not a list: {type(lessons)}")
        return False
    
    # Verify all lessons are Advanced level
    for lesson in lessons:
        if lesson.get("level") != "Advanced":
            print(f"❌ Found non-Advanced lesson: {lesson.get('title')} ({lesson.get('level')})")
            return False
    
    print(f"✅ Advanced lessons filtered correctly ({len(lessons)} lessons)")
    if lessons:
        print(f"   Sample: {lessons[0]['title']} ({lessons[0]['level']})")
    return True


def test_6_lesson_detail():
    """Test 6: GET /api/vocab/lessons/pharmacy-basics - returns lesson with steps"""
    print("\n=== TEST 6: GET /api/vocab/lessons/pharmacy-basics ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/lessons/pharmacy-basics",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    lesson = response.json()
    
    required_fields = ["id", "title", "description", "topic_id", "level", "minutes", "xp_reward", "steps", "progress"]
    missing_fields = [f for f in required_fields if f not in lesson]
    
    if missing_fields:
        print(f"❌ Lesson missing fields: {missing_fields}")
        return False
    
    # Verify steps array
    steps = lesson.get("steps", [])
    if not isinstance(steps, list):
        print(f"❌ Steps is not a list: {type(steps)}")
        return False
    
    # Count step kinds
    quiz_count = sum(1 for s in steps if s.get("kind") == "quiz")
    done_count = sum(1 for s in steps if s.get("kind") == "done")
    
    if quiz_count != 1:
        print(f"❌ Expected exactly 1 quiz step, got {quiz_count}")
        return False
    
    if done_count != 1:
        print(f"❌ Expected exactly 1 done step, got {done_count}")
        return False
    
    # Verify progress object
    progress = lesson.get("progress", {})
    if not isinstance(progress, dict):
        print(f"❌ Progress is not a dict: {type(progress)}")
        return False
    
    print(f"✅ Lesson detail returned correctly")
    print(f"   {lesson['title']}: {len(steps)} steps (1 quiz, 1 done)")
    print(f"   Progress: status={progress.get('status')}, step={progress.get('current_step')}")
    return True


def test_7_word_progress():
    """Test 7: POST /api/vocab/progress/word - updates word status"""
    print("\n=== TEST 7: POST /api/vocab/progress/word ===")
    
    if not test_word_id:
        print("❌ No word_id available (test 3 must run first)")
        return False
    
    response = requests.post(
        f"{BASE_URL}/vocab/progress/word",
        headers={"Authorization": f"Bearer {token}"},
        json={"word_id": test_word_id, "status": "known"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if not data.get("ok"):
        print(f"❌ Response missing 'ok: true': {data}")
        return False
    
    if "stats" not in data:
        print(f"❌ Response missing 'stats' field")
        return False
    
    stats = data["stats"]
    if stats.get("words_learned", 0) < 1:
        print(f"❌ Expected words_learned >= 1, got {stats.get('words_learned')}")
        return False
    
    print(f"✅ Word progress updated successfully")
    print(f"   Stats: words_learned={stats.get('words_learned')}, xp={stats.get('xp')}")
    return True


def test_8_lesson_complete():
    """Test 8: POST /api/vocab/lessons/pharmacy-basics/complete - completes lesson (idempotent XP)"""
    print("\n=== TEST 8: POST /api/vocab/lessons/pharmacy-basics/complete ===")
    
    # First completion
    print("  8a: First completion (should award XP)")
    response = requests.post(
        f"{BASE_URL}/vocab/lessons/pharmacy-basics/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={"step_count": 7, "correct_count": 1}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if not data.get("ok"):
        print(f"❌ Response missing 'ok: true': {data}")
        return False
    
    xp_first = data.get("xp_awarded", 0)
    if xp_first <= 0:
        print(f"❌ Expected xp_awarded > 0 on first completion, got {xp_first}")
        return False
    
    print(f"✅ First completion awarded {xp_first} XP")
    
    # Second completion (idempotent - should award 0 XP)
    print("  8b: Second completion (should award 0 XP - idempotent)")
    response = requests.post(
        f"{BASE_URL}/vocab/lessons/pharmacy-basics/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={"step_count": 7, "correct_count": 1}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    xp_second = data.get("xp_awarded", 0)
    
    if xp_second != 0:
        print(f"❌ Expected xp_awarded = 0 on second completion, got {xp_second}")
        return False
    
    print(f"✅ Second completion awarded 0 XP (idempotent)")
    return True


def test_9_me_stats():
    """Test 9: GET /api/vocab/me/stats - shows updated stats"""
    print("\n=== TEST 9: GET /api/vocab/me/stats ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/me/stats",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    stats = response.json()
    
    required_fields = ["words_learned", "words_practicing", "lessons_completed", "streak", "level", "xp"]
    missing_fields = [f for f in required_fields if f not in stats]
    
    if missing_fields:
        print(f"❌ Stats missing fields: {missing_fields}")
        return False
    
    # Verify stats reflect previous actions
    if stats.get("words_learned", 0) < 1:
        print(f"❌ Expected words_learned >= 1 after test 7, got {stats.get('words_learned')}")
        return False
    
    if stats.get("lessons_completed", 0) < 1:
        print(f"❌ Expected lessons_completed >= 1 after test 8, got {stats.get('lessons_completed')}")
        return False
    
    if stats.get("xp", 0) <= 0:
        print(f"❌ Expected xp > 0 after test 8, got {stats.get('xp')}")
        return False
    
    if stats.get("level", 0) < 1:
        print(f"❌ Expected level >= 1, got {stats.get('level')}")
        return False
    
    print(f"✅ Stats returned correctly")
    print(f"   words_learned={stats['words_learned']}, lessons_completed={stats['lessons_completed']}")
    print(f"   xp={stats['xp']}, level={stats['level']}, streak={stats['streak']}")
    return True


def test_10_me_continue():
    """Test 10: GET /api/vocab/me/continue - returns recommended lesson"""
    print("\n=== TEST 10: GET /api/vocab/me/continue ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/me/continue",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    lesson = response.json()
    
    required_fields = ["id", "title", "topic_id", "level", "minutes", "progress", "tag"]
    missing_fields = [f for f in required_fields if f not in lesson]
    
    if missing_fields:
        print(f"❌ Lesson missing fields: {missing_fields}")
        return False
    
    # Verify tag is either "In progress" or "Recommended"
    tag = lesson.get("tag")
    if tag not in ["In progress", "Recommended"]:
        print(f"❌ Invalid tag: {tag}")
        return False
    
    print(f"✅ Continue lesson returned correctly")
    print(f"   {lesson['title']} ({lesson['level']}, {lesson['minutes']} min) - {tag}")
    return True


def test_11_bookmark_toggle():
    """Test 11: POST /api/vocab/bookmarks/toggle - toggles bookmark"""
    global test_bookmark_target_id
    
    print("\n=== TEST 11: POST /api/vocab/bookmarks/toggle ===")
    
    test_bookmark_target_id = "test-tutor-123"
    
    # First toggle (bookmark)
    print("  11a: First toggle (should bookmark)")
    response = requests.post(
        f"{BASE_URL}/vocab/bookmarks/toggle",
        headers={"Authorization": f"Bearer {token}"},
        json={"target_type": "tutor", "target_id": test_bookmark_target_id}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if data.get("bookmarked") != True:
        print(f"❌ Expected bookmarked=true, got {data.get('bookmarked')}")
        return False
    
    print(f"✅ First toggle bookmarked successfully")
    
    # Second toggle (unbookmark)
    print("  11b: Second toggle (should unbookmark)")
    response = requests.post(
        f"{BASE_URL}/vocab/bookmarks/toggle",
        headers={"Authorization": f"Bearer {token}"},
        json={"target_type": "tutor", "target_id": test_bookmark_target_id}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if data.get("bookmarked") != False:
        print(f"❌ Expected bookmarked=false, got {data.get('bookmarked')}")
        return False
    
    print(f"✅ Second toggle unbookmarked successfully")
    return True


def test_12_bookmark_status():
    """Test 12: GET /api/vocab/bookmarks/status/{type}/{id} - checks bookmark status"""
    print("\n=== TEST 12: GET /api/vocab/bookmarks/status/tutor/{id} ===")
    
    if not test_bookmark_target_id:
        print("❌ No bookmark target_id available (test 11 must run first)")
        return False
    
    response = requests.get(
        f"{BASE_URL}/vocab/bookmarks/status/tutor/{test_bookmark_target_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if "bookmarked" not in data:
        print(f"❌ Response missing 'bookmarked' field")
        return False
    
    # Should be false after test 11 (toggled twice)
    if data.get("bookmarked") != False:
        print(f"❌ Expected bookmarked=false after test 11, got {data.get('bookmarked')}")
        return False
    
    print(f"✅ Bookmark status returned correctly (bookmarked={data['bookmarked']})")
    return True


def test_13_bookmarks_list():
    """Test 13: GET /api/vocab/me/bookmarks - returns grouped bookmarks"""
    print("\n=== TEST 13: GET /api/vocab/me/bookmarks ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/me/bookmarks",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    required_fields = ["tutors", "words", "lessons"]
    missing_fields = [f for f in required_fields if f not in data]
    
    if missing_fields:
        print(f"❌ Response missing fields: {missing_fields}")
        return False
    
    # Verify all are lists
    for field in required_fields:
        if not isinstance(data[field], list):
            print(f"❌ Field '{field}' is not a list: {type(data[field])}")
            return False
    
    print(f"✅ Bookmarks list returned correctly")
    print(f"   tutors={len(data['tutors'])}, words={len(data['words'])}, lessons={len(data['lessons'])}")
    return True


def test_14_create_booking():
    """Test 14: POST /api/vocab/bookings - creates booking with tutor"""
    global test_tutor_id, test_booking_id
    
    print("\n=== TEST 14: POST /api/vocab/bookings ===")
    
    # First, get a tutor from /api/pro/tutors
    print("  14a: Getting tutor list from /api/pro/tutors")
    response = requests.get(
        f"{BASE_URL}/pro/tutors",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get tutors: {response.status_code} {response.text}")
        return False
    
    tutors = response.json()
    if not tutors or len(tutors) == 0:
        print(f"❌ No tutors available")
        return False
    
    test_tutor_id = tutors[0].get("id")
    print(f"   Using tutor: {tutors[0].get('name')} (id={test_tutor_id})")
    
    # Create booking
    print("  14b: Creating booking")
    response = requests.post(
        f"{BASE_URL}/vocab/bookings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tutor_id": test_tutor_id,
            "slot_iso": "2026-08-20T14:00:00Z",
            "duration_min": 60
        }
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    booking = response.json()
    
    if "_id" not in booking:
        print(f"❌ Booking missing '_id' field")
        return False
    
    test_booking_id = booking["_id"]
    
    print(f"✅ Booking created successfully")
    print(f"   id={test_booking_id}, tutor={booking.get('tutor_name')}, slot=2026-08-20T14:00:00Z")
    return True


def test_15_list_bookings():
    """Test 15: GET /api/vocab/me/bookings - lists bookings"""
    print("\n=== TEST 15: GET /api/vocab/me/bookings ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/me/bookings",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    bookings = response.json()
    
    if not isinstance(bookings, list):
        print(f"❌ Response is not a list: {type(bookings)}")
        return False
    
    # Find the booking we just created
    found = False
    for booking in bookings:
        if booking.get("_id") == test_booking_id:
            found = True
            # Verify enriched with tutor_name
            if "tutor_name" not in booking:
                print(f"❌ Booking missing 'tutor_name' field")
                return False
            print(f"   Found booking: {booking['_id']}, tutor={booking['tutor_name']}")
            break
    
    if not found:
        print(f"❌ Created booking not found in list")
        return False
    
    print(f"✅ Bookings list returned correctly ({len(bookings)} bookings)")
    return True


def test_16_delete_booking():
    """Test 16: DELETE /api/vocab/bookings/{id} - deletes booking"""
    print("\n=== TEST 16: DELETE /api/vocab/bookings/{id} ===")
    
    if not test_booking_id:
        print("❌ No booking_id available (test 14 must run first)")
        return False
    
    # First delete
    print(f"  16a: First delete (should succeed)")
    response = requests.delete(
        f"{BASE_URL}/vocab/bookings/{test_booking_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    if not data.get("ok"):
        print(f"❌ Response missing 'ok: true': {data}")
        return False
    
    print(f"✅ Booking deleted successfully")
    
    # Second delete (should return 404)
    print(f"  16b: Second delete (should return 404)")
    response = requests.delete(
        f"{BASE_URL}/vocab/bookings/{test_booking_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 404:
        print(f"❌ Expected 404, got {response.status_code}")
        return False
    
    print(f"✅ Second delete correctly returns 404")
    return True


def test_17_challenges():
    """Test 17: GET /api/vocab/challenges - returns challenges with progress"""
    print("\n=== TEST 17: GET /api/vocab/challenges ===")
    
    response = requests.get(
        f"{BASE_URL}/vocab/challenges",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    challenges = response.json()
    
    if not isinstance(challenges, list):
        print(f"❌ Response is not a list: {type(challenges)}")
        return False
    
    if len(challenges) == 0:
        print(f"❌ Expected challenges, got empty list")
        return False
    
    # Verify first challenge has required fields
    challenge = challenges[0]
    required_fields = ["id", "title", "days_left", "icon", "goal_type", "target", "current", "progress", "completed"]
    missing_fields = [f for f in required_fields if f not in challenge]
    
    if missing_fields:
        print(f"❌ Challenge missing fields: {missing_fields}")
        return False
    
    # Find words_learned challenge and verify current >= 1 (from test 7)
    words_challenge = None
    for c in challenges:
        if c.get("goal_type") == "words_learned":
            words_challenge = c
            break
    
    if words_challenge:
        if words_challenge.get("current", 0) < 1:
            print(f"❌ Expected words_learned challenge current >= 1 after test 7, got {words_challenge.get('current')}")
            return False
        print(f"   words_learned challenge: current={words_challenge['current']}, target={words_challenge['target']}")
    
    print(f"✅ Challenges returned correctly ({len(challenges)} challenges)")
    print(f"   Sample: {challenge['title']} ({challenge['goal_type']}, {challenge['current']}/{challenge['target']})")
    return True


def test_18_auth_required():
    """Test 18: Verify 401 without token"""
    print("\n=== TEST 18: Auth required (401 without token) ===")
    
    endpoints = [
        "/vocab/topics",
        "/vocab/lessons",
        "/vocab/me/stats",
        "/vocab/challenges"
    ]
    
    all_passed = True
    for endpoint in endpoints:
        response = requests.get(f"{BASE_URL}{endpoint}")
        if response.status_code not in [401, 403]:
            print(f"❌ {endpoint} expected 401/403, got {response.status_code}")
            all_passed = False
        else:
            print(f"   ✅ {endpoint} correctly returns {response.status_code}")
    
    if all_passed:
        print(f"✅ All endpoints require authentication")
    
    return all_passed


def test_19_not_found():
    """Test 19: Verify 404 for non-existent resources"""
    print("\n=== TEST 19: 404 for non-existent resources ===")
    
    # Non-existent topic
    print("  19a: Non-existent topic")
    response = requests.get(
        f"{BASE_URL}/vocab/topics/nonexistent-topic-xyz",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 404:
        print(f"❌ Expected 404, got {response.status_code}")
        return False
    
    print(f"   ✅ Non-existent topic returns 404")
    
    # Non-existent lesson
    print("  19b: Non-existent lesson")
    response = requests.get(
        f"{BASE_URL}/vocab/lessons/nonexistent-lesson-xyz",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 404:
        print(f"❌ Expected 404, got {response.status_code}")
        return False
    
    print(f"   ✅ Non-existent lesson returns 404")
    
    print(f"✅ 404 handling works correctly")
    return True


def main():
    """Run all tests"""
    print("=" * 80)
    print("VOCAB SUB-APP BACKEND TESTING")
    print("=" * 80)
    
    # Setup authentication
    if not test_auth_setup():
        print("\n❌ AUTH SETUP FAILED - Cannot proceed with tests")
        return
    
    # Track results
    results = []
    
    # Run all tests in order
    tests = [
        ("1. GET /api/vocab/topics", test_1_topics_list),
        ("2. GET /api/vocab/topics/medicine", test_2_topic_single),
        ("3. GET /api/vocab/topics/medicine/words", test_3_topic_words),
        ("4. GET /api/vocab/lessons", test_4_lessons_list),
        ("5. GET /api/vocab/lessons?level=Advanced", test_5_lessons_filter),
        ("6. GET /api/vocab/lessons/pharmacy-basics", test_6_lesson_detail),
        ("7. POST /api/vocab/progress/word", test_7_word_progress),
        ("8. POST /api/vocab/lessons/{id}/complete", test_8_lesson_complete),
        ("9. GET /api/vocab/me/stats", test_9_me_stats),
        ("10. GET /api/vocab/me/continue", test_10_me_continue),
        ("11. POST /api/vocab/bookmarks/toggle", test_11_bookmark_toggle),
        ("12. GET /api/vocab/bookmarks/status/{type}/{id}", test_12_bookmark_status),
        ("13. GET /api/vocab/me/bookmarks", test_13_bookmarks_list),
        ("14. POST /api/vocab/bookings", test_14_create_booking),
        ("15. GET /api/vocab/me/bookings", test_15_list_bookings),
        ("16. DELETE /api/vocab/bookings/{id}", test_16_delete_booking),
        ("17. GET /api/vocab/challenges", test_17_challenges),
        ("18. Auth required (401 without token)", test_18_auth_required),
        ("19. 404 for non-existent resources", test_19_not_found),
    ]
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ Test crashed: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")


if __name__ == "__main__":
    main()
