import { useState, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { X, Save, Clock, FileText, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import type { AppConfig } from '../types/electron'

// ─── 关键词预设组 ────────────────────────────────────────
const KEYWORD_PRESETS = [
  {
    label: '默认推荐',
    words: [
      '求靠谱健身教练', '想减肥', '求推荐私教', '想找私人教练',
      '哪里有好的私教', '私教推荐', '找个教练带我练', '有没有靠谱的健身教练',
      '产后恢复教练推荐', '体态矫正哪里好', '想减肥不知道怎么开始',
      '健身小白求带', '想增肌求指导', '骨盆修复推荐',
      '想瘦腿求方法', '圆肩驼背怎么矫正',
    ],
  },
]

// ─── 中国主要城市 ──────────────────────────────────────────
const CHINA_CITIES = [
  '北京', '上海', '广州', '深圳', '天津', '重庆',
  '杭州', '南京', '苏州', '成都', '武汉', '西安',
  '长沙', '郑州', '青岛', '大连', '宁波', '厦门',
  '福州', '合肥', '济南', '昆明', '沈阳', '哈尔滨',
  '佛山', '东莞', '无锡', '石家庄', '南昌', '贵阳',
]

const DEFAULT_AD_WORDS = ['接广告', '商务合作', '课程售价', '原价', '限时优惠', '私信领取', '代理加盟', '学员招募', '训练营报名', '品牌方']

const PUBLISH_TIME_OPTIONS = [
  { value: 1, label: '一天内', intervalMinutes: 1440, hint: '默认推荐，和每天一次的运行频率保持一致' },
  { value: 7, label: '一周内', intervalMinutes: 10080, hint: '扩大搜索范围，覆盖最近仍可能转化的笔记' },
  { value: 180, label: '半年内', intervalMinutes: 43200, hint: '低频补漏，结果更多、单轮更慢' },
]

const RUN_INTERVAL_OPTIONS = [
  { value: 1440, label: '每天一次', hint: '适合搜索范围：一天内' },
  { value: 10080, label: '每周一次', hint: '适合搜索范围：一周内' },
  { value: 43200, label: '每月一次', hint: '适合搜索范围：半年内补漏' },
]

const DEFAULT_CONFIG: AppConfig = {
  configVersion: 3,
  keywords: [
    '求靠谱健身教练', '想减肥', '求推荐私教', '想找私人教练',
    '哪里有好的私教', '私教推荐', '找个教练带我练', '有没有靠谱的健身教练',
    '产后恢复教练推荐', '体态矫正哪里好', '想减肥不知道怎么开始',
    '健身小白求带', '想增肌求指导', '骨盆修复推荐',
    '想瘦腿求方法', '圆肩驼背怎么矫正',
  ],
  intervalMinutes: 1440,
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-v4-flash',
  leadsDir: '',
  nightModeStart: 0,
  nightModeEnd: 0,
  mockMode: false,
  targetCity: '天津',
  maxDaysAgo: 1,
  searchEngine: 'mcp',
  searchLimitPerKeyword: 120,
  maxResultsPerKeyword: 0,
  maxDetailsPerRun: 0,
  titleScoreThreshold: -999,
  adFilterWords: [...DEFAULT_AD_WORDS],
}

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
  const isElectron = typeof window !== 'undefined' && !!window.electron

  useEffect(() => {
    if (!isElectron) return
    window.electron.getConfig().then(setConfig)
  }, [isElectron])

  const handleSave = useCallback(async () => {
    if (!isElectron) return
    await window.electron.saveConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [config, isElectron])

  const handleSelectLeadsDir = async () => {
    if (!isElectron) return
    const result = await window.electron.selectLeadsDir()
    if (result.path) setConfig((p) => ({ ...p, leadsDir: result.path }))
  }

  const handleResetDedupe = async () => {
    if (!isElectron) return
    const ok = window.confirm('重置去重记录后，下轮可能重新处理已经看过的笔记或作者。已保存的线索文件不会被删除。确定继续吗？')
    if (!ok) return
    await window.electron.resetDedupe()
  }

  const set = (field: keyof AppConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig((p) => ({ ...p, [field]: e.target.value }))

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── 顶部操作栏 ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

      {/* ── 监控关键词 ──────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section-title">监控关键词</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
          每轮按下方关键词进行真实搜索；设置目标城市后会自动拼接城市名，并在本地按发布时间和意向过滤。
        </div>

        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--success)' }}>关键词池</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {KEYWORD_PRESETS.map((preset) => (
                <button key={preset.label} className="btn-secondary"
                  onClick={() => {
                    const existing = new Set(config.keywords || [])
                    const newWords = preset.words.filter(w => !existing.has(w))
                    setConfig((p) => ({ ...p, keywords: [...(p.keywords || []), ...newWords] }))
                  }}
                  style={{ padding: '3px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Plus size={10} />填入{preset.label}
                </button>
              ))}
            </div>
          </label>
          <TagInput
            items={config.keywords}
            onChange={(keywords) => setConfig((p) => ({ ...p, keywords }))}
            inputId="tag-keywords"
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">搜索范围</label>
            <select id="max-days-ago" className="form-input"
              value={PUBLISH_TIME_OPTIONS.some((item) => item.value === config.maxDaysAgo) ? config.maxDaysAgo : 1}
              onChange={(e) => {
                const maxDaysAgo = Number(e.target.value)
                const option = PUBLISH_TIME_OPTIONS.find((item) => item.value === maxDaysAgo)
                setConfig((p) => ({
                  ...p,
                  maxDaysAgo,
                  intervalMinutes: option?.intervalMinutes ?? p.intervalMinutes,
                }))
              }}>
              {PUBLISH_TIME_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {PUBLISH_TIME_OPTIONS.find((item) => item.value === config.maxDaysAgo)?.hint || '按平台支持的搜索范围筛选，再本地复核'}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={13} />
              运行频率
            </label>
            <select id="interval-select" className="form-input"
              value={RUN_INTERVAL_OPTIONS.some((item) => item.value === config.intervalMinutes) ? config.intervalMinutes : 1440}
              onChange={(e) => setConfig((p) => ({ ...p, intervalMinutes: Number(e.target.value) }))}>
              {RUN_INTERVAL_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {RUN_INTERVAL_OPTIONS.find((item) => item.value === config.intervalMinutes)?.hint || '按搜索范围选择运行节奏'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">目标城市（搜索自动拼接 + IP属地参考）</label>
            <select id="target-city" className="form-input"
              value={CHINA_CITIES.includes(config.targetCity) ? config.targetCity : '__custom__'}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setConfig((p) => ({ ...p, targetCity: '' }))
                } else {
                  setConfig((p) => ({ ...p, targetCity: e.target.value }))
                }
              }}
            >
              {CHINA_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">自定义...</option>
            </select>
            {!CHINA_CITIES.includes(config.targetCity) && (
              <input type="text" className="form-input" style={{ marginTop: 8 }}
                value={config.targetCity} onChange={set('targetCity')} placeholder="输入城市名..." />
            )}
          </div>
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

      {/* ── 高级过滤设置 ────────────────────────────────────────── */}
      <details className="settings-section">
        <summary className="settings-section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
          高级过滤设置（点击展开）
        </summary>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
            默认尽可能多抓取真实结果；0 表示不在该阶段截断，所有被基础过滤通过的笔记都会继续进入下一步。
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">搜索后端</label>
              <input className="form-input" value="内置 MCP 服务" readOnly />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>当前安装包只使用内置服务，无需安装额外 Python 组件</div>
            </div>
            <div className="form-group">
              <label className="form-label">每关键词搜索上限</label>
              <input type="number" className="form-input" min={20} max={500}
                value={config.searchLimitPerKeyword ?? 120}
                onChange={(e) => setConfig((p) => ({ ...p, searchLimitPerKeyword: Number(e.target.value) }))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>默认120；越高越全，但单轮更慢</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">每关键词预筛上限</label>
              <input type="number" className="form-input" min={0} max={500}
                value={config.maxResultsPerKeyword ?? 0}
                onChange={(e) => setConfig((p) => ({ ...p, maxResultsPerKeyword: Number(e.target.value) }))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>0=不限制；不再默认只取前几条</div>
            </div>
            <div className="form-group">
              <label className="form-label">本轮详情抓取上限</label>
              <input type="number" className="form-input" min={0} max={1000}
                value={config.maxDetailsPerRun ?? 0}
                onChange={(e) => setConfig((p) => ({ ...p, maxDetailsPerRun: Number(e.target.value) }))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>0=候选全量进详情；最完整但耗时更长</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">标题预筛阈值</label>
              <input type="number" className="form-input" min={-999} max={10}
                value={config.titleScoreThreshold ?? -999}
                onChange={(e) => setConfig((p) => ({ ...p, titleScoreThreshold: Number(e.target.value) }))} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>默认-999，不因标题弱而丢弃；越高越严格</div>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
            <label className="form-label">危险操作</label>
            <button
              className="btn-secondary"
              onClick={handleResetDedupe}
              style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warning)' }}
            >
              <RefreshCw size={14} />
              重置去重记录
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
              清空已处理过的笔记和作者缓存；不会删除 CSV 或统计文档，但下轮可能重新扫描旧内容。
            </div>
          </div>
        </div>
      </details>

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
