import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, RotateCcw, Activity, Target, TrendingUp, Terminal, FolderOpen } from 'lucide-react'
import type { LogEntry, Stats } from '../types/electron'
import EnvBanner from '../components/EnvBanner'

export default function Dashboard() {
  const [isRunning, setIsRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<Stats>({ runCount: 0, totalLeads: 0, highIntentLeads: 0 })
  const [loading, setLoading] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const isElectron = typeof window !== 'undefined' && !!window.electron

  // ── 初始化 ─────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return

    // 获取初始状态
    window.electron.getStatus().then(({ isRunning }) => setIsRunning(isRunning))
    window.electron.getStats().then(setStats)

    // 注册事件监听
    window.electron.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-200), entry]) // 最多保留 200 条
    })

    window.electron.onStats((newStats) => setStats(newStats))

    window.electron.onBotStatus((running) => {
      setIsRunning(running)
      setLoading(false)
    })

    return () => {
      window.electron.removeAllListeners('log')
      window.electron.removeAllListeners('stats')
      window.electron.removeAllListeners('bot-status')
    }
  }, [isElectron])

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

  const handleResetStats = useCallback(async () => {
    if (!isElectron) return
    await window.electron.resetStats()
    setLogs([])
  }, [isElectron])

  const logColorClass = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'log-success'
      case 'warn': return 'log-warn'
      case 'error': return 'log-error'
      default: return 'log-info'
    }
  }

  const highIntentRate =
    stats.totalLeads > 0
      ? Math.round((stats.highIntentLeads / stats.totalLeads) * 100)
      : 0

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
            id="reset-stats-btn"
            className="btn-secondary"
            onClick={handleResetStats}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={14} />
            重置数据
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

      {/* ── 数据简报 ──────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Activity size={16} style={{ color: 'var(--info)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>今日运行次数</span>
          </div>
          <div className="stat-value">{stats.runCount}</div>
          <div className="stat-label">轮次</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Target size={16} style={{ color: 'var(--warning)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>发现线索总数</span>
          </div>
          <div className="stat-value">{stats.totalLeads}</div>
          <div className="stat-label">条笔记</div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TrendingUp size={16} style={{ color: 'var(--success)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>高意向线索 (S/A)</span>
          </div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>
            {stats.highIntentLeads}
          </div>
          <div className="stat-label">已保存至本地 · 转化率 {highIntentRate}%</div>
        </div>
      </div>

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
