#!/usr/bin/env python3
"""
Backend health check for icon+typography+wording changes.
Read-only QA login /auth/me and /conversations health check.
"""
import os
import sys
import requests
from dotenv import load_dotenv

# Load backend environment
load_dotenv('/app/backend/.env')

BACKEND_URL = os.getenv('EXPO_PUBLIC_BACKEND_URL', 'https://apk-build-debug-1.preview.emergentagent.com')
API_BASE = f"{BACKEND_URL}/api"

# QA test credentials from test_credentials.md
QA_USER_1 = {
    'email': 'qa_tester_b40dc299@linguatest.com',
    'password': 'QATest2026!',
    'user_id': '83cdf218-fc71-4d7b-9427-1e7f6adfd9dc'
}

QA_USER_2 = {
    'email': 'qa_guest_removal_67403793@linguatest.com',
    'password': 'QATest2026!',
    'user_id': '4d54db47-1a80-47b1-bcf7-ea76d748c671'
}

def test_backend_health():
    """Test backend health with QA credentials."""
    print("=" * 60)
    print("BACKEND HEALTH CHECK")
    print("=" * 60)
    
    results = {
        'qa1_login': False,
        'qa1_me': False,
        'qa2_login': False,
        'qa2_me': False,
        'conversation_check': False,
        'conversation_id': None
    }
    
    # Test QA User 1 login
    print(f"\n1. Testing QA User 1 login ({QA_USER_1['email']})...")
    try:
        resp = requests.post(f"{API_BASE}/auth/login", json={
            'email': QA_USER_1['email'],
            'password': QA_USER_1['password']
        }, timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            qa1_token = data.get('token')
            if qa1_token and data.get('user', {}).get('id') == QA_USER_1['user_id']:
                results['qa1_login'] = True
                print(f"   ✓ QA User 1 login successful (user_id: {QA_USER_1['user_id']})")
                
                # Test /auth/me
                print(f"\n2. Testing QA User 1 /auth/me...")
                me_resp = requests.get(f"{API_BASE}/auth/me", 
                                      headers={'Authorization': f'Bearer {qa1_token}'},
                                      timeout=10)
                if me_resp.status_code == 200:
                    me_data = me_resp.json()
                    if me_data.get('id') == QA_USER_1['user_id']:
                        results['qa1_me'] = True
                        print(f"   ✓ /auth/me successful for QA User 1")
                    else:
                        print(f"   ✗ /auth/me returned wrong user_id")
                else:
                    print(f"   ✗ /auth/me failed: {me_resp.status_code}")
            else:
                print(f"   ✗ Login response missing token or wrong user_id")
        else:
            print(f"   ✗ Login failed: {resp.status_code} - {resp.text[:200]}")
    except Exception as e:
        print(f"   ✗ QA User 1 login error: {e}")
    
    # Test QA User 2 login
    print(f"\n3. Testing QA User 2 login ({QA_USER_2['email']})...")
    try:
        resp = requests.post(f"{API_BASE}/auth/login", json={
            'email': QA_USER_2['email'],
            'password': QA_USER_2['password']
        }, timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            qa2_token = data.get('token')
            if qa2_token and data.get('user', {}).get('id') == QA_USER_2['user_id']:
                results['qa2_login'] = True
                print(f"   ✓ QA User 2 login successful (user_id: {QA_USER_2['user_id']})")
                
                # Test /auth/me
                print(f"\n4. Testing QA User 2 /auth/me...")
                me_resp = requests.get(f"{API_BASE}/auth/me", 
                                      headers={'Authorization': f'Bearer {qa2_token}'},
                                      timeout=10)
                if me_resp.status_code == 200:
                    me_data = me_resp.json()
                    if me_data.get('id') == QA_USER_2['user_id']:
                        results['qa2_me'] = True
                        print(f"   ✓ /auth/me successful for QA User 2")
                    else:
                        print(f"   ✗ /auth/me returned wrong user_id")
                else:
                    print(f"   ✗ /auth/me failed: {me_resp.status_code}")
            else:
                print(f"   ✗ Login response missing token or wrong user_id")
        else:
            print(f"   ✗ Login failed: {resp.status_code} - {resp.text[:200]}")
    except Exception as e:
        print(f"   ✗ QA User 2 login error: {e}")
    
    # Check for existing conversation between QA users
    if results['qa1_login'] and results['qa2_login']:
        print(f"\n5. Checking for existing conversation between QA users...")
        try:
            conv_resp = requests.get(f"{API_BASE}/chats",
                                    headers={'Authorization': f'Bearer {qa1_token}'},
                                    timeout=10)
            if conv_resp.status_code == 200:
                conversations = conv_resp.json()
                # Look for conversation with QA User 2
                for conv in conversations:
                    partner_id = conv.get('partner', {}).get('id')
                    if partner_id == QA_USER_2['user_id']:
                        results['conversation_check'] = True
                        results['conversation_id'] = conv.get('id')
                        print(f"   ✓ Found existing conversation: {results['conversation_id']}")
                        break
                
                if not results['conversation_check']:
                    print(f"   ℹ No existing conversation found between QA users")
                    results['conversation_check'] = True  # Not an error
            else:
                print(f"   ✗ /chats failed: {conv_resp.status_code}")
        except Exception as e:
            print(f"   ✗ Conversation check error: {e}")
    
    # Summary
    print("\n" + "=" * 60)
    print("BACKEND HEALTH SUMMARY")
    print("=" * 60)
    print(f"QA User 1 Login:     {'✓ PASS' if results['qa1_login'] else '✗ FAIL'}")
    print(f"QA User 1 /auth/me:  {'✓ PASS' if results['qa1_me'] else '✗ FAIL'}")
    print(f"QA User 2 Login:     {'✓ PASS' if results['qa2_login'] else '✗ FAIL'}")
    print(f"QA User 2 /auth/me:  {'✓ PASS' if results['qa2_me'] else '✗ FAIL'}")
    print(f"Conversation Check:  {'✓ PASS' if results['conversation_check'] else '✗ FAIL'}")
    if results['conversation_id']:
        print(f"\nExisting QA Conversation ID: {results['conversation_id']}")
    else:
        print(f"\nNo existing conversation between QA test accounts")
    
    all_pass = all([results['qa1_login'], results['qa1_me'], 
                    results['qa2_login'], results['qa2_me'], 
                    results['conversation_check']])
    
    if all_pass:
        print("\n✓ ALL BACKEND HEALTH CHECKS PASSED")
        return 0
    else:
        print("\n✗ SOME BACKEND HEALTH CHECKS FAILED")
        return 1

if __name__ == '__main__':
    sys.exit(test_backend_health())
