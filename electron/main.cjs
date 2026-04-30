const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')

// ─── 加载模块 ─────────────────────────────────────────────
const { httpRequest } = require('./lib/utils.cjs')
const { MCP_PORT, MCP_BASE_URL, getMcpBinaryPath, startMcpServer, stopMcpServer, isMcpRunning, mcpGet } = require('./lib/mcp-client.cjs')
const { getConfigPath, getLogPath, loadConfig, saveConfig, loadDailyStats, incrementDailyStat } = require('./lib/config.cjs')
const { loadSeenIds, saveSeenIds, loadSeenUserIds, saveSeenUserIds, resetWatermarks, getLeadsDir } = require('./lib/lead-storage.cjs')
const { batchEvaluateWithLLM, syncLead } = require('./lib/llm-evaluator.cjs')
const { runBotCycle } = require('./lib/bot-cycle.cjs')
const { loadKeywordStats, resetKeywordStats } = require('./lib/keyword-engine.cjs')

// ─── 路径工具 ─────────────────────────────────────────────
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!VITE_DEV_SERVER_URL

// ─── 全局状态 ─────────────────────────────────────────────
let mainWindow = null
let tray = null
let botTimer = null
let isRunning = false
let childProcesses = []
let seenNoteIds = null
let seenUserIds = null

let stats = {
  runCount: 0,
  totalLeads: 0,
  highIntentLeads: 0,
}

// ─── 日志系统 ─────────────────────────────────────────────
function sendLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const logEntry = { timestamp, message, type }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', logEntry)
  }

  const line = `[${new Date().toISOString()}] [${type.toUpperCase()}] ${message}\n`
  fs.appendFile(getLogPath(), line, () => {})
  try {
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`)
  } catch (_) {}
}

function sendStats() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stats', stats)
  }
}

const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000

function getRunFrequencyLabel(intervalMinutes) {
  const minutes = Number(intervalMinutes)
  if (minutes >= 43200) return '每月一次'
  if (minutes >= 10080) return '每周一次'
  return '每天一次'
}

function getRunIntervalMs(config) {
  return Math.max(1440, Number(config.intervalMinutes || 1440)) * 60 * 1000
}

function runBotCycleAndSchedule(config, cycleCtx) {
  runBotCycle(config, cycleCtx)
    .catch((err) => sendLog(`❌ 运行出错: ${err.message}`, 'error'))
    .finally(() => {
      if (!isRunning) return
      scheduleNextBotCycle(getRunIntervalMs(loadConfig()), cycleCtx)
    })
}

function scheduleNextBotCycle(remainingMs, cycleCtx) {
  if (!isRunning) return
  const delayMs = Math.min(remainingMs, MAX_TIMER_DELAY_MS)
  botTimer = setTimeout(() => {
    botTimer = null
    if (!isRunning) return
    if (remainingMs > MAX_TIMER_DELAY_MS) {
      scheduleNextBotCycle(remainingMs - MAX_TIMER_DELAY_MS, cycleCtx)
      return
    }
    runBotCycleAndSchedule(loadConfig(), cycleCtx)
  }, delayMs)
}

// ─── Bot 启停 ─────────────────────────────────────────────
function startBot() {
  if (isRunning) return
  const config = loadConfig()

  isRunning = true
  sendLog('▶️  监控已启动', 'success')
  sendLog(`⚙️  模式: ${config.mockMode ? '模拟' : '真实'}`, 'info')
  sendLog(`⚙️  关键词: ${config.keywords.slice(0, 3).join('、')}${config.keywords.length > 3 ? '...' : ''}`, 'info')
  sendLog(`⏰ 运行频率: ${getRunFrequencyLabel(config.intervalMinutes)}`, 'info')

  if (mainWindow) mainWindow.webContents.send('bot-status', true)

  const cycleCtx = {
    isRunning: () => isRunning,
    stats,
    sendStats,
    sendLog,
    seenNoteIds,
    seenUserIds,
  }

  runBotCycleAndSchedule(config, cycleCtx)
}

function stopBot() {
  if (!isRunning) return
  isRunning = false

  if (botTimer) {
    clearTimeout(botTimer)
    botTimer = null
  }

  childProcesses.forEach((cp) => {
    try { cp.kill('SIGTERM') } catch (_) {}
  })
  childProcesses = []

  sendLog('⏹️  监控已停止', 'warn')
  if (mainWindow) mainWindow.webContents.send('bot-status', false)
}

// ─── 环境检测 ─────────────────────────────────────────────
async function checkEnvironment() {
  const results = []

  const binPath = getMcpBinaryPath()
  const binExists = fs.existsSync(binPath)
  results.push({
    name: 'xiaohongshu-mcp',
    ok: binExists,
    version: binExists ? '内置版 v2026.04.17' : '未找到二进制文件',
  })

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

// ─── 创建窗口 ─────────────────────────────────────────────
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    sendStats()
    sendLog('🌸 小红书获客助手 v1.1 已启动！', 'success')
    sendLog('💡 请前往"设置中心"配置关键词和 LLM API Key，再点击"开始监控"', 'info')

    const config = loadConfig()
    if (config.mockMode) {
      sendLog('ℹ️  当前为模拟模式，数据不会真实抓取', 'warn')
    }

    startMcpServer(sendLog, checkEnvironment)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC Handlers ─────────────────────────────────────────
ipcMain.handle('start-bot', () => { startBot(); return { ok: true } })
ipcMain.handle('stop-bot', () => { stopBot(); return { ok: true } })
ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_, config) => ({ ok: saveConfig(config) }))
ipcMain.handle('get-stats', () => stats)
ipcMain.handle('get-daily-stats', () => loadDailyStats())
ipcMain.handle('reset-dedupe', () => {
  seenNoteIds.clear()
  seenUserIds.clear()
  saveSeenIds(seenNoteIds)
  saveSeenUserIds(seenUserIds)
  sendLog('🔄 去重记录已重置，下轮可能重新处理旧笔记或旧作者', 'warn')
  return { ok: true }
})
ipcMain.handle('get-status', () => ({ isRunning }))
ipcMain.handle('check-env', () => { checkEnvironment(); return { ok: true } })
ipcMain.handle('open-log-file', () => {
  const { shell } = require('electron')
  shell.openPath(getLogPath())
  return { ok: true }
})
ipcMain.handle('open-leads-folder', () => {
  const { shell } = require('electron')
  shell.openPath(getLeadsDir())
  return { ok: true }
})

// ─── 关键词统计 ───────────────────────────────────────────
ipcMain.handle('get-keyword-stats', () => loadKeywordStats())
ipcMain.handle('reset-keyword-stats', () => {
  resetKeywordStats()
  sendLog('🔄 关键词统计已重置', 'info')
  return { ok: true }
})

// ─── 水位线重置 ───────────────────────────────────────────
ipcMain.handle('reset-watermarks', () => {
  resetWatermarks()
  sendLog('🔄 水位线已重置，下轮将全量抓取', 'info')
  return { ok: true }
})

// ─── 小红书扫码登录 ───────────────────────────────────────
async function getXhsLoginState() {
  const res = await mcpGet('/api/v1/login/status')
  return {
    ok: res.status === 200,
    loggedIn: !!(res.status === 200 && res.body?.data?.is_logged_in),
    username: res.body?.data?.username || '',
  }
}

async function getXhsQrCode() {
  try {
    const state = await getXhsLoginState()
    if (state.loggedIn) return { ok: true, loggedIn: true, img: '', username: state.username }
  } catch (_) {}

  const res = await mcpGet('/api/v1/login/qrcode')
  if (res.status === 200 && res.body?.data?.img) {
    const timeout = Number(res.body.data.timeout || 180)
    return {
      ok: true,
      loggedIn: false,
      img: res.body.data.img,
      timeout,
      expiresAt: Date.now() + timeout * 1000,
    }
  }
  if (res.status === 200 && res.body?.data?.is_logged_in) {
    return { ok: true, loggedIn: true, img: '', username: res.body?.data?.username || '' }
  }
  return { ok: false, loggedIn: false, img: '', error: `状态码 ${res.status}` }
}

async function openXhsLogin() {
  let qrState = null
  try {
    // 先用 login/status 确认真实登录状态
    try {
      const statusRes = await mcpGet('/api/v1/login/status')
      if (statusRes.status === 200 && statusRes.body?.data?.is_logged_in) {
        sendLog('✅ 小红书已登录，无需重复扫码', 'success')
        checkEnvironment()
        return
      }
    } catch (_) {}

    qrState = await getXhsQrCode()
    if (qrState.loggedIn) {
      sendLog('✅ 小红书已登录，无需重复扫码', 'success')
      checkEnvironment()
      return
    }
    if (!qrState.ok || !qrState.img) throw new Error(qrState.error || '未返回二维码')
  } catch (err) {
    sendLog(`❌ 请求登录二维码失败: ${err.message}`, 'error')
    return
  }

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
    .countdown { color:#ffb800; }
  </style>
</head>
<body>
  <h3>🌸 小红书登录</h3>
  <img id="qr" src="${qrState.img}" />
  <p>请用小红书 App 扫描二维码登录<br/>登录成功后此窗口会自动关闭</p>
  <p class="tip">二维码过期会自动刷新 · <span id="countdown" class="countdown"></span></p>
</body></html>`

  loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  sendLog('📱 小红书登录二维码已弹出，请用 App 扫码', 'info')

  let expiresAt = qrState.expiresAt || (Date.now() + Number(qrState.timeout || 180) * 1000)
  let refreshInFlight = false
  const checkTimer = setInterval(async () => {
    try {
      const res = await mcpGet('/api/v1/login/status')
      if (res.status === 200 && res.body?.data?.is_logged_in) {
        sendLog('✅ 小红书登录成功！', 'success')
        clearInterval(checkTimer)
        if (!loginWindow.isDestroyed()) loginWindow.close()
        checkEnvironment()
      }
    } catch (_) {}

    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    if (!loginWindow.isDestroyed()) {
      loginWindow.webContents.executeJavaScript(
        `document.getElementById('countdown').textContent = ${JSON.stringify(`${remaining}s`)}`
      ).catch(() => {})
    }

    if (remaining > 0 || refreshInFlight) return
    refreshInFlight = true
    try {
      const nextQr = await getXhsQrCode()
      if (nextQr.loggedIn) {
        sendLog('✅ 小红书登录成功！', 'success')
        clearInterval(checkTimer)
        if (!loginWindow.isDestroyed()) loginWindow.close()
        checkEnvironment()
        return
      }
      if (nextQr.ok && nextQr.img) {
        expiresAt = nextQr.expiresAt || (Date.now() + Number(nextQr.timeout || 180) * 1000)
        if (!loginWindow.isDestroyed()) {
          loginWindow.webContents.executeJavaScript(
            `document.getElementById('qr').src = ${JSON.stringify(nextQr.img)}`
          ).catch(() => {})
        }
        sendLog('🔄 登录二维码已过期，已自动刷新', 'info')
      }
    } catch (err) {
      sendLog(`⚠️ 自动刷新登录二维码失败: ${err.message}`, 'warn')
      expiresAt = Date.now() + 15000
    } finally {
      refreshInFlight = false
    }
  }, 2000)

  loginWindow.on('closed', () => clearInterval(checkTimer))
}

ipcMain.handle('xhs-login', () => {
  openXhsLogin()
  return { ok: true }
})

ipcMain.handle('get-xhs-login-state', async () => {
  try {
    return await getXhsLoginState()
  } catch (err) {
    return { ok: false, loggedIn: false, username: '', error: err.message }
  }
})

ipcMain.handle('get-xhs-qrcode', async () => {
  try {
    return await getXhsQrCode()
  } catch (err) {
    return { ok: false, loggedIn: false, img: '', error: err.message }
  }
})

ipcMain.handle('check-xhs-login', async () => {
  sendLog('🔑 正在检查小红书登录状态...', 'info')
  try {
    const state = await getXhsLoginState()
    if (state.loggedIn) {
      sendLog('✅ 小红书登录正常', 'success')
      return { ok: true, loggedIn: true, username: state.username }
    } else {
      sendLog('❌ 小红书未登录，请点击设置中的「扫码登录」按钮', 'error')
      return { ok: true, loggedIn: false }
    }
  } catch (err) {
    sendLog(`❌ 检查登录状态失败: ${err.message}`, 'warn')
    return { ok: false, loggedIn: false }
  }
})

ipcMain.handle('install-xhs-skills', async () => {
  if (!isMcpRunning()) {
    sendLog('🔄 正在重新启动内置 MCP 服务...', 'info')
    startMcpServer(sendLog, checkEnvironment)
  } else {
    sendLog('✅ 小红书 MCP 服务已在运行中', 'success')
    checkEnvironment()
  }
  return { ok: true }
})

// ─── 文件夹选择 ───────────────────────────────────────────
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

// ─── App 生命周期 ─────────────────────────────────────────
app.whenReady().then(() => {
  // 在 app ready 后初始化需要 userData 路径的状态
  seenNoteIds = loadSeenIds()
  seenUserIds = loadSeenUserIds()
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
