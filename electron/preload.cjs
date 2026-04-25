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
  getStats:   () => ipcRenderer.invoke('get-stats'),
  resetStats: () => ipcRenderer.invoke('reset-stats'),

  // ── 环境与登录检测 ────────────────────────────────────────
  checkEnv:          () => ipcRenderer.invoke('check-env'),
  checkXhsLogin:     () => ipcRenderer.invoke('check-xhs-login'),
  xhsLogin:          () => ipcRenderer.invoke('xhs-login'),
  installXhsSkills:  () => ipcRenderer.invoke('install-xhs-skills'),
  selectLeadsDir:    () => ipcRenderer.invoke('select-leads-dir'),
  openLogFile:       () => ipcRenderer.invoke('open-log-file'),
  openLeadsFolder:   () => ipcRenderer.invoke('open-leads-folder'),

  // ── 事件监听（后端 → 前端推送）───────────────────────────
  onLog:       (cb) => ipcRenderer.on('log',        (_, v) => cb(v)),
  onStats:     (cb) => ipcRenderer.on('stats',      (_, v) => cb(v)),
  onBotStatus: (cb) => ipcRenderer.on('bot-status', (_, v) => cb(v)),
  onEnvCheck:  (cb) => ipcRenderer.on('env-check',  (_, v) => cb(v)),

  // ── 销毁监听器 ───────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
