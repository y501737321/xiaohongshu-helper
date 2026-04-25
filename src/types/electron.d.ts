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

export interface AppConfig {
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
  commentIntentWords: string[]
}

export interface EnvCheckResult {
  name: string
  ok: boolean
  version?: string
}

export interface ElectronAPI {
  startBot:   () => Promise<{ ok: boolean }>
  stopBot:    () => Promise<{ ok: boolean }>
  getStatus:  () => Promise<{ isRunning: boolean }>

  getConfig:  () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<{ ok: boolean }>

  getStats:   () => Promise<Stats>
  resetStats: () => Promise<{ ok: boolean }>

  checkEnv:          () => Promise<{ ok: boolean }>
  checkXhsLogin:     () => Promise<{ ok: boolean }>
  xhsLogin:          () => Promise<{ ok: boolean }>
  installXhsSkills:  () => Promise<{ ok: boolean }>
  selectLeadsDir:    () => Promise<{ path: string }>
  openLogFile:       () => Promise<{ ok: boolean }>
  openLeadsFolder:   () => Promise<{ ok: boolean }>

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
