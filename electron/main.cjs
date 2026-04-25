const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')
const https = require('https')
const http = require('http')
const { URL } = require('url')

// ─── 路径工具 ──────────────────────────────────────────────
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!VITE_DEV_SERVER_URL

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const LOG_PATH = path.join(app.getPath('userData'), 'run.log')

// ─── 默认配置 ──────────────────────────────────────────────
const DEFAULT_CONFIG = {
  keywords: ['寻找私教', '私教推荐', '产后恢复', '体态矫正', '减肥健身', '增肌塑形'],
  intervalMinutes: 30,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 7,
  // 是否使用模拟数据（Phase 3 调试用）
  mockMode: false,
}

// ─── 全局状态 ──────────────────────────────────────────────
let mainWindow = null
let tray = null
let botInterval = null
let isRunning = false
let childProcesses = []
const SEEN_IDS_PATH = path.join(app.getPath('userData'), 'seen_ids.json')
let seenNoteIds = loadSeenIds() // 去重：避免对同一笔记重复处理（持久化）

let stats = {
  runCount: 0,
  totalLeads: 0,
  highIntentLeads: 0,
}

// ─── 配置读写 ──────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch (e) {
    console.error('配置读取失败:', e)
  }
  return { ...DEFAULT_CONFIG }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('配置写入失败:', e)
    return false
  }
}

// ─── 去重 ID 持久化 ──────────────────────────────────────────
function loadSeenIds() {
  try {
    if (fs.existsSync(SEEN_IDS_PATH)) {
      const arr = JSON.parse(fs.readFileSync(SEEN_IDS_PATH, 'utf-8'))
      return new Set(arr.slice(-10000))
    }
  } catch (_) {}
  return new Set()
}

function saveSeenIds() {
  try {
    fs.writeFileSync(SEEN_IDS_PATH, JSON.stringify([...seenNoteIds]), 'utf-8')
  } catch (_) {}
}

// ─── 线索本地存储（CSV）──────────────────────────────────────
function getLeadsDir() {
  const config = loadConfig()
  const dir = config.leadsDir || path.join(app.getPath('userData'), 'leads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function csvEscape(val) {
  const str = String(val || '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

async function saveLeadToLocal(note, detail, assessment) {
  try {
    const dir = getLeadsDir()
    const date = new Date().toISOString().slice(0, 10)
    const filePath = path.join(dir, `leads_${date}.csv`)

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '\uFEFF账号ID,昵称,小红书主页,笔记ID,笔记链接,笔记标题,AI评分,AI摘要,判断原因,关键词,发现时间\n', 'utf-8')
    }

    const userId = note.user?.id || ''
    const noteId = note.id || note.note_id || ''

    const row = [
      csvEscape(userId),
      csvEscape(note.author || note.user?.nickname || '未知'),
      csvEscape(`https://www.xiaohongshu.com/user/profile/${userId}`),
      csvEscape(noteId),
      csvEscape(`https://www.xiaohongshu.com/explore/${noteId}`),
      csvEscape(note.title || note.desc || ''),
      csvEscape(assessment.score),
      csvEscape(assessment.summary || ''),
      csvEscape(assessment.author_intent || ''),
      csvEscape(note._keyword || ''),
      csvEscape(new Date().toLocaleString('zh-CN')),
    ].join(',')

    fs.appendFileSync(filePath, row + '\n', 'utf-8')
    return true
  } catch (err) {
    sendLog(`⚠️  线索写入失败: ${err.message}`, 'warn')
    return false
  }
}

// ─── 桌面通知（S级线索）────────────────────────────────────
function sendDesktopAlert(note, assessment) {
  const { Notification } = require('electron')
  if (Notification.isSupported()) {
    new Notification({
      title: '发现极高意向客户！',
      body: `${note.author || note.user?.nickname || '未知'}: ${assessment.summary}`,
    }).show()
  }
}

// ─── 日志系统 ──────────────────────────────────────────────
function sendLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const logEntry = { timestamp, message, type }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', logEntry)
  }

  // 同时写文件日志
  const line = `[${new Date().toISOString()}] [${type.toUpperCase()}] ${message}\n`
  fs.appendFile(LOG_PATH, line, () => {})
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`)
}

function sendStats() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stats', stats)
  }
}

// ─── 夜间模式 & 延迟工具 ───────────────────────────────────
function isNightTime(config) {
  const hour = new Date().getHours()
  return hour >= (config.nightModeStart ?? 0) && hour < (config.nightModeEnd ?? 7)
}

function randomDelay(minMs = 5000, maxMs = 15000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── 工具：执行 shell 命令，返回 stdout ─────────────────────
function execCommand(cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const cp = exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message))
      } else {
        resolve(stdout.trim())
      }
    })
    childProcesses.push(cp)
    cp.on('exit', () => {
      childProcesses = childProcesses.filter((p) => p !== cp)
    })
  })
}

// ─── 工具：发送 HTTP/HTTPS 请求 ────────────────────────────
function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr)
    const lib = parsed.protocol === 'https:' ? https : http
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000,
    }

    const req = lib.request(reqOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })

    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

// ══════════════════════════════════════════════════════════
// Phase 4: 真实业务逻辑
// ══════════════════════════════════════════════════════════

// ─── 4.1 小红书搜索（调用 xiaohongshu-skills CLI）──────────
async function searchXiaohongshu(keyword) {
  const config = loadConfig()
  if (config.mockMode) {
    return mockSearch(keyword)
  }

  try {
    // xiaohongshu-skills CLI 命令
    const cmd = `python3 -m xiaohongshu_skills search-feeds --keyword "${keyword}" --format json --limit 10`
    const output = await execCommand(cmd, 60000)

    // 解析 JSON 输出
    let notes = []
    // 尝试找到 JSON 数组
    const jsonMatch = output.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      notes = JSON.parse(jsonMatch[0])
    } else {
      notes = JSON.parse(output)
    }

    // 过滤已处理过的笔记
    return notes.filter((n) => !seenNoteIds.has(n.id || n.note_id))
  } catch (err) {
    sendLog(`⚠️  搜索"${keyword}"失败: ${err.message}`, 'warn')
    return []
  }
}

// ─── 4.2 获取笔记详情 ──────────────────────────────────────
async function getNoteDetail(noteId) {
  const config = loadConfig()
  if (config.mockMode) {
    return { content: `[模拟详情] 笔记 ${noteId} 的完整内容...我一直想找一个专业的私教来帮我制定训练计划`, comments: [] }
  }

  try {
    const cmd = `python3 -m xiaohongshu_skills get-feed-detail --note-id "${noteId}" --format json`
    const output = await execCommand(cmd, 30000)
    const jsonMatch = output.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
    return JSON.parse(output)
  } catch (err) {
    sendLog(`⚠️  获取笔记详情失败 ${noteId}: ${err.message}`, 'warn')
    return null
  }
}

// ─── 4.3 LLM 意向评估 ──────────────────────────────────────
async function evaluateWithLLM(note, detail) {
  const config = loadConfig()

  if (config.mockMode || !config.llmApiKey) {
    return mockLLMEval()
  }

  const content = [
    `【标题】${note.title || note.desc || ''}`,
    `【正文】${detail?.content || note.content || note.desc || ''}`,
    `【评论摘要】${(detail?.comments || []).slice(0, 3).map((c) => c.content).join(' | ')}`,
  ].join('\n')

  const prompt = `分析以下小红书笔记，判断发布者是否有真实的健身/减肥/体态调整需求，排除广告内容和卖课行为。

${content}

打分标准：
- S：极度渴望，用户强烈表达寻找私教/训练计划的意愿，有明确时间地点需求
- A：有明确需求，积极询问或表达想要专业指导
- B：随便问问，泛泛而谈，意向不明确
- C：广告/卖课/无关内容

请返回严格的 JSON 格式（不要有任何额外文字）：
{"score":"X","summary":"一句话总结用户需求","author_intent":"判断原因"}`

  try {
    const baseUrl = (config.llmBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
    const res = await httpRequest(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.llmApiKey}`,
        },
        timeout: 30000,
      },
      {
        model: config.llmModel || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
      }
    )

    if (res.status !== 200) {
      throw new Error(`LLM API 错误: ${res.status} - ${JSON.stringify(res.body)}`)
    }

    const text = res.body.choices?.[0]?.message?.content || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    throw new Error('LLM 返回格式无效')
  } catch (err) {
    sendLog(`⚠️  LLM 评估失败: ${err.message}`, 'warn')
    return { score: 'B', summary: 'AI 评估失败，跳过', author_intent: '' }
  }
}

// ─── 4.4 线索本地写入 ─────────────────────────────────────
async function syncLead(note, detail, assessment) {
  const config = loadConfig()
  if (config.mockMode) {
    sendLog(`📊 [模拟] 线索已写入本地 CSV`, 'success')
    return true
  }
  return await saveLeadToLocal(note, detail, assessment)
}

// ══════════════════════════════════════════════════════════
// 模拟数据（mockMode = true 时使用）
// ══════════════════════════════════════════════════════════
async function mockSearch(keyword) {
  await new Promise((r) => setTimeout(r, 1200))
  const count = Math.floor(Math.random() * 4)
  return Array.from({ length: count }, (_, i) => ({
    id: `mock_${Date.now()}_${i}`,
    title: `关于${keyword}的笔记 ${i + 1}`,
    author: `测试用户${Math.floor(Math.random() * 9999)}`,
    desc: `我最近一直在寻找${keyword}，感觉自己特别需要专业指导...`,
    user: { id: `uid_${i}`, nickname: `测试用户${i}` },
    _keyword: keyword,
  }))
}

function mockLLMEval() {
  const scores = ['S', 'A', 'A', 'B', 'C']
  const score = scores[Math.floor(Math.random() * scores.length)]
  const summaries = {
    S: '用户明确表达强烈健身需求，主动寻找私教，有具体地点和时间要求',
    A: '有明确健身需求，态度积极，正在考虑找私教',
    B: '一般性内容，意向不明确',
    C: '广告或无关内容',
  }
  return { score, summary: summaries[score], author_intent: `随机模拟 - ${score}` }
}

// ══════════════════════════════════════════════════════════
// Phase 3: 核心工作流（定时器 + 流程控制）
// ══════════════════════════════════════════════════════════
async function runBotCycle(config) {
  if (!isRunning) return

  if (isNightTime(config)) {
    sendLog(`🌙 夜间暂停模式 (${config.nightModeStart}:00 - ${config.nightModeEnd}:00)，等待白天...`, 'warn')
    return
  }

  stats.runCount++
  sendStats()

  const modeLabel = config.mockMode ? '[模拟模式] ' : ''
  sendLog(`🚀 ${modeLabel}开始第 ${stats.runCount} 轮抓取 | 关键词数: ${config.keywords.length}`, 'info')

  for (let ki = 0; ki < config.keywords.length; ki++) {
    if (!isRunning) break
    const keyword = config.keywords[ki]
    sendLog(`🔍 [${ki + 1}/${config.keywords.length}] 搜索: "${keyword}"`, 'info')

    // 搜索
    const notes = await searchXiaohongshu(keyword)
    notes.forEach((n) => { n._keyword = keyword })

    if (notes.length === 0) {
      sendLog(`📭 "${keyword}" 无新笔记`, 'info')
    } else {
      sendLog(`📋 发现 ${notes.length} 条新笔记，开始逐一评估...`, 'info')
      stats.totalLeads += notes.length
      sendStats()
    }

    for (let ni = 0; ni < notes.length; ni++) {
      if (!isRunning) break
      const note = notes[ni]
      const noteId = note.id || note.note_id || `note_${ni}`

      // 标记为已见并持久化
      seenNoteIds.add(noteId)
      saveSeenIds()

      sendLog(`🔬 [${ni + 1}/${notes.length}] 评估: ${note.author || note.user?.nickname || '未知'} - "${(note.title || note.desc || '').substring(0, 25)}..."`, 'info')

      // 获取详情（加随机延迟防封）
      await randomDelay(2000, 5000)
      const detail = await getNoteDetail(noteId)

      // AI 评估
      const assessment = await evaluateWithLLM(note, detail)
      sendLog(`🤖 AI评分: [${assessment.score}] ${assessment.summary}`, assessment.score === 'S' || assessment.score === 'A' ? 'success' : 'info')

      if (assessment.score === 'S' || assessment.score === 'A') {
        stats.highIntentLeads++
        sendStats()

        // 写入本地 CSV
        sendLog(`📤 写入本地线索文件...`, 'info')
        const synced = await syncLead(note, detail, assessment)
        if (synced) {
          sendLog(`✅ 线索 [${assessment.score}] 已入库: ${note.author || '未知'}`, 'success')
        }

        // S 级：桌面通知
        if (assessment.score === 'S') {
          sendDesktopAlert(note, assessment)
          sendLog(`🔔 S级高意向！桌面通知已发送`, 'success')
        }
      } else {
        sendLog(`⏭️  跳过低意向 [${assessment.score}]: ${note.author || '未知'}`, 'info')
      }

      if (ni < notes.length - 1) {
        await randomDelay(5000, 12000) // 笔记间延迟
      }
    }

    if (ki < config.keywords.length - 1) {
      await randomDelay(8000, 20000) // 关键词间延迟
    }
  }

  sendLog(`✨ 第 ${stats.runCount} 轮完成 | 累计线索: ${stats.totalLeads} | 高意向: ${stats.highIntentLeads}`, 'success')
}

// ─── Bot 启停 ──────────────────────────────────────────────
function startBot() {
  if (isRunning) return
  const config = loadConfig()

  isRunning = true
  sendLog('▶️  监控已启动', 'success')
  sendLog(`⚙️  模式: ${config.mockMode ? '模拟' : '真实'}`, 'info')
  sendLog(`⚙️  关键词: ${config.keywords.slice(0, 3).join('、')}${config.keywords.length > 3 ? '...' : ''}`, 'info')
  sendLog(`⏰ 轮询间隔: ${config.intervalMinutes} 分钟`, 'info')

  if (mainWindow) mainWindow.webContents.send('bot-status', true)

  // 立即执行一次
  runBotCycle(config).catch((err) => sendLog(`❌ 运行出错: ${err.message}`, 'error'))

  botInterval = setInterval(() => {
    if (!isRunning) return
    const freshConfig = loadConfig()
    runBotCycle(freshConfig).catch((err) => sendLog(`❌ 运行出错: ${err.message}`, 'error'))
  }, config.intervalMinutes * 60 * 1000)
}

function stopBot() {
  if (!isRunning) return
  isRunning = false

  if (botInterval) {
    clearInterval(botInterval)
    botInterval = null
  }

  childProcesses.forEach((cp) => {
    try { cp.kill('SIGTERM') } catch (_) {}
  })
  childProcesses = []

  sendLog('⏹️  监控已停止', 'warn')
  if (mainWindow) mainWindow.webContents.send('bot-status', false)
}

// ─── 环境检测 ──────────────────────────────────────────────
function checkEnvironment() {
  const checks = [
    { cmd: 'python3 --version', name: 'Python 3' },
    { cmd: 'python3 -c "import xiaohongshu_skills; print(\'ok\')"', name: 'xiaohongshu-skills' },
  ]

  const results = []
  let pending = checks.length

  checks.forEach(({ cmd, name }) => {
    exec(cmd, { timeout: 10000 }, (err, stdout) => {
      const version = stdout?.trim().split('\n')[0] || ''
      results.push({ name, ok: !err && !version.includes('not found'), version })
      pending--
      if (pending === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('env-check', results)
      }
    })
  })
}

// ─── 创建窗口 ──────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    // mainWindow.webContents.openDevTools() // 取消注释以调试
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    checkEnvironment()
    sendStats()
    sendLog('🌸 小红书获客助手 v1.0 已启动！', 'success')
    sendLog('💡 请前往"设置中心"配置关键词和 LLM API Key，再点击"开始监控"', 'info')

    const config = loadConfig()
    if (config.mockMode) {
      sendLog('ℹ️  当前为模拟模式，数据不会真实抓取', 'warn')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC Handlers ──────────────────────────────────────────
ipcMain.handle('start-bot', () => { startBot(); return { ok: true } })
ipcMain.handle('stop-bot', () => { stopBot(); return { ok: true } })
ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, config) => ({ ok: saveConfig(config) }))
ipcMain.handle('get-stats', () => stats)
ipcMain.handle('reset-stats', () => {
  stats = { runCount: 0, totalLeads: 0, highIntentLeads: 0 }
  seenNoteIds.clear()
  sendStats()
  return { ok: true }
})
ipcMain.handle('get-status', () => ({ isRunning }))
ipcMain.handle('check-env', () => { checkEnvironment(); return { ok: true } })
ipcMain.handle('open-log-file', () => {
  const { shell } = require('electron')
  shell.openPath(LOG_PATH)
  return { ok: true }
})
ipcMain.handle('open-leads-folder', () => {
  const { shell } = require('electron')
  shell.openPath(getLeadsDir())
  return { ok: true }
})

// ─── 小红书扫码登录（内置浏览器窗口）───────────────────────
const XHS_COOKIES_PATH = path.join(app.getPath('userData'), 'xhs_cookies.json')

function openXhsLogin() {
  const loginWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: '小红书登录 - 请用手机 App 扫码',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loginWindow.loadURL('https://www.xiaohongshu.com')

  // 定时检查是否已登录（检测关键 cookie）
  const checkInterval = setInterval(async () => {
    try {
      const cookies = await loginWindow.webContents.session.cookies.get({ domain: '.xiaohongshu.com' })
      const hasLogin = cookies.some((c) => c.name === 'web_session' || c.name === 'a1')
      if (hasLogin) {
        // 保存所有 cookies
        const allCookies = await loginWindow.webContents.session.cookies.get({})
        const xhsCookies = allCookies.filter((c) => c.domain && c.domain.includes('xiaohongshu'))
        fs.writeFileSync(XHS_COOKIES_PATH, JSON.stringify(xhsCookies, null, 2), 'utf-8')
        sendLog('✅ 小红书登录成功！Cookies 已保存', 'success')
        clearInterval(checkInterval)
        loginWindow.close()
      }
    } catch (_) {}
  }, 2000)

  loginWindow.on('closed', () => {
    clearInterval(checkInterval)
  })
}

ipcMain.handle('xhs-login', () => {
  openXhsLogin()
  return { ok: true }
})

ipcMain.handle('check-xhs-login', () => {
  sendLog('🔑 正在检查小红书登录状态...', 'info')
  // 优先检查本地 cookies 文件
  if (fs.existsSync(XHS_COOKIES_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(XHS_COOKIES_PATH, 'utf-8'))
      if (cookies && cookies.length > 0) {
        sendLog('✅ 小红书登录正常（已保存登录凭证）', 'success')
        return { ok: true }
      }
    } catch (_) {}
  }
  sendLog('❌ 小红书未登录，请点击设置中的「扫码登录」按钮', 'error')
  return { ok: true }
})

ipcMain.handle('install-xhs-skills', () => {
  sendLog('📦 正在安装 xiaohongshu-skills，请稍候...', 'info')
  exec('pip3 install xiaohongshu-skills', { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      sendLog(`❌ 安装失败: ${stderr || err.message}`, 'error')
      sendLog('💡 请尝试手动运行: pip3 install xiaohongshu-skills', 'warn')
    } else {
      sendLog('✅ xiaohongshu-skills 安装成功！', 'success')
      checkEnvironment()
    }
  })
  return { ok: true }
})

// ─── 文件夹选择对话框 ────────────────────────────────────────
ipcMain.handle('select-leads-dir', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择线索保存文件夹',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { path: '' }
  }
  return { path: result.filePaths[0] }
})

// ─── App 生命周期 ──────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  stopBot()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  stopBot()
})
