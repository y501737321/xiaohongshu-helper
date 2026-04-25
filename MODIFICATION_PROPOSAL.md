# 小红书获客助手 - 修改方案

## 一、去除飞书依赖，改用本地文件存储

### 背景
当前系统依赖 `lark-cli` 将线索写入飞书多维表格，健身教练需要在终端配置飞书 CLI、获取 App Token / Table ID 等，门槛较高。

### 方案

#### 1.1 新增本地 CSV 文件存储（替代飞书多维表格）

**存储位置：** `app.getPath('userData')/leads/` 目录下，按日期自动分文件：
- `leads_2026-04-25.csv`
- `leads_2026-04-26.csv`

**CSV 字段（按教练使用优先级排列）：**
```
账号ID,昵称,小红书主页,笔记ID,笔记链接,笔记标题,AI评分,AI摘要,判断原因,关键词,发现时间
```

> **设计思路：** 账号 ID 和帖子链接是教练最常用的两个字段——账号 ID 用来在小红书里搜索/私信用户，帖子链接用来回看原文和评论区。放在最前面方便 Excel 中快速浏览和筛选。

**涉及文件修改：**

| 文件 | 修改内容 |
|------|---------|
| `electron/main.cjs` | `syncToFeishu()` 重命名为 `saveLeadToLocal()`，写入 CSV 文件；删除 `sendFeishuAlert()` 中的飞书 IM 发送逻辑 |
| `electron/main.cjs` | `DEFAULT_CONFIG` 中移除 `feishuAppToken`、`feishuTableId`、`feishuUserId`、`feishuWebhook` 四个字段 |
| `electron/main.cjs` | 新增 `getLeadsDir()` 工具函数，自动创建目录 |
| `electron/main.cjs` | `checkEnvironment()` 中移除 `lark-cli` 检测 |
| `electron/main.cjs` | 新增 IPC handler `open-leads-folder`，用 `shell.openPath()` 打开线索文件夹 |
| `src/pages/Settings.tsx` | 删除整个「飞书集成」配置区块 |
| `src/pages/Settings.tsx` | 移除飞书登录状态检测相关代码 |
| `src/components/EnvBanner.tsx` | 移除 lark-cli 环境检测项 |
| `src/types/electron.d.ts` | `AppConfig` 中移除飞书相关字段 |

**核心逻辑变更（`electron/main.cjs`）：**

```javascript
// 新增：获取线索存储目录
function getLeadsDir() {
  const dir = path.join(app.getPath('userData'), 'leads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 替代 syncToFeishu：本地 CSV 写入
async function saveLeadToLocal(note, detail, assessment) {
  const dir = getLeadsDir()
  const date = new Date().toISOString().slice(0, 10)
  const filePath = path.join(dir, `leads_${date}.csv`)

  // 首次写入时添加 BOM + 表头（BOM 让 Excel 自动识别 UTF-8）
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '\uFEFF账号ID,昵称,小红书主页,笔记ID,笔记链接,笔记标题,AI评分,AI摘要,判断原因,关键词,发现时间\n', 'utf-8')
  }

  const userId = note.user?.id || ''
  const noteId = note.id || note.note_id || ''

  const row = [
    userId,                                                          // 账号ID（教练可直接搜索私信）
    note.author || note.user?.nickname || '未知',                     // 昵称
    `https://www.xiaohongshu.com/user/profile/${userId}`,            // 小红书主页
    noteId,                                                          // 笔记ID
    `https://www.xiaohongshu.com/explore/${noteId}`,                 // 笔记链接（点击直达原帖）
    (note.title || note.desc || '').replace(/,/g, '，'),
    assessment.score,
    (assessment.summary || '').replace(/,/g, '，'),
    (assessment.author_intent || '').replace(/,/g, '，'),
    note._keyword || '',
    new Date().toLocaleString('zh-CN'),                              // 发现时间放最后
  ].join(',')

  fs.appendFileSync(filePath, row + '\n', 'utf-8')
  return true
}
```

#### 1.2 Dashboard 新增「查看线索」按钮

在 Dashboard 页面添加一个按钮，点击后用系统文件管理器打开线索文件夹，教练可以直接用 Excel / WPS 打开 CSV 文件查看。

#### 1.3 S级线索通知方案

移除飞书 IM 即时通知后，替代方案：
- **系统通知：** 使用 Electron 的 `Notification` API 弹出桌面通知
- 当检测到 S 级线索时，弹出通知：「发现极高意向客户：xxx，快去查看！」

```javascript
const { Notification } = require('electron')

function sendDesktopAlert(note, assessment) {
  if (Notification.isSupported()) {
    new Notification({
      title: '发现极高意向客户！',
      body: `${note.author || '未知'}: ${assessment.summary}`,
      urgency: 'critical',
    }).show()
  }
}
```

---

## 二、默认使用 DeepSeek V4 Flash

### 背景
当前默认模型为 `gpt-4o-mini`，预设列表中只有 MiniMax / 智谱 / Moonshot。DeepSeek V4 Flash 价格极低且支持 OpenAI 兼容接口，适合高频调用场景。

### 方案

#### 2.1 更改默认配置

**`electron/main.cjs` 中 `DEFAULT_CONFIG`：**
```javascript
// 改前
llmBaseUrl: 'https://api.openai.com/v1',
llmModel: 'gpt-4o-mini',

// 改后
llmBaseUrl: 'https://api.deepseek.com',
llmModel: 'deepseek-v4-flash',
```

#### 2.2 新增 DeepSeek 预设按钮

**`src/pages/Settings.tsx` 的 `LLM_PRESETS` 数组头部新增：**
```typescript
{
  id: 'deepseek',
  name: 'DeepSeek',
  label: 'DeepSeek',
  emoji: '🔮',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  tip: '极低成本，推荐默认使用',
},
```

并将其放在预设列表**第一个**位置，作为推荐选项。

#### 2.3 Settings 页面默认值同步

**`src/pages/Settings.tsx` 中 `DEFAULT_CONFIG`：**
```typescript
llmBaseUrl: 'https://api.deepseek.com',
llmModel: 'deepseek-v4-flash',
```

---

## 三、其他优化建议

### 3.1 CSV 字段用引号包裹（防止内容含逗号/换行导致错位）

当前方案中将逗号替换为中文逗号是简单方案，更严谨的做法是用标准 CSV 引号包裹：

```javascript
function csvEscape(val) {
  const str = String(val || '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
```

建议采用此方式替代中文逗号替换。

### 3.2 日志文件自动轮转

当前 `run.log` 无限追加，长期运行会变得很大。建议：
- 每次启动时检查日志文件大小，超过 5MB 则重命名为 `run.log.old` 并新建
- 或按日期分割日志文件（`run_2026-04-25.log`）

```javascript
function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_PATH)
    if (stat.size > 5 * 1024 * 1024) {
      const oldPath = LOG_PATH.replace('.log', '.old.log')
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      fs.renameSync(LOG_PATH, oldPath)
    }
  } catch (_) {}
}
```

### 3.3 LLM Prompt 优化 - 减少 token 消耗

当前 prompt 约 200+ tokens，可以精简：

```
// 改前（多行详细说明）
分析以下小红书笔记，判断发布者是否有真实的健身/减肥/体态调整需求，排除广告内容和卖课行为。
...打分标准详细描述...

// 改后（精简版，节省约 40% token）
判断此小红书帖子的健身私教需求意向：
${content}
评分：S=强烈找私教 A=有明确需求 B=意向不明 C=广告/无关
返回JSON：{"score":"X","summary":"一句话需求","author_intent":"原因"}
```

对于 DeepSeek V4 Flash 这类高速模型，精简 prompt 能进一步降低成本和延迟。

### 3.4 线索去重持久化

当前 `seenNoteIds` 是内存中的 `Set`，重启应用后丢失，导致重复抓取。建议：
- 将 `seenNoteIds` 持久化到本地文件 `seen_ids.json`
- 启动时加载，每次新增后追加保存
- 可设置最大保留条数（如 10000 条），超过后清除最早的

```javascript
const SEEN_IDS_PATH = path.join(app.getPath('userData'), 'seen_ids.json')

function loadSeenIds() {
  try {
    if (fs.existsSync(SEEN_IDS_PATH)) {
      const arr = JSON.parse(fs.readFileSync(SEEN_IDS_PATH, 'utf-8'))
      return new Set(arr.slice(-10000))  // 保留最近10000条
    }
  } catch (_) {}
  return new Set()
}

function saveSeenIds() {
  fs.writeFileSync(SEEN_IDS_PATH, JSON.stringify([...seenNoteIds]), 'utf-8')
}
```

### 3.5 新增「导出线索汇总」功能

在 Dashboard 添加一个按钮，将所有 CSV 合并导出为一个完整文件，方便教练定期整理客户资料。

### 3.6 新增线索统计持久化

当前 `stats`（运行次数、总线索数、高意向占比）也是内存变量，重启归零。建议与配置一同持久化到 `stats.json`。

### 3.7 环境依赖简化提示

移除飞书后，环境检测只需检查 Python 3 和 xiaohongshu-skills 两项。可在 EnvBanner 中简化提示文案，降低教练的认知负担。

---

## 四、修改优先级与影响范围

| 优先级 | 修改项 | 影响文件数 | 风险 |
|--------|--------|-----------|------|
| P0 | 飞书 → 本地 CSV 存储 | 4-5 个文件 | 低（新增功能，不影响搜索/评估链路） |
| P0 | 默认模型改为 DeepSeek V4 Flash | 2 个文件 | 极低（仅改默认值和预设列表） |
| P1 | S级线索桌面通知 | 1 个文件 | 极低 |
| P1 | 线索去重持久化 | 1 个文件 | 低 |
| P2 | 日志轮转 | 1 个文件 | 极低 |
| P2 | Prompt 精简 | 1 个文件 | 低（需验证评分准确性） |
| P2 | 统计持久化 | 1 个文件 | 极低 |
| P3 | 导出汇总功能 | 2-3 个文件 | 低 |

---

## 五、不改动的部分

以下模块保持不变：
- 小红书搜索与详情抓取逻辑（`searchXiaohongshu`、`getNoteDetail`）
- AI 评估核心流程（`evaluateWithLLM` 的调用链路）
- 反检测延迟策略（随机延迟、夜间暂停）
- Electron 窗口管理与 IPC 架构
- 前端 UI 框架与样式体系
- Mock 模式
