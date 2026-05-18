import type { MemoryService } from './memory/memoryService'

export function buildMemoryHandlers(memory: Pick<
  MemoryService,
  | 'listMeetings'
  | 'getMeeting'
  | 'search'
  | 'renameMeeting'
  | 'deleteMeeting'
  | 'exportMeeting'
  | 'regenerateSummary'
>) {
  return {
    'memory:list-meetings': (args: { limit?: number; offset?: number } = {}) =>
      memory.listMeetings(args.limit, args.offset),
    'memory:get-meeting': (args: { id: string }) => memory.getMeeting(args.id),
    'memory:search': (args: { query: string; limit?: number }) => memory.search(args.query, args.limit),
    'memory:rename-meeting': (args: { id: string; title: string }) =>
      memory.renameMeeting(args.id, args.title),
    'memory:delete-meeting': (args: { id: string }) => memory.deleteMeeting(args.id),
    'memory:export-meeting': (args: { id: string; format: 'markdown' }) =>
      memory.exportMeeting(args.id, args.format),
    'memory:regenerate-summary': (args: { id: string }) => memory.regenerateSummary(args.id),
  }
}
