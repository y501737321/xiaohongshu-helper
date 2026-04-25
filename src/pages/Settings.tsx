import { useState, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { X, Save, RefreshCw, CheckCircle, XCircle, Clock, FileText, ToggleLeft, ToggleRight, FolderOpen, LogIn } from 'lucide-react'
import type { AppConfig } from '../types/electron'

const DEFAULT_CONFIG: AppConfig = {
  keywords: ['寻找私教', '私教推荐', '产后恢复', '体态矫正', '减肥健身', '增肌塑形'],
  intervalMinutes: 30,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 7,
  mockMode: false,
}

type LoginStatus = 'unknown' | 'checking' | 'ok' | 'fail'

export default function Settings() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [xhsStatus, setXhsStatus] = useState<LoginStatus>('unknown')
  const isElectron = typeof window !== 'undefined' && !!window.electron

  useEffect(() => {
    if (!isElectron) return
    window.electron.getConfig().then(setConfig)
    window.electron.onLog((entry) => {
      if (entry.message.includes('小红书登录正常') || entry.message.includes('登录成功')) {
        setXhsStatus('ok')
      } else if (entry.message.includes('小红书未登录') || entry.message.includes('登录失败')) {
        setXhsStatus('fail')
      }
    })
    return () => window.electron.removeAllListeners('log')
  }, [isElectron])

  const handleSave = useCallback(async () => {
    if (!isElectron) return
    await window.electron.saveConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [config, isElectron])

  const addKeyword = () => {
    const kw = tagInput.trim()
    if (kw && !config.keywords.includes(kw)) {
      setConfig((p) => ({ ...p, keywords: [...p.keywords, kw] }))
    }
    setTagInput('')
  }

  const removeKeyword = (kw: string) =>
    setConfig((p) => ({ ...p, keywords: p.keywords.filter((k) => k !== kw) }))

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword() }
    if (e.key === 'Backspace' && !tagInput && config.keywords.length > 0)
      removeKeyword(config.keywords[config.keywords.length - 1])
  }

  const checkXhs = async () => {
    if (!isElectron) return
    setXhsStatus('checking')
    await window.electron.checkXhsLogin()
    setTimeout(() => setXhsStatus((s) => s === 'checking' ? 'unknown' : s), 10000)
  }

  const handleXhsLogin = async () => {
    if (!isElectron) return
    await window.electron.xhsLogin()
  }

  const handleSelectLeadsDir = async () => {
    if (!isElectron) return
    const result = await window.electron.selectLeadsDir()
    if (result.path) {
      setConfig((p) => ({ ...p, leadsDir: result.path }))
    }
  }

  const StatusIcon = ({ status }: { status: LoginStatus }) => {
    if (status === 'checking') return <RefreshCw size={14} className="spin" style={{ color: 'var(--warning)' }} />
    if (status === 'ok') return <CheckCircle size={14} style={{ color: 'var(--success)' }} />
    if (status === 'fail') return <XCircle size={14} style={{ color: 'var(--error)' }} />
    return null
  }

  const statusBadge = (status: LoginStatus) => {
    if (status === 'ok')      return <span className="badge badge-success">已登录</span>
    if (status === 'fail')    return <span className="badge badge-error">未登录</span>
    if (status === 'checking') return <span className="badge badge-warning">检测中...</span>
    return <span className="badge badge-unknown">未检测</span>
  }

  const set = (field: keyof AppConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig((p) => ({ ...p, [field]: e.target.value }))

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── 顶部操作栏 ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 模拟模式开关 */}
          <button
            id="mock-mode-btn"
            className="btn-secondary"
            onClick={() => setConfig((p) => ({ ...p, mockMode: !p.mockMode }))}
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: config.mockMode ? 'var(--warning)' : 'var(--text-muted)' }}
          >
            {config.mockMode ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            {config.mockMode ? '模拟模式 (开)' : '模拟模式 (关)'}
          </button>

          <button
            id="open-log-btn"
            className="btn-secondary"
            onClick={() => isElectron && window.electron.openLogFile()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FileText size={14} />
            查看日志文件
          </button>
        </div>

        <button
          id="save-config-btn"
          className="btn-control btn-start"
          onClick={handleSave}
          style={{ padding: '10px 24px' }}
        >
          <Save size={16} />
          {saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>

      {/* ── 平台账号状态 ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">小红书账号</div>

        <div className="login-card">
          <div className="login-info">
            <div className="login-icon xhs-icon-bg">🌸</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>小红书</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                点击「扫码登录」在弹出的浏览器窗口中用手机扫码
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusIcon status={xhsStatus} />
            {statusBadge(xhsStatus)}
            <button id="check-xhs-btn" className="btn-secondary" onClick={checkXhs} disabled={xhsStatus === 'checking'}>
              检查状态
            </button>
            <button
              id="xhs-login-btn"
              className="btn-control btn-start"
              onClick={handleXhsLogin}
              style={{ padding: '6px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <LogIn size={14} />
              扫码登录
            </button>
          </div>
        </div>

        {xhsStatus === 'fail' && (
          <div style={{
            marginTop: 8,
            padding: '10px 14px',
            background: 'rgba(255, 69, 58, 0.08)',
            border: '1px solid rgba(255, 69, 58, 0.2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            color: 'var(--error)',
            lineHeight: 1.6,
          }}>
            未检测到登录状态，请点击上方「扫码登录」按钮，在弹出的浏览器中用小红书 App 扫码完成登录。
          </div>
        )}
      </div>

      {/* ── 监控关键词 ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">监控关键词</div>
        <div className="form-group">
          <label className="form-label">搜索关键词列表（按 Enter 或逗号添加）</label>
          <div className="tag-container" onClick={() => document.getElementById('tag-input')?.focus()}>
            {config.keywords.map((kw) => (
              <span key={kw} className="tag">
                {kw}
                <span className="tag-remove" onClick={() => removeKeyword(kw)}><X size={11} /></span>
              </span>
            ))}
            <input
              id="tag-input"
              className="tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={addKeyword}
              placeholder={config.keywords.length === 0 ? '输入关键词...' : ''}
            />
          </div>
        </div>
      </div>

      {/* ── 线索保存位置 ──────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">线索保存位置</div>
        <div className="form-group">
          <label className="form-label">CSV 文件保存目录（留空使用默认位置）</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              id="leads-dir"
              type="text"
              className="form-input"
              value={config.leadsDir}
              onChange={set('leadsDir')}
              placeholder="默认：应用数据目录/leads/"
              style={{ flex: 1 }}
            />
            <button
              id="select-leads-dir-btn"
              className="btn-secondary"
              onClick={handleSelectLeadsDir}
              style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', padding: '8px 14px' }}
            >
              <FolderOpen size={14} />
              选择文件夹
            </button>
          </div>
        </div>
      </div>

      {/* ── 系统参数 ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">系统参数</div>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} />
            轮询间隔：<strong style={{ color: 'var(--text-primary)' }}>{config.intervalMinutes} 分钟</strong>
          </label>
          <input
            id="interval-slider"
            type="range"
            min={5} max={120} step={5}
            value={config.intervalMinutes}
            onChange={(e) => setConfig((p) => ({ ...p, intervalMinutes: Number(e.target.value) }))}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>5 分钟</span><span>120 分钟</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">夜间暂停开始 (时)</label>
            <input id="night-start" type="number" className="form-input" min={0} max={23}
              value={config.nightModeStart} onChange={(e) => setConfig((p) => ({ ...p, nightModeStart: Number(e.target.value) }))} />
          </div>
          <div className="form-group">
            <label className="form-label">夜间暂停结束 (时)</label>
            <input id="night-end" type="number" className="form-input" min={0} max={23}
              value={config.nightModeEnd} onChange={(e) => setConfig((p) => ({ ...p, nightModeEnd: Number(e.target.value) }))} />
          </div>
        </div>
      </div>

      {/* ── LLM 配置 ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">AI 意向评估 (DeepSeek)</div>

        {/* API Key */}
        <div className="form-group">
          <label className="form-label">
            DeepSeek API Key
            <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer"
              style={{ marginLeft: 8, fontSize: 11, color: 'var(--info)', textDecoration: 'none' }}>
              → platform.deepseek.com 获取
            </a>
          </label>
          <input id="llm-api-key" type="text" className="form-input"
            value={config.llmApiKey} onChange={set('llmApiKey')} placeholder="sk-..." />
        </div>

        {/* 自定义 Base URL + 模型（高级用户手动覆盖） */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">API Base URL（高级，一般无需修改）</label>
            <input id="llm-base-url" type="text" className="form-input"
              value={config.llmBaseUrl} onChange={set('llmBaseUrl')} placeholder="https://api.deepseek.com" />
          </div>
          <div className="form-group">
            <label className="form-label">模型名称</label>
            <input id="llm-model" type="text" className="form-input"
              value={config.llmModel} onChange={set('llmModel')} placeholder="deepseek-v4-flash" />
          </div>
        </div>
      </div>

    </div>
  )
}
