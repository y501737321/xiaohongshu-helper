const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')
const https = require('https')
const http = require('http')
const { URL } = require('url')

// ─── MCP 服务器管理 ──────────────────────────────────────────
const MCP_PORT = 18060
const MCP_BASE_URL = `http://127.0.0.1:${MCP_PORT}`
let mcpProcess = null

function getMcpBinaryPath() {
  // 打包后路径在 process.resourcesPath/bin/，开发时在 resources/bin/
  const binName = process.platform === 'win32'
    ? 'xiaohongshu-mcp-windows-amd64.exe'
    : process.arch === 'arm64'
      ? 'xiaohongshu-mcp-darwin-arm64'
      : 'xiaohongshu-mcp-darwin-amd64'

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binName)
  }
  return path.join(__dirname, '..', 'resources', 'bin', binName)
}

function startMcpServer() {
  const binPath = getMcpBinaryPath()
  if (!fs.existsSync(binPath)) {
    sendLog(`⚠️  MCP 二进制文件不存在: ${binPath}`, 'warn')
    return
  }

  // 确保有执行权限
  try { fs.chmodSync(binPath, '755') } catch (_) {}

  // cookies 存储目录（userData 下）
  const cookiesDir = path.join(app.getPath('userData'), 'xhs_cookies')
  if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true })

  sendLog(`🚀 正在启动小红书 MCP 服务 (端口 ${MCP_PORT})...`, 'info')

  mcpProcess = spawn(binPath, [], {
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      COOKIES_DIR: cookiesDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  mcpProcess.stdout.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      try { console.log('[MCP]', line) } catch (_) {}
    }
  })
  mcpProcess.stderr.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      try { console.error('[MCP ERR]', line) } catch (_) {}
    }
  })
  mcpProcess.on('exit', (code) => {
    sendLog(`ℹ️  MCP 服务已退出 (code=${code})`, 'info')
    mcpProcess = null
  })
  mcpProcess.on('error', (err) => {
    sendLog(`❌ MCP 服务启动失败: ${err.message}`, 'error')
    mcpProcess = null
  })

  // 等待服务就绪
  waitForMcp(10).then((ok) => {
    if (ok) {
      sendLog('✅ 小红书 MCP 服务已就绪！', 'success')
      checkEnvironment()
    } else {
      sendLog('❌ MCP 服务启动超时，请重启应用', 'error')
    }
  })
}

function stopMcpServer() {
  if (mcpProcess) {
    try { mcpProcess.kill('SIGTERM') } catch (_) {}
    mcpProcess = null
  }
}

async function waitForMcp(retries = 10, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await httpRequest(`${MCP_BASE_URL}/health`, { timeout: 2000 })
      if (res.status === 200) return true
    } catch (_) {}
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return false
}

// ─── MCP HTTP 客户端 ─────────────────────────────────────────
function mcpGet(path) {
  return httpRequest(`${MCP_BASE_URL}${path}`, { timeout: 30000 })
}

function mcpPost(path, body) {
  return httpRequest(
    `${MCP_BASE_URL}${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 60000 },
    body
  )
}

// ─── 路径工具 ──────────────────────────────────────────────
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!VITE_DEV_SERVER_URL

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const LOG_PATH = path.join(app.getPath('userData'), 'run.log')

// ─── 默认配置 ──────────────────────────────────────────────
const DEFAULT_CONFIG = {
  keywords: ['求推荐私教', '想找私人教练', '求靠谱健身教练', '私教推荐', '产后恢复教练推荐'],
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 7,
  mockMode: false,
  targetCity: '天津',
  maxDaysAgo: 1,
  intervalMinutes: 1440,
  adFilterWords: ['接广告', '商务合作', '课程售价', '原价', '限时优惠', '私信领取', '代理加盟', '学员招募', '训练营报名', '品牌方'],
  commentIntentWords: ['求推荐', '想找私教', '有私教推荐吗', '同城', '怎么收费', '多少钱', '在哪里', '能约课吗', '求教练', '有好的教练吗'],
}

// ─── 全局状态 ──────────────────────────────────────────────
let mainWindow = null
let tray = null
let botInterval = null
let isRunning = false
let childProcesses = []
const SEEN_IDS_PATH = path.join(app.getPath('userData'), 'seen_ids.json')
const SEEN_USER_IDS_PATH = path.join(app.getPath('userData'), 'seen_user_ids.json')
let seenNoteIds = loadSeenIds() // 去重：避免对同一笔记重复处理（持久化）
let seenUserIds = loadSeenUserIds() // 去重：避免对同一潜在客户重复处理

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

function loadSeenUserIds() {
  try {
    if (fs.existsSync(SEEN_USER_IDS_PATH)) {
      const arr = JSON.parse(fs.readFileSync(SEEN_USER_IDS_PATH, 'utf-8'))
      return new Set(arr.slice(-50000)) // 保留较多用户ID
    }
  } catch (_) {}
  return new Set()
}

function saveSeenUserIds() {
  try {
    fs.writeFileSync(SEEN_USER_IDS_PATH, JSON.stringify([...seenUserIds]), 'utf-8')
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
  try {
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`)
  } catch (_) {}
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

// ─── 4.1 小红书搜索（调用本地 MCP HTTP 服务）───────────────
async function searchXiaohongshu(keyword) {
  const config = loadConfig()
  if (config.mockMode) {
    return mockSearch(keyword)
  }

  try {
    const res = await mcpPost('/api/v1/feeds/search', { keyword, filters: {} })
    if (res.status !== 200) {
      throw new Error(`MCP 返回 ${res.status}`)
    }
    const items = res.body?.data?.items || res.body?.data?.feeds || res.body?.data || []
    const notes = Array.isArray(items) ? items : []
    // 规范化字段
    const normalized = notes.map((n) => {
      // 如果数据结构包含 noteCard，从中提取有用信息
      const card = n.noteCard || {}
      return {
        id: n.id || n.note_id || n.feed_id,
        note_id: n.id || n.note_id || n.feed_id,
        xsec_token: n.xsecToken || n.xsec_token || '',
        title: card.displayTitle || n.title || n.desc || '',
        desc: card.displayTitle || n.desc || n.title || '',
        author: card.user?.nickname || card.user?.nickName || n.user?.nickname || n.author || '未知',
        user: card.user || n.user || { id: n.user_id, nickname: n.author || '未知' },
        ...n,
      }
    })
    return normalized.filter((n) => !seenNoteIds.has(n.id))
  } catch (err) {
    sendLog(`⚠️  搜索"${keyword}"失败: ${err.message}`, 'warn')
    return []
  }
}

// ─── 4.2 获取笔记详情 ──────────────────────────────────────
async function getNoteDetail(noteId, xsecToken) {
  const config = loadConfig()
  if (config.mockMode) {
    return { content: `[模拟详情] 笔记 ${noteId} 的完整内容...我一直想找一个专业的私教来帮我制定训练计划`, comments: [] }
  }

  try {
    const res = await mcpPost('/api/v1/feeds/detail', {
      feed_id: noteId,
      xsec_token: xsecToken || '',
      load_all_comments: true,
    })
    if (res.status !== 200) throw new Error(`MCP 返回 ${res.status}`)
    
    // 从多层嵌套的数据结构中提取笔记内容和评论
    const noteData = res.body?.data?.data?.note || res.body?.data?.note || {}
    const commentsData = res.body?.data?.data?.comments || res.body?.data?.comments || []
    
    return {
      content: noteData.desc || noteData.content || res.body?.data?.content || '',
      comments: Array.isArray(commentsData) ? commentsData : [],
      time: noteData.time || Date.now(), // 如果没有解析到时间则默认当前时间，避免被误判为太旧
      ipLocation: noteData.ipLocation || ''
    }
  } catch (err) {
    sendLog(`⚠️  获取笔记详情失败 ${noteId}: ${err.message}`, 'warn')
    return null
  }
}

// ─── 4.3 LLM 批量意向评估 ──────────────────────────────────────
async function batchEvaluateWithLLM(notesWithDetails) {
  const config = loadConfig()
  
  if (notesWithDetails.length === 0) return []

  if (config.mockMode || !config.llmApiKey) {
    return notesWithDetails.map(item => ({
      id: item.note.id,
      ...mockLLMEval()
    }))
  }

  const targetCity = config.targetCity || '天津'
  const promptContent = notesWithDetails.map((item, idx) => {
    return `--- 笔记 ID: ${item.note.id} ---
【标题】${item.note.title || item.note.desc || ''}
【IP属地】${item.detail?.ipLocation || '未知'}
【正文】${item.detail?.content || item.note.content || item.note.desc || ''}
【评论摘要】${(item.detail?.comments || []).slice(0, 3).map((c) => c.content).join(' | ')}`;
  }).join('\n\n')

  const prompt = `判断以下小红书笔记发布者是否有真实的健身私教需求，排除广告和卖课。
目标城市：${targetCity}，IP属地匹配的优先级更高，但IP不匹配不代表排除（可能用VPN或在外地）。

评分：S=急迫找私教,有具体需求 A=明确需求,积极询问 B=意向不明 C=广告/卖课/无关

${promptContent}

返回JSON数组，无额外文字：
[{"id":"笔记ID","score":"X","summary":"一句话需求"}]`

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
        timeout: 60000,
      },
      {
        model: config.llmModel || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2000,
      }
    )

    if (res.status !== 200) {
      throw new Error(`LLM API 错误: ${res.status} - ${JSON.stringify(res.body)}`)
    }

    const text = res.body.choices?.[0]?.message?.content || ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    throw new Error('LLM 返回格式无效')
  } catch (err) {
    sendLog(`⚠️  LLM 批量评估失败: ${err.message}`, 'warn')
    return notesWithDetails.map(item => ({
      id: item.note.id,
      score: 'B', 
      summary: 'AI 评估失败，跳过', 
      author_intent: ''
    }))
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

// ─── 4.6 评论区客户挖掘（零 LLM 开销）─────────────────────
function extractCommentLeads(note, comments, config) {
  const intentWords = config.commentIntentWords || []
  if (intentWords.length === 0 || !Array.isArray(comments)) return []

  const leads = []
  for (const comment of comments) {
    const text = comment.content || ''
    const userId = comment.userInfo?.userId || comment.userId || ''
    const nickname = comment.userInfo?.nickname || comment.nickName || comment.nickname || '评论用户'

    if (!text || !userId) continue
    if (seenUserIds.has(userId)) continue

    const matched = intentWords.find(w => text.includes(w))
    if (matched) {
      seenUserIds.add(userId)
      leads.push({
        user: { id: userId, nickname },
        author: nickname,
        id: note.id,
        note_id: note.id,
        title: note.title || note.desc || '',
        _keyword: note._keyword || '',
        _commentText: text.substring(0, 80),
      })
    }
  }
  return leads
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

  let allNewNotes = []

  for (let ki = 0; ki < config.keywords.length; ki++) {
    if (!isRunning) break
    const keyword = config.keywords[ki]
    sendLog(`🔍 [${ki + 1}/${config.keywords.length}] 搜索: "${keyword}"`, 'info')

    // 搜索
    const notes = await searchXiaohongshu(keyword)
    const adWords = config.adFilterWords || []

    let newCount = 0
    let adSkipped = 0
    notes.forEach((note) => {
      note._keyword = keyword
      const noteId = note.id || note.note_id
      const authorId = note.user?.userId || note.user?.id || note.author || '未知'

      // 前置广告过滤：标题命中广告词直接跳过，不获取详情不送LLM
      if (adWords.length > 0) {
        const text = ((note.title || '') + ' ' + (note.desc || '')).toLowerCase()
        if (adWords.some(w => text.includes(w.toLowerCase()))) {
          adSkipped++
          return
        }
      }

      // 比对笔记ID和用户ID
      if (!seenNoteIds.has(noteId) && !seenUserIds.has(authorId)) {
        allNewNotes.push(note)
        seenNoteIds.add(noteId)
        newCount++
      }
    })

    if (newCount === 0 && adSkipped === 0) {
      sendLog(`📭 "${keyword}" 无新笔记`, 'info')
    } else {
      sendLog(`📋 "${keyword}" 发现 ${newCount} 条新笔记${adSkipped > 0 ? `，过滤 ${adSkipped} 条广告` : ''}`, 'info')
    }

    if (ki < config.keywords.length - 1) {
      await randomDelay(5000, 10000) // 关键词间延迟
    }
  }

  saveSeenIds()
  saveSeenUserIds()

  if (allNewNotes.length === 0) {
    sendLog(`✨ 第 ${stats.runCount} 轮完成 | 累计线索: ${stats.totalLeads} | 高意向: ${stats.highIntentLeads}`, 'success')
    return
  }

  sendLog(`📦 准备获取 ${allNewNotes.length} 条新笔记的详情...`, 'info')

  let notesWithDetails = []
  const maxDaysMs = (config.maxDaysAgo || 1) * 24 * 60 * 60 * 1000
  const cutoffTime = Date.now() - maxDaysMs

  for (let ni = 0; ni < allNewNotes.length; ni++) {
    if (!isRunning) break
    const note = allNewNotes[ni]
    sendLog(`[${ni + 1}/${allNewNotes.length}] 获取详情: ${note.author} - "${(note.title || note.desc || '').substring(0, 15)}..."`, 'info')

    await randomDelay(2000, 5000)
    const detail = await getNoteDetail(note.id, note.xsec_token)
    
    // 检查时间戳：过滤掉超过规定天数的旧笔记
    if (detail && detail.time && detail.time < cutoffTime) {
      sendLog(`⏳ 笔记过旧已跳过 (超过${config.maxDaysAgo || 1}天): ${note.author}`, 'info')
      continue
    }

    // 记录 IP 属地信息，交由 AI 综合判断
    if (detail && detail.ipLocation) {
      sendLog(`📍 IP属地: ${detail.ipLocation} (${detail.ipLocation.includes(config.targetCity || '天津') ? '匹配' : '不匹配'})，交由 AI 评估权重`, 'info')
    }

    // 记录用户ID以防后续重复联系
    const authorId = note.user?.userId || note.user?.id || note.author || '未知'
    seenUserIds.add(authorId)

    notesWithDetails.push({ note, detail })

    // 评论区客户挖掘（零 LLM 开销）
    if (detail && detail.comments) {
      const commentLeads = extractCommentLeads(note, detail.comments, config)
      for (const lead of commentLeads) {
        const commentAssessment = { score: 'C-评论', summary: lead._commentText, author_intent: '' }
        await saveLeadToLocal(lead, detail, commentAssessment)
        sendLog(`💬 评论线索: ${lead.author} - "${lead._commentText.substring(0, 30)}..."`, 'success')
      }
      if (commentLeads.length > 0) {
        sendLog(`💬 从评论区发现 ${commentLeads.length} 条潜在客户`, 'success')
      }
    }
  }

  if (notesWithDetails.length > 0) {
    stats.totalLeads += notesWithDetails.length
    sendStats()
    
    sendLog(`🤖 开始将 ${notesWithDetails.length} 条有效笔记发送给大模型进行批量评级...`, 'info')
    const batchAssessments = await batchEvaluateWithLLM(notesWithDetails)

    for (const item of notesWithDetails) {
      const { note, detail } = item
      const assessment = batchAssessments.find(a => String(a.id) === String(note.id)) || { score: 'B', summary: 'AI 未返回评估' }
      
      sendLog(`🤖 结果 [${assessment.score}]: ${note.author} - ${assessment.summary}`, assessment.score === 'S' || assessment.score === 'A' ? 'success' : 'info')

      if (assessment.score === 'S' || assessment.score === 'A') {
        stats.highIntentLeads++
        sendStats()

        const synced = await syncLead(note, detail, assessment)
        if (synced) {
          sendLog(`✅ 线索 [${assessment.score}] 已入库: ${note.author || '未知'}`, 'success')
        }

        if (assessment.score === 'S') {
          sendDesktopAlert(note, assessment)
        }
      }
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

// ─── 环境检测（检查 MCP 服务是否就绪）─────────────────────
async function checkEnvironment() {
  const results = []

  // 检测 MCP 二进制是否存在
  const binPath = getMcpBinaryPath()
  const binExists = fs.existsSync(binPath)
  results.push({
    name: 'xiaohongshu-mcp',
    ok: binExists,
    version: binExists ? '内置版 v2026.04.17' : '未找到二进制文件',
  })

  // 检测 MCP 服务是否在线
  try {
    const res = await httpRequest(`${MCP_BASE_URL}/health`, { timeout: 3000 })
    results.push({
      name: 'MCP 服务',
      ok: res.status === 200,
      version: res.status === 200 ? `运行中 (端口 ${MCP_PORT})` : `异常 (${res.status})`,
    })
  } catch (_) {
    results.push({ name: 'MCP 服务', ok: false, version: '未运行' })
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('env-check', results)
  }
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
    sendStats()
    sendLog('🌸 小红书获客助手 v1.0 已启动！', 'success')
    sendLog('💡 请前往"设置中心"配置关键词和 LLM API Key，再点击"开始监控"', 'info')

    const config = loadConfig()
    if (config.mockMode) {
      sendLog('ℹ️  当前为模拟模式，数据不会真实抓取', 'warn')
    }

    // 启动内置 MCP 服务
    startMcpServer()
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
  seenUserIds.clear()
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

// ─── 小红书扫码登录（MCP 二维码 API）─────────────────────────
async function openXhsLogin() {
  // 向 MCP 服务请求登录二维码
  let qrcodeBase64 = ''
  try {
    const res = await mcpGet('/api/v1/login/qrcode')
    if (res.status === 200 && res.body?.data?.img) {
      qrcodeBase64 = res.body.data.img
    } else {
      sendLog(`❌ 获取登录二维码失败: 状态码 ${res.status}, body: ${JSON.stringify(res.body).substring(0, 200)}`, 'error')
      return
    }
  } catch (err) {
    sendLog(`❌ 请求登录二维码失败: ${err.message}`, 'error')
    return
  }

  // 创建二维码展示窗口
  const loginWindow = new BrowserWindow({
    width: 360,
    height: 440,
    title: '小红书登录 - 请用手机 App 扫码',
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f1a',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>小红书登录</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#0f0f1a; color:#e0e0e0; font-family:-apple-system,sans-serif;
           display:flex; flex-direction:column; align-items:center; justify-content:center;
           height:100vh; gap:16px; }
    img { width:220px; height:220px; border-radius:12px; border:2px solid rgba(255,68,68,.4); }
    h3 { font-size:15px; color:#ff4444; }
    p  { font-size:12px; color:#888; text-align:center; line-height:1.6; max-width:260px; }
    .tip { font-size:11px; color:#555; }
  </style>
</head>
<body>
  <h3>🌸 小红书登录</h3>
  <img src="${qrcodeBase64}" />
  <p>请用小红书 App 扫描二维码登录<br/>登录成功后此窗口会自动关闭</p>
  <p class="tip">二维码有效期约3分钟，过期请重新点击登录</p>
</body></html>`

  loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  sendLog('📱 小红书登录二维码已弹出，请用 App 扫码', 'info')

  // 轮询登录状态
  let loginCheckCount = 0
  const checkTimer = setInterval(async () => {
    loginCheckCount++
    if (loginCheckCount > 90) { clearInterval(checkTimer); return }
    try {
      const res = await mcpGet('/api/v1/login/status')
      if (res.status === 200 && res.body?.data?.is_logged_in) {
        sendLog('✅ 小红书登录成功！', 'success')
        clearInterval(checkTimer)
        if (!loginWindow.isDestroyed()) loginWindow.close()
        checkEnvironment()
      }
    } catch (_) {}
  }, 2000)

  loginWindow.on('closed', () => clearInterval(checkTimer))
}

ipcMain.handle('xhs-login', () => {
  openXhsLogin()
  return { ok: true }
})


ipcMain.handle('check-xhs-login', async () => {
  sendLog('🔑 正在检查小红书登录状态...', 'info')
  try {
    const res = await mcpGet('/api/v1/login/status')
    if (res.status === 200 && res.body?.data?.is_logged_in) {
      sendLog('✅ 小红书登录正常', 'success')
    } else {
      sendLog('❌ 小红书未登录，请点击设置中的「扫码登录」按钮', 'error')
    }
  } catch (err) {
    sendLog(`❌ 检查登录状态失败: ${err.message}`, 'warn')
  }
  return { ok: true }
})


ipcMain.handle('install-xhs-skills', async () => {
  // MCP 服务器已内置，无需安装
  // 如果服务未运行则重新启动
  if (!mcpProcess) {
    sendLog('🔄 正在重新启动内置 MCP 服务...', 'info')
    startMcpServer()
  } else {
    sendLog('✅ 小红书 MCP 服务已在运行中', 'success')
    checkEnvironment()
  }
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
  stopMcpServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  stopBot()
  stopMcpServer()
})
