"""
Backend API tests for email authentication and CORS verification (Mello app)
Tests auth endpoints at the current preview URL and verifies CORS headers are spec-compliant.
"""
import requests
import json
import uuid

BASE_URL = "https://0ff0fcb1-0c1b-43e4-9388-b17b30a30b47.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
DEMO_EMAIL = "demo@demo.com"
DEMO_PASSWORD = "Demo1234!"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    print()

def test_email_auth_and_cors():
    print("=" * 80)
    print("EMAIL AUTHENTICATION + CORS VERIFICATION")
    print(f"Testing at: {BASE_URL}")
    print("=" * 80)
    print()
    
    test_results = {}
    
    # ========================================================================
    # TEST 0: Root endpoint
    # ========================================================================
    print("Test 0: GET /api/ root endpoint...")
    root_resp = requests.get(f"{BASE_URL}/")
    
    root_success = root_resp.status_code == 200
    root_message_correct = False
    
    if root_success:
        try:
            root_data = root_resp.json()
            root_message_correct = root_data.get("message") == "Mello API"
        except:
            pass
    
    test_results["0_root"] = root_success and root_message_correct
    print_test(
        "Test 0: GET /api/ -> 200 with {'message': 'Mello API'}",
        test_results["0_root"],
        f"Status: {root_resp.status_code}, Message: {root_resp.json() if root_success else 'N/A'}"
    )
    
    # ========================================================================
    # TEST 1: Login with demo@demo.com
    # ========================================================================
    print("Test 1: POST /api/auth/login with demo@demo.com...")
    login_resp = requests.post(
        f"{BASE_URL}/auth/login",
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
    
    test_results["1_login"] = login_success and has_token and has_user
    print_test(
        "Test 1: Login demo@demo.com -> 200 with 'token' and 'user'",
        test_results["1_login"],
        f"Status: {login_resp.status_code}, Has token: {has_token}, Has user: {has_user}"
    )
    
    if not test_results["1_login"]:
        print("⚠️  CRITICAL: Cannot proceed without valid login token")
        print(f"Response: {login_resp.text[:500]}")
        return test_results
    
    # ========================================================================
    # TEST 2: Register new user
    # ========================================================================
    print("Test 2: POST /api/auth/register with new unique email...")
    random_suffix = str(uuid.uuid4())[:8]
    new_email = f"qa_auth_{random_suffix}@linguatest.com"
    new_password = "Test1234!"
    new_name = "QA Auth Test"
    
    register_resp = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "email": new_email,
            "password": new_password,
            "name": new_name
        }
    )
    
    register_success = register_resp.status_code == 201
    register_has_token = False
    register_has_user = False
    
    if register_success:
        try:
            register_data = register_resp.json()
            register_has_token = "token" in register_data
            register_has_user = "user" in register_data
        except:
            pass
    
    test_results["2_register"] = register_success and register_has_token and register_has_user
    print_test(
        "Test 2: Register new user -> 201 with 'token' and 'user'",
        test_results["2_register"],
        f"Status: {register_resp.status_code}, Email: {new_email}, Has token: {register_has_token}, Has user: {register_has_user}"
    )
    
    # Record the new credential
    if test_results["2_register"]:
        print(f"📝 New test user created: {new_email} / {new_password}")
        print()
    
    # ========================================================================
    # TEST 3: GET /api/auth/me with Bearer token
    # ========================================================================
    print("Test 3: GET /api/auth/me with Bearer token...")
    headers = {"Authorization": f"Bearer {token}"}
    
    me_resp = requests.get(
        f"{BASE_URL}/auth/me",
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
    
    test_results["3_auth_me"] = me_success and has_user_profile
    print_test(
        "Test 3: GET /auth/me with token -> 200 with user profile",
        test_results["3_auth_me"],
        f"Status: {me_resp.status_code}, Has user profile: {has_user_profile}"
    )
    
    # ========================================================================
    # TEST 4: Login with wrong password -> expect 401
    # ========================================================================
    print("Test 4: POST /api/auth/login with wrong password...")
    wrong_login_resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": "WrongPassword123!"}
    )
    
    test_results["4_wrong_password"] = wrong_login_resp.status_code == 401
    print_test(
        "Test 4: Login with wrong password -> 401",
        test_results["4_wrong_password"],
        f"Status: {wrong_login_resp.status_code}"
    )
    
    # ========================================================================
    # TEST 5: Register with duplicate email -> expect 400
    # ========================================================================
    print("Test 5: POST /api/auth/register with duplicate email...")
    duplicate_resp = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "email": DEMO_EMAIL,  # Use existing demo email
            "password": "AnyPassword123!",
            "name": "Duplicate Test"
        }
    )
    
    test_results["5_duplicate_email"] = duplicate_resp.status_code == 400
    print_test(
        "Test 5: Register with duplicate email -> 400",
        test_results["5_duplicate_email"],
        f"Status: {duplicate_resp.status_code}"
    )
    
    # ========================================================================
    # TEST 6: CORS HEADERS - Actual POST with Origin header
    # ========================================================================
    print("Test 6: CORS - Actual POST /api/auth/login WITH Origin header...")
    
    test_origin = "https://app.emergent.sh"
    cors_headers = {
        "Origin": test_origin,
        "Content-Type": "application/json"
    }
    
    cors_login_resp = requests.post(
        f"{BASE_URL}/auth/login",
        headers=cors_headers,
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    
    # Check response headers
    acao_header = cors_login_resp.headers.get("Access-Control-Allow-Origin", "")
    acac_header = cors_login_resp.headers.get("Access-Control-Allow-Credentials", "")
    vary_header = cors_login_resp.headers.get("Vary", "")
    
    cors_origin_echoed = acao_header == test_origin
    cors_credentials_correct = acac_header.lower() == "true"
    cors_vary_present = "origin" in vary_header.lower()
    cors_not_wildcard = acao_header != "*"
    
    test_results["6_cors_actual"] = (
        cors_login_resp.status_code == 200 and
        cors_origin_echoed and
        cors_credentials_correct and
        cors_vary_present and
        cors_not_wildcard
    )
    
    print_test(
        "Test 6: CORS actual POST - Origin echoed (NOT '*'), Credentials 'true', Vary present",
        test_results["6_cors_actual"],
        f"Status: {cors_login_resp.status_code}\n" +
        f"  Access-Control-Allow-Origin: '{acao_header}' (expected: '{test_origin}')\n" +
        f"  Access-Control-Allow-Credentials: '{acac_header}' (expected: 'true')\n" +
        f"  Vary: '{vary_header}' (should contain 'Origin')\n" +
        f"  Origin is NOT '*': {cors_not_wildcard}"
    )
    
    if acao_header == "*":
        print("⚠️  CRITICAL BUG: Access-Control-Allow-Origin is '*' instead of echoing the request Origin!")
        print("    This violates CORS spec when Access-Control-Allow-Credentials is 'true'")
        print()
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print()
    
    print("BACKEND EMAIL AUTH + CORS TESTS:")
    print(f"  0. GET /api/ root -> 200 with message: {'✅ PASS' if test_results.get('0_root') else '❌ FAIL'}")
    print(f"  1. Login demo@demo.com -> 200 with token+user: {'✅ PASS' if test_results.get('1_login') else '❌ FAIL'}")
    print(f"  2. Register new user -> 201 with token+user: {'✅ PASS' if test_results.get('2_register') else '❌ FAIL'}")
    print(f"  3. GET /auth/me with token -> 200 with profile: {'✅ PASS' if test_results.get('3_auth_me') else '❌ FAIL'}")
    print(f"  4. Login wrong password -> 401: {'✅ PASS' if test_results.get('4_wrong_password') else '❌ FAIL'}")
    print(f"  5. Register duplicate email -> 400: {'✅ PASS' if test_results.get('5_duplicate_email') else '❌ FAIL'}")
    print(f"  6. CORS actual POST -> Origin echoed (NOT '*'): {'✅ PASS' if test_results.get('6_cors_actual') else '❌ FAIL'}")
    print()
    
    all_passed = all(test_results.values())
    
    total_tests = len(test_results)
    passed_tests = sum(1 for v in test_results.values() if v)
    
    print(f"TOTAL: {passed_tests}/{total_tests} tests passed")
    print()
    
    if all_passed:
        print("🎉 ALL TESTS PASSED - Email auth working, CORS headers spec-compliant!")
    else:
        print("⚠️  SOME TESTS FAILED - See details above")
    print()
    
    return test_results

if __name__ == "__main__":
    test_email_auth_and_cors()
