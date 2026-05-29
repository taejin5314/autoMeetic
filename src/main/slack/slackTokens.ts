import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { SlackTokens } from './types'

const TOKEN_FILE = 'slack-tokens.enc'
const AUTH_TEST_URL = 'https://slack.com/api/auth.test'

export interface TokenCipher {
  available: boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
  read(): string | null
  write(value: string): void
  remove(): void
}

export interface TokenStore {
  save(tokens: SlackTokens): boolean
  load(): SlackTokens | null
  clear(): void
}

export interface SlackAuthTestSuccess {
  ok: true
  team?: string
  user?: string
}

export interface SlackAuthTestFailure {
  ok: false
  error?: string
}

export type SlackAuthTestResult = SlackAuthTestSuccess | SlackAuthTestFailure

interface ElectronApp {
  getPath(name: 'userData'): string
}

interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface FetchResponse {
  json(): Promise<unknown>
}

type FetchFn = (input: string, init: { method: 'POST'; headers: Record<string, string> }) => Promise<FetchResponse>

export function makeTokenStore(cipher: TokenCipher): TokenStore {
  return {
    save(tokens) {
      if (!cipher.available) return false
      const encrypted = cipher.encrypt(JSON.stringify(tokens)).toString('base64')
      cipher.write(encrypted)
      return true
    },
    load() {
      if (!cipher.available) return null
      const encrypted = cipher.read()
      if (!encrypted) return null
      try {
        const parsed = JSON.parse(cipher.decrypt(Buffer.from(encrypted, 'base64'))) as unknown
        return isSlackTokens(parsed) ? parsed : null
      } catch {
        return null
      }
    },
    clear() {
      cipher.remove()
    },
  }
}

export function loadTokenStore(): TokenStore {
  const require = createRequire(import.meta.url)
  const electron = require('electron') as { app: ElectronApp; safeStorage: ElectronSafeStorage }
  const filePath = join(electron.app.getPath('userData'), TOKEN_FILE)
  return makeTokenStore({
    available: electron.safeStorage.isEncryptionAvailable(),
    encrypt: (value) => electron.safeStorage.encryptString(value),
    decrypt: (value) => electron.safeStorage.decryptString(value),
    read: () => (existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null),
    write: (value) => writeFileSync(filePath, value, 'utf-8'),
    remove: () => {
      if (existsSync(filePath)) rmSync(filePath)
    },
  })
}

export async function testConnection(
  botToken: string,
  fetchFn: FetchFn = fetch as FetchFn
): Promise<SlackAuthTestResult> {
  try {
    const res = await fetchFn(AUTH_TEST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
    })
    const data = await res.json()
    if (isSlackAuthOk(data)) {
      return { ok: true, team: data.team, user: data.user }
    }
    if (isSlackAuthError(data)) {
      return { ok: false, error: data.error }
    }
    return { ok: false, error: 'invalid_response' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

function isSlackTokens(value: unknown): value is SlackTokens {
  if (!value || typeof value !== 'object') return false
  const tokens = value as Record<string, unknown>
  return (
    typeof tokens.appToken === 'string' &&
    typeof tokens.botToken === 'string' &&
    typeof tokens.memberId === 'string'
  )
}

function isSlackAuthOk(value: unknown): value is SlackAuthTestSuccess {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return data.ok === true
}

function isSlackAuthError(value: unknown): value is SlackAuthTestFailure {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return data.ok === false && (data.error === undefined || typeof data.error === 'string')
}
