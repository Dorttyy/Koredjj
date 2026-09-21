"""
Backend API tests for CORS regression and auth verification (Mello app)
Tests auth endpoints after CORS fix (allow_origin_regex instead of allow_origins=["*"])
and verifies CORS headers are spec-compliant.
"""
import requests
import json
import uuid

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

def test_cors_and_auth_regression():
    print("=" * 80)
    print("CORS REGRESSION + AUTH VERIFICATION")
    print("=" * 80)
    print()
    
    test_results = {}
    
    # ========================================================================
    # TEST 1: AUTH REGRESSION - Login with demo@demo.com
    # ========================================================================
    print("Test 1a: POST /api/auth/login with demo@demo.com...")
    login_resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    
    login_success = login_resp.status_code == 200
    has_token = False
    token = None
    user_id = None
    
    if login_success:
        try:
            login_data = login_resp.json()
            has_token = "token" in login_data
            token = login_data.get("token")
            user_id = login_data.get("user_id")
        except:
            pass
    
    test_results["1a_login"] = login_success and has_token
    print_test(
        "Test 1a: Login demo@demo.com -> 200 with 'token'",
        test_results["1a_login"],
        f"Status: {login_resp.status_code}, Has token: {has_token}, User ID: {user_id}"
    )
    
    if not test_results["1a_login"]:
        print("⚠️  CRITICAL: Cannot proceed without valid login token")
        return test_results
    
    # ========================================================================
    # TEST 1b: Register new user
    # ========================================================================
    print("Test 1b: POST /api/auth/register with new email...")
    random_suffix = str(uuid.uuid4())[:8]
    new_email = f"qa_cors_{random_suffix}@linguatest.com"
    new_password = "Test1234!"
    new_name = "QA Cors"
    
    register_resp = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "email": new_email,
            "password": new_password,
            "name": new_name
        }
    )
    
    register_success = register_resp.status_code in [200, 201]
    register_has_token = False
    
    if register_success:
        try:
            register_data = register_resp.json()
            register_has_token = "token" in register_data
        except:
            pass
    
    test_results["1b_register"] = register_success and register_has_token
    print_test(
        "Test 1b: Register new user -> 200/201 with 'token'",
        test_results["1b_register"],
        f"Status: {register_resp.status_code}, Email: {new_email}, Has token: {register_has_token}"
    )
    
    # ========================================================================
    # TEST 1c: GET /api/auth/me with Bearer token
    # ========================================================================
    print("Test 1c: GET /api/auth/me with Bearer token...")
    headers = {"Authorization": f"Bearer {token}"}
    
    me_resp = requests.get(
        f"{BASE_URL}/auth/me",
        headers=headers
    )
    
    me_success = me_resp.status_code == 200
    has_user_object = False
    
    if me_success:
        try:
            me_data = me_resp.json()
            has_user_object = "id" in me_data or "_id" in me_data
        except:
            pass
    
    test_results["1c_auth_me"] = me_success and has_user_object
    print_test(
        "Test 1c: GET /auth/me with token -> 200 with user object",
        test_results["1c_auth_me"],
        f"Status: {me_resp.status_code}, Has user object: {has_user_object}"
    )
    
    # ========================================================================
    # TEST 1d: Login with wrong password -> expect 401
    # ========================================================================
    print("Test 1d: POST /api/auth/login with wrong password...")
    wrong_login_resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": "WrongPassword123!"}
    )
    
    test_results["1d_wrong_password"] = wrong_login_resp.status_code == 401
    print_test(
        "Test 1d: Login with wrong password -> 401",
        test_results["1d_wrong_password"],
        f"Status: {wrong_login_resp.status_code}"
    )
    
    # ========================================================================
    # TEST 2: ONBOARDING SAVE - PUT /api/users/me
    # ========================================================================
    print("Test 2: PUT /api/users/me with onboarding data...")
    
    onboarding_data = {
        "native_language": "en",
        "learning_languages": ["es"],
        "learning_language": "es",
        "country": "United States",
        "birthday": "2000-06-15",
        "gender": "male",
        "interests": ["Football", "Basketball"]
    }
    
    update_resp = requests.put(
        f"{BASE_URL}/users/me",
        headers=headers,
        json=onboarding_data
    )
    
    update_success = update_resp.status_code == 200
    data_reflected = False
    
    if update_success:
        try:
            update_data = update_resp.json()
            data_reflected = (
                update_data.get("native_language") == "en" and
                "Football" in update_data.get("interests", []) and
                "Basketball" in update_data.get("interests", [])
            )
        except:
            pass
    
    test_results["2_onboarding_save"] = update_success and data_reflected
    print_test(
        "Test 2: PUT /users/me with onboarding data -> 200 with reflected data",
        test_results["2_onboarding_save"],
        f"Status: {update_resp.status_code}, Data reflected: {data_reflected}"
    )
    
    if not update_success:
        print(f"⚠️  Response body: {update_resp.text[:500]}")
        print()
    
    # ========================================================================
    # TEST 3a: CORS HEADERS - Actual POST with Origin header
    # ========================================================================
    print("Test 3a: CORS - Actual POST /api/auth/login WITH Origin header...")
    
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
    
    cors_origin_correct = acao_header == test_origin
    cors_credentials_correct = acac_header.lower() == "true"
    cors_vary_present = "origin" in vary_header.lower()
    cors_not_wildcard = acao_header != "*"
    
    test_results["3a_cors_actual"] = (
        cors_login_resp.status_code == 200 and
        cors_origin_correct and
        cors_credentials_correct and
        cors_vary_present and
        cors_not_wildcard
    )
    
    print_test(
        "Test 3a: CORS actual POST - Origin echoed (NOT '*'), Credentials true, Vary present",
        test_results["3a_cors_actual"],
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
    # TEST 3b: CORS HEADERS - OPTIONS preflight
    # ========================================================================
    print("Test 3b: CORS - OPTIONS preflight to /api/auth/login...")
    
    preflight_headers = {
        "Origin": test_origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization"
    }
    
    preflight_resp = requests.options(
        f"{BASE_URL}/auth/login",
        headers=preflight_headers
    )
    
    preflight_acao = preflight_resp.headers.get("Access-Control-Allow-Origin", "")
    preflight_acac = preflight_resp.headers.get("Access-Control-Allow-Credentials", "")
    
    preflight_origin_correct = preflight_acao == test_origin
    preflight_credentials_correct = preflight_acac.lower() == "true"
    
    test_results["3b_cors_preflight"] = (
        preflight_resp.status_code == 200 and
        preflight_origin_correct and
        preflight_credentials_correct
    )
    
    print_test(
        "Test 3b: CORS OPTIONS preflight - Origin echoed, Credentials true",
        test_results["3b_cors_preflight"],
        f"Status: {preflight_resp.status_code}\n" +
        f"  Access-Control-Allow-Origin: '{preflight_acao}' (expected: '{test_origin}')\n" +
        f"  Access-Control-Allow-Credentials: '{preflight_acac}' (expected: 'true')"
    )
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print()
    
    print("AUTH REGRESSION TESTS:")
    print(f"  1a. Login demo@demo.com -> 200 with token: {'✅ PASS' if test_results.get('1a_login') else '❌ FAIL'}")
    print(f"  1b. Register new user -> 200/201 with token: {'✅ PASS' if test_results.get('1b_register') else '❌ FAIL'}")
    print(f"  1c. GET /auth/me with token -> 200 with user: {'✅ PASS' if test_results.get('1c_auth_me') else '❌ FAIL'}")
    print(f"  1d. Login wrong password -> 401: {'✅ PASS' if test_results.get('1d_wrong_password') else '❌ FAIL'}")
    print()
    
    print("ONBOARDING SAVE TEST:")
    print(f"  2. PUT /users/me with onboarding data -> 200: {'✅ PASS' if test_results.get('2_onboarding_save') else '❌ FAIL'}")
    print()
    
    print("CORS HEADERS TESTS:")
    print(f"  3a. Actual POST with Origin -> echoed (NOT '*'): {'✅ PASS' if test_results.get('3a_cors_actual') else '❌ FAIL'}")
    print(f"  3b. OPTIONS preflight -> echoed Origin: {'✅ PASS' if test_results.get('3b_cors_preflight') else '❌ FAIL'}")
    print()
    
    all_passed = all(test_results.values())
    
    total_tests = len(test_results)
    passed_tests = sum(1 for v in test_results.values() if v)
    
    print(f"TOTAL: {passed_tests}/{total_tests} tests passed")
    print()
    
    if all_passed:
        print("🎉 ALL TESTS PASSED - CORS fix verified, auth regression clean!")
    else:
        print("⚠️  SOME TESTS FAILED - See details above")
    print()
    
    return test_results

if __name__ == "__main__":
    test_cors_and_auth_regression()
