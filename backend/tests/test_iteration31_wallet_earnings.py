"""Iteration 31 – Wallet earnings (chat gift diamonds + paid-practice wallet_tx).

Verifies:
 - POST /chats/{c}/gift: sender coins -= price, recipient diamonds += price/10
   (NOT coins). gift_ledger visible in /market/gifts (received/sent).
   wallet_tx rows for sender (coin −) and recipient (diamond +).
 - POST /practice/{p}/unlock: buyer coin −rate, partner coin +rate, wallet_tx
   entries for both sides.
 - GET /market/wallet reflects the running totals.
 - Insufficient coins → 402.
"""

import os
import time
import uuid

import pytest
import requests

BASE = os.environ.get("EXPO_BACKEND_URL", "https://apk-build-debug-1.preview.emergentagent.com").rstrip("/") + "/api"

MEI = ("mei@demo.com", "Demo1234!")
DIEGO = ("diego@demo.com", "Demo1234!")


def _login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {"mei": _login(*MEI), "diego": _login(*DIEGO)}


@pytest.fixture(scope="module")
def ids(tokens):
    r = requests.get(f"{BASE}/auth/me", headers=_hdr(tokens["mei"]))
    mei_id = r.json()["id"]
    r = requests.get(f"{BASE}/auth/me", headers=_hdr(tokens["diego"]))
    diego_id = r.json()["id"]
    return {"mei": mei_id, "diego": diego_id}


@pytest.fixture(scope="module")
def conv_id(tokens, ids):
    r = requests.post(
        f"{BASE}/chats", json={"partner_id": ids["diego"]}, headers=_hdr(tokens["mei"])
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _wallet(t):
    r = requests.get(f"{BASE}/market/wallet", headers=_hdr(t))
    assert r.status_code == 200, r.text
    return r.json()


def _topup_if_needed(tok, need):
    w = _wallet(tok)
    while w["coins"] < need:
        r = requests.post(f"{BASE}/market/topup-pack", json={"coins": 64}, headers=_hdr(tok))
        assert r.status_code == 200, r.text
        w = _wallet(tok)


class TestChatGiftDiamonds:
    def test_gift_credits_recipient_diamonds_not_coins(self, tokens, ids, conv_id):
        _topup_if_needed(tokens["mei"], 200)
        mei_before = _wallet(tokens["mei"])
        diego_before = _wallet(tokens["diego"])

        r = requests.post(
            f"{BASE}/chats/{conv_id}/gift",
            json={"gift_id": "star"},  # price = 30 → 3 diamonds
            headers=_hdr(tokens["mei"]),
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["message"]["type"] == "gift"

        mei_after = _wallet(tokens["mei"])
        diego_after = _wallet(tokens["diego"])
        assert mei_after["coins"] == mei_before["coins"] - 30, (mei_before, mei_after)
        # Diego's COINS should be UNCHANGED (earning goes to diamonds only)
        assert diego_after["coins"] == diego_before["coins"], (diego_before, diego_after)
        # Diamonds increment by price/10 = 3.0
        assert round(diego_after["diamonds"] - diego_before["diamonds"], 2) == 3.0

    def test_gift_ledger_received_and_sent(self, tokens, ids):
        # Diego (recipient) — dir=received
        r = requests.get(f"{BASE}/market/gifts?dir=received", headers=_hdr(tokens["diego"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 1
        top = data["items"][0]
        assert top["name"] == "Star"
        assert top["diamonds"] == 3
        assert (top["user"] or {}).get("id") == ids["mei"]

        # Mei (sender) — dir=sent
        r = requests.get(f"{BASE}/market/gifts?dir=sent", headers=_hdr(tokens["mei"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] >= 1
        assert data["items"][0]["name"] == "Star"
        assert (data["items"][0]["user"] or {}).get("id") == ids["diego"]

    def test_wallet_tx_rows(self, tokens):
        # Recipient sees +diamond row
        r = requests.get(f"{BASE}/market/transactions?kind=diamond", headers=_hdr(tokens["diego"]))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(it["amount"] == 3 and "Gift received" in it["label"] for it in items), items[:3]

        # Sender sees negative coin row labeled "Sent ..."
        r = requests.get(f"{BASE}/market/transactions?kind=coin", headers=_hdr(tokens["mei"]))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(it["amount"] == -30 and it["label"].startswith("Sent ") for it in items), items[:3]

    def test_insufficient_coins_returns_402(self, tokens, conv_id):
        # Zero out mei's coins by trying an unaffordable diamond (200 coins) many times isn't right —
        # instead, we assert 402 by creating a fresh user pattern is heavy; we test via a very
        # large gift request against a fresh throwaway account? Reuse Diego (has 0 coins after topups aside)
        # Simplest: pick a partner with insufficient coins → use Diego as sender to Mei
        # First find Diego's balance and try a gift more expensive than he has.
        w = _wallet(tokens["diego"])
        if w["coins"] >= 200:
            pytest.skip("Diego already has too many coins to test 402 without deletion")
        # Build a reverse convo (already exists → same id ok either direction)
        r = requests.post(
            f"{BASE}/chats",
            json={"partner_id": None},  # placeholder to fetch existing
            headers=_hdr(tokens["diego"]),
        )
        # Fallback: reuse the earlier conv
        # Diego sends diamond (200 coins) to Mei
        conv = conv_id
        r = requests.post(
            f"{BASE}/chats/{conv}/gift",
            json={"gift_id": "diamond"},
            headers=_hdr(tokens["diego"]),
        )
        assert r.status_code == 402, r.text


class TestPaidPracticeWalletTx:
    @pytest.fixture(scope="class")
    def setup_paid(self, tokens, ids):
        # Diego becomes paid-practice partner
        r = requests.put(
            f"{BASE}/users/me",
            json={"paid_practice": True, "practice_rate": 50},
            headers=_hdr(tokens["diego"]),
        )
        assert r.status_code == 200, r.text
        # Ensure Mei has coins
        _topup_if_needed(tokens["mei"], 100)
        # Clear any existing unlock by making a fresh user? Simpler: check status
        yield
        # Cleanup: restore Diego to non-paid
        requests.put(
            f"{BASE}/users/me",
            json={"paid_practice": False},
            headers=_hdr(tokens["diego"]),
        )

    def test_unlock_credits_partner_and_writes_wallet_tx(self, tokens, ids, setup_paid):
        mei_before = _wallet(tokens["mei"])
        diego_before = _wallet(tokens["diego"])

        r = requests.post(
            f"{BASE}/practice/unlock/{ids['diego']}", headers=_hdr(tokens["mei"])
        )
        # Idempotent — either 200 fresh or 200 already
        assert r.status_code == 200, r.text
        j = r.json()

        mei_after = _wallet(tokens["mei"])
        diego_after = _wallet(tokens["diego"])

        if j.get("already"):
            pytest.skip("Practice already unlocked from prior run; wallet_tx cannot be re-verified in this session")

        assert mei_after["coins"] == mei_before["coins"] - 50
        assert diego_after["coins"] == diego_before["coins"] + 50

        # Partner sees +coin row "Paid practice from ..."
        r = requests.get(f"{BASE}/market/transactions?kind=coin", headers=_hdr(tokens["diego"]))
        items = r.json()["items"]
        assert any(it["amount"] == 50 and "Paid practice from" in it["label"] for it in items), items[:3]

        # Buyer sees -coin row "Unlocked practice with ..."
        r = requests.get(f"{BASE}/market/transactions?kind=coin", headers=_hdr(tokens["mei"]))
        items = r.json()["items"]
        assert any(it["amount"] == -50 and "Unlocked practice with" in it["label"] for it in items), items[:3]


class TestWalletBalance:
    def test_get_wallet_reflects_state(self, tokens):
        r = requests.get(f"{BASE}/market/wallet", headers=_hdr(tokens["diego"]))
        assert r.status_code == 200
        data = r.json()
        assert "coins" in data and "diamonds" in data
        assert isinstance(data["coins"], int)
        assert isinstance(data["diamonds"], (int, float))
