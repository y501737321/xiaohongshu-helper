#!/usr/bin/env node
/**
 * 开发启动脚本：先启动 Vite，等待就绪后再启动 Electron
 * 确保 VITE_DEV_SERVER_URL 环境变量正确传递给 Electron 进程
 */
const { spawn } = require('child_process')
const http = require('http')

const DEV_URL = 'http://localhost:5173'
const MAX_WAIT_MS = 30000

function waitForUrl(url, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode < 500) resolve()
        else retry()
      }).on('error', retry)
    }
    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`等待 ${url} 超时`))
      } else {
        setTimeout(check, 500)
      }
    }
    check()
  })
}

// 启动 Vite
const vite = spawn('npx', ['vite', '--port', '5173'], {
  stdio: 'inherit',
  env: { ...process.env },
})

vite.on('error', (err) => console.error('Vite 启动失败:', err))

// 等待 Vite 就绪，再启动 Electron
waitForUrl(DEV_URL, MAX_WAIT_MS)
  .then(() => {
    console.log(`\n✅ Vite 已就绪，正在启动 Electron...\n`)
    const electron = spawn(
      require('electron'),
      ['.'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          VITE_DEV_SERVER_URL: DEV_URL,
        },
      }
    )
    electron.on('close', () => {
      vite.kill()
      process.exit(0)
    })
  })
  .catch((err) => {
    console.error(err.message)
    vite.kill()
    process.exit(1)
  })

process.on('SIGINT', () => {
  vite.kill()
  process.exit(0)
})
