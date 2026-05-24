import { buildPreloadApi } from './api'

// Electron exposes its runtime APIs through CommonJS in main/preload.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

contextBridge.exposeInMainWorld('electronAPI', buildPreloadApi(ipcRenderer))
