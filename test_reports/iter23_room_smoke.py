"""Iteration 23 voice-room smoke: does the room screen still load without crashing?"""

import asyncio
from playwright.async_api import async_playwright
import requests

BASE = "https://apk-build-debug-1.preview.emergentagent.com"
FAKE_ARGS = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
]


async def login(page, email):
    await page.goto(BASE + "/", wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)
    try:
        await page.wait_for_selector('[data-testid="login-btn"]', timeout=6000)
        await page.click('[data-testid="login-btn"]', force=True)
        await page.wait_for_timeout(600)
    except Exception:
        pass
    await page.wait_for_selector('[data-testid="auth-email-input"]', timeout=15000)
    await page.fill('[data-testid="auth-email-input"]', email)
    await page.fill('[data-testid="auth-password-input"]', "Demo1234!")
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    await page.wait_for_timeout(5000)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=FAKE_ARGS)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, permissions=["microphone"])
        await ctx.grant_permissions(["microphone"], origin=BASE)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: (errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None))

        await login(page, "mei@demo.com")

        # Create a room via API (Mei = host) then navigate to /room/{id}
        mei = requests.post(f"{BASE}/api/auth/login", json={"email": "mei@demo.com", "password": "Demo1234!"}, timeout=15).json()
        tok = mei["token"]
        room = requests.post(
            f"{BASE}/api/rooms",
            json={"title": "TEST_iter23 room", "language": "en"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        ).json()
        room_id = room["id"]
        print(f"room id: {room_id}")
        try:
            await page.goto(f"{BASE}/room/{room_id}", wait_until="domcontentloaded")
            await page.wait_for_timeout(6000)
            # room-screen or similar testID
            screen_ok = await page.locator('[data-testid="room-screen"]').is_visible()
            mic_btn = await page.locator('[data-testid="room-bar-mic-btn"]').is_visible()
            print(f"room-screen visible: {screen_ok}, mic btn visible: {mic_btn}")
            await page.screenshot(path="/app/test_reports/iter23_shots/room.jpg", quality=40, type="jpeg", full_page=False)
        finally:
            requests.post(f"{BASE}/api/rooms/{room_id}/end", headers={"Authorization": f"Bearer {tok}"}, timeout=15)

        print("=== Errors (page) ===")
        crit = [e for e in errs if "Unexpected text node" not in e and "shadow*" not in e and "pointerEvents" not in e and "useNativeDriver" not in e]
        for e in crit[-20:]:
            print(" ", e[:200])

        await browser.close()


asyncio.run(main())
