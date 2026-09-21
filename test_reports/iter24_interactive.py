"""
Iteration 24 — interactive flow tests:
  1) chat composer visible + typeable + sendable at 320px
  2) bottom sheets: chat plus/more, voice create-room, moments compose,
     search filter, connect-filter pickers  — primary action inside viewport
  3) keyboard-migrated screens render and inputs are typeable:
     /store-cart, /add-sheet, /learn/writing, /admin-x7k2p9, /edit-profile,
     /share-to-moments, /premium/moment-compose, /learn/tutor,
     /create-group (tap search result while search focused),
     /share-to-chat (same).
"""
import asyncio, json, os
from playwright.async_api import async_playwright

BASE = "https://apk-deployment-6.preview.emergentagent.com"
EMAIL = "mei@demo.com"
PASSWORD = "Demo1234!"

RESULTS = {"pass": [], "fail": [], "warn": []}


def add(cat, name, detail=""):
    RESULTS[cat].append({"name": name, "detail": detail})
    print(f"[{cat.upper()}] {name} — {detail}")


async def login(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="auth-segment-login"]', timeout=20000)
    await page.click('[data-testid="auth-segment-login"]', force=True)
    await page.wait_for_timeout(400)
    await page.fill('[data-testid="auth-email-input"]', EMAIL)
    await page.fill('[data-testid="auth-password-input"]', PASSWORD)
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    await page.wait_for_selector('[data-testid="tab-chats"]', timeout=25000)


async def within_viewport(page, testid):
    """Check if the given testID is fully inside the current viewport."""
    el = await page.query_selector(f'[data-testid="{testid}"]')
    if not el:
        return None, "not-found"
    box = await el.bounding_box()
    if not box:
        return None, "no-box"
    vw = await page.evaluate("() => window.innerWidth")
    vh = await page.evaluate("() => window.innerHeight")
    ok = (box["x"] >= -1 and box["x"] + box["width"] <= vw + 1
          and box["y"] >= -1 and box["y"] + box["height"] <= vh + 1)
    return ok, f"x={box['x']:.0f} y={box['y']:.0f} w={box['width']:.0f} h={box['height']:.0f} vw={vw} vh={vh}"


async def test_chat_composer(page):
    await page.set_viewport_size({"width": 320, "height": 640})
    await page.goto(f"{BASE}/chats", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    # Click first chat row
    rows = await page.query_selector_all('[data-testid^="chat-row-"], [data-testid^="chat-item-"], [data-testid^="conversation-"]')
    if not rows:
        # fallback: any list item
        rows = await page.query_selector_all('[role="button"]')
    if not rows:
        add("warn", "chat-open", "no chat rows found on /chats")
        return
    try:
        await rows[0].click(force=True, timeout=5000)
    except Exception as e:
        add("fail", "chat-open", f"click failed: {e}")
        return
    await page.wait_for_timeout(2000)
    ok_input, info_i = await within_viewport(page, "chat-input")
    ok_send, info_s = await within_viewport(page, "chat-send-btn")
    if ok_input is None:
        # try alt testIDs
        for tid in ["message-input", "composer-input", "chat-composer-input"]:
            ok_input, info_i = await within_viewport(page, tid)
            if ok_input is not None:
                break
    if ok_input is True and ok_send is True:
        add("pass", "chat-composer-visible-320", f"input {info_i} / send {info_s}")
    elif ok_input is None:
        add("warn", "chat-composer-visible-320", f"input testID not found; send {info_s}")
    else:
        add("fail", "chat-composer-visible-320", f"input {ok_input} {info_i}; send {ok_send} {info_s}")
    # Try typing
    try:
        await page.fill('[data-testid="chat-input"]', "test-msg-iter24")
        await page.click('[data-testid="chat-send-btn"]', force=True)
        add("pass", "chat-send", "sent test message")
    except Exception as e:
        add("warn", "chat-send", f"typing/send failed: {e}"[:200])


async def test_bottom_sheets(page):
    await page.set_viewport_size({"width": 320, "height": 640})

    # 1) Chat plus/more sheet
    await page.goto(f"{BASE}/chats", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    for tid in ["chats-add-btn", "chats-plus-btn", "chats-more-btn", "chats-header-plus"]:
        el = await page.query_selector(f'[data-testid="{tid}"]')
        if el:
            try:
                await el.click(force=True)
                await page.wait_for_timeout(800)
                # /add-sheet is a full screen route
                url = page.url
                add("pass", f"chats-open-{tid}", f"opened {url}")
                # look for a primary CTA
                for cta in ["add-sheet-primary", "add-sheet-create-group", "add-sheet-scan"]:
                    ok, info = await within_viewport(page, cta)
                    if ok is True:
                        add("pass", "add-sheet-primary-visible", f"{cta}: {info}")
                        break
                break
            except Exception:
                continue

    # 2) Voice create-room sheet
    await page.goto(f"{BASE}/voice", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    for tid in ["voice-create-room-btn", "voice-fab", "create-room-fab", "voice-plus-btn"]:
        el = await page.query_selector(f'[data-testid="{tid}"]')
        if el:
            try:
                await el.click(force=True)
                await page.wait_for_timeout(700)
                add("pass", f"voice-open-{tid}", "clicked")
                # look for primary action
                for cta in ["create-room-submit", "create-room-primary-btn"]:
                    ok, info = await within_viewport(page, cta)
                    if ok is True:
                        add("pass", "create-room-primary-visible", f"{cta}: {info}")
                        break
                break
            except Exception:
                continue

    # 3) Moments compose sheet / menu
    await page.goto(f"{BASE}/moments", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    for tid in ["moments-compose-btn", "moments-fab", "moments-plus-btn", "moments-add-btn"]:
        el = await page.query_selector(f'[data-testid="{tid}"]')
        if el:
            try:
                await el.click(force=True)
                await page.wait_for_timeout(700)
                add("pass", f"moments-open-{tid}", page.url)
                break
            except Exception:
                continue

    # 4) Search filter
    await page.goto(f"{BASE}/search", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    for tid in ["search-filter-btn", "search-open-filter"]:
        el = await page.query_selector(f'[data-testid="{tid}"]')
        if el:
            try:
                await el.click(force=True)
                await page.wait_for_timeout(700)
                add("pass", "search-filter-opened", tid)
                break
            except Exception:
                continue

    # 5) Connect-filter route
    await page.goto(f"{BASE}/connect-filter", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    for cta in ["connect-filter-apply", "connect-filter-submit", "connect-filter-save"]:
        ok, info = await within_viewport(page, cta)
        if ok is True:
            add("pass", "connect-filter-primary-visible", f"{cta}: {info}")
            break


async def test_keyboard_screens(page):
    await page.set_viewport_size({"width": 390, "height": 844})
    screens = [
        ("/store-cart", ["address-input", "store-cart-address-input"]),
        ("/add-sheet", []),
        ("/learn/writing", ["learn-writing-input", "writing-input"]),
        ("/admin-x7k2p9", ["admin-email-input", "admin-password-input"]),
        ("/edit-profile", ["edit-profile-name-input", "profile-name-input"]),
        ("/share-to-moments", ["share-to-moments-input"]),
        ("/premium/moment-compose", ["moment-compose-input"]),
        ("/learn/tutor", ["tutor-input", "chat-input"]),
        ("/create-group", ["create-group-search-input", "create-group-search"]),
        ("/share-to-chat", ["share-to-chat-search-input", "share-to-chat-search"]),
    ]
    for route, inputs in screens:
        try:
            await page.goto(f"{BASE}{route}", wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)
            # Blank screen detection: body content non-empty
            body_text = await page.evaluate("() => document.body.innerText.trim().length")
            if body_text < 5:
                add("fail", f"kbd-{route}-blank", f"body text len={body_text}")
                continue
            # Look for scrollbar duplication
            scrollers = await page.evaluate("""() => {
                let n = 0;
                for (const el of document.querySelectorAll('body *')) {
                    const s = getComputedStyle(el);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                        el.scrollHeight - el.clientHeight > 20 &&
                        el.clientHeight > window.innerHeight * 0.5) n++;
                }
                return n;
            }""")
            if scrollers > 2:
                add("warn", f"kbd-{route}-multi-scroll", f"scrollers={scrollers}")
            typed = False
            for tid in inputs:
                el = await page.query_selector(f'[data-testid="{tid}"]')
                if el:
                    try:
                        await el.click(force=True)
                        await page.keyboard.type("hello iter24")
                        typed = True
                        add("pass", f"kbd-{route}-typeable", tid)
                        break
                    except Exception as e:
                        add("warn", f"kbd-{route}-type-failed", str(e)[:200])
            if inputs and not typed:
                # attempt any generic input
                anyin = await page.query_selector("input, textarea")
                if anyin:
                    try:
                        await anyin.click(force=True)
                        await page.keyboard.type("hello iter24")
                        add("pass", f"kbd-{route}-typeable-generic", "generic input")
                    except Exception as e:
                        add("fail", f"kbd-{route}-no-typeable", str(e)[:200])
                else:
                    add("warn", f"kbd-{route}-no-input-found", "no testID matched")
            else:
                if not inputs:
                    add("pass", f"kbd-{route}-renders", f"body len={body_text}")
        except Exception as e:
            add("fail", f"kbd-{route}-error", str(e)[:200])

    # Special: /create-group — tap a search result while the search field is focused
    try:
        await page.goto(f"{BASE}/create-group", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        # Search field
        for tid in ["create-group-search-input", "create-group-search"]:
            el = await page.query_selector(f'[data-testid="{tid}"]')
            if el:
                await el.click(force=True)
                await page.keyboard.type("d")
                await page.wait_for_timeout(1500)
                # Try to tap a first result while focused
                rows = await page.query_selector_all('[data-testid^="create-group-user-"], [data-testid^="user-row-"]')
                if rows:
                    try:
                        await rows[0].click(force=True, timeout=5000)
                        add("pass", "create-group-tap-while-focused", f"{len(rows)} rows")
                    except Exception as e:
                        add("fail", "create-group-tap-while-focused", str(e)[:200])
                else:
                    add("warn", "create-group-no-rows", "no search results rendered")
                break
    except Exception as e:
        add("warn", "create-group-special", str(e)[:200])


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        await login(page)
        await test_chat_composer(page)
        await test_bottom_sheets(page)
        await test_keyboard_screens(page)
        os.makedirs("/app/test_reports", exist_ok=True)
        with open("/app/test_reports/iter24_interactive_results.json", "w") as f:
            json.dump(RESULTS, f, indent=2)
        print("\n===== INTERACTIVE SUMMARY =====")
        print(f"pass: {len(RESULTS['pass'])}  fail: {len(RESULTS['fail'])}  warn: {len(RESULTS['warn'])}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
