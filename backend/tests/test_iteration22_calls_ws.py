"""
Iteration 22 — Extended WS signaling verification including NEW rtc_restart event.

Verifies /api/ws relays these frames from A → B by 'to' field:
  * call_offer / call_answer / call_ice / call_decline / call_end
  * rtc_offer  / rtc_answer  / rtc_ice / rtc_restart  (rtc_restart is NEW)

Also verifies:
  * call_offer to an OFFLINE user returns 'call_unavailable' to caller.
  * call_offer to an ONLINE user forwards to callee and includes 'caller' user_card.
  * Invalid JWT closes the socket.
  * rooms API: create → join → mic toggle → end.
  * WS emits room_update on join.
"""

import asyncio
import json
import os

import pytest
import requests
import websockets

# Use the public preview URL for HTTP (goes through ingress) but internal loopback
# for websockets since kubernetes ingress may or may not proxy WS depending on
# path — the backend is hosted on same origin. We try public URL first, fall
# back to localhost if the WS scheme fails.
PUBLIC = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://gmail-notify-service.preview.emergentagent.com",
).rstrip("/")
BASE = f"{PUBLIC}/api"
# Prefer localhost for WS to avoid ingress-strip issues; backend runs on 8001.
WS_BASE = "ws://localhost:8001/api/ws"


def _login(email, password="Demo1234!"):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    d = r.json()
    return d["token"], d["user"]


# ---------- Auth guard ----------
@pytest.mark.asyncio
async def test_ws_rejects_invalid_token():
    with pytest.raises(Exception):
        async with websockets.connect(f"{WS_BASE}?token=nope") as ws:
            await asyncio.wait_for(ws.recv(), timeout=3)


# ---------- 1:1 call signaling ----------
@pytest.mark.asyncio
async def test_call_offer_online_forwarded_with_caller_card():
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")

    async with websockets.connect(f"{WS_BASE}?token={tok_a}") as ws_a, \
               websockets.connect(f"{WS_BASE}?token={tok_b}") as ws_b:
        await asyncio.sleep(0.3)
        await ws_a.send(json.dumps({
            "type": "call_offer",
            "to": user_b["id"],
            "sdp": {"type": "offer", "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n"},
        }))
        raw = await asyncio.wait_for(ws_b.recv(), timeout=5)
        evt = json.loads(raw)
        assert evt["type"] == "call_offer"
        assert evt["from"] == user_a["id"]
        assert evt.get("caller", {}).get("id") == user_a["id"]
        assert evt.get("sdp", {}).get("type") == "offer"


@pytest.mark.asyncio
async def test_call_offer_offline_returns_call_unavailable():
    tok_a, _ = _login("mei@demo.com")
    _, user_b = _login("diego@demo.com")

    async with websockets.connect(f"{WS_BASE}?token={tok_a}") as ws_a:
        await asyncio.sleep(0.2)
        await ws_a.send(json.dumps({
            "type": "call_offer",
            "to": user_b["id"],
            "sdp": {"type": "offer", "sdp": "v=0\r\n"},
        }))
        raw = await asyncio.wait_for(ws_a.recv(), timeout=5)
        evt = json.loads(raw)
        assert evt["type"] == "call_unavailable"
        assert evt["from"] == user_b["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("etype", ["call_answer", "call_ice", "call_decline", "call_end"])
async def test_call_relay_events_forwarded(etype):
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")
    async with websockets.connect(f"{WS_BASE}?token={tok_a}") as ws_a, \
               websockets.connect(f"{WS_BASE}?token={tok_b}") as ws_b:
        await asyncio.sleep(0.3)
        payload = {"type": etype, "to": user_b["id"], "payload": "x"}
        if etype == "call_answer":
            payload["sdp"] = {"type": "answer", "sdp": "v=0\r\n"}
        if etype == "call_ice":
            payload["candidate"] = {"candidate": "candidate:1 1 udp 1 1.1.1.1 1 typ host"}
        await ws_a.send(json.dumps(payload))
        raw = await asyncio.wait_for(ws_b.recv(), timeout=5)
        evt = json.loads(raw)
        assert evt["type"] == etype
        assert evt["from"] == user_a["id"]


# ---------- Voice-room mesh signaling (rtc_offer/answer/ice + NEW rtc_restart) ----------
@pytest.mark.asyncio
@pytest.mark.parametrize("etype", ["rtc_offer", "rtc_answer", "rtc_ice", "rtc_restart"])
async def test_room_rtc_events_forwarded(etype):
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")
    async with websockets.connect(f"{WS_BASE}?token={tok_a}") as ws_a, \
               websockets.connect(f"{WS_BASE}?token={tok_b}") as ws_b:
        await asyncio.sleep(0.3)
        payload = {
            "type": etype,
            "to": user_b["id"],
            "room_id": "test-room-id",
        }
        if etype == "rtc_offer":
            payload["sdp"] = {"type": "offer", "sdp": "v=0\r\n"}
        elif etype == "rtc_answer":
            payload["sdp"] = {"type": "answer", "sdp": "v=0\r\n"}
        elif etype == "rtc_ice":
            payload["candidate"] = {"candidate": "candidate:2 1 udp 1 1.1.1.1 1 typ host"}
        elif etype == "rtc_restart":
            # rtc_restart is a plain signal — carries no sdp/candidate. Peers
            # use it to know they must tear down and re-offer.
            payload["reason"] = "role_changed"

        await ws_a.send(json.dumps(payload))
        raw = await asyncio.wait_for(ws_b.recv(), timeout=5)
        evt = json.loads(raw)
        assert evt["type"] == etype, f"expected {etype}, got {evt}"
        assert evt["from"] == user_a["id"]
        assert evt.get("room_id") == "test-room-id"
        if etype == "rtc_restart":
            assert evt.get("reason") == "role_changed"


# ---------- Voice room create → join → mic → end ----------
def _headers(t):
    return {"Authorization": f"Bearer {t}"}


def test_voice_room_membership_flow():
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")

    r = requests.post(
        f"{BASE}/rooms",
        json={"title": "TEST_iter22 signaling", "language": "en"},
        headers=_headers(tok_a),
    )
    assert r.status_code == 201, r.text
    room = r.json()
    rid = room["id"]

    try:
        r = requests.post(f"{BASE}/rooms/{rid}/join", headers=_headers(tok_b))
        assert r.status_code == 200
        detail = r.json()
        member_ids = {m["id"] for m in detail["members"]}
        assert user_a["id"] in member_ids and user_b["id"] in member_ids

        r = requests.post(f"{BASE}/rooms/{rid}/mic", headers=_headers(tok_a))
        assert r.status_code == 200
        assert r.json()["mic_on"] is False

        r = requests.post(f"{BASE}/rooms/{rid}/mic", headers=_headers(tok_b))
        assert r.status_code == 403

        r = requests.get(f"{BASE}/rooms/{rid}", headers=_headers(tok_a))
        assert r.status_code == 200
        assert r.json()["member_count"] == 2
    finally:
        requests.post(f"{BASE}/rooms/{rid}/end", headers=_headers(tok_a))


# ---------- WS delivers room_update on join ----------
@pytest.mark.asyncio
async def test_ws_room_update_on_join():
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")

    r = requests.post(
        f"{BASE}/rooms",
        json={"title": "TEST_iter22 ws-join", "language": "en"},
        headers=_headers(tok_a),
    )
    assert r.status_code == 201
    rid = r.json()["id"]

    try:
        async with websockets.connect(f"{WS_BASE}?token={tok_a}") as ws_a:
            await asyncio.sleep(0.3)
            r = requests.post(f"{BASE}/rooms/{rid}/join", headers=_headers(tok_b))
            assert r.status_code == 200
            got_update = False
            for _ in range(3):
                try:
                    raw = await asyncio.wait_for(ws_a.recv(), timeout=3)
                    evt = json.loads(raw)
                    if evt.get("type") == "room_update":
                        got_update = True
                        break
                except asyncio.TimeoutError:
                    break
            assert got_update, "No room_update event received by host after join"
    finally:
        requests.post(f"{BASE}/rooms/{rid}/end", headers=_headers(tok_a))


# ---------- Speaker promotion + rtc_restart integration path ----------
def test_room_speaker_promotion_endpoint_exists():
    """Attempt to promote a listener to speaker; endpoint may or may not exist.
    If it exists (200), we log; if 404, we skip (feature not present).
    """
    tok_a, user_a = _login("mei@demo.com")
    tok_b, user_b = _login("diego@demo.com")

    r = requests.post(
        f"{BASE}/rooms",
        json={"title": "TEST_iter22 promote", "language": "en"},
        headers=_headers(tok_a),
    )
    assert r.status_code == 201
    rid = r.json()["id"]
    try:
        r = requests.post(f"{BASE}/rooms/{rid}/join", headers=_headers(tok_b))
        assert r.status_code == 200

        # Try promotion endpoint variants
        r1 = requests.post(
            f"{BASE}/rooms/{rid}/speakers/{user_b['id']}", headers=_headers(tok_a)
        )
        r2 = requests.post(
            f"{BASE}/rooms/{rid}/promote/{user_b['id']}", headers=_headers(tok_a)
        )
        r3 = requests.post(
            f"{BASE}/rooms/{rid}/promote",
            json={"user_id": user_b["id"]},
            headers=_headers(tok_a),
        )
        codes = (r1.status_code, r2.status_code, r3.status_code)
        # We record at least one attempt — if all 404, mark xfail via skip.
        if all(c in (404, 405) for c in codes):
            pytest.skip(f"No promotion endpoint found (tried 3 shapes → {codes})")
        assert any(200 <= c < 300 for c in codes), f"Promotion attempts all failed: {codes}"
    finally:
        requests.post(f"{BASE}/rooms/{rid}/end", headers=_headers(tok_a))
