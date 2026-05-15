import { ipcMain, type BrowserWindow } from 'electron'

let mainWindowRef: BrowserWindow | null = null

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
  })

  ipcMain.handle('stop-transcription', async () => {
    const { stopTranscription } = await import('./sttService')
    await stopTranscription()
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
}

export function registerWindowNotifiers(_mainWindow: BrowserWindow): void {
  mainWindowRef = _mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}
