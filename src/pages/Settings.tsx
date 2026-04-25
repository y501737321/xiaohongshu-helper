import { useState, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { X, Save, RefreshCw, CheckCircle, XCircle, Clock, FileText, ToggleLeft, ToggleRight, FolderOpen, LogIn, Plus } from 'lucide-react'
import type { AppConfig } from '../types/electron'

// ─── 关键词预设组 ──────────────────────────────────────────
const KEYWORD_PRESETS = [
  {
    label: '精准获客（推荐）',
    words: ['求推荐私教', '想找私人教练', '求靠谱健身教练', '哪里有好的私教', '想减肥求教练', '产后恢复教练推荐'],
  },
  {
    label: '泛流量',
    words: ['寻找私教', '私教推荐', '体态矫正', '减肥健身', '增肌塑形'],
  },
]

const DEFAULT_AD_WORDS = ['接广告', '商务合作', '课程售价', '原价', '限时优惠', '私信领取', '代理加盟', '学员招募', '训练营报名', '品牌方']
const DEFAULT_COMMENT_WORDS = ['求推荐', '想找私教', '有私教推荐吗', '同城', '怎么收费', '多少钱', '在哪里', '能约课吗', '求教练', '有好的教练吗']

const DEFAULT_CONFIG: AppConfig = {
  keywords: ['求推荐私教', '想找私人教练', '求靠谱健身教练', '私教推荐', '产后恢复教练推荐'],
  intervalMinutes: 1440,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 7,
  mockMode: false,
  targetCity: '天津',
  maxDaysAgo: 1,
  adFilterWords: [...DEFAULT_AD_WORDS],
  commentIntentWords: [...DEFAULT_COMMENT_WORDS],
}

type LoginStatus = 'unknown' | 'checking' | 'ok' | 'fail'

// ─── 通用 Tag 输入组件 ──────────────────────────────────────
function TagInput({ items, onChange, inputId, placeholder }: {
  items: string[]
  onChange: (items: string[]) => void
  inputId: string
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  const add = () => {
    const v = input.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setInput('')
  }

  const remove = (item: string) => onChange(items.filter(i => i !== item))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && !input && items.length > 0) remove(items[items.length - 1])
  }

  return (
    <div className="tag-container" onClick={() => document.getElementById(inputId)?.focus()}>
      {items.map((item) => (
        <span key={item} className="tag">
          {item}
          <span className="tag-remove" onClick={() => remove(item)}><X size={11} /></span>
        </span>
      ))}
      <input
        id={inputId}
        className="tag-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={items.length === 0 ? (placeholder || '输入后按 Enter 添加...') : ''}
      />
    </div>
  )
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState(false)
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
    if (result.path) setConfig((p) => ({ ...p, leadsDir: result.path }))
  }

  // 批量添加关键词预设（跳过已存在的）
  const addPresetKeywords = (words: string[]) => {
    setConfig((p) => {
      const existing = new Set(p.keywords)
      const newWords = words.filter(w => !existing.has(w))
      return { ...p, keywords: [...p.keywords, ...newWords] }
    })
  }

  const StatusIcon = ({ status }: { status: LoginStatus }) => {
    if (status === 'checking') return <RefreshCw size={14} className="spin" style={{ color: 'var(--warning)' }} />
    if (status === 'ok') return <CheckCircle size={14} style={{ color: 'var(--success)' }} />
    if (status === 'fail') return <XCircle size={14} style={{ color: 'var(--error)' }} />
    return null
  }

  const statusBadge = (status: LoginStatus) => {
    if (status === 'ok')       return <span className="badge badge-success">已登录</span>
    if (status === 'fail')     return <span className="badge badge-error">未登录</span>
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

      {/* ── 小红书账号 ─────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">小红书账号</div>
        <div className="login-card">
          <div className="login-info">
            <div className="login-icon xhs-icon-bg">🌸</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>小红书</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                点击「扫码登录」，在弹出窗口中用小红书 App 扫码
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusIcon status={xhsStatus} />
            {statusBadge(xhsStatus)}
            <button id="check-xhs-btn" className="btn-secondary" onClick={checkXhs} disabled={xhsStatus === 'checking'}>检查状态</button>
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
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'rgba(255, 69, 58, 0.08)', border: '1px solid rgba(255, 69, 58, 0.2)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--error)', lineHeight: 1.6 }}>
            未检测到登录状态，请点击上方「扫码登录」按钮完成登录。
          </div>
        )}
      </div>

      {/* ── 监控关键词 ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">监控关键词</div>

        {/* 预设词组按钮 */}
        <div className="form-group">
          <label className="form-label">快捷预设（点击批量添加）</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {KEYWORD_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn-secondary"
                onClick={() => addPresetKeywords(preset.words)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12 }}
              >
                <Plus size={12} />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">当前关键词（按 Enter 或逗号添加自定义词）</label>
          <TagInput
            items={config.keywords}
            onChange={(keywords) => setConfig((p) => ({ ...p, keywords }))}
            inputId="tag-input"
            placeholder="输入关键词..."
          />
        </div>
      </div>

      {/* ── 广告过滤词 ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">广告过滤词</div>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>标题包含以下词的笔记将被自动跳过（节省 AI 额度）</span>
            <button
              className="btn-secondary"
              onClick={() => {
                const existing = new Set(config.adFilterWords || [])
                const newWords = DEFAULT_AD_WORDS.filter(w => !existing.has(w))
                setConfig((p) => ({ ...p, adFilterWords: [...(p.adFilterWords || []), ...newWords] }))
              }}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={10} />
              填入预设
            </button>
          </label>
          <TagInput
            items={config.adFilterWords || []}
            onChange={(adFilterWords) => setConfig((p) => ({ ...p, adFilterWords }))}
            inputId="ad-filter-input"
            placeholder="输入广告词..."
          />
        </div>
      </div>

      {/* ── 评论意向词 ────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">评论区客户挖掘</div>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>评论中包含以下词的用户将被记录为潜在客户（零 AI 开销）</span>
            <button
              className="btn-secondary"
              onClick={() => {
                const existing = new Set(config.commentIntentWords || [])
                const newWords = DEFAULT_COMMENT_WORDS.filter(w => !existing.has(w))
                setConfig((p) => ({ ...p, commentIntentWords: [...(p.commentIntentWords || []), ...newWords] }))
              }}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={10} />
              填入预设
            </button>
          </label>
          <TagInput
            items={config.commentIntentWords || []}
            onChange={(commentIntentWords) => setConfig((p) => ({ ...p, commentIntentWords }))}
            inputId="comment-intent-input"
            placeholder="输入意向词..."
          />
        </div>
      </div>

      {/* ── 线索保存位置 ──────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">线索保存位置</div>
        <div className="form-group">
          <label className="form-label">CSV 文件保存目录（留空使用默认位置）</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input id="leads-dir" type="text" className="form-input" value={config.leadsDir} onChange={set('leadsDir')} placeholder="默认：应用数据目录/leads/" style={{ flex: 1 }} />
            <button id="select-leads-dir-btn" className="btn-secondary" onClick={handleSelectLeadsDir} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', padding: '8px 14px' }}>
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
          <input id="interval-slider" type="range" min={5} max={1440} step={5} value={config.intervalMinutes}
            onChange={(e) => setConfig((p) => ({ ...p, intervalMinutes: Number(e.target.value) }))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>5 分钟</span><span>1440 分钟(每天一次)</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">收集日期范围 (天内)</label>
            <input id="max-days-ago" type="number" className="form-input" min={1} max={30}
              value={config.maxDaysAgo} onChange={(e) => setConfig((p) => ({ ...p, maxDaysAgo: Number(e.target.value) }))} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>1表示只收集当天内容</div>
          </div>
          <div className="form-group">
            <label className="form-label">目标城市（IP属地参考，不硬过滤）</label>
            <input id="target-city" type="text" className="form-input"
              value={config.targetCity} onChange={set('targetCity')} placeholder="例如: 天津" />
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
