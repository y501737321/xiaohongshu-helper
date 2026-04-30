const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { getUserDataPath } = require('./runtime-paths.cjs')

function getProjectRoot() {
  return path.join(__dirname, '..', '..')
}

function getSkillDir() {
  const candidates = [
    process.env.XHS_SKILL_DIR,
    path.join(getProjectRoot(), 'temp_skill'),
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(path.join(p, 'scripts', 'search.py'))) || candidates[0]
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
    fs.existsSync(path.join(getProjectRoot(), 'scripts', 'xhs_skill_bridge.py'))
}

function runSkillBridge(payload, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    if (!isSkillAvailable()) {
      reject(new Error(`xiaohongshu-skill 不可用: ${getSkillDir()}`))
      return
    }

    const { cookiePath, userDataDir } = getSkillDataPaths()
    const child = spawn(getPythonPath(), [
      path.join(getProjectRoot(), 'scripts', 'xhs_skill_bridge.py'),
      '--skill-dir', getSkillDir(),
      '--cookie-path', cookiePath,
      '--user-data-dir', userDataDir,
      '--timeout', String(Math.ceil(timeoutMs / 1000)),
    ], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch (_) {}
      reject(new Error(`Skill 超时 (${Math.round(timeoutMs / 1000)}s): ${stderr.slice(-300)}`))
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] || ''
      let parsed = null
      try { parsed = JSON.parse(last) } catch (_) {}

      if (code !== 0 || !parsed?.ok) {
        reject(new Error(parsed?.error || stderr.trim() || `Skill 退出 code=${code}`))
        return
      }
      resolve(parsed)
    })

    child.stdin.end(JSON.stringify(payload))
  })
}

async function skillSearch(keyword, { limit = 50, maxScrolls = 8, timeoutMs = 90000, filters = {} } = {}) {
  const res = await runSkillBridge({ action: 'search', keyword, limit, maxScrolls, filters }, timeoutMs)
  return Array.isArray(res.results) ? res.results : []
}

async function skillDetail(feedId, xsecToken, { timeoutMs = 90000 } = {}) {
  const res = await runSkillBridge({ action: 'detail', feedId, xsecToken, xsecSource: 'pc_search' }, timeoutMs)
  return res.detail || null
}

async function skillStatus(timeoutMs = 45000) {
  return runSkillBridge({ action: 'status' }, timeoutMs)
}

module.exports = {
  getSkillDir,
  getSkillDataPaths,
  isSkillAvailable,
  skillSearch,
  skillDetail,
  skillStatus,
}
