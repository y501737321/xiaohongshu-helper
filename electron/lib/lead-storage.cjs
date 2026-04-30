const path = require('path')
const fs = require('fs')
const { loadConfig } = require('./config.cjs')
const { getUserDataPath } = require('./runtime-paths.cjs')

// ─── 路径（延迟求值，避免在 app ready 前调用）─────────────
let _seenIdsPath, _seenUserIdsPath, _watermarksPath

function getSeenIdsPath() {
  if (!_seenIdsPath) _seenIdsPath = path.join(getUserDataPath(), 'seen_ids.json')
  return _seenIdsPath
}
function getSeenUserIdsPath() {
  if (!_seenUserIdsPath) _seenUserIdsPath = path.join(getUserDataPath(), 'seen_user_ids.json')
  return _seenUserIdsPath
}
function getWatermarksPath() {
  if (!_watermarksPath) _watermarksPath = path.join(getUserDataPath(), 'watermarks.json')
  return _watermarksPath
}

// ─── 去重 ID 持久化 ──────────────────────────────────────
function loadSeenIds() {
  try {
    const p = getSeenIdsPath()
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return new Set(
        arr
          .slice(-10000)
          .map((id) => String(id || '').split('#')[0])
          .filter(Boolean)
      )
    }
  } catch (_) {}
  return new Set()
}

function saveSeenIds(seenNoteIds) {
  try {
    fs.writeFileSync(getSeenIdsPath(), JSON.stringify([...seenNoteIds]), 'utf-8')
  } catch (_) {}
}

function loadSeenUserIds() {
  try {
    const p = getSeenUserIdsPath()
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return new Set(arr.slice(-50000))
    }
  } catch (_) {}
  return new Set()
}

function saveSeenUserIds(seenUserIds) {
  try {
    fs.writeFileSync(getSeenUserIdsPath(), JSON.stringify([...seenUserIds]), 'utf-8')
  } catch (_) {}
}

// ─── 水位线管理 ───────────────────────────────────────────
function loadWatermarks() {
  try {
    const p = getWatermarksPath()
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
      for (const key of Object.keys(data)) {
        if (data[key].updatedAt < cutoff) delete data[key]
      }
      return data
    }
  } catch (_) {}
  return {}
}

function saveWatermarks(watermarks) {
  try {
    fs.writeFileSync(getWatermarksPath(), JSON.stringify(watermarks, null, 2), 'utf-8')
  } catch (_) {}
}

function resetWatermarks() {
  try {
    const p = getWatermarksPath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch (_) {}
}

// ─── 线索目录 ─────────────────────────────────────────────
function getLeadsDir() {
  const config = loadConfig()
  const dir = config.leadsDir || path.join(getUserDataPath(), 'leads')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ─── CSV 写入 ─────────────────────────────────────────────
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
      fs.writeFileSync(filePath, '\uFEFF账号ID,昵称,小红书主页,笔记ID,笔记链接,笔记标题,评分,综合分,需求摘要,判断原因,关键词,IP属地,发布时间,发现时间\n', 'utf-8')
    }

    const userId = note.user?.id || ''
    const noteId = note.id || note.note_id || ''
    const noteUrl = buildNoteUrl(note)
    const profileUrl = userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : ''

    const row = [
      csvEscape(userId),
      csvEscape(note.author || note.user?.nickname || '未知'),
      csvEscape(profileUrl),
      csvEscape(noteId),
      csvEscape(noteUrl),
      csvEscape(note.title || note.desc || ''),
      csvEscape(assessment.score),
      csvEscape(assessment.numericScore ?? ''),
      csvEscape(assessment.summary || ''),
      csvEscape(assessment.author_intent || ''),
      csvEscape(note._keyword || ''),
      csvEscape(detail?.ipLocation || ''),
      csvEscape(detail?.time ? new Date(detail.time).toLocaleString('zh-CN', { hour12: false }) : ''),
      csvEscape(new Date().toLocaleString('zh-CN')),
    ].join(',')

    fs.appendFileSync(filePath, row + '\n', 'utf-8')
    return true
  } catch (err) {
    return false
  }
}

function saveDailyLeadReport({
  date,
  targetCity,
  leads,
  searchedCount,
  candidateCount,
  detailAttemptCount = candidateCount,
  rejectedCount,
  runStartedAt,
  runFinishedAt,
  mode = 'real',
  auditRecords = [],
}) {
  const dir = getLeadsDir()
  const sorted = [...leads].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
  const sortedAudit = [...auditRecords].sort((a, b) => {
    const ta = b.detailPublishedAt || b.searchPublishedAt || 0
    const tb = a.detailPublishedAt || a.searchPublishedAt || 0
    return ta - tb
  })
  const reportPath = path.join(dir, `today_leads_${date}.md`)
  const jsonPath = path.join(dir, `today_leads_${date}.json`)
  const auditPath = path.join(dir, `today_reviewed_${date}.md`)
  const auditJsonPath = path.join(dir, `today_reviewed_${date}.json`)

  const lines = [
    `# ${date} 健身潜客抓取统计`,
    '',
    `- 目标城市: ${targetCity || '未设置'}`,
    `- 运行开始: ${new Date(runStartedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 运行结束: ${new Date(runFinishedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 搜索结果: ${searchedCount}`,
    `- 进入详情抓取: ${detailAttemptCount}`,
    `- 详情有效并进入评估: ${candidateCount}`,
    `- 高意向线索: ${sorted.length}`,
    `- 过滤/拒绝: ${rejectedCount}`,
    `- 本轮查看记录: ${sortedAudit.length}`,
    `- 查看记录文档: [${path.basename(auditPath)}](${path.basename(auditPath)})`,
    `- 数据模式: ${mode === 'real' ? '真实抓取' : '模拟自检'}`,
    '',
    '## 线索明细（按发布时间倒序）',
    '',
  ]

  if (sorted.length === 0) {
    lines.push('今天暂未发现 S/A 级健身潜客。')
  } else {
    lines.push('| 排名 | 发布时间 | 评分 | 综合分 | 昵称 | IP属地 | 关键词 | 笔记 | 需求摘要 |')
    lines.push('|---:|---|---|---:|---|---|---|---|---|')
    sorted.forEach((lead, index) => {
      const noteLink = lead.noteUrl ? `[${escapeMd(lead.title || '查看笔记')}](${lead.noteUrl})` : escapeMd(lead.title || '无可打开链接')
      lines.push([
        index + 1,
        escapeMd(lead.publishedAt ? new Date(lead.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'),
        escapeMd(lead.score || ''),
        lead.numericScore ?? '',
        escapeMd(lead.author || ''),
        escapeMd(lead.ipLocation || ''),
        escapeMd(lead.keyword || ''),
        noteLink,
        escapeMd(lead.summary || ''),
      ].join('|').replace(/^/, '|').replace(/$/, '|'))
    })
  }

  lines.push('', '## 本轮查看记录摘要', '')
  if (sortedAudit.length === 0) {
    lines.push('本轮没有可记录的搜索结果。')
  } else {
    lines.push('| 序号 | 状态 | 原因 | 评分 | 发布时间 | 昵称 | 关键词 | 笔记 |')
    lines.push('|---:|---|---|---|---|---|---|---|')
    sortedAudit.slice(0, 30).forEach((record, index) => {
      const noteLink = record.noteUrl ? `[${escapeMd(record.title || record.noteId || '查看笔记')}](${record.noteUrl})` : escapeMd(record.title || record.noteId || '无链接')
      lines.push([
        index + 1,
        escapeMd(record.status || ''),
        escapeMd(record.reason || ''),
        escapeMd(record.score ? `${record.score}/${record.numericScore ?? '-'}` : ''),
        escapeMd(formatTs(record.detailPublishedAt || record.searchPublishedAt)),
        escapeMd(record.author || ''),
        escapeMd(record.keyword || ''),
        noteLink,
      ].join('|').replace(/^/, '|').replace(/$/, '|'))
    })
    if (sortedAudit.length > 30) {
      lines.push('', `完整 ${sortedAudit.length} 条记录请查看 [${path.basename(auditPath)}](${path.basename(auditPath)})。`)
    }
  }

  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8')
  fs.writeFileSync(jsonPath, JSON.stringify({ date, targetCity, mode, searchedCount, detailAttemptCount, candidateCount, rejectedCount, leads: sorted, auditRecords: sortedAudit }, null, 2), 'utf-8')
  writeAuditReport({
    auditPath,
    auditJsonPath,
    date,
    targetCity,
    mode,
    runStartedAt,
    runFinishedAt,
    records: sortedAudit,
  })
  return { reportPath, jsonPath, auditPath, auditJsonPath }
}

function writeAuditReport({ auditPath, auditJsonPath, date, targetCity, mode, runStartedAt, runFinishedAt, records }) {
  const lines = [
    `# ${date} 小红书抓取查看记录`,
    '',
    `- 目标城市: ${targetCity || '未设置'}`,
    `- 运行开始: ${new Date(runStartedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 运行结束: ${new Date(runFinishedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 数据模式: ${mode === 'real' ? '真实抓取' : '模拟自检'}`,
    `- 记录条数: ${records.length}`,
    '',
    '## 全量记录',
    '',
  ]

  if (records.length === 0) {
    lines.push('本轮没有搜索结果。')
  } else {
    lines.push('| 序号 | 状态 | 原因 | 评分 | 发布时间 | IP属地 | 昵称 | 关键词 | 搜索词 | 互动 | 笔记 | 正文摘要 |')
    lines.push('|---:|---|---|---|---|---|---|---|---|---|---|---|')
    records.forEach((record, index) => {
      const noteLink = record.noteUrl ? `[${escapeMd(record.title || record.noteId || '查看笔记')}](${record.noteUrl})` : escapeMd(record.title || record.noteId || '无链接')
      const interactions = [
        record.likedCount ? `赞${record.likedCount}` : '',
        record.commentCount ? `评${record.commentCount}` : '',
        record.collectedCount ? `藏${record.collectedCount}` : '',
      ].filter(Boolean).join(' ')
      lines.push([
        index + 1,
        escapeMd(record.status || ''),
        escapeMd(record.reason || ''),
        escapeMd(record.score ? `${record.score}/${record.numericScore ?? '-'}` : ''),
        escapeMd(formatTs(record.detailPublishedAt || record.searchPublishedAt)),
        escapeMd(record.ipLocation || ''),
        escapeMd(record.author || ''),
        escapeMd(record.keyword || ''),
        escapeMd(record.searchQuery || ''),
        escapeMd(interactions || '-'),
        noteLink,
        escapeMd(record.contentPreview || record.summary || ''),
      ].join('|').replace(/^/, '|').replace(/$/, '|'))
    })
  }

  fs.writeFileSync(auditPath, lines.join('\n') + '\n', 'utf-8')
  fs.writeFileSync(auditJsonPath, JSON.stringify({ date, targetCity, mode, records }, null, 2), 'utf-8')
}

function buildNoteUrl(note) {
  const noteId = String(note?.id || note?.note_id || '').split('#')[0]
  if (!noteId || noteId.startsWith('mock_') || note?._isMock) return ''
  const token = note.xsec_token || note.xsecToken || ''
  const suffix = token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_search` : ''
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}${suffix}`
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function formatTs(ts) {
  return ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '未知'
}

module.exports = {
  loadSeenIds,
  saveSeenIds,
  loadSeenUserIds,
  saveSeenUserIds,
  loadWatermarks,
  saveWatermarks,
  resetWatermarks,
  getLeadsDir,
  csvEscape,
  saveLeadToLocal,
  saveDailyLeadReport,
  buildNoteUrl,
}
