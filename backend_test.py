#!/usr/bin/env python3
"""
Backend API Regression Test Suite
Tests all core backend endpoints after fork recovery
"""
import requests
import random
import string
import sys
from typing import Dict, Any, Optional

# Public API base URL
BASE_URL = "https://d6612bc7-3b91-4b27-9dc6-0ab7ea18b049.preview.emergentagent.com/api"

# Test credentials
DEMO_EMAIL = "demo@demo.com"
DEMO_PASSWORD = "Demo1234!"
ADMIN_EMAIL = "admin@lingua.app"
ADMIN_PASSWORD = "Admin1234!"

# Test results tracking
passed_tests = []
failed_tests = []


def generate_unique_email() -> str:
    """Generate a unique test email"""
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"qa_fix_{random_str}@linguatest.com"


def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  Details: {details}")
    
    if passed:
        passed_tests.append(name)
    else:
        failed_tests.append((name, details))


def test_health() -> bool:
    """Test 1: GET /api/ health check"""
    try:
        response = requests.get(f"{BASE_URL}/", timeout=10)
        
        if response.status_code != 200:
            log_test("GET /api/ health", False, f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        if data.get("status") != "ok" or data.get("message") != "Mello API":
            log_test("GET /api/ health", False, f"Unexpected response: {data}")
            return False
        
        log_test("GET /api/ health", True, "Returns {'status':'ok','message':'Mello API'}")
        return True
    except Exception as e:
        log_test("GET /api/ health", False, f"Exception: {str(e)}")
        return False


def test_register(email: str, password: str = "Test1234!", name: str = "Test User") -> Optional[Dict[str, Any]]:
    """Test 2: POST /api/auth/register"""
    try:
        payload = {
            "email": email,
            "password": password,
            "name": name
        }
        response = requests.post(f"{BASE_URL}/auth/register", json=payload, timeout=10)
        
        if response.status_code not in [200, 201]:
            log_test(f"POST /auth/register ({email})", False, 
                    f"Expected 200/201, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        if "token" not in data or "user" not in data:
            log_test(f"POST /auth/register ({email})", False, 
                    f"Missing 'token' or 'user' in response: {data}")
            return None
        
        log_test(f"POST /auth/register ({email})", True, 
                f"Created user with token and user object")
        return data
    except Exception as e:
        log_test(f"POST /auth/register ({email})", False, f"Exception: {str(e)}")
        return None


def test_login(email: str, password: str) -> Optional[Dict[str, Any]]:
    """Test 3: POST /api/auth/login"""
    try:
        payload = {
            "email": email,
            "password": password
        }
        response = requests.post(f"{BASE_URL}/auth/login", json=payload, timeout=10)
        
        if response.status_code != 200:
            log_test(f"POST /auth/login ({email})", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        if "token" not in data or "user" not in data:
            log_test(f"POST /auth/login ({email})", False, 
                    f"Missing 'token' or 'user' in response: {data}")
            return None
        
        log_test(f"POST /auth/login ({email})", True, 
                f"Login successful with token")
        return data
    except Exception as e:
        log_test(f"POST /auth/login ({email})", False, f"Exception: {str(e)}")
        return None


def test_auth_me(token: str) -> Optional[Dict[str, Any]]:
    """Test 4: GET /api/auth/me"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BASE_URL}/auth/me", headers=headers, timeout=10)
        
        if response.status_code != 200:
            log_test("GET /auth/me (with token)", False, 
                    f"Expected 200, got {response.status_code}: {response.text}")
            return None
        
        data = response.json()
        if "id" not in data:
            log_test("GET /auth/me (with token)", False, 
                    f"Missing 'id' in user response: {data}")
            return None
        
        log_test("GET /auth/me (with token)", True, 
                f"Returns user profile")
        return data
    except Exception as e:
        log_test("GET /auth/me (with token)", False, f"Exception: {str(e)}")
        return None


def test_duplicate_register(email: str) -> bool:
    """Test 5: Duplicate email registration should return 400"""
    try:
        payload = {
            "email": email,
            "password": "Test1234!",
            "name": "Duplicate User"
        }
        response = requests.post(f"{BASE_URL}/auth/register", json=payload, timeout=10)
        
        if response.status_code != 400:
            log_test("POST /auth/register (duplicate email)", False, 
                    f"Expected 400, got {response.status_code}")
            return False
        
        log_test("POST /auth/register (duplicate email)", True, 
                "Correctly returns 400 for duplicate email")
        return True
    except Exception as e:
        log_test("POST /auth/register (duplicate email)", False, f"Exception: {str(e)}")
        return False


def test_wrong_password(email: str) -> bool:
    """Test 6: Wrong password should return 401"""
    try:
        payload = {
            "email": email,
            "password": "WrongPassword123!"
        }
        response = requests.post(f"{BASE_URL}/auth/login", json=payload, timeout=10)
        
        if response.status_code != 401:
            log_test("POST /auth/login (wrong password)", False, 
                    f"Expected 401, got {response.status_code}")
            return False
        
        log_test("POST /auth/login (wrong password)", True, 
                "Correctly returns 401 for wrong password")
        return True
    except Exception as e:
        log_test("POST /auth/login (wrong password)", False, f"Exception: {str(e)}")
        return False


def test_auth_me_no_token() -> bool:
    """Test 7: GET /auth/me without token should return 401/403"""
    try:
        response = requests.get(f"{BASE_URL}/auth/me", timeout=10)
        
        if response.status_code not in [401, 403]:
            log_test("GET /auth/me (no token)", False, 
                    f"Expected 401/403, got {response.status_code}")
            return False
        
        log_test("GET /auth/me (no token)", True, 
                f"Correctly returns {response.status_code} without token")
        return True
    except Exception as e:
        log_test("GET /auth/me (no token)", False, f"Exception: {str(e)}")
        return False


def test_authenticated_endpoint(endpoint: str, token: str, name: str) -> bool:
    """Test authenticated read endpoint"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
        
        if response.status_code == 404:
            log_test(f"GET {endpoint}", False, 
                    f"404 Not Found - endpoint may not exist")
            return False
        
        if response.status_code >= 500:
            log_test(f"GET {endpoint}", False, 
                    f"5xx error: {response.status_code} - {response.text[:200]}")
            return False
        
        if response.status_code != 200:
            log_test(f"GET {endpoint}", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
            return False
        
        data = response.json()
        log_test(f"GET {endpoint}", True, 
                f"{name} endpoint working")
        return True
    except Exception as e:
        log_test(f"GET {endpoint}", False, f"Exception: {str(e)}")
        return False


def main():
    """Run all backend tests"""
    print("=" * 80)
    print("BACKEND API REGRESSION TEST SUITE")
    print(f"Testing against: {BASE_URL}")
    print("=" * 80)
    print()
    
    # Test 1: Health check
    print("TEST 1: Health Check")
    print("-" * 80)
    test_health()
    print()
    
    # Test 2: Register new user
    print("TEST 2: User Registration")
    print("-" * 80)
    test_email = generate_unique_email()
    register_result = test_register(test_email)
    test_token = register_result.get("token") if register_result else None
    print()
    
    # Test 3: Login with demo account
    print("TEST 3: Demo User Login")
    print("-" * 80)
    demo_login = test_login(DEMO_EMAIL, DEMO_PASSWORD)
    demo_token = demo_login.get("token") if demo_login else None
    print()
    
    # Test 4: Get current user profile
    print("TEST 4: Get Current User Profile")
    print("-" * 80)
    if demo_token:
        test_auth_me(demo_token)
    else:
        log_test("GET /auth/me (with token)", False, "No token available from login")
    print()
    
    # Test 5: Negative tests
    print("TEST 5: Negative Test Cases")
    print("-" * 80)
    test_duplicate_register(DEMO_EMAIL)
    test_wrong_password(DEMO_EMAIL)
    test_auth_me_no_token()
    print()
    
    # Test 6: Core authenticated endpoints
    print("TEST 6: Core Authenticated Read Endpoints")
    print("-" * 80)
    if demo_token:
        # Test partners/users list
        test_authenticated_endpoint("/users/partners", demo_token, "Partners list")
        
        # Test moments feed
        test_authenticated_endpoint("/moments", demo_token, "Moments feed")
        
        # Test chats list
        test_authenticated_endpoint("/chats", demo_token, "Chats list")
        
        # Test vocab topics
        test_authenticated_endpoint("/vocab/topics", demo_token, "Vocab topics")
        
        # Test lessons
        test_authenticated_endpoint("/lessons", demo_token, "Lessons list")
        
        # Test pro tutors
        test_authenticated_endpoint("/pro/tutors", demo_token, "Pro tutors")
    else:
        log_test("Core authenticated endpoints", False, "No token available")
    print()
    
    # Test 7: Admin login
    print("TEST 7: Admin Login")
    print("-" * 80)
    admin_login = test_login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if admin_login:
        admin_token = admin_login.get("token")
        if admin_token:
            # Verify admin can access their profile
            test_auth_me(admin_token)
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total Passed: {len(passed_tests)}")
    print(f"Total Failed: {len(failed_tests)}")
    print()
    
    if failed_tests:
        print("FAILED TESTS:")
        for name, details in failed_tests:
            print(f"  ❌ {name}")
            if details:
                print(f"     {details}")
        print()
        
        # Check backend logs for errors
        print("=" * 80)
        print("CHECKING BACKEND LOGS FOR ERRORS")
        print("=" * 80)
        import subprocess
        try:
            result = subprocess.run(
                ["tail", "-n", "50", "/var/log/supervisor/backend.err.log"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.stdout:
                print(result.stdout)
            else:
                print("No recent errors in backend logs")
        except Exception as e:
            print(f"Could not read backend logs: {e}")
        print()
    
    # Save test credentials
    if test_email and register_result:
        print("=" * 80)
        print("NEW TEST CREDENTIALS CREATED")
        print("=" * 80)
        print(f"Email: {test_email}")
        print(f"Password: Test1234!")
        print()
    
    # Exit with appropriate code
    sys.exit(0 if len(failed_tests) == 0 else 1)


if __name__ == "__main__":
    main()
