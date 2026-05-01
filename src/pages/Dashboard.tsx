import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Terminal, FolderOpen, BarChart3, CheckCircle, QrCode, RefreshCw, UserRound } from 'lucide-react'
import type { LogEntry, Stats, DailyStatEntry, KeywordStat } from '../types/electron'
import EnvBanner from '../components/EnvBanner'
import Heatmap from '../components/Heatmap'

interface DashboardProps {
  logs: LogEntry[]
}

export default function Dashboard({ logs }: DashboardProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [stats, setStats] = useState<Stats>({ runCount: 0, totalLeads: 0, highIntentLeads: 0 })
  const [dailyStats, setDailyStats] = useState<Record<string, DailyStatEntry>>({})
  const [kwStats, setKwStats] = useState<Record<string, KeywordStat>>({})
  const [loading, setLoading] = useState(false)
  const [loginStatus, setLoginStatus] = useState<'unknown' | 'checking' | 'logged-in' | 'logged-out' | 'error'>('unknown')
  const [loginName, setLoginName] = useState('')
  const [loginError, setLoginError] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [qrExpiresAt, setQrExpiresAt] = useState(0)
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0)
  const [qrRefreshing, setQrRefreshing] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const qrLoadingRef = useRef(false)
  const isElectron = typeof window !== 'undefined' && !!window.electron

  // ── 初始化 ─────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return

    // 获取初始状态
    window.electron.getStatus().then(({ isRunning }) => setIsRunning(isRunning))
    window.electron.getStats().then(setStats)
    window.electron.getDailyStats().then(setDailyStats)
    window.electron.getKeywordStats().then(setKwStats)

    // 注册事件监听（log 已由 App 层管理）
    window.electron.onStats((newStats) => {
      setStats(newStats)
      window.electron.getDailyStats().then(setDailyStats)
      window.electron.getKeywordStats().then(setKwStats)
    })

    window.electron.onBotStatus((running) => {
      setIsRunning(running)
      setLoading(false)
    })

    return () => {
      window.electron.removeAllListeners('stats')
      window.electron.removeAllListeners('bot-status')
    }
  }, [isElectron])

  const refreshLoginState = useCallback(async () => {
    if (!isElectron) {
      setLoginStatus('error')
      return
    }
    setLoginStatus((prev) => prev === 'logged-in' ? prev : 'checking')
    const state = await window.electron.getXhsLoginState()
    if (state.loggedIn) {
      setLoginStatus('logged-in')
      setLoginName(state.username || '已登录账号')
      setLoginError('')
      setQrImage('')
      setQrExpiresAt(0)
      setQrSecondsLeft(0)
    } else if (state.ok) {
      setLoginStatus('logged-out')
      setLoginName('')
      setLoginError('')
    } else {
      setLoginStatus('error')
      setLoginError(state.error || '内置服务未就绪，请重新检测或重启服务')
    }
  }, [isElectron])

  const loadQrCode = useCallback(async () => {
    if (!isElectron || qrLoadingRef.current) return
    qrLoadingRef.current = true
    setQrRefreshing(true)
    setLoginStatus('checking')
    try {
      const result = await window.electron.getXhsQrCode()
      if (result.loggedIn) {
        setLoginStatus('logged-in')
        setLoginName(result.username || '已登录账号')
        setLoginError('')
        setQrImage('')
        setQrExpiresAt(0)
        setQrSecondsLeft(0)
      } else if (result.ok && result.img) {
        const ttl = Math.max(30, Number(result.timeout || 180))
        const expiresAt = Number(result.expiresAt || Date.now() + ttl * 1000)
        setLoginStatus('logged-out')
        setLoginError('')
        setQrImage(result.img)
        setQrExpiresAt(expiresAt)
        setQrSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
      } else {
        setLoginStatus('error')
        setLoginError(result.error || '二维码获取失败，请检查内置服务状态')
      }
    } finally {
      qrLoadingRef.current = false
      setQrRefreshing(false)
    }
  }, [isElectron])

  useEffect(() => {
    refreshLoginState()
  }, [refreshLoginState])

  useEffect(() => {
    if (!isElectron || loginStatus !== 'logged-out') return
    if (!qrImage) loadQrCode()
    const timer = setInterval(refreshLoginState, 2500)
    return () => clearInterval(timer)
  }, [isElectron, loginStatus, qrImage, loadQrCode, refreshLoginState])

  useEffect(() => {
    if (!isElectron || !qrImage || loginStatus === 'logged-in') return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((qrExpiresAt - Date.now()) / 1000))
      setQrSecondsLeft(remaining)
      if (remaining <= 0 && !qrLoadingRef.current) loadQrCode()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [isElectron, qrImage, qrExpiresAt, loginStatus, loadQrCode])

  // ── 滚动到底部 ──────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── 操作 ───────────────────────────────────────────────
  const handleToggle = useCallback(async () => {
    if (!isElectron) return
    setLoading(true)
    if (isRunning) {
      await window.electron.stopBot()
    } else {
      await window.electron.startBot()
    }
  }, [isRunning, isElectron])

  const logColorClass = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'log-success'
      case 'warn': return 'log-warn'
      case 'error': return 'log-error'
      default: return 'log-info'
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── 环境检测横幅 ──────────────────────────────────── */}
      <EnvBanner />

      {/* ── 状态栏 + 主控钮 ──────────────────────────────── */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className={`status-dot ${isRunning ? 'running' : 'stopped'}`} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {isRunning ? '监控运行中' : '监控已停止'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {isRunning ? '正在自动搜索高意向健身线索...' : '点击"开始监控"启动自动化任务'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            id="open-leads-btn"
            className="btn-secondary"
            onClick={() => isElectron && window.electron.openLeadsFolder()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FolderOpen size={14} />
            查看线索
          </button>

          <button
            id="toggle-bot-btn"
            className={`btn-control ${isRunning ? 'btn-stop' : 'btn-start'}`}
            onClick={handleToggle}
            disabled={loading}
          >
            {loading ? (
              <span className="spin" style={{ display: 'inline-block', width: 18, height: 18 }}>⟳</span>
            ) : isRunning ? (
              <Square size={18} />
            ) : (
              <Play size={18} />
            )}
            {loading ? '处理中...' : isRunning ? '停止监控' : '开始监控'}
          </button>
        </div>
      </div>

      {/* ── 数据概览 + 账号状态 ──────────────────────────── */}
      <div className="overview-grid">
        <Heatmap data={dailyStats} />
        <section className="xhs-account-card">
          <div className="xhs-account-header">
            <span className="card-title">
              <UserRound size={15} />
              小红书账号
            </span>
            <button className="icon-text-btn" onClick={refreshLoginState}>
              <RefreshCw size={13} className={loginStatus === 'checking' ? 'spin' : ''} />
              检测
            </button>
          </div>

          <div className={`xhs-login-state ${loginStatus === 'logged-in' ? 'ok' : 'warn'}`}>
            {loginStatus === 'logged-in' ? <CheckCircle size={18} /> : <QrCode size={18} />}
            <div>
              <div className="xhs-login-title">
                {loginStatus === 'logged-in' ? '已登录' : loginStatus === 'checking' ? '正在检测' : loginStatus === 'error' ? '服务未就绪' : '未登录'}
              </div>
              <div className="xhs-login-subtitle">
                {loginStatus === 'logged-in'
                  ? loginName
                  : loginStatus === 'error'
                    ? loginError
                    : isElectron ? '用小红书 App 扫码后开始抓取' : '请在桌面端检测登录状态'}
              </div>
            </div>
          </div>

          {loginStatus !== 'logged-in' && (
            <div className="xhs-qr-box">
              {qrImage ? (
                <>
                  <img src={qrImage} alt="小红书登录二维码" />
                  <div className={`xhs-qr-countdown ${qrSecondsLeft <= 15 ? 'warn' : ''}`}>
                    {qrRefreshing ? '正在刷新二维码...' : `剩余 ${qrSecondsLeft}s 自动刷新`}
                  </div>
                </>
              ) : (
                <button className="btn-secondary" onClick={loadQrCode} disabled={!isElectron || loginStatus === 'checking'}>
                  获取登录二维码
                </button>
              )}
            </div>
          )}

          <div className="xhs-mini-stats">
            <div>
              <span>{stats.runCount}</span>
              <label>运行次数</label>
            </div>
            <div>
              <span>{stats.totalLeads}</span>
              <label>线索总数</label>
            </div>
            <div>
              <span>{stats.highIntentLeads}</span>
              <label>高意向</label>
            </div>
          </div>
        </section>
      </div>

      {/* ── 关键词表现 ─────────────────────────────────────── */}
      {Object.keys(kwStats).length > 0 && (
        <div>
          <div className="card-header">
            <span className="card-title">
              <BarChart3 size={15} />
              关键词表现
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{Object.keys(kwStats).length} 个关键词</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>关键词</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>搜索</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>S</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--info)', fontWeight: 600 }}>A</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>B</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--error)', fontWeight: 600 }}>C</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--warning)', fontWeight: 600 }}>产出率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(kwStats)
                  .sort(([, a], [, b]) => {
                    const rateA = a.searches > 0 ? (a.leads_s * 3 + a.leads_a) / a.searches : 0
                    const rateB = b.searches > 0 ? (b.leads_s * 3 + b.leads_a) / b.searches : 0
                    return rateB - rateA
                  })
                  .map(([kw, stat]) => {
                    const rate = stat.searches > 0 ? ((stat.leads_s * 3 + stat.leads_a) / stat.searches).toFixed(2) : '-'
                    return (
                      <tr key={kw} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 14px', color: 'var(--text-primary)' }}>{kw}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>{stat.searches}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: stat.leads_s > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{stat.leads_s}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: stat.leads_a > 0 ? 'var(--info)' : 'var(--text-muted)' }}>{stat.leads_a}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: 'var(--text-muted)' }}>{stat.leads_b}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: stat.leads_c > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{stat.leads_c}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: 'var(--warning)', fontWeight: 600 }}>{rate}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 实时日志终端 ──────────────────────────────────── */}
      <div>
        <div className="card-header">
          <span className="card-title">
            <Terminal size={15} />
            实时运行日志
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>最近 {logs.length} 条</span>
        </div>
        <div className="terminal">
          <div className="terminal-header">
            <div className="terminal-dots">
              <div className="terminal-dot" style={{ background: '#ff5f57' }} />
              <div className="terminal-dot" style={{ background: '#febc2e' }} />
              <div className="terminal-dot" style={{ background: '#28c840' }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
              小红书获客助手 · 运行日志
            </span>
          </div>

          <div className="terminal-body">
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                等待任务启动...
              </div>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{entry.timestamp}</span>
                  <span className={logColorClass(entry.type)}>{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
