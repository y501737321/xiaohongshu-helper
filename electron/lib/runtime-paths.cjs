const path = require('path')

function getElectronApp() {
  try {
    const electron = require('electron')
    return electron && typeof electron === 'object' ? electron.app : null
  } catch (_) {
    return null
  }
}

function getUserDataPath() {
  const app = getElectronApp()
  if (app && typeof app.getPath === 'function') {
    return app.getPath('userData')
  }

  return process.env.XHS_HELPER_DATA_DIR || path.join(process.cwd(), '.local-data')
}

function isPackaged() {
  const app = getElectronApp()
  return !!(app && app.isPackaged)
}

function getResourcesPath() {
  return process.resourcesPath || path.join(process.cwd(), 'resources')
}

module.exports = {
  getElectronApp,
  getUserDataPath,
  isPackaged,
  getResourcesPath,
}
