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
  updateVocabulary: (keywords) => ipcRenderer.invoke('update-vocabulary', { keywords }),
  checkHealth: () => ipcRenderer.invoke('check-health'),

  // Audio/STT
  startTranscription: (language) => ipcRenderer.invoke('start-transcription', { language }),
  stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
  sendAudio: (base64Chunk) => ipcRenderer.send('send-audio', { chunk: base64Chunk }),

  // Whiteboard
  sendWhiteboardElements: (elements) =>
    ipcRenderer.send('whiteboard:user-elements', { elements }),
  sendWhiteboardScreenshot: (imageDataUrl) =>
    ipcRenderer.send('whiteboard:screenshot', { image: imageDataUrl }),

  // Events
  onSttPartial: createEventListener('stt:partial') as ElectronAPI['onSttPartial'],
  onSttCommitted: createEventListener('stt:committed') as ElectronAPI['onSttCommitted'],
  onSttError: createEventListener('stt:error') as ElectronAPI['onSttError'],
  onWhiteboardUpdate: createEventListener('whiteboard:update') as ElectronAPI['onWhiteboardUpdate'],
  onWhiteboardViewport: createEventListener('whiteboard:viewport') as ElectronAPI['onWhiteboardViewport'],
  onWhiteboardAgentStatus: createEventListener('whiteboard:agent-status') as ElectronAPI['onWhiteboardAgentStatus'],
  onAnswerAssistEvent: createEventListener('answer-assist:event') as ElectronAPI['onAnswerAssistEvent'],
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
