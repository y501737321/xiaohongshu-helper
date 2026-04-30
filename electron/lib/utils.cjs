const https = require('https')
const http = require('http')
const { URL } = require('url')

// ─── HTTP 请求 ────────────────────────────────────────────
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

// ─── 延迟 ─────────────────────────────────────────────────
function randomDelay(minMs = 5000, maxMs = 15000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── 带重试的异步调用 ─────────────────────────────────────
async function withRetry(fn, { retries = 2, delayMs = 3000, label = '', sendLog } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt < retries) {
        if (sendLog) sendLog(`🔄 ${label}失败 (第${attempt + 1}次)，${delayMs / 1000}s 后重试: ${err.message}`, 'warn')
        await new Promise(r => setTimeout(r, delayMs))
      } else {
        throw err
      }
    }
  }
}

// ─── 笔记 ID / 时间戳工具 ─────────────────────────────────
function cleanNoteId(noteId) {
  return String(noteId || '').split('#')[0]
}

function normalizeTimestamp(rawTime) {
  if (!rawTime) return 0
  if (typeof rawTime === 'string') {
    const relative = parseXhsTime(rawTime)
    if (relative > 0) return relative
  }
  const parsed = Number(rawTime)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return String(Math.trunc(parsed)).length <= 10 ? parsed * 1000 : parsed
}

function parseXhsTime(raw) {
  const text = String(raw || '').trim()
  if (!text) return 0
  const now = Date.now()

  const minute = text.match(/^(\d+)\s*分钟前$/)
  if (minute) return now - Number(minute[1]) * 60 * 1000

  const hour = text.match(/^(\d+)\s*小时前$/)
  if (hour) return now - Number(hour[1]) * 60 * 60 * 1000

  if (text === '刚刚') return now
  if (text.startsWith('昨天')) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const time = text.match(/(\d{1,2}):(\d{2})/)
    d.setHours(time ? Number(time[1]) : 0, time ? Number(time[2]) : 0, 0, 0)
    return d.getTime()
  }

  const monthDay = text.match(/^(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (monthDay) {
    const d = new Date()
    d.setMonth(Number(monthDay[1]) - 1, Number(monthDay[2]))
    d.setHours(monthDay[3] ? Number(monthDay[3]) : 0, monthDay[4] ? Number(monthDay[4]) : 0, 0, 0)
    return d.getTime()
  }

  const fullDate = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (fullDate) {
    const d = new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]), fullDate[4] ? Number(fullDate[4]) : 0, fullDate[5] ? Number(fullDate[5]) : 0, 0, 0)
    return d.getTime()
  }

  return 0
}

function localDateKey(ts = Date.now()) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfLocalDay(ts = Date.now()) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function getAuthorId(note) {
  return note.user?.userId || note.user?.id || note.user_id || ''
}

// ─── 夜间模式 ─────────────────────────────────────────────
function isNightTime(config) {
  const hour = new Date().getHours()
  return hour >= (config.nightModeStart ?? 0) && hour < (config.nightModeEnd ?? 7)
}

module.exports = {
  httpRequest,
  randomDelay,
  withRetry,
  cleanNoteId,
  normalizeTimestamp,
  parseXhsTime,
  localDateKey,
  startOfLocalDay,
  getAuthorId,
  isNightTime,
}
