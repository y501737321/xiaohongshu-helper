#!/usr/bin/env node
/**
 * Phase 5 打包预处理脚本
 * 将 Python 脚本打包为可执行文件放置在 resources/bin 目录
 * 
 * 使用方式: node scripts/package-deps.cjs
 * 
 * 前置条件:
 *   - pip install pyinstaller xiaohongshu-skills
 *   - 确保 xiaohongshu_wrapper.py 存在于 scripts/ 目录
 */
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const BIN_DIR = path.join(ROOT, 'resources', 'bin')

function run(cmd) {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd}`)
    exec(cmd, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) {
        console.error(stderr)
        reject(err)
      } else {
        console.log(stdout)
        resolve(stdout)
      }
    })
  })
}

async function main() {
  // 确保目录存在
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true })
    console.log(`✅ 创建 resources/bin/ 目录`)
  }

  // 1. 检查 PyInstaller
  try {
    await run('pyinstaller --version')
  } catch {
    console.log('⚠️  PyInstaller 未安装，跳过 Python 打包')
    console.log('   如需打包 Python 环境，请先运行: pip install pyinstaller')
    return
  }

  // 2. 打包 Python 包装器
  const wrapperScript = path.join(__dirname, 'xiaohongshu_wrapper.py')
  if (fs.existsSync(wrapperScript)) {
    console.log('📦 正在使用 PyInstaller 打包 Python 脚本...')
    await run(
      `pyinstaller --onefile --name xhs_runner --distpath ${BIN_DIR} ${wrapperScript}`
    )
    console.log(`✅ xhs_runner 已打包至 ${BIN_DIR}`)
  } else {
    console.log(`ℹ️  ${wrapperScript} 不存在，跳过 Python 打包`)
  }

  console.log('\n✨ 预打包完成！运行 npm run electron:build 开始构建')
}

main().catch(console.error)
