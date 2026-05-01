const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { httpRequest } = require('./utils.cjs')
const { getUserDataPath, isPackaged, getResourcesPath } = require('./runtime-paths.cjs')

const MCP_PORT = 18060
const MCP_BASE_URL = `http://127.0.0.1:${MCP_PORT}`
let mcpProcess = null
let mcpStartInFlight = null
let lastMcpError = ''

function getMcpBinaryPath() {
  const binNames = process.platform === 'win32'
    ? ['xhs-helper-service.exe', 'xiaohongshu-mcp-windows-amd64.exe']
    : [
        process.arch === 'arm64' ? 'xiaohongshu-mcp-darwin-arm64' : 'xiaohongshu-mcp-darwin-amd64',
      ]

  const base = isPackaged()
    ? path.join(getResourcesPath(), 'bin')
    : path.join(__dirname, '..', '..', 'resources', 'bin')
  return binNames.map((name) => path.join(base, name)).find((p) => fs.existsSync(p)) || path.join(base, binNames[0])
}

function getMcpTroubleshootingHint(err) {
  const code = err?.code || ''
  const message = String(err?.message || err || '')
  if (process.platform === 'win32' && /EPERM|EACCES|operation not permitted|access is denied|拒绝访问/i.test(`${code} ${message}`)) {
    return 'Windows 可能拦截了内置服务程序。请打开 Windows 安全中心的“保护历史记录”，允许本应用的 xhs-helper-service.exe 后重启应用。'
  }
  if (/ENOENT|not found|no such file/i.test(`${code} ${message}`)) {
    return '内置服务程序缺失，请重新安装最新安装包。'
  }
  return message
}

function getLastMcpError() {
  return lastMcpError
}

function startMcpServer(sendLog, onReady) {
  if (mcpStartInFlight) return mcpStartInFlight
  const binPath = getMcpBinaryPath()
  if (!fs.existsSync(binPath)) {
    lastMcpError = `内置服务程序不存在: ${binPath}`
    sendLog(`⚠️  ${lastMcpError}`, 'warn')
    return Promise.resolve(false)
  }

  try { fs.chmodSync(binPath, '755') } catch (_) {}

  // MCP 源码通过 COOKIES_PATH 环境变量读取 cookie 文件路径（注意是文件，不是目录）
  const cookiesDir = path.join(getUserDataPath(), 'xhs_cookies')
  if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true })
  const cookiesPath = path.join(cookiesDir, 'cookies.json')

  lastMcpError = ''
  sendLog(`🚀 正在启动小红书 MCP 服务 (端口 ${MCP_PORT})...`, 'info')
  sendLog(`🔧 服务路径: ${binPath}`, 'info')

  try {
    mcpProcess = spawn(binPath, [], {
      env: {
        ...process.env,
        PORT: String(MCP_PORT),
        COOKIES_PATH: cookiesPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    lastMcpError = getMcpTroubleshootingHint(err)
    sendLog(`❌ MCP 服务启动失败: ${lastMcpError}`, 'error')
    return Promise.resolve(false)
  }

  mcpProcess.stdout.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      try { console.log('[MCP]', line) } catch (_) {}
    }
  })
  mcpProcess.stderr.on('data', (d) => {
    const line = d.toString().trim()
    if (line) {
      lastMcpError = line
      try { console.error('[MCP ERR]', line) } catch (_) {}
    }
  })
  mcpProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) lastMcpError = `服务退出 code=${code}`
    sendLog(`ℹ️  MCP 服务已退出 (code=${code})`, 'info')
    mcpProcess = null
  })
  mcpProcess.on('error', (err) => {
    lastMcpError = getMcpTroubleshootingHint(err)
    sendLog(`❌ MCP 服务启动失败: ${lastMcpError}`, 'error')
    mcpProcess = null
  })

  mcpStartInFlight = waitForMcp(10).then((ok) => {
    if (ok) {
      lastMcpError = ''
      sendLog('✅ 小红书 MCP 服务已就绪！', 'success')
      if (onReady) onReady()
    } else {
      lastMcpError = lastMcpError || 'MCP 服务启动超时。若 Windows 弹出安全警告，请在保护历史记录中允许本应用服务程序。'
      sendLog(`❌ ${lastMcpError}`, 'error')
    }
    return ok
  }).finally(() => {
    mcpStartInFlight = null
  })
  return mcpStartInFlight
}

function stopMcpServer() {
  if (mcpProcess) {
    try { mcpProcess.kill('SIGTERM') } catch (_) {}
    mcpProcess = null
  }
}

function isMcpRunning() {
  return !!mcpProcess
}

async function ensureMcpServer(sendLog, onReady) {
  if (await waitForMcp(1, 0)) return true
  return await startMcpServer(sendLog, onReady)
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

function mcpGet(apiPath) {
  return httpRequest(`${MCP_BASE_URL}${apiPath}`, { timeout: 30000 })
}

function mcpPost(apiPath, body, timeout = 90000) {
  return httpRequest(
    `${MCP_BASE_URL}${apiPath}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout },
    body
  )
}

module.exports = {
  MCP_PORT,
  MCP_BASE_URL,
  getMcpBinaryPath,
  startMcpServer,
  stopMcpServer,
  isMcpRunning,
  ensureMcpServer,
  getLastMcpError,
  waitForMcp,
  mcpGet,
  mcpPost,
}
