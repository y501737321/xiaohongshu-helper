// ─── 标题意向评分（Stage 2）──────────────────────────────
// 根据标题中的关键词信号评分，零 API 成本

const SEEKING_SIGNALS = [
  '求推荐', '想找', '有没有', '哪里', '怎么找', '推荐个', '介绍个',
  '靠谱', '求带', '多少钱', '多少', '求问', '有推荐', '想请', '帮忙推荐',
  '附近有', '哪家好', '求介绍', '想练', '想减', '想增肌', '想瘦',
  '需求', '急需', '急找', '求一个', '找一个', '求个', '找个',
  '谁有', '谁知道', '哪个好', '怎么选', '收费', '价格', '贵吗', '值吗',
]

const CONTENT_CREATOR_SIGNALS = [
  '分享', '教程', 'vlog', '打卡', '日常', '记录', '测评', '开箱',
]

const COMMERCIAL_SIGNALS = [
  '优惠', '课程', '报名', '加盟', '代理', '售价', '限时', '私信领',
  '引流', '变现', '月入', '副业', '免费领', '0元', '特价', '秒杀',
  '招生', '招学员', '教练培训', '考证', '认证班',
]

function scoreTitleIntent(title) {
  if (!title) return 0
  const text = title.toLowerCase()
  let score = 0

  for (const signal of SEEKING_SIGNALS) {
    if (text.includes(signal)) score += 3
  }
  for (const signal of CONTENT_CREATOR_SIGNALS) {
    if (text.includes(signal)) score -= 2
  }
  for (const signal of COMMERCIAL_SIGNALS) {
    if (text.includes(signal)) score -= 3
  }

  return score
}

// ─── 正文内容筛查（Stage 4）──────────────────────────────
// 获取详情后，对正文进行正则匹配，零 LLM 成本

const COMMERCIAL_BODY_PATTERNS = [
  /加v|加微|加我|私聊|扫码|二维码/,
  /\d+元|¥\d+|原价.*现价/,
  /课程体系|训练营|学员.*期/,
  /免费(试|体验)|限时(优惠|特价)/,
  /代理|加盟|招商/,
]

const SEEKING_BODY_PATTERNS = [
  /有推荐的吗|有没有推荐|求推荐/,
  /坐标.{1,4}(市|区)/,
  /预算|价格大概|多少钱|收费/,
  /想找.{0,4}(教练|私教|老师)/,
  /有没有.{0,4}(靠谱|好的|推荐)/,
]

function screenContentBody(content) {
  if (!content) return { pass: true, commercialHits: 0, seekingHits: 0 }

  let commercialHits = 0
  let seekingHits = 0

  for (const pattern of COMMERCIAL_BODY_PATTERNS) {
    if (pattern.test(content)) commercialHits++
  }
  for (const pattern of SEEKING_BODY_PATTERNS) {
    if (pattern.test(content)) seekingHits++
  }

  // 命中2+商业模式且0求助模式 → 判定为广告
  const pass = !(commercialHits >= 2 && seekingHits === 0)
  return { pass, commercialHits, seekingHits }
}

// ─── 地理相关性评分（Stage 5）──────────────────────────────

function computeGeoScore(ipLocation, targetCity) {
  if (!ipLocation) return 0.5 // 缺失 → 中立

  if (targetCity && ipLocation.includes(targetCity)) return 1.0

  return 0.2 // 远距离
}

// ─── 扩展广告词列表 ──────────────────────────────────────
const EXTENDED_AD_WORDS = [
  '接广告', '商务合作', '课程售价', '原价', '限时优惠', '私信领取',
  '代理加盟', '学员招募', '训练营报名', '品牌方',
  '引流', '变现', '月入', '副业', '兼职', '免费领', '扫码领',
  '0元', '特价', '秒杀', '招生', '招学员', '教练培训', '考证', '认证班',
]

module.exports = {
  SEEKING_SIGNALS,
  CONTENT_CREATOR_SIGNALS,
  COMMERCIAL_SIGNALS,
  EXTENDED_AD_WORDS,
  scoreTitleIntent,
  screenContentBody,
  computeGeoScore,
}
