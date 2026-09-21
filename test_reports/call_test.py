"""
LinguaConnect - 1:1 Audio Call Retest (iteration 10)
Tests happy path, decline, offline, mic-denied feedback.
"""
import asyncio
import os
import time
import uuid
import requests
from playwright.async_api import async_playwright, Dialog

BASE = "https://gmail-notify-service.preview.emergentagent.com"
API = BASE + "/api"

DEMO = ("demo@demo.com", "Demo1234!")
MEI = ("mei@demo.com", "Demo1234!")

results = {}


async def dismiss_intro(page):
    """Landing page → click 'I already have an account' → auth screen."""
    try:
        await page.wait_for_selector('[data-testid="login-btn"]', timeout=15000)
        await page.click('[data-testid="login-btn"]', force=True)
    except Exception:
        pass


async def login(page, email, password):
    await page.goto(BASE, wait_until="domcontentloaded")
    await dismiss_intro(page)
    await page.wait_for_selector('[data-testid="auth-email-input"]', timeout=15000)
    await page.fill('[data-testid="auth-email-input"]', email)
    await page.fill('[data-testid="auth-password-input"]', password)
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    # Wait for tabs (chats screen) or onboarding
    # Wait for post-login shell (default tab may be connect or chats)
    await page.wait_for_function(
        "() => document.querySelector('[data-testid=\"chats-screen\"]') || document.querySelector('[data-testid=\"connect-screen\"]') || document.querySelector('[data-testid=\"onboarding-screen\"]')",
        timeout=20000,
    )


def api_login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()


def api_register(email, password, name):
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def api_create_convo(token, partner_id):
    r = requests.post(
        f"{API}/chats",
        json={"partner_id": partner_id},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


async def open_convo_with(page, partner_name_fragment):
    """From chats tab, find row with matching partner name and open it."""
    # Ensure we're on chats tab: try tab bar link
    try:
        chats_tab = page.locator('[href="/chats"], [href="/(tabs)/chats"]').first
        if await chats_tab.count() > 0:
            await chats_tab.click(force=True)
    except Exception:
        pass
    # Fallback: directly go to /chats route
    try:
        await page.wait_for_selector('[data-testid="chats-screen"]', timeout=4000)
    except Exception:
        await page.evaluate("() => { window.history.pushState({}, '', '/chats'); window.dispatchEvent(new PopStateEvent('popstate')); }")
        try:
            await page.wait_for_selector('[data-testid="chats-screen"]', timeout=6000)
        except Exception:
            await page.goto(BASE + "/chats", wait_until="domcontentloaded")
            await page.wait_for_selector('[data-testid="chats-screen"]', timeout=10000)
    # Wait for a chat row that contains the partner name
    row = page.locator('[data-testid^="chat-row-"]', has_text=partner_name_fragment).first
    await row.wait_for(state="visible", timeout=15000)
    await row.click(force=True)
    await page.wait_for_selector('[data-testid="chat-call-btn"]', timeout=10000)


async def test_happy_path(browser):
    print("\n===== TEST 1: Happy Path (call, accept, end) =====")
    ctx_a = await browser.new_context(permissions=["microphone"], viewport={"width": 390, "height": 844})
    ctx_b = await browser.new_context(permissions=["microphone"], viewport={"width": 390, "height": 844})
    page_a = await ctx_a.new_page()
    page_b = await ctx_b.new_page()
    a_dialogs = []
    b_dialogs = []
    page_a.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, a_dialogs)))
    page_b.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, b_dialogs)))
    page_a.on("console", lambda m: print(f"[A console.{m.type}]", m.text) if m.type in ("error", "warning") else None)
    page_b.on("console", lambda m: print(f"[B console.{m.type}]", m.text) if m.type in ("error", "warning") else None)

    try:
        await login(page_a, *DEMO)
        await login(page_b, *MEI)
        # Give WS time to connect
        await asyncio.sleep(2)
        await open_convo_with(page_a, "Mei")
        # Tap call
        await page_a.click('[data-testid="chat-call-btn"]', force=True)
        # A overlay appears with Ringing state
        await page_a.wait_for_selector('[data-testid="call-overlay"]', timeout=8000)
        # Ensure it stays open at least 3 seconds (does NOT close instantly)
        await asyncio.sleep(3)
        still_open_a = await page_a.locator('[data-testid="call-overlay"]').is_visible()
        assert still_open_a, "A's overlay closed within 3 seconds (regression!)"
        ringing = await page_a.locator('text=Ringing').is_visible()
        print(f"A overlay visible after 3s: {still_open_a}, showing Ringing: {ringing}")

        # B receives incoming
        await page_b.wait_for_selector('[data-testid="call-accept-btn"]', timeout=10000)
        print("B received incoming call, accepting...")
        await page_b.click('[data-testid="call-accept-btn"]', force=True)

        # Both should show active with timer
        await page_a.wait_for_selector('[data-testid="call-timer"]', timeout=10000)
        await page_b.wait_for_selector('[data-testid="call-timer"]', timeout=10000)
        print("Both sides show call-timer -> active state")
        await asyncio.sleep(2)
        # Check timer text incrementing
        t1 = await page_a.locator('[data-testid="call-timer"]').inner_text()
        await asyncio.sleep(2)
        t2 = await page_a.locator('[data-testid="call-timer"]').inner_text()
        print(f"Timer A t1={t1!r} t2={t2!r}")

        # Mute toggle
        await page_a.click('[data-testid="call-mute-btn"]', force=True)
        await asyncio.sleep(0.5)
        muted_visible = await page_a.locator('text=You are muted').is_visible()
        print(f"Mute label after tap: {muted_visible}")
        await page_a.click('[data-testid="call-mute-btn"]', force=True)  # unmute

        # A ends
        await page_a.click('[data-testid="call-end-btn"]', force=True)
        # Overlays close on both
        await page_a.wait_for_selector('[data-testid="call-overlay"]', state="hidden", timeout=5000)
        await page_b.wait_for_selector('[data-testid="call-overlay"]', state="hidden", timeout=5000)
        print("SUCCESS: overlays closed on both sides after A ended.")
        results["happy_path"] = "PASS"
    except Exception as e:
        print(f"FAIL happy_path: {e}")
        try:
            await page_a.screenshot(path="/tmp/happy_a.png", quality=40, full_page=False)
            await page_b.screenshot(path="/tmp/happy_b.png", quality=40, full_page=False)
        except Exception:
            pass
        results["happy_path"] = f"FAIL: {e}"
    finally:
        await ctx_a.close()
        await ctx_b.close()


async def handle_dialog(d: Dialog, bucket: list):
    bucket.append({"type": d.type, "message": d.message})
    print(f"[DIALOG] type={d.type} msg={d.message!r}")
    try:
        await d.accept()
    except Exception:
        pass


async def test_decline(browser):
    print("\n===== TEST 2: Decline =====")
    ctx_a = await browser.new_context(permissions=["microphone"], viewport={"width": 390, "height": 844})
    ctx_b = await browser.new_context(permissions=["microphone"], viewport={"width": 390, "height": 844})
    page_a = await ctx_a.new_page()
    page_b = await ctx_b.new_page()
    a_dialogs = []
    page_a.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, a_dialogs)))
    page_b.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, [])))

    try:
        await login(page_a, *DEMO)
        await login(page_b, *MEI)
        await asyncio.sleep(2)
        await open_convo_with(page_a, "Mei")
        await page_a.click('[data-testid="chat-call-btn"]', force=True)
        await page_a.wait_for_selector('[data-testid="call-overlay"]', timeout=8000)
        await page_b.wait_for_selector('[data-testid="call-decline-btn"]', timeout=10000)
        await page_b.click('[data-testid="call-decline-btn"]', force=True)
        # A overlay closes
        await page_a.wait_for_selector('[data-testid="call-overlay"]', state="hidden", timeout=5000)
        await page_b.wait_for_selector('[data-testid="call-overlay"]', state="hidden", timeout=5000)
        print("SUCCESS: decline closed overlays on both sides")
        results["decline"] = "PASS"
    except Exception as e:
        print(f"FAIL decline: {e}")
        results["decline"] = f"FAIL: {e}"
    finally:
        await ctx_a.close()
        await ctx_b.close()


async def test_offline(browser):
    print("\n===== TEST 3: Offline user =====")
    # Register a fresh user via API and create a conversation from demo
    demo_token = api_login(*DEMO)["token"]
    fresh_email = f"offline_{uuid.uuid4().hex[:8]}@test.com"
    fresh_user = api_register(fresh_email, "Demo1234!", "Offline Ghost")
    fresh_user_id = fresh_user["user"]["id"]
    print(f"Created fresh user {fresh_email} id={fresh_user_id}")
    convo = api_create_convo(demo_token, fresh_user_id)
    print(f"Created conversation {convo.get('id')}")

    ctx_a = await browser.new_context(permissions=["microphone"], viewport={"width": 390, "height": 844})
    page_a = await ctx_a.new_page()
    a_dialogs = []
    page_a.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, a_dialogs)))
    try:
        await login(page_a, *DEMO)
        await asyncio.sleep(2)
        # The new conversation should appear in chats list; open it by partner name
        await open_convo_with(page_a, "Offline Ghost")
        await page_a.click('[data-testid="chat-call-btn"]', force=True)
        # Overlay may appear briefly then close; wait for dialog
        # Give up to 8s for the offline dialog
        deadline = time.time() + 10
        while time.time() < deadline and not a_dialogs:
            await asyncio.sleep(0.3)
        print(f"Dialogs on A after offline call: {a_dialogs}")
        # Overlay should be hidden
        overlay_visible = False
        try:
            overlay_visible = await page_a.locator('[data-testid="call-overlay"]').is_visible()
        except Exception:
            pass
        print(f"Overlay visible after offline: {overlay_visible}")
        offline_dialog = any("offline" in d["message"].lower() for d in a_dialogs)
        if offline_dialog and not overlay_visible:
            results["offline"] = "PASS"
        else:
            results["offline"] = f"FAIL: dialogs={a_dialogs}, overlay_visible={overlay_visible}"
        print(f"Result: {results['offline']}")
    except Exception as e:
        print(f"FAIL offline: {e}")
        results["offline"] = f"FAIL: {e}"
    finally:
        await ctx_a.close()


async def test_mic_denied(browser):
    print("\n===== TEST 4: Mic denied feedback =====")
    # No microphone permission granted
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
    # Explicitly clear permissions for this origin (default already denies)
    page = await ctx.new_page()
    dialogs = []
    page.on("dialog", lambda d: asyncio.create_task(handle_dialog(d, dialogs)))
    try:
        await login(page, *DEMO)
        await asyncio.sleep(2)
        await open_convo_with(page, "Mei")
        await page.click('[data-testid="chat-call-btn"]', force=True)
        deadline = time.time() + 8
        while time.time() < deadline and not dialogs:
            await asyncio.sleep(0.3)
        print(f"Dialogs on mic-denied call: {dialogs}")
        mentions_mic = any("microphone" in d["message"].lower() or "mic" in d["message"].lower() for d in dialogs)
        overlay_visible = False
        try:
            overlay_visible = await page.locator('[data-testid="call-overlay"]').is_visible()
        except Exception:
            pass
        if mentions_mic and not overlay_visible:
            results["mic_denied"] = "PASS"
        else:
            results["mic_denied"] = f"FAIL: dialogs={dialogs}, overlay_visible={overlay_visible}"
        print(f"Result: {results['mic_denied']}")
    except Exception as e:
        print(f"FAIL mic_denied: {e}")
        results["mic_denied"] = f"FAIL: {e}"
    finally:
        await ctx.close()


async def main():
    async with async_playwright() as pw:
        # Fake media args for happy/decline/offline tests
        # Use full chromium (channel) — headless_shell doesn't implement fake media stream reliably
        browser_fake = await pw.chromium.launch(
            headless=True,
            channel="chromium",
            args=[
                "--use-fake-ui-for-media-devices",
                "--use-fake-device-for-media-stream",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        await test_happy_path(browser_fake)
        await test_decline(browser_fake)
        await test_offline(browser_fake)
        await browser_fake.close()

        # Separate browser WITHOUT fake media UI so mic denial triggers
        browser_deny = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        await test_mic_denied(browser_deny)
        await browser_deny.close()

    print("\n\n===== SUMMARY =====")
    for k, v in results.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    asyncio.run(main())
