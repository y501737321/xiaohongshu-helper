const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { getUserDataPath, getResourcesPath, isPackaged } = require('./runtime-paths.cjs')
const { loadConfig } = require('./config.cjs')

const activeSkillProcesses = new Set()

function getProjectRoot() {
  return path.join(__dirname, '..', '..')
}

function getSkillDir() {
  const candidates = [
    process.env.XHS_SKILL_DIR,
    path.join(getUserDataPath(), 'xiaohongshu-skill'),
    isPackaged() ? path.join(getResourcesPath(), 'temp_skill') : '',
    path.join(getProjectRoot(), 'temp_skill'),
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(path.join(p, 'scripts', 'search.py'))) || candidates[0]
}

function getBridgePath() {
  const candidates = [
    isPackaged() ? path.join(getResourcesPath(), 'scripts', 'xhs_skill_bridge.py') : '',
    path.join(getProjectRoot(), 'scripts', 'xhs_skill_bridge.py'),
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}

function getPythonPath() {
  const skillDir = getSkillDir()
  const venvPython = process.platform === 'win32'
    ? path.join(skillDir, 'venv', 'Scripts', 'python.exe')
    : path.join(skillDir, 'venv', 'bin', 'python')
  if (fs.existsSync(venvPython)) return venvPython
  return process.env.XHS_SKILL_PYTHON || 'python3'
}

function getSkillDataPaths() {
  const base = path.join(getUserDataPath(), 'xhs_skill')
  return {
    cookiePath: process.env.XHS_SKILL_COOKIE_PATH || path.join(base, 'cookies.json'),
    userDataDir: process.env.XHS_SKILL_USER_DATA_DIR || path.join(base, 'browser-data'),
  }
}

function isSkillAvailable() {
  const skillDir = getSkillDir()
  return fs.existsSync(path.join(skillDir, 'scripts', 'search.py')) &&
    fs.existsSync(getBridgePath())
}

function getManualVerificationOptions() {
  const config = loadConfig()
  return {
    allowManualVerification: config.allowManualVerification !== false,
    manualVerifyTimeoutMs: Number(config.manualVerifyTimeoutMs || 180000),
  }
}

function isManualVerificationError(err) {
  return /NEEDS_MANUAL_VERIFICATION|MANUAL_VERIFICATION_TIMEOUT|安全验证|风险|验证/.test(String(err?.message || err || ''))
}

function runSkillBridge(payload, timeoutMs = 90000, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isSkillAvailable()) {
      reject(new Error(`xiaohongshu-skill 不可用: ${getSkillDir()}`))
      return
    }

    const { cookiePath, userDataDir } = getSkillDataPaths()
    const child = spawn(getPythonPath(), [
      getBridgePath(),
      '--skill-dir', getSkillDir(),
      '--cookie-path', cookiePath,
      '--user-data-dir', userDataDir,
      '--timeout', String(Math.ceil(timeoutMs / 1000)),
      '--headless', options.headless === false ? '0' : '1',
      '--manual-verify-timeout', String(Math.ceil(Number(options.manualVerifyTimeoutMs || 180000) / 1000)),
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    activeSkillProcesses.add(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeSkillProcesses.delete(child)
      fn(value)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch (_) {}
      settle(reject, new Error(`Skill 超时 (${Math.round(timeoutMs / 1000)}s): ${stderr.slice(-300)}`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      settle(reject, err)
    })
    child.on('exit', (code) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] || ''
      let parsed = null
      try { parsed = JSON.parse(last) } catch (_) {}

      if (code !== 0 || !parsed?.ok) {
        settle(reject, new Error(parsed?.error || stderr.trim() || `Skill 退出 code=${code}`))
        return
      }
      settle(resolve, parsed)
    })

    child.stdin.end(JSON.stringify(payload))
  })
}

async function skillSearch(keyword, { limit = 50, maxScrolls = 8, timeoutMs = 90000, filters = {} } = {}) {
  const payload = { action: 'search', keyword, limit, maxScrolls, filters }
  const manual = getManualVerificationOptions()
  let res
  try {
    res = await runSkillBridge(payload, timeoutMs, {
      headless: true,
      manualVerifyTimeoutMs: manual.manualVerifyTimeoutMs,
    })
  } catch (err) {
    if (!manual.allowManualVerification || !isManualVerificationError(err)) throw err
    res = await runSkillBridge(payload, timeoutMs + manual.manualVerifyTimeoutMs, {
      headless: false,
      manualVerifyTimeoutMs: manual.manualVerifyTimeoutMs,
    })
  }
  return Array.isArray(res.results) ? res.results : []
}

async function skillDetail(feedId, xsecToken, { timeoutMs = 90000 } = {}) {
  const payload = { action: 'detail', feedId, xsecToken, xsecSource: 'pc_search' }
  const manual = getManualVerificationOptions()
  let res
  try {
    res = await runSkillBridge(payload, timeoutMs, {
      headless: true,
      manualVerifyTimeoutMs: manual.manualVerifyTimeoutMs,
    })
  } catch (err) {
    if (!manual.allowManualVerification || !isManualVerificationError(err)) throw err
    res = await runSkillBridge(payload, timeoutMs + manual.manualVerifyTimeoutMs, {
      headless: false,
      manualVerifyTimeoutMs: manual.manualVerifyTimeoutMs,
    })
  }
  return res.detail || null
}

async function skillStatus(timeoutMs = 45000) {
  return runSkillBridge({ action: 'status' }, timeoutMs, { headless: true })
}

function killSkillProcesses() {
  for (const child of activeSkillProcesses) {
    try { child.kill('SIGTERM') } catch (_) {}
  }
  activeSkillProcesses.clear()
}

module.exports = {
  getSkillDir,
  getSkillDataPaths,
  isSkillAvailable,
  skillSearch,
  skillDetail,
  skillStatus,
  killSkillProcesses,
}
