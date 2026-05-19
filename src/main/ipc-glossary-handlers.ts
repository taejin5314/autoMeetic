import { BrowserWindow } from 'electron'
import { bumpGlossaryEpoch } from './glossary/cache'
import type { MemoryRepository } from './memory/repository'
import type { GlossaryEntryInput } from './memory/types'

export type GlossaryRepoApi = Pick<
  MemoryRepository,
  'listGlossary' | 'upsertGlossary' | 'deleteGlossary' | 'activeGlossary'
>

type GetRepo = () => Promise<GlossaryRepoApi>
type GetCurrentMeetingId = () => string | null

function broadcastChanged(): void {
  bumpGlossaryEpoch()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('glossary:changed')
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
  }
}
