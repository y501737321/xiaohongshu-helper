# 小红书获客助手

一款专为健身教练 / 私教设计的桌面自动化获客工具。自动从小红书抓取高意向健身需求笔记，利用 AI 智能评估意向等级，将优质线索保存至本地 CSV 文件，教练用 Excel 即可查看和管理。

## 核心功能

- **关键词自动搜索** — 预设"寻找私教"、"体态矫正"等关键词，定时自动抓取相关笔记
- **AI 意向评估** — 调用 DeepSeek V4 Flash 大模型，将笔记打分为 S / A / B / C 四档
- **本地 CSV 存储** — 线索按日期保存为 CSV 文件（含账号 ID、主页链接、笔记链接），Excel / WPS 直接打开
- **自定义保存路径** — 支持用户选择线索文件保存到任意文件夹
- **S 级桌面通知** — 发现极高意向客户时弹出系统通知，第一时间提醒教练
- **扫码登录** — 内置浏览器窗口或独立 Runner，用小红书 App 扫码即可登录
- **独立抓取 Runner** — 提供可打包的 Python + Playwright CLI，不依赖 Codex 或 Chrome 插件
- **防封策略** — 随机延迟 + 夜间自动暂停，模拟真人操作节奏
- **可视化仪表盘** — 实时显示运行轮次、线索总数、高意向占比

## 快速上手

### 环境要求

- **Node.js** v18+
- **Python 3** v3.9+

### 安装运行

```bash
git clone https://github.com/<your-username>/xiaohongshu-helper.git
cd xiaohongshu-helper
npm install
npm run electron:dev
```

首次启动后，软件会自动检测环境：
1. 确认内置服务程序或独立 Runner 已就绪
2. 前往「设置中心」→ 点击「扫码登录」，用小红书 App 扫码完成登录
3. 填入 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 获取）
4. 点击「开始监控」即可

## 独立 Python Runner

`scripts/xiaohongshu_wrapper.py` 是普通 Python CLI 入口，底层使用 Playwright 打开真实浏览器并复用本地登录态。它不需要 Codex、Codex Chrome 插件，也不依赖旧的 `xiaohongshu-skills` 包，适合打包成 Windows 可执行文件发给用户。

### 本地运行

```bash
python -m pip install -r scripts/requirements-xhs-runner.txt

# 如果用户电脑装了 Chrome 或 Edge，通常不需要下载 Chromium；
# 没有可用浏览器时再执行：
python -m playwright install chromium

python scripts/xiaohongshu_wrapper.py filter-options --format text
python scripts/xiaohongshu_wrapper.py probe-filters --keyword "私教" --no-headless
python scripts/xiaohongshu_wrapper.py login
python scripts/xiaohongshu_wrapper.py check-login
python scripts/xiaohongshu_wrapper.py search-feeds --keyword "天津 私教" --sort latest --location nearby --limit 10
python scripts/xiaohongshu_wrapper.py search-feeds --keyword "咖啡" --note-type image --publish-time week
```

### 已支持筛选

| 参数 | 小红书分组 | 可用值 |
|------|------------|--------|
| `--sort` | 排序依据 | `comprehensive` 综合、`latest` 最新、`likes` 最多点赞、`comments` 最多评论、`collects` 最多收藏 |
| `--note-type` | 笔记类型 | `all` 不限、`video` 视频、`image` 图文 |
| `--publish-time` | 发布时间 | `all` 不限、`day` 一天内、`week` 一周内、`half-year` 半年内 |
| `--scope` | 搜索范围 | `all` 不限、`viewed` 已看过、`unviewed` 未看过、`following` 已关注 |
| `--location` | 位置距离 | `all` 不限、`same-city` 同城、`nearby` 附近 |

`附近` 需要浏览器位置权限；也可以显式传入坐标：

```bash
python scripts/xiaohongshu_wrapper.py search-feeds --keyword "私教" --location nearby --latitude 39.12 --longitude 117.20
```

`probe-filters` 会打开真实搜索页并读取当前网页里的筛选下拉框，适合小红书页面改版后做快速自检；如果遇到验证或登录弹窗，按浏览器提示手动完成后重试。

### 打包 Windows EXE

```bash
python -m pip install -r scripts/requirements-xhs-build.txt
python scripts/build_xhs_runner.py
```

产物在 `dist-runner/xhs_runner.exe`。首次运行时执行 `xhs_runner.exe login` 完成扫码，之后搜索会复用本机登录态。默认浏览器通道是 `auto`，会依次尝试 Chrome、Edge、Playwright Chromium。

## 使用说明

### 线索文件

线索自动保存为 CSV，默认位于应用数据目录下的 `leads/` 文件夹，也可在设置中自定义路径。CSV 字段包括：

| 字段 | 说明 |
|------|------|
| 账号ID | 用户小红书 ID，可直接搜索私信 |
| 昵称 | 用户昵称 |
| 小红书主页 | 用户主页链接 |
| 笔记ID | 笔记唯一标识 |
| 笔记链接 | 点击直达原帖 |
| 笔记标题 | 笔记标题或摘要 |
| AI评分 | S/A/B/C 意向等级 |
| AI摘要 | 一句话需求总结 |
| 关键词 | 触发抓取的搜索词 |
| 发现时间 | 抓取时间 |

### AI 评分标准

| 等级 | 含义 | 处理方式 |
|------|------|---------|
| **S** | 极度渴望，明确找私教，有时间地点需求 | 自动保存 + 桌面通知 |
| **A** | 有明确需求，积极询问专业指导 | 自动保存 |
| **B** | 意向不明确，泛泛而谈 | 跳过 |
| **C** | 广告 / 卖课 / 无关内容 | 跳过 |

## 项目结构

```
├── electron/           # Electron 主进程与预加载脚本
├── src/
│   ├── components/     # UI 组件（环境检测横幅等）
│   ├── pages/          # 页面（Dashboard、Settings）
│   ├── types/          # TypeScript 类型定义
│   └── index.css       # 深色主题设计系统
├── scripts/            # 开发与打包脚本
└── design_doc.md       # 系统设计文档
```

## 技术栈

- **前端**: Vite + React 19 + TypeScript + Tailwind CSS
- **桌面端**: Electron 34
- **AI 评估**: DeepSeek V4 Flash（OpenAI 兼容接口）
- **数据抓取**: 独立 Python Playwright Runner / 内置服务

## 构建发布

```bash
npm run electron:build:mac   # macOS (DMG + ZIP)
npm run electron:build:win   # Windows (NSIS)
```

## 许可协议

MIT License
