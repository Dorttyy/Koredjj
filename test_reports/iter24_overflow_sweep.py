"""
Iteration 24 — Global mobile UI overflow / bottom-reachability sweep.

Runs on the production preview URL, logs in through the UI once, then visits
every route in the list at multiple mobile viewport widths and asserts:
  1) no element extends horizontally past the viewport (excluding elements
     inside a horizontal scroller / clipped ancestor);
  2) the last item of the primary scroll container is fully reachable inside
     its visible area after scrolling to the end.

Also runs a tablet + desktop regression pass on the same routes.
"""

import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

BASE = "https://gmail-notify-service.preview.emergentagent.com"
EMAIL = "mei@demo.com"
PASSWORD = "Demo1234!"

ROUTES = [
    "/(tabs)/connect",
    "/(tabs)/chats",
    "/(tabs)/moments",
    "/(tabs)/voice",
    "/(tabs)/profile",
    "/search",
    "/notifications",
    "/backpack",
    "/categories",
    "/store",
    "/store-cart",
    "/vocab-hub",
    "/coins",
    "/market",
    "/leaderboard",
    "/moments-ranking",
    "/edit-profile",
    "/connect-filter",
    "/create-group",
    "/add-sheet",
    "/placement-test",
    "/all-courses",
    "/learn/dashboard",
    "/lessons/learn",
    "/premium/connect",
    "/pro/home",
    "/admin-x7k2p9",
    "/welcome",
    "/auth",
]

MOBILE_WIDTHS = [(320, 568), (360, 640), (390, 844), (430, 932)]
LARGE = [(768, 1024), (1280, 900)]

REPORT = {
    "horizontal_overflow": [],   # {route,w,tag,text,rectRight,vw}
    "bottom_unreachable": [],    # {route,w,itemBottom,visBottom}
    "console_errors": [],        # {route,w,msg}
    "load_failed": [],           # {route,w,reason}
    "tab_bar_missing": [],       # {w,route,missingIds}
}


async def login(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="auth-segment-login"]', timeout=20000)
    await page.click('[data-testid="auth-segment-login"]', force=True)
    await page.wait_for_timeout(400)
    await page.fill('[data-testid="auth-email-input"]', EMAIL)
    await page.fill('[data-testid="auth-password-input"]', PASSWORD)
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    # Wait for either tab bar or generic home content
    try:
        await page.wait_for_selector('[data-testid="tab-chats"]', timeout=20000)
    except Exception:
        await page.wait_for_timeout(3000)
    print("[login] done")


OVERFLOW_JS = r"""
() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const nodes = document.querySelectorAll('body *');
  // Walk up to check whether any ancestor clips horizontally.
  const clipped = (el) => {
    let n = el.parentElement;
    let steps = 0;
    while (n && steps < 30) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'hidden' || s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflow === 'hidden' || s.overflow === 'auto' || s.overflow === 'scroll') return true;
      n = n.parentElement;
      steps++;
    }
    return false;
  };
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Ignore fixed/off-screen decorative
    if (r.right > vw + 0.5) {
      if (clipped(el)) continue;
      // Skip huge wrappers (>80% of body children of shell) — element itself must be leaf-ish
      if (el.children.length > 20) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' && r.right > vw + 40) {
        // still report large fixed overflow
      }
      const txt = (el.innerText || el.getAttribute('aria-label') || el.tagName).toString().slice(0, 60);
      bad.push({ tag: el.tagName, text: txt.replace(/\s+/g,' ').trim(), right: Math.round(r.right), vw });
      if (bad.length > 8) break;
    }
  }
  return bad;
}
"""

BOTTOM_JS = r"""
() => {
  // Find the tallest scrollable container (main scroll area)
  const all = document.querySelectorAll('body *');
  let best = null; let bestArea = 0;
  for (const el of all) {
    const s = getComputedStyle(el);
    const ok = ['auto','scroll'].includes(s.overflowY) || ['auto','scroll'].includes(s.overflow);
    if (!ok) continue;
    if (el.scrollHeight - el.clientHeight < 20) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { best = el; bestArea = area; }
  }
  if (!best) return { noScroll: true };
  best.scrollTop = best.scrollHeight;
  return new Promise(res => setTimeout(() => {
    // Find last visible-ish child
    const kids = best.querySelectorAll('*');
    let last = null;
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (r.height > 4 && r.width > 4) last = k;
    }
    const containerRect = best.getBoundingClientRect();
    if (!last) return res({ noItem: true });
    const r = last.getBoundingClientRect();
    res({
      itemBottom: Math.round(r.bottom),
      visBottom: Math.round(containerRect.bottom),
      delta: Math.round(r.bottom - containerRect.bottom),
      lastText: (last.innerText || last.tagName || '').slice(0, 50),
    });
  }, 400));
}
"""


async def check_route(page, route, w, h):
    console_errs = []

    def on_console(msg):
        if msg.type == "error":
            t = msg.text
            # ignore benign / known warnings
            if any(x in t for x in ["Unexpected text node", "Failed to load resource", "favicon", "WebSocket"]):
                return
            console_errs.append(t[:200])

    page.on("console", on_console)
    try:
        await page.set_viewport_size({"width": w, "height": h})
        # (tabs) group prefix isn't in the URL; strip it
        url_route = route.replace("/(tabs)", "")
        if url_route == "":
            url_route = "/"
        await page.goto(f"{BASE}{url_route}", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(1000)
    except Exception as e:
        REPORT["load_failed"].append({"route": route, "w": w, "reason": str(e)[:200]})
        return

    try:
        overflow = await page.evaluate(OVERFLOW_JS)
        for b in overflow:
            REPORT["horizontal_overflow"].append({"route": route, "w": w, **b})
    except Exception as e:
        pass

    try:
        bot = await page.evaluate(BOTTOM_JS)
        if isinstance(bot, dict) and "delta" in bot and bot["delta"] > 12:
            REPORT["bottom_unreachable"].append(
                {"route": route, "w": w, "delta": bot["delta"], "lastText": bot["lastText"]}
            )
    except Exception:
        pass

    for e in console_errs:
        REPORT["console_errors"].append({"route": route, "w": w, "msg": e})

    page.remove_listener("console", on_console)


async def check_tab_bar(page, w):
    await page.set_viewport_size({"width": w, "height": 720})
    await page.goto(f"{BASE}/chats", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    missing = []
    for tid in ["tab-chats", "tab-connect", "tab-moments", "tab-voice", "tab-profile"]:
        el = await page.query_selector(f'[data-testid="{tid}"]')
        if not el:
            missing.append(tid)
            continue
        box = await el.bounding_box()
        if not box or box["x"] + box["width"] > w + 0.5 or box["x"] < -0.5:
            missing.append(f"{tid}(x={box['x']:.0f},w={box['width']:.0f})")
    if missing:
        REPORT["tab_bar_missing"].append({"w": w, "route": "/chats", "missing": missing})
    # Tab switching test at this width
    if w == 320:
        for tid in ["tab-connect", "tab-moments", "tab-voice", "tab-profile", "tab-chats"]:
            try:
                await page.click(f'[data-testid="{tid}"]', force=True, timeout=3000)
                await page.wait_for_timeout(600)
            except Exception as e:
                REPORT["console_errors"].append({"route": f"/tab-switch/{tid}", "w": w, "msg": f"click failed: {e}"[:200]})


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        await login(page)

        # Tab bar checks at 320
        try:
            await check_tab_bar(page, 320)
        except Exception as e:
            print(f"[tab-bar] {e}")

        def save():
            os.makedirs("/app/test_reports", exist_ok=True)
            with open("/app/test_reports/iter24_overflow_results.json", "w") as f:
                json.dump(REPORT, f, indent=2)

        # Sweep mobile widths
        for (w, h) in MOBILE_WIDTHS:
            print(f"\n=== width {w}x{h} ===")
            for route in ROUTES:
                await check_route(page, route, w, h)
                sys.stdout.write(".")
                sys.stdout.flush()
            print()
            save()

        # Tablet + desktop regression (subset — just verify load + no horizontal overflow)
        for (w, h) in LARGE:
            print(f"\n=== LARGE {w}x{h} ===")
            for route in ROUTES:
                await check_route(page, route, w, h)
                sys.stdout.write(".")
                sys.stdout.flush()
            print()
            save()

        # Write report (final)
        save()

        # Summary print
        print("\n===== SUMMARY =====")
        print(f"horizontal_overflow entries: {len(REPORT['horizontal_overflow'])}")
        print(f"bottom_unreachable entries: {len(REPORT['bottom_unreachable'])}")
        print(f"tab_bar_missing: {len(REPORT['tab_bar_missing'])}")
        print(f"console_errors: {len(REPORT['console_errors'])}")
        print(f"load_failed: {len(REPORT['load_failed'])}")

        # Print a sample of each category
        for cat in ["horizontal_overflow", "bottom_unreachable", "tab_bar_missing", "console_errors", "load_failed"]:
            print(f"\n--- {cat} (first 15) ---")
            for row in REPORT[cat][:15]:
                print(row)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
