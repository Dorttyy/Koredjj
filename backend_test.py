"""
Backend API tests for health probes and email authentication regression (Mello app)
Tests health endpoints and auth endpoints at the current preview URL.
"""
import requests
import json
import uuid

BASE_URL = "https://0ff0fcb1-0c1b-43e4-9388-b17b30a30b47.preview.emergentagent.com"
API_BASE_URL = f"{BASE_URL}/api"

# Test credentials from /app/memory/test_credentials.md
DEMO_EMAIL = "demo@demo.com"
DEMO_PASSWORD = "Demo1234!"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    print()

def test_health_probes_and_auth():
    print("=" * 80)
    print("HEALTH PROBE ENDPOINTS + EMAIL AUTH REGRESSION VERIFICATION")
    print(f"Base URL: {BASE_URL}")
    print(f"API Base URL: {API_BASE_URL}")
    print("=" * 80)
    print()
    
    test_results = {}
    
    # ========================================================================
    # TEST 1: GET /health at base URL
    # ========================================================================
    print("Test 1: GET /health at base URL...")
    health_base_resp = requests.get(f"{BASE_URL}/health")
    
    health_base_success = health_base_resp.status_code == 200
    health_base_correct = False
    
    if health_base_success:
        try:
            health_base_data = health_base_resp.json()
            health_base_correct = (
                health_base_data.get("status") == "ok" and 
                health_base_data.get("message") == "Mello API"
            )
        except:
            pass
    
    test_results["1_health_base"] = health_base_success and health_base_correct
    
    response_text = "N/A"
    if health_base_success:
        try:
            response_text = str(health_base_resp.json())
        except:
            response_text = health_base_resp.text[:200]
    
    print_test(
        "Test 1: GET /health -> 200 with {'status': 'ok', 'message': 'Mello API'}",
        test_results["1_health_base"],
        f"Status: {health_base_resp.status_code}, Response: {response_text}"
    )
    
    # ========================================================================
    # TEST 2: GET /api/health
    # ========================================================================
    print("Test 2: GET /api/health...")
    health_api_resp = requests.get(f"{API_BASE_URL}/health")
    
    health_api_success = health_api_resp.status_code == 200
    health_api_correct = False
    
    if health_api_success:
        try:
            health_api_data = health_api_resp.json()
            health_api_correct = (
                health_api_data.get("status") == "ok" and 
                health_api_data.get("message") == "Mello API"
            )
        except:
            pass
    
    test_results["2_health_api"] = health_api_success and health_api_correct
    
    response_text = "N/A"
    if health_api_success:
        try:
            response_text = str(health_api_resp.json())
        except:
            response_text = health_api_resp.text[:200]
    
    print_test(
        "Test 2: GET /api/health -> 200 with {'status': 'ok', 'message': 'Mello API'}",
        test_results["2_health_api"],
        f"Status: {health_api_resp.status_code}, Response: {response_text}"
    )
    
    # ========================================================================
    # TEST 3: GET /api/ root endpoint
    # ========================================================================
    print("Test 3: GET /api/ root endpoint...")
    root_resp = requests.get(f"{API_BASE_URL}/")
    
    root_success = root_resp.status_code == 200
    root_correct = False
    
    if root_success:
        try:
            root_data = root_resp.json()
            root_correct = (
                root_data.get("status") == "ok" and 
                root_data.get("message") == "Mello API"
            )
        except:
            pass
    
    test_results["3_root"] = root_success and root_correct
    
    response_text = "N/A"
    if root_success:
        try:
            response_text = str(root_resp.json())
        except:
            response_text = root_resp.text[:200]
    
    print_test(
        "Test 3: GET /api/ -> 200 with {'status': 'ok', 'message': 'Mello API'}",
        test_results["3_root"],
        f"Status: {root_resp.status_code}, Response: {response_text}"
    )
    
    # ========================================================================
    # TEST 4: Login with demo@demo.com
    # ========================================================================
    print("Test 4: POST /api/auth/login with demo@demo.com...")
    login_resp = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    
    login_success = login_resp.status_code == 200
    has_token = False
    has_user = False
    token = None
    
    if login_success:
        try:
            login_data = login_resp.json()
            has_token = "token" in login_data
            has_user = "user" in login_data
            token = login_data.get("token")
        except:
            pass
    
    test_results["4_login"] = login_success and has_token
    print_test(
        "Test 4: Login demo@demo.com -> 200 with 'token'",
        test_results["4_login"],
        f"Status: {login_resp.status_code}, Has token: {has_token}, Has user: {has_user}"
    )
    
    if not test_results["4_login"]:
        print("⚠️  CRITICAL: Cannot proceed without valid login token")
        print(f"Response: {login_resp.text[:500]}")
        return test_results
    
    # ========================================================================
    # TEST 5: GET /api/auth/me with Bearer token
    # ========================================================================
    print("Test 5: GET /api/auth/me with Bearer token...")
    headers = {"Authorization": f"Bearer {token}"}
    
    me_resp = requests.get(
        f"{API_BASE_URL}/auth/me",
        headers=headers
    )
    
    me_success = me_resp.status_code == 200
    has_user_profile = False
    
    if me_success:
        try:
            me_data = me_resp.json()
            # Check for user profile fields
            has_user_profile = ("id" in me_data or "_id" in me_data) and "email" in me_data
        except:
            pass
    
    test_results["5_auth_me"] = me_success and has_user_profile
    print_test(
        "Test 5: GET /auth/me with token -> 200 with user profile",
        test_results["5_auth_me"],
        f"Status: {me_resp.status_code}, Has user profile: {has_user_profile}"
    )
    
    # ========================================================================
    # TEST 6: Login with wrong password -> expect 401
    # ========================================================================
    print("Test 6: POST /api/auth/login with wrong password...")
    wrong_login_resp = requests.post(
        f"{API_BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": "WrongPassword123!"}
    )
    
    test_results["6_wrong_password"] = wrong_login_resp.status_code == 401
    print_test(
        "Test 6: Login with wrong password -> 401",
        test_results["6_wrong_password"],
        f"Status: {wrong_login_resp.status_code}"
    )
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print()
    
    print("HEALTH PROBE ENDPOINTS:")
    print(f"  1. GET /health -> 200 with status+message: {'✅ PASS' if test_results.get('1_health_base') else '❌ FAIL'}")
    print(f"  2. GET /api/health -> 200 with status+message: {'✅ PASS' if test_results.get('2_health_api') else '❌ FAIL'}")
    print(f"  3. GET /api/ -> 200 with status+message: {'✅ PASS' if test_results.get('3_root') else '❌ FAIL'}")
    print()
    
    print("EMAIL AUTH REGRESSION:")
    print(f"  4. Login demo@demo.com -> 200 with token: {'✅ PASS' if test_results.get('4_login') else '❌ FAIL'}")
    print(f"  5. GET /auth/me with token -> 200 with profile: {'✅ PASS' if test_results.get('5_auth_me') else '❌ FAIL'}")
    print(f"  6. Login wrong password -> 401: {'✅ PASS' if test_results.get('6_wrong_password') else '❌ FAIL'}")
    print()
    
    all_passed = all(test_results.values())
    
    total_tests = len(test_results)
    passed_tests = sum(1 for v in test_results.values() if v)
    
    print(f"TOTAL: {passed_tests}/{total_tests} tests passed")
    print()
    
    if all_passed:
        print("🎉 ALL TESTS PASSED - Health probes working, email auth regression clean!")
    else:
        print("⚠️  SOME TESTS FAILED - See details above")
    print()
    
    return test_results

if __name__ == "__main__":
    test_health_probes_and_auth()
