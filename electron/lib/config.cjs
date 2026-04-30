const path = require('path')
const fs = require('fs')
const { getUserDataPath } = require('./runtime-paths.cjs')

// ─── 路径（延迟求值，避免在 app ready 前调用）─────────────
let _configPath, _logPath, _dailyStatsPath

function getConfigPath() {
  if (!_configPath) _configPath = path.join(getUserDataPath(), 'config.json')
  return _configPath
}
function getLogPath() {
  if (!_logPath) _logPath = path.join(getUserDataPath(), 'run.log')
  return _logPath
}
function getDailyStatsPath() {
  if (!_dailyStatsPath) _dailyStatsPath = path.join(getUserDataPath(), 'daily_stats.json')
  return _dailyStatsPath
}

// ─── 默认配置 ─────────────────────────────────────────────
const DEFAULT_CONFIG = {
  configVersion: 3,
  keywords: [
    '求靠谱健身教练', '想减肥', '求推荐私教', '想找私人教练',
    '哪里有好的私教', '私教推荐', '找个教练带我练', '有没有靠谱的健身教练',
    '产后恢复教练推荐', '体态矫正哪里好', '想减肥不知道怎么开始',
    '健身小白求带', '想增肌求指导', '骨盆修复推荐',
    '想瘦腿求方法', '圆肩驼背怎么矫正',
  ],
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 0,
  mockMode: false,
  targetCity: '天津',
  maxDaysAgo: 1,
  intervalMinutes: 1440,
  adFilterWords: ['接广告', '商务合作', '课程售价', '原价', '限时优惠', '私信领取', '代理加盟', '学员招募', '训练营报名', '品牌方'],
  // 0 表示不在预筛阶段截断，尽可能保留所有通过基础过滤的结果。
  maxResultsPerKeyword: 0,
  searchEngine: 'skill',
  searchLimitPerKeyword: 120,
  skillSearchScrolls: 20,
  // 0 表示本轮候选全量进入详情抓取。
  maxDetailsPerRun: 0,
  searchTimeoutMs: 35000,
  detailTimeoutMs: 45000,
  searchDelayMinMs: 12000,
  searchDelayMaxMs: 22000,
  detailDelayMinMs: 3500,
  detailDelayMaxMs: 8000,
  searchRetries: 0,
  detailRetries: 1,
  minLeadScore: 60,
  // 默认不因标题意向分低而丢弃，交给详情和 AI/规则评估判断。
  titleScoreThreshold: -999,
}

const SUPPORTED_MAX_DAYS_AGO = [1, 7, 180]
const SUPPORTED_INTERVAL_MINUTES = [1440, 10080, 43200]

// ─── 配置读写 ─────────────────────────────────────────────
function loadConfig() {
  try {
    const p = getConfigPath()
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8')
      const parsed = JSON.parse(raw)
      return normalizeConfig({ ...DEFAULT_CONFIG, ...parsed }, parsed)
    }
  } catch (e) {
    console.error('配置读取失败:', e)
  }
  return normalizeConfig({ ...DEFAULT_CONFIG })
}

function saveConfig(config) {
  try {
    const dir = path.dirname(getConfigPath())
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(getConfigPath(), JSON.stringify(normalizeConfig(config), null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('配置写入失败:', e)
    return false
  }
}

function normalizeConfig(config, rawConfig = config) {
  const mergedKeywords = [
    ...(Array.isArray(config.keywords) ? config.keywords : []),
    ...(Array.isArray(config.keywordsTier1) ? config.keywordsTier1 : []),
    ...(Array.isArray(config.keywordsTier2) ? config.keywordsTier2 : []),
  ]
  const normalized = {
    ...DEFAULT_CONFIG,
    ...config,
    keywords: unique(mergedKeywords.length ? mergedKeywords : DEFAULT_CONFIG.keywords),
  }
  migrateSearchDefaults(normalized, rawConfig)
  normalizeRuntimeOptions(normalized)
  normalized.maxDaysAgo = normalizeMaxDaysAgo(normalized.maxDaysAgo)
  migrateCoverageDefaults(normalized, rawConfig)
  delete normalized.keywordsTier1
  delete normalized.keywordsTier2
  delete normalized.keywordsTier3
  delete normalized.nearbyCities
  delete normalized.commentIntentWords
  delete normalized.twoStageLLM
  delete normalized.triageBatchSize
  delete normalized.deepEvalBatchSize
  return normalized
}

function migrateSearchDefaults(normalized, rawConfig) {
  if ((rawConfig.configVersion || 1) >= 3) return
  if (Number(normalized.maxDaysAgo) === 7) normalized.maxDaysAgo = DEFAULT_CONFIG.maxDaysAgo
  if (Number(normalized.intervalMinutes) === 10080) normalized.intervalMinutes = DEFAULT_CONFIG.intervalMinutes
}

function normalizeRuntimeOptions(config) {
  config.searchEngine = config.searchEngine === 'mcp' ? 'mcp' : 'skill'
  config.intervalMinutes = normalizeIntervalMinutes(config.intervalMinutes)
  config.nightModeStart = clampInt(config.nightModeStart, 0, 23, DEFAULT_CONFIG.nightModeStart)
  config.nightModeEnd = clampInt(config.nightModeEnd, 0, 23, DEFAULT_CONFIG.nightModeEnd)
  config.searchLimitPerKeyword = clampInt(config.searchLimitPerKeyword, 20, 500, DEFAULT_CONFIG.searchLimitPerKeyword)
  config.skillSearchScrolls = clampInt(config.skillSearchScrolls, 3, 60, DEFAULT_CONFIG.skillSearchScrolls)
  config.maxResultsPerKeyword = clampInt(config.maxResultsPerKeyword, 0, 500, DEFAULT_CONFIG.maxResultsPerKeyword)
  config.maxDetailsPerRun = clampInt(config.maxDetailsPerRun, 0, 1000, DEFAULT_CONFIG.maxDetailsPerRun)
  config.titleScoreThreshold = clampInt(config.titleScoreThreshold, -999, 10, DEFAULT_CONFIG.titleScoreThreshold)
  config.adFilterWords = unique(Array.isArray(config.adFilterWords) ? config.adFilterWords : DEFAULT_CONFIG.adFilterWords)
}

function normalizeMaxDaysAgo(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= SUPPORTED_MAX_DAYS_AGO[0]) return SUPPORTED_MAX_DAYS_AGO[0]
  if (n <= SUPPORTED_MAX_DAYS_AGO[1]) return SUPPORTED_MAX_DAYS_AGO[1]
  return SUPPORTED_MAX_DAYS_AGO[2]
}

function normalizeIntervalMinutes(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= SUPPORTED_INTERVAL_MINUTES[0]) return SUPPORTED_INTERVAL_MINUTES[0]
  if (n <= SUPPORTED_INTERVAL_MINUTES[1]) return SUPPORTED_INTERVAL_MINUTES[1]
  return SUPPORTED_INTERVAL_MINUTES[2]
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function migrateCoverageDefaults(normalized, rawConfig) {
  // 旧版本默认值过于保守，而且部分字段当时没有在 UI 明示。
  // 如果用户保存的是旧默认值，自动升级为高覆盖策略。
  if ((rawConfig.configVersion || 1) < 2) {
    if (normalized.maxResultsPerKeyword === undefined || Number(normalized.maxResultsPerKeyword) <= 12) {
      normalized.maxResultsPerKeyword = DEFAULT_CONFIG.maxResultsPerKeyword
    }
    if (normalized.maxDetailsPerRun === undefined || Number(normalized.maxDetailsPerRun) <= 60) {
      normalized.maxDetailsPerRun = DEFAULT_CONFIG.maxDetailsPerRun
    }
    if (normalized.searchLimitPerKeyword === undefined || Number(normalized.searchLimitPerKeyword) <= 50) {
      normalized.searchLimitPerKeyword = DEFAULT_CONFIG.searchLimitPerKeyword
    }
    if (normalized.skillSearchScrolls === undefined || Number(normalized.skillSearchScrolls) <= 8) {
      normalized.skillSearchScrolls = DEFAULT_CONFIG.skillSearchScrolls
    }
    if (normalized.titleScoreThreshold === undefined || Number(normalized.titleScoreThreshold) >= -2) {
      normalized.titleScoreThreshold = DEFAULT_CONFIG.titleScoreThreshold
    }
    if (Number(normalized.nightModeStart) === 0 && Number(normalized.nightModeEnd) === 7) {
      normalized.nightModeEnd = DEFAULT_CONFIG.nightModeEnd
    }
  }
  normalized.configVersion = DEFAULT_CONFIG.configVersion
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))]
}

// ─── 每日统计持久化 ───────────────────────────────────────
function loadDailyStats() {
  try { return JSON.parse(fs.readFileSync(getDailyStatsPath(), 'utf-8')) } catch { return {} }
}

function saveDailyStats(data) {
  const dir = path.dirname(getDailyStatsPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getDailyStatsPath(), JSON.stringify(data, null, 2))
}

function incrementDailyStat(field, count = 1) {
  const data = loadDailyStats()
  const today = new Date().toISOString().slice(0, 10)
  if (!data[today]) data[today] = { searches: 0, leads: 0, highIntent: 0, failed: 0 }
  data[today][field] += count
  saveDailyStats(data)
}

module.exports = {
  getConfigPath,
  getLogPath,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  normalizeConfig,
  loadDailyStats,
  saveDailyStats,
  incrementDailyStat,
}
