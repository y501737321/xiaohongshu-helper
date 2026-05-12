---
name: xiaohongshu-chrome
description: "Use for Xiaohongshu automation through the standalone Python Playwright runner or the user's logged-in Chrome session: search results, the 筛选 dropdown, note cards, nearby/location filters, and note detail extraction."
---

# Xiaohongshu Runner / Chrome

Prefer the standalone Python runner when working in the `xiaohongshu_helper` project or when the user needs a repeatable/distributable workflow. Use the user's existing Chrome session only when the user explicitly asks to use Chrome, needs their current logged-in tab, or the runner is unavailable.

## When to use
- Searching Xiaohongshu notes.
- Verifying the `筛选` dropdown and its menu items.
- Reading search-result cards or opening note details.
- Handling browser location permission for `附近`.
- Packaging or documenting a Windows-friendly runner that does not depend on Codex or a Chrome extension.

## Standalone runner workflow
1. From the project root, prefer `scripts/xiaohongshu_wrapper.py`. It forwards to `scripts/xhs_browser_cli.py` and uses Playwright with a persistent local browser profile.
2. For a first-time user, run:
   ```bash
   python -m pip install -r scripts/requirements-xhs-runner.txt
   python scripts/xiaohongshu_wrapper.py login
   ```
   If Chrome/Edge is unavailable, install Playwright Chromium with `python -m playwright install chromium`.
3. Check login:
   ```bash
   python scripts/xiaohongshu_wrapper.py check-login
   ```
4. List known filters without opening Xiaohongshu:
   ```bash
   python scripts/xiaohongshu_wrapper.py filter-options --format text
   ```
5. Probe the live dropdown after page changes:
   ```bash
   python scripts/xiaohongshu_wrapper.py probe-filters --keyword "私教" --no-headless
   ```
6. Search notes:
   ```bash
   python scripts/xiaohongshu_wrapper.py search-feeds --keyword "天津 私教" --sort latest --location nearby --limit 10
   ```
7. Fetch detail:
   ```bash
   python scripts/xiaohongshu_wrapper.py get-feed-detail --note-id "<id>" --xsec-token "<token>"
   ```
8. Package a Windows executable:
   ```bash
   python -m pip install -r scripts/requirements-xhs-build.txt
   python scripts/build_xhs_runner.py
   ```
   The output is `dist-runner/xhs_runner.exe`.

## Runner filters
- `--sort`: `comprehensive` 综合, `latest` 最新, `likes` 最多点赞, `comments` 最多评论, `collects` 最多收藏.
- `--note-type`: `all` 不限, `video` 视频, `image` 图文.
- `--publish-time`: `all` 不限, `day` 一天内, `week` 一周内, `half-year` 半年内.
- `--scope`: `all` 不限, `viewed` 已看过, `unviewed` 未看过, `following` 已关注.
- `--location`: `all` 不限, `same-city` 同城, `nearby` 附近.
- Chinese labels such as `最新`, `图文`, and `附近` are also accepted by the runner.
- `附近` may require browser location permission. The runner can also receive `--latitude` and `--longitude`.

## Chrome fallback workflow
1. Reuse or claim the existing Xiaohongshu tab in Chrome.
2. Open a search with `https://www.xiaohongshu.com/search_result?keyword=<keyword>&source=web_explore_feed&type=51`.
3. Open the filter menu by clicking the `筛选` label/arrow on the right. If text clicking is flaky, use the visible arrow/icon or DOM/CUA click.
4. Confirm the menu is open before selecting anything.
5. Verified dropdown items:
   - 排序依据: `综合`, `最新`, `最多点赞`, `最多评论`, `最多收藏`
   - 笔记类型: `不限`, `视频`, `图文`
   - 发布时间: `不限`, `一天内`, `一周内`, `半年内`
   - 搜索范围: `不限`, `已看过`, `未看过`, `已关注`
   - 位置距离: `不限`, `同城`, `附近`
   - Actions: `重置`, `收起`
6. After each click, wait 2-4 seconds and verify the first `section.note-item` cards or the filter state changed.
7. `附近` may prompt for browser location access. Ask the user right before allowing it if permission is not already granted.
8. `重置` clears selected filters. `收起` closes the menu.
9. For detail pages, open `/search_result/<id>?xsec_token=...`; Xiaohongshu may redirect to `/explore/<id>`. Read the title, body, author, date/IP, and comments from visible DOM.
10. Stop if Xiaohongshu shows captcha, verification, unusual-traffic, or no-result states that block the flow.

## Notes
- The top tabs `全部 / 图文 / 视频 / 用户` are separate from the dropdown; use the dropdown row when you mean note type.
- Do not inspect cookies, local storage, or session data.
- Treat empty results, login prompts, and manual verification as explicit states to report, not scraper crashes.
