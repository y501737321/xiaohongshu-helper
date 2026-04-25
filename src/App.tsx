import { useState } from 'react'
import { LayoutDashboard, Settings as SettingsIcon, Flower2, Zap } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import './index.css'

type Page = 'dashboard' | 'settings'

export default function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard')

  const navItems = [
    { id: 'dashboard' as Page, label: '主控台', icon: LayoutDashboard },
    { id: 'settings' as Page, label: '设置中心', icon: SettingsIcon },
  ]

  const pageConfig = {
    dashboard: { title: '主控台', subtitle: '实时监控小红书健身线索，自动保存至本地' },
    settings: { title: '设置中心', subtitle: '配置监控关键词、账号登录及系统参数' },
  }

  return (
    <div className="app-container">
      {/* ── 侧边栏 ──────────────────────────────────────── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="logo-icon">
            <Flower2 size={20} color="white" />
          </div>
          <div className="logo-text">
            <div className="logo-title">小红书获客</div>
            <div className="logo-subtitle">健身私教助手</div>
          </div>
        </div>

        {/* 导航 */}
        <nav className="sidebar-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <div
              key={id}
              id={`nav-${id}`}
              className={`nav-item ${activePage === id ? 'active' : ''}`}
              onClick={() => setActivePage(id)}
              role="button"
            >
              <Icon size={16} className="nav-item-icon" />
              {label}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            <Zap size={12} style={{ color: 'var(--accent-primary)' }} />
            Phase 1&2 · 框架与 UI
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            v1.0.0
          </div>
        </div>
      </aside>

      {/* ── 主内容区 ─────────────────────────────────────── */}
      <main className="main-content">
        {/* 页头 */}
        <div className="page-header">
          <h1 className="page-title">{pageConfig[activePage].title}</h1>
          <p className="page-subtitle">{pageConfig[activePage].subtitle}</p>
        </div>

        {/* 页面内容 */}
        <div className="page-body">
          {activePage === 'dashboard' && <Dashboard />}
          {activePage === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
