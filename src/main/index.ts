import 'dotenv/config'
import type { BrowserWindow as BrowserWindowType, Tray as TrayType } from 'electron'
import { join } from 'path'
import { registerIpcHandlers, registerWindowNotifiers, setMemoryServicePromise } from './ipc'
import { init as initActionItems } from './actionItemService'
import { MemoryService, defaultWorkerPath } from './memory/memoryService'
import { init as initTranscriptPostProcessor } from './transcriptPostProcessor'
import { init as initWhiteboard } from './whiteboardService'

const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  // Electron exposes its runtime APIs through CommonJS in main/preload.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('electron') as typeof import('electron')

let mainWindow: BrowserWindowType | null = null
let tray: TrayType | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
    },
  })

  // Allow getDisplayMedia in renderer — pick all screens + audio
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' })
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Forward renderer console to terminal
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = ['VERBOSE', 'LOG', 'WARN', 'ERROR'][level] ?? 'LOG'
    const src = sourceId ? ` (${sourceId}:${line})` : ''
    console.log(`[renderer:${tag}] ${message}${src}`)
  })

  // F12 to toggle DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      event.preventDefault()
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev: load from Vite dev server. Prod: load built renderer HTML.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('AutoMeetic')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray = null
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function registerGlobalShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('shortcut:toggle-capture')
  })

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    mainWindow?.webContents.send('shortcut:toggle-overlay')
  })
}

app.whenReady().then(() => {
  createWindow()
  const userData = app.getPath('userData')
  setMemoryServicePromise(
    MemoryService.initialize({
      dbPath: join(userData, 'memory.db'),
      workerPath: defaultWorkerPath(),
      modelEnvCacheDir: join(userData, 'embedding-cache'),
    })
      .then((memoryService) => {
        const recovered = memoryService.recoverInterruptedMeetings()
        if (recovered > 0) console.log(`[memory] recovered ${recovered} interrupted meeting(s)`)
        return memoryService
      })
      .catch((err) => {
        console.error('[memory] init failed:', err)
        throw err
      })
  )
  registerIpcHandlers(mainWindow!)
  registerWindowNotifiers(mainWindow!)
  initWhiteboard(mainWindow!)
  initTranscriptPostProcessor(mainWindow!)
  initActionItems(mainWindow!)
  createTray()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('uncaughtException', (err) => {
  console.error('[main:UNCAUGHT]', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main:UNHANDLED_REJECTION]', reason)
})
