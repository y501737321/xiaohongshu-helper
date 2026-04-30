#!/usr/bin/env python3
"""JSON bridge for the local xiaohongshu-skill Playwright scraper."""

import argparse
import json
import os
import sys
import time
from typing import Any, Dict, List


def _load_skill(skill_dir: str):
    if not os.path.isdir(skill_dir):
        raise RuntimeError(f"xiaohongshu-skill not found: {skill_dir}")
    sys.path.insert(0, skill_dir)
    from scripts.client import XiaohongshuClient  # type: ignore
    from scripts.login import LoginAction  # type: ignore
    from scripts.search import SearchAction  # type: ignore
    from scripts.feed import FeedDetailAction  # type: ignore
    return XiaohongshuClient, LoginAction, SearchAction, FeedDetailAction


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for item in items:
        note_id = item.get("id") or item.get("note_id")
        if not note_id or note_id in seen:
            continue
        seen.add(note_id)
        out.append(item)
    return out


def _extract_state(page, limit: int) -> List[Dict[str, Any]]:
    result = page.evaluate(
        """(limit) => {
            const feeds = window.__INITIAL_STATE__?.search?.feeds;
            const data = feeds?.value || feeds?._value;
            if (!Array.isArray(data)) return '';
            return JSON.stringify(data.slice(0, limit).map(item => {
                const nc = item.noteCard || {};
                const user = nc.user || {};
                const info = nc.interactInfo || {};
                const cover = nc.cover || {};
                return {
                    id: item.id || '',
                    xsec_token: item.xsecToken || '',
                    title: nc.displayTitle || '',
                    type: nc.type || '',
                    user: user.nickname || user.nickName || '',
                    user_id: user.userId || '',
                    user_avatar: user.avatar || '',
                    liked_count: info.likedCount || '0',
                    collected_count: info.collectedCount || '0',
                    comment_count: info.commentCount || '0',
                    shared_count: info.sharedCount || '0',
                    cover_url: cover.urlDefault || cover.urlPre || '',
                };
            }));
        }""",
        limit,
    )
    return json.loads(result) if result else []


def _extract_dom(page, limit: int) -> List[Dict[str, Any]]:
    result = page.evaluate(
        """(limit) => {
            const items = Array.from(document.querySelectorAll('section.note-item'));
            const results = [];
            for (const item of items.slice(0, limit)) {
                const entry = {};
                const link = item.querySelector('a[href*="/explore/"]');
                const href = link ? (link.getAttribute('href') || '') : '';
                const idMatch = href.match(/\\/explore\\/([a-zA-Z0-9]+)/);
                const tokenMatch = href.match(/xsec_token=([^&]+)/);
                entry.id = idMatch ? idMatch[1] : '';
                entry.xsec_token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
                const titleEl = item.querySelector('.title span, .title, a.title');
                entry.title = titleEl ? titleEl.textContent.trim() : '';
                const authorEl = item.querySelector('.author-wrapper .name, .author .name, [class*="author"] .name, .nickname');
                entry.user = authorEl ? authorEl.textContent.trim() : '';
                const authorLink = item.querySelector('a[href*="/user/profile/"]');
                const userHref = authorLink ? (authorLink.getAttribute('href') || '') : '';
                const uidMatch = userHref.match(/\\/user\\/profile\\/([a-zA-Z0-9]+)/);
                entry.user_id = uidMatch ? uidMatch[1] : '';
                const avatarImg = item.querySelector('.author-wrapper img, .author img');
                entry.user_avatar = avatarImg ? (avatarImg.getAttribute('src') || '') : '';
                const likeEl = item.querySelector('.like-wrapper .count, [class*="like"] .count, .like-count');
                entry.liked_count = likeEl ? likeEl.textContent.trim() : '0';
                entry.collected_count = '0';
                entry.comment_count = '0';
                entry.shared_count = '0';
                const coverImg = item.querySelector('img');
                entry.cover_url = coverImg ? (coverImg.getAttribute('src') || '') : '';
                entry.type = item.querySelector('.play-icon, [class*="video"], svg.play') ? 'video' : 'normal';
                results.push(entry);
            }
            return JSON.stringify(results);
        }""",
        limit,
    )
    return json.loads(result) if result else []


def search_with_scroll(action, keyword: str, limit: int, max_scrolls: int) -> List[Dict[str, Any]]:
    page = action.client.page
    action.client.navigate(action._make_search_url(keyword))
    action._dismiss_login_popup()
    action.client.wait_for_initial_state()
    time.sleep(1.2)

    filters = getattr(action, "_bridge_filters", {})
    if filters:
        action._apply_filters(
            sort_by=filters.get("sort_by"),
            note_type=filters.get("note_type"),
            publish_time=filters.get("publish_time"),
            search_scope=filters.get("search_scope"),
            location=filters.get("location"),
        )
        time.sleep(1.5)

    results: List[Dict[str, Any]] = []
    last_count = 0
    stagnant = 0
    for _ in range(max_scrolls + 1):
        results = _dedupe(_extract_state(page, limit) + _extract_dom(page, limit))
        if len(results) >= limit:
            break
        if len(results) == last_count:
            stagnant += 1
        else:
            stagnant = 0
        if stagnant >= 3 and len(results) > 0:
            break
        last_count = len(results)
        page.evaluate("window.scrollBy(0, Math.max(document.documentElement.clientHeight, 900))")
        time.sleep(0.9)

    return results[:limit]


def check_logged_in(LoginAction, client) -> bool:
    logged, _ = LoginAction(client).check_login_status(navigate=True)
    return bool(logged)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill-dir", required=True)
    parser.add_argument("--cookie-path", required=True)
    parser.add_argument("--user-data-dir", required=True)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    payload = json.loads(sys.stdin.read() or "{}")
    action_name = payload.get("action")
    XiaohongshuClient, LoginAction, SearchAction, FeedDetailAction = _load_skill(args.skill_dir)

    os.makedirs(os.path.dirname(args.cookie_path), exist_ok=True)
    os.makedirs(args.user_data_dir, exist_ok=True)

    with XiaohongshuClient(
        headless=True,
        cookie_path=args.cookie_path,
        user_data_dir=args.user_data_dir,
        timeout=args.timeout,
    ) as client:
        if action_name == "status":
            print(json.dumps({"ok": True, "loggedIn": check_logged_in(LoginAction, client)}, ensure_ascii=False))
            return 0

        if action_name == "search":
            if not check_logged_in(LoginAction, client):
                raise RuntimeError("NOT_LOGGED_IN")
            search_action = SearchAction(client)
            search_action._bridge_filters = payload.get("filters") or {}
            rows = search_with_scroll(
                search_action,
                str(payload.get("keyword") or ""),
                max(1, int(payload.get("limit") or 50)),
                max(1, int(payload.get("maxScrolls") or 8)),
            )
            print(json.dumps({"ok": True, "count": len(rows), "results": rows}, ensure_ascii=False))
            return 0

        if action_name == "detail":
            if not check_logged_in(LoginAction, client):
                raise RuntimeError("NOT_LOGGED_IN")
            detail = FeedDetailAction(client).get_feed_detail(
                str(payload.get("feedId") or ""),
                str(payload.get("xsecToken") or ""),
                load_comments=False,
                xsec_source=str(payload.get("xsecSource") or "pc_search"),
            )
            print(json.dumps({"ok": bool(detail), "detail": detail}, ensure_ascii=False))
            return 0

        raise RuntimeError(f"unknown action: {action_name}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
