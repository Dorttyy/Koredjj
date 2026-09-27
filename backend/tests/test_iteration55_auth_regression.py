"""Iteration 55 — backend regression for the api.ts refactor / URL fix.

Verifies the endpoints exercised by the mobile client after removing the
hardcoded EAS backend URL and the api.ts fallback: /api/health, register,
login, /api/auth/me, PUT /api/users/me. Also asserts the two humanized
error strings the auth UI depends on for detecting "wrong password" and
"email already registered".
"""

import os
import uuid
import requests
import pytest

BASE = os.environ["EXPO_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def qa_user():
    email = f"qa_iter55_{uuid.uuid4().hex[:8]}@linguatest.com"
    return {"email": email, "password": "Test1234!", "name": "QA Iter55"}


# ── /api/health (unauthenticated) ────────────────────────────────────────
def test_health_ok():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") in {"ok", "healthy"} or data.get("ok") is True or "status" in data


# ── register + login + me ────────────────────────────────────────────────
def test_register_success(qa_user):
    r = requests.post(f"{API}/auth/register", json=qa_user, timeout=20)
    assert r.status_code in (200, 201), r.text
    j = r.json()
    assert "token" in j and j["token"]
    assert j["user"]["email"] == qa_user["email"]
    qa_user["token"] = j["token"]
    qa_user["id"] = j["user"]["id"]


def test_register_duplicate_email(qa_user):
    r = requests.post(f"{API}/auth/register", json=qa_user, timeout=20)
    assert r.status_code == 400, r.text
    detail = (r.json().get("detail") or "").lower()
    # UI matches /email already registered/i to show
    # "This email is already registered. Try logging in instead."
    assert "email already registered" in detail, detail


def test_login_success(qa_user):
    r = requests.post(
        f"{API}/auth/login",
        json={"email": qa_user["email"], "password": qa_user["password"]},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["token"]
    qa_user["token"] = j["token"]


def test_login_wrong_password(qa_user):
    r = requests.post(
        f"{API}/auth/login",
        json={"email": qa_user["email"], "password": "WrongPass!"},
        timeout=20,
    )
    assert r.status_code == 401, r.text
    detail = (r.json().get("detail") or "").lower()
    # UI matches /incorrect email or password/i for retryable=false branch.
    assert "incorrect email or password" in detail, detail


def test_me_success(qa_user):
    h = {"Authorization": f"Bearer {qa_user['token']}"}
    r = requests.get(f"{API}/auth/me", headers=h, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["id"] == qa_user["id"]
    assert j["email"] == qa_user["email"]


def test_me_unauthorized():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code in (401, 403)


# ── PUT /api/users/me (onboarding fields) ────────────────────────────────
def test_put_users_me_updates_persist(qa_user):
    h = {"Authorization": f"Bearer {qa_user['token']}"}
    payload = {
        "name": "QA Iter55 Updated",
        "native_language": "en",
        "learning_language": "es",
        "proficiency": "beginner",
        "bio": "Hello from iteration 55",
    }
    r = requests.put(f"{API}/users/me", json=payload, headers=h, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["name"] == payload["name"]
    assert j["native_language"] == "en"
    assert j["learning_language"] == "es"
    # verify persistence via GET
    g = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert g.status_code == 200
    gj = g.json()
    assert gj["native_language"] == "en"
    assert gj["learning_language"] == "es"
    assert gj["bio"] == payload["bio"]


# ── Demo seed account still works (used by the review request) ───────────
def test_demo_account_login():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "demo@demo.com", "password": "Demo1234!"},
        timeout=20,
    )
    if r.status_code == 401:
        pytest.skip("demo@demo.com not seeded in this workspace")
    assert r.status_code == 200, r.text
    assert r.json().get("token")
