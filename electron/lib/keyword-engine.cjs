const path = require('path')
const fs = require('fs')
const { getUserDataPath } = require('./runtime-paths.cjs')

// 延迟求值，避免在 app ready 前调用
let _keywordStatsPath
function getKeywordStatsPath() {
  if (!_keywordStatsPath) _keywordStatsPath = path.join(getUserDataPath(), 'keyword_stats.json')
  return _keywordStatsPath
}

// ─── 默认关键词 ──────────────────────────────────────────
const DEFAULT_KEYWORDS = [
  '求推荐私教', '想找私人教练', '求靠谱健身教练', '哪里有好的私教',
  '私教推荐', '找个教练带我练', '有没有靠谱的健身教练',
  '产后恢复教练推荐', '体态矫正哪里好', '想减肥不知道怎么开始',
  '健身小白求带', '想增肌求指导', '骨盆修复推荐', '想瘦腿求方法',
  '圆肩驼背怎么矫正', '膝盖疼还能健身吗', '备孕健身',
]

// ─── 关键词统计持久化 ─────────────────────────────────────
function loadKeywordStats() {
  try {
    if (fs.existsSync(getKeywordStatsPath())) {
      return JSON.parse(fs.readFileSync(getKeywordStatsPath(), 'utf-8'))
    }
  } catch (_) {}
  return {}
}

function saveKeywordStats(stats) {
  try {
    fs.writeFileSync(getKeywordStatsPath(), JSON.stringify(stats, null, 2), 'utf-8')
  } catch (_) {}
}

function resetKeywordStats() {
  try {
    if (fs.existsSync(getKeywordStatsPath())) fs.unlinkSync(getKeywordStatsPath())
  } catch (_) {}
}

// ─── 更新关键词统计 ──────────────────────────────────────
function updateKeywordStat(keyword, scoreMap) {
  const stats = loadKeywordStats()
  if (!stats[keyword]) {
    stats[keyword] = { searches: 0, results_new: 0, leads_s: 0, leads_a: 0, leads_b: 0, leads_c: 0, last_lead_at: 0 }
  }
  stats[keyword].searches++

  for (const [noteId, score] of Object.entries(scoreMap)) {
    const s = (score || '').toUpperCase()
    if (s === 'S') {
      stats[keyword].leads_s++
      stats[keyword].last_lead_at = Date.now()
    } else if (s === 'A') {
      stats[keyword].leads_a++
      stats[keyword].last_lead_at = Date.now()
    } else if (s === 'B') {
      stats[keyword].leads_b++
    } else if (s === 'C') {
      stats[keyword].leads_c++
    }
  }

  saveKeywordStats(stats)
}

// ─── 批量记录搜索结果数 ──────────────────────────────────
function recordKeywordSearch(keyword, newCount) {
  const stats = loadKeywordStats()
  if (!stats[keyword]) {
    stats[keyword] = { searches: 0, results_new: 0, leads_s: 0, leads_a: 0, leads_b: 0, leads_c: 0, last_lead_at: 0 }
  }
  stats[keyword].searches++
  stats[keyword].results_new += newCount
  saveKeywordStats(stats)
}

// ─── 计算关键词产出率 ─────────────────────────────────────
function getYieldRate(stat) {
  if (!stat || stat.searches === 0) return 0.5 // 未搜索过的给默认中等优先级
  return (stat.leads_s * 3 + stat.leads_a) / stat.searches
}

// ─── 选择本轮关键词 ──────────────────────────────────────
function selectKeywordsForCycle(config) {
  const keywords = Array.isArray(config.keywords) ? config.keywords : []
  return unique(keywords.length ? keywords : DEFAULT_KEYWORDS)
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]
}

module.exports = {
  DEFAULT_KEYWORDS,
  getKeywordStatsPath,
  loadKeywordStats,
  saveKeywordStats,
  resetKeywordStats,
  updateKeywordStat,
  recordKeywordSearch,
  getYieldRate,
  selectKeywordsForCycle,
}
