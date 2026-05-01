export interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'warn' | 'error'
}

export interface Stats {
  runCount: number
  totalLeads: number
  highIntentLeads: number
}

export interface DailyStatEntry {
  searches: number
  leads: number
  highIntent: number
  failed: number
}

export interface AppConfig {
  configVersion?: number
  keywords: string[]
  intervalMinutes: number
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  leadsDir: string
  nightModeStart: number
  nightModeEnd: number
  mockMode: boolean
  targetCity: string
  maxDaysAgo: number
  adFilterWords: string[]
  // 过滤与评估参数
  searchEngine?: 'mcp'
  searchLimitPerKeyword?: number
  titleScoreThreshold?: number
  maxResultsPerKeyword?: number
  maxDetailsPerRun?: number
  searchDelayMinMs?: number
  searchDelayMaxMs?: number
  detailDelayMinMs?: number
  detailDelayMaxMs?: number
  minLeadScore?: number
}

export interface KeywordStat {
  searches: number
  results_new: number
  leads_s: number
  leads_a: number
  leads_b: number
  leads_c: number
  last_lead_at: number
}

export interface PipelineStats {
  searched: number
  passed_prefilter: number
  passed_triage: number
  deep_evaluated: number
  leads_found: number
}

export interface EnvCheckResult {
  name: string
  ok: boolean
  version?: string
}

export interface XhsLoginState {
  ok: boolean
  loggedIn: boolean
  username?: string
  img?: string
  timeout?: number
  expiresAt?: number
  error?: string
}

export interface ElectronAPI {
  startBot:   () => Promise<{ ok: boolean }>
  stopBot:    () => Promise<{ ok: boolean }>
  getStatus:  () => Promise<{ isRunning: boolean }>

  getConfig:  () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<{ ok: boolean }>

  getStats:      () => Promise<Stats>
  resetDedupe:   () => Promise<{ ok: boolean }>
  getDailyStats: () => Promise<Record<string, DailyStatEntry>>

  checkEnv:          () => Promise<{ ok: boolean }>
  checkXhsLogin:     () => Promise<{ ok: boolean; loggedIn: boolean }>
  getXhsLoginState:  () => Promise<XhsLoginState>
  getXhsQrCode:      () => Promise<XhsLoginState>
  xhsLogin:          () => Promise<{ ok: boolean }>
  restartMcpService: () => Promise<{ ok: boolean }>
  selectLeadsDir:    () => Promise<{ path: string }>
  openLogFile:       () => Promise<{ ok: boolean }>
  openLeadsFolder:   () => Promise<{ ok: boolean }>
  resetWatermarks:   () => Promise<{ ok: boolean }>
  getKeywordStats:   () => Promise<Record<string, KeywordStat>>
  resetKeywordStats: () => Promise<{ ok: boolean }>

  onLog:       (callback: (entry: LogEntry) => void) => void
  onStats:     (callback: (stats: Stats) => void) => void
  onBotStatus: (callback: (isRunning: boolean) => void) => void
  onEnvCheck:  (callback: (results: EnvCheckResult[]) => void) => void

  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
