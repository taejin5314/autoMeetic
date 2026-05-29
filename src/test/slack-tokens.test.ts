import { describe, expect, it, vi } from 'vitest'
import { makeTokenStore, testConnection } from '../main/slack/slackTokens'

function memoryCipher() {
  let blob: string | null = null
  return {
    available: true,
    encrypt: (s: string) => Buffer.from(`enc:${s}`),
    decrypt: (b: Buffer) => b.toString().replace(/^enc:/, ''),
    read: () => blob,
    write: (b: string) => {
      blob = b
    },
    remove: () => {
      blob = null
    },
  }
}

describe('token store', () => {
  it('save then load round-trips', () => {
    const store = makeTokenStore(memoryCipher())
    expect(store.save({ appToken: 'xapp-1', botToken: 'xoxb-1', memberId: 'U1' })).toBe(true)
    expect(store.load()).toEqual({ appToken: 'xapp-1', botToken: 'xoxb-1', memberId: 'U1' })
  })

  it('clear removes', () => {
    const c = memoryCipher()
    const store = makeTokenStore(c)
    store.save({ appToken: 'a', botToken: 'b', memberId: 'U1' })
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('load returns null when encryption unavailable', () => {
    const store = makeTokenStore({ ...memoryCipher(), available: false })
    expect(store.load()).toBeNull()
  })

  it('save reports false when encryption unavailable', () => {
    const store = makeTokenStore({ ...memoryCipher(), available: false })
    expect(store.save({ appToken: 'xapp-1', botToken: 'xoxb-1', memberId: 'U1' })).toBe(false)
    expect(store.load()).toBeNull()
  })
})

describe('testConnection', () => {
  it('returns ok with team/user on success', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, team: 'T', user: 'bot' }) })
    expect(await testConnection('xoxb-1', fetchFn as never)).toEqual({ ok: true, team: 'T', user: 'bot' })
  })

  it('returns error on ok:false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'invalid_auth' }) })
    const r = await testConnection('xoxb-bad', fetchFn as never)
    expect(r.ok).toBe(false)
  })
})
