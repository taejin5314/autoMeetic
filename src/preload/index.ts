import type { ElectronAPI } from './types'

// Electron exposes its runtime APIs through CommonJS in main/preload.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

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
  memory: {
    listMeetings: (args = {}) => ipcRenderer.invoke('memory:list-meetings', args),
    getMeeting: (id) => ipcRenderer.invoke('memory:get-meeting', { id }),
    search: (query, limit) => ipcRenderer.invoke('memory:search', { query, limit }),
    renameMeeting: (id, title) => ipcRenderer.invoke('memory:rename-meeting', { id, title }),
    deleteMeeting: (id) => ipcRenderer.invoke('memory:delete-meeting', { id }),
    exportMeeting: (id, format = 'markdown', language = 'both') =>
      ipcRenderer.invoke('memory:export-meeting', { id, format, language }),
    regenerateSummary: (id) => ipcRenderer.invoke('memory:regenerate-summary', { id }),
    onMeetingUpdated: createEventListener(
      'memory:meeting-updated'
    ) as ElectronAPI['memory']['onMeetingUpdated'],
  },
  glossary: {
    list: (scope, meetingId) => ipcRenderer.invoke('glossary:list', { scope, meetingId }),
    upsert: (entry) => ipcRenderer.invoke('glossary:upsert', { entry }),
    delete: (id) => ipcRenderer.invoke('glossary:delete', { id }),
    active: (meetingId) => ipcRenderer.invoke('glossary:active', { meetingId }),
    onChanged: createEventListener('glossary:changed') as ElectronAPI['glossary']['onChanged'],
    suggestions: {
      list: (meetingId) => ipcRenderer.invoke('glossary:suggestions:list', { meetingId }),
      accept: (id) => ipcRenderer.invoke('glossary:suggestions:accept', { id }),
      dismiss: (id) => ipcRenderer.invoke('glossary:suggestions:dismiss', { id }),
      bulkAccept: (ids) => ipcRenderer.invoke('glossary:suggestions:bulk-accept', { ids }),
      count: () => ipcRenderer.invoke('glossary:suggestions:count'),
      onUpdated: createEventListener(
        'glossary:suggestions-updated'
      ) as ElectronAPI['glossary']['suggestions']['onUpdated'],
    },
  },

  // Actions
  translate: (text, targetLang) => ipcRenderer.invoke('translate', { text, targetLang }),
  startAnswerAssist: (transcript, sourceLang, targetLang, glossary) =>
    ipcRenderer.invoke('start-answer-assist', { transcript, sourceLang, targetLang, glossary }),
  resetActionItems: () => ipcRenderer.invoke('reset-action-items'),
  resetWhiteboard: () => ipcRenderer.invoke('reset-whiteboard'),
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
  whiteboard: {
    setLabelLanguage: (code: string | null) =>
      ipcRenderer.invoke('whiteboard:set-label-language', { code }),
    setMode: (mode: 'freeform' | 'mindmap') =>
      ipcRenderer.invoke('whiteboard:set-mode', { mode }),
  },

  // Events
  onSttReady: createEventListener('stt:ready') as ElectronAPI['onSttReady'],
  onSttPartial: createEventListener('stt:partial') as ElectronAPI['onSttPartial'],
  onSttCommitted: createEventListener('stt:committed') as ElectronAPI['onSttCommitted'],
  onSttProcessed: createEventListener('stt:processed') as ElectronAPI['onSttProcessed'],
  onSttSourcePatch: createEventListener('stt:source-patch') as ElectronAPI['onSttSourcePatch'],
  onSttTranslationPatch: createEventListener(
    'stt:translation-patch'
  ) as ElectronAPI['onSttTranslationPatch'],
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
