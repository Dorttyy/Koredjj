"""Iteration 23 — WebRTC calling: /api/rtc/config, /api/rtc/calls, /api/rtc/calls/{id}/status."""

import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://apk-deployment-6.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = "Demo1234!"


def _login(email: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]["id"]


@pytest.fixture(scope="module")
def creds():
    c = {
        "a": _login("mei@demo.com"),
        "b": _login("diego@demo.com"),
        "c": _login("yuki@demo.com"),
    }
    # Ensure clean state: nobody has anyone blocked. /block is a toggle so
    # if there is a stale block from a previous run, toggle removes it.
    def _ensure_unblocked(actor_tok, target_id):
        r = requests.post(
            f"{API}/users/{target_id}/block",
            headers={"Authorization": f"Bearer {actor_tok}"},
            timeout=15,
        )
        # If POST returned blocked=True then a block just got created — toggle again.
        if r.status_code == 200 and r.json().get("blocked") is True:
            requests.post(
                f"{API}/users/{target_id}/block",
                headers={"Authorization": f"Bearer {actor_tok}"},
                timeout=15,
            )
    _ensure_unblocked(c["b"][0], c["a"][1])  # Diego → Mei
    _ensure_unblocked(c["a"][0], c["b"][1])  # Mei   → Diego
    _ensure_unblocked(c["c"][0], c["b"][1])  # Yuki  → Diego
    return c


# ---------------- /api/rtc/config ----------------
class TestRtcConfig:
    def test_unauthorized_401(self):
        r = requests.get(f"{API}/rtc/config", timeout=15)
        assert r.status_code == 401

    def test_returns_ice_servers(self, creds):
        tok, _ = creds["a"]
        r = requests.get(f"{API}/rtc/config", headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "iceServers" in data
        assert isinstance(data["iceServers"], list) and len(data["iceServers"]) > 0
        # STUN entries always have urls
        first = data["iceServers"][0]
        assert "urls" in first


# ---------------- /api/rtc/calls ----------------
class TestRtcCallsStart:
    def test_self_call_400(self, creds):
        tok, uid = creds["a"]
        r = requests.post(
            f"{API}/rtc/calls",
            json={"receiver_id": uid},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_unknown_receiver_404(self, creds):
        tok, _ = creds["a"]
        r = requests.post(
            f"{API}/rtc/calls",
            json={"receiver_id": "00000000-0000-0000-0000-000000000000"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_success_returns_call_id_and_card(self, creds):
        tok_a, _ = creds["a"]
        _, id_b = creds["b"]
        r = requests.post(
            f"{API}/rtc/calls",
            json={"receiver_id": id_b},
            headers={"Authorization": f"Bearer {tok_a}"},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert isinstance(data.get("call_id"), str) and len(data["call_id"]) >= 20
        assert "receiver_online" in data
        assert isinstance(data.get("receiver"), dict)
        assert data["receiver"].get("id") == id_b
        assert isinstance(data.get("iceServers"), list)

    def test_block_returns_403(self, creds):
        tok_a, id_a = creds["a"]
        tok_b, id_b = creds["b"]
        # Diego blocks Mei
        rb = requests.post(
            f"{API}/users/{id_a}/block",
            headers={"Authorization": f"Bearer {tok_b}"},
            timeout=15,
        )
        assert rb.status_code in (200, 201, 204), rb.text
        try:
            r = requests.post(
                f"{API}/rtc/calls",
                json={"receiver_id": id_b},
                headers={"Authorization": f"Bearer {tok_a}"},
                timeout=15,
            )
            assert r.status_code == 403, r.text
        finally:
            # /block is a toggle — call again to unblock so subsequent tests aren't blocked.
            requests.post(
                f"{API}/users/{id_a}/block",
                headers={"Authorization": f"Bearer {tok_b}"},
                timeout=15,
            )

    def test_rate_limit_429(self, creds):
        # Use user C to avoid interfering with earlier tests' rate-window
        tok_c, _ = creds["c"]
        _, id_b = creds["b"]
        codes = []
        for _ in range(14):
            r = requests.post(
                f"{API}/rtc/calls",
                json={"receiver_id": id_b},
                headers={"Authorization": f"Bearer {tok_c}"},
                timeout=15,
            )
            codes.append(r.status_code)
        assert 429 in codes, f"expected 429 among {codes}"


# ---------------- /api/rtc/calls/{id}/status ----------------
class TestRtcCallsStatus:
    def _new_call(self, creds):
        tok_a, _ = creds["a"]
        _, id_b = creds["b"]
        r = requests.post(
            f"{API}/rtc/calls",
            json={"receiver_id": id_b},
            headers={"Authorization": f"Bearer {tok_a}"},
            timeout=15,
        )
        assert r.status_code == 201, r.text
        return r.json()["call_id"], tok_a

    def test_unknown_call_404(self, creds):
        tok_a, _ = creds["a"]
        r = requests.post(
            f"{API}/rtc/calls/does-not-exist/status",
            json={"status": "COMPLETED"},
            headers={"Authorization": f"Bearer {tok_a}"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_third_user_forbidden_403(self, creds):
        call_id, _ = self._new_call(creds)
        tok_c, _ = creds["c"]
        r = requests.post(
            f"{API}/rtc/calls/{call_id}/status",
            json={"status": "CANCELLED"},
            headers={"Authorization": f"Bearer {tok_c}"},
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_invalid_status_400(self, creds):
        call_id, tok_a = self._new_call(creds)
        r = requests.post(
            f"{API}/rtc/calls/{call_id}/status",
            json={"status": "NOT_A_REAL_STATUS"},
            headers={"Authorization": f"Bearer {tok_a}"},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_participant_can_finalize(self, creds):
        call_id, tok_a = self._new_call(creds)
        r = requests.post(
            f"{API}/rtc/calls/{call_id}/status",
            json={"status": "CANCELLED"},
            headers={"Authorization": f"Bearer {tok_a}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("status") == "CANCELLED"
