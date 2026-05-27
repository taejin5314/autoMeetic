export const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'zh'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type LanguagePreference = SupportedLanguage | 'system'

export const LANGUAGE_PREF_STORAGE_KEY = 'automeetic.language'
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en'

export const LANGUAGE_NATIVE_LABEL: Record<SupportedLanguage, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
}
