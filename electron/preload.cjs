const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  // ── Bot 控制 ─────────────────────────────────────────────
  startBot:   () => ipcRenderer.invoke('start-bot'),
  stopBot:    () => ipcRenderer.invoke('stop-bot'),
  getStatus:  () => ipcRenderer.invoke('get-status'),

  // ── 配置管理 ─────────────────────────────────────────────
  getConfig:  ()       => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // ── 统计数据 ─────────────────────────────────────────────
  getStats:      () => ipcRenderer.invoke('get-stats'),
  resetDedupe:   () => ipcRenderer.invoke('reset-dedupe'),
  getDailyStats: () => ipcRenderer.invoke('get-daily-stats'),

  // ── 环境与登录检测 ────────────────────────────────────────
  checkEnv:          () => ipcRenderer.invoke('check-env'),
  checkXhsLogin:     () => ipcRenderer.invoke('check-xhs-login'),
  getXhsLoginState:  () => ipcRenderer.invoke('get-xhs-login-state'),
  getXhsQrCode:      () => ipcRenderer.invoke('get-xhs-qrcode'),
  xhsLogin:          () => ipcRenderer.invoke('xhs-login'),
  restartMcpService: () => ipcRenderer.invoke('restart-mcp-service'),
  selectLeadsDir:    () => ipcRenderer.invoke('select-leads-dir'),
  openLogFile:       () => ipcRenderer.invoke('open-log-file'),
  openLeadsFolder:   () => ipcRenderer.invoke('open-leads-folder'),
  resetWatermarks:   () => ipcRenderer.invoke('reset-watermarks'),
  getKeywordStats:   () => ipcRenderer.invoke('get-keyword-stats'),
  resetKeywordStats: () => ipcRenderer.invoke('reset-keyword-stats'),

  // ── 事件监听（后端 → 前端推送）───────────────────────────
  onLog:       (cb) => ipcRenderer.on('log',        (_, v) => cb(v)),
  onStats:     (cb) => ipcRenderer.on('stats',      (_, v) => cb(v)),
  onBotStatus: (cb) => ipcRenderer.on('bot-status', (_, v) => cb(v)),
  onEnvCheck:  (cb) => ipcRenderer.on('env-check',  (_, v) => cb(v)),

  // ── 销毁监听器 ───────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
