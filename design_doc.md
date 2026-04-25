小红书获客助手 - 软件设计与架构文档

## 1. 产品概述 (Product Vision)
本项目是一个专为健身私教设计的自动化获客桌面端软件。它通过调度本地 Python 脚本自动化搜寻小红书平台上的高意向健身需求（如：寻找私教、产后恢复、体态矫正等），利用大语言模型（LLM）进行意向度打分，并将高质量线索自动保存至本地 CSV 文件，方便教练用 Excel 查看和管理。

**核心设计原则**： 极简交互（傻瓜式操作）、底层解耦（前端展示与后端执行分离）、状态可视化。

---

## 2. 技术栈架构 (Tech Stack)
- **前端 (UI)**: React 19 + Vite + Tailwind CSS (提供极简现代的组件)。
- **桌面端壳 (Client)**: Electron 34 (负责提供独立的桌面运行环境和系统托盘功能)。
- **中间层 (Bridge)**: Electron IPC (Inter-Process Communication)，负责前后端消息传递。
- **后端引擎 (Core Logic)**: Node.js `child_process` 模块，用于调用和调度本地 Python 脚本。
- **第三方依赖 (Dependencies)**:
    - `xiaohongshu-skills`: 负责小红书数据的自动化查询。
- **AI 评估**: OpenAI SDK 格式兼容模型（默认 DeepSeek V4 Flash，另有 MiniMax、智谱、Moonshot 预设）。

---

## 3. 核心功能模块划分 (Modules)

### 3.1 前端 UI 模块 (UI Dashboard)
采用左侧导航条 + 右侧内容区的经典布局。

- **主控台 (Dashboard)**:
    - **一键启停**：醒目的"开始监控 / 停止监控"主按钮。
    - **环境检测横幅**：自动检测 Python、xiaohongshu-skills 是否可用，支持一键安装。
    - **实时运行日志**：终端风格的滚动窗口，实时展示任务状态。
    - **数据简报**：展示运行次数、线索总数及高意向占比。
    - **查看线索**：一键打开本地线索 CSV 文件夹。

- **设置中心 (Settings)**:
    - **监控词配置**：支持 Tag 样式的关键词增删。
    - **平台检测**：检测小红书的登录状态。
    - **AI 参数预设**：内置国内主流 LLM 厂商一键快捷填入配置。
    - **系统参数**：设置轮询间隔（默认 30 分钟）及夜间暂停时段。

### 3.2 任务调度与执行模块 (Task Runner)
由 Electron 主进程维护一个定时器（Interval），按设定的周期触发以下工作流：
1. **构建检索命令**：读取配置关键词，逐个调度搜索。
2. **进程调度**：通过 `exec` 唤起 Python 环境执行。
3. **数据解析**：捕获 stdout 输出的 JSON 数据。
4. **频率控制**：关键词间设有 8-20 秒随机延迟，笔记详情抓取设有 5-12 秒延迟。

### 3.3 AI 评估与存储模块 (Filter & Save)
1. **意向判定**：将笔记正文及评论输入给 LLM（通过直接 HTTPS API 请求）。
2. **数据入库**：若打分为 S 或 A，自动写入本地 CSV 文件（按日期分文件）。
3. **即时通知**：若打分为 S，通过系统桌面通知提醒教练。

---

## 4. 交付与打包策略 (Packaging)
- 采用 `electron-builder` 进行打包。
- 使用 `PyInstaller` 将 `scripts/xiaohongshu_wrapper.py` 编译为单一可执行文件，实现"环境捆绑"，降低用户配置门槛。

---

## 5. 项目进度 (Implementation Status)

- [x] **Phase 1 (基础框架)**: 基础工程搭建，IPC 通信与配置持久化打通。
- [x] **Phase 2 (UI 搭建)**: Dashboard/Settings 页面，日志滚动组件，环境检测 Banner。
- [x] **Phase 3 (业务逻辑)**: 定时器引擎，真实任务循环流，子进程生命周期管理。
- [x] **Phase 4 (真实接入)**: 接入真实 CLI 接口，集成国内 LLM 预设（DeepSeek/MiniMax/智谱/Moonshot）。
- [x] **Phase 5 (打包配置)**: electron-builder 脚本与预打包 package-deps 逻辑。
- [x] **Phase 6 (体验优化)**: 去除飞书依赖改用本地 CSV 存储，一键安装环境依赖，去重持久化。

**当前状态**：项目已完成 Phase 1-6 所有核心开发。

---

## 6. 使用特别说明 (Tips)
- **本地登录**：软件主进程会调用系统终端执行 CLI，请确保在系统终端先手动执行一次小红书登录。
- **线索文件**：线索保存在应用数据目录下的 `leads/` 文件夹中，可用 Excel / WPS 直接打开 CSV 文件。
