import type { BrowserWindow } from 'electron'
import { buildMemoryHandlers } from './ipc-memory-handlers'
import { resolveMeetingLanguages, type TranscriptLanguageState } from './memory/meetingLanguages'
import type { MemoryService } from './memory/memoryService'

// Electron exposes its runtime APIs through CommonJS in main/preload.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcMain } = require('electron') as typeof import('electron')

let mainWindowRef: BrowserWindow | null = null
let memoryServiceRef: MemoryService | null = null
let memoryServicePromise: Promise<MemoryService> | null = null
let unsubscribeMemoryUpdates: (() => void) | null = null
let transcriptLanguages: TranscriptLanguageState = { sourceLanguage: 'auto', targetLanguage: 'off' }

export function setMemoryService(svc: MemoryService): void {
  memoryServiceRef = svc
  unsubscribeMemoryUpdates?.()
  unsubscribeMemoryUpdates = svc.onMeetingUpdated((evt) => {
    mainWindowRef?.webContents.send('memory:meeting-updated', evt)
  })
}

export function setMemoryServicePromise(promise: Promise<MemoryService>): void {
  memoryServicePromise = promise.then((svc) => {
    setMemoryService(svc)
    return svc
  })
}

async function getMemoryService(): Promise<MemoryService> {
  if (memoryServiceRef) return memoryServiceRef
  if (!memoryServicePromise) throw new Error('Memory service startup was not scheduled')
  return memoryServicePromise
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  // Translation
  ipcMain.handle('translate', async (_event, args: { text: string; targetLang: string }) => {
    const { translateText } = await import('./proxyService')
    return translateText(args.text, args.targetLang)
  })

  // Health
  ipcMain.handle('check-health', () => {
    return { status: 'ok', ts: Date.now() }
  })

  // Vocabulary
  ipcMain.handle('update-vocabulary', async (_event, args: { keywords: string[] }) => {
    const { updateVocabulary } = await import('./proxyService')
    return updateVocabulary(args.keywords)
  })

  // Answer assist
  ipcMain.handle(
    'start-answer-assist',
    async (
      _event,
      args: { transcript: string; sourceLang: string; targetLang: string }
    ) => {
      const { startAnswerAssist } = await import('./proxyService')
      await startAnswerAssist(
        args.transcript,
        args.sourceLang,
        args.targetLang,
        (event: unknown) => {
          mainWindowRef?.webContents.send('answer-assist:event', event)
        }
      )
    }
  )

  // STT
  ipcMain.handle('start-transcription', async (_event, args: { language: string }) => {
    const { startTranscription } = await import('./sttService')
    startTranscription(args.language, mainWindowRef!)
    void getMemoryService()
      .then((memory) => {
        memory.beginMeeting(resolveMeetingLanguages(args.language, transcriptLanguages))
      })
      .catch((err) => {
        console.error('[memory] begin meeting failed:', err)
      })
  })

  ipcMain.handle('stop-transcription', async () => {
    const { stopTranscription } = await import('./sttService')
    await stopTranscription()
    await getMemoryService()
      .then((memory) => memory.endMeeting(3000))
      .catch((err) => {
        console.error('[memory] end meeting failed:', err)
      })
  })

  ipcMain.handle('reset-transcript-postprocessor', async () => {
    const { resetTranscriptPostProcessor } = await import('./transcriptPostProcessor')
    resetTranscriptPostProcessor()
  })

  ipcMain.handle('reset-action-items', async () => {
    const { resetActionItems } = await import('./actionItemService')
    resetActionItems()
  })

  ipcMain.handle('reset-whiteboard', async () => {
    const { resetWhiteboard } = await import('./whiteboardService')
    resetWhiteboard()
  })

  ipcMain.handle(
    'stt:set-languages',
    (_event, args: { sourceLanguage: string; targetLanguage: string }) => {
      transcriptLanguages = {
        sourceLanguage: args.sourceLanguage || 'auto',
        targetLanguage: args.targetLanguage || 'off',
      }
      void import('./sttService').then(({ setPostProcessorLanguages }) => {
        setPostProcessorLanguages(args)
      })
    }
  )

  ipcMain.on('send-audio', (_event, args: { chunk: string }) => {
    void import('./sttService').then(({ sendAudioChunk }) => {
      sendAudioChunk(args.chunk)
    })
  })

  // Whiteboard
  ipcMain.on('whiteboard:user-elements', (_event, args: { elements: unknown[] }) => {
    void import('./whiteboardService').then(({ handleUserElements }) => {
      handleUserElements(args.elements, mainWindowRef!)
    })
  })

  ipcMain.on('whiteboard:screenshot', (_event, args: { image: string }) => {
    void import('./whiteboardService').then(({ handleScreenshot }) => {
      handleScreenshot(args.image)
    })
  })

  const memHandlers = buildMemoryHandlers(getMemoryService)
  for (const [channel, handler] of Object.entries(memHandlers)) {
    ipcMain.handle(channel, async (_event, args) => handler(args as never))
  }
}

export function registerWindowNotifiers(_mainWindow: BrowserWindow): void {
  mainWindowRef = _mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}
