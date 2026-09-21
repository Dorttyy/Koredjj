"""E2E signaling checks against the preview backend (no browser needed)."""

import asyncio
import json

import httpx
import websockets

BASE = "https://apk-deployment-6.preview.emergentagent.com"
API = f"{BASE}/api"
WS = BASE.replace("https", "wss") + "/api/ws"


async def login(client, email):
    r = await client.post(f"{API}/auth/login", json={"email": email, "password": "Demo1234!"})
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]["id"]


async def main():
    async with httpx.AsyncClient(timeout=30) as client:
        tok_a, id_a = await login(client, "mei@demo.com")
        tok_b, id_b = await login(client, "diego@demo.com")
        print("users", id_a, id_b)

        async with websockets.connect(f"{WS}?token={tok_a}") as ws_a, websockets.connect(
            f"{WS}?token={tok_b}"
        ) as ws_b:
            await asyncio.sleep(0.5)
            # 1. unauthorized signal (no call_id) must be rejected
            await ws_a.send(json.dumps({"type": "call_offer", "to": id_b, "sdp": {"x": 1}}))
            reply = json.loads(await asyncio.wait_for(ws_a.recv(), 5))
            print("1) no call_id ->", reply["type"])
            assert reply["type"] == "call_invalid"

            # 2. authenticated session + relay
            r = await client.post(
                f"{API}/rtc/calls",
                json={"receiver_id": id_b},
                headers={"Authorization": f"Bearer {tok_a}"},
            )
            call_id = r.json()["call_id"]
            print("2) session", call_id, "receiver_online", r.json()["receiver_online"])
            await ws_a.send(
                json.dumps(
                    {"type": "call_offer", "to": id_b, "call_id": call_id, "sdp": {"type": "offer"}}
                )
            )
            ev = json.loads(await asyncio.wait_for(ws_b.recv(), 5))
            print("   relayed to B:", ev["type"], "caller:", ev.get("caller", {}).get("name"))
            assert ev["type"] == "call_offer" and ev["from"] == id_a

            # 3. answer marks the session CONNECTED
            await ws_b.send(
                json.dumps(
                    {"type": "call_answer", "to": id_a, "call_id": call_id, "sdp": {"type": "answer"}}
                )
            )
            ev = json.loads(await asyncio.wait_for(ws_a.recv(), 5))
            print("3) answer relayed:", ev["type"])

            # 4. a third user must not be able to hijack the session
            tok_c, id_c = await login(client, "yuki@demo.com")
            async with websockets.connect(f"{WS}?token={tok_c}") as ws_c:
                await ws_c.send(
                    json.dumps({"type": "call_ice", "to": id_a, "call_id": call_id, "candidate": {}})
                )
                reply = json.loads(await asyncio.wait_for(ws_c.recv(), 5))
                print("4) outsider ->", reply["type"])
                assert reply["type"] == "call_invalid"

            # 5. end the call -> history recorded with duration
            await asyncio.sleep(1.2)
            await ws_a.send(json.dumps({"type": "call_end", "to": id_b, "call_id": call_id}))
            await asyncio.sleep(0.6)

            # 6. room signaling requires membership
            room = await client.post(
                f"{API}/rooms",
                json={"title": "RTC test room", "language": "en"},
                headers={"Authorization": f"Bearer {tok_a}"},
            )
            room_id = room.json()["id"]
            await ws_b.send(
                json.dumps({"type": "rtc_offer", "to": id_a, "room_id": room_id, "sdp": {}})
            )
            try:
                ev = json.loads(await asyncio.wait_for(ws_a.recv(), 2))
                print("6) NON-MEMBER LEAKED:", ev["type"])
            except asyncio.TimeoutError:
                print("6) non-member room signal blocked ✓")

            await client.post(
                f"{API}/rooms/{room_id}/join", headers={"Authorization": f"Bearer {tok_b}"}
            )
            await asyncio.sleep(0.3)
            await ws_b.send(
                json.dumps({"type": "rtc_offer", "to": id_a, "room_id": room_id, "sdp": {}})
            )
            got = None
            for _ in range(6):
                ev = json.loads(await asyncio.wait_for(ws_a.recv(), 5))
                if ev["type"] == "rtc_offer":
                    got = ev
                    break
            print("7) member room signal relayed:", bool(got))
            await client.post(
                f"{API}/rooms/{room_id}/end", headers={"Authorization": f"Bearer {tok_a}"}
            )

        # 8. rate limiting on call requests
        blocked = 0
        for _ in range(14):
            r = await client.post(
                f"{API}/rtc/calls",
                json={"receiver_id": id_b},
                headers={"Authorization": f"Bearer {tok_a}"},
            )
            if r.status_code == 429:
                blocked += 1
        print("8) rate-limited responses:", blocked)
        # 9. self-call rejected
        r = await client.post(
            f"{API}/rtc/calls",
            json={"receiver_id": id_a},
            headers={"Authorization": f"Bearer {tok_a}"},
        )
        print("9) self-call:", r.status_code, r.json().get("detail"))


asyncio.run(main())
