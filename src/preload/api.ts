import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { ElectronAPI } from './types'

type IpcRendererLike = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener' | 'send'>

function createEventListener(ipcRenderer: IpcRendererLike, channel: string) {
  return (callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

export function buildPreloadApi(ipcRenderer: IpcRendererLike): ElectronAPI {
  const listen = (channel: string) => createEventListener(ipcRenderer, channel)

  return {
    system: {
      getLocale: () => ipcRenderer.invoke('system:get-locale'),
    },
    memory: {
      listMeetings: (args = {}) => ipcRenderer.invoke('memory:list-meetings', args),
      getMeeting: (id) => ipcRenderer.invoke('memory:get-meeting', { id }),
      search: (query, limit) => ipcRenderer.invoke('memory:search', { query, limit }),
      renameMeeting: (id, title) => ipcRenderer.invoke('memory:rename-meeting', { id, title }),
      deleteMeeting: (id) => ipcRenderer.invoke('memory:delete-meeting', { id }),
      exportMeeting: (id, format = 'markdown', language = 'both') =>
        ipcRenderer.invoke('memory:export-meeting', { id, format, language }),
      regenerateSummary: (id) => ipcRenderer.invoke('memory:regenerate-summary', { id }),
      chat: (args) => ipcRenderer.invoke('memory:chat', args),
      deepAsk: (args) => ipcRenderer.invoke('memory:deep-ask', args),
      onMeetingUpdated: listen('memory:meeting-updated') as ElectronAPI['memory']['onMeetingUpdated'],
      onChatEvent: listen('memory:chat:event') as ElectronAPI['memory']['onChatEvent'],
      onDeepAskEvent: listen(
        'memory:deep-ask:event'
      ) as ElectronAPI['memory']['onDeepAskEvent'],
    },
    glossary: {
      list: (scope, meetingId) => ipcRenderer.invoke('glossary:list', { scope, meetingId }),
      upsert: (entry) => ipcRenderer.invoke('glossary:upsert', { entry }),
      delete: (id) => ipcRenderer.invoke('glossary:delete', { id }),
      active: (meetingId) => ipcRenderer.invoke('glossary:active', { meetingId }),
      findVariants: (canonical) => ipcRenderer.invoke('glossary:find-variants', { canonical }),
      onChanged: listen('glossary:changed') as ElectronAPI['glossary']['onChanged'],
      onEntriesUpdated: listen(
        'glossary:entries-updated'
      ) as ElectronAPI['glossary']['onEntriesUpdated'],
      suggestions: {
        list: (meetingId) => ipcRenderer.invoke('glossary:suggestions:list', { meetingId }),
        accept: (id) => ipcRenderer.invoke('glossary:suggestions:accept', { id }),
        dismiss: (id) => ipcRenderer.invoke('glossary:suggestions:dismiss', { id }),
        bulkAccept: (ids) => ipcRenderer.invoke('glossary:suggestions:bulk-accept', { ids }),
        count: () => ipcRenderer.invoke('glossary:suggestions:count'),
        onUpdated: listen(
          'glossary:suggestions-updated'
        ) as ElectronAPI['glossary']['suggestions']['onUpdated'],
      },
    },

    translate: (text, targetLang) => ipcRenderer.invoke('translate', { text, targetLang }),
    startAnswerAssist: (transcript, sourceLang, targetLang, glossary) =>
      ipcRenderer.invoke('start-answer-assist', { transcript, sourceLang, targetLang, glossary }),
    resetActionItems: () => ipcRenderer.invoke('reset-action-items'),
    resetWhiteboard: () => ipcRenderer.invoke('reset-whiteboard'),
    updateVocabulary: (keywords) => ipcRenderer.invoke('update-vocabulary', { keywords }),
    checkHealth: () => ipcRenderer.invoke('check-health'),
    setTranscriptLanguages: (args) => ipcRenderer.invoke('stt:set-languages', args),

    startTranscription: (language) => ipcRenderer.invoke('start-transcription', { language }),
    stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
    resetTranscriptPostProcessor: () => ipcRenderer.invoke('reset-transcript-postprocessor'),
    sendAudio: (base64Chunk) => ipcRenderer.send('send-audio', { chunk: base64Chunk }),

    sendWhiteboardElements: (elements) => ipcRenderer.send('whiteboard:user-elements', { elements }),
    sendWhiteboardScreenshot: (imageDataUrl) =>
      ipcRenderer.send('whiteboard:screenshot', { image: imageDataUrl }),
    whiteboard: {
      setLabelLanguage: (code: string | null) =>
        ipcRenderer.invoke('whiteboard:set-label-language', { code }),
      setMode: (mode: 'freeform' | 'mindmap') =>
        ipcRenderer.invoke('whiteboard:set-mode', { mode }),
      createMindMapFromAsk: (payload) =>
        ipcRenderer.invoke('whiteboard:create-mindmap-from-ask', payload),
    },

    onSttReady: listen('stt:ready') as ElectronAPI['onSttReady'],
    onSttPartial: listen('stt:partial') as ElectronAPI['onSttPartial'],
    onSttCommitted: listen('stt:committed') as ElectronAPI['onSttCommitted'],
    onSttProcessed: listen('stt:processed') as ElectronAPI['onSttProcessed'],
    onSttSourcePatch: listen('stt:source-patch') as ElectronAPI['onSttSourcePatch'],
    onSttTranslationPatch: listen(
      'stt:translation-patch'
    ) as ElectronAPI['onSttTranslationPatch'],
    onSttError: listen('stt:error') as ElectronAPI['onSttError'],
    onWhiteboardUpdate: listen('whiteboard:update') as ElectronAPI['onWhiteboardUpdate'],
    onWhiteboardViewport: listen('whiteboard:viewport') as ElectronAPI['onWhiteboardViewport'],
    onWhiteboardAgentStatus: listen(
      'whiteboard:agent-status'
    ) as ElectronAPI['onWhiteboardAgentStatus'],
    onAnswerAssistEvent: listen('answer-assist:event') as ElectronAPI['onAnswerAssistEvent'],
    onActionItemsSuggested: listen('actions:suggested') as ElectronAPI['onActionItemsSuggested'],
    onActionItemsReset: listen('actions:reset') as ElectronAPI['onActionItemsReset'],
  }
}
