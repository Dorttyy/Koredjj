"""Iteration 23 E2E: real 1-to-1 WebRTC call between mei and diego on web preview."""

import asyncio
import sys
from playwright.async_api import async_playwright

BASE = "https://apk-build-debug-1.preview.emergentagent.com"
FAKE_ARGS = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
]


async def unlock_calculator(page):
    # No calc gate in this app — welcome → tap Login → auth screen
    try:
        await page.wait_for_selector('[data-testid="login-btn"]', timeout=6000)
        await page.click('[data-testid="login-btn"]', force=True)
        await page.wait_for_timeout(600)
    except Exception:
        return


async def login(page, email):
    await page.goto(BASE + "/", wait_until="domcontentloaded")
    await page.wait_for_timeout(2500)
    await unlock_calculator(page)
    # login screen
    await page.wait_for_selector('[data-testid="auth-email-input"]', timeout=15000)
    await page.fill('[data-testid="auth-email-input"]', email)
    await page.fill('[data-testid="auth-password-input"]', "Demo1234!")
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    # Wait for tabs / home
    await page.wait_for_timeout(5000)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=FAKE_ARGS)
        try:
            ctx_a = await browser.new_context(viewport={"width": 390, "height": 844}, permissions=["microphone"])
            ctx_b = await browser.new_context(viewport={"width": 390, "height": 844}, permissions=["microphone"])
            await ctx_a.grant_permissions(["microphone"], origin=BASE)
            await ctx_b.grant_permissions(["microphone"], origin=BASE)
            page_a = await ctx_a.new_page()
            page_b = await ctx_b.new_page()

            errs_a, errs_b = [], []
            page_a.on("pageerror", lambda e: errs_a.append(str(e)))
            page_b.on("pageerror", lambda e: errs_b.append(str(e)))
            page_a.on("console", lambda m: (errs_a.append(m.text) if m.type == "error" else None))
            page_b.on("console", lambda m: (errs_b.append(m.text) if m.type == "error" else None))

            print("[login A: mei]")
            await login(page_a, "mei@demo.com")
            print("[login B: diego]")
            await login(page_b, "diego@demo.com")

            # A opens chat with Diego from Connect tab.
            # Try tab connect → tap on Diego card
            await page_a.screenshot(path="/app/test_reports/iter23_shots/a_home.jpg", quality=40, type="jpeg", full_page=False)
            await page_b.screenshot(path="/app/test_reports/iter23_shots/b_home.jpg", quality=40, type="jpeg", full_page=False)

            # Get token from A's storage to hit /api/chats directly
            token_a = await page_a.evaluate("() => { try { const k=Object.keys(window.localStorage||{}); const out={}; for (const key of k) out[key]=window.localStorage.getItem(key); return out; } catch(e){return {};} }")
            print(f"A local storage keys: {list(token_a.keys())[:20]}")
            token_a_val = None
            for k, v in token_a.items():
                if "auth_token" in k or (isinstance(v, str) and len(v) > 40 and "." in v):
                    token_a_val = v
                    print(f"  candidate {k}: {v[:40]}...")
            # AsyncStorage stores JSON-encoded values → strip surrounding quotes
            if token_a_val and token_a_val.startswith('"') and token_a_val.endswith('"'):
                token_a_val = token_a_val[1:-1]
            # Fallback: login via API to get a fresh token
            import requests
            if not token_a_val:
                r = requests.post(f"{BASE}/api/auth/login", json={"email":"mei@demo.com","password":"Demo1234!"}, timeout=15).json()
                token_a_val = r["token"]
            diego = requests.post(f"{BASE}/api/auth/login", json={"email":"diego@demo.com","password":"Demo1234!"}, timeout=15).json()
            diego_id = diego["user"]["id"]
            conv = requests.post(
                f"{BASE}/api/chats",
                json={"partner_id": diego_id},
                headers={"Authorization": f"Bearer {token_a_val}"},
                timeout=15,
            ).json()
            conv_id = conv.get("id")
            print(f"conv id: {conv_id}")
            await page_a.goto(f"{BASE}/chat/{conv_id}", wait_until="domcontentloaded")
            await page_a.wait_for_timeout(4000)
            await page_a.screenshot(path="/app/test_reports/iter23_shots/a_chat.jpg", quality=40, type="jpeg", full_page=False)

            # Click voice-call button in chat header
            try:
                await page_a.click('[data-testid="chat-call-btn"]', force=True, timeout=5000)
                print("A: tapped chat-call-btn")
            except Exception as e:
                print(f"A: chat-call-btn not found: {e}")
                await page_a.screenshot(path="/app/test_reports/iter23_shots/a_nocall.jpg", quality=40, type="jpeg", full_page=False)
                return

            # B: wait for incoming overlay
            got_overlay = False
            try:
                await page_b.wait_for_selector('[data-testid="call-overlay"]', timeout=15000)
                await page_b.wait_for_selector('[data-testid="call-accept-btn"]', timeout=5000)
                got_overlay = True
                print("B: incoming overlay + accept-btn visible")
            except Exception as e:
                print(f"B: no incoming overlay: {e}")
                await page_b.screenshot(path="/app/test_reports/iter23_shots/b_no_overlay.jpg", quality=40, type="jpeg", full_page=False)

            if not got_overlay:
                return

            await page_b.screenshot(path="/app/test_reports/iter23_shots/b_incoming.jpg", quality=40, type="jpeg", full_page=False)
            await page_b.click('[data-testid="call-accept-btn"]', force=True)
            print("B: accepted")

            # Wait for connected state (call-timer)
            timer_a = timer_b = False
            for _ in range(30):
                await page_a.wait_for_timeout(1000)
                if not timer_a:
                    timer_a = await page_a.locator('[data-testid="call-timer"]').is_visible()
                if not timer_b:
                    timer_b = await page_b.locator('[data-testid="call-timer"]').is_visible()
                if timer_a and timer_b:
                    break
            print(f"A timer visible: {timer_a}, B timer visible: {timer_b}")

            # Check peer connection state and remote audio srcObject
            def pc_state_js():
                return """
                (() => {
                  const pcs = window.__peerConnections || [];
                  const state = pcs.map(pc => pc && (pc.connectionState || pc.iceConnectionState));
                  const audios = Array.from(document.querySelectorAll('audio'));
                  return {
                    n_audio: audios.length,
                    has_srcObject: audios.some(a => !!a.srcObject),
                    states: state,
                  };
                })();
                """
            audio_a = await page_a.evaluate("(() => { const a=Array.from(document.querySelectorAll('audio')); return { n:a.length, hasSrc: a.some(x=>!!x.srcObject) }; })()")
            audio_b = await page_b.evaluate("(() => { const a=Array.from(document.querySelectorAll('audio')); return { n:a.length, hasSrc: a.some(x=>!!x.srcObject) }; })()")
            print(f"A audio elements: {audio_a}")
            print(f"B audio elements: {audio_b}")

            await page_a.screenshot(path="/app/test_reports/iter23_shots/a_connected.jpg", quality=40, type="jpeg", full_page=False)
            await page_b.screenshot(path="/app/test_reports/iter23_shots/b_connected.jpg", quality=40, type="jpeg", full_page=False)

            # Mute test on A
            try:
                await page_a.click('[data-testid="call-mute-btn"]', force=True, timeout=3000)
                await page_a.wait_for_timeout(1000)
                muted_txt = await page_a.locator('text=You are muted').is_visible()
                print(f"A: muted text visible after tap: {muted_txt}")
                await page_a.click('[data-testid="call-mute-btn"]', force=True, timeout=3000)
                await page_a.wait_for_timeout(500)
                print("A: unmuted")
            except Exception as e:
                print(f"mute error: {e}")

            # End call on A
            try:
                await page_a.click('[data-testid="call-end-btn"]', force=True, timeout=3000)
                await page_a.wait_for_timeout(1500)
                a_overlay = await page_a.locator('[data-testid="call-overlay"]').is_visible()
                b_overlay = await page_b.locator('[data-testid="call-overlay"]').is_visible()
                print(f"After end: A overlay visible={a_overlay}, B overlay visible={b_overlay}")
            except Exception as e:
                print(f"end error: {e}")

            # Second call immediately without reload
            try:
                await page_a.click('[data-testid="chat-call-btn"]', force=True, timeout=3000)
                await page_a.wait_for_timeout(2500)
                b_overlay2 = await page_b.locator('[data-testid="call-overlay"]').is_visible()
                print(f"Second call: B overlay visible={b_overlay2}")
                # Decline path
                await page_b.click('[data-testid="call-decline-btn"]', force=True, timeout=3000)
                await page_b.wait_for_timeout(2000)
                a_overlay3 = await page_a.locator('[data-testid="call-overlay"]').is_visible()
                print(f"After decline: A overlay visible={a_overlay3}")
            except Exception as e:
                print(f"second call error: {e}")

            print("=== Errors A ===")
            for e in errs_a[-15:]:
                print(" ", e[:200])
            print("=== Errors B ===")
            for e in errs_b[-15:]:
                print(" ", e[:200])

        finally:
            await browser.close()


asyncio.run(main())
