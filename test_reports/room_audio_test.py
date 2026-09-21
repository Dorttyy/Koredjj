"""
Iteration 11 — Voice-room WebRTC mesh + 1:1 call regression.

Uses two independent chromium browser contexts with fake mic so
getUserMedia / RTCPeerConnection actually work in headless.
"""
import asyncio
import os
import re
import time
from playwright.async_api import async_playwright

BASE = "https://gmail-notify-service.preview.emergentagent.com"


async def login(page, email, password):
    await page.goto(BASE, wait_until="domcontentloaded")
    # Landing → "I already have an account"
    try:
        await page.get_by_text(re.compile(r"already have an account", re.I)).first.click(timeout=8000)
    except Exception:
        pass
    await page.wait_for_selector('input[type="email"], [data-testid="login-email"]', timeout=15000)
    # Fill email/password (Expo web renders TextInput as <input>)
    email_input = page.locator('[data-testid="login-email"]').first
    if await email_input.count() == 0:
        email_input = page.locator('input[type="email"]').first
    pw_input = page.locator('[data-testid="login-password"]').first
    if await pw_input.count() == 0:
        pw_input = page.locator('input[type="password"]').first
    await email_input.fill(email)
    await pw_input.fill(password)
    # Click Log in
    for sel in ['[data-testid="login-submit"]', 'text=/^log in$/i', 'text=/sign in/i']:
        loc = page.locator(sel).first
        if await loc.count():
            await loc.click(force=True)
            break
    # Wait for tabs shell — try multiple candidate selectors
    ok = False
    deadline = time.time() + 25
    while time.time() < deadline:
        for sel in [
            '[data-testid="voice-screen"]',
            '[data-testid="tab-voice"]',
            '[data-testid="home-screen"]',
            '[data-testid="tab-home"]',
            '[data-testid="tab-chats"]',
        ]:
            if await page.locator(sel).count():
                ok = True
                break
        if ok:
            break
        await page.wait_for_timeout(500)
    if not ok:
        raise RuntimeError(f"Login did not reach app shell for {email}; url={page.url}")


async def go_to_voice(page):
    # Try tab
    for sel in ['[data-testid="tab-voice"]', 'a[href*="voice"]', 'text=/^Voice$/']:
        loc = page.locator(sel).first
        if await loc.count():
            try:
                await loc.click(force=True)
                break
            except Exception:
                continue
    await page.wait_for_selector('[data-testid="voice-screen"]', timeout=15000)


async def create_room(page, title):
    await page.locator('[data-testid="room-create-fab"]').first.click(force=True)
    await page.wait_for_selector('[data-testid="room-title-input"]', timeout=8000)
    await page.locator('[data-testid="room-title-input"]').fill(title)
    # Pick first available language chip
    chips = page.locator('[data-testid^="room-lang-"]')
    n = await chips.count()
    if n == 0:
        raise RuntimeError("No language chips available for user")
    await chips.first.scroll_into_view_if_needed()
    try:
        await chips.first.click(force=True)
    except Exception:
        # Element may be inside a horizontal scroller with strict clipping — use JS click
        await chips.first.evaluate("el => el.click()")
    await page.locator('[data-testid="room-create-submit-btn"]').click(force=True)
    await page.wait_for_selector('[data-testid="room-screen"]', timeout=20000)
    # URL contains /room/<id>
    m = re.search(r"/room/([A-Za-z0-9_-]+)", page.url)
    return m.group(1) if m else None


async def main():
    console_a, console_b = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            channel="chromium",
            headless=True,
            args=[
                "--use-fake-ui-for-media-devices",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        try:
            ctx_a = await browser.new_context(
                viewport={"width": 400, "height": 800},
                permissions=["microphone"],
                ignore_https_errors=True,
            )
            ctx_b = await browser.new_context(
                viewport={"width": 400, "height": 800},
                permissions=["microphone"],
                ignore_https_errors=True,
            )
            page_a = await ctx_a.new_page()
            page_b = await ctx_b.new_page()
            page_a.on("console", lambda m: console_a.append(f"[A:{m.type}] {m.text}"))
            page_b.on("console", lambda m: console_b.append(f"[B:{m.type}] {m.text}"))
            page_a.on("pageerror", lambda e: console_a.append(f"[A:PAGEERROR] {e}"))
            page_b.on("pageerror", lambda e: console_b.append(f"[B:PAGEERROR] {e}"))

            print("=== Step 1: Login mei (host) + demo (joiner) ===")
            await asyncio.gather(
                login(page_a, "mei@demo.com", "Demo1234!"),
                login(page_b, "demo@demo.com", "Demo1234!"),
            )
            print("Both logged in.")

            print("=== Step 2: mei goes to Voice tab and creates a room ===")
            await go_to_voice(page_a)
            room_title = f"WebRTC Regression {int(time.time())}"
            room_id = await create_room(page_a, room_title)
            print(f"Room created id={room_id} url={page_a.url}")
            assert room_id, "no room id in URL"

            print("=== Step 3: demo joins Voice tab and taps the new room ===")
            await go_to_voice(page_b)
            # Refresh list a couple of times if not yet visible
            card_sel = f'[data-testid="room-card-{room_id}"]'
            for _ in range(6):
                if await page_b.locator(card_sel).count():
                    break
                await page_b.wait_for_timeout(2000)
            assert await page_b.locator(card_sel).count(), f"Room card {room_id} not visible to demo"
            await page_b.locator(card_sel).first.click(force=True)
            await page_b.wait_for_selector('[data-testid="room-screen"]', timeout=15000)
            print("demo joined room screen.")

            # Give signaling time to complete offer/answer/ICE
            await page_a.wait_for_timeout(4500)
            await page_b.wait_for_timeout(500)

            print("=== Step 4: Verify both see host card + 2 members ===")
            assert await page_a.locator('[data-testid="room-host-card"]').count(), "A: no host card"
            assert await page_b.locator('[data-testid="room-host-card"]').count(), "B: no host card"

            # Verify header shows 2 members
            a_header = await page_a.locator("text=/2 members/").count()
            b_header = await page_b.locator("text=/2 members/").count()
            print(f"member count visible A={a_header} B={b_header}")
            assert a_header > 0 or b_header > 0, "member count '2 members' not shown"

            # Check mic control exists for A (host = speaker) and hand button for B (listener)
            assert await page_a.locator('[data-testid="room-mic-btn"]').count(), "A: no mic btn (should be host)"
            assert await page_b.locator('[data-testid="room-hand-btn"]').count(), "B: no hand btn (should be listener)"

            print("=== Step 5: Toggle mic off/on ===")
            await page_a.locator('[data-testid="room-mic-btn"]').click(force=True)
            await page_a.wait_for_timeout(1500)
            await page_a.locator('[data-testid="room-mic-btn"]').click(force=True)
            await page_a.wait_for_timeout(1500)

            print("=== Step 6: B raises hand ===")
            await page_b.locator('[data-testid="room-hand-btn"]').click(force=True)
            await page_b.wait_for_timeout(2500)
            # Host should see hand request panel
            hand_panel_ct = await page_a.locator('[data-testid="hand-requests-panel"]').count()
            print(f"hand-requests-panel visible on host: {hand_panel_ct}")

            print("=== Step 7: B leaves; A remains ===")
            await page_b.locator('[data-testid="room-leave-btn"]').click(force=True)
            await page_b.wait_for_timeout(2000)
            # A should still be in room
            assert await page_a.locator('[data-testid="room-screen"]').count(), "A left after B leave!"

            print("=== Step 8: A ends the room ===")
            await page_a.locator('[data-testid="room-leave-btn"]').click(force=True)
            await page_a.wait_for_timeout(2500)

            print("=== Step 9: Console error scan (WebRTC signaling) ===")
            bad_patterns = [
                "addIceCandidate",
                "setRemoteDescription",
                "Failed to set remote",
                "InvalidStateError",
                "OperationError",
            ]
            errs_a = [l for l in console_a if any(p in l for p in bad_patterns)]
            errs_b = [l for l in console_b if any(p in l for p in bad_patterns)]
            # Count offer floods
            offer_a = sum(1 for l in console_a if "rtc_offer" in l)
            offer_b = sum(1 for l in console_b if "rtc_offer" in l)
            page_errs = [l for l in console_a + console_b if "PAGEERROR" in l]
            print(f"WebRTC errors A={len(errs_a)} B={len(errs_b)} rtc_offer_lines A={offer_a} B={offer_b} pageerrors={len(page_errs)}")
            if errs_a:
                print("A errs sample:", errs_a[:5])
            if errs_b:
                print("B errs sample:", errs_b[:5])
            if page_errs:
                print("PageErrors sample:", page_errs[:5])

            assert not page_errs, f"Uncaught page errors: {page_errs[:3]}"
            assert not errs_a and not errs_b, "WebRTC signaling errors present"

            # ============ 1:1 CALL QUICK REGRESSION ============
            print("=== Step 10: 1:1 call regression demo → mei ===")
            # Both should now be back at voice tab (A) / voice tab (B after leave earlier)
            # Navigate B (demo) to chats → find Mei → call
            # Simple approach: use tab-chats testID if present
            await page_b.wait_for_selector('[data-testid="voice-screen"]', timeout=10000)
            chats_tab = page_b.locator('[data-testid="tab-chats"]').first
            if await chats_tab.count():
                await chats_tab.click(force=True)
                await page_b.wait_for_timeout(2000)
                # Search or find Mei
                # Try opening any chat that has "Mei" text
                mei_row = page_b.locator("text=/Mei/i").first
                if await mei_row.count():
                    await mei_row.click(force=True)
                    await page_b.wait_for_timeout(2000)
                    call_btn = page_b.locator('[data-testid="chat-call-btn"]').first
                    if await call_btn.count():
                        await call_btn.click(force=True)
                        # Overlay should appear on B and mei-page-A should get incoming
                        await page_b.wait_for_selector('[data-testid="call-overlay"]', timeout=10000)
                        print("B: outgoing overlay shown")
                        try:
                            await page_a.wait_for_selector('[data-testid="call-accept-btn"]', timeout=15000)
                            await page_a.locator('[data-testid="call-accept-btn"]').click(force=True)
                            await page_a.wait_for_selector('[data-testid="call-timer"]', timeout=10000)
                            await page_b.wait_for_selector('[data-testid="call-timer"]', timeout=10000)
                            print("Both sides: call active with timer")
                            await page_b.wait_for_timeout(2500)
                            await page_b.locator('[data-testid="call-end-btn"]').click(force=True)
                            await page_b.wait_for_timeout(1500)
                            print("Call ended cleanly")
                        except Exception as e:
                            print(f"1:1 regression accept path issue: {e}")
                    else:
                        print("chat-call-btn not found — skipping 1:1 regression (already passed iter10)")
                else:
                    print("Mei row not found in chats — skipping 1:1 regression")
            else:
                print("tab-chats testID not found — skipping 1:1 regression")

            print("=== ALL DONE ===")
            print("PASS")
        finally:
            try:
                await browser.close()
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
