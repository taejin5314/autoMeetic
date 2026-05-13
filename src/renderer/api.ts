import type { ElectronAPI } from '../preload/types'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

function getElectronAPI(): ElectronAPI {
  if (!window.electronAPI) throw new Error('electronAPI not available')
  return window.electronAPI
}

// ── Translation ──

export async function translate(
  text: string,
  targetLang: string
): Promise<{ translation: string }> {
  if (isElectron) {
    return getElectronAPI().translate(text, targetLang)
  }
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang }),
  })
  if (!res.ok) throw new Error(`Translation API error: ${res.status}`)
  return (await res.json()) as { translation: string }
}

// ── Vocabulary ──

export async function updateVocabulary(
  keywords: string[]
): Promise<{ count: number }> {
  if (isElectron) {
    return getElectronAPI().updateVocabulary(keywords)
  }
  const res = await fetch('/api/vocabulary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords }),
  })
  return (await res.json()) as { count: number }
}

// ── Health ──

export async function checkHealth(): Promise<{ status: string; ts: number }> {
  if (isElectron) {
    return getElectronAPI().checkHealth()
  }
  const res = await fetch('/api/health')
  return (await res.json()) as { status: string; ts: number }
}

// ── Mode detection ──

export { isElectron }
