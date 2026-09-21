#!/usr/bin/env python3
"""
Backend API Testing for Twitter-style Threaded Comments
Tests all /api/moments/* endpoints for threaded comments functionality
"""

import requests
import json
from typing import Dict, Any

# Base URL from frontend/.env
BASE_URL = "https://apk-deployment-6.preview.emergentagent.com/api"

# Test credentials
TEST_EMAIL = "mei@demo.com"
TEST_PASSWORD = "Demo1234!"

# Global variables
token = None
moment_id = None
comment_a_id = None
reply_1_id = None
reply_to_reply_id = None
comment_b_id = None


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


def test_setup():
    """Setup: Login and create a test moment"""
    global token, moment_id
    
    print("\n" + "="*80)
    print("SETUP: Login and Create Test Moment")
    print("="*80)
    
    # Login
    try:
        token = login(TEST_EMAIL, TEST_PASSWORD)
        print(f"✅ Login successful as {TEST_EMAIL}")
    except Exception as e:
        print(f"❌ Login failed: {e}")
        return False
    
    # Create a test moment
    response = requests.post(
        f"{BASE_URL}/moments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Threaded comments test"}
    )
    
    if response.status_code == 201:
        data = response.json()
        moment_id = data.get("id")
        print(f"✅ Test moment created with ID: {moment_id}")
        return True
    else:
        print(f"❌ Failed to create moment: {response.status_code} {response.text}")
        return False


def test_1_root_comment_a():
    """Test 1: POST root comment A"""
    global comment_a_id
    
    print("\n" + "="*80)
    print("TEST 1: POST Root Comment A")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Root comment A"}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    comment_a_id = data.get("id")
    
    # Verify required fields
    checks = [
        ("id", data.get("id") is not None, f"Expected id, got: {data.get('id')}"),
        ("root_id", data.get("root_id") is None, f"Expected root_id to be null for root comment, got: {data.get('root_id')}"),
        ("like_count", data.get("like_count") == 0, f"Expected like_count=0, got: {data.get('like_count')}"),
        ("liked_by_me", data.get("liked_by_me") == False, f"Expected liked_by_me=false, got: {data.get('liked_by_me')}"),
        ("reply_count", data.get("reply_count") == 0, f"Expected reply_count=0, got: {data.get('reply_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    if all_passed:
        print(f"✅ TEST 1 PASSED - Root comment A created: {comment_a_id}")
    else:
        print(f"❌ TEST 1 FAILED")
    
    return all_passed


def test_2_reply_1_to_a():
    """Test 2: POST reply 1 to comment A"""
    global reply_1_id
    
    print("\n" + "="*80)
    print("TEST 2: POST Reply 1 to Comment A")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Reply 1 to A", "reply_to": comment_a_id}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    reply_1_id = data.get("id")
    
    # Verify required fields
    checks = [
        ("id", data.get("id") is not None, f"Expected id, got: {data.get('id')}"),
        ("reply_to", data.get("reply_to") == comment_a_id, f"Expected reply_to={comment_a_id}, got: {data.get('reply_to')}"),
        ("root_id", data.get("root_id") == comment_a_id, f"Expected root_id={comment_a_id}, got: {data.get('root_id')}"),
        ("like_count", data.get("like_count") == 0, f"Expected like_count=0, got: {data.get('like_count')}"),
        ("liked_by_me", data.get("liked_by_me") == False, f"Expected liked_by_me=false, got: {data.get('liked_by_me')}"),
        ("reply_count", data.get("reply_count") == 0, f"Expected reply_count=0, got: {data.get('reply_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    if all_passed:
        print(f"✅ TEST 2 PASSED - Reply 1 created: {reply_1_id}")
    else:
        print(f"❌ TEST 2 FAILED")
    
    return all_passed


def test_3_reply_to_reply_1():
    """Test 3: POST reply to reply 1 (grandchild)"""
    global reply_to_reply_id
    
    print("\n" + "="*80)
    print("TEST 3: POST Reply to Reply 1 (Grandchild)")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Reply to Reply 1", "reply_to": reply_1_id}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    reply_to_reply_id = data.get("id")
    
    # Verify required fields - root_id should inherit from parent (comment_a_id)
    checks = [
        ("id", data.get("id") is not None, f"Expected id, got: {data.get('id')}"),
        ("reply_to", data.get("reply_to") == reply_1_id, f"Expected reply_to={reply_1_id}, got: {data.get('reply_to')}"),
        ("root_id", data.get("root_id") == comment_a_id, f"Expected root_id={comment_a_id} (inherited), got: {data.get('root_id')}"),
        ("like_count", data.get("like_count") == 0, f"Expected like_count=0, got: {data.get('like_count')}"),
        ("liked_by_me", data.get("liked_by_me") == False, f"Expected liked_by_me=false, got: {data.get('liked_by_me')}"),
        ("reply_count", data.get("reply_count") == 0, f"Expected reply_count=0, got: {data.get('reply_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    if all_passed:
        print(f"✅ TEST 3 PASSED - Reply to Reply 1 created: {reply_to_reply_id}")
    else:
        print(f"❌ TEST 3 FAILED")
    
    return all_passed


def test_4_root_comment_b():
    """Test 4: POST root comment B"""
    global comment_b_id
    
    print("\n" + "="*80)
    print("TEST 4: POST Root Comment B")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Root comment B"}
    )
    
    if response.status_code != 201:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    comment_b_id = data.get("id")
    
    # Verify required fields
    checks = [
        ("id", data.get("id") is not None, f"Expected id, got: {data.get('id')}"),
        ("root_id", data.get("root_id") is None, f"Expected root_id to be null for root comment, got: {data.get('root_id')}"),
        ("like_count", data.get("like_count") == 0, f"Expected like_count=0, got: {data.get('like_count')}"),
        ("liked_by_me", data.get("liked_by_me") == False, f"Expected liked_by_me=false, got: {data.get('liked_by_me')}"),
        ("reply_count", data.get("reply_count") == 0, f"Expected reply_count=0, got: {data.get('reply_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    if all_passed:
        print(f"✅ TEST 4 PASSED - Root comment B created: {comment_b_id}")
    else:
        print(f"❌ TEST 4 FAILED")
    
    return all_passed


def test_5_get_moment_verify_reply_counts():
    """Test 5: GET moment and verify reply_count rollup"""
    print("\n" + "="*80)
    print("TEST 5: GET Moment and Verify Reply Counts")
    print("="*80)
    
    response = requests.get(
        f"{BASE_URL}/moments/{moment_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    comments = data.get("comments", [])
    
    if not comments:
        print(f"❌ No comments found in response")
        return False
    
    print(f"  Found {len(comments)} comments")
    
    # Find comment A and verify reply_count = 2 (1 direct reply + 1 grandchild)
    comment_a = next((c for c in comments if c["id"] == comment_a_id), None)
    if not comment_a:
        print(f"❌ Comment A not found in comments array")
        return False
    
    # Find reply 1 and verify reply_count = 1 (1 direct reply)
    reply_1 = next((c for c in comments if c["id"] == reply_1_id), None)
    if not reply_1:
        print(f"❌ Reply 1 not found in comments array")
        return False
    
    # Verify all comments have required fields
    all_passed = True
    
    # Check Comment A
    print(f"\n  Comment A (root):")
    if comment_a.get("reply_count") == 2:
        print(f"    ✅ reply_count: {comment_a.get('reply_count')} (1 direct + 1 grandchild)")
    else:
        print(f"    ❌ Expected reply_count=2, got: {comment_a.get('reply_count')}")
        all_passed = False
    
    for field in ["like_count", "liked_by_me", "root_id"]:
        if field in comment_a:
            print(f"    ✅ {field}: {comment_a.get(field)}")
        else:
            print(f"    ❌ Missing field: {field}")
            all_passed = False
    
    # Check Reply 1
    print(f"\n  Reply 1 (to Comment A):")
    if reply_1.get("reply_count") == 1:
        print(f"    ✅ reply_count: {reply_1.get('reply_count')} (1 direct reply)")
    else:
        print(f"    ❌ Expected reply_count=1, got: {reply_1.get('reply_count')}")
        all_passed = False
    
    for field in ["like_count", "liked_by_me", "root_id"]:
        if field in reply_1:
            print(f"    ✅ {field}: {reply_1.get(field)}")
        else:
            print(f"    ❌ Missing field: {field}")
            all_passed = False
    
    if all_passed:
        print(f"\n✅ TEST 5 PASSED - Reply counts correctly rolled up")
    else:
        print(f"\n❌ TEST 5 FAILED")
    
    return all_passed


def test_6_like_comment_a():
    """Test 6: POST like on comment A"""
    print("\n" + "="*80)
    print("TEST 6: POST Like on Comment A")
    print("="*80)
    
    # Like comment A
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments/{comment_a_id}/like",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify response
    checks = [
        ("liked", data.get("liked") == True, f"Expected liked=true, got: {data.get('liked')}"),
        ("like_count", data.get("like_count") == 1, f"Expected like_count=1, got: {data.get('like_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    # Immediately re-GET the moment to verify persistence
    print(f"\n  Re-fetching moment to verify like persistence...")
    response = requests.get(
        f"{BASE_URL}/moments/{moment_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"  ❌ Failed to re-fetch moment: {response.status_code}")
        return False
    
    moment_data = response.json()
    comments = moment_data.get("comments", [])
    comment_a = next((c for c in comments if c["id"] == comment_a_id), None)
    
    if not comment_a:
        print(f"  ❌ Comment A not found in re-fetched moment")
        return False
    
    # Verify like_count and liked_by_me
    if comment_a.get("like_count") == 1:
        print(f"  ✅ like_count persisted: {comment_a.get('like_count')}")
    else:
        print(f"  ❌ Expected like_count=1, got: {comment_a.get('like_count')}")
        all_passed = False
    
    if comment_a.get("liked_by_me") == True:
        print(f"  ✅ liked_by_me persisted: {comment_a.get('liked_by_me')}")
    else:
        print(f"  ❌ Expected liked_by_me=true, got: {comment_a.get('liked_by_me')}")
        all_passed = False
    
    if all_passed:
        print(f"\n✅ TEST 6 PASSED - Like on comment A works and persists")
    else:
        print(f"\n❌ TEST 6 FAILED")
    
    return all_passed


def test_7_unlike_comment_a():
    """Test 7: POST like again to toggle unlike"""
    print("\n" + "="*80)
    print("TEST 7: POST Like Again to Toggle Unlike")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments/{comment_a_id}/like",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code != 200:
        print(f"❌ Failed with status {response.status_code}: {response.text}")
        return False
    
    data = response.json()
    
    # Verify response - should toggle to unliked
    checks = [
        ("liked", data.get("liked") == False, f"Expected liked=false, got: {data.get('liked')}"),
        ("like_count", data.get("like_count") == 0, f"Expected like_count=0, got: {data.get('like_count')}"),
    ]
    
    all_passed = True
    for check_name, condition, error_msg in checks:
        if condition:
            print(f"  ✅ {check_name}: {data.get(check_name)}")
        else:
            print(f"  ❌ {error_msg}")
            all_passed = False
    
    if all_passed:
        print(f"✅ TEST 7 PASSED - Unlike toggle works correctly")
    else:
        print(f"❌ TEST 7 FAILED")
    
    return all_passed


def test_8_like_nonexistent_comment():
    """Test 8: POST like on nonexistent comment (should return 404)"""
    print("\n" + "="*80)
    print("TEST 8: POST Like on Nonexistent Comment")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments/nonexistent_id/like",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 404:
        print(f"✅ TEST 8 PASSED - Correctly returned 404 for nonexistent comment")
        return True
    else:
        print(f"❌ TEST 8 FAILED - Expected 404, got: {response.status_code}")
        return False


def test_9_reply_to_nonexistent_comment():
    """Test 9: POST comment with nonexistent reply_to (should return 404)"""
    print("\n" + "="*80)
    print("TEST 9: POST Comment with Nonexistent reply_to")
    print("="*80)
    
    response = requests.post(
        f"{BASE_URL}/moments/{moment_id}/comments",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "should fail", "reply_to": "nonexistent"}
    )
    
    if response.status_code == 404:
        print(f"✅ TEST 9 PASSED - Correctly returned 404 for nonexistent reply_to")
        return True
    else:
        print(f"❌ TEST 9 FAILED - Expected 404, got: {response.status_code}")
        return False


def test_10_auth_required():
    """Test 10: Verify all endpoints require Bearer token (401 without it)"""
    print("\n" + "="*80)
    print("TEST 10: Verify Auth Required (401 without token)")
    print("="*80)
    
    endpoints = [
        ("POST /moments", "post", f"{BASE_URL}/moments", {"text": "test"}),
        ("GET /moments/{id}", "get", f"{BASE_URL}/moments/{moment_id}", None),
        ("POST /moments/{id}/comments", "post", f"{BASE_URL}/moments/{moment_id}/comments", {"text": "test"}),
        ("POST /moments/{id}/comments/{cid}/like", "post", f"{BASE_URL}/moments/{moment_id}/comments/{comment_a_id}/like", None),
    ]
    
    all_passed = True
    for name, method, url, json_data in endpoints:
        if method == "get":
            response = requests.get(url)
        else:
            response = requests.post(url, json=json_data)
        
        if response.status_code == 401:
            print(f"  ✅ {name}: 401 (auth required)")
        else:
            print(f"  ❌ {name}: Expected 401, got {response.status_code}")
            all_passed = False
    
    if all_passed:
        print(f"\n✅ TEST 10 PASSED - All endpoints require authentication")
    else:
        print(f"\n❌ TEST 10 FAILED")
    
    return all_passed


def run_all_tests():
    """Run all tests in sequence"""
    print("\n" + "="*80)
    print("TWITTER-STYLE THREADED COMMENTS BACKEND TESTING")
    print("="*80)
    
    results = []
    
    # Setup
    if not test_setup():
        print("\n❌ SETUP FAILED - Cannot continue with tests")
        return
    
    # Run all tests
    results.append(("Test 1: Root Comment A", test_1_root_comment_a()))
    results.append(("Test 2: Reply 1 to A", test_2_reply_1_to_a()))
    results.append(("Test 3: Reply to Reply 1", test_3_reply_to_reply_1()))
    results.append(("Test 4: Root Comment B", test_4_root_comment_b()))
    results.append(("Test 5: GET Moment - Verify Reply Counts", test_5_get_moment_verify_reply_counts()))
    results.append(("Test 6: Like Comment A", test_6_like_comment_a()))
    results.append(("Test 7: Unlike Comment A", test_7_unlike_comment_a()))
    results.append(("Test 8: Like Nonexistent Comment (404)", test_8_like_nonexistent_comment()))
    results.append(("Test 9: Reply to Nonexistent (404)", test_9_reply_to_nonexistent_comment()))
    results.append(("Test 10: Auth Required (401)", test_10_auth_required()))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {name}")
    
    print("\n" + "="*80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("="*80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Twitter-style threaded comments are working correctly.")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Please review the failures above.")


if __name__ == "__main__":
    run_all_tests()
