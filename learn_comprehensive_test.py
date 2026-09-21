"""
Comprehensive Learn Module Backend Testing - Round 19
Following the exact test requirements from the review request
"""

import requests
import json

BASE_URL = "https://apk-deployment-6.preview.emergentagent.com/api"
MEI_EMAIL = "mei@demo.com"
MEI_PASSWORD = "Demo1234!"
DIEGO_EMAIL = "diego@demo.com"
DIEGO_PASSWORD = "Demo1234!"

def login(email, password):
    resp = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    return resp.json()["token"]

def test_all():
    print("="*80)
    print("COMPREHENSIVE LEARN MODULE TESTING - ROUND 19")
    print("="*80)
    
    # Login mei
    print("\n[SETUP] Login mei@demo.com")
    mei_token = login(MEI_EMAIL, MEI_PASSWORD)
    print("✅ Logged in as mei")
    
    # ========== TEST A: Status endpoint ==========
    print("\n" + "="*80)
    print("TEST A: Status endpoint")
    print("="*80)
    
    # A1: GET /api/learn/status
    print("\nA1: GET /api/learn/status")
    resp = requests.get(f"{BASE_URL}/learn/status", headers={"Authorization": f"Bearer {mei_token}"})
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    required_keys = ["language", "due_count", "mistakes_count", "mastered_count", "total_vocab", "streak_days"]
    for key in required_keys:
        if key in data:
            print(f"  ✅ {key}: {data[key]} ({type(data[key]).__name__})")
        else:
            print(f"  ❌ {key}: MISSING")
    
    # A2: GET /api/learn/status?language=es
    print("\nA2: GET /api/learn/status?language=es")
    resp = requests.get(f"{BASE_URL}/learn/status?language=es", headers={"Authorization": f"Bearer {mei_token}"})
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if data.get("language") == "es":
        print(f"  ✅ language='es'")
    else:
        print(f"  ❌ language='{data.get('language')}' (expected 'es')")
    
    if data.get("total_vocab", 0) >= 8:
        print(f"  ✅ total_vocab={data.get('total_vocab')} (>= 8)")
    else:
        print(f"  ❌ total_vocab={data.get('total_vocab')} (expected >= 8)")
    
    # ========== TEST B: Session endpoint ==========
    print("\n" + "="*80)
    print("TEST B: Session endpoint")
    print("="*80)
    
    # B1: GET /api/learn/session?language=en
    print("\nB1: GET /api/learn/session?language=en")
    resp = requests.get(f"{BASE_URL}/learn/session?language=en", headers={"Authorization": f"Bearer {mei_token}"})
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Response keys: {list(data.keys())}")
    print(f"  language: {data.get('language')}")
    print(f"  cards count: {len(data.get('cards', []))}")
    
    if data.get("language") == "en":
        print(f"  ✅ language='en'")
    else:
        print(f"  ❌ language='{data.get('language')}' (expected 'en')")
    
    cards = data.get("cards", [])
    if len(cards) <= 20:
        print(f"  ✅ cards length={len(cards)} (<= 20)")
    else:
        print(f"  ❌ cards length={len(cards)} (> 20)")
    
    # B2: Check card structure
    if cards:
        print(f"\nB2: First card structure:")
        card = cards[0]
        print(f"  Card: {json.dumps(card, indent=4)}")
        
        required_card_keys = ["vocab_id", "word", "meaning", "language", "level", "is_new", "streak"]
        for key in required_card_keys:
            if key in card:
                print(f"    ✅ {key}: {card[key]} ({type(card[key]).__name__})")
            else:
                print(f"    ❌ {key}: MISSING")
        
        first_vocab_id = card.get("vocab_id")
        print(f"\n  First vocab_id for later tests: {first_vocab_id}")
    else:
        print(f"  ⚠️  No cards returned")
        first_vocab_id = None
    
    # B3: Check is_new status
    if cards:
        new_count = sum(1 for c in cards if c.get("is_new"))
        print(f"\nB3: is_new status: {new_count}/{len(cards)} cards are new")
    
    # ========== TEST C: Review endpoint ==========
    print("\n" + "="*80)
    print("TEST C: Review endpoint")
    print("="*80)
    
    if not first_vocab_id:
        print("❌ Cannot test review - no vocab_id available")
    else:
        # C1: POST with grade="correct"
        print(f"\nC1: POST /api/learn/review with vocab_id={first_vocab_id}, grade='correct'")
        resp = requests.post(
            f"{BASE_URL}/learn/review",
            headers={"Authorization": f"Bearer {mei_token}"},
            json={"vocab_id": first_vocab_id, "grade": "correct"}
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("streak") == 1:
            print(f"  ✅ streak=1")
        else:
            print(f"  ❌ streak={data.get('streak')} (expected 1)")
        
        if data.get("interval_days", 0) >= 1:
            print(f"  ✅ interval_days={data.get('interval_days')} (>= 1)")
        else:
            print(f"  ❌ interval_days={data.get('interval_days')} (expected >= 1)")
        
        if data.get("next_review"):
            print(f"  ✅ next_review={data.get('next_review')}")
        else:
            print(f"  ❌ next_review is missing")
        
        if data.get("last_result") == "correct":
            print(f"  ✅ last_result='correct'")
        else:
            print(f"  ❌ last_result='{data.get('last_result')}' (expected 'correct')")
        
        # C2: POST with grade="wrong"
        print(f"\nC2: POST /api/learn/review with same vocab_id, grade='wrong'")
        resp = requests.post(
            f"{BASE_URL}/learn/review",
            headers={"Authorization": f"Bearer {mei_token}"},
            json={"vocab_id": first_vocab_id, "grade": "wrong"}
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("streak") == 0:
            print(f"  ✅ streak=0")
        else:
            print(f"  ❌ streak={data.get('streak')} (expected 0)")
        
        if data.get("interval_days") == 0:
            print(f"  ✅ interval_days=0")
        else:
            print(f"  ❌ interval_days={data.get('interval_days')} (expected 0)")
        
        if data.get("last_result") == "wrong":
            print(f"  ✅ last_result='wrong'")
        else:
            print(f"  ❌ last_result='{data.get('last_result')}' (expected 'wrong')")
        
        # C3: POST with grade="hard"
        print(f"\nC3: POST /api/learn/review with grade='hard'")
        resp = requests.post(
            f"{BASE_URL}/learn/review",
            headers={"Authorization": f"Bearer {mei_token}"},
            json={"vocab_id": first_vocab_id, "grade": "hard"}
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("last_result") == "hard":
            print(f"  ✅ last_result='hard'")
        else:
            print(f"  ❌ last_result='{data.get('last_result')}' (expected 'hard')")
        
        if data.get("streak") == 0:
            print(f"  ✅ streak=0 (grade!=correct resets streak)")
        else:
            print(f"  ❌ streak={data.get('streak')} (expected 0)")
        
        # C4: POST with grade="correct" again
        print(f"\nC4: POST /api/learn/review with grade='correct' again")
        resp = requests.post(
            f"{BASE_URL}/learn/review",
            headers={"Authorization": f"Bearer {mei_token}"},
            json={"vocab_id": first_vocab_id, "grade": "correct"}
        )
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("streak") == 1:
            print(f"  ✅ streak=1 (reset from previous correct)")
        else:
            print(f"  ❌ streak={data.get('streak')} (expected 1)")
    
    # ========== TEST D: Review edge cases ==========
    print("\n" + "="*80)
    print("TEST D: Review edge cases")
    print("="*80)
    
    # D1: Unknown vocab_id
    print("\nD1: POST /api/learn/review with vocab_id='nonexistent-id-xyz'")
    resp = requests.post(
        f"{BASE_URL}/learn/review",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"vocab_id": "nonexistent-id-xyz", "grade": "correct"}
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code == 404:
        print(f"  ✅ 404 'Vocab word not found'")
        print(f"  Response: {resp.json()}")
    else:
        print(f"  ❌ Expected 404, got {resp.status_code}")
    
    # D2: Invalid grade
    print("\nD2: POST /api/learn/review with grade='maybe' (invalid)")
    resp = requests.post(
        f"{BASE_URL}/learn/review",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"vocab_id": "any-id", "grade": "maybe"}
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code == 422:
        print(f"  ✅ 422 validation error")
        print(f"  Response: {resp.json()}")
    else:
        print(f"  ❌ Expected 422, got {resp.status_code}")
    
    # ========== TEST E: Vocabulary list ==========
    print("\n" + "="*80)
    print("TEST E: Vocabulary list")
    print("="*80)
    
    print("\nE1: GET /api/learn/vocabulary?language=en")
    resp = requests.get(f"{BASE_URL}/learn/vocabulary?language=en", headers={"Authorization": f"Bearer {mei_token}"})
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Total items: {len(data)}")
    
    if data:
        print(f"\nFirst item:")
        item = data[0]
        print(f"  {json.dumps(item, indent=4)}")
        
        required_keys = ["id", "word", "meaning", "language", "level", "seen", "streak", "last_result"]
        for key in required_keys:
            if key in item:
                print(f"    ✅ {key}: {item[key]} ({type(item[key]).__name__})")
            else:
                print(f"    ❌ {key}: MISSING")
        
        # E2: Check for seen=true items
        seen_items = [i for i in data if i.get("seen")]
        print(f"\nE2: Items with seen=true: {len(seen_items)}/{len(data)}")
        if seen_items:
            print(f"  ✅ At least one item has seen=true (after reviews)")
        else:
            print(f"  ⚠️  No items with seen=true")
    
    # ========== TEST F: Mistakes ==========
    print("\n" + "="*80)
    print("TEST F: Mistakes")
    print("="*80)
    
    # First, mark a word as wrong with a fresh user (diego)
    print("\nF1: Login diego@demo.com")
    diego_token = login(DIEGO_EMAIL, DIEGO_PASSWORD)
    print("✅ Logged in as diego")
    
    # Get a session for diego
    print("\nF2: GET /api/learn/session?language=en for diego")
    resp = requests.get(f"{BASE_URL}/learn/session?language=en", headers={"Authorization": f"Bearer {diego_token}"})
    diego_cards = resp.json().get("cards", [])
    if diego_cards:
        diego_vocab_id = diego_cards[0]["vocab_id"]
        print(f"  Got vocab_id: {diego_vocab_id}")
        
        # Mark as wrong
        print(f"\nF3: POST /api/learn/review with grade='wrong' for diego")
        resp = requests.post(
            f"{BASE_URL}/learn/review",
            headers={"Authorization": f"Bearer {diego_token}"},
            json={"vocab_id": diego_vocab_id, "grade": "wrong"}
        )
        print(f"  Status: {resp.status_code}")
        
        # Check mistakes
        print(f"\nF4: GET /api/learn/mistakes for diego")
        resp = requests.get(f"{BASE_URL}/learn/mistakes", headers={"Authorization": f"Bearer {diego_token}"})
        print(f"  Status: {resp.status_code}")
        mistakes = resp.json()
        print(f"  Mistakes count: {len(mistakes)}")
        
        if mistakes:
            print(f"  ✅ Found mistakes after marking word wrong")
            print(f"  First mistake: {json.dumps(mistakes[0], indent=4)}")
        else:
            print(f"  ❌ No mistakes found (expected at least one)")
    else:
        print(f"  ⚠️  No cards available for diego")
    
    # ========== TEST G: Collections ==========
    print("\n" + "="*80)
    print("TEST G: Collections")
    print("="*80)
    
    # G1: Create collection
    print("\nG1: POST /api/learn/collections")
    resp = requests.post(
        f"{BASE_URL}/learn/collections",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"name": "My Favorite Words", "language": "en", "vocab_ids": ["x", "y", "z"]}
    )
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if resp.status_code == 201:
        print(f"  ✅ 201 Created")
        if data.get("name") == "My Favorite Words":
            print(f"  ✅ name='My Favorite Words'")
        if data.get("language") == "en":
            print(f"  ✅ language='en'")
        if data.get("count") == 3:
            print(f"  ✅ count=3")
        if "id" in data and "created_at" in data:
            print(f"  ✅ id and created_at present")
    else:
        print(f"  ❌ Expected 201, got {resp.status_code}")
    
    # G2: List collections
    print("\nG2: GET /api/learn/collections")
    resp = requests.get(f"{BASE_URL}/learn/collections", headers={"Authorization": f"Bearer {mei_token}"})
    print(f"Status: {resp.status_code}")
    data = resp.json()
    print(f"Total collections: {len(data)}")
    
    found = any(c.get("name") == "My Favorite Words" and c.get("count") == 3 for c in data)
    if found:
        print(f"  ✅ Found 'My Favorite Words' collection in list")
    else:
        print(f"  ❌ 'My Favorite Words' collection not found")
    
    # G3: Create collection with empty name
    print("\nG3: POST /api/learn/collections with empty name")
    resp = requests.post(
        f"{BASE_URL}/learn/collections",
        headers={"Authorization": f"Bearer {mei_token}"},
        json={"name": "", "language": "en", "vocab_ids": []}
    )
    print(f"Status: {resp.status_code}")
    if resp.status_code == 422:
        print(f"  ✅ 422 validation error")
    else:
        print(f"  ❌ Expected 422, got {resp.status_code}")
    
    # ========== TEST H: Auth required ==========
    print("\n" + "="*80)
    print("TEST H: Auth required")
    print("="*80)
    
    endpoints = [
        ("GET", "/learn/status"),
        ("GET", "/learn/session"),
        ("POST", "/learn/review"),
        ("GET", "/learn/vocabulary"),
        ("GET", "/learn/mistakes"),
        ("GET", "/learn/collections"),
    ]
    
    print("\nTesting all endpoints without auth token:")
    all_auth_ok = True
    for method, path in endpoints:
        if method == "GET":
            resp = requests.get(f"{BASE_URL}{path}")
        else:
            resp = requests.post(f"{BASE_URL}{path}", json={})
        
        if resp.status_code in [401, 403]:
            print(f"  ✅ {method} {path} → {resp.status_code}")
        else:
            print(f"  ❌ {method} {path} → {resp.status_code} (expected 401/403)")
            all_auth_ok = False
    
    if all_auth_ok:
        print(f"\n✅ All endpoints require authentication")
    else:
        print(f"\n❌ Some endpoints don't require authentication")
    
    print("\n" + "="*80)
    print("TESTING COMPLETE")
    print("="*80)

if __name__ == "__main__":
    test_all()
