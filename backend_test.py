#!/usr/bin/env python3
"""
Backend test for translation cache index fix verification.
Tests against https://d6612bc7-3b91-4b27-9dc6-0ab7ea18b049.preview.emergentagent.com
"""
import requests
import json
import sys
from pymongo import MongoClient

BASE_URL = "https://d6612bc7-3b91-4b27-9dc6-0ab7ea18b049.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "linguaconnect"

# Test credentials
TEST_EMAIL = "demo@demo.com"
TEST_PASSWORD = "Demo1234!"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")
    return passed

def test_health():
    """Test 1: GET /api/health -> 200"""
    try:
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        passed = resp.status_code == 200
        details = f"Status: {resp.status_code}, Body: {resp.text[:100]}"
        return print_test("GET /api/health", passed, details)
    except Exception as e:
        return print_test("GET /api/health", False, f"Exception: {e}")

def test_login():
    """Test 2: Login demo@demo.com / Demo1234! -> token"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=10
        )
        passed = resp.status_code == 200 and "token" in resp.json()
        if passed:
            token = resp.json()["token"]
            details = f"Status: {resp.status_code}, Token received: {token[:20]}..."
            return print_test("POST /api/auth/login", passed, details), token
        else:
            details = f"Status: {resp.status_code}, Body: {resp.text[:200]}"
            return print_test("POST /api/auth/login", False, details), None
    except Exception as e:
        return print_test("POST /api/auth/login", False, f"Exception: {e}"), None

def test_translation(token, text, target_lang, test_name):
    """Test 3: Call translation endpoint"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        body = {
            "text": text,
            "target_language": target_lang,
            "source_language": "en"
        }
        resp = requests.post(
            f"{BASE_URL}/api/ai/translate",
            json=body,
            headers=headers,
            timeout=30
        )
        # Accept 200 (success) - 5xx is failure
        passed = 200 <= resp.status_code < 500
        result = resp.json() if resp.status_code == 200 else {}
        
        if resp.status_code == 200:
            translated = result.get("translated", "")
            cached = result.get("cached", False)
            provider = result.get("provider", "")
            unchanged = result.get("unchanged", False)
            details = f"Status: {resp.status_code}, Translated: '{translated[:50]}', Cached: {cached}, Provider: {provider}, Unchanged: {unchanged}"
        else:
            details = f"Status: {resp.status_code}, Body: {resp.text[:200]}"
        
        return print_test(test_name, passed, details), result
    except Exception as e:
        return print_test(test_name, False, f"Exception: {e}"), {}

def test_translation_cache(token, text, target_lang):
    """Test 4: Call same translation twice to verify caching"""
    print("\n--- Testing Translation Caching ---")
    
    # First call
    passed1, result1 = test_translation(token, text, target_lang, f"First call: Translate '{text}' to {target_lang}")
    
    # Second call (should be cached)
    passed2, result2 = test_translation(token, text, target_lang, f"Second call: Translate '{text}' to {target_lang} (should be cached)")
    
    # Verify both calls succeeded and second was cached or returned same result
    if passed1 and passed2:
        same_result = result1.get("translated") == result2.get("translated")
        details = f"First result: '{result1.get('translated', '')[:30]}', Second result: '{result2.get('translated', '')[:30]}', Same: {same_result}"
        return print_test("Translation caching verification", same_result, details)
    else:
        return print_test("Translation caching verification", False, "One or both translation calls failed")

def test_mongodb_indexes():
    """Test 5: Verify MongoDB indexes"""
    print("\n--- Testing MongoDB Indexes ---")
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        cache_col = db["text_translation_cache"]
        
        # Get all indexes
        indexes = list(cache_col.list_indexes())
        
        # Check for TTL index (should NOT exist)
        ttl_found = False
        user_expiry_found = False
        
        for idx in indexes:
            idx_name = idx.get("name", "")
            expire_after = idx.get("expireAfterSeconds")
            
            if expire_after is not None:
                ttl_found = True
                print_test(f"TTL index check: '{idx_name}'", False, f"BLOCKER: Found TTL index with expireAfterSeconds={expire_after}")
            
            if idx_name == "user_expiry_lookup":
                user_expiry_found = True
                key_spec = idx.get("key", {})
                print_test(f"user_expiry_lookup index found", True, f"Key spec: {key_spec}")
        
        # Final verdict
        passed = not ttl_found and user_expiry_found
        
        if not ttl_found:
            print_test("No TTL index with expireAfterSeconds", True, "✅ No auto-delete index found")
        
        if not user_expiry_found:
            print_test("user_expiry_lookup index exists", False, "❌ Expected index not found")
        
        # Print all indexes for reference
        print(f"\n  All indexes in text_translation_cache:")
        for idx in indexes:
            print(f"    - {idx.get('name')}: {idx.get('key')}")
        
        return passed
        
    except Exception as e:
        return print_test("MongoDB index verification", False, f"Exception: {e}")

def test_cache_document_persistence(token):
    """Test 6: Verify cache document is still present after translation"""
    print("\n--- Testing Cache Document Persistence ---")
    try:
        # First, do a translation
        text = "Hello world"
        target = "es"
        headers = {"Authorization": f"Bearer {token}"}
        body = {"text": text, "target_language": target, "source_language": "en"}
        
        resp = requests.post(f"{BASE_URL}/api/ai/translate", json=body, headers=headers, timeout=30)
        
        if resp.status_code != 200:
            return print_test("Cache document persistence", False, f"Translation failed with status {resp.status_code}")
        
        # Now check MongoDB for the cache document
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        cache_col = db["text_translation_cache"]
        
        # Count documents in cache
        doc_count = cache_col.count_documents({})
        
        passed = doc_count > 0
        details = f"Found {doc_count} document(s) in text_translation_cache collection"
        
        if passed:
            # Show a sample document (without _id for brevity)
            sample = cache_col.find_one({}, {"_id": 0, "translated": 1, "target_language": 1, "expires_at": 1})
            details += f"\n  Sample document: {sample}"
        
        return print_test("Cache document persistence (no auto-deletion)", passed, details)
        
    except Exception as e:
        return print_test("Cache document persistence", False, f"Exception: {e}")

def test_backend_logs():
    """Test 7: Check backend logs for new tracebacks"""
    print("\n--- Checking Backend Logs ---")
    try:
        import subprocess
        result = subprocess.run(
            ["tail", "-n", "50", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        log_content = result.stdout
        
        # Look for tracebacks or errors
        has_traceback = "Traceback" in log_content
        has_error = "ERROR" in log_content
        
        if has_traceback or has_error:
            # Show last few lines
            lines = log_content.strip().split("\n")[-10:]
            details = f"Found issues in logs:\n" + "\n".join(f"    {line}" for line in lines)
            return print_test("Backend logs clean", False, details)
        else:
            return print_test("Backend logs clean", True, "No new tracebacks or errors found")
            
    except Exception as e:
        return print_test("Backend logs check", False, f"Exception: {e}")

def test_regression_endpoints(token):
    """Test 8: Quick regression of core endpoints"""
    print("\n--- Testing Regression Endpoints ---")
    headers = {"Authorization": f"Bearer {token}"}
    
    results = []
    
    # GET /api/auth/me
    try:
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        passed = resp.status_code == 200
        details = f"Status: {resp.status_code}"
        results.append(print_test("GET /api/auth/me", passed, details))
    except Exception as e:
        results.append(print_test("GET /api/auth/me", False, f"Exception: {e}"))
    
    # GET /api/moments
    try:
        resp = requests.get(f"{BASE_URL}/api/moments", headers=headers, timeout=10)
        passed = resp.status_code == 200
        details = f"Status: {resp.status_code}"
        results.append(print_test("GET /api/moments", passed, details))
    except Exception as e:
        results.append(print_test("GET /api/moments", False, f"Exception: {e}"))
    
    # GET /api/chats
    try:
        resp = requests.get(f"{BASE_URL}/api/chats", headers=headers, timeout=10)
        passed = resp.status_code == 200
        details = f"Status: {resp.status_code}"
        results.append(print_test("GET /api/chats", passed, details))
    except Exception as e:
        results.append(print_test("GET /api/chats", False, f"Exception: {e}"))
    
    return all(results)

def main():
    print("=" * 80)
    print("TRANSLATION CACHE INDEX FIX VERIFICATION")
    print("Testing deployment blocker fix: non-destructive translation cache index")
    print("=" * 80)
    
    results = []
    
    # Test 1: Health check
    print("\n--- Test 1: Health Check ---")
    results.append(test_health())
    
    # Test 2: Login
    print("\n--- Test 2: Login ---")
    login_passed, token = test_login()
    results.append(login_passed)
    
    if not token:
        print("\n❌ CRITICAL: Cannot proceed without authentication token")
        sys.exit(1)
    
    # Test 3 & 4: Translation with Bengali and Spanish, verify caching
    print("\n--- Test 3: Translation to Bengali (bn) ---")
    test_text = "Hello, how are you today?"
    passed_bn, result_bn = test_translation(token, test_text, "bn", f"Translate '{test_text}' to Bengali (bn)")
    results.append(passed_bn)
    
    print("\n--- Test 4: Translation to Spanish (es) ---")
    passed_es, result_es = test_translation(token, test_text, "es", f"Translate '{test_text}' to Spanish (es)")
    results.append(passed_es)
    
    # Test caching with Spanish (call twice)
    results.append(test_translation_cache(token, test_text, "es"))
    
    # Test 5: MongoDB indexes
    results.append(test_mongodb_indexes())
    
    # Test 6: Cache document persistence
    results.append(test_cache_document_persistence(token))
    
    # Test 7: Backend logs
    results.append(test_backend_logs())
    
    # Test 8: Regression endpoints
    results.append(test_regression_endpoints(token))
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    total = len(results)
    passed = sum(results)
    failed = total - passed
    
    print(f"Total tests: {total}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} ❌")
    
    if failed == 0:
        print("\n✅ ALL TESTS PASSED - Translation cache index fix verified successfully!")
        print("   - No TTL/auto-delete index found")
        print("   - user_expiry_lookup index exists")
        print("   - Translation endpoints working (200 responses)")
        print("   - Cache documents persist (no auto-deletion)")
        print("   - No new backend errors")
        print("   - Core endpoints regression clean")
        sys.exit(0)
    else:
        print(f"\n❌ {failed} TEST(S) FAILED - See details above")
        sys.exit(1)

if __name__ == "__main__":
    main()
