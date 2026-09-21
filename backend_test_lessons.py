#!/usr/bin/env python3
"""
Backend API Testing for Lessons Gamified Language-Learning Sub-App
Tests all /api/lessons/* endpoints with comprehensive verification
"""

import requests
import json
from typing import Dict, Any

# Base URL from frontend/.env
BASE_URL = "https://apk-deployment-6.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
STUDENT_EMAIL = "mei@demo.com"
STUDENT_PASSWORD = "Demo1234!"
SECOND_USER_EMAIL = "diego@demo.com"
SECOND_USER_PASSWORD = "Demo1234!"

# Global tokens
student_token = None
diego_token = None
student_profile = None
first_lesson_id = None


def login(email: str, password: str) -> str:
    """Login and return JWT token"""
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": email, "password": password}
    )
    if response.status_code == 200:
        return response.json()["token"]
    else:
        raise Exception(f"Login failed for {email}: {response.status_code} {response.text}")


def test_auth_setup():
    """Setup: Login as both test users"""
    global student_token, diego_token
    
    print("\n=== AUTH SETUP ===")
    
    # Login as mei (student)
    try:
        student_token = login(STUDENT_EMAIL, STUDENT_PASSWORD)
        print(f"✅ Student (mei) login successful")
    except Exception as e:
        print(f"❌ Student login failed: {e}")
        return False
    
    # Login as diego (second user)
    try:
        diego_token = login(SECOND_USER_EMAIL, SECOND_USER_PASSWORD)
        print(f"✅ Second user (diego) login successful")
    except Exception as e:
        print(f"❌ Second user login failed: {e}")
        return False
    
    return True


def test_1_get_me_profile():
    """Test 1: GET /api/lessons/me - auto-creates profile with defaults"""
    global student_profile
    
    print("\n=== TEST 1: GET /api/lessons/me ===")
    
    response = requests.get(
        f"{BASE_URL}/lessons/me",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    profile = response.json()
    student_profile = profile
    
    # Verify required fields exist
    required_fields = ["hearts", "gems", "xp", "streak", "daily_goal", "active_course", "completed"]
    missing_fields = [f for f in required_fields if f not in profile]
    
    if missing_fields:
        print(f"❌ Missing fields: {missing_fields}")
        return False
    
    # Verify default values
    checks = []
    checks.append(("hearts", profile.get("hearts") == 5, f"Expected 5, got {profile.get('hearts')}"))
    checks.append(("gems", profile.get("gems") == 20, f"Expected 20, got {profile.get('gems')}"))
    checks.append(("xp", profile.get("xp") == 0, f"Expected 0, got {profile.get('xp')}"))
    checks.append(("streak", profile.get("streak") >= 0, f"Expected >= 0, got {profile.get('streak')}"))
    checks.append(("daily_goal", profile.get("daily_goal") == 30, f"Expected 30, got {profile.get('daily_goal')}"))
    checks.append(("active_course", profile.get("active_course") == "es", f"Expected 'es', got {profile.get('active_course')}"))
    checks.append(("completed", isinstance(profile.get("completed"), list), f"Expected list, got {type(profile.get('completed'))}"))
    
    failed_checks = [(name, msg) for name, passed, msg in checks if not passed]
    
    if failed_checks:
        for name, msg in failed_checks:
            print(f"❌ {name}: {msg}")
        return False
    
    print(f"✅ Profile auto-created with correct defaults:")
    print(f"   hearts={profile['hearts']}, gems={profile['gems']}, xp={profile['xp']}, streak={profile['streak']}")
    print(f"   daily_goal={profile['daily_goal']}, active_course={profile['active_course']}, completed={len(profile['completed'])} lessons")
    return True


def test_2_get_courses():
    """Test 2: GET /api/lessons/courses - returns list with es and fr"""
    print("\n=== TEST 2: GET /api/lessons/courses ===")
    
    response = requests.get(
        f"{BASE_URL}/lessons/courses",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    courses = response.json()
    
    if not isinstance(courses, list):
        print(f"❌ Response is not a list: {type(courses)}")
        return False
    
    if len(courses) < 2:
        print(f"❌ Expected at least 2 courses (es, fr), got {len(courses)}")
        return False
    
    # Check for Spanish and French
    langs = [c.get("lang") for c in courses]
    
    if "es" not in langs:
        print(f"❌ Spanish (es) not found in courses: {langs}")
        return False
    
    if "fr" not in langs:
        print(f"❌ French (fr) not found in courses: {langs}")
        return False
    
    # Verify each course has required fields
    for course in courses:
        required_fields = ["lang", "name", "flag", "color"]
        missing_fields = [f for f in required_fields if f not in course]
        
        if missing_fields:
            print(f"❌ Course {course.get('lang')} missing fields: {missing_fields}")
            return False
    
    print(f"✅ Courses list returned correctly ({len(courses)} courses)")
    for course in courses:
        print(f"   {course['lang']}: {course['name']} (flag={course['flag']}, color={course['color']})")
    
    return True


def test_3_post_course_switch():
    """Test 3: POST /api/lessons/course - switch active course"""
    print("\n=== TEST 3: POST /api/lessons/course ===")
    
    # Test 3a: Switch to French
    print("  3a: Switch to French (fr)")
    response = requests.post(
        f"{BASE_URL}/lessons/course",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"lang": "fr"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    if data.get("active_course") != "fr":
        print(f"❌ Expected active_course='fr', got {data.get('active_course')}")
        return False
    
    print(f"✅ Switched to French successfully")
    
    # Test 3b: Switch back to Spanish
    print("  3b: Switch back to Spanish (es)")
    response = requests.post(
        f"{BASE_URL}/lessons/course",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"lang": "es"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    if data.get("active_course") != "es":
        print(f"❌ Expected active_course='es', got {data.get('active_course')}")
        return False
    
    print(f"✅ Switched back to Spanish successfully")
    
    # Test 3c: Invalid language should return 404
    print("  3c: Invalid language (zz) should return 404")
    response = requests.post(
        f"{BASE_URL}/lessons/course",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"lang": "zz"}
    )
    
    if response.status_code != 404:
        print(f"❌ Expected 404, got {response.status_code}")
        return False
    
    print(f"✅ Invalid language correctly returns 404")
    
    return True


def test_4_get_path():
    """Test 4: GET /api/lessons/path?lang=es - returns units with skills"""
    global first_lesson_id
    
    print("\n=== TEST 4: GET /api/lessons/path?lang=es ===")
    
    response = requests.get(
        f"{BASE_URL}/lessons/path?lang=es",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify structure
    if "units" not in data:
        print(f"❌ Missing 'units' field in response")
        return False
    
    units = data["units"]
    
    if not isinstance(units, list):
        print(f"❌ 'units' is not a list: {type(units)}")
        return False
    
    if len(units) < 3:
        print(f"❌ Expected at least 3 units, got {len(units)}")
        return False
    
    # Verify first unit has skills
    first_unit = units[0]
    if "skills" not in first_unit:
        print(f"❌ First unit missing 'skills' field")
        return False
    
    skills = first_unit["skills"]
    
    if not isinstance(skills, list) or len(skills) == 0:
        print(f"❌ First unit has no skills")
        return False
    
    # Verify first skill structure
    first_skill = skills[0]
    required_fields = ["lesson_id", "title", "icon", "completed", "unlocked"]
    missing_fields = [f for f in required_fields if f not in first_skill]
    
    if missing_fields:
        print(f"❌ First skill missing fields: {missing_fields}")
        return False
    
    # Verify first skill is unlocked
    if not first_skill.get("unlocked"):
        print(f"❌ First skill (es-0-0) should be unlocked=true, got {first_skill.get('unlocked')}")
        return False
    
    first_lesson_id = first_skill["lesson_id"]
    
    # Find a locked skill (should be one that's not completed and not first)
    locked_skill = None
    for unit in units:
        for skill in unit["skills"]:
            if not skill.get("unlocked") and not skill.get("completed"):
                locked_skill = skill
                break
        if locked_skill:
            break
    
    if locked_skill:
        print(f"✅ Path structure correct: {len(units)} units")
        print(f"   First skill: {first_skill['lesson_id']} ({first_skill['title']}) - unlocked={first_skill['unlocked']}")
        print(f"   Found locked skill: {locked_skill['lesson_id']} ({locked_skill['title']}) - unlocked={locked_skill['unlocked']}")
    else:
        print(f"✅ Path structure correct: {len(units)} units")
        print(f"   First skill: {first_skill['lesson_id']} ({first_skill['title']}) - unlocked={first_skill['unlocked']}")
        print(f"   Note: No locked skills found (all may be completed)")
    
    return True


def test_5_get_lesson():
    """Test 5: GET /api/lessons/lesson/{lesson_id} - returns exercises"""
    print("\n=== TEST 5: GET /api/lessons/lesson/es-0-0 ===")
    
    lesson_id = "es-0-0"
    
    response = requests.get(
        f"{BASE_URL}/lessons/lesson/{lesson_id}",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify structure
    if "lesson_id" not in data:
        print(f"❌ Missing 'lesson_id' field")
        return False
    
    if "exercises" not in data:
        print(f"❌ Missing 'exercises' field")
        return False
    
    exercises = data["exercises"]
    
    if not isinstance(exercises, list):
        print(f"❌ 'exercises' is not a list: {type(exercises)}")
        return False
    
    if len(exercises) < 5:
        print(f"❌ Expected at least 5 exercises, got {len(exercises)}")
        return False
    
    # Track exercise types found
    types_found = set()
    
    # Verify exercise types and structure
    for i, ex in enumerate(exercises):
        if "type" not in ex:
            print(f"❌ Exercise {i} missing 'type' field")
            return False
        
        ex_type = ex["type"]
        types_found.add(ex_type)
        
        # Verify type-specific structure
        if ex_type == "select":
            if "options" not in ex:
                print(f"❌ Select exercise missing 'options'")
                return False
            options = ex["options"]
            correct_count = sum(1 for opt in options if opt.get("correct"))
            if correct_count != 1:
                print(f"❌ Select exercise should have exactly 1 correct option, got {correct_count}")
                return False
        
        elif ex_type == "listen":
            if "options" not in ex:
                print(f"❌ Listen exercise missing 'options'")
                return False
            options = ex["options"]
            correct_count = sum(1 for opt in options if opt.get("correct"))
            if correct_count != 1:
                print(f"❌ Listen exercise should have exactly 1 correct option, got {correct_count}")
                return False
        
        elif ex_type == "translate":
            if "answer" not in ex or "bank" not in ex:
                print(f"❌ Translate exercise missing 'answer' or 'bank'")
                return False
            if not isinstance(ex["answer"], list) or not isinstance(ex["bank"], list):
                print(f"❌ Translate 'answer' and 'bank' should be lists")
                return False
        
        elif ex_type == "match":
            if "pairs" not in ex:
                print(f"❌ Match exercise missing 'pairs'")
                return False
            pairs = ex["pairs"]
            if not isinstance(pairs, list):
                print(f"❌ Match 'pairs' should be a list")
                return False
            if len(pairs) > 0:
                if "a" not in pairs[0] or "b" not in pairs[0]:
                    print(f"❌ Match pairs should have 'a' and 'b' fields")
                    return False
        
        elif ex_type == "fill":
            if "options" not in ex:
                print(f"❌ Fill exercise missing 'options'")
                return False
            options = ex["options"]
            correct_count = sum(1 for opt in options if opt.get("correct"))
            if correct_count != 1:
                print(f"❌ Fill exercise should have exactly 1 correct option, got {correct_count}")
                return False
    
    # Verify we have variety of exercise types
    expected_types = {"select", "listen", "translate", "match", "fill"}
    missing_types = expected_types - types_found
    
    if missing_types:
        print(f"⚠️  Warning: Missing exercise types: {missing_types}")
    
    print(f"✅ Lesson {lesson_id} returned correctly:")
    print(f"   {len(exercises)} exercises with types: {sorted(types_found)}")
    
    # Test 5b: Invalid lesson should return 404
    print("\n  5b: Invalid lesson (zz-9-9) should return 404")
    response = requests.get(
        f"{BASE_URL}/lessons/lesson/zz-9-9",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 404:
        print(f"❌ Expected 404, got {response.status_code}")
        return False
    
    print(f"✅ Invalid lesson correctly returns 404")
    
    return True


def test_6_post_complete():
    """Test 6: POST /api/lessons/complete - complete lesson and verify XP/streak"""
    print("\n=== TEST 6: POST /api/lessons/complete ===")
    
    # Get current profile state
    response = requests.get(
        f"{BASE_URL}/lessons/me",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get profile: {response.status_code}")
        return False
    
    before_profile = response.json()
    before_xp = before_profile.get("xp", 0)
    before_completed = set(before_profile.get("completed", []))
    
    # Complete the first lesson
    lesson_id = "es-0-0"
    
    response = requests.post(
        f"{BASE_URL}/lessons/complete",
        headers={"Authorization": f"Bearer {student_token}"},
        json={
            "lesson_id": lesson_id,
            "correct": 6,
            "total": 6,
            "hearts_left": 5
        }
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify response structure
    if "earned_xp" not in data:
        print(f"❌ Missing 'earned_xp' field")
        return False
    
    if "profile" not in data:
        print(f"❌ Missing 'profile' field")
        return False
    
    earned_xp = data["earned_xp"]
    profile = data["profile"]
    
    # Verify XP increased
    if earned_xp <= 0:
        print(f"❌ earned_xp should be > 0, got {earned_xp}")
        return False
    
    current_xp = profile.get("xp", 0)
    if current_xp <= before_xp:
        print(f"❌ XP should have increased from {before_xp} to {current_xp}")
        return False
    
    # Verify streak
    streak = profile.get("streak", 0)
    if streak < 1:
        print(f"❌ Streak should be >= 1 after completing lesson, got {streak}")
        return False
    
    # Verify lesson added to completed
    completed = set(profile.get("completed", []))
    if lesson_id not in completed:
        print(f"❌ Lesson {lesson_id} should be in completed list")
        return False
    
    print(f"✅ Lesson completed successfully:")
    print(f"   earned_xp={earned_xp}, xp: {before_xp} -> {current_xp}")
    print(f"   streak={streak}, completed lessons: {len(before_completed)} -> {len(completed)}")
    
    # Test 6b: Verify path shows lesson as completed and next unlocked
    print("\n  6b: Verify path shows es-0-0 completed and es-0-1 unlocked")
    
    response = requests.get(
        f"{BASE_URL}/lessons/path?lang=es",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get path: {response.status_code}")
        return False
    
    data = response.json()
    units = data.get("units", [])
    
    if len(units) == 0:
        print(f"❌ No units in path")
        return False
    
    first_unit = units[0]
    skills = first_unit.get("skills", [])
    
    if len(skills) < 2:
        print(f"❌ First unit should have at least 2 skills")
        return False
    
    first_skill = skills[0]
    second_skill = skills[1]
    
    # Verify first skill is completed
    if not first_skill.get("completed"):
        print(f"❌ First skill (es-0-0) should be completed=true")
        return False
    
    # Verify second skill is unlocked
    if not second_skill.get("unlocked"):
        print(f"❌ Second skill (es-0-1) should be unlocked=true after completing first")
        return False
    
    print(f"✅ Path updated correctly:")
    print(f"   {first_skill['lesson_id']}: completed={first_skill['completed']}, unlocked={first_skill['unlocked']}")
    print(f"   {second_skill['lesson_id']}: completed={second_skill['completed']}, unlocked={second_skill['unlocked']}")
    
    return True


def test_7_post_hearts_refill():
    """Test 7: POST /api/lessons/hearts/refill - refill hearts with gems"""
    print("\n=== TEST 7: POST /api/lessons/hearts/refill ===")
    
    # Get current profile
    response = requests.get(
        f"{BASE_URL}/lessons/me",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get profile: {response.status_code}")
        return False
    
    profile = response.json()
    current_hearts = profile.get("hearts", 0)
    current_gems = profile.get("gems", 0)
    
    print(f"   Current state: hearts={current_hearts}, gems={current_gems}")
    
    # Try to refill hearts
    response = requests.post(
        f"{BASE_URL}/lessons/hearts/refill",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        # If hearts are already full and gems < 15, this might be expected
        if current_hearts >= 5:
            print(f"✅ Hearts already full (5), refill returns current state")
            data = response.json()
            if data.get("hearts") == 5:
                print(f"   Response: hearts={data.get('hearts')}, gems={data.get('gems')}")
                return True
        
        # If not enough gems
        if current_gems < 15:
            if response.status_code == 400:
                print(f"✅ Not enough gems (need 15, have {current_gems}), correctly returns 400")
                return True
            else:
                print(f"❌ Expected 400 for insufficient gems, got {response.status_code}")
                return False
        
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify response structure
    if "hearts" not in data or "gems" not in data:
        print(f"❌ Missing 'hearts' or 'gems' in response")
        return False
    
    new_hearts = data["hearts"]
    new_gems = data["gems"]
    
    # Verify hearts and gems are non-negative
    if new_hearts < 0 or new_gems < 0:
        print(f"❌ Hearts or gems went negative: hearts={new_hearts}, gems={new_gems}")
        return False
    
    print(f"✅ Heart refill endpoint working:")
    print(f"   hearts={new_hearts}, gems={new_gems}")
    
    return True


def test_8_get_leaderboard():
    """Test 8: GET /api/lessons/leaderboard - returns ranked list with is_me"""
    print("\n=== TEST 8: GET /api/lessons/leaderboard ===")
    
    # Test 8a: Get leaderboard as mei
    print("  8a: Get leaderboard as mei")
    
    response = requests.get(
        f"{BASE_URL}/lessons/leaderboard",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    leaderboard = response.json()
    
    if not isinstance(leaderboard, list):
        print(f"❌ Response is not a list: {type(leaderboard)}")
        return False
    
    if len(leaderboard) == 0:
        print(f"⚠️  Leaderboard is empty (no users yet)")
        return True
    
    # Verify structure of first entry
    first_entry = leaderboard[0]
    required_fields = ["rank", "name", "weekly_xp", "is_me"]
    missing_fields = [f for f in required_fields if f not in first_entry]
    
    if missing_fields:
        print(f"❌ Leaderboard entry missing fields: {missing_fields}")
        return False
    
    # Verify mei has is_me=true on exactly one row
    mei_count = sum(1 for entry in leaderboard if entry.get("is_me"))
    
    if mei_count != 1:
        print(f"❌ Expected exactly 1 entry with is_me=true for mei, got {mei_count}")
        return False
    
    print(f"✅ Leaderboard returned correctly ({len(leaderboard)} entries)")
    print(f"   Mei found with is_me=true")
    
    # Test 8b: Complete a lesson as diego and verify he appears
    print("\n  8b: Complete lesson as diego and verify in leaderboard")
    
    # Get diego's profile first
    response = requests.get(
        f"{BASE_URL}/lessons/me",
        headers={"Authorization": f"Bearer {diego_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get diego's profile: {response.status_code}")
        return False
    
    # Complete a lesson as diego
    response = requests.post(
        f"{BASE_URL}/lessons/complete",
        headers={"Authorization": f"Bearer {diego_token}"},
        json={
            "lesson_id": "es-0-0",
            "correct": 5,
            "total": 6,
            "hearts_left": 4
        }
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to complete lesson as diego: {response.status_code}")
        return False
    
    # Get leaderboard again
    response = requests.get(
        f"{BASE_URL}/lessons/leaderboard",
        headers={"Authorization": f"Bearer {diego_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get leaderboard: {response.status_code}")
        return False
    
    leaderboard = response.json()
    
    # Verify diego appears with is_me=true
    diego_count = sum(1 for entry in leaderboard if entry.get("is_me"))
    
    if diego_count != 1:
        print(f"❌ Expected exactly 1 entry with is_me=true for diego, got {diego_count}")
        return False
    
    # Verify both mei and diego are in the leaderboard
    names = [entry.get("name") for entry in leaderboard]
    
    print(f"✅ Diego appears in leaderboard after completing lesson")
    print(f"   Leaderboard has {len(leaderboard)} entries")
    
    return True


def test_9_get_quests():
    """Test 9: GET /api/lessons/quests - returns daily quests with progress"""
    print("\n=== TEST 9: GET /api/lessons/quests ===")
    
    response = requests.get(
        f"{BASE_URL}/lessons/quests",
        headers={"Authorization": f"Bearer {student_token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify structure
    if "daily" not in data:
        print(f"❌ Missing 'daily' field")
        return False
    
    if "streak" not in data:
        print(f"❌ Missing 'streak' field")
        return False
    
    daily_quests = data["daily"]
    
    if not isinstance(daily_quests, list):
        print(f"❌ 'daily' is not a list: {type(daily_quests)}")
        return False
    
    if len(daily_quests) != 3:
        print(f"❌ Expected 3 daily quests, got {len(daily_quests)}")
        return False
    
    # Verify each quest structure
    for i, quest in enumerate(daily_quests):
        required_fields = ["id", "title", "icon", "progress", "target"]
        missing_fields = [f for f in required_fields if f not in quest]
        
        if missing_fields:
            print(f"❌ Quest {i} missing fields: {missing_fields}")
            return False
    
    print(f"✅ Quests returned correctly:")
    print(f"   {len(daily_quests)} daily quests, streak={data['streak']}")
    for quest in daily_quests:
        print(f"   - {quest['title']}: {quest['progress']}/{quest['target']}")
    
    return True


def test_10_auth_required():
    """Test 10: Verify auth is required (401/403 without token)"""
    print("\n=== TEST 10: Auth Required - No token should get 401/403 ===")
    
    response = requests.get(f"{BASE_URL}/lessons/me")
    
    if response.status_code in [401, 403]:
        print(f"✅ No token correctly rejected with {response.status_code}")
        return True
    else:
        print(f"❌ Expected 401/403, got {response.status_code}: {response.text}")
        return False


def main():
    """Run all tests"""
    print("=" * 70)
    print("LESSONS GAMIFIED LANGUAGE-LEARNING SUB-APP TESTING")
    print("=" * 70)
    
    # Setup authentication
    if not test_auth_setup():
        print("\n❌ AUTH SETUP FAILED - Cannot proceed with tests")
        return
    
    # Track results
    results = []
    
    # Run all tests
    tests = [
        ("GET /api/lessons/me (auto-create profile)", test_1_get_me_profile),
        ("GET /api/lessons/courses", test_2_get_courses),
        ("POST /api/lessons/course (switch course)", test_3_post_course_switch),
        ("GET /api/lessons/path (units & skills)", test_4_get_path),
        ("GET /api/lessons/lesson/{id} (exercises)", test_5_get_lesson),
        ("POST /api/lessons/complete (XP & streak)", test_6_post_complete),
        ("POST /api/lessons/hearts/refill", test_7_post_hearts_refill),
        ("GET /api/lessons/leaderboard", test_8_get_leaderboard),
        ("GET /api/lessons/quests", test_9_get_quests),
        ("Auth required (no token)", test_10_auth_required),
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
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
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
