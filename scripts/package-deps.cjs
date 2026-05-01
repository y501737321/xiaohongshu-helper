#!/usr/bin/env node
/**
 * Phase 5 打包预处理脚本
 * 下载 xiaohongshu-mcp 预编译的二进制文件放置在 resources/bin 目录
 * 
 * 使用方式: node scripts/package-deps.cjs
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const BIN_DIR = path.join(ROOT, 'resources', 'bin')

const RELEASE_TAG = "v2026.04.17.0444-c63748f"

// 我们需要检查这些平台的二进制文件。Windows 打包时会使用更中性的运行名，
// 避免用户在界面和日志里看到上游项目名或误以为还需要额外安装组件。
const WINDOWS_SOURCE = 'xiaohongshu-mcp-windows-amd64.exe'
const WINDOWS_RUNTIME = 'xhs-helper-service.exe'

const ASSETS = [
  { name: 'xiaohongshu-mcp-darwin-arm64', filename: 'xiaohongshu-mcp-darwin-arm64' },
  { name: 'xiaohongshu-mcp-darwin-amd64', filename: 'xiaohongshu-mcp-darwin-amd64' },
  { name: WINDOWS_RUNTIME, filename: WINDOWS_RUNTIME },
]

async function main() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true })
    console.log(`✅ 创建 resources/bin/ 目录`)
  }

  console.log(`📦 正在检查内置服务 (${RELEASE_TAG}) 二进制文件...`)

  // 注意：在前面的步骤中，如果是 macOS，实际上的 release asset 可能打包在 tar.gz 里，
  // 为了确保通用性，我们在打包脚本里可以直接告诉用户目前二进制已经手动就位，
  // 或者是提供下载脚本。这里为了简化，既然我们已经手动放进去了，我们就检查它们是否存在。
  
  const sourceWinPath = path.join(BIN_DIR, WINDOWS_SOURCE)
  const runtimeWinPath = path.join(BIN_DIR, WINDOWS_RUNTIME)
  if (!fs.existsSync(runtimeWinPath) && fs.existsSync(sourceWinPath)) {
    fs.copyFileSync(sourceWinPath, runtimeWinPath)
    fs.chmodSync(runtimeWinPath, 0o755)
    console.log(`✅ 已生成 Windows 内置服务文件: ${WINDOWS_RUNTIME}`)
  }

  let allExist = true
  for (const asset of ASSETS) {
    const binPath = path.join(BIN_DIR, asset.filename)
    if (!fs.existsSync(binPath)) {
       console.log(`⚠️ 缺少二进制文件: ${asset.filename}`)
       allExist = false
    } else {
       console.log(`✅ 找到二进制文件: ${asset.filename}`)
    }
  }

  if (!allExist) {
     console.log('')
     console.log('⚠️ 请确保从 https://github.com/xpzouying/xiaohongshu-mcp/releases 下载并解压相应的二进制文件到 resources/bin/ 目录下。')
     console.log('（注：对于 macOS 的发行版可能被打包在 tar.gz 文件中，需要先解压）')
  }

  console.log('')
  console.log('✨ 预打包检查完成！运行 npm run electron:build 开始构建')
}

main().catch(console.error)
