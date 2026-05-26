import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../main/memory/types'
import { runDeepAsk } from '../main/memory/deepAskService'
import { buildMemoryDeepAskHandler, type MemoryHandlerApi } from '../main/ipc-memory-handlers'

vi.mock('../main/memory/deepAskService', () => ({ runDeepAsk: vi.fn() }))

const memory = {
  listMeetings: () => [],
  getMeeting: () => null,
  search: async () => [],
  activeGlossary: () => [],
  renameMeeting: () => undefined,
  deleteMeeting: () => undefined,
  exportMeeting: () => '# export',
  regenerateSummary: async () => undefined,
} satisfies MemoryHandlerApi

describe('memory:deep-ask IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes runDeepAsk and forwards done events', async () => {
    const send = vi.fn()
    vi.mocked(runDeepAsk).mockImplementationOnce(async (_args, emit) => {
      emit({ type: 'done', answer: 'a', sources: [], costBreakdown: {} as never, durationMs: 10 })
    })
    const handler = buildMemoryDeepAskHandler(async () => memory, send)
    const history: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'old', createdAt: 1 }]

    await handler({ question: 'q', history })

    expect(runDeepAsk).toHaveBeenCalledWith({ question: 'q', history }, expect.any(Function), {
      memory,
    })
    expect(send).toHaveBeenCalledWith('memory:deep-ask:event', {
      type: 'done',
      answer: 'a',
      sources: [],
      costBreakdown: {},
      durationMs: 10,
    })
  })

  it('forwards gate-denied events', async () => {
    const send = vi.fn()
    vi.mocked(runDeepAsk).mockImplementationOnce(async (_args, emit) => {
      emit({ type: 'gate-denied', reason: 'nope' })
    })
    const handler = buildMemoryDeepAskHandler(async () => memory, send)

    await handler({ question: 'q', history: [] })

    expect(send).toHaveBeenCalledWith('memory:deep-ask:event', {
      type: 'gate-denied',
      reason: 'nope',
    })
  })

  it('forwards error events', async () => {
    const send = vi.fn()
    vi.mocked(runDeepAsk).mockImplementationOnce(async (_args, emit) => {
      emit({ type: 'error', message: 'boom', phase: 'lead' })
    })
    const handler = buildMemoryDeepAskHandler(async () => memory, send)

    await handler({ question: 'q', history: [] })

    expect(send).toHaveBeenCalledWith('memory:deep-ask:event', {
      type: 'error',
      message: 'boom',
      phase: 'lead',
    })
  })
})

describe('memory deep ask preload bridge', () => {
  it('exposes memory.deepAsk through the memory:deep-ask invoke channel', async () => {
    const { buildPreloadApi } = await import('../preload/api')
    const ipcInvoke = vi.fn()
    const api = buildPreloadApi({
      invoke: ipcInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    })
    const args = { question: 'q', history: [] }

    await api.memory.deepAsk(args)

    expect(ipcInvoke).toHaveBeenCalledWith('memory:deep-ask', args)
  })

  it('exposes memory.onDeepAskEvent as a memory:deep-ask:event listener', async () => {
    const { buildPreloadApi } = await import('../preload/api')
    const ipcOn = vi.fn()
    const ipcRemoveListener = vi.fn()
    const api = buildPreloadApi({
      invoke: vi.fn(),
      on: ipcOn,
      removeListener: ipcRemoveListener,
      send: vi.fn(),
    })
    const handler = vi.fn()

    const unsubscribe = api.memory.onDeepAskEvent(handler)
    const listener = ipcOn.mock.calls[0][1] as (_event: unknown, payload: unknown) => void
    listener({}, { type: 'delta', content: 'x' })
    unsubscribe()

    expect(ipcOn).toHaveBeenCalledWith('memory:deep-ask:event', expect.any(Function))
    expect(handler).toHaveBeenCalledWith({ type: 'delta', content: 'x' })
    expect(ipcRemoveListener).toHaveBeenCalledWith('memory:deep-ask:event', listener)
  })
})
