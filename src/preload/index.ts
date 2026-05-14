import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from './types'

function createEventListener(channel: string) {
  return (callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const electronAPI: ElectronAPI = {
  // Actions
  translate: (text, targetLang) => ipcRenderer.invoke('translate', { text, targetLang }),
  startAnswerAssist: (transcript, lang) =>
    ipcRenderer.invoke('start-answer-assist', { transcript, lang }),
  resetActionItems: () => ipcRenderer.invoke('reset-action-items'),
  updateVocabulary: (keywords) => ipcRenderer.invoke('update-vocabulary', { keywords }),
  checkHealth: () => ipcRenderer.invoke('check-health'),
  setTranscriptLanguages: (args) => ipcRenderer.invoke('stt:set-languages', args),

  // Audio/STT
  startTranscription: (language) => ipcRenderer.invoke('start-transcription', { language }),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  resetTranscriptPostProcessor: () => ipcRenderer.invoke('reset-transcript-postprocessor'),
  sendAudio: (base64Chunk) => ipcRenderer.send('send-audio', { chunk: base64Chunk }),

  // Whiteboard
  sendWhiteboardElements: (elements) => ipcRenderer.send('whiteboard:user-elements', { elements }),
  sendWhiteboardScreenshot: (imageDataUrl) =>
    ipcRenderer.send('whiteboard:screenshot', { image: imageDataUrl }),

  // Events
  onSttReady: createEventListener('stt:ready') as ElectronAPI['onSttReady'],
  onSttPartial: createEventListener('stt:partial') as ElectronAPI['onSttPartial'],
  onSttCommitted: createEventListener('stt:committed') as ElectronAPI['onSttCommitted'],
  onSttProcessed: createEventListener('stt:processed') as ElectronAPI['onSttProcessed'],
  onSttError: createEventListener('stt:error') as ElectronAPI['onSttError'],
  onWhiteboardUpdate: createEventListener('whiteboard:update') as ElectronAPI['onWhiteboardUpdate'],
  onWhiteboardViewport: createEventListener(
    'whiteboard:viewport'
  ) as ElectronAPI['onWhiteboardViewport'],
  onWhiteboardAgentStatus: createEventListener(
    'whiteboard:agent-status'
  ) as ElectronAPI['onWhiteboardAgentStatus'],
  onAnswerAssistEvent: createEventListener(
    'answer-assist:event'
  ) as ElectronAPI['onAnswerAssistEvent'],
  onActionItemsSuggested: createEventListener(
    'actions:suggested'
  ) as ElectronAPI['onActionItemsSuggested'],
  onActionItemsReset: createEventListener('actions:reset') as ElectronAPI['onActionItemsReset'],
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
