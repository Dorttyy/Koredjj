"""
Iteration 25 — Bottom-sheet safe-area padding regression test.

For each sheet: open it, measure sheet.bottom vs viewport height,
verify last visible interactive child is inside viewport, close it,
capture console errors.
"""

import asyncio
import json
from playwright.async_api import async_playwright

BASE = "https://gmail-notify-service.preview.emergentagent.com"
EMAIL = "mei@demo.com"
PASSWORD = "Demo1234!"
MOBILE = {"width": 390, "height": 844}

REPORT = {"sheets": [], "notes": []}


async def login(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.wait_for_selector('[data-testid="auth-segment-login"]', timeout=20000)
    await page.click('[data-testid="auth-segment-login"]', force=True)
    await page.wait_for_timeout(400)
    await page.fill('[data-testid="auth-email-input"]', EMAIL)
    await page.fill('[data-testid="auth-password-input"]', PASSWORD)
    await page.click('[data-testid="auth-submit-btn"]', force=True)
    try:
        await page.wait_for_selector('[data-testid="tab-chats"]', timeout=20000)
    except Exception:
        await page.wait_for_timeout(3000)


async def measure_sheet(page, sheet_selector):
    return await page.evaluate(
        """(sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            const kids = el.querySelectorAll('[role=button], button, [data-testid]');
            let lastBtn = null; let maxBottom = 0;
            for (const k of kids) {
                const kr = k.getBoundingClientRect();
                if (kr.height < 4 || kr.width < 4) continue;
                if (kr.bottom > maxBottom) { maxBottom = kr.bottom; lastBtn = k; }
            }
            return {
                bottom: Math.round(r.bottom),
                top: Math.round(r.top),
                height: Math.round(r.height),
                width: Math.round(r.width),
                vh, vw,
                lastBtnTestID: lastBtn ? lastBtn.getAttribute('data-testid') : null,
                lastBtnBottom: lastBtn ? Math.round(lastBtn.getBoundingClientRect().bottom) : null,
                lastBtnInside: lastBtn ? (lastBtn.getBoundingClientRect().bottom <= vh + 0.5) : null,
                distanceBottomToVh: Math.round(vh - r.bottom),
            };
        }""",
        sheet_selector,
    )


async def probe(page, name, path, opener, sheet_sel, closer=None, pre_actions=None):
    errs = []
    def on_console(msg):
        if msg.type == "error":
            t = msg.text
            if any(x in t for x in ["Unexpected text node", "Failed to load resource",
                                    "favicon", "WebSocket", "expo-image", "AuthSessionMissingError"]):
                return
            errs.append(t[:200])
    page.on("console", on_console)
    entry = {"name": name, "path": path, "opener": opener, "sheet_selector": sheet_sel}
    try:
        if path:
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_timeout(1000)
        if pre_actions:
            await pre_actions(page)
        if opener:
            found = await page.query_selector(opener)
            if not found:
                entry["result"] = "OPENER_NOT_FOUND"
                REPORT["sheets"].append(entry)
                print(f"[sheet] {name}: OPENER_NOT_FOUND ({opener})")
                page.remove_listener("console", on_console)
                return
            await page.click(opener, force=True)
            await page.wait_for_timeout(700)
        m = await measure_sheet(page, sheet_sel)
        if not m:
            entry["result"] = "SHEET_NOT_FOUND"
        else:
            entry.update(m)
            if m["bottom"] > m["vh"] + 2:
                entry["result"] = "SHEET_OFF_SCREEN"
            elif m["lastBtnInside"] is False:
                entry["result"] = "ACTION_BUTTON_CLIPPED"
            else:
                entry["result"] = "OK"
        # Try close
        if closer:
            try:
                await page.click(closer, force=True, timeout=2000)
            except Exception:
                pass
        else:
            try:
                await page.keyboard.press("Escape")
            except Exception:
                pass
        await page.wait_for_timeout(400)
        entry["console_errors"] = errs
    except Exception as e:
        entry["result"] = f"EXCEPTION: {str(e)[:180]}"
        entry["console_errors"] = errs
    page.remove_listener("console", on_console)
    REPORT["sheets"].append(entry)
    print(f"[sheet] {name}: {entry.get('result')} bottom={entry.get('bottom')} vh={entry.get('vh')} lastBtnInside={entry.get('lastBtnInside')} errs={len(errs)}")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(viewport=MOBILE)
        page = await context.new_page()
        await login(page)

        # 1) chats more sheet (opens via chats-shortcut-more)
        await probe(page, "chats_more_sheet", "/chats",
                    '[data-testid="chats-shortcut-more"]',
                    '[data-testid="chats-more-sheet"]')

        # 2) moments custom filter
        await probe(page, "moments_custom_filter", "/moments",
                    '[data-testid="moments-filter-btn"]',
                    '[data-testid="moments-custom-filter"]',
                    closer='[data-testid="mcf-close"]')

        # 3) moment-compose 'Add a topic' tag sheet — testID compose-add-topic opens sheet
        await probe(page, "moment_compose_topic_sheet", "/moment-compose",
                    '[data-testid="compose-add-topic"]',
                    # find the sheet by presence of tags-done inside
                    'div:has([data-testid="compose-tags-done"])')

        # 4) premium/connect Teach on Premium apply sheet
        await probe(page, "premium_connect_apply", "/premium/connect",
                    '[data-testid="premium-connect-apply"]',
                    'div:has([data-testid="premium-apply-done"])',
                    closer='[data-testid="premium-apply-done"]')

        # 5) admin login + more sheet
        async def admin_login(pg):
            el = await pg.query_selector('[data-testid="admin-email-input"]')
            if el:
                await pg.fill('[data-testid="admin-email-input"]', "admin@lingua.app")
                await pg.fill('[data-testid="admin-password-input"]', "Admin1234!")
                await pg.click('[data-testid="admin-login-btn"]', force=True)
                await pg.wait_for_timeout(1500)
        await probe(page, "admin_more_sheet", "/admin-x7k2p9",
                    '[data-testid="admin-tab-more"]',
                    '[data-testid="admin-more-sheet"]',
                    pre_actions=admin_login)

        # 6) learn onboarding language sheet
        await probe(page, "onboarding_lang_sheet", "/learn/onboarding",
                    '[data-testid="learn-onboarding-language-pill"]',
                    'div:has([data-testid^="learn-onboarding-lang-"])')

        # 7) learn set-goal picker sheets (level, time, reason, weekly, minutes)
        for kind in ["level", "time", "reason", "weekly", "minutes"]:
            await probe(page, f"setgoal_{kind}", "/learn/set-goal",
                        f'[data-testid="learn-goal-{kind}"]',
                        # sheet contains ScrollView but no testID; find modal wrapper by role
                        '[role="dialog"], [aria-modal="true"]')

        # 12) edit-profile DOB picker sheets
        for f in ["year", "month", "day"]:
            await probe(page, f"editprofile_dob_{f}", "/edit-profile",
                        f'[data-testid="dob-{f}-btn"]',
                        'div:has([data-testid="dob-picker-close"])',
                        closer='[data-testid="dob-picker-close"]')

        # 13) WordOfDay sheet from /learn/dashboard
        await probe(page, "wotd_sheet", "/learn/dashboard",
                    '[data-testid="wotd-card"]',
                    '[data-testid="wotd-sheet"]')

        with open("/app/test_reports/iter25_sheets_results.json", "w") as f:
            json.dump(REPORT, f, indent=2)

        print("\n===== SUMMARY =====")
        ok = sum(1 for s in REPORT["sheets"] if s.get("result") == "OK")
        not_found_op = sum(1 for s in REPORT["sheets"] if s.get("result") == "OPENER_NOT_FOUND")
        not_found_sh = sum(1 for s in REPORT["sheets"] if s.get("result") == "SHEET_NOT_FOUND")
        off = sum(1 for s in REPORT["sheets"] if s.get("result") in ("SHEET_OFF_SCREEN", "ACTION_BUTTON_CLIPPED"))
        total = len(REPORT["sheets"])
        print(f"total: {total}  OK: {ok}  opener-missing: {not_found_op}  sheet-missing: {not_found_sh}  clipped: {off}")
        for s in REPORT["sheets"]:
            print(" -", s["name"], "=>", s.get("result"),
                  "" if s.get("result") != "OK" else f"(sheet bottom-to-vh={s.get('distanceBottomToVh')} lastBtn={s.get('lastBtnTestID')})")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
