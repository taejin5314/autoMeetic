import { BrowserWindow } from 'electron'
import { bumpGlossaryEpoch } from './glossary/cache'
import type { MemoryRepository } from './memory/repository'
import type { GlossaryEntryInput } from './memory/types'

export type GlossaryRepoApi = Pick<
  MemoryRepository,
  | 'listGlossary'
  | 'upsertGlossary'
  | 'deleteGlossary'
  | 'activeGlossary'
  | 'listSuggestionsByMeeting'
  | 'listAllPendingSuggestions'
  | 'countPendingSuggestions'
  | 'acceptSuggestion'
  | 'dismissSuggestion'
>

type GetRepo = () => Promise<GlossaryRepoApi>
type GetCurrentMeetingId = () => string | null

function broadcastChanged(): void {
  bumpGlossaryEpoch()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:changed')
  }
}

function broadcastSuggestionsUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:suggestions-updated')
  }
}

function broadcastMeetingUpdated(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('memory:meeting-updated')
  }
}

async function getReady<T>(getter: () => Promise<T>, label: string): Promise<T> {
  try {
    return await getter()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} failed to initialize: ${message}`, { cause: err })
  }
}

export function buildGlossaryHandlers(getRepo: GetRepo, getCurrentMeetingId: GetCurrentMeetingId) {
  return {
    'glossary:list': async (args: { scope: 'global' | 'meeting'; meetingId?: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      return repo.listGlossary(args.scope, args.meetingId)
    },
    'glossary:upsert': async (args: { entry: GlossaryEntryInput }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const result = repo.upsertGlossary(args.entry)
      broadcastChanged()
      return result
    },
    'glossary:delete': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      repo.deleteGlossary(args.id)
      broadcastChanged()
    },
    'glossary:active': async (args: { meetingId?: string } = {}) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const id = args.meetingId ?? getCurrentMeetingId()
      return repo.activeGlossary(id)
    },
    'glossary:suggestions:list': async (args: { meetingId?: string } = {}) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      if (args.meetingId) return repo.listSuggestionsByMeeting(args.meetingId)
      return repo.listAllPendingSuggestions()
    },
    'glossary:suggestions:accept': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const entry = repo.acceptSuggestion(args.id)
      broadcastChanged()
      broadcastSuggestionsUpdated()
      broadcastMeetingUpdated()
      return entry
    },
    'glossary:suggestions:dismiss': async (args: { id: string }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      repo.dismissSuggestion(args.id)
      broadcastSuggestionsUpdated()
    },
    'glossary:suggestions:bulk-accept': async (args: { ids: string[] }) => {
      const repo = await getReady(getRepo, 'Glossary repo')
      const accepted: string[] = []
      const failed: Array<{ id: string; error: string }> = []
      for (const id of args.ids) {
        try {
          repo.acceptSuggestion(id)
          accepted.push(id)
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      broadcastChanged()
      broadcastSuggestionsUpdated()
      broadcastMeetingUpdated()
      return { accepted, failed }
    },
    'glossary:suggestions:count': async () => {
      const repo = await getReady(getRepo, 'Glossary repo')
      return repo.countPendingSuggestions()
    },
  }
}
