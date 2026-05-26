import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChatMessage,
  ChatSource,
  DeepAskEvent,
  DeepAskProgressState,
  DeepAskSubagentProgress,
} from './types'

const STORAGE_KEY = 'automeetic.askHistory'
const MAX_MESSAGES = 50

interface StoredHistory {
  version: 1
  messages: ChatMessage[]
}

type ChatEvent =
  | { type: 'searching' }
  | { type: 'retrieved'; sources: ChatSource[] }
  | { type: 'no_context' }
  | { type: 'delta'; content: string }
  | { type: 'done'; content: string; sources: ChatSource[] }
  | { type: 'error'; message: string }

function loadHistory(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredHistory
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return []
    return parsed.messages
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    const capped = messages.slice(-MAX_MESSAGES)
    const payload: StoredHistory = { version: 1, messages: capped }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Local state remains usable if storage is unavailable or full.
  }
}

function newId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function applyChatEventToMessages(
  messages: ChatMessage[],
  messageId: string | null,
  event: ChatEvent
): ChatMessage[] {
  if (!messageId) return messages
  const idx = messages.findIndex((m) => m.id === messageId)
  if (idx === -1) return messages

  const next = [...messages]
  const cur = { ...next[idx] }
  if (event.type === 'retrieved') {
    cur.sources = event.sources
  } else if (event.type === 'no_context') {
    cur.content = 'No relevant meetings found.'
  } else if (event.type === 'delta') {
    cur.content = `${cur.content}${event.content}`
  } else if (event.type === 'done') {
    cur.content = event.content
    cur.sources = event.sources
  } else if (event.type === 'error') {
    cur.error = event.message
  }
  next[idx] = cur
  return next
}

export interface ChatStore {
  messages: ChatMessage[]
  isStreaming: boolean
  meetingCount: number
  deepEnabled: boolean
  deepProgress: DeepAskProgressState | null
  setDeepEnabled(v: boolean): void
  submit(question: string): void
  stop(): void
  newChat(): void
}

export function useChatStore(): ChatStore {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory)
  const [isStreaming, setIsStreaming] = useState(false)
  const [meetingCount, setMeetingCount] = useState(0)
  const [deepEnabled, setDeepEnabled] = useState(false)
  const [deepProgress, setDeepProgress] = useState<DeepAskProgressState | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)
  const messagesRef = useRef<ChatMessage[]>(messages)

  useEffect(() => {
    saveHistory(messages)
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const api = window.electronAPI?.memory
    if (!api?.listMeetings) return
    void api.listMeetings({ limit: 1, offset: 0 }).then((list) => {
      if (Array.isArray(list)) setMeetingCount(list.length > 0 ? -1 : 0)
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI?.memory
    if (!api?.onChatEvent) return
    return api.onChatEvent((rawEvent: unknown) => {
      const event = rawEvent as ChatEvent
      const msgId = streamingMsgIdRef.current
      if (!msgId) return

      setMessages((prev) => applyChatEventToMessages(prev, msgId, event))

      if (event.type === 'done' || event.type === 'error' || event.type === 'no_context') {
        setIsStreaming(false)
        streamingMsgIdRef.current = null
      }
    })
  }, [])

  useEffect(() => {
    const api = window.electronAPI?.memory
    if (!api?.onDeepAskEvent) return
    return api.onDeepAskEvent((event: DeepAskEvent) => {
      const msgId = streamingMsgIdRef.current
      if (!msgId) return

      if (event.type === 'plan-created') {
        setDeepProgress({ plan: event.plan, subagents: [], synthesizing: false })
      } else if (event.type === 'subagent-started') {
        setDeepProgress((prev) => ({
          plan: prev?.plan,
          synthesizing: prev?.synthesizing ?? false,
          subagents: ([
            ...(prev?.subagents.filter((s) => s.brief.idx !== event.idx) ?? []),
            { brief: event.brief, status: 'running', toolCalls: 0 },
          ] satisfies DeepAskSubagentProgress[]).sort((a, b) => a.brief.idx - b.brief.idx),
        }))
      } else if (event.type === 'subagent-tool-call') {
        setDeepProgress((prev) =>
          prev
            ? {
                ...prev,
                subagents: prev.subagents.map((s) =>
                  s.brief.idx === event.idx ? { ...s, toolCalls: s.toolCalls + 1 } : s
                ),
              }
            : prev
        )
      } else if (event.type === 'subagent-result') {
        setDeepProgress((prev) =>
          prev
            ? {
                ...prev,
                subagents: prev.subagents.map((s) =>
                  s.brief.idx === event.idx
                    ? {
                        ...s,
                        status: event.toolCallsUsed >= s.brief.boundaries.maxToolCalls ? 'capped' : 'done',
                        toolCalls: event.toolCallsUsed,
                      }
                    : s
                ),
              }
            : prev
        )
      } else if (event.type === 'subagent-failed') {
        setDeepProgress((prev) =>
          prev
            ? {
                ...prev,
                subagents: prev.subagents.map((s) =>
                  s.brief.idx === event.idx ? { ...s, status: 'failed' } : s
                ),
              }
            : prev
        )
      } else if (event.type === 'synthesizing') {
        setDeepProgress((prev) => ({ plan: prev?.plan, subagents: prev?.subagents ?? [], synthesizing: true }))
      }

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msgId)
        if (idx === -1) return prev
        const next = [...prev]
        const cur = { ...next[idx], deepResearch: true }
        if (event.type === 'delta') {
          cur.content = `${cur.content}${event.content}`
        } else if (event.type === 'done') {
          cur.content = event.answer
          cur.sources = event.sources
          cur.costBreakdown = event.costBreakdown
          cur.deepDurationMs = event.durationMs
        } else if (event.type === 'error') {
          cur.error = event.message
        } else if (event.type === 'gate-denied') {
          cur.error = event.reason
        }
        next[idx] = cur
        return next
      })

      if (event.type === 'done' || event.type === 'error' || event.type === 'gate-denied') {
        setIsStreaming(false)
        setDeepProgress(null)
        streamingMsgIdRef.current = null
      }
    })
  }, [])

  const submit = useCallback((question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return
    const api = window.electronAPI?.memory
    if (!api?.chat) return
    if (deepEnabled && !api.deepAsk) return

    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    }
    const assistantMsg: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      deepResearch: deepEnabled || undefined,
    }
    streamingMsgIdRef.current = assistantMsg.id
    const history = messagesRef.current
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)
    setDeepProgress(deepEnabled ? { subagents: [], synthesizing: false } : null)

    if (deepEnabled) {
      void api.deepAsk({ question: trimmed, history })
    } else {
      void api.chat({ question: trimmed, history })
    }
  }, [deepEnabled])

  const stop = useCallback(() => {
    const msgId = streamingMsgIdRef.current
    streamingMsgIdRef.current = null
    setIsStreaming(false)
    setDeepProgress(null)
    if (msgId) {
      setMessages((prev) => prev.filter((m) => m.id !== msgId || m.content.length > 0))
    }
  }, [])

  const newChat = useCallback(() => {
    if (streamingMsgIdRef.current) {
      stop()
    }
    setMessages([])
  }, [stop])

  return {
    messages,
    isStreaming,
    meetingCount,
    deepEnabled,
    deepProgress,
    setDeepEnabled,
    submit,
    stop,
    newChat,
  }
}
