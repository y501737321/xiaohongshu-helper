const { mcpPost } = require('./mcp-client.cjs')
const { incrementDailyStat } = require('./config.cjs')
const {
  cleanNoteId,
  normalizeTimestamp,
  getAuthorId,
  randomDelay,
  withRetry,
  isNightTime,
  localDateKey,
} = require('./utils.cjs')
const {
  saveSeenIds,
  saveSeenUserIds,
  loadWatermarks,
  saveWatermarks,
  saveDailyLeadReport,
  buildNoteUrl,
} = require('./lead-storage.cjs')
const { batchEvaluateWithLLM, syncLead } = require('./llm-evaluator.cjs')
const { scoreTitleIntent, screenContentBody, computeGeoScore } = require('./filter-pipeline.cjs')
const { selectKeywordsForCycle, recordKeywordSearch, loadKeywordStats, saveKeywordStats } = require('./keyword-engine.cjs')

function makeTodayTs(hour, minute) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

function getPublishTimeOption(maxDaysAgo) {
  const days = Number(maxDaysAgo)
  if (!Number.isFinite(days) || days <= 1) return { days: 1, filter: '一天内', label: '一天内' }
  if (days <= 7) return { days: 7, filter: '一周内', label: '一周内' }
  return { days: 180, filter: '半年内', label: '半年内' }
}

function buildSearchQuery(keyword, targetCity) {
  const cleanKeyword = String(keyword || '').trim()
  const cleanCity = String(targetCity || '').trim()
  if (!cleanCity) return cleanKeyword
  if (!cleanKeyword) return cleanCity
  return `${cleanCity} ${cleanKeyword}`
}

// ─── 模拟搜索：仅供显式开发自检，不进入真实交付链路 ───────
async function mockSearch(keyword) {
  await new Promise((r) => setTimeout(r, 180))
  const safe = keyword.replace(/\s+/g, '_')
  return [
    {
      id: `mock_${safe}_001`,
      note_id: `mock_${safe}_001`,
      xsec_token: `token_${safe}_001`,
      title: `${keyword}，天津南开附近有没有靠谱私教`,
      desc: '健身小白，预算想先了解，最好今天能约体验。',
      author: '南开想减脂',
      user: { id: `uid_${safe}_001`, userId: `uid_${safe}_001`, nickname: '南开想减脂' },
      _noteTime: makeTodayTs(10, 42),
      _isMock: true,
      _mockDetail: {
        content: '坐标天津南开，最近想减脂但完全不知道怎么练，求推荐靠谱私教，今晚或明天都可以聊。',
        ipLocation: '天津',
        time: makeTodayTs(10, 42),
      },
    },
    {
      id: `mock_${safe}_002`,
      note_id: `mock_${safe}_002`,
      xsec_token: `token_${safe}_002`,
      title: `产后恢复想找教练，${keyword}`,
      desc: '住河西，想找懂产后恢复和体态矫正的教练。',
      author: '河西新手妈妈',
      user: { id: `uid_${safe}_002`, userId: `uid_${safe}_002`, nickname: '河西新手妈妈' },
      _noteTime: makeTodayTs(8, 15),
      _isMock: true,
      _mockDetail: {
        content: '产后一年，核心弱，想找天津河西附近懂产后恢复的私教，预算可以沟通，求推荐。',
        ipLocation: '天津',
        time: makeTodayTs(8, 15),
      },
    },
    {
      id: `mock_${safe}_003`,
      note_id: `mock_${safe}_003`,
      xsec_token: `token_${safe}_003`,
      title: `${keyword}课程限时优惠`,
      desc: '训练营报名，私信领取课程表。',
      author: '健身课程号',
      user: { id: `uid_${safe}_003`, userId: `uid_${safe}_003`, nickname: '健身课程号' },
      _noteTime: makeTodayTs(9, 5),
      _isMock: true,
      _mockDetail: {
        content: '课程限时优惠，扫码报名，招学员，私信领取。',
        ipLocation: '天津',
        time: makeTodayTs(9, 5),
      },
    },
  ]
}

// ─── 小红书搜索适配器 ─────────────────────────────────────
async function searchXiaohongshu(keyword, sendLog, strategyFilters = {}) {
  const config = require('./config.cjs').loadConfig()
  if (config.mockMode) {
    if (process.env.XHS_ALLOW_MOCK_FIXTURES === '1') return mockSearch(keyword)
    sendLog('⚠️ 模拟模式不会生成真实线索；请关闭模拟模式后抓取真实小红书数据', 'warn')
    return []
  }

  try {
    const searchTimeoutMs = Number(config.searchTimeoutMs || 35000)
    const searchRetries = Number(config.searchRetries ?? 0)
    const res = await withRetry(
      () => mcpPost('/api/v1/feeds/search', { keyword, filters: strategyFilters }, searchTimeoutMs),
      { retries: searchRetries, delayMs: 2500, label: `搜索"${keyword}"`, sendLog }
    )

    if (res.status !== 200) {
      throw new Error(`MCP 返回 ${res.status}: ${JSON.stringify(res.body).slice(0, 180)}`)
    }

    return unwrapSearchItems(res.body).map((item) => normalizeSearchItem({ ...item, _source: 'mcp' }, keyword)).filter(Boolean)
  } catch (err) {
    sendLog(`❌ 搜索"${keyword}"失败: ${err.message}`, 'error')
    return []
  }
}

function unwrapSearchItems(body) {
  const data = body?.data ?? body
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.feeds)) return data.feeds
  if (Array.isArray(data?.search?.feeds?.value)) return data.search.feeds.value
  if (Array.isArray(data?.search?.feeds?._value)) return data.search.feeds._value
  if (Array.isArray(data?.data?.items)) return data.data.items
  if (Array.isArray(data?.data?.feeds)) return data.data.feeds
  return []
}

function normalizeSearchItem(raw, keyword) {
  if (!raw || (raw.modelType && raw.modelType !== 'note')) return null
  const card = raw.noteCard || raw.note_card || {}
  const rawUser = card.user || raw.user || {}
  const user = rawUser && typeof rawUser === 'object' ? rawUser : {}
  const noteId = cleanNoteId(raw.id || raw.note_id || raw.feed_id || card.noteId)
  const xsecToken = raw.xsecToken || raw.xsec_token || card.xsecToken || ''
  const title = card.displayTitle || raw.title || raw.displayTitle || raw.desc || ''
  const author = user.nickname || user.nickName || raw.author || raw.nickname || (typeof raw.user === 'string' ? raw.user : '') || '未知'
  const time = normalizeTimestamp(card.lastUpdateTime || card.time || raw.lastUpdateTime || raw.time || raw.createTime)

  if (!noteId) return null

  return {
    ...raw,
    id: noteId,
    note_id: noteId,
    feed_id: noteId,
    xsec_token: xsecToken,
    title,
    desc: raw.desc || card.desc || title,
    author,
    user: {
      ...user,
      id: user.id || user.userId || raw.user_id || '',
      userId: user.userId || user.id || raw.user_id || '',
      nickname: user.nickname || user.nickName || author,
      nickName: user.nickName || user.nickname || author,
    },
    _keyword: keyword,
    _noteTime: time,
    _source: raw._source || 'mcp',
  }
}

// ─── 获取笔记详情 ─────────────────────────────────────────
async function getNoteDetail(noteId, xsecToken, sendLog, note = null) {
  if (note?._mockDetail) return note._mockDetail

  const config = require('./config.cjs').loadConfig()
  try {
    const detailTimeoutMs = Number(config.detailTimeoutMs || 45000)
    const detailRetries = Number(config.detailRetries ?? 1)
    const feedId = cleanNoteId(noteId)
    if (!feedId || !xsecToken) throw new Error('缺少 feed_id 或 xsec_token')

    const res = await withRetry(
      () => mcpPost('/api/v1/feeds/detail', {
        feed_id: feedId,
        xsec_token: xsecToken,
        load_all_comments: false,
        comment_config: { max_comment_items: 0, scroll_speed: 'fast' },
      }, detailTimeoutMs),
      { retries: detailRetries, delayMs: 2500, label: `详情(${feedId})`, sendLog }
    )

    if (res.status !== 200) {
      throw new Error(`MCP 返回 ${res.status}: ${JSON.stringify(res.body).slice(0, 180)}`)
    }

    const data = res.body?.data
    const noteData = data?.data?.note || data?.note || data?.data || {}
    const content = noteData.desc || noteData.content || note?.desc || ''

    return {
      content,
      ipLocation: noteData.ipLocation || noteData.ip_location || '',
      time: normalizeTimestamp(noteData.time || noteData.lastUpdateTime || note?._noteTime || 0),
    }
  } catch (err) {
    sendLog(`⚠️  详情获取失败 (${noteId}): ${err.message}`, 'warn')
    return null
  }
}

function sendDesktopAlert(note, assessment) {
  try {
    const { Notification } = require('electron')
    if (Notification?.isSupported?.()) {
      new Notification({
        title: '发现高意向健身潜客',
        body: `${note.author || note.user?.nickname || '未知'}: ${assessment.summary}`,
      }).show()
    }
  } catch (_) {}
}

function ensureAuditRecord(auditRecords, auditByKey, note, extra = {}) {
  const noteId = cleanNoteId(note?.id || note?.note_id || note?.feed_id)
  const key = noteId || extra.auditKey || `${extra.searchQuery || note?._keyword || ''}:${extra.rank || 0}:${note?.title || note?.desc || ''}`
  let record = auditByKey.get(key)
  if (!record) {
    record = {
      auditKey: key,
      noteId,
      noteUrl: buildNoteUrl(note),
      source: note?._source || 'unknown',
      keyword: note?._keyword || extra.keyword || '',
      searchQuery: extra.searchQuery || '',
      rank: extra.rank || 0,
      title: note?.title || note?.desc || '',
      author: note?.author || note?.user?.nickname || '未知',
      userId: note?.user?.id || note?.user?.userId || '',
      likedCount: getInteractCount(note, 'liked'),
      commentCount: getInteractCount(note, 'comment'),
      collectedCount: getInteractCount(note, 'collected'),
      searchPublishedAt: note?._noteTime || 0,
      detailPublishedAt: 0,
      ipLocation: '',
      status: '搜索返回',
      reason: '待预筛',
      score: '',
      numericScore: '',
      summary: '',
      contentPreview: '',
    }
    auditByKey.set(key, record)
    auditRecords.push(record)
  }
  updateAuditRecord(record, extra)
  if (note) note._auditKey = key
  return record
}

function updateAuditRecord(record, patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null && key !== 'auditKey') record[key] = value
  }
  return record
}

function getAuditRecord(auditByKey, note) {
  const key = note?._auditKey || cleanNoteId(note?.id || note?.note_id || note?.feed_id)
  return key ? auditByKey.get(key) : null
}

function getInteractCount(note, type) {
  const info = note?.noteCard?.interactInfo || note?.note_card?.interactInfo || {}
  if (type === 'liked') return note?.liked_count || note?.likedCount || info.likedCount || ''
  if (type === 'comment') return note?.comment_count || note?.commentCount || info.commentCount || ''
  if (type === 'collected') return note?.collected_count || note?.collectedCount || info.collectedCount || ''
  return ''
}

function previewText(text, max = 90) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}

// ─── 核心工作流 ───────────────────────────────────────────
async function runBotCycle(config, { isRunning, stats, sendStats, sendLog, seenNoteIds, seenUserIds }) {
  if (!isRunning()) return { ok: false, reason: 'stopped' }
  if (isNightTime(config)) {
    sendLog(`🌙 夜间暂停模式 (${config.nightModeStart}:00 - ${config.nightModeEnd}:00)，等待白天...`, 'warn')
    return { ok: false, reason: 'night' }
  }

  const runStartedAt = Date.now()
  const today = localDateKey(runStartedAt)
  const publishTime = getPublishTimeOption(config.maxDaysAgo)
  const cutoffTime = runStartedAt - publishTime.days * 24 * 60 * 60 * 1000

  stats.runCount++
  sendStats()

  const keywords = selectKeywordsForCycle(config)
  const searchJobs = buildSearchJobs(config, keywords)
  const maxResultsPerKeyword = toUnlimitedLimit(config.maxResultsPerKeyword)
  const maxDetailsPerRun = toUnlimitedLimit(config.maxDetailsPerRun)

  sendLog(`🚀 开始第 ${stats.runCount} 轮抓取 | 搜索范围: ${publishTime.label} | 今日窗口: ${today} | 关键词 ${searchJobs.length} 个 | 策略: 城市前缀+本地过滤`, 'info')

  const watermarks = loadWatermarks()
  const candidates = []
  const auditRecords = []
  const auditByKey = new Map()
  const runSeenUserKeys = new Set()
  const rejectStats = { duplicate: 0, ad: 0, old: 0, lowTitle: 0, noToken: 0 }
  let searchedCount = 0

  for (let i = 0; i < searchJobs.length; i++) {
    if (!isRunning()) break
    const job = searchJobs[i]
    const keyword = job.keyword
    const searchKeyword = job.query
    sendLog(`🔍 [${i + 1}/${searchJobs.length}] 搜索: "${searchKeyword}"`, 'info')

    const notes = await searchXiaohongshu(searchKeyword, sendLog, job.filters)
    searchedCount += notes.length
    incrementDailyStat('searches', notes.length)
    notes.forEach((note, index) => {
      ensureAuditRecord(auditRecords, auditByKey, note, {
        keyword,
        searchQuery: searchKeyword,
        rank: index + 1,
        status: '搜索返回',
        reason: '待预筛',
      })
    })

    const filtered = prefilterSearchResults(notes, {
      keyword,
      searchQuery: searchKeyword,
      config,
      cutoffTime,
      seenNoteIds,
      seenUserIds,
      runSeenUserKeys,
      watermarks,
      rejectStats,
      maxResults: maxResultsPerKeyword,
      auditRecords,
      auditByKey,
    })

    filtered.forEach((note) => candidates.push(note))
    recordKeywordSearch(keyword, filtered.length)
    sendLog(`📋 "${searchKeyword}" 内置服务返回 ${notes.length} 条，预筛候选 ${filtered.length} 条`, filtered.length > 0 ? 'success' : 'info')

    if (i < searchJobs.length - 1 && !config.mockMode) {
      await randomDelay(Number(config.searchDelayMinMs || 12000), Number(config.searchDelayMaxMs || 22000))
    }
  }

  candidates.sort((a, b) => (b._noteTime || 0) - (a._noteTime || 0))
  const detailLimit = Number.isFinite(maxDetailsPerRun) ? maxDetailsPerRun : candidates.length
  const detailTargets = candidates.slice(0, detailLimit)
  candidates.slice(detailLimit).forEach((note) => {
    const auditRecord = getAuditRecord(auditByKey, note)
    if (auditRecord) updateAuditRecord(auditRecord, { status: '未进入详情', reason: `达到本轮详情抓取上限 ${detailLimit}` })
  })
  sendLog(`📦 本轮预筛候选 ${candidates.length} 条，准备获取详情 ${detailTargets.length} 条`, 'info')

  const notesWithDetails = []
  for (let i = 0; i < detailTargets.length; i++) {
    if (!isRunning()) break
    const note = detailTargets[i]
    if (!config.mockMode) await randomDelay(Number(config.detailDelayMinMs || 3500), Number(config.detailDelayMaxMs || 8000))
    sendLog(`[${i + 1}/${detailTargets.length}] 详情: ${note.author} - "${String(note.title || note.desc || '').slice(0, 18)}"`, 'info')

    const detail = await getNoteDetail(note.id, note.xsec_token, sendLog, note)
    const auditRecord = getAuditRecord(auditByKey, note)
    if (!detail) {
      rejectStats.noToken++
      incrementDailyStat('failed')
      if (auditRecord) updateAuditRecord(auditRecord, { status: '详情失败', reason: '详情页未返回可用内容' })
      if (note.id) seenNoteIds.delete(note.id)
      continue
    }

    if (auditRecord) {
      updateAuditRecord(auditRecord, {
        status: '详情已获取',
        reason: '待正文过滤',
        ipLocation: detail.ipLocation || '',
        detailPublishedAt: detail.time || note._noteTime || 0,
        contentPreview: previewText(detail.content),
      })
    }

    if (detail.time && detail.time < cutoffTime) {
      rejectStats.old++
      if (auditRecord) {
        updateAuditRecord(auditRecord, {
          status: '时间过滤',
          reason: `发布时间早于收集窗口 (${new Date(cutoffTime).toLocaleString('zh-CN', { hour12: false })})`,
        })
      }
      continue
    }

    const bodyScreen = screenContentBody(detail.content)
    if (!bodyScreen.pass) {
      rejectStats.ad++
      if (auditRecord) {
        updateAuditRecord(auditRecord, {
          status: '正文过滤',
          reason: `商业信号 ${bodyScreen.commercialHits}，求助信号 ${bodyScreen.seekingHits}`,
        })
      }
      continue
    }

    const geoScore = computeGeoScore(detail.ipLocation, config.targetCity)
    if (auditRecord) updateAuditRecord(auditRecord, { status: '进入AI评估', reason: `地理相关性 ${geoScore}` })
    notesWithDetails.push({ note, detail, _geoScore: geoScore })
  }

  notesWithDetails.sort((a, b) => {
    const geoDelta = (b._geoScore || 0) - (a._geoScore || 0)
    if (Math.abs(geoDelta) > 0.2) return geoDelta
    return (b.detail?.time || b.note?._noteTime || 0) - (a.detail?.time || a.note?._noteTime || 0)
  })

  const assessments = await batchEvaluateWithLLM(notesWithDetails, sendLog)
  const savedLeads = []
  let cycleLeads = 0
  const leadThreshold = Number(config.minLeadScore || 60)

  for (const item of notesWithDetails) {
    const { note, detail } = item
    const assessment = assessments.find((a) => String(a.id) === String(note.id)) || { score: 'B', numericScore: 0, summary: '未返回评估' }
    const numericScore = Number.isFinite(Number(assessment.numericScore)) ? Number(assessment.numericScore) : 0
    const isLead = (assessment.score === 'S' || assessment.score === 'A') && numericScore >= leadThreshold
    sendLog(`🤖 [${assessment.score}/${assessment.numericScore ?? '-'}] ${note.author}: ${assessment.summary}`, isLead ? 'success' : 'info')
    const auditRecord = getAuditRecord(auditByKey, note)
    if (auditRecord) {
      updateAuditRecord(auditRecord, {
        status: isLead ? '高意向线索' : '非高意向',
        reason: isLead ? '达到线索阈值' : `未达到线索阈值 ${leadThreshold}`,
        score: assessment.score || '',
        numericScore: assessment.numericScore ?? '',
        summary: assessment.summary || '',
      })
    }

    updateKeywordScore(note._keyword, assessment.score)
    if (!isLead) continue

    const synced = await syncLead(note, detail, assessment, sendLog)
    if (!synced) continue

    const authorId = getAuthorId(note)
    if (authorId) seenUserIds.add(authorId)
    stats.totalLeads++
    stats.highIntentLeads++
    cycleLeads++
    incrementDailyStat('leads')
    incrementDailyStat('highIntent')

    savedLeads.push({
      noteId: note.id,
      noteUrl: buildNoteUrl(note),
      author: note.author || note.user?.nickname || '未知',
      userId: note.user?.id || note.user?.userId || '',
      title: note.title || note.desc || '',
      keyword: note._keyword || '',
      score: assessment.score,
      numericScore: assessment.numericScore,
      summary: assessment.summary || '',
      reason: assessment.author_intent || '',
      ipLocation: detail.ipLocation || '',
      publishedAt: detail.time || note._noteTime || 0,
    })

    if (assessment.score === 'S') sendDesktopAlert(note, assessment)
  }

  saveWatermarks(watermarks)
  saveSeenIds(seenNoteIds)
  saveSeenUserIds(seenUserIds)
  sendStats()

  const report = saveDailyLeadReport({
    date: today,
    targetCity: config.targetCity,
    leads: savedLeads,
    searchedCount,
    candidateCount: notesWithDetails.length,
    detailAttemptCount: detailTargets.length,
    rejectedCount: Object.values(rejectStats).reduce((sum, n) => sum + n, 0),
    runStartedAt,
    runFinishedAt: Date.now(),
    mode: config.mockMode ? 'mock' : 'real',
    auditRecords,
  })

  sendLog(`📄 今日统计文档已生成: ${report.reportPath}`, 'success')
  sendLog(`🧾 本轮查看记录已生成: ${report.auditPath}`, 'success')
  sendLog(`✨ 第 ${stats.runCount} 轮完成 | 本轮线索 ${cycleLeads} 条 | 过滤 ${JSON.stringify(rejectStats)}`, 'success')

  return {
    ok: true,
    searchedCount,
    candidateCount: notesWithDetails.length,
    leadCount: savedLeads.length,
    reportPath: report.reportPath,
    jsonPath: report.jsonPath,
    auditPath: report.auditPath,
    auditJsonPath: report.auditJsonPath,
    leads: savedLeads,
  }
}

function buildSearchJobs(config, keywords) {
  const publishTime = getPublishTimeOption(config.maxDaysAgo)
  const jobs = unique(keywords).map((keyword) => {
    const query = buildSearchQuery(keyword, config.targetCity)
    return {
      keyword,
      query,
      filters: config.mockMode ? {} : { publish_time: publishTime.filter },
      label: '关键词搜索',
      _key: query,
    }
  })

  return jobs
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]
}

function toUnlimitedLimit(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return Infinity
  return n
}

function prefilterSearchResults(notes, { keyword, searchQuery, config, cutoffTime, seenNoteIds, seenUserIds, runSeenUserKeys, watermarks, rejectStats, maxResults, auditRecords, auditByKey }) {
  const out = []
  const adWords = config.adFilterWords || []
  const threshold = config.titleScoreThreshold ?? -2
  const wm = watermarks[keyword]
  let newest = wm?.lastNoteTime || 0
  let newestId = wm?.lastNoteId || ''

  for (const note of notes) {
    note._keyword = keyword
    const auditRecord = auditRecords && auditByKey
      ? ensureAuditRecord(auditRecords, auditByKey, note, { keyword, searchQuery })
      : null
    const noteId = cleanNoteId(note.id || note.note_id)
    const authorId = getAuthorId(note)
    const authorName = String(note.author || note.user?.nickname || '').trim()
    if (!noteId || !note.xsec_token) {
      rejectStats.noToken++
      if (auditRecord) updateAuditRecord(auditRecord, { status: '预筛拒绝', reason: '缺少笔记ID或xsec_token，无法打开详情' })
      continue
    }

    if (note._noteTime > newest) {
      newest = note._noteTime
      newestId = noteId
    }

    if (
      seenNoteIds.has(noteId) ||
      (authorId && seenUserIds.has(authorId)) ||
      (authorId && runSeenUserKeys.has(`id:${authorId}`)) ||
      (authorName && runSeenUserKeys.has(`name:${authorName}`))
    ) {
      rejectStats.duplicate++
      if (auditRecord) updateAuditRecord(auditRecord, { status: '预筛拒绝', reason: '已处理过该笔记或作者' })
      continue
    }

    if (note._noteTime && note._noteTime < cutoffTime) {
      rejectStats.old++
      if (auditRecord) updateAuditRecord(auditRecord, { status: '预筛拒绝', reason: '搜索页发布时间早于收集窗口' })
      continue
    }

    const titleText = `${note.title || ''} ${note.desc || ''}`
    const matchedAdWord = adWords.find((w) => w && titleText.toLowerCase().includes(String(w).toLowerCase()))
    if (matchedAdWord) {
      rejectStats.ad++
      if (auditRecord) updateAuditRecord(auditRecord, { status: '预筛拒绝', reason: `标题命中广告词: ${matchedAdWord}` })
      continue
    }

    const titleScore = scoreTitleIntent(titleText)
    if (titleScore < threshold) {
      rejectStats.lowTitle++
      if (auditRecord) updateAuditRecord(auditRecord, { status: '预筛拒绝', reason: `标题意向分 ${titleScore} 低于阈值 ${threshold}` })
      continue
    }

    if (Number.isFinite(maxResults) && out.length >= maxResults) {
      if (auditRecord) updateAuditRecord(auditRecord, { status: '未进入详情', reason: `达到每关键词预筛上限 ${maxResults}` })
      continue
    }

    seenNoteIds.add(noteId)
    if (authorId) runSeenUserKeys.add(`id:${authorId}`)
    if (authorName) runSeenUserKeys.add(`name:${authorName}`)
    if (auditRecord) updateAuditRecord(auditRecord, { status: '待详情抓取', reason: `标题意向分 ${titleScore}` })
    out.push(note)
  }

  if (newest > 0) {
    watermarks[keyword] = { lastNoteTime: newest, lastNoteId: newestId, updatedAt: Date.now() }
  }

  return out
}

function updateKeywordScore(keyword, score) {
  if (!keyword) return
  const stats = loadKeywordStats()
  if (!stats[keyword]) stats[keyword] = { searches: 0, results_new: 0, leads_s: 0, leads_a: 0, leads_b: 0, leads_c: 0, last_lead_at: 0 }
  const s = String(score || '').toUpperCase()
  if (s === 'S') { stats[keyword].leads_s++; stats[keyword].last_lead_at = Date.now() }
  else if (s === 'A') { stats[keyword].leads_a++; stats[keyword].last_lead_at = Date.now() }
  else if (s === 'B') stats[keyword].leads_b++
  else if (s === 'C') stats[keyword].leads_c++
  saveKeywordStats(stats)
}

module.exports = {
  searchXiaohongshu,
  getNoteDetail,
  sendDesktopAlert,
  runBotCycle,
}
