import type { MemoryService } from './memory/memoryService'
import type { ExportLanguageMode } from './memory/markdownExporter'
import { runDeepAsk } from './memory/deepAskService'
import type { ChatMessage } from './memory/types'
import type { DeepAskEvent } from './memory/agents/types'

export type MemoryHandlerApi = Pick<
  MemoryService,
  | 'listMeetings'
  | 'getMeeting'
  | 'search'
  | 'renameMeeting'
  | 'deleteMeeting'
  | 'exportMeeting'
  | 'regenerateSummary'
  | 'activeGlossary'
>

type GetMemory = () => Promise<MemoryHandlerApi>

async function getReadyMemory(getMemory: GetMemory): Promise<MemoryHandlerApi> {
  try {
    return await getMemory()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Memory service failed to initialize: ${message}`, { cause: err })
  }
}

export function buildMemoryHandlers(getMemory: GetMemory) {
  return {
    'memory:list-meetings': async (args: { limit?: number; offset?: number } = {}) => {
      const memory = await getReadyMemory(getMemory)
      return memory.listMeetings(args.limit, args.offset)
    },
    'memory:get-meeting': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.getMeeting(args.id)
    },
    'memory:search': async (args: { query: string; limit?: number }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.search(args.query, args.limit)
    },
    'memory:rename-meeting': async (args: { id: string; title: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.renameMeeting(args.id, args.title)
    },
    'memory:delete-meeting': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.deleteMeeting(args.id)
    },
    'memory:export-meeting': async (args: {
      id: string
      format: 'markdown'
      language?: ExportLanguageMode
    }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.exportMeeting(args.id, args.format, args.language)
    },
    'memory:regenerate-summary': async (args: { id: string }) => {
      const memory = await getReadyMemory(getMemory)
      return memory.regenerateSummary(args.id)
    },
  }
}

export function buildMemoryDeepAskHandler(
  getMemory: GetMemory,
  sendEvent: (channel: string, payload: DeepAskEvent) => void
) {
  return async (args: { question: string; history: ChatMessage[] }): Promise<void> => {
    const memory = await getReadyMemory(getMemory)
    await runDeepAsk(args, (event) => sendEvent('memory:deep-ask:event', event), { memory })
  }
}
