"""Iteration 25 — 1-to-1 WebRTC call smoke re-check between mei and diego."""

import asyncio
from playwright.async_api import async_playwright
import requests

BASE = "https://gmail-notify-service.preview.emergentagent.com"
FAKE_ARGS = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
]


async def login(page, email):
    await page.goto(BASE + "/auth", wait_until="domcontentloaded")
    try:
        await page.wait_for_selector('[data-testid="auth-segment-login"]', timeout=15000)
        await page.click('[data-testid="auth-segment-login"]', force=True)
        await page.wait_for_timeout(400)
    except Exception:
        pass
    await page.wait_for_selector('[data-testid="auth-email-input"]', timeout=10000)
    await page.fill('[data-testid="auth-email-input"]', email)
    await page.fill('[data-testid="auth-password-input"]', "Demo1234!")
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    try:
        await page.wait_for_selector('[data-testid="tab-chats"]', timeout=15000)
    except Exception:
        await page.wait_for_timeout(4000)


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

            # Use API to get conv id
            a_login = requests.post(f"{BASE}/api/auth/login", json={"email":"mei@demo.com","password":"Demo1234!"}, timeout=15).json()
            b_login = requests.post(f"{BASE}/api/auth/login", json={"email":"diego@demo.com","password":"Demo1234!"}, timeout=15).json()
            token_a = a_login["token"]
            diego_id = b_login["user"]["id"]
            conv = requests.post(
                f"{BASE}/api/chats",
                json={"partner_id": diego_id},
                headers={"Authorization": f"Bearer {token_a}"},
                timeout=15,
            ).json()
            conv_id = conv.get("id")
            print(f"conv id: {conv_id}")

            await page_a.goto(f"{BASE}/chat/{conv_id}", wait_until="domcontentloaded")
            await page_a.wait_for_timeout(3500)

            try:
                await page_a.click('[data-testid="chat-call-btn"]', force=True, timeout=6000)
                print("A: tapped chat-call-btn")
            except Exception as e:
                print(f"A: chat-call-btn missing: {e}")
                return

            got_overlay = False
            try:
                await page_b.wait_for_selector('[data-testid="call-overlay"]', timeout=15000)
                await page_b.wait_for_selector('[data-testid="call-accept-btn"]', timeout=5000)
                got_overlay = True
                print("B: incoming overlay + accept-btn visible")
            except Exception as e:
                print(f"B: no incoming overlay: {e}")

            if not got_overlay:
                return

            await page_b.click('[data-testid="call-accept-btn"]', force=True)
            print("B: accepted")

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

            try:
                await page_a.click('[data-testid="call-end-btn"]', force=True, timeout=3000)
                await page_a.wait_for_timeout(1500)
                a_over = await page_a.locator('[data-testid="call-overlay"]').is_visible()
                b_over = await page_b.locator('[data-testid="call-overlay"]').is_visible()
                print(f"After end: A overlay={a_over}, B overlay={b_over}")
            except Exception as e:
                print(f"end err: {e}")

            print("=== Errors A (last 8) ===")
            for e in errs_a[-8:]:
                print(" ", e[:180])
            print("=== Errors B (last 8) ===")
            for e in errs_b[-8:]:
                print(" ", e[:180])

            print(f"\nRESULT: timer_a={timer_a} timer_b={timer_b}")
        finally:
            await browser.close()


asyncio.run(main())
