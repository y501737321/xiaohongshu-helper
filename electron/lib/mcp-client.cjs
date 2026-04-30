const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { httpRequest } = require('./utils.cjs')
const { getUserDataPath, isPackaged, getResourcesPath } = require('./runtime-paths.cjs')

const MCP_PORT = 18060
const MCP_BASE_URL = `http://127.0.0.1:${MCP_PORT}`
let mcpProcess = null

function getMcpBinaryPath() {
  const binName = process.platform === 'win32'
    ? 'xiaohongshu-mcp-windows-amd64.exe'
    : process.arch === 'arm64'
      ? 'xiaohongshu-mcp-darwin-arm64'
      : 'xiaohongshu-mcp-darwin-amd64'

  if (isPackaged()) {
    return path.join(getResourcesPath(), 'bin', binName)
  }
  return path.join(__dirname, '..', '..', 'resources', 'bin', binName)
}

function startMcpServer(sendLog, onReady) {
  const binPath = getMcpBinaryPath()
  if (!fs.existsSync(binPath)) {
    sendLog(`⚠️  MCP 二进制文件不存在: ${binPath}`, 'warn')
    return
  }

  try { fs.chmodSync(binPath, '755') } catch (_) {}

  // MCP 源码通过 COOKIES_PATH 环境变量读取 cookie 文件路径（注意是文件，不是目录）
  const cookiesDir = path.join(getUserDataPath(), 'xhs_cookies')
  if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true })
  const cookiesPath = path.join(cookiesDir, 'cookies.json')

  sendLog(`🚀 正在启动小红书 MCP 服务 (端口 ${MCP_PORT})...`, 'info')

  mcpProcess = spawn(binPath, [], {
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      COOKIES_PATH: cookiesPath,
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

  waitForMcp(10).then((ok) => {
    if (ok) {
      sendLog('✅ 小红书 MCP 服务已就绪！', 'success')
      if (onReady) onReady()
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

function isMcpRunning() {
  return !!mcpProcess
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
  waitForMcp,
  mcpGet,
  mcpPost,
}
