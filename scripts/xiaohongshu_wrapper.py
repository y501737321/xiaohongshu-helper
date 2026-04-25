#!/usr/bin/env python3
"""
小红书获客助手 - Python 包装器
作为单一可执行文件（通过 PyInstaller 打包）对外提供 CLI 接口

使用方式:
  xhs_runner search-feeds --keyword "寻找私教" --format json --limit 10
  xhs_runner get-feed-detail --note-id "xxxxx" --format json
  xhs_runner login
  xhs_runner check-login

输出:
  所有结果以 JSON 格式输出到 stdout
  错误信息输出到 stderr
  退出码: 0=成功, 1=失败
"""
import sys
import json
import argparse


def search_feeds(keyword: str, limit: int = 10) -> list:
    """搜索小红书笔记"""
    try:
        from xiaohongshu_skills import search_feeds as _search
        results = _search(keyword=keyword, limit=limit)
        return results if isinstance(results, list) else []
    except ImportError:
        print(json.dumps({"error": "xiaohongshu_skills 未安装"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


def get_feed_detail(note_id: str) -> dict:
    """获取笔记详情"""
    try:
        from xiaohongshu_skills import get_feed_detail as _get_detail
        return _get_detail(note_id=note_id)
    except ImportError:
        print(json.dumps({"error": "xiaohongshu_skills 未安装"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


def check_login() -> bool:
    """检查登录状态"""
    try:
        from xiaohongshu_skills import check_login as _check
        status = _check()
        return bool(status)
    except Exception:
        return False


def do_login():
    """启动登录流程"""
    try:
        from xiaohongshu_skills import login as _login
        _login()
    except ImportError:
        print(json.dumps({"error": "xiaohongshu_skills 未安装"}), file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='小红书获客助手 CLI')
    subparsers = parser.add_subparsers(dest='command')

    # search-feeds
    search_parser = subparsers.add_parser('search-feeds', help='搜索笔记')
    search_parser.add_argument('--keyword', required=True, help='搜索关键词')
    search_parser.add_argument('--limit', type=int, default=10, help='结果数量限制')
    search_parser.add_argument('--format', default='json', choices=['json', 'text'])

    # get-feed-detail
    detail_parser = subparsers.add_parser('get-feed-detail', help='获取笔记详情')
    detail_parser.add_argument('--note-id', required=True, help='笔记 ID')
    detail_parser.add_argument('--format', default='json', choices=['json', 'text'])

    # check-login
    subparsers.add_parser('check-login', help='检查登录状态')

    # login
    subparsers.add_parser('login', help='启动登录流程')

    args = parser.parse_args()

    if args.command == 'search-feeds':
        results = search_feeds(args.keyword, args.limit)
        print(json.dumps(results, ensure_ascii=False, indent=2))

    elif args.command == 'get-feed-detail':
        detail = get_feed_detail(args.note_id)
        print(json.dumps(detail, ensure_ascii=False, indent=2))

    elif args.command == 'check-login':
        ok = check_login()
        result = {"logged_in": ok, "status": "ok" if ok else "not_logged_in"}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if ok else 1)

    elif args.command == 'login':
        do_login()

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
