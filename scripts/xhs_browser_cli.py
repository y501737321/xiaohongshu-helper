#!/usr/bin/env python3
"""
Standalone Xiaohongshu browser CLI.

This script does not require Codex or the Codex Chrome extension. It uses
Playwright with a persistent local browser profile, so a normal Windows user can
log in once and reuse the saved session.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote, urlencode


BASE_URL = "https://www.xiaohongshu.com"
SEARCH_URL = f"{BASE_URL}/search_result"

RISK_TEXT_MARKERS = (
    "安全验证",
    "风险验证",
    "风险检测",
    "请完成验证",
    "拖动滑块",
    "滑块验证",
    "验证码",
    "访问异常",
    "操作频繁",
    "人机验证",
    "环境异常",
    "账号异常",
)

SORT_LABELS = {
    "comprehensive": "综合",
    "default": "综合",
    "latest": "最新",
    "likes": "最多点赞",
    "comments": "最多评论",
    "collects": "最多收藏",
}

NOTE_TYPE_LABELS = {
    "all": "不限",
    "video": "视频",
    "image": "图文",
    "text": "图文",
}

PUBLISH_TIME_LABELS = {
    "all": "不限",
    "day": "一天内",
    "week": "一周内",
    "half-year": "半年内",
    "half_year": "半年内",
    "halfyear": "半年内",
}

SEARCH_SCOPE_LABELS = {
    "all": "不限",
    "viewed": "已看过",
    "unviewed": "未看过",
    "following": "已关注",
}

LOCATION_LABELS = {
    "all": "不限",
    "same-city": "同城",
    "same_city": "同城",
    "city": "同城",
    "nearby": "附近",
}

FILTER_OPTIONS = {
    "sort": {
        "group_label": "排序依据",
        "options": [
            {"value": "comprehensive", "label": "综合"},
            {"value": "latest", "label": "最新"},
            {"value": "likes", "label": "最多点赞"},
            {"value": "comments", "label": "最多评论"},
            {"value": "collects", "label": "最多收藏"},
        ],
        "aliases": {"default": "comprehensive"},
    },
    "note_type": {
        "group_label": "笔记类型",
        "options": [
            {"value": "all", "label": "不限"},
            {"value": "video", "label": "视频"},
            {"value": "image", "label": "图文"},
        ],
        "aliases": {"text": "image"},
    },
    "publish_time": {
        "group_label": "发布时间",
        "options": [
            {"value": "all", "label": "不限"},
            {"value": "day", "label": "一天内"},
            {"value": "week", "label": "一周内"},
            {"value": "half-year", "label": "半年内"},
        ],
        "aliases": {"half_year": "half-year", "halfyear": "half-year"},
    },
    "scope": {
        "group_label": "搜索范围",
        "options": [
            {"value": "all", "label": "不限"},
            {"value": "viewed", "label": "已看过"},
            {"value": "unviewed", "label": "未看过"},
            {"value": "following", "label": "已关注"},
        ],
        "aliases": {},
    },
    "location": {
        "group_label": "位置距离",
        "options": [
            {"value": "all", "label": "不限"},
            {"value": "same-city", "label": "同城"},
            {"value": "nearby", "label": "附近"},
        ],
        "aliases": {"same_city": "same-city", "city": "same-city"},
    },
}

FILTER_GROUP_LABELS = [item["group_label"] for item in FILTER_OPTIONS.values()]


class RunnerError(RuntimeError):
    pass


def _json_stdout(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _eprint(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def default_profile_dir() -> Path:
    override = os.environ.get("XHS_BROWSER_PROFILE")
    if override:
        return Path(override).expanduser()

    system = platform.system().lower()
    if system == "windows":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "xiaohongshu_helper" / "browser-profile"
    if system == "darwin":
        return Path.home() / "Library" / "Application Support" / "xiaohongshu_helper" / "browser-profile"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "xiaohongshu_helper" / "browser-profile"


def import_playwright():
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - exercised by user env
        raise RunnerError(
            "Playwright is not installed. Run: python -m pip install -r scripts/requirements-xhs-runner.txt "
            "and then: python -m playwright install chromium"
        ) from exc
    return sync_playwright, PlaywrightTimeoutError


def _filter_choices(mapping: Dict[str, str]) -> List[str]:
    return sorted(set(mapping.keys()) | set(mapping.values()))


def _resolve_filter_label(group_label: str, mapping: Dict[str, str], value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    clean = str(value).strip()
    if not clean:
        return None
    if clean in mapping:
        return mapping[clean]
    if clean in mapping.values():
        return clean
    normalized = clean.lower().replace("_", "-")
    if normalized in mapping:
        return mapping[normalized]
    raise RunnerError(f"Unsupported {group_label} filter: {value}")


@dataclass
class BrowserOptions:
    profile_dir: Path
    headless: bool
    browser_channel: str
    timeout_ms: int
    slow_mo_ms: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class XhsBrowser:
    def __init__(self, options: BrowserOptions):
        self.options = options
        self._playwright = None
        self._context = None
        self.page = None
        self._timeout_error = None

    def __enter__(self) -> "XhsBrowser":
        sync_playwright, timeout_error = import_playwright()
        self._timeout_error = timeout_error
        self._playwright = sync_playwright().start()
        self.options.profile_dir.mkdir(parents=True, exist_ok=True)

        launch_args: Dict[str, Any] = {
            "headless": self.options.headless,
            "viewport": {"width": 1280, "height": 900},
            "locale": "zh-CN",
            "slow_mo": self.options.slow_mo_ms,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--lang=zh-CN",
            ],
        }
        if self.options.latitude is not None and self.options.longitude is not None:
            launch_args["geolocation"] = {
                "latitude": self.options.latitude,
                "longitude": self.options.longitude,
            }
            launch_args["permissions"] = ["geolocation"]

        last_error: Optional[Exception] = None
        for channel in self._candidate_channels():
            candidate_args = dict(launch_args)
            if channel != "chromium":
                candidate_args["channel"] = channel
            try:
                self._context = self._playwright.chromium.launch_persistent_context(
                    str(self.options.profile_dir),
                    **candidate_args,
                )
                break
            except Exception as exc:
                last_error = exc
                _eprint(f"Browser channel '{channel}' is unavailable: {str(exc).splitlines()[0]}")

        if not self._context:
            raise RunnerError(
                "Cannot launch browser. Install Chrome or Edge, or run: python -m playwright install chromium. "
                f"Last error: {last_error}"
            )

        self._context.set_default_timeout(self.options.timeout_ms)
        self.page = self._context.pages[0] if self._context.pages else self._context.new_page()
        if self.options.latitude is not None and self.options.longitude is not None:
            self._context.grant_permissions(["geolocation"], origin=BASE_URL)
        return self

    def _candidate_channels(self) -> List[str]:
        requested = (self.options.browser_channel or "auto").strip().lower()
        aliases = {"edge": "msedge", "google-chrome": "chrome"}
        requested = aliases.get(requested, requested)
        if requested in ("", "auto"):
            if platform.system().lower() == "windows":
                return ["chrome", "msedge", "chromium"]
            return ["chrome", "msedge", "chromium"]
        if requested == "chromium":
            return ["chromium"]
        return [requested, "chromium"]

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self._context:
                self._context.close()
        finally:
            if self._playwright:
                self._playwright.stop()

    def goto(self, url: str) -> None:
        assert self.page is not None
        self.page.goto(url, wait_until="domcontentloaded", timeout=self.options.timeout_ms)
        self.sleep(0.8, 1.5)

    def sleep(self, low: float = 0.8, high: float = 1.8) -> None:
        time.sleep(random.uniform(low, high))

    def body_text(self, limit: int = 8000) -> str:
        try:
            return self.page.locator("body").inner_text(timeout=3000)[:limit]
        except Exception:
            return ""

    def looks_like_verification(self) -> bool:
        url = (self.page.url or "").lower()
        if "captcha" in url or "verify" in url:
            return True
        text = self.body_text()
        return any(marker in text for marker in RISK_TEXT_MARKERS)

    def looks_like_login_required(self) -> bool:
        text = self.body_text(5000)
        if "登录后查看更多" in text or "登录后才能" in text:
            return True
        return "登录" in text and ("手机号" in text or "扫码" in text or "验证码" in text)

    def wait_for_manual_verification(self, timeout_s: int) -> None:
        if not self.looks_like_verification():
            return
        if self.options.headless:
            raise RunnerError("NEEDS_MANUAL_VERIFICATION: rerun with --no-headless and complete the browser check.")

        _eprint("小红书出现验证，请在打开的浏览器里完成验证。")
        deadline = time.time() + max(30, timeout_s)
        while time.time() < deadline:
            if not self.looks_like_verification():
                self.sleep(0.5, 1.0)
                return
            time.sleep(2)
        raise RunnerError("MANUAL_VERIFICATION_TIMEOUT")

    def check_logged_in(self) -> bool:
        self.goto(f"{BASE_URL}/explore")
        text = self.body_text()
        has_profile_link = self.page.locator('a[href*="/user/profile/"]').count() > 0
        has_login_prompt = "登录" in text and ("手机号" in text or "扫码" in text or "验证码" in text)
        return bool(has_profile_link and not has_login_prompt)

    def build_search_url(self, keyword: str) -> str:
        query = urlencode(
            {
                "keyword": keyword,
                "source": "web_explore_feed",
                "type": "51",
            },
            quote_via=quote,
        )
        return f"{SEARCH_URL}?{query}"

    def open_search(self, keyword: str) -> None:
        if not keyword.strip():
            raise RunnerError("keyword is required")
        self.goto(self.build_search_url(keyword.strip()))
        self.wait_for_manual_verification(180)
        self.wait_for_cards_or_empty()

    def wait_for_cards_or_empty(self) -> None:
        end = time.time() + (self.options.timeout_ms / 1000)
        while time.time() < end:
            if self.looks_like_verification():
                return
            if self.page.locator("section.note-item").count() > 0:
                return
            text = self.body_text(3000)
            if "没有筛选到相关内容" in text or "没找到相关内容" in text or "薯队长" in text:
                return
            time.sleep(0.5)

    def open_filter_menu(self) -> None:
        if "排序依据" in self.body_text(4000):
            return

        for label in ("已筛选", "筛选"):
            locator = self.page.get_by_text(label, exact=True)
            count = locator.count()
            for i in range(count - 1, -1, -1):
                try:
                    item = locator.nth(i)
                    box = item.bounding_box(timeout=1200)
                    if not box:
                        continue
                    self.page.mouse.click(box["x"] + box["width"] + 18, box["y"] + box["height"] / 2)
                    self.sleep(0.4, 0.8)
                    if "排序依据" in self.body_text(4000):
                        return
                    item.click(force=True, timeout=1200)
                    self.sleep(0.4, 0.8)
                    if "排序依据" in self.body_text(4000):
                        return
                except Exception:
                    continue

        self.page.evaluate(
            """() => {
                const exact = ['筛选', '已筛选'];
                const nodes = Array.from(document.querySelectorAll('span,div,button'));
                const el = nodes.find(n => exact.includes((n.innerText || n.textContent || '').trim()));
                const targets = [el, el?.nextElementSibling, el?.parentElement, el?.parentElement?.nextElementSibling, el?.parentElement?.parentElement].filter(Boolean);
                for (const target of targets) {
                    try { target.click(); return; } catch (_) {}
                }
            }"""
        )
        self.sleep(0.6, 1.0)
        if "排序依据" not in self.body_text(4000):
            if self.looks_like_login_required():
                raise RunnerError("NOT_LOGGED_IN: run login first, then retry this command.")
            raise RunnerError("Cannot open filter menu. The page layout may have changed.")

    def click_filter_option(self, group_label: str, option_label: str) -> None:
        self.open_filter_menu()
        point = self.page.evaluate(
            """({ groupLabel, optionLabel }) => {
                function visible(el) {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 &&
                        style.visibility !== 'hidden' && style.display !== 'none' &&
                        rect.bottom >= 0 && rect.top <= window.innerHeight;
                }
                function text(el) {
                    return (el.innerText || el.textContent || '').trim();
                }
                const labels = ['排序依据', '笔记类型', '发布时间', '搜索范围', '位置距离'];
                const nodes = Array.from(document.querySelectorAll('span,div,button')).filter(visible);
                const groupEl = nodes.find(el => text(el) === groupLabel);
                if (!groupEl) return null;
                const groupRect = groupEl.getBoundingClientRect();
                const nextGroupRects = nodes
                    .filter(el => labels.includes(text(el)) && text(el) !== groupLabel)
                    .map(el => el.getBoundingClientRect())
                    .filter(rect => rect.top > groupRect.top + 2)
                    .sort((a, b) => a.top - b.top);
                const bottom = nextGroupRects.length ? nextGroupRects[0].top : window.innerHeight;
                const candidates = nodes
                    .filter(el => text(el) === optionLabel)
                    .map(el => ({ el, rect: el.getBoundingClientRect() }))
                    .filter(({ rect }) => rect.top >= groupRect.bottom - 4 && rect.top < bottom + 4)
                    .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
                if (!candidates.length) return null;
                const rect = candidates[0].rect;
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }""",
            {"groupLabel": group_label, "optionLabel": option_label},
        )
        if not point:
            raise RunnerError(f"Cannot find filter option: {group_label} -> {option_label}")
        self.page.mouse.click(point["x"], point["y"])
        self.sleep(1.5, 2.8)
        self.wait_for_manual_verification(180)

    def apply_filters(
        self,
        sort: Optional[str] = None,
        note_type: Optional[str] = None,
        publish_time: Optional[str] = None,
        scope: Optional[str] = None,
        location: Optional[str] = None,
    ) -> None:
        filter_plan = [
            ("排序依据", SORT_LABELS, sort),
            ("笔记类型", NOTE_TYPE_LABELS, note_type),
            ("发布时间", PUBLISH_TIME_LABELS, publish_time),
            ("搜索范围", SEARCH_SCOPE_LABELS, scope),
            ("位置距离", LOCATION_LABELS, location),
        ]
        for group, mapping, value in filter_plan:
            label = _resolve_filter_label(group, mapping, value)
            if not label:
                continue
            self.click_filter_option(group, label)

    def reset_filters(self) -> None:
        self.open_filter_menu()
        self.click_by_text_in_menu("重置")
        self.sleep(1.0, 1.8)

    def close_filter_menu(self) -> None:
        if "排序依据" not in self.body_text(4000):
            return
        self.click_by_text_in_menu("收起")
        self.sleep(0.5, 1.0)

    def extract_filter_options(self) -> Dict[str, List[str]]:
        self.open_filter_menu()
        options = self.page.evaluate(
            """(labels) => {
                function visible(el) {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 &&
                        style.visibility !== 'hidden' && style.display !== 'none' &&
                        rect.bottom >= 0 && rect.top <= window.innerHeight;
                }
                function text(el) {
                    return (el.innerText || el.textContent || '').trim();
                }
                const nodes = Array.from(document.querySelectorAll('span,div,button')).filter(visible);
                const out = {};
                for (const label of labels) {
                    const groupEl = nodes.find(el => text(el) === label);
                    if (!groupEl) {
                        out[label] = [];
                        continue;
                    }
                    const groupRect = groupEl.getBoundingClientRect();
                    const nextGroupRects = nodes
                        .filter(el => labels.includes(text(el)) && text(el) !== label)
                        .map(el => el.getBoundingClientRect())
                        .filter(rect => rect.top > groupRect.top + 2)
                        .sort((a, b) => a.top - b.top);
                    const bottom = nextGroupRects.length ? nextGroupRects[0].top : window.innerHeight;
                    const seen = new Set();
                    const values = [];
                    for (const node of nodes) {
                        const value = text(node);
                        if (!value || labels.includes(value) || ['重置', '收起'].includes(value)) continue;
                        const rect = node.getBoundingClientRect();
                        if (rect.top < groupRect.bottom - 4 || rect.top >= bottom + 4) continue;
                        if (value.length > 12 || seen.has(value)) continue;
                        seen.add(value);
                        values.push(value);
                    }
                    out[label] = values;
                }
                return out;
            }""",
            FILTER_GROUP_LABELS,
        )
        return dict(options or {})

    def click_by_text_in_menu(self, label: str) -> None:
        locator = self.page.get_by_text(label, exact=True)
        count = locator.count()
        if count == 0:
            raise RunnerError(f"Cannot find menu action: {label}")
        for i in range(count - 1, -1, -1):
            item = locator.nth(i)
            try:
                if item.is_visible(timeout=500):
                    item.click(force=True, timeout=1500)
                    return
            except Exception:
                continue
        locator.last.click(force=True, timeout=1500)

    def extract_cards(self, limit: int) -> List[Dict[str, Any]]:
        cards = self.page.evaluate(
            """(limit) => {
                function text(el) { return el ? (el.innerText || el.textContent || '').trim() : ''; }
                function absUrl(href) {
                    if (!href) return '';
                    try { return new URL(href, location.origin).toString(); } catch (_) { return href; }
                }
                const out = [];
                const seen = new Set();
                const items = Array.from(document.querySelectorAll('section.note-item'));
                for (const item of items) {
                    if (out.length >= limit) break;
                    const links = Array.from(item.querySelectorAll('a[href]'));
                    const noteLink = links.find(a => /\\/(search_result|explore)\\/[A-Za-z0-9]+/.test(a.getAttribute('href') || ''));
                    if (!noteLink) continue;
                    const href = noteLink.getAttribute('href') || '';
                    const idMatch = href.match(/\\/(?:search_result|explore)\\/([A-Za-z0-9]+)/);
                    const tokenMatch = href.match(/xsec_token=([^&]+)/);
                    const noteId = idMatch ? idMatch[1] : '';
                    if (!noteId || seen.has(noteId)) continue;
                    seen.add(noteId);

                    const titleEl = item.querySelector('.title, a.title, [class*="title"]');
                    const authorLink = links.find(a => /\\/user\\/profile\\//.test(a.getAttribute('href') || ''));
                    const userHref = authorLink ? (authorLink.getAttribute('href') || '') : '';
                    const uidMatch = userHref.match(/\\/user\\/profile\\/([A-Za-z0-9]+)/);
                    const img = item.querySelector('img');
                    const likeText = text(item.querySelector('.like-wrapper .count, [class*="like"] .count, .like-count'));
                    const authorText = text(authorLink);

                    out.push({
                        id: noteId,
                        note_id: noteId,
                        xsec_token: tokenMatch ? decodeURIComponent(tokenMatch[1]) : '',
                        title: text(titleEl || noteLink),
                        url: absUrl(href),
                        user: authorText.replace(/\\s+/g, ' '),
                        user_id: uidMatch ? uidMatch[1] : '',
                        user_url: absUrl(userHref),
                        cover_url: img ? (img.currentSrc || img.src || '') : '',
                        liked_count: likeText || '',
                        type: item.querySelector('.play-icon, [class*="play"], [class*="video"]') ? 'video' : 'normal',
                    });
                }
                return out;
            }""",
            limit,
        )
        return list(cards or [])

    def search(self, keyword: str, limit: int, max_scrolls: int, filters: Dict[str, Optional[str]]) -> List[Dict[str, Any]]:
        self.open_search(keyword)
        self.apply_filters(
            sort=filters.get("sort"),
            note_type=filters.get("note_type"),
            publish_time=filters.get("publish_time"),
            scope=filters.get("scope"),
            location=filters.get("location"),
        )

        results: List[Dict[str, Any]] = []
        stagnant = 0
        for _ in range(max_scrolls + 1):
            current = self.extract_cards(limit)
            if len(current) > len(results):
                results = current
                stagnant = 0
            else:
                stagnant += 1
            if len(results) >= limit:
                break
            if stagnant >= 3 and results:
                break
            self.page.mouse.wheel(0, random.randint(700, 1100))
            self.sleep(0.8, 1.5)
            self.wait_for_manual_verification(180)
        return results[:limit]

    def get_detail(self, note_id: str, xsec_token: str = "", xsec_source: str = "pc_search") -> Dict[str, Any]:
        if not note_id:
            raise RunnerError("note_id is required")
        if xsec_token:
            query = urlencode({"xsec_token": xsec_token, "xsec_source": xsec_source}, quote_via=quote)
            url = f"{BASE_URL}/search_result/{note_id}?{query}"
        else:
            url = f"{BASE_URL}/explore/{note_id}"
        self.goto(url)
        self.wait_for_manual_verification(180)
        self.sleep(1.2, 2.0)
        return self.page.evaluate(
            """() => {
                function text(el) { return el ? (el.innerText || el.textContent || '').trim() : ''; }
                function href(el) {
                    if (!el) return '';
                    try { return new URL(el.getAttribute('href') || '', location.origin).toString(); } catch (_) { return el.getAttribute('href') || ''; }
                }
                const authorLink = document.querySelector('a[href*="/user/profile/"]');
                const comments = Array.from(document.querySelectorAll('.comment-item, [class*="comment"]')).slice(0, 20)
                    .map(el => text(el)).filter(Boolean);
                return {
                    url: location.href,
                    title: text(document.querySelector('.note-content .title, .title, [class*="title"]')),
                    desc: text(document.querySelector('.note-content .desc, .desc, [class*="desc"]')),
                    author: text(document.querySelector('.author .name, .username, [class*="author"] [class*="name"]')) || text(authorLink),
                    author_url: href(authorLink),
                    date_ip: text(document.querySelector('.date, .bottom-container, [class*="date"], [class*="ip"]')),
                    liked_count: text(document.querySelector('[class*="like"] .count, .like-count')),
                    collected_count: text(document.querySelector('[class*="collect"] .count, .collect-count')),
                    comment_count: text(document.querySelector('[class*="comment"] .count, .comment-count')),
                    comments,
                };
            }"""
        )


def parse_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile-dir", default=str(default_profile_dir()), help="Persistent browser profile directory")
    parser.add_argument("--browser-channel", default="auto", help="auto, chrome, msedge, or chromium")
    parser.add_argument("--timeout", type=int, default=60, help="Browser timeout in seconds")
    parser.add_argument("--headless", action="store_true", help="Run browser headlessly")
    parser.add_argument("--no-headless", action="store_true", help="Force visible browser window")
    parser.add_argument("--slow-mo", type=int, default=0, help="Playwright slow_mo in ms")
    parser.add_argument("--latitude", type=float, default=None, help="Optional geolocation latitude for 附近")
    parser.add_argument("--longitude", type=float, default=None, help="Optional geolocation longitude for 附近")


def make_options(args: argparse.Namespace, default_headless: bool = False) -> BrowserOptions:
    headless = default_headless
    if getattr(args, "headless", False):
        headless = True
    if getattr(args, "no_headless", False):
        headless = False
    return BrowserOptions(
        profile_dir=Path(args.profile_dir).expanduser(),
        headless=headless,
        browser_channel=args.browser_channel,
        timeout_ms=max(10, int(args.timeout)) * 1000,
        slow_mo_ms=max(0, int(args.slow_mo)),
        latitude=args.latitude,
        longitude=args.longitude,
    )


def add_filter_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--sort", choices=_filter_choices(SORT_LABELS), default=None)
    parser.add_argument("--note-type", choices=_filter_choices(NOTE_TYPE_LABELS), default=None)
    parser.add_argument("--publish-time", choices=_filter_choices(PUBLISH_TIME_LABELS), default=None)
    parser.add_argument("--scope", choices=_filter_choices(SEARCH_SCOPE_LABELS), default=None)
    parser.add_argument("--location", choices=_filter_choices(LOCATION_LABELS), default=None)


def print_filter_options(fmt: str) -> None:
    if fmt == "json":
        _json_stdout({"ok": True, "filters": FILTER_OPTIONS})
        return
    for key, group in FILTER_OPTIONS.items():
        values = " / ".join(f"{item['value']}={item['label']}" for item in group["options"])
        print(f"{key} ({group['group_label']}): {values}")


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="小红书通用浏览器 CLI")
    subparsers = parser.add_subparsers(dest="command")

    filter_options_parser = subparsers.add_parser("filter-options", help="列出支持的搜索筛选项")
    filter_options_parser.add_argument("--format", choices=("json", "text"), default="json")

    probe_filters_parser = subparsers.add_parser("probe-filters", help="打开搜索页并读取当前筛选下拉框")
    parse_common(probe_filters_parser)
    probe_filters_parser.add_argument("--keyword", default="健身")
    probe_filters_parser.add_argument("--format", choices=("json", "text"), default="json")

    login_parser = subparsers.add_parser("login", help="打开浏览器并等待扫码登录")
    parse_common(login_parser)
    login_parser.add_argument("--wait", type=int, default=300, help="Wait for login seconds")

    status_parser = subparsers.add_parser("check-login", help="检查登录状态")
    parse_common(status_parser)

    search_parser = subparsers.add_parser("search-feeds", help="搜索笔记")
    parse_common(search_parser)
    add_filter_args(search_parser)
    search_parser.add_argument("--keyword", required=True)
    search_parser.add_argument("--limit", type=int, default=10)
    search_parser.add_argument("--max-scrolls", type=int, default=6)
    search_parser.add_argument("--format", choices=("json", "text"), default="json")

    detail_parser = subparsers.add_parser("get-feed-detail", help="获取笔记详情")
    parse_common(detail_parser)
    detail_parser.add_argument("--note-id", required=True)
    detail_parser.add_argument("--xsec-token", default="")
    detail_parser.add_argument("--xsec-source", default="pc_search")
    detail_parser.add_argument("--format", choices=("json", "text"), default="json")

    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.command:
        parser.print_help()
        return 1

    try:
        if args.command == "filter-options":
            print_filter_options(args.format)
            return 0

        if args.command == "probe-filters":
            opts = make_options(args, default_headless=False)
            with XhsBrowser(opts) as browser:
                browser.open_search(args.keyword)
                live_filters = browser.extract_filter_options()
                payload = {"ok": True, "filters": live_filters, "known_filters": FILTER_OPTIONS}
                if args.format == "json":
                    _json_stdout(payload)
                else:
                    for group, values in live_filters.items():
                        print(f"{group}: {', '.join(values)}")
                return 0

        if args.command == "login":
            opts = make_options(args, default_headless=False)
            with XhsBrowser(opts) as browser:
                browser.goto(BASE_URL)
                _eprint("请在打开的浏览器中登录小红书。登录成功后脚本会自动退出。")
                deadline = time.time() + max(30, args.wait)
                logged_in = False
                while time.time() < deadline:
                    if browser.check_logged_in():
                        logged_in = True
                        break
                    time.sleep(3)
                _json_stdout({"ok": logged_in, "logged_in": logged_in, "profile_dir": str(opts.profile_dir)})
                return 0 if logged_in else 1

        if args.command == "check-login":
            opts = make_options(args, default_headless=True)
            with XhsBrowser(opts) as browser:
                logged_in = browser.check_logged_in()
                _json_stdout({"ok": True, "logged_in": logged_in, "profile_dir": str(opts.profile_dir)})
                return 0 if logged_in else 1

        if args.command == "search-feeds":
            opts = make_options(args, default_headless=False)
            filters = {
                "sort": args.sort,
                "note_type": args.note_type,
                "publish_time": args.publish_time,
                "scope": args.scope,
                "location": args.location,
            }
            with XhsBrowser(opts) as browser:
                rows = browser.search(args.keyword, max(1, args.limit), max(0, args.max_scrolls), filters)
                payload = {"ok": True, "count": len(rows), "results": rows}
                if args.format == "json":
                    _json_stdout(payload)
                else:
                    for row in rows:
                        print(f"{row.get('title','')}\\t{row.get('user','')}\\t{row.get('url','')}")
                return 0

        if args.command == "get-feed-detail":
            opts = make_options(args, default_headless=False)
            with XhsBrowser(opts) as browser:
                detail = browser.get_detail(args.note_id, args.xsec_token, args.xsec_source)
                if args.format == "json":
                    _json_stdout({"ok": True, "detail": detail})
                else:
                    print(detail.get("title", ""))
                    print(detail.get("desc", ""))
                return 0

        raise RunnerError(f"Unknown command: {args.command}")
    except RunnerError as exc:
        _json_stdout({"ok": False, "error": str(exc)})
        return 1
    except KeyboardInterrupt:
        _json_stdout({"ok": False, "error": "Interrupted"})
        return 130
    except Exception as exc:
        _json_stdout({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
