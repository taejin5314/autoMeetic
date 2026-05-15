import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'automeetic.theme'
const VALID_THEMES: ReadonlySet<string> = new Set<Theme>(['light', 'dark'])

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (saved && VALID_THEMES.has(saved)) return saved as Theme
  return 'light'
}

function applyThemeAttribute(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

let currentTheme: Theme = readStoredTheme()
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

function setThemeImpl(next: Theme): void {
  if (currentTheme === next) return
  currentTheme = next
  applyThemeAttribute(next)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  }
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Theme {
  return currentTheme
}

export function applyInitialTheme(): Theme {
  applyThemeAttribute(currentTheme)
  return currentTheme
}

export function useThemeStore(): {
  theme: Theme
  setTheme: (next: Theme) => void
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setTheme = useCallback((next: Theme) => {
    setThemeImpl(next)
  }, [])
  return { theme, setTheme }
}
