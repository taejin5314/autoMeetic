import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, GlossaryEntry, SearchHit } from '../main/memory/types'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  ipcInvoke: vi.fn(),
  ipcOn: vi.fn(),
  ipcRemoveListener: vi.fn(),
  exposeInMainWorld: vi.fn(),
  runChat: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.ipcHandle,
  },
  ipcRenderer: {
    invoke: mocks.ipcInvoke,
    on: mocks.ipcOn,
    removeListener: mocks.ipcRemoveListener,
  },
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
}))

vi.mock('../main/memory/chatService', () => ({
  runChat: mocks.runChat,
}))

import { buildMemoryChatHandler } from '../main/ipc'

interface FakeMemory {
  search(query: string, limit: number): Promise<SearchHit[]>
  activeGlossary(meetingId: string | null): GlossaryEntry[]
}

function makeMemory(): FakeMemory {
  return {
    search: vi.fn(async () => []),
    activeGlossary: vi.fn(() => []),
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.ipcHandle.mockReset()
  mocks.ipcInvoke.mockReset()
  mocks.ipcOn.mockReset()
  mocks.ipcRemoveListener.mockReset()
  mocks.exposeInMainWorld.mockReset()
  mocks.runChat.mockReset()
})

describe('memory chat IPC handler', () => {
  it('awaits the memory service before invoking runChat', async () => {
    const memory = makeMemory()
    const ready = deferred<FakeMemory>()
    const handler = buildMemoryChatHandler(() => ready.promise, vi.fn())
    const args = { question: 'what happened?', history: [] }

    const pending = handler(args)
    await Promise.resolve()
    expect(mocks.runChat).not.toHaveBeenCalled()

    ready.resolve(memory)
    await pending
    expect(mocks.runChat).toHaveBeenCalledWith(args, expect.any(Function), memory, memory)
  })

  it('forwards runChat events to memory:chat:event', async () => {
    const memory = makeMemory()
    const send = vi.fn()
    mocks.runChat.mockImplementationOnce(async (_args, emit: (event: unknown) => void) => {
      emit({ type: 'searching' })
      emit({ type: 'done', content: 'answer', sources: [] })
    })
    const handler = buildMemoryChatHandler(async () => memory, send)

    await handler({ question: 'q', history: [] })

    expect(send).toHaveBeenNthCalledWith(1, 'memory:chat:event', { type: 'searching' })
    expect(send).toHaveBeenNthCalledWith(2, 'memory:chat:event', {
      type: 'done',
      content: 'answer',
      sources: [],
    })
  })

  it('passes chat history through unchanged', async () => {
    const memory = makeMemory()
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'earlier', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: 'answer [^1]', createdAt: 2 },
    ]
    const handler = buildMemoryChatHandler(async () => memory, vi.fn())

    await handler({ question: 'follow up', history })

    expect(mocks.runChat.mock.calls[0][0]).toEqual({ question: 'follow up', history })
  })
})

describe('memory chat preload bridge', () => {
  it('exposes memory.chat through the memory:chat invoke channel', async () => {
    const { buildPreloadApi } = await import('../preload/api')
    const api = buildPreloadApi({
      invoke: mocks.ipcInvoke,
      on: mocks.ipcOn,
      removeListener: mocks.ipcRemoveListener,
      send: vi.fn(),
    })
    const args = { question: 'q', history: [] }

    await api.memory.chat(args)

    expect(mocks.ipcInvoke).toHaveBeenCalledWith('memory:chat', args)
  })

  it('exposes memory.onChatEvent as a memory:chat:event listener', async () => {
    const { buildPreloadApi } = await import('../preload/api')
    const api = buildPreloadApi({
      invoke: mocks.ipcInvoke,
      on: mocks.ipcOn,
      removeListener: mocks.ipcRemoveListener,
      send: vi.fn(),
    })
    const handler = vi.fn()

    const unsubscribe = api.memory.onChatEvent(handler)
    const listener = mocks.ipcOn.mock.calls[0][1] as (_event: unknown, payload: unknown) => void
    listener({}, { type: 'delta', content: 'x' })
    unsubscribe()

    expect(mocks.ipcOn).toHaveBeenCalledWith('memory:chat:event', expect.any(Function))
    expect(handler).toHaveBeenCalledWith({ type: 'delta', content: 'x' })
    expect(mocks.ipcRemoveListener).toHaveBeenCalledWith('memory:chat:event', listener)
  })
})
