import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import type { EnvCheckResult } from '../types/electron'

export default function EnvBanner() {
  const [results, setResults] = useState<EnvCheckResult[]>([])
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isElectron = typeof window !== 'undefined' && !!window.electron

  const hasIssue = results.length > 0 && results.some((r) => !r.ok)

  useEffect(() => {
    if (!isElectron) return
    window.electron.onEnvCheck((res) => {
      setResults(res)
      setChecking(false)
      setInstalling(false)
      if (res.some((r) => !r.ok)) setExpanded(true)
    })
    return () => window.electron.removeAllListeners('env-check')
  }, [isElectron])

  const runCheck = async () => {
    if (!isElectron) return
    setChecking(true)
    await window.electron.checkEnv()
  }

  const handleInstallXhs = async () => {
    if (!isElectron) return
    setInstalling(true)
    await window.electron.installXhsSkills()
    // 重新检测
    setTimeout(() => runCheck(), 3000)
  }

  if (results.length === 0) return null

  return (
    <div style={{
      background: hasIssue ? 'rgba(255, 184, 0, 0.06)' : 'rgba(0, 212, 160, 0.06)',
      border: `1px solid ${hasIssue ? 'rgba(255, 184, 0, 0.2)' : 'rgba(0, 212, 160, 0.2)'}`,
      borderRadius: 'var(--radius-sm)',
      padding: '10px 16px',
      marginBottom: 20,
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasIssue
            ? <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
            : <CheckCircle size={14} style={{ color: 'var(--success)' }} />
          }
          <span style={{ color: hasIssue ? 'var(--warning)' : 'var(--success)', fontWeight: 500 }}>
            {hasIssue ? '检测到环境缺失，部分功能需手动配置' : '运行环境正常'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={runCheck} disabled={checking}
            style={{ padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={11} className={checking ? 'spin' : ''} />
            {checking ? '检测中...' : '重新检测'}
          </button>
          <button className="btn-secondary" onClick={() => setExpanded((e) => !e)}
            style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center' }}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {results.map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {r.ok
                ? <CheckCircle size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />
                : <XCircle size={12} style={{ color: 'var(--error)', flexShrink: 0 }} />
              }
              <span style={{ color: r.ok ? 'var(--text-secondary)' : 'var(--error)', fontWeight: 500 }}>{r.name}</span>
              {r.version && <span style={{ color: 'var(--text-muted)' }}>{r.version}</span>}
              {!r.ok && r.name === 'MCP 服务' && (
                <button
                  className="btn-secondary"
                  onClick={handleInstallXhs}
                  disabled={installing}
                  style={{ padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}
                >
                  {installing
                    ? <><RefreshCw size={10} className="spin" /> 启动中...</>
                    : <><RefreshCw size={10} /> 重启服务</>
                  }
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
