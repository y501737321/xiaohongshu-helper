const { httpRequest } = require('./utils.cjs')
const { loadConfig } = require('./config.cjs')
const { scoreTitleIntent, computeGeoScore } = require('./filter-pipeline.cjs')

const TRIAGE_BATCH_SIZE = 15
const DEEP_EVAL_BATCH_SIZE = 6

// ─── 无 Key / 模拟模式下的确定性评估 ──────────────────────
function heuristicEval(item) {
  const config = loadConfig()
  const text = [
    item.note?.title,
    item.note?.desc,
    item.detail?.content,
    item.note?._keyword,
  ].filter(Boolean).join(' ')

  const titleScore = scoreTitleIntent(`${item.note?.title || ''} ${item.note?.desc || ''}`)
  const geoScore = computeGeoScore(item.detail?.ipLocation || '', config.targetCity)
  const needHits = [
    /求推荐|有推荐|有没有|哪里有|想找|找个|找一个|求个/,
    /私教|教练|健身房|减脂|减肥|增肌|塑形|体态|产后|普拉提|瑜伽/,
    /附近|同城|坐标|预算|价格|收费|多少钱|靠谱|小白|急/,
  ].reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0)
  const commercialHits = [
    /接广告|商务合作|招生|招学员|课程|训练营|加盟|代理|私信领取|扫码|加微|加v/i,
  ].reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0)

  let numericScore = 35 + Math.max(titleScore, -6) * 4 + needHits * 12 + Math.round(geoScore * 18) - commercialHits * 28
  if (item.detail?.time) {
    const ageHours = (Date.now() - item.detail.time) / (60 * 60 * 1000)
    if (ageHours <= 3) numericScore += 8
    else if (ageHours <= 12) numericScore += 4
  }

  numericScore = Math.max(0, Math.min(100, numericScore))
  const score = numericScore >= 78 ? 'S' : numericScore >= 60 ? 'A' : numericScore >= 40 ? 'B' : 'C'
  const summaryMap = {
    S: '明确表达找教练/私教需求，且地点或时间窗口较近，建议优先跟进',
    A: '有较明确健身需求，可作为今日潜在线索跟进',
    B: '健身相关但购买意向不足，暂不优先',
    C: commercialHits > 0 ? '疑似广告或卖课内容' : '需求不明确或与获客目标不匹配',
  }

  return {
    score,
    numericScore,
    summary: summaryMap[score],
    author_intent: `规则评分: 标题${titleScore}, 需求信号${needHits}, 地理${geoScore}, 商业信号${commercialHits}`,
  }
}

// ─── 通用 LLM 调用 ────────────────────────────────────────
async function callLLM(prompt, { maxTokens = 2000, temperature = 0.1 } = {}) {
  const config = loadConfig()
  const baseUrl = (config.llmBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
  const res = await httpRequest(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llmApiKey}`,
      },
      timeout: 60000,
    },
    {
      model: config.llmModel || 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }
  )

  if (res.status !== 200) {
    throw new Error(`LLM API 错误: ${res.status} - ${JSON.stringify(res.body)}`)
  }

  return res.body.choices?.[0]?.message?.content || ''
}

// ─── Stage 6: Triage 快筛 ─────────────────────────────────
async function llmTriage(notesWithDetails, sendLog) {
  const config = loadConfig()
  const targetCity = config.targetCity || '天津'
  const allResults = []

  for (let i = 0; i < notesWithDetails.length; i += TRIAGE_BATCH_SIZE) {
    const batch = notesWithDetails.slice(i, i + TRIAGE_BATCH_SIZE)

    const promptContent = batch.map((item) => {
      const content = (item.detail?.content || item.note.desc || '').substring(0, 100)
      return `ID:${item.note.id}|标题:${item.note.title || ''}|属地:${item.detail?.ipLocation || '未知'}|摘要:${content}`
    }).join('\n')

    const prompt = `快速判断以下小红书笔记是否可能有健身私教需求。目标城市：${targetCity}。
只需判断PASS（可能有需求）或REJECT（明显广告/无关/卖课）。

${promptContent}

返回JSON数组，无额外文字：
[{"id":"笔记ID","r":"PASS"}]`

    try {
      const text = await callLLM(prompt, { maxTokens: 500 })
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        allResults.push(...parsed)
      } else {
        // 解析失败 → 全部 PASS（安全兜底）
        batch.forEach(item => allResults.push({ id: item.note.id, r: 'PASS' }))
      }
    } catch (err) {
      if (sendLog) sendLog(`⚠️  Triage 快筛失败: ${err.message}，本批全部通过`, 'warn')
      batch.forEach(item => allResults.push({ id: item.note.id, r: 'PASS' }))
    }
  }

  return allResults
}

// ─── Stage 7: Deep Eval 深度评估 ──────────────────────────
async function deepEvaluate(notesWithDetails, sendLog) {
  const config = loadConfig()
  const targetCity = config.targetCity || '天津'
  const allResults = []

  for (let i = 0; i < notesWithDetails.length; i += DEEP_EVAL_BATCH_SIZE) {
    const batch = notesWithDetails.slice(i, i + DEEP_EVAL_BATCH_SIZE)

    const promptContent = batch.map((item) => {
      return `--- 笔记 ID: ${item.note.id} ---
【标题】${item.note.title || item.note.desc || ''}
【IP属地】${item.detail?.ipLocation || '未知'}
【搜索关键词】${item.note._keyword || ''}
【正文】${item.detail?.content || item.note.content || item.note.desc || ''}`
    }).join('\n\n')

    const prompt = `判断以下小红书笔记发布者是否有真实的健身私教需求，排除广告和卖课。
目标城市：${targetCity}，IP属地匹配的优先级更高，但IP不匹配不代表排除（可能用VPN或在外地）。

评分：S=急迫找私教,有具体需求 A=明确需求,积极询问 B=意向不明 C=广告/卖课/无关

${promptContent}

返回JSON数组，无额外文字：
[{"id":"笔记ID","score":"X","numericScore":0-100,"summary":"一句话需求","author_intent":"判断原因"}]`

    try {
      const text = await callLLM(prompt, { maxTokens: 1500 })
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        allResults.push(...JSON.parse(jsonMatch[0]))
      } else {
        batch.forEach(item => allResults.push({ id: item.note.id, score: 'B', summary: 'AI 返回格式无效' }))
      }
    } catch (err) {
      if (sendLog) sendLog(`⚠️  深度评估失败: ${err.message}`, 'warn')
      batch.forEach(item => allResults.push({ id: item.note.id, score: 'B', summary: 'AI 评估失败', author_intent: '' }))
    }
  }

  return allResults
}

// ─── 两阶段评估入口 ──────────────────────────────────────
async function batchEvaluateWithLLM(notesWithDetails, sendLog) {
  const config = loadConfig()

  if (notesWithDetails.length === 0) return []

  if (config.mockMode || !config.llmApiKey) {
    return notesWithDetails.map(item => ({
      id: item.note.id,
      ...heuristicEval(item)
    }))
  }

  if (notesWithDetails.length > 3) {
    // 两阶段模式
    if (sendLog) sendLog(`🔍 Triage 快筛 ${notesWithDetails.length} 条笔记...`, 'info')
    const triageResults = await llmTriage(notesWithDetails, sendLog)

    // 过滤出 PASS 的笔记
    const passIds = new Set(
      triageResults
        .filter(r => (r.r || '').toUpperCase() === 'PASS')
        .map(r => String(r.id))
    )

    const passedNotes = notesWithDetails.filter(item => passIds.has(String(item.note.id)))
    const rejectedCount = notesWithDetails.length - passedNotes.length

    if (sendLog) {
      sendLog(`🔍 Triage 结果: ${passedNotes.length} 条通过, ${rejectedCount} 条拒绝`, 'info')
    }

    if (passedNotes.length === 0) {
      return notesWithDetails.map(item => ({
        id: item.note.id, score: 'C', summary: 'Triage 快筛拒绝', author_intent: ''
      }))
    }

    // 深度评估通过的笔记
    if (sendLog) sendLog(`🤖 深度评估 ${passedNotes.length} 条笔记...`, 'info')
    const deepResults = await deepEvaluate(passedNotes, sendLog)

    // 合并结果：被拒绝的标记为 C
    const resultMap = new Map()
    for (const r of deepResults) {
      resultMap.set(String(r.id), r)
    }
    return notesWithDetails.map(item => {
      const id = String(item.note.id)
      if (resultMap.has(id)) return normalizeAssessment(resultMap.get(id), item)
      return { id: item.note.id, score: 'C', summary: 'Triage 快筛拒绝', author_intent: '' }
    })
  } else {
    // 单阶段模式（笔记数少时直接深度评估）
    const results = await deepEvaluate(notesWithDetails, sendLog)
    return notesWithDetails.map((item) => {
      const found = results.find((r) => String(r.id) === String(item.note.id))
      return normalizeAssessment(found, item)
    })
  }
}

function normalizeAssessment(raw, item) {
  const fallback = heuristicEval(item)
  if (!raw) return { id: item.note.id, ...fallback }
  const score = String(raw.score || fallback.score || 'B').toUpperCase()
  const numericScore = Number.isFinite(Number(raw.numericScore)) ? Number(raw.numericScore) : fallback.numericScore
  return {
    id: raw.id || item.note.id,
    score: ['S', 'A', 'B', 'C'].includes(score) ? score : fallback.score,
    numericScore,
    summary: raw.summary || fallback.summary,
    author_intent: raw.author_intent || raw.reason || fallback.author_intent,
  }
}

// ─── 线索写入中转 ─────────────────────────────────────────
async function syncLead(note, detail, assessment, sendLog) {
  const config = loadConfig()
  const { saveLeadToLocal } = require('./lead-storage.cjs')
  if (config.mockMode) {
    const ok = await saveLeadToLocal(note, detail, assessment)
    if (sendLog && ok) sendLog(`📊 [模拟] 线索已写入本地 CSV`, 'success')
    return ok
  }
  return await saveLeadToLocal(note, detail, assessment)
}

module.exports = {
  heuristicEval,
  llmTriage,
  deepEvaluate,
  batchEvaluateWithLLM,
  syncLead,
}
