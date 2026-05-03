"""Bilibili source — Selenium + headless Chrome with stealth.

Port of ``bili-investigate/bili_spider/spider.py`` adapted for use as a
library callable from a long-running service (no tqdm, no print, plays
nicely when invoked from a worker thread).

The Bilibili web/HTTP APIs are locked behind WBI signing + ``bili_ticket``
cookies, so without a logged-in session they reject anonymous calls.
Driving the actual page in a real browser side-steps the API gate, but
B站's anti-bot will redirect plain headless Chrome to a captcha page.
We mitigate with two layers:

* **Stealth tweaks** — drop the ``navigator.webdriver`` flag, add a
  realistic UA + ``Accept-Language``, hide automation switches.
* **Optional logged-in cookie** — if ``BILI_SESSDATA`` is set in the env
  the captcha is skipped entirely.

If the user has a B站 account, dropping a SESSDATA value into ``.env``
gives the most reliable scraping. Without it we still try, and surface
``last_error="captcha"`` on the creator row so the UI tells the user
they need to provide a cookie.
"""

from __future__ import annotations

import logging
import os
import random
import re
import time
from contextlib import contextmanager
from typing import Iterator, Optional, Tuple
from urllib.parse import quote

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from config import CHROMEDRIVER_PATH

from .base import DiscoveredVideo, SourceError


logger = logging.getLogger(__name__)


SPACE_VIDEOS_URL = "https://space.bilibili.com/{mid}/video"
SPACE_PROFILE_URL = "https://space.bilibili.com/{mid}"
SEARCH_USER_URL = "https://search.bilibili.com/upuser?keyword={kw}"


# Stealth payload: drops the navigator.webdriver flag and a few other
# automation tells before any page script runs. Effective enough that
# an anonymous visit lands on real space pages instead of a captcha,
# at least for casual rate. Heavier evasion would need
# undetected-chromedriver.
_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh', 'en-US', 'en']});
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
window.chrome = window.chrome || {runtime: {}};
const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
if (originalQuery) {
  window.navigator.permissions.query = (params) => (
    params.name === 'notifications'
      ? Promise.resolve({state: Notification.permission})
      : originalQuery(params)
  );
}
"""


def _user_agent() -> str:
    return os.getenv(
        "BILI_USER_AGENT",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    )


@contextmanager
def _browser():
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument(f"--user-agent={_user_agent()}")
    options.add_argument("--accept-lang=zh-CN,zh;q=0.9,en;q=0.8")
    options.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--disable-extensions")

    service = Service(executable_path=CHROMEDRIVER_PATH)
    driver = webdriver.Chrome(options=options, service=service)

    # Inject the stealth payload as a *new-document* script via CDP so it
    # runs on every navigation before any page JS, including same-origin
    # redirects that B站 uses to push the captcha.
    try:
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _STEALTH_JS})
    except Exception as exc:  # noqa: BLE001
        logger.warning("CDP stealth injection failed: %s", exc)

    # Optional: pre-seed a SESSDATA cookie for users who supplied one.
    # Cookies must be set after a navigation to the matching domain, so
    # we hit the home page once and then attach the cookie.
    sessdata = os.getenv("BILI_SESSDATA")
    if sessdata:
        try:
            driver.get("https://www.bilibili.com")
            driver.add_cookie({
                "name": "SESSDATA",
                "value": sessdata,
                "domain": ".bilibili.com",
                "path": "/",
                "secure": True,
                "httpOnly": True,
            })
            logger.info("attached BILI_SESSDATA cookie")
        except Exception as exc:  # noqa: BLE001
            logger.warning("BILI_SESSDATA cookie attach failed: %s", exc)

    try:
        yield driver
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _on_captcha_page(driver) -> bool:
    title = (driver.title or "")
    return "验证码" in title or "captcha" in title.lower()


class BilibiliSeleniumSource:
    """Browser-driven crawler for ``space.bilibili.com``."""

    def fetch(self, mid: str, *, max_pages: int = 5) -> Iterator[DiscoveredVideo]:
        """Yield videos from the UP's space, newest first.

        Stops after ``max_pages`` pages. Caller is expected to break early
        when consecutive duplicates are seen — handled in ``services.refresh``.
        """
        with _browser() as driver:
            driver.get(SPACE_VIDEOS_URL.format(mid=mid))

            if _on_captcha_page(driver):
                raise SourceError(
                    f"space {mid}: hit B站 captcha — set BILI_SESSDATA in .env to bypass"
                )

            try:
                WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.CLASS_NAME, "bili-video-card"))
                )
            except TimeoutException:
                logger.warning("space %s: timed out waiting for video cards", mid)
                if _on_captcha_page(driver):
                    raise SourceError(
                        f"space {mid}: hit B站 captcha — set BILI_SESSDATA in .env to bypass"
                    )
                # Don't raise — sometimes the cards exist but the wait
                # selector races with B站's own SPA hydration. Try parsing
                # what we have and let the caller decide.
                time.sleep(3)

            total_pages = max(1, min(_total_pages(driver), max_pages))
            logger.info("space %s: scanning %d pages", mid, total_pages)

            seen: set[str] = set()
            page = 1
            while page <= total_pages:
                for v in _parse_videos(driver):
                    if v.external_id in seen:
                        continue
                    seen.add(v.external_id)
                    yield v

                if page < total_pages:
                    if not _click_next(driver):
                        logger.info("space %s: no next-page button at page %d", mid, page)
                        break
                    time.sleep(2 + random.random())
                page += 1

    def resolve(self, name_or_mid: str) -> Tuple[str, str]:
        """Given a UP name or numeric mid, return ``(mid, display_name)``.

        If the input is a digit string, treat it as a mid and fetch the
        nickname from the profile page. Otherwise hit search.bilibili.com
        and pick the first user result.
        """
        s = name_or_mid.strip()
        if s.isdigit():
            return s, self._nickname_for(s)
        return self._search_user(s)

    def _nickname_for(self, mid: str) -> str:
        with _browser() as driver:
            driver.get(SPACE_PROFILE_URL.format(mid=mid))
            try:
                WebDriverWait(driver, 20).until(
                    lambda d: d.title and "出错啦" not in d.title
                )
            except TimeoutException:
                pass

            for selector in (".nickname", ".h-name", "#h-name", "[class*='nickname']"):
                try:
                    elem = driver.find_element(By.CSS_SELECTOR, selector)
                    if elem.text.strip():
                        return elem.text.strip()
                except Exception:
                    continue
            title = driver.title or ""
            if "的个人空间" in title:
                return title.split("的个人空间")[0].strip()
            if "的主页" in title:
                return title.split("的主页")[0].strip()
            return f"User_{mid}"

    def _search_user(self, name: str) -> Tuple[str, str]:
        with _browser() as driver:
            driver.get(SEARCH_USER_URL.format(kw=quote(name)))
            try:
                WebDriverWait(driver, 25).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".user-list .user-item, .search-list .user-list .item, [data-v-search-up], a[href*='space.bilibili.com']"))
                )
            except TimeoutException as exc:
                raise SourceError(f"timed out searching for '{name}'") from exc

            html = BeautifulSoup(driver.page_source, "html.parser")
            # The exact card markup has changed across Bilibili redesigns.
            # Match anything that links to space.bilibili.com/<digits> and
            # take the first one — search results are ordered by relevance.
            for a in html.select("a[href*='space.bilibili.com']"):
                href = a.get("href", "")
                m = re.search(r"space\.bilibili\.com/(\d+)", href)
                if not m:
                    continue
                mid = m.group(1)
                # Try to grab a nicer display name from inside the card.
                display = a.get_text(strip=True) or name
                # Sometimes the link text is empty / image-only; walk up
                # to the closest containing card and grab its title.
                if not display or display == "TA":
                    parent = a.find_parent(["div", "li"])
                    if parent:
                        title_el = parent.select_one(".title, .name, h2, h3")
                        if title_el:
                            display = title_el.get_text(strip=True) or display
                return mid, display or name
            raise SourceError(f"no Bilibili user found for '{name}'")


def _total_pages(driver) -> int:
    """Best-effort page-count detection. Defaults to 1 when unsure."""
    candidates = [
        "div.vui_pagenation",
        "div[class*='page']",
        ".be-pager",
    ]
    patterns = [r"共\s*(\d+)\s*页", r"(\d+)\s*页", r"/\s*(\d+)"]

    for sel in candidates:
        try:
            elems = driver.find_elements(By.CSS_SELECTOR, sel)
        except Exception:
            continue
        for elem in elems:
            text = elem.text or ""
            for pat in patterns:
                m = re.search(pat, text)
                if m:
                    try:
                        return int(m.group(1))
                    except ValueError:
                        pass

    # Fallback: read numeric labels from the pager buttons.
    try:
        buttons = driver.find_elements(
            By.CSS_SELECTOR,
            "button.be-pager-item, button[class*='page-item'], a.be-pager-item",
        )
        nums: list[int] = []
        for b in buttons:
            try:
                nums.append(int(b.text.strip()))
            except (ValueError, AttributeError):
                continue
        if nums:
            return max(nums)
    except Exception:
        pass
    return 1


def _parse_videos(driver) -> Iterator[DiscoveredVideo]:
    html = BeautifulSoup(driver.page_source, "html.parser")
    for card in html.find_all("div", class_="bili-video-card"):
        link = card.find("a")
        if not link or not link.get("href"):
            continue
        url = link["href"]
        if not url.startswith("http"):
            url = "https:" + url
        url = url.split("?")[0]
        bvid = url.rstrip("/").split("/")[-1]
        if not bvid.lower().startswith("bv"):
            continue

        title_el = card.find("div", class_="bili-video-card__title")
        title = ""
        if title_el and title_el.find("a"):
            title = title_el.find("a").get_text(strip=True)
        if not title:
            title = link.get_text(strip=True)

        duration: Optional[str] = None
        cover_el = card.find("div", class_="bili-video-card__cover")
        if cover_el:
            for span in cover_el.find_all("span"):
                if ":" in span.get_text(strip=True):
                    duration = span.get_text(strip=True)
                    break

        pub_date: Optional[str] = None
        sub_el = card.find("div", class_="bili-video-card__subtitle")
        if sub_el:
            pub_date = sub_el.get_text(strip=True) or None

        cover_url: Optional[str] = None
        img_el = card.find("img")
        if img_el and (img_el.get("src") or img_el.get("data-src")):
            src = img_el.get("src") or img_el.get("data-src") or ""
            if src.startswith("//"):
                src = "https:" + src
            cover_url = src.split("@")[0] or None

        yield DiscoveredVideo(
            external_id=bvid,
            title=title or "(no title)",
            url=url,
            pub_date=pub_date,
            duration=duration,
            cover_url=cover_url,
        )


def _click_next(driver) -> bool:
    try:
        # Dismiss any login/upgrade overlays that B站 occasionally inserts.
        for cls in ("[class*='close']", "[class*='Close']", ".lt-icon-close"):
            try:
                for btn in driver.find_elements(By.CSS_SELECTOR, cls):
                    if btn.is_displayed():
                        btn.click()
                        time.sleep(0.5)
            except Exception:
                pass

        next_btn = None
        try:
            for btn in driver.find_elements(By.CSS_SELECTOR, "button.vui_pagenation--btn-side"):
                if "下一页" in btn.text and "disabled" not in (btn.get_attribute("class") or ""):
                    next_btn = btn
                    break
        except Exception:
            pass

        if not next_btn:
            try:
                next_btn = driver.find_element(
                    By.XPATH,
                    "//button[contains(text(), '下一页') and not(contains(@class, 'disabled'))]",
                )
            except Exception:
                pass

        if not next_btn:
            return False

        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", next_btn)
        time.sleep(0.4)
        try:
            next_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", next_btn)
        time.sleep(2)
        return True
    except Exception as exc:
        logger.warning("click_next failed: %s", exc)
        return False
