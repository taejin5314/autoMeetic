import {
  DEFAULT_LANGUAGE,
  LANGUAGE_PREF_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
  type SupportedLanguage,
} from './types'

type GetLocale = () => Promise<string>

function defaultGetLocale(): Promise<string> {
  return window.electronAPI!.system.getLocale()
}

export async function detectSystemLanguage(
  getLocale: GetLocale = defaultGetLocale
): Promise<SupportedLanguage> {
  try {
    const raw = await getLocale()
    const base = raw.split('-')[0].toLowerCase()
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
      return base as SupportedLanguage
    }
    return DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function readStoredPreference(): LanguagePreference | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(LANGUAGE_PREF_STORAGE_KEY)
  if (!raw) return null
  if (raw === 'system') return 'system'
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as SupportedLanguage
  }
  return null
}

export function writeStoredPreference(pref: LanguagePreference): void {
  if (pref === 'system') {
    window.localStorage.removeItem(LANGUAGE_PREF_STORAGE_KEY)
  } else {
    window.localStorage.setItem(LANGUAGE_PREF_STORAGE_KEY, pref)
  }
}

interface ResolveArgs {
  readStorage: () => string | null
  detectFn: () => Promise<SupportedLanguage>
}

export async function resolveLanguagePreference(args: ResolveArgs): Promise<SupportedLanguage> {
  const stored = args.readStorage()
  if (stored && stored !== 'system') {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as SupportedLanguage
    }
  }
  return await args.detectFn()
}
