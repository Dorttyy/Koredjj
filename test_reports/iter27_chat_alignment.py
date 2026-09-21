"""
Iteration 27 - Chat bubble alignment measurement + call regression preflight.

Focus: for the seeded conversation dc1cf7d7-2f98-43dc-8a15-07b8ff742e03 opened as
mei@demo.com, at viewport widths 320/360/390/430 measure:
  a) every outgoing (mine) bubble/call-card right edge sits inside viewport w/
     equal right margin, and left edge > list padding + 40 (stays on right side)
  b) every incoming bubble/call-card left edge lands at the SAME x
     (padding 16 + avatar 40 + gap 8 = 64 expected)
  c) incoming call-event cards share that same x as incoming text bubbles
  d) no negative gaps, no horizontal overflow

We measure with page.evaluate and log the results.
"""
import asyncio, json, os, statistics

BASE = "https://apk-deployment-6.preview.emergentagent.com"
CONV = "dc1cf7d7-2f98-43dc-8a15-07b8ff742e03"

async def run(page):
    page.on("console", lambda m: print(f"CONSOLE[{m.type}]: {m.text[:180]}"))
    page.on("pageerror", lambda e: print(f"PAGEERROR: {e}"))

    async def login():
        await page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(3000)
        # login segment/inputs
        try:
            await page.wait_for_selector('[data-testid="auth-segment-login"]', timeout=15000)
            await page.click('[data-testid="auth-segment-login"]', force=True)
        except Exception:
            pass
        await page.fill('[data-testid="auth-email-input"]', "mei@demo.com")
        await page.fill('[data-testid="auth-password-input"]', "Demo1234!")
        await page.click('[data-testid="auth-submit-btn"]', force=True)
        await page.wait_for_timeout(3500)

    async def open_chat():
        await page.goto(f"{BASE}/chat/{CONV}", wait_until="domcontentloaded", timeout=45000)
        # allow FlatList to render
        await page.wait_for_selector('[data-testid="chat-screen"]', timeout=20000)
        await page.wait_for_timeout(2500)

    # Login once at 390
    await page.set_viewport_size({"width": 390, "height": 844})
    await login()

    all_results = {}
    widths = [320, 360, 390, 430]

    # Measurement JS. Returns list of rows detected.
    # We use React fiber `sender_id` via a data attribute? Not available.
    # Strategy: rows on the FlatList are direct children of the scroller. Each
    # renderItem returns one of: dateSep Text, systemMsg Text, sticker Pressable,
    # callRow View, roomShareRow View, or bubbleRow View. We classify by looking
    # at children markup + which side (mine vs theirs) via computed alignSelf/
    # justifyContent OR the presence of avatarWrap/avatarSpacer.
    js_measure = r"""
    () => {
      const vw = window.innerWidth;
      // Find message list scroll container: FlatList content wrapper contains
      // the partnerCard (testID chat-intro-card).
      const intro = document.querySelector('[data-testid="chat-intro-card"]');
      if (!intro) return { error: 'no intro card', vw };
      const list = intro.parentElement;
      const listRect = list.getBoundingClientRect();
      const padLeft = listRect.left;      // includes scroller offset
      const padRight = vw - listRect.right;
      const rows = Array.from(list.children).filter(c => c !== intro);
      const items = [];
      const isTextChild = (el) => el && el.textContent && el.tagName;

      const classify = (row) => {
        // Recognize call cards by icon + status text nodes.
        const rect = row.getBoundingClientRect();
        if (rect.width === 0) return null;
        const text = (row.textContent || '').trim();
        // find inner "bubble" candidate - the innermost element with
        // a rounded background. Heuristic: elements with borderRadius set.
        const walkers = [row, ...row.querySelectorAll('*')];
        let bubble = null;
        for (const el of walkers) {
          const cs = getComputedStyle(el);
          const r = parseFloat(cs.borderTopLeftRadius || '0');
          if (r >= 8 && el.getBoundingClientRect().width > 40) {
            bubble = el; break;
          }
        }
        const b = (bubble || row).getBoundingClientRect();
        // classify side by center of the row relative to viewport
        const rowCenter = (rect.left + rect.right) / 2;
        const side = rowCenter > vw / 2 ? 'mine' : 'theirs';
        // detect call card: text contains "Voice Call" or duration pattern m:ss
        // or "Missed" / "cancelled"
        const isCall = /Voice Call|Incoming call|Outgoing call|Missed call|Call cancelled/.test(text);
        // detect sticker: img with gstatic notoemoji
        const hasStickerImg = !!row.querySelector('img[src*="notoemoji"]');
        // detect date separator: a single Text row centered, short text
        const looksDate = row.children.length <= 1 && rect.height < 30 && text.length < 30;
        return {
          side, isCall, hasStickerImg, looksDate,
          rowLeft: rect.left, rowRight: rect.right, rowWidth: rect.width,
          bubbleLeft: b.left, bubbleRight: b.right, bubbleWidth: b.width, bubbleTop: b.top, bubbleBottom: b.bottom,
          text: text.slice(0, 60),
        };
      };
      for (const r of rows) {
        const info = classify(r);
        if (info) items.push(info);
      }
      // Check horizontal overflow of document
      const overflow = document.documentElement.scrollWidth > vw;
      return { vw, padLeft, padRight, items, overflow };
    }
    """

    for w in widths:
        print(f"\n=== Viewport {w}x844 ===")
        await page.set_viewport_size({"width": w, "height": 844})
        await open_chat()
        # scroll up a bit to load history, then to bottom to include call cards
        try:
            await page.evaluate("window.scrollTo(0, 0)")
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        data = await page.evaluate(js_measure)
        all_results[str(w)] = data
        if data.get('error'):
            print(f"  ERR: {data['error']}")
            continue
        items = [i for i in data['items'] if not i['looksDate'] and i['bubbleWidth'] > 0]
        mine = [i for i in items if i['side'] == 'mine']
        theirs = [i for i in items if i['side'] == 'theirs']
        print(f"  rows={len(items)} mine={len(mine)} theirs={len(theirs)} overflow={data['overflow']}")
        print(f"  padLeft={data['padLeft']:.1f} padRight={data['padRight']:.1f}")

        # Check (a) outgoing right margins
        right_margins = [w - i['bubbleRight'] for i in mine]
        left_edges_mine = [i['bubbleLeft'] for i in mine]
        # Check (b,c) incoming lefts should match
        left_edges_th = [i['bubbleLeft'] for i in theirs]
        th_call = [i for i in theirs if i['isCall']]
        th_bub  = [i for i in theirs if not i['isCall'] and not i['hasStickerImg']]

        if right_margins:
            print(f"  outgoing right margins: min={min(right_margins):.1f} max={max(right_margins):.1f} mean={statistics.mean(right_margins):.1f}")
            print(f"  outgoing left edges min={min(left_edges_mine):.1f} (should be > padLeft+40={data['padLeft']+40:.1f})")
        if left_edges_th:
            uniq = sorted(set(round(x,1) for x in left_edges_th))
            print(f"  incoming left edges unique={uniq}")
        if th_call and th_bub:
            c_lefts = sorted(set(round(x['bubbleLeft'],1) for x in th_call))
            b_lefts = sorted(set(round(x['bubbleLeft'],1) for x in th_bub))
            print(f"  incoming CALL lefts={c_lefts}  vs  incoming BUBBLE lefts={b_lefts}")

    with open('/app/test_reports/iter27_alignment_results.json','w') as f:
        json.dump(all_results, f, indent=2, default=str)
    print("\nSaved /app/test_reports/iter27_alignment_results.json")

# playwright runner expects to be inside async fn with page. The harness runs
# our top-level statements. Nothing to do here as the tool wraps this.
await run(page)
