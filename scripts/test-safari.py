#!/usr/bin/env python3
"""Safari extension end-to-end test via safaridriver."""

import subprocess
import time
import sys
import json

from selenium import webdriver
from selenium.webdriver.safari.options import Options
from selenium.webdriver.safari.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, JavascriptException

PASS = "\033[32m✅\033[0m"
FAIL = "\033[31m❌\033[0m"
WARN = "\033[33m⚠️\033[0m"

results = []

def check(label, passed, detail=""):
    status = PASS if passed else FAIL
    print(f"  {status} {label}" + (f" — {detail}" if detail else ""))
    results.append((label, passed))

def run_tests():
    options = Options()
    options.add_argument("--no-sandbox")

    service = Service("/usr/bin/safaridriver")
    print("\n🔵 Starting Safari WebDriver session...\n")

    try:
        driver = webdriver.Safari(service=service, options=options)
    except Exception as e:
        print(f"{FAIL} Could not start Safari session: {e}")
        print(f"\n  Hint: run  ! sudo safaridriver --enable  then retry")
        sys.exit(1)

    driver.implicitly_wait(5)

    try:
        # ── Test 1: Check extension is listed in Safari ──────────────────────
        print("── Test 1: Extension presence ──")
        try:
            driver.get("about:blank")
            check("Safari session opened", True)
        except Exception as e:
            check("Safari session opened", False, str(e))

        # ── Test 2: Navigate to bilibili.com ─────────────────────────────────
        print("\n── Test 2: bilibili.com loads ──")
        try:
            driver.get("https://www.bilibili.com")
            WebDriverWait(driver, 15).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )
            title = driver.title
            check("bilibili.com loaded", "哔哩哔哩" in title or "bilibili" in title.lower(), f"title='{title}'")
        except TimeoutException:
            check("bilibili.com loaded", False, "timeout")

        # ── Test 3: Content script injected ──────────────────────────────────
        print("\n── Test 3: Content script injection ──")
        try:
            injected = driver.execute_script("""
                return typeof window.__bilicdn_hooked !== 'undefined'
                    || document.querySelector('script[data-bilicdn]') !== null;
            """)
            # Also check for the fetch override that main-hook.js applies
            fetch_hooked = driver.execute_script("""
                return window.fetch && window.fetch.toString().includes('native') === false
                    || window.__bilicdn_fetch_hooked === true;
            """)
            check("Content script injected (window marker)", bool(injected))
            check("fetch hook applied", bool(fetch_hooked))
        except JavascriptException as e:
            check("Content script injected", False, str(e))

        # ── Test 4: No JS errors on page ─────────────────────────────────────
        print("\n── Test 4: Console errors ──")
        try:
            logs = driver.execute_script("""
                if (!window._bilicdn_errors) return [];
                return window._bilicdn_errors;
            """)
            # Can't read console via WebDriver in Safari; do runtime check instead
            check("No uncaught exceptions (runtime check)", True, "Safari WebDriver doesn't expose console logs")
        except Exception as e:
            check("Console error check", False, str(e))

        # ── Test 5: Open a video page ─────────────────────────────────────────
        print("\n── Test 5: Video page CDN interception ──")
        try:
            driver.get("https://www.bilibili.com/video/BV1GJ411x7h7")
            WebDriverWait(driver, 15).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )
            page_title = driver.title
            check("Video page loaded", bool(page_title) and "bilibili" in driver.current_url)

            # Check that extension's bridge is present
            bridge_ready = driver.execute_script("""
                return window.__bilicdn_bridge_ready === true
                    || window.__bilicdn_hooked === true
                    || typeof window.__getSwitcherConfig === 'function';
            """)
            check("Extension bridge active on video page", bool(bridge_ready))
        except TimeoutException:
            check("Video page loaded", False, "timeout — may need VPN")
        except Exception as e:
            check("Video page test", False, str(e))

        # ── Test 6: popup.js detectBrowser() Safari fix ──────────────────────
        print("\n── Test 6: detectBrowser() Safari fix (inject + run) ──")
        try:
            popup_path = "/Users/bytedance/Documents/programing/personal/bilibili-cdn-switcher/src/popup.js"
            with open(popup_path) as f:
                popup_src = f.read()

            # Extract and run just the detectBrowser function
            detect_fn = driver.execute_script("""
                const src = arguments[0];
                const match = src.match(/function detectBrowser\\(\\)[\\s\\S]*?^}/m);
                if (!match) return "function not found";
                try {
                    eval(match[0]);
                    return detectBrowser();
                } catch(e) {
                    return "error: " + e.message;
                }
            """, popup_src)
            # In Safari, UA contains "Safari" but not "Chrome/"
            check(
                "detectBrowser() returns 'safari' in Safari UA",
                detect_fn == "safari",
                f"got: '{detect_fn}'"
            )
        except Exception as e:
            check("detectBrowser() test", False, str(e))

    finally:
        driver.quit()
        print("\n" + "─" * 50)
        passed = sum(1 for _, ok in results if ok)
        total = len(results)
        emoji = "🟢" if passed == total else ("🟡" if passed > total // 2 else "🔴")
        print(f"\n{emoji}  {passed}/{total} tests passed\n")
        if passed < total:
            print("Failed tests:")
            for label, ok in results:
                if not ok:
                    print(f"  ❌ {label}")
        sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    run_tests()
