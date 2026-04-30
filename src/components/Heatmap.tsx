import { useState, useMemo, useRef } from 'react'
import type { DailyStatEntry } from '../types/electron'

type MetricKey = 'searches' | 'highIntent'

const METRIC_OPTIONS: { key: MetricKey; label: string }[] = [
  { key: 'searches', label: '搜索笔记数' },
  { key: 'highIntent', label: '高意向线索' },
]

const COLORS = ['#1c1c30', '#2a1f35', '#4a1f3a', '#8a1f45', '#ff2d55']
const BORDER_COLOR = 'rgba(255,255,255,0.06)'
const WEEKS = 26
const DAYS = 7
const DAY_LABELS = ['一', '', '三', '', '五', '', '日']
const CELL_SIZE = 11
const GAP = 3

function getColor(value: number, max: number): string {
  if (value === 0 || max === 0) return COLORS[0]
  const ratio = value / max
  if (ratio <= 0.25) return COLORS[1]
  if (ratio <= 0.5) return COLORS[2]
  if (ratio <= 0.75) return COLORS[3]
  return COLORS[4]
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getMonday(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

export default function Heatmap({ data }: { data: Record<string, DailyStatEntry> }) {
  const [metric, setMetric] = useState<MetricKey>('searches')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { grid, monthLabels, maxVal } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const currentMonday = getMonday(today)
    const startMonday = new Date(currentMonday)
    startMonday.setDate(startMonday.getDate() - (WEEKS - 1) * 7)

    const cells: { date: string; value: number; col: number; row: number; future: boolean }[] = []
    let max = 0

    for (let week = 0; week < WEEKS; week++) {
      for (let day = 0; day < DAYS; day++) {
        const d = new Date(startMonday)
        d.setDate(d.getDate() + week * 7 + day)
        const dateStr = formatDate(d)
        const entry = data[dateStr]
        const value = entry ? (entry[metric] || 0) : 0
        const future = d > today

        if (!future && value > max) max = value
        cells.push({ date: dateStr, value: future ? -1 : value, col: week, row: day, future })
      }
    }

    // Month labels
    const labels: { text: string; col: number }[] = []
    let lastMonth = -1
    for (let week = 0; week < WEEKS; week++) {
      const d = new Date(startMonday)
      d.setDate(d.getDate() + week * 7)
      const month = d.getMonth()
      if (month !== lastMonth) {
        labels.push({ text: `${month + 1}月`, col: week })
        lastMonth = month
      }
    }

    return { grid: cells, monthLabels: labels, maxVal: max }
  }, [data, metric])

  const labelWidth = 24
  const cellSize = CELL_SIZE
  const svgWidth = WEEKS * CELL_SIZE + GAP * (WEEKS - 1)
  const svgHeight = DAYS * CELL_SIZE + GAP * (DAYS - 1)

  return (
    <div className="heatmap-container">
      <div className="heatmap-header">
        <span className="heatmap-title">数据概览</span>
        <div className="heatmap-filters">
          {METRIC_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`heatmap-filter-btn ${metric === opt.key ? 'active' : ''}`}
              onClick={() => setMetric(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heatmap-body" ref={containerRef} style={{ position: 'relative' }}>
            {/* Month labels */}
            <div style={{ position: 'relative', marginLeft: labelWidth, height: 16, marginBottom: 4 }}>
              {monthLabels.map((m, i) => (
                <span
                  key={i}
                  className="heatmap-month"
                  style={{ position: 'absolute', left: m.col * (cellSize + GAP) }}
                >
                  {m.text}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex' }}>
              {/* Day labels */}
              <div style={{ display: 'flex', flexDirection: 'column', width: labelWidth, flexShrink: 0 }}>
                {DAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className="heatmap-day-label"
                    style={{ height: cellSize + GAP, lineHeight: `${cellSize + GAP}px` }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Grid */}
              <svg width={svgWidth} height={svgHeight}>
                {grid.map((cell, i) => {
                  if (cell.future) return null
                  const x = cell.col * (cellSize + GAP)
                  const y = cell.row * (cellSize + GAP)
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      rx={2}
                      fill={getColor(cell.value, maxVal)}
                      stroke={BORDER_COLOR}
                      strokeWidth={1}
                      className="heatmap-cell"
                      onMouseEnter={(e) => {
                        const rect = (e.target as SVGRectElement).getBoundingClientRect()
                        const container = containerRef.current?.getBoundingClientRect()
                        if (container) {
                          const label = METRIC_OPTIONS.find(o => o.key === metric)?.label || ''
                          setTooltip({
                            x: rect.left - container.left + cellSize / 2,
                            y: rect.top - container.top - 8,
                            text: `${cell.date}  ${label}: ${cell.value}`,
                          })
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                })}
              </svg>
            </div>

            {/* Tooltip */}
            {tooltip && (
              <div
                className="heatmap-tooltip"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                {tooltip.text}
              </div>
            )}
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-text">少</span>
        {COLORS.map((c, i) => (
          <span
            key={i}
            className="heatmap-legend-cell"
            style={{ background: c, border: `1px solid ${BORDER_COLOR}` }}
          />
        ))}
        <span className="heatmap-legend-text">多</span>
      </div>
    </div>
  )
}
